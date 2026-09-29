import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { getSoftwareRequestsCollection, getUsersCollection, generateRequestCode, logAudit, sanitizeInput } from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createSoftwareRequestSchema, reviewSoftwareRequestSchema, completeSoftwareRequestSchema } from '../middleware/validation';
import { getIO } from '../config/socket';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/software');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, PNG, DOC, DOCX files are allowed'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

function moveFile(filename: string, requestId: string): void {
  const tempPath = path.join(__dirname, `../../uploads/software/${filename}`);
  const finalDir = path.join(__dirname, `../../uploads/software/${requestId}`);
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }
  const finalPath = path.join(finalDir, filename);
  try {
    fs.renameSync(tempPath, finalPath);
  } catch (e) {
    console.error('Failed to move file:', e);
  }
}

router.post('/create_request', isAuthenticated, (req, res, next) => {
  upload.fields([
    { name: 'formal_request_letter', maxCount: 1 },
    { name: 'process_flow', maxCount: 1 }
  ])(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, validateBody(createSoftwareRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { proposed_title, client_name_office, statement_of_problem, objective } = req.body;
    const created_by = req.user!.user_id;

    if (!req.user!.roles.includes('CLIENT')) {
      return res.status(403).json({ error: 'Only clients can create requests' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const formalLetter = files?.['formal_request_letter']?.[0];
    const processFlow = files?.['process_flow']?.[0];

    if (!formalLetter || !processFlow) {
      return res.status(400).json({ error: 'Formal request letter and process flow are required' });
    }

    const collection = getSoftwareRequestsCollection();

    let result: any;
    let request_code = '';
    for (let i = 0; i < 100; i++) {
      request_code = await generateRequestCode('SW', 'software_requests');
      try {
        result = await collection.insertOne({
          request_code,
          created_by: new ObjectId(created_by),
          assigned_to: null,
          reviewed_by: null,
          proposed_title: sanitizeInput(proposed_title),
          client_name_office: sanitizeInput(client_name_office),
          statement_of_problem: sanitizeInput(statement_of_problem),
          objective: sanitizeInput(objective),
          formal_request_letter: formalLetter.filename,
          process_flow: processFlow.filename,
          status: 'PENDING',
          rejection_reason: null,
          remarks: null,
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

    moveFile(formalLetter.filename, result.insertedId.toString());
    moveFile(processFlow.filename, result.insertedId.toString());

    await logAudit(new ObjectId(created_by), req.user!.username, req.user!.primary_role, 'CREATE_REQUEST', 'SOFTWARE_REQUEST', result.insertedId.toString(), `User ${req.user!.username} created software request ${request_code}`);

    const io = getIO();
    if (io) {
      io.to('admins').emit('software_request_created', {
        request_id: result.insertedId.toString(),
        request_code,
        proposed_title,
        created_by,
        timestamp: new Date()
      });
    }

    res.json({ status: 'success', request_code, request_id: result.insertedId });
  } catch (error) {
    console.error('Create software request error:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

router.get('/get_pending', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user!.roles.includes('IT_ADMIN') && !req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const collection = getSoftwareRequestsCollection();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { status: 'PENDING' } },
      {
        $lookup: {
          from: 'users',
          let: { lookupId: '$created_by' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
            { $project: { password: 0 } }
          ],
          as: 'requester'
        }
      },
      { $sort: { created_at: -1 } }
    ];

    const results = await collection.aggregate([
      ...pipeline,
      { $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }]
      }}
    ]).toArray();

    const total = results[0]?.metadata?.[0]?.total || 0;
    const requests = results[0]?.data || [];

    res.json({ requests, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get pending software requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.get('/get_all', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user!.roles.includes('IT_ADMIN') && !req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const collection = getSoftwareRequestsCollection();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    let filter: Record<string, any> = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { request_code: regex },
        { proposed_title: regex },
        { client_name_office: regex },
        { statement_of_problem: regex }
      ];
    }

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'users',
          let: { lookupId: '$created_by' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
            { $project: { password: 0 } }
          ],
          as: 'requester'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { lookupId: '$assigned_to' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
            { $project: { password: 0 } }
          ],
          as: 'assignedProgrammer'
        }
      },
      { $sort: { created_at: -1 } }
    ];

    const results = await collection.aggregate([
      ...pipeline,
      { $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }]
      }}
    ]).toArray();

    const total = results[0]?.metadata?.[0]?.total || 0;
    const requests = results[0]?.data || [];

    res.json({ requests, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get all software requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.post('/review', isAuthenticated, validateBody(reviewSoftwareRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, action, technician_id, rejection_reason } = req.body;

    if (!req.user!.roles.includes('IT_ADMIN') && !req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const collection = getSoftwareRequestsCollection();

    if (action === 'approve') {
      if (!technician_id) {
        return res.status(400).json({ error: 'Technician ID required for approval' });
      }

      const usersCollection = getUsersCollection();
      const programmer = await usersCollection.findOne({ _id: new ObjectId(technician_id), roles: 'PROGRAMMER' });
      if (!programmer) {
        return res.status(404).json({ error: 'Programmer not found' });
      }

      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: 'PENDING' },
        { $set: { status: 'ASSIGNED', assigned_to: new ObjectId(technician_id), reviewed_by: new ObjectId(req.user!.user_id) } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(404).json({ error: 'Request not found or already reviewed' });
      }

      const requestCode = result.value.request_code;
      const assignedTo = `${programmer.first_name} ${programmer.last_name}`;
      await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'APPROVE_SOFTWARE_REQUEST', 'SOFTWARE_REQUEST', request_id, `IT Admin ${req.user!.username} approved and assigned software request ${requestCode} to ${assignedTo}`);

      const io = getIO();
      if (io) {
        io.to(`user_${technician_id}`).emit('software_request_assigned', {
          request_id,
          request_code: requestCode,
          proposed_title: result.value.proposed_title
        });
        io.to(`user_${result.value.created_by?.toString()}`).emit('software_request_approved', {
          request_id,
          request_code: requestCode
        });
        io.to('admins').emit('software_request_updated', { request_id, status: 'ASSIGNED' });
      }

      res.json({ status: 'success', message: 'Request approved and assigned' });
    } else {
      if (!rejection_reason) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }

      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: 'PENDING' },
        { $set: { status: 'NOT_APPROVED', rejection_reason, reviewed_by: new ObjectId(req.user!.user_id) } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(404).json({ error: 'Request not found or already reviewed' });
      }

      const requestCode = result.value.request_code;
      await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'REJECT_SOFTWARE_REQUEST', 'SOFTWARE_REQUEST', request_id, `IT Admin ${req.user!.username} rejected software request ${requestCode}: ${rejection_reason}`);

      const io = getIO();
      if (io) {
        io.to(`user_${result.value.created_by?.toString()}`).emit('software_request_rejected', {
          request_id,
          request_code: requestCode,
          rejection_reason
        });
        io.to('admins').emit('software_request_updated', { request_id, status: 'NOT_APPROVED' });
      }

      res.json({ status: 'success', message: 'Request rejected' });
    }
  } catch (error) {
    console.error('Review software request error:', error);
    res.status(500).json({ error: 'Failed to review request' });
  }
});

