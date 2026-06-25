import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getRequestsCollection, getUsersCollection, generateRequestCode, logAudit, sanitizeInput } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isTechnicianOrAdmin, isTechnicianOnly, isItAdmin, isItAdminOrTechnician } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createRequestSchema, acceptRequestSchema, finishRequestSchema, cancelRequestSchema, sharedAccessSchema } from '../middleware/validation';

const router = Router();

router.post('/send_request', isAuthenticated, validateBody(createRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { office, unit, semester, issue } = req.body;
    const created_by = req.user!.user_id;

    if (!office || !unit || !issue) {
      return res.status(400).json({ status: 'error', message: 'Required fields missing' });
    }

    const requestsCollection = getRequestsCollection();

    let result;
    let request_code;

    for (let i = 0; i < 100; i++) {
      request_code = await generateRequestCode('IT', 'it_requests');

      try {
        result = await requestsCollection.insertOne({
          request_code,
          created_by: new ObjectId(created_by),
          office: sanitizeInput(office),
          unit: sanitizeInput(unit || ''),
          semester: sanitizeInput(semester || ''),
          issue: sanitizeInput(issue),
          status: 'PENDING',
          assigned_to: null,
          finished: null,
          remarks: null,
          recommendation: null,
          created_at: new Date(),
          completed_at: null
        });
        break;
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 11000 && i < 99) {
          continue;
        }
        throw err;
      }
    }

    if (!result) {
      return res.status(500).json({ status: 'error', message: 'Failed to generate unique request code' });
    }

    await logAudit(new ObjectId(created_by), req.user!.username, req.user!.primary_role, 'CREATE_REQUEST', 'IT_REQUEST', result.insertedId.toString(), `User ${req.user!.username} created IT request ${request_code}`, { office, issue: sanitizeInput(issue) });

    const io = req.app.get('io');
    if (io) {
      io.emit('request_update', {
        event: 'created',
        request_id: result.insertedId.toString(),
        request_code,
        created_by,
        office: sanitizeInput(office),
        issue: sanitizeInput(issue),
        timestamp: new Date()
      });
    }

    res.json({ status: 'success', request_code });
  } catch (error) {
    console.error('Request creation error:', error);
    res.status(500).json({ status: 'error', message: 'An error occurred while creating your request' });
  }
});

router.post('/accept_request', isAuthenticated, isItAdmin, validateBody(acceptRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, technician_id } = req.body;

    if (!request_id || !technician_id) {
      return res.status(400).json({ status: 'error', message: 'Request ID and technician ID required' });
    }

    const usersCollection = getUsersCollection();
    const technician = await usersCollection.findOne({ _id: new ObjectId(technician_id), roles: 'TECHNICIAN' });
    if (!technician) {
      return res.status(404).json({ error: 'Technician not found' });
    }

    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      { _id: new ObjectId(request_id), status: 'PENDING' },
      { $set: { status: 'IN_PROGRESS', assigned_to: new ObjectId(technician_id) } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found or already accepted' });
    }

    const assignedTo = `${technician.first_name} ${technician.last_name}`;
    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'ACCEPT_REQUEST', 'IT_REQUEST', request_id, `IT Admin ${req.user!.username} assigned request to ${assignedTo}`);

    const io = req.app.get('io');
    if (io) {
      io.emit('request_update', {
        event: 'accepted',
        request_id,
        assigned_to: technician_id,
        status: 'IN_PROGRESS',
        timestamp: new Date()
      });
      io.to(`user_${result.value?.created_by?.toString()}`).emit('my_request_accepted', {
        request_id,
        assigned_to: technician_id
      });
      io.to(`user_${technician_id}`).emit('request_assigned_to_you', {
        request_id,
        request_code: result.value.request_code
      });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept request' });
  }
});

router.post('/request_finish', isAuthenticated, isTechnicianOnly, validateBody(finishRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, finished, remarks, recommendation } = req.body;

    if (!request_id || !finished) {
      return res.status(400).json({ status: 'error', message: 'Required fields missing' });
    }

    const requestsCollection = getRequestsCollection();
    const userId = req.user!.user_id;

    let filter: Record<string, unknown>;
    if (req.user!.roles.includes('ADMIN')) {
      filter = { _id: new ObjectId(request_id), status: { $nin: ['DONE', 'CANCELLED'] } };
    } else if (req.user!.roles.includes('TECHNICIAN')) {
      // Technician can only finish requests assigned to them
      filter = { 
        _id: new ObjectId(request_id),
        assigned_to: new ObjectId(userId),
        status: 'IN_PROGRESS'
      };
    } else {
      return res.status(403).json({ status: 'error', message: 'Insufficient permissions' });
    }

    const result = await requestsCollection.findOneAndUpdate(
      filter,
      { 
        $set: { 
          status: 'DONE', 
          finished, 
          remarks: remarks || null, 
          recommendation: recommendation || null,
          completed_at: new Date()
        } 
      },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found or not assigned to you' });
    }

    const requestCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'FINISH_REQUEST', 'IT_REQUEST', request_id, `${req.user!.roles.includes('ADMIN') ? 'Admin' : 'Technician'} ${req.user!.username} marked request ${requestCode} as ${finished}`, { finished, remarks: remarks || null, recommendation: recommendation || null });

    const io = req.app.get('io');
    if (io) {
      io.emit('request_update', {
        event: 'finished',
        request_id,
        status: 'DONE',
        timestamp: new Date()
      });
      io.to(`user_${result.value?.created_by?.toString()}`).emit('my_request_finished', { request_id });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Finish request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to finish request' });
  }
});

