import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { assignMultimediaSchema, completeMultimediaSchema } from '../middleware/validation';
import { generateRequestCode, logAudit, sanitizeInput, getUsersCollection, isValidObjectId } from '../config/database';
import { getIO } from '../config/socket';
import * as XLSX from 'xlsx';

interface ColumnDef {
  header: string;
  field: string;
  width?: number;
}

interface RouteConfig {
  entity: string;
  prefix: string;
  collectionName: string;
  getCollection: () => any;
  uploadDir: string;
  uploadMethod: 'single' | 'array';
  fileFieldName: string;
  maxFiles?: number;
  allowedMimeTypes: string[];
  initialStatus: string;
  cancelCheckStatusNot: string;
  auditEntityType: string;
  socketPrefix: string;
  hasRecommendation: boolean;
  summaryField: string;
  searchFields: {
    getAll: string[];
    getUnassigned: string[];
    myRequests: string[];
    myHistory: string[];
  };
  createFields: { name: string; required: boolean }[];
  buildCreateDoc: (body: any, userId: ObjectId, requestCode: string, fileData: any) => Record<string, any>;
  excelSheetName: string;
  excelFileName: string;
  excelColumns: ColumnDef[];
  modalFields: { label: string; field: string; date?: boolean }[];
  fileFieldPath: string;
  fileIsArray: boolean;
}