router.get('/get_assigned', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;

    if (!req.user!.roles.includes('PROGRAMMER')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const collection = getSoftwareRequestsCollection();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;

    const pipeline = [
      { $match: { assigned_to: new ObjectId(userId), status: { $in: ['ASSIGNED', 'IN_PROGRESS'] } } },
      {
        $lookup: {
          from: 'users',
          let: { lookupId: '$created_by' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
            { $project: { password: 0 } }
          ],
          as: 'requester'
        }
      },
      { $sort: { created_at: -1 } }
    ];

    const results = await collection.aggregate([
      ...pipeline,
      { $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }]
      }}
    ]).toArray();

    const total = results[0]?.metadata?.[0]?.total || 0;
    const requests = results[0]?.data || [];

    res.json({ requests, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get assigned software requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.post('/start_work', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id } = req.body;
    const userId = req.user!.user_id;

    if (!req.user!.roles.includes('PROGRAMMER')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!request_id) {
      return res.status(400).json({ error: 'Request ID required' });
    }

    const collection = getSoftwareRequestsCollection();
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(request_id), assigned_to: new ObjectId(userId), status: 'ASSIGNED' },
      { $set: { status: 'IN_PROGRESS' } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ error: 'Request not found or not assigned to you' });
    }

    const io = getIO();
    if (io) {
      io.to('admins').emit('software_request_updated', { request_id, status: 'IN_PROGRESS' });
      io.to(`user_${result.value.created_by?.toString()}`).emit('software_request_updated', { request_id, status: 'IN_PROGRESS' });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Start work error:', error);
    res.status(500).json({ error: 'Failed to start work' });
  }
});

router.post('/complete_request', isAuthenticated, validateBody(completeSoftwareRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, remarks } = req.body;
    const userId = req.user!.user_id;

    if (!req.user!.roles.includes('PROGRAMMER')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const collection = getSoftwareRequestsCollection();
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(request_id), assigned_to: new ObjectId(userId), status: { $in: ['ASSIGNED', 'IN_PROGRESS'] } },
      { $set: { status: 'DONE', remarks: remarks || null, completed_at: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ error: 'Request not found or not assigned to you' });
    }

    const requestCode = result.value.request_code;
    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'COMPLETE_SOFTWARE_REQUEST', 'SOFTWARE_REQUEST', request_id, `Programmer ${req.user!.username} completed software request ${requestCode}`);

    const io = getIO();
    if (io) {
      io.to(`user_${result.value.created_by?.toString()}`).emit('software_request_completed', {
        request_id,
        request_code: requestCode
      });
      io.to('admins').emit('software_request_updated', { request_id, status: 'DONE' });
    }

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Complete software request error:', error);
    res.status(500).json({ error: 'Failed to complete request' });
  }
});

