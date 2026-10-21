import { Router, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { Collection } from 'mongodb';
import {
  getUsersCollection, getRequestsCollection, getMultimediaRequestsCollection, getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection, isValidObjectId, Role
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { db, logAudit } from '../config/database';
import { getIO } from '../config/socket';
import { removeRequestFiles } from './files';
import { removeCopy } from '../utils/ratingSync';
import { LiveLane, liveRequestRemoved } from './live';
import { PRIORITIES, OPEN_STATUSES, COMPLETED_STATUSES, priorityExpr, priorityRankExpr, overdueExpr, toDay } from '../utils/priority';

// One combined, filterable list of every request type an admin is responsible for.
// IT admins see IT requests, multimedia admins see the three media types, and ADMIN sees all.

const router = Router();

interface TypeDef {
  key: string;
  label: string;
  collection: string;
  getCollection: () => Collection<any>;
  adminRole: Role;
  staffRole: Role;
  title: unknown;
  detail: unknown;
  office: unknown;
  due: string;
  /** Files the client attached (served by routes/files.ts); IT requests have none, only MOV photos. */
  files: unknown;
  /** Its folder under uploads/: the client's files, or for IT the MOV photos. */
  uploads: 'requests' | 'multimedia' | 'digitalmedia' | 'printmaterials';
  /** Where the screens hear about changes: IT's request_update, or the media services' `<prefix>_request_*`. */
  socketPrefix: string | null;
  lane: LiveLane;
  auditEntity: string;
}

const TYPES: TypeDef[] = [
  {
    key: 'it', label: 'IT', collection: 'requests', getCollection: getRequestsCollection, adminRole: 'IT_ADMIN', staffRole: 'TECHNICIAN',
    title: '$issue', detail: '$unit', office: '$office', due: '$due_date',
    files: { $literal: [] },
    uploads: 'requests', socketPrefix: null, lane: 'it', auditEntity: 'IT_REQUEST'
  },
  {
    key: 'multimedia', label: 'Event Documentation', collection: 'multimedia_requests', getCollection: getMultimediaRequestsCollection, adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA',
    title: '$event_title', detail: '$location_type', office: null, due: '$event_date',
    files: { $cond: [{ $ifNull: ['$program_file', false] }, ['$program_file'], []] },
    uploads: 'multimedia', socketPrefix: 'multimedia', lane: 'multimedia', auditEntity: 'MULTIMEDIA'
  },
  {
    key: 'digital_media', label: 'Digital Media', collection: 'digital_media_requests', getCollection: getDigitalMediaRequestsCollection, adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA',
    title: '$description', detail: '$form_of_digital_media', office: null, due: '$target_date',
    files: { $ifNull: ['$supporting_files', []] },
    uploads: 'digitalmedia', socketPrefix: 'digital_media', lane: 'digital_media', auditEntity: 'DIGITAL_MEDIA'
  },
  {
    key: 'print_materials', label: 'Print Materials', collection: 'print_materials_requests', getCollection: getPrintMaterialsRequestsCollection, adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA',
    title: '$event_ppa_name',
    detail: { $concat: [{ $ifNull: ['$form_of_printed_media', ''] }, ' ', { $ifNull: ['$size_of_printed_media', ''] }] },
    office: null, due: '$target_date',
    files: { $ifNull: ['$supporting_files', []] },
    uploads: 'printmaterials', socketPrefix: 'print_materials', lane: 'print_materials', auditEntity: 'PRINT_MATERIALS'
  }
];

const STATUS_FILTERS: Record<string, unknown> = {
  OPEN: { $in: OPEN_STATUSES },
  PENDING: { $in: ['PENDING', 'UNASSIGNED'] },
  IN_PROGRESS: 'IN_PROGRESS',
  FOR_VERIFICATION: 'FOR_VERIFICATION',
  DONE: { $in: COMPLETED_STATUSES },
  RATED: 'RATED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED'
};

const SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { created_at: -1 },
  oldest: { created_at: 1 },
  priority: { priority_rank: 1, created_at: -1 },
  due: { due_sort: 1, priority_rank: 1 }
};

function allowedTypes(req: AuthenticatedRequest): TypeDef[] {
  const roles = req.user?.roles || [];
  if (roles.includes('ADMIN')) return TYPES;
  return TYPES.filter((t) => roles.includes(t.adminRole));
}

function isOverviewAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (allowedTypes(req).length === 0) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

function userLookup(localField: string, as: string) {
  return {
    $lookup: {
      from: 'users',
      let: { lookupId: localField },
      pipeline: [
        { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
        { $project: { first_name: 1, last_name: 1, office: 1 } }
      ],
      as
    }
  };
}

function fullName(arrayField: string) {
  return {
    $let: {
      vars: { u: { $arrayElemAt: [arrayField, 0] } },
      in: { $cond: [{ $ifNull: ['$$u', false] }, { $concat: [{ $ifNull: ['$$u.first_name', ''] }, ' ', { $ifNull: ['$$u.last_name', ''] }] }, null] }
    }
  };
}

/** Ids of the users matching a filter, both as ObjectIds and as strings (some older records kept ids as strings). */
async function userIdsWhere(filter: Record<string, unknown>): Promise<Array<ObjectId | string>> {
  const users = await getUsersCollection().find(filter, { projection: { _id: 1 } }).toArray();
  return users.flatMap((u) => [u._id, u._id.toString()]);
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

router.get('/meta', isAuthenticated, isOverviewAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const types = allowedTypes(req);
    const staffRoles = [...new Set(types.map((t) => t.staffRole))];
    const usersCollection = getUsersCollection();

    const [staff, offices] = await Promise.all([
      usersCollection
        .find({ roles: { $in: staffRoles } }, { projection: { first_name: 1, last_name: 1, roles: 1 } })
        .sort({ first_name: 1, last_name: 1 })
        .toArray(),
      usersCollection.distinct('office')
    ]);

    res.json({
      types: types.map((t) => ({ key: t.key, label: t.label })),
      staff: staff.map((u) => ({
        _id: u._id.toString(),
        name: `${u.first_name} ${u.last_name}`,
        team: (u.roles || []).includes('TECHNICIAN') ? 'IT' : 'Multimedia'
      })),
      offices: (offices as unknown[]).filter((o): o is string => typeof o === 'string' && o.trim() !== '').sort()
    });
  } catch (error) {
    console.error('Overview meta error:', error);
    res.status(500).json({ error: 'Failed to load filters' });
  }
});

router.get('/requests', isAuthenticated, isOverviewAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    let types = allowedTypes(req);
    if (q.type) {
      types = types.filter((t) => t.key === q.type);
      if (types.length === 0) {
        return res.status(403).json({ error: 'You cannot view this request type' });
      }
    }

    const page = Math.max(1, parseInt(q.page || '') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || '') || 15));
    const sort = SORTS[q.sort || ''] || SORTS.newest;

    // Filters on fields every type has, applied inside each branch before the union.
    const branchMatch: Record<string, unknown> = {};
    if (q.status && STATUS_FILTERS[q.status]) branchMatch.status = STATUS_FILTERS[q.status];
    if (q.priority && (PRIORITIES as readonly string[]).includes(q.priority)) branchMatch.priority = q.priority;
    if (q.assigned_to === 'unassigned') branchMatch.assigned_to = null;
    else if (q.assigned_to && isValidObjectId(q.assigned_to)) branchMatch.assigned_to = new ObjectId(q.assigned_to);
    if (q.overdue === '1') branchMatch.overdue = true;
    const from = parseIsoDate(q.from);
    const to = parseIsoDate(q.to);
    if (from || to) {
      branchMatch.created_at = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    }

    const branch = (t: TypeDef) => [
      {
        $project: {
          type: { $literal: t.key },
          request_code: 1, status: 1, created_by: 1, assigned_to: { $ifNull: ['$assigned_to', null] },
          created_at: 1, completed_at: 1, accepted_at: 1, declined_at: 1, cancelled_at: 1, reopened_at: 1, previously_completed_at: 1, decline_reason: 1, notes: 1,
          // IT: photos of the finished work (MOV); the other types have none.
          mov_files: { $ifNull: ['$mov.files', []] },
          files: t.files,
          title: t.title, detail: t.detail, office: t.office === null ? { $literal: null } : t.office,
          priority: priorityExpr(),
          due: { $ifNull: [t.due, null] }
        }
      },
      { $addFields: { overdue: overdueExpr('$due'), priority_rank: priorityRankExpr() } },
      { $match: branchMatch }
    ];

    // Office and search also look at people (the requester's office for media requests, which have
    // none of their own, and requester/assignee names). Resolve those against the users first and
    // filter by their ids, so names are only looked up for the page being returned; looking them up
    // for every request before paging made this list slow once there were thousands of requests.
    const postMatch: Record<string, unknown>[] = [];
    if (q.office) {
      postMatch.push({ $or: [{ office: q.office }, { office: null, created_by: { $in: await userIdsWhere({ office: q.office }) } }] });
    }
    if (q.search) {
      const escaped = q.search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      const [inOffice, named] = await Promise.all([
        userIdsWhere({ office: regex }),
        userIdsWhere({ $expr: { $regexMatch: { input: { $concat: [{ $ifNull: ['$first_name', ''] }, ' ', { $ifNull: ['$last_name', ''] }] }, regex: escaped, options: 'i' } } })
      ]);
      postMatch.push({
        $or: [
          ...['request_code', 'title', 'detail', 'office'].map((f) => ({ [f]: regex })),
          { office: null, created_by: { $in: inOffice } },
          { created_by: { $in: named } },
          { assigned_to: { $in: named } }
        ]
      });
    }

    const [first, ...rest] = types;
    const pipeline = [
      ...branch(first),
      ...rest.map((t) => ({ $unionWith: { coll: t.collection, pipeline: branch(t) } })),
      ...(postMatch.length ? [{ $match: { $and: postMatch } }] : []),
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                open: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
                unassigned: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $eq: ['$assigned_to', null] }] }, 1, 0] } },
                urgent_open: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $eq: ['$priority', 'URGENT'] }] }, 1, 0] } },
                overdue: { $sum: { $cond: ['$overdue', 1, 0] } },
                done: { $sum: { $cond: [{ $in: ['$status', COMPLETED_STATUSES] }, 1, 0] } },
                // Per-status counts for the media assign dashboard's counter strip.
                waiting: { $sum: { $cond: [{ $in: ['$status', ['PENDING', 'UNASSIGNED']] }, 1, 0] } },
                in_progress: { $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] } },
                declined: { $sum: { $cond: [{ $eq: ['$status', 'DECLINED'] }, 1, 0] } },
                cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } }
              }
            }
          ],
          data: [
            { $addFields: { due_sort: { $ifNull: ['$due', new Date('9999-12-31')] } } },
            { $sort: { ...sort, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            userLookup('$created_by', 'requester'),
            userLookup('$assigned_to', 'assignee'),
            {
              $addFields: {
                office: { $ifNull: ['$office', { $arrayElemAt: ['$requester.office', 0] }] },
                requester_name: fullName('$requester'),
                assignee_name: fullName('$assignee')
              }
            },
            { $project: { requester: 0, assignee: 0, due_sort: 0, priority_rank: 0, created_by: 0 } }
          ]
        }
      }
    ];

    const result = await first.getCollection().aggregate(pipeline).toArray();
    const counts = result[0]?.counts?.[0] || {};
    const total = counts.total || 0;

    res.json({
      requests: (result[0]?.data || []).map((r: any) => ({
        ...r,
        _id: r._id.toString(),
        assigned_to: r.assigned_to ? r.assigned_to.toString() : null,
        due: toDay(r.due)
      })),
      counts: {
        total,
        open: counts.open || 0,
        unassigned: counts.unassigned || 0,
        urgent_open: counts.urgent_open || 0,
        overdue: counts.overdue || 0,
        done: counts.done || 0,
        waiting: counts.waiting || 0,
        in_progress: counts.in_progress || 0,
        declined: counts.declined || 0,
        cancelled: counts.cancelled || 0
      },
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Overview requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Deletes a request for good, with everything that belongs to it: its files (the client's uploads,
// or an IT request's MOV photos) and their preview copies, its notifications, and its copy in the
// rating database if it is still waiting to be rated (a row the CSF already marked RATED is the
// CSF's record and stays). The audit log keeps an entry saying who deleted what. Super admin only.
router.delete('/requests/:type/:id', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const t = TYPES.find((x) => x.key === req.params.type);
    const { id } = req.params;
    if (!t || !isValidObjectId(id)) return res.status(400).json({ error: 'Invalid request' });

    const result = await t.getCollection().findOneAndDelete({ _id: new ObjectId(id) });
    const doc = result?.value;
    if (!doc) return res.status(404).json({ error: 'This request was already deleted. Refresh the list.' });

    const code: string = doc.request_code || id;
    const files = await removeRequestFiles(t.uploads, id).catch((error) => {
      console.error(`Delete request: could not remove the files of ${code}:`, error);
      return 0;
    });
    const notifications = doc.request_code
      ? (await db.collection('notifications').deleteMany({ request_code: doc.request_code }).catch(() => ({ deletedCount: 0 }))).deletedCount
      : 0;
    void removeCopy(doc.request_code);
    liveRequestRemoved(t.lane, id, 'CANCELLED');

    await logAudit(
      new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'DELETE_REQUEST', t.auditEntity, id,
      `${req.user!.username} deleted ${t.label} request ${code} (${doc.status || 'no status'}) with ${files} file(s)`
    );

    const payload = { event: 'deleted', request_id: id, request_code: code, timestamp: new Date() };
    const owner = doc.created_by ? [`user_${doc.created_by.toString()}`] : [];
    const staff = doc.assigned_to ? [`user_${doc.assigned_to.toString()}`] : [];
    try {
      const io = getIO();
      if (t.socketPrefix) io.to(['admins', 'multimedia_staff', ...owner, ...staff]).emit(`${t.socketPrefix}_request_deleted`, payload);
      else io.to(['technicians', 'super_admins', ...owner]).emit('request_update', payload);
    } catch { /* no socket server: the screens catch up on their next refresh */ }

    res.json({ status: 'success', request_code: code, files, notifications });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({ error: 'Failed to delete the request' });
  }
});

export default router;
