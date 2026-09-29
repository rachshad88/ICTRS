import { Router, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { Collection } from 'mongodb';
import {
  getUsersCollection, getRequestsCollection, getMultimediaRequestsCollection, getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection, isValidObjectId, Role
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { PRIORITIES, OPEN_STATUSES, priorityExpr, priorityRankExpr, overdueExpr, toDay } from '../utils/priority';

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
}

const TYPES: TypeDef[] = [
  {
    key: 'it', label: 'IT', collection: 'requests', getCollection: getRequestsCollection, adminRole: 'IT_ADMIN', staffRole: 'TECHNICIAN',
    title: '$issue', detail: '$unit', office: '$office', due: '$due_date'
  },
  {
    key: 'multimedia', label: 'Multimedia', collection: 'multimedia_requests', getCollection: getMultimediaRequestsCollection, adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA',
    title: '$event_title', detail: '$location_type', office: null, due: '$event_date'
  },
  {
    key: 'digital_media', label: 'Digital Media', collection: 'digital_media_requests', getCollection: getDigitalMediaRequestsCollection, adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA',
    title: '$description', detail: '$form_of_digital_media', office: null, due: '$target_date'
  },
  {
    key: 'print_materials', label: 'Print Materials', collection: 'print_materials_requests', getCollection: getPrintMaterialsRequestsCollection, adminRole: 'MULTIMEDIA_ADMIN', staffRole: 'MULTIMEDIA',
    title: '$event_ppa_name',
    detail: { $concat: [{ $ifNull: ['$form_of_printed_media', ''] }, ' ', { $ifNull: ['$size_of_printed_media', ''] }] },
    office: null, due: '$target_date'
  }
];

const STATUS_FILTERS: Record<string, unknown> = {
  OPEN: { $in: OPEN_STATUSES },
  PENDING: { $in: ['PENDING', 'UNASSIGNED'] },
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
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
          created_at: 1, completed_at: 1, decline_reason: 1, notes: 1,
          title: t.title, detail: t.detail, office: t.office === null ? { $literal: null } : t.office,
          priority: priorityExpr(),
          due: { $ifNull: [t.due, null] }
        }
      },
      { $addFields: { overdue: overdueExpr('$due'), priority_rank: priorityRankExpr() } },
      { $match: branchMatch }
    ];

    // Office and search depend on the requester and assignee, so they run after the lookups.
    const postMatch: Record<string, unknown> = {};
    if (q.office) postMatch.office = q.office;
    if (q.search) {
      const escaped = q.search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      postMatch.$or = ['request_code', 'title', 'detail', 'office', 'requester_name', 'assignee_name'].map((f) => ({ [f]: regex }));
    }

    const [first, ...rest] = types;
    const pipeline = [
      ...branch(first),
      ...rest.map((t) => ({ $unionWith: { coll: t.collection, pipeline: branch(t) } })),
      userLookup('$created_by', 'requester'),
      userLookup('$assigned_to', 'assignee'),
      {
        $addFields: {
          office: { $ifNull: ['$office', { $arrayElemAt: ['$requester.office', 0] }] },
          requester_name: fullName('$requester'),
          assignee_name: fullName('$assignee')
        }
      },
      { $match: postMatch },
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
                done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } }
              }
            }
          ],
          data: [
            { $addFields: { due_sort: { $ifNull: ['$due', new Date('9999-12-31')] } } },
            { $sort: { ...sort, _id: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
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
        done: counts.done || 0
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

export default router;
