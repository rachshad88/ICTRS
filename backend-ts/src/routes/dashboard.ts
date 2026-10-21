import { Router, Response } from 'express';
import { Document } from 'mongodb';
import {
  getUsersCollection, getRequestsCollection, getMultimediaRequestsCollection,
  getDigitalMediaRequestsCollection, getPrintMaterialsRequestsCollection,
  getAuditLogsCollection
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { periodOf } from '../utils/periods';

const router = Router();

router.get('/admin-stats', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // The dashboard's period (Today by default): request counts and lists cover requests made in it,
    // activity covers what happened in it. User counts are for everyone, whenever they signed up.
    const period = periodOf(req, 'daily');
    if (!period) return res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
    const created = { created_at: { $gte: period.startDate, $lte: period.endDate } };

    const usersCol = getUsersCollection();
    const requestsCol = getRequestsCollection();
    const multimediaCol = getMultimediaRequestsCollection();
    const digitalCol = getDigitalMediaRequestsCollection();
    const printCol = getPrintMaterialsRequestsCollection();
    const auditCol = getAuditLogsCollection();

    const [
      userCounts,
      itCounts,
      multimediaCounts,
      digitalCounts,
      printCounts,
      recentRequests,
      recentAudit
    ] = await Promise.all([
      usersCol.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $project: { _id: 0, role: '$_id', count: 1 } }
      ]).toArray(),

      requestsCol.aggregate([
        { $match: created },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      multimediaCol.aggregate([
        { $match: created },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      digitalCol.aggregate([
        { $match: created },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      printCol.aggregate([
        { $match: created },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      // Last 10 requests made in the period across all types, each annotated with type label
      (async () => {
        const [it, multimedia, digital, print] = await Promise.all([
          requestsCol.find(created).sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, office: 1 }).toArray(),
          multimediaCol.find(created).sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, event_title: 1 }).toArray(),
          digitalCol.find(created).sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, description: 1 }).toArray(),
          printCol.find(created).sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, printed_media_description: 1 }).toArray(),
        ]);
        const all: Document[] = [
          ...it.map(r => Object.assign(r, { type: 'IT' })),
          ...multimedia.map(r => Object.assign(r, { type: 'Event Documentation' })),
          ...digital.map(r => Object.assign(r, { type: 'Digital Media' })),
          ...print.map(r => Object.assign(r, { type: 'Print Materials' })),
        ];
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return all.slice(0, 10);
      })(),

      auditCol.find({ timestamp: { $gte: period.startDate, $lte: period.endDate } }).sort({ timestamp: -1 }).limit(10).project({
        username: 1, action: 1, entity_type: 1, details: 1, timestamp: 1, _id: 0
      }).toArray(),
    ]);

    const toCountMap = (arr: Document[]) =>
      arr.reduce((acc: Record<string, number>, item) => {
        const key = item.status || item.role || 'unknown';
        acc[key] = (item.count as number) || 0;
        return acc;
      }, {} as Record<string, number>);

    res.json({
      user_counts: toCountMap(userCounts),
      it_counts: toCountMap(itCounts),
      multimedia_counts: toCountMap(multimediaCounts),
      digital_counts: toCountMap(digitalCounts),
      print_counts: toCountMap(printCounts),
      recent_requests: recentRequests,
      recent_audit: recentAudit,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;