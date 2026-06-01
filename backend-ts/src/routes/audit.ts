import { Router, Response } from 'express';
import { getAuditLogsCollection } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';

const router = Router();

router.get('/logs', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (req.query.user_id) filter.user_id = req.query.user_id;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.entity_type) filter.entity_type = req.query.entity_type;

    if (req.query.date_from || req.query.date_to) {
      filter.timestamp = {};
      if (req.query.date_from) (filter.timestamp as Record<string, unknown>).$gte = new Date(req.query.date_from as string);
      if (req.query.date_to) (filter.timestamp as Record<string, unknown>).$lte = new Date(req.query.date_to as string + 'T23:59:59');
    }

    const auditCollection = getAuditLogsCollection();
    const total = await auditCollection.countDocuments(filter);
    const logs = await auditCollection
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const rows = logs.map(log => ({
      _id: log._id?.toString(),
      timestamp: log.timestamp,
      username: typeof log.username === 'string' ? log.username : '',
      role: typeof log.role === 'string' ? log.role : '',
      action: typeof log.action === 'string' ? log.action : '',
      entity_type: typeof log.entity_type === 'string' ? log.entity_type : '',
      entity_id: typeof log.entity_id === 'string' ? log.entity_id : '',
      details: typeof log.details === 'string' ? log.details : JSON.stringify(log.details)
    }));

    res.json({
      logs: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

export default router;