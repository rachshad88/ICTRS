import { Router, Response } from 'express';
import { Document } from 'mongodb';
import {
  getUsersCollection, getRequestsCollection, getMultimediaRequestsCollection,
  getDigitalMediaRequestsCollection, getPrintMaterialsRequestsCollection,
  getSoftwareRequestsCollection, getAuditLogsCollection
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';

const router = Router();

router.get('/admin-stats', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const usersCol = getUsersCollection();
    const requestsCol = getRequestsCollection();
    const multimediaCol = getMultimediaRequestsCollection();
    const digitalCol = getDigitalMediaRequestsCollection();
    const printCol = getPrintMaterialsRequestsCollection();
    const softwareCol = getSoftwareRequestsCollection();
    const auditCol = getAuditLogsCollection();

    const [
      userCounts,
      itCounts,
      multimediaCounts,
      digitalCounts,
      printCounts,
      softwareCounts,
      recentRequests,
      recentAudit
    ] = await Promise.all([
      usersCol.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $project: { _id: 0, role: '$_id', count: 1 } }
      ]).toArray(),

      requestsCol.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      multimediaCol.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      digitalCol.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      printCol.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      softwareCol.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } }
      ]).toArray(),

      // Last 10 requests across all types, each annotated with type label
      (async () => {
        const [it, multimedia, digital, print, software] = await Promise.all([
          requestsCol.find().sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, office: 1 }).toArray(),
          multimediaCol.find().sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, event_title: 1 }).toArray(),
          digitalCol.find().sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, description: 1 }).toArray(),
          printCol.find().sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, printed_media_description: 1 }).toArray(),
          softwareCol.find().sort({ created_at: -1 }).limit(10).project({ request_code: 1, status: 1, created_at: 1, proposed_title: 1 }).toArray(),
        ]);
        const all: Document[] = [
          ...it.map(r => Object.assign(r, { type: 'IT' })),
          ...multimedia.map(r => Object.assign(r, { type: 'Multimedia' })),
          ...digital.map(r => Object.assign(r, { type: 'Digital Media' })),
          ...print.map(r => Object.assign(r, { type: 'Print Materials' })),
          ...software.map(r => Object.assign(r, { type: 'Software' })),
        ];
        all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return all.slice(0, 10);
      })(),

      auditCol.find().sort({ timestamp: -1 }).limit(10).project({
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
      software_counts: toCountMap(softwareCounts),
      recent_requests: recentRequests,
      recent_audit: recentAudit,
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

export default router;