router.post('/cancel_request', isAuthenticated, validateBody(cancelRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id } = req.body;
    const user_id = req.user!.user_id;

    const requestsCollection = getRequestsCollection();
    
    let result;
    if (req.user!.roles.includes('ADMIN') || req.user!.roles.includes('TECHNICIAN') || req.user!.roles.includes('IT_ADMIN')) {
      result = await requestsCollection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: { $nin: ['DONE', 'CANCELLED'] } },
        { $set: { status: 'CANCELLED', assigned_to: null } },
        { returnDocument: 'after' }
      );
    } else {
      result = await requestsCollection.findOneAndUpdate(
        { _id: new ObjectId(request_id), created_by: new ObjectId(user_id), status: 'PENDING' },
        { $set: { status: 'CANCELLED', assigned_to: null } },
        { returnDocument: 'after' }
      );
    }

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found or cannot be cancelled' });
    }

    const cancelledCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(user_id), req.user!.username, req.user!.primary_role, 'CANCEL_REQUEST', 'IT_REQUEST', request_id, `${req.user!.primary_role} ${req.user!.username} cancelled request ${cancelledCode}`);

    const io = req.app.get('io');
    if (io) {
      io.emit('request_update', {
        event: 'cancelled',
        request_id,
        status: 'CANCELLED',
        timestamp: new Date()
      });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to cancel request' });
  }
});

router.get('/get_dashboard', isAuthenticated, isItAdminOrTechnician, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const filterType = (req.query.filter as string) || 'all';
    const selectedDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const showDone = req.query.show_done !== '0';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;

    let startDate: Date, endDate: Date;

    if (filterType === 'daily') {
      startDate = new Date(selectedDate + 'T00:00:00');
      endDate = new Date(selectedDate + 'T23:59:59');
    } else if (filterType === 'weekly') {
      const date = new Date(selectedDate);
      const day = date.getDay();
      startDate = new Date(date);
      startDate.setDate(date.getDate() - day);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (filterType === 'monthly') {
      const date = new Date(selectedDate);
      startDate = new Date(date.getFullYear(), date.getMonth(), 1);
      endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      startDate = new Date(0);
      endDate = new Date('2099-12-31T23:59:59');
    }

    const requestsCollection = getRequestsCollection();

    const matchFilter: Record<string, unknown> = {
      created_at: { $gte: startDate, $lte: endDate }
    };

    if (req.user!.roles.includes('TECHNICIAN')) {
      matchFilter.assigned_to = new ObjectId(userId);
    }

    if (!showDone) {
      matchFilter.status = { $ne: 'DONE' };
    }

    const search = req.query.search as string | undefined;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      const searchOr: Record<string, unknown>[] = [
        { request_code: regex },
        { issue: regex },
        { office: regex },
        { unit: regex }
      ];
      if (matchFilter.$or) {
        matchFilter.$and = [{ $or: matchFilter.$or as Record<string, unknown>[] }, { $or: searchOr }];
        delete matchFilter.$or;
      } else {
        matchFilter.$or = searchOr;
      }
    }

    const results = await requestsCollection
      .aggregate([
        { $match: matchFilter },
        {
          $lookup: {
            from: 'users',
            let: { lookupId: '$created_by' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } }
            ],
            as: 'requester'
          }
        },
        { $sort: { created_at: -1 } },
        {
          $facet: {
            metadata: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  pending_count: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
                  progress_count: { $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] } },
                  done_count: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
                  repaired_count: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'DONE'] }, { $eq: ['$finished', 'repaired'] }] }, 1, 0] } },
                  beyond_repair_count: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'DONE'] }, { $eq: ['$finished', 'beyond repair'] }] }, 1, 0] } }
                }
              }
            ],
            data: [
              { $skip: skip },
              { $limit: limit }
            ]
          }
        }
      ])
      .toArray();

    const meta = results[0]?.metadata?.[0] || {};
    const counts = {
      pending_count: meta.pending_count || 0,
      progress_count: meta.progress_count || 0,
      done_count: meta.done_count || 0,
      repaired_count: meta.repaired_count || 0,
      beyond_repair_count: meta.beyond_repair_count || 0
    };
    const total = meta.total || 0;
    const docs = results[0]?.data || [];

    const rows = docs.map((r: any) => {
      const status = r.status || '';
      const statusClass = status.toLowerCase().replace(' ', '-');
      const createdAtStr = r.created_at ? new Date(r.created_at).toISOString().replace('T', ' ').substring(0, 16) : '-';
      const completedAtStr = r.completed_at ? new Date(r.completed_at).toISOString().replace('T', ' ').substring(0, 16) : '-';
      const requesterArr = r.requester || [];
      const clientName = requesterArr.length > 0 ? `${requesterArr[0].first_name} ${requesterArr[0].last_name}` : 'Unknown';

      return {
        _id: r._id?.toString(),
        request_code: r.request_code,
        office: r.office,
        issue: r.issue,
        client_name: clientName,
        status: r.status,
        statusClass,
        created_at: createdAtStr,
        completed_at: completedAtStr,
        assigned_to: r.assigned_to?.toString() || null
      };
    });

    res.json({
      counts,
      requests: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      dateRange: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' - ' + 
                endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/check_status/:requestCode', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestCode } = req.params;
    const userId = req.user!.user_id;

    const requestsCollection = getRequestsCollection();
    
    const query = req.user!.roles.includes('CLIENT')
      ? { request_code: requestCode, created_by: new ObjectId(userId) }
      : { request_code: requestCode };

    const request = await requestsCollection.findOne(query);

    if (!request) {
      return res.status(404).json({ status: 'error', message: 'Request not found' });
    }

    res.json({
      status: 'success',
      request: {
        request_code: request.request_code,
        office: request.office,
        unit: request.unit,
        issue: request.issue,
        status: request.status,
        assigned_to: request.assigned_to?.toString(),
        finished: request.finished,
        remarks: request.remarks,
        recommendation: request.recommendation,
        created_at: request.created_at,
        completed_at: request.completed_at
      }
    });
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to check status' });
  }
});

router.post('/shared_access', isAuthenticated, validateBody(sharedAccessSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, user_id } = req.body;
    const granted_by = req.user!.user_id;

    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      { _id: new ObjectId(request_id), created_by: new ObjectId(granted_by) },
      { $addToSet: { shared_access: new ObjectId(user_id) } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found' });
    }

    const sharedCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(granted_by), req.user!.username, req.user!.primary_role, 'SHARED_ACCESS', 'IT_REQUEST', request_id, `User ${req.user!.username} granted access to request ${sharedCode} to user ${user_id}`);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${user_id}`).emit('access_granted', {
        request_code: result.value?.request_code,
        granted_by
      });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Shared access error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to grant access' });
  }
});

router.get('/my_requests', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    
    const requestsCollection = getRequestsCollection();
    
    let filter: Record<string, unknown> = {};
    
    if (req.user!.roles.includes('CLIENT')) {
      filter = { created_by: new ObjectId(userId) };
    } else if (req.user!.roles.includes('TECHNICIAN')) {
      filter = { assigned_to: new ObjectId(userId) };
    }
    
    const search = req.query.search as string | undefined;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { request_code: regex },
        { issue: regex },
        { office: regex },
        { unit: regex }
      ];
    }
    
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;
    
    const result = await requestsCollection.aggregate([
      { $match: filter },
      {
        $facet: {
          counts: [
            { $group: { _id: '$status', count: { $sum: 1 } } }
          ],
          data: [
            { $sort: { created_at: -1 } },
            { $skip: skip },
            { $limit: limit }
          ]
        }
      }
    ]).toArray();
    
    const countsResult: Array<{ _id: string; count: number }> = result[0]?.counts || [];
    const requests = result[0]?.data || [];
    
    const counts = {
      pending_count: countsResult.find(c => c._id === 'PENDING')?.count || 0,
      progress_count: countsResult.find(c => c._id === 'IN_PROGRESS')?.count || 0,
      done_count: countsResult.find(c => c._id === 'DONE')?.count || 0
    };
    
    const total = countsResult.reduce((sum, c) => sum + c.count, 0);
    
    res.json({ 
      requests, 
      counts,
      total,
      page,
      limit
    });
  } catch (error) {
    console.error('My requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.get('/get_technicians', isAuthenticated, isItAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const usersCollection = getUsersCollection();
    const technicians = await usersCollection.find({ roles: 'TECHNICIAN' }).toArray();
    res.json({ technicians });
  } catch (error) {
    console.error('Get technicians error:', error);
    res.status(500).json({ error: 'Failed to fetch technicians' });
  }
});

export default router;