router.get('/get_history', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;

    const collection = getSoftwareRequestsCollection();
    let filter: Record<string, any> = {};

    if (req.user!.roles.includes('CLIENT')) {
      filter.created_by = new ObjectId(userId);
    } else if (req.user!.roles.includes('PROGRAMMER')) {
      filter.assigned_to = new ObjectId(userId);
      filter.status = { $in: ['DONE', 'NOT_APPROVED'] };
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const search = req.query.search as string | undefined;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = { $regex: escaped, $options: 'i' };
      filter.$or = [
        { request_code: regex },
        { proposed_title: regex },
        { statement_of_problem: regex },
        { objective: regex }
      ];
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;

    const results = await collection.aggregate([
      { $match: filter },
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                pending_count: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
                progress_count: { $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] } },
                assigned_count: { $sum: { $cond: [{ $eq: ['$status', 'ASSIGNED'] }, 1, 0] } },
                done_count: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
                not_approved_count: { $sum: { $cond: [{ $eq: ['$status', 'NOT_APPROVED'] }, 1, 0] } }
              }
            }
          ],
          requests: [
            { $sort: { created_at: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                let: { lookupId: '$assigned_to' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
                  { $project: { password: 0 } }
                ],
                as: 'assignedProgrammer'
              }
            }
          ]
        }
      }
    ]).toArray();

    const counts = results[0]?.counts?.[0] || { total: 0, pending_count: 0, progress_count: 0, assigned_count: 0, done_count: 0, not_approved_count: 0 };

    res.json({
      requests: results[0]?.requests || [],
      counts: {
        pending_count: counts.pending_count,
        progress_count: counts.progress_count + counts.assigned_count,
        done_count: counts.done_count
      },
      total: counts.total,
      page,
      limit
    });
  } catch (error) {
    console.error('Get software history error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

router.post('/cancel_request', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id } = req.body;
    const userId = req.user!.user_id;

    if (!request_id) {
      return res.status(400).json({ error: 'Request ID is required' });
    }

    if (!req.user!.roles.includes('CLIENT')) {
      return res.status(403).json({ error: 'Only clients can cancel requests' });
    }

    const collection = getSoftwareRequestsCollection();
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(request_id), created_by: new ObjectId(userId), status: 'PENDING' },
      { $set: { status: 'CANCELLED' } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ error: 'Request not found or cannot be cancelled' });
    }

    const requestCode = result.value.request_code;
    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'CANCEL_REQUEST', 'SOFTWARE_REQUEST', request_id, `User ${req.user!.username} cancelled software request ${requestCode}`);

    const io = getIO();
    if (io) {
      io.to('admins').emit('software_request_updated', { request_id, status: 'CANCELLED' });
      io.to(`user_${result.value.created_by?.toString()}`).emit('software_request_updated', { request_id, status: 'CANCELLED' });
    }

    res.json({ status: 'success', message: 'Request cancelled' });
  } catch (error) {
    console.error('Cancel software request error:', error);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

router.get('/export_excel', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user!.roles.includes('IT_ADMIN') && !req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const collection = getSoftwareRequestsCollection();
    const requests = await collection.aggregate([
      {
        $lookup: {
          from: 'users',
          let: { lookupId: '$created_by' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
            { $project: { password: 0 } }
          ],
          as: 'requester'
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { lookupId: '$assigned_to' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
            { $project: { password: 0 } }
          ],
          as: 'assignedProgrammer'
        }
      },
      { $sort: { created_at: -1 } }
    ]).toArray();

    const data = requests.map((r: any) => ({
      'Code': r.request_code,
      'Proposed Title': r.proposed_title,
      'Client/Office': r.client_name_office,
      'Problem': r.statement_of_problem,
      'Objective': r.objective,
      'Status': r.status,
      'Client': r.requester?.[0] ? `${r.requester[0].first_name} ${r.requester[0].last_name}` : '',
      'Programmer': r.assignedProgrammer?.[0] ? `${r.assignedProgrammer[0].first_name} ${r.assignedProgrammer[0].last_name}` : '',
      'Rejection Reason': r.rejection_reason || '',
      'Remarks': r.remarks || '',
      'Created': r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
      'Completed': r.completed_at ? new Date(r.completed_at).toLocaleDateString() : ''
    }));

    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(data);
    const wscols = [
      { wch: 12 }, { wch: 30 }, { wch: 25 }, { wch: 40 },
      { wch: 40 }, { wch: 15 }, { wch: 20 }, { wch: 20 },
      { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 12 }
    ];
    ws['!cols'] = wscols;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Software Requests');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=software_requests.xlsx');
    res.send(buf);
  } catch (error) {
    console.error('Export software excel error:', error);
    res.status(500).json({ error: 'Failed to export' });
  }
});

router.get('/get_programmers', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user!.roles.includes('IT_ADMIN') && !req.user!.roles.includes('ADMIN')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const usersCollection = getUsersCollection();
    const programmers = await usersCollection.find({ roles: 'PROGRAMMER' }).project({ password: 0 }).toArray();
    res.json({ programmers });
  } catch (error) {
    console.error('Get programmers error:', error);
    res.status(500).json({ error: 'Failed to fetch programmers' });
  }
});

export default router;