export function createRequestRouter(config: RouteConfig): Router {
  const router = Router();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, `../../${config.uploadDir}`);
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
    if (config.allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Only ${config.allowedMimeTypes.join(', ')} files are allowed`));
    }
  };

  const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
  const uploadMiddleware = config.uploadMethod === 'single'
    ? upload.single(config.fileFieldName)
    : upload.array(config.fileFieldName, config.maxFiles || 10);

  function getUploadedFiles(req: any): any {
    if (config.uploadMethod === 'single') {
      return req.file || null;
    }
    return (req.files as Express.Multer.File[]) || [];
  }

  function moveUploadedFiles(files: any, requestId: string): any {
    const finalDir = path.join(__dirname, `../../${config.uploadDir}/${requestId}`);
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }
    if (config.fileIsArray) {
      const fileArray = files as Express.Multer.File[];
      const savedFiles: string[] = [];
      for (const file of fileArray) {
        const tempPath = file.path;
        const finalPath = path.join(finalDir, file.filename);
        try {
          fs.renameSync(tempPath, finalPath);
          savedFiles.push(file.filename);
        } catch (e) {
          console.error(`Failed to move file ${file.filename}:`, e);
        }
      }
      return savedFiles;
    }
    if (files) {
      const tempPath = files.path;
      const finalPath = path.join(finalDir, files.filename);
      try {
        fs.renameSync(tempPath, finalPath);
      } catch (e) {
        console.error('Failed to move file:', e);
      }
      return files.filename;
    }
    return null;
  }

  // POST /create_request
  router.post('/create_request', isAuthenticated, (req, res, next) => {
    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'File upload failed' });
      }
      next();
    });
  }, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const userId = req.user!.user_id;

      for (const field of config.createFields) {
        if (field.required && !req.body[field.name]) {
          return res.status(400).json({ status: 'error', message: `${field.name} is required` });
        }
      }

      let request_code = '';
      let result: any;
      for (let i = 0; i < 100; i++) {
        request_code = await generateRequestCode(config.prefix, config.collectionName);

        try {
          const fileData = getUploadedFiles(req);
          const doc = config.buildCreateDoc(req.body, new ObjectId(userId), request_code, fileData);
          doc.created_at = new Date();
          doc.completed_at = null;
          result = await collection.insertOne(doc);
          if (fileData && (config.uploadMethod === 'single' ? fileData : fileData.length > 0)) {
            moveUploadedFiles(fileData, result.insertedId.toString());
          }
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

      await logAudit(
        new ObjectId(userId), req.user!.username, req.user!.role,
        'CREATE_REQUEST', config.auditEntityType, result.insertedId.toString(),
        `User ${req.user!.username} created ${config.entity} request ${request_code}`
      );

      const io = getIO();
      if (io) {
        io.emit(`${config.socketPrefix}_created`, {
          request_id: result.insertedId.toString(),
          request_code,
          created_by: userId,
          timestamp: new Date()
        });
        io.to('admins').emit(`${config.socketPrefix}_request_created`, {
          request_id: result.insertedId.toString(),
          request_code,
          created_by: userId,
          timestamp: new Date()
        });
        io.to('multimedia_staff').emit(`${config.socketPrefix}_request_created`, {
          request_id: result.insertedId.toString(),
          request_code,
          created_by: userId,
          timestamp: new Date()
        });
      }

      res.json({ status: 'success', request_code, request_id: result.insertedId });
    } catch (error) {
      console.error(`Create ${config.entity} request error:`, error);
      res.status(500).json({ status: 'error', message: `Failed to create ${config.entity} request` });
    }
  });

  // GET /get_all
  router.get('/get_all', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const search = req.query.search as string | undefined;
      let filter: Record<string, any> = {};

      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.getAll.map(f => ({ [f]: regex }));
      }

      const requests = await collection.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'users',
            localField: 'assigned_to',
            foreignField: '_id',
            as: 'assignedTechnician'
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'created_by',
            foreignField: '_id',
            as: 'requester'
          }
        },
        { $sort: { created_at: -1 } }
      ]).toArray();

      res.json({ requests });
    } catch (error) {
      console.error(`Get all ${config.entity} requests error:`, error);
      res.status(500).json({ error: 'Failed to fetch requests' });
    }
  });

  // GET /get_unassigned
  router.get('/get_unassigned', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const filter: Record<string, any> = config.initialStatus === 'UNASSIGNED'
        ? { status: 'UNASSIGNED' }
        : { status: 'PENDING', assigned_to: null };

      const search = req.query.search as string | undefined;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.getUnassigned.map(f => ({ [f]: regex }));
      }

      const requests = await collection.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'users',
            localField: 'created_by',
            foreignField: '_id',
            as: 'requester'
          }
        },
        { $unwind: { path: '$requester', preserveNullAndEmptyArrays: true } },
        { $sort: { created_at: -1 } }
      ]).toArray();

      const formatted = requests.map((r: any) => ({
        _id: r._id?.toString(),
        request_code: r.request_code,
        status: r.status,
        created_at: r.created_at,
        requester: r.requester ? `${r.requester.first_name} ${r.requester.last_name}` : null,
        summary: r[config.summaryField] || ''
      }));

      res.json({ requests: formatted });
    } catch (error) {
      console.error(`Get unassigned ${config.entity} requests error:`, error);
      res.status(500).json({ error: 'Failed to fetch requests' });
    }
  });

  // POST /assign
  router.post('/assign', isAuthenticated, isAdmin, validateBody(assignMultimediaSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id, technician_id } = req.body;
      const collection = config.getCollection();
      const usersCollection = getUsersCollection();

      const technician = await usersCollection.findOne({ _id: new ObjectId(technician_id), role: 'MULTIMEDIA' });
      if (!technician) {
        return res.status(404).json({ error: 'Technician not found' });
      }

      const request = await collection.findOne({ _id: new ObjectId(request_id) });
      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }

      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id) },
        { $set: { assigned_to: new ObjectId(technician_id), status: 'IN_PROGRESS' } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: 'Failed to assign request' });
      }

      const requestCode = result.value.request_code || 'unknown';
      const assignedTo = `${technician.first_name} ${technician.last_name}`;
      await logAudit(
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.role,
        'ASSIGN_REQUEST', config.auditEntityType, request_id,
        `Admin ${req.user!.username} assigned ${config.entity} request ${requestCode} to ${assignedTo}`
      );

      const io = getIO();
      if (io) {
        io.to(`user_${result.value.created_by?.toString()}`).emit(`${config.socketPrefix}_request_assigned`, {
          request_id,
          request_code: requestCode,
          assigned_to: technician_id,
          [config.summaryField]: result.value[config.summaryField]
        });
        io.to(`user_${technician_id}`).emit(`${config.socketPrefix}_request_assigned`, {
          request_id,
          request_code: requestCode,
          assigned_to: technician_id,
          [config.summaryField]: result.value[config.summaryField]
        });
      }

      res.json({ status: 'success' });
    } catch (error) {
      console.error(`Assign ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to assign request' });
    }
  });

  // GET /my_requests
  router.get('/my_requests', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const userId = new ObjectId(req.user!.user_id);

      let filter: Record<string, any> = { assigned_to: userId };
      const search = req.query.search as string | undefined;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.myRequests.map(f => ({ [f]: regex }));
      }

      const requests = await collection.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'users',
            localField: 'created_by',
            foreignField: '_id',
            as: 'requester'
          }
        },
        { $unwind: { path: '$requester', preserveNullAndEmptyArrays: true } },
        { $sort: { created_at: -1 } }
      ]).toArray();

      res.json({ requests });
    } catch (error) {
      console.error(`My ${config.entity} requests error:`, error);
      res.status(500).json({ error: 'Failed to fetch requests' });
    }
  });

  // POST /complete_request
  router.post('/complete_request', isAuthenticated, validateBody(completeMultimediaSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id, remarks, recommendation } = req.body;
      const collection = config.getCollection();
      const userId = new ObjectId(req.user!.user_id);

      const filter: Record<string, any> = {
        _id: new ObjectId(request_id),
        assigned_to: userId
      };

      const updateDoc: Record<string, any> = {
        $set: { status: 'DONE', remarks: remarks || null, completed_at: new Date() }
      };
      if (config.hasRecommendation) {
        updateDoc.$set.recommendation = recommendation || null;
      }

      const result = await collection.findOneAndUpdate(filter, updateDoc, { returnDocument: 'after' });
      if (!result || !result.value) {
        return res.status(404).json({ error: 'Request not found or not assigned to you' });
      }

      const requestCode = result.value.request_code || 'unknown';
      await logAudit(
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.role,
        'COMPLETE_REQUEST', config.auditEntityType, request_id,
        `Multimedia staff ${req.user!.username} completed ${config.entity} request ${requestCode}`,
        { remarks: remarks || null, ...(config.hasRecommendation ? { recommendation: recommendation || null } : {}) }
      );

      const io = getIO();
      if (io) {
        io.to(`user_${result.value.created_by?.toString()}`).emit(`${config.socketPrefix}_request_completed`, {
          request_id,
          request_code: requestCode,
          status: 'DONE'
        });
      }

      res.json({ status: 'success' });
    } catch (error) {
      console.error(`Complete ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to complete request' });
    }
  });

  // GET /my_history
  router.get('/my_history', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const userId = new ObjectId(req.user!.user_id);

      let filter: Record<string, any> = { created_by: userId };
      const search = req.query.search as string | undefined;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.myHistory.map(f => ({ [f]: regex }));
      }

      const requests = await collection.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'users',
            localField: 'assigned_to',
            foreignField: '_id',
            as: 'assignedTechnician'
          }
        },
        { $sort: { created_at: -1 } }
      ]).toArray();

      res.json({ requests });
    } catch (error) {
      console.error(`My ${config.entity} history error:`, error);
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  });

  // GET /get_request/:request_id
  router.get('/get_request/:request_id', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id } = req.params;
      if (!isValidObjectId(request_id)) {
        return res.status(400).json({ error: 'Invalid request ID' });
      }

      const collection = config.getCollection();
      const request = await collection.findOne({ _id: new ObjectId(request_id) });
      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }

      res.json({ request });
    } catch (error) {
      console.error(`Get ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to fetch request' });
    }
  });

  // POST /cancel_request
  router.post('/cancel_request', isAuthenticated, validateBody(assignMultimediaSchema.pick({ request_id: true })), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id } = req.body;
      const user_id = req.user!.user_id;
      const role = req.user!.role;

      const collection = config.getCollection();
      const request = await collection.findOne({ _id: new ObjectId(request_id) });
      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }

      const isOwner = request.created_by?.toString() === user_id;
      const isStaff = role === 'ADMIN' || role === 'MULTIMEDIA';

      if (!isOwner && !isStaff) {
        return res.status(403).json({ error: 'Not authorized to cancel this request' });
      }

      const statusCheck: Record<string, any> = config.cancelCheckStatusNot === 'UNASSIGNED'
        ? { status: 'UNASSIGNED' }
        : { status: 'PENDING' };

      if (isOwner && !isStaff && request.status !== statusCheck.status) {
        return res.status(400).json({ error: `Only ${statusCheck.status} requests can be cancelled` });
      }

      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: { $nin: ['DONE', 'CANCELLED'] } },
        { $set: { status: 'CANCELLED' } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: 'Request cannot be cancelled' });
      }

      const requestCode = result.value.request_code || 'unknown';
      await logAudit(
        new ObjectId(user_id), req.user!.username, req.user!.role,
        'CANCEL_REQUEST', config.auditEntityType, request_id,
        `${role} ${req.user!.username} cancelled ${config.entity} request ${requestCode}`
      );

      const io = getIO();
      if (io) {
        io.emit(`${config.socketPrefix}_request_cancelled`, {
          request_id,
          request_code: requestCode,
          status: 'CANCELLED'
        });
      }

      res.json({ status: 'success' });
    } catch (error) {
      console.error(`Cancel ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to cancel request' });
    }
  });

  // GET /get_technicians
  router.get('/get_technicians', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const usersCollection = getUsersCollection();
      const technicians = await usersCollection.find({ role: 'MULTIMEDIA' }).toArray();
      res.json({ technicians });
    } catch (error) {
      console.error('Get technicians error:', error);
      res.status(500).json({ error: 'Failed to fetch technicians' });
    }
  });

  // GET /export_excel
  router.get('/export_excel', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const userId = new ObjectId(req.user!.user_id);
      const requests = await collection.aggregate([
        { $match: { created_by: userId } },
        {
          $lookup: {
            from: 'users',
            localField: 'assigned_to',
            foreignField: '_id',
            as: 'assignedTechnician'
          }
        },
        { $sort: { created_at: -1 } }
      ]).toArray();

      const data = requests.map((r: any) => {
        const row: Record<string, any> = {};
        for (const col of config.excelColumns) {
          if (col.field === 'status') {
            row[col.header] = r.status || '';
          } else if (col.field === 'request_code') {
            row[col.header] = r.request_code;
          } else if (col.field === 'assigned_to') {
            row[col.header] = r.assignedTechnician?.[0]
              ? `${r.assignedTechnician[0].first_name} ${r.assignedTechnician[0].last_name}`
              : '';
          } else if (col.field === 'date') {
            row[col.header] = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
          } else {
            row[col.header] = r[col.field] || '';
          }
        }
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wscols = config.excelColumns.map(c => ({ wch: c.width || 20 }));
      ws['!cols'] = wscols;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, config.excelSheetName);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${config.excelFileName}`);
      res.send(buf);
    } catch (error) {
      console.error(`Export ${config.entity} excel error:`, error);
      res.status(500).json({ error: 'Failed to export' });
    }
  });

  return router;
}
