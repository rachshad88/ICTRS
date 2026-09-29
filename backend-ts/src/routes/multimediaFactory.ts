import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest, isAuthenticated, isMultimediaAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { assignMultimediaSchema, assignWithPrioritySchema, completeMultimediaSchema, declineRequestSchema, addNoteSchema, reassignRequestSchema, setPrioritySchema } from '../middleware/validation';
import { normalizePriority, priorityExpr, overdueExpr, toDay } from '../utils/priority';
import { formatDateTime } from '../utils/dates';
import { generateRequestCode, logAudit, sanitizeInput, getUsersCollection, isValidObjectId } from '../config/database';
import { getIO } from '../config/socket';
import * as XLSX from 'xlsx';
import { ZodIssue, ZodTypeAny } from 'zod';
import { validateFileMagicBytes, mimeTypeForFilename, extensionsForMimeTypes } from '../utils/fileValidation';

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
  // Event or target date; a request past it and still open is flagged overdue.
  dueField: string;
  searchFields: {
    getAll: string[];
    getUnassigned: string[];
    myRequests: string[];
    myHistory: string[];
  };
  // Validates the submitted form fields (multipart body) before anything is saved.
  createSchema: ZodTypeAny;
  buildCreateDoc: (body: any, userId: ObjectId, requestCode: string, fileData: any) => Record<string, any>;
  excelSheetName: string;
  excelFileName: string;
  excelColumns: ColumnDef[];
  modalFields: { label: string; field: string; date?: boolean }[];
  fileFieldPath: string;
  fileIsArray: boolean;
}

const MAX_NOTES_PER_REQUEST = 20;

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

  const allowedExtensions = extensionsForMimeTypes(config.allowedMimeTypes);

  const fileFilter = (req: any, file: Express.Multer.File, cb: FileFilterCallback) => {
    const mimeType = mimeTypeForFilename(file.originalname);
    if (mimeType && config.allowedMimeTypes.includes(mimeType)) {
      cb(null, true);
    } else {
      cb(new Error(`"${file.originalname}" is not an allowed file type. Allowed: ${allowedExtensions.join(', ')}`));
    }
  };

  const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
  const uploadMiddleware = config.uploadMethod === 'single'
    ? upload.single(config.fileFieldName)
    : upload.array(config.fileFieldName, config.maxFiles || 10);

  function getPaginationParams(query: any): { page: number; limit: number; skip: number } {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 10));
    return { page, limit, skip: (page - 1) * limit };
  }

  async function paginatedAggregate(
    collection: any,
    pipeline: any[],
    page: number,
    limit: number,
    skip: number
  ): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number }> {
    const results = await collection.aggregate([
      ...pipeline,
      { $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }]
      }}
    ]).toArray();
    const total = results[0]?.metadata?.[0]?.total || 0;
    return {
      data: results[0]?.data || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  const priorityFields = {
    $addFields: { priority: priorityExpr(), overdue: overdueExpr(`$${config.dueField}`) }
  };

  function getUploadedFiles(req: any): any {
    if (config.uploadMethod === 'single') {
      return req.file || null;
    }
    return (req.files as Express.Multer.File[]) || [];
  }

  // Deletes this request's uploads from the temporary upload folder. Multer saves files before the
  // form is validated, so every rejected or failed submission must clean up. Files already moved into
  // a request's folder are not affected (their temporary path no longer exists).
  function removeTempUploads(req: any): void {
    const files: Express.Multer.File[] = req.file ? [req.file] : Array.isArray(req.files) ? req.files : [];
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch {}
    }
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

      const parsed = config.createSchema.safeParse(req.body);
      if (!parsed.success) {
        removeTempUploads(req);
        const details = parsed.error.issues.map((i: ZodIssue) => ({ field: i.path.join('.'), message: i.message }));
        return res.status(400).json({ status: 'error', error: details[0].message, details });
      }

      let request_code = '';
      let result: any;
      for (let i = 0; i < 100; i++) {
        request_code = await generateRequestCode(config.prefix, config.collectionName);

        try {
          const fileData = getUploadedFiles(req);

          if (fileData) {
            if (config.uploadMethod === 'single') {
              const f = fileData as Express.Multer.File;
              if (!validateFileMagicBytes(f.path, mimeTypeForFilename(f.originalname) || '')) {
                try { fs.unlinkSync(f.path); } catch {}
                return res.status(400).json({ status: 'error', message: `File ${f.originalname} content does not match its declared type` });
              }
            } else {
              const files = fileData as Express.Multer.File[];
              for (const f of files) {
                if (!validateFileMagicBytes(f.path, mimeTypeForFilename(f.originalname) || '')) {
                  for (const f2 of files) {
                    try { fs.unlinkSync(f2.path); } catch {}
                  }
                  return res.status(400).json({ status: 'error', message: `File ${f.originalname} content does not match its declared type` });
                }
              }
            }
          }

          const storedFile = config.uploadMethod === 'single'
            ? (fileData ? fileData.filename : null)
            : ((fileData as Express.Multer.File[]).length > 0 ? (fileData as Express.Multer.File[]).map(f => f.filename) : []);
          const doc = config.buildCreateDoc(req.body, new ObjectId(userId), request_code, storedFile);
          doc.priority = normalizePriority(req.body.priority);
          doc.created_at = new Date();
          doc.completed_at = null;
          result = await collection.insertOne(doc);
          if (fileData && (config.uploadMethod === 'single' ? fileData : (fileData as Express.Multer.File[]).length > 0)) {
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
        removeTempUploads(req);
        return res.status(500).json({ status: 'error', message: 'Failed to generate unique request code' });
      }

      await logAudit(
        new ObjectId(userId), req.user!.username, req.user!.primary_role,
        'CREATE_REQUEST', config.auditEntityType, result.insertedId.toString(),
        `User ${req.user!.username} created ${config.entity} request ${request_code}`
      );

      const io = getIO();
      if (io) {
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
      removeTempUploads(req);
      res.status(500).json({ status: 'error', message: `Failed to create ${config.entity} request` });
    }
  });

  // GET /get_all
  router.get('/get_all', isAuthenticated, isMultimediaAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const { page, limit, skip } = getPaginationParams(req.query);
      const search = req.query.search as string | undefined;
      let filter: Record<string, any> = {};

      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.getAll.map(f => ({ [f]: regex }));
      }

      const pipeline = [
        { $match: filter },
        priorityFields,
        {
          $lookup: {
            from: 'users',
            let: { lookupId: '$assigned_to' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
              { $project: { password: 0 } }
            ],
            as: 'assignedTechnician'
          }
        },
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

      const result = await paginatedAggregate(collection, pipeline, page, limit, skip);
      res.json({ requests: result.data, total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages });
    } catch (error) {
      console.error(`Get all ${config.entity} requests error:`, error);
      res.status(500).json({ error: 'Failed to fetch requests' });
    }
  });

  // GET /get_unassigned
  router.get('/get_unassigned', isAuthenticated, isMultimediaAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const { page, limit, skip } = getPaginationParams(req.query);
      const filter: Record<string, any> = config.initialStatus === 'UNASSIGNED'
        ? { status: 'UNASSIGNED' }
        : { status: 'PENDING', assigned_to: null };

      const search = req.query.search as string | undefined;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.getUnassigned.map(f => ({ [f]: regex }));
      }

      const pipeline = [
        { $match: filter },
        priorityFields,
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

      const result = await paginatedAggregate(collection, pipeline, page, limit, skip);
      res.json({ requests: result.data, total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages });
    } catch (error) {
      console.error(`Get unassigned ${config.entity} requests error:`, error);
      res.status(500).json({ error: 'Failed to fetch requests' });
    }
  });

  // POST /assign
  router.post('/assign', isAuthenticated, isMultimediaAdmin, validateBody(assignWithPrioritySchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id, technician_id, priority } = req.body;
      const collection = config.getCollection();
      const usersCollection = getUsersCollection();

      const technician = await usersCollection.findOne({ _id: new ObjectId(technician_id), roles: 'MULTIMEDIA' });
      if (!technician) {
        return res.status(404).json({ error: 'Technician not found' });
      }

      const update: Record<string, unknown> = { assigned_to: new ObjectId(technician_id), status: 'IN_PROGRESS' };
      if (priority !== undefined) update.priority = normalizePriority(priority);

      // Only requests still waiting for assignment; moving an in-progress one goes through /reassign,
      // which records who it was taken from.
      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: config.initialStatus, assigned_to: null },
        { $set: update },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: 'This request is no longer waiting to be assigned. Refresh the list.' });
      }

      const requestCode = result.value.request_code || 'unknown';
      const assignedTo = `${technician.first_name} ${technician.last_name}`;
      await logAudit(
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
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
        io.to('admins').emit(`${config.socketPrefix}_request_assigned_admin`, {
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

  // POST /reassign
  router.post('/reassign', isAuthenticated, isMultimediaAdmin, validateBody(reassignRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id, technician_id } = req.body;
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
      const collection = config.getCollection();

      const technician = await getUsersCollection().findOne({ _id: new ObjectId(technician_id), roles: 'MULTIMEDIA' });
      if (!technician) {
        return res.status(404).json({ error: 'Staff member not found' });
      }

      const newTechId = new ObjectId(technician_id);
      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: 'IN_PROGRESS', assigned_to: { $ne: newTechId } },
        { $set: { assigned_to: newTechId } },
        { returnDocument: 'before' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: 'Request is not in progress or is already assigned to this staff member' });
      }

      const previousTechId = result.value.assigned_to?.toString() || null;
      const requestCode = result.value.request_code || 'unknown';
      const assignedTo = `${technician.first_name} ${technician.last_name}`;
      await logAudit(
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
        'REASSIGN_REQUEST', config.auditEntityType, request_id,
        `Admin ${req.user!.username} reassigned ${config.entity} request ${requestCode} to ${assignedTo}${reason ? `: ${reason}` : ''}`,
        { from: previousTechId, to: technician_id, reason: reason || null }
      );

      const io = getIO();
      if (io) {
        const payload = {
          request_id,
          request_code: requestCode,
          assigned_to: technician_id,
          [config.summaryField]: result.value[config.summaryField]
        };
        io.to(`user_${technician_id}`).emit(`${config.socketPrefix}_request_assigned`, payload);
        if (previousTechId) {
          io.to(`user_${previousTechId}`).emit(`${config.socketPrefix}_request_reassigned`, payload);
        }
        io.to(`user_${result.value.created_by?.toString()}`).emit(`${config.socketPrefix}_request_reassigned`, payload);
        io.to('admins').emit(`${config.socketPrefix}_request_assigned_admin`, payload);
      }

      res.json({ status: 'success' });
    } catch (error) {
      console.error(`Reassign ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to reassign request' });
    }
  });

  // POST /set_priority
  router.post('/set_priority', isAuthenticated, isMultimediaAdmin, validateBody(setPrioritySchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id } = req.body;
      const priority = normalizePriority(req.body.priority);
      const collection = config.getCollection();

      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: { $in: [config.initialStatus, 'IN_PROGRESS'] } },
        { $set: { priority } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: 'Only open requests can be reprioritized' });
      }

      const requestCode = result.value.request_code || 'unknown';
      await logAudit(
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
        'SET_PRIORITY', config.auditEntityType, request_id,
        `Admin ${req.user!.username} set ${config.entity} request ${requestCode} to ${priority}`,
        { priority }
      );

      const io = getIO();
      if (io) {
        const payload = { request_id, request_code: requestCode, priority };
        io.to('admins').emit(`${config.socketPrefix}_request_priority_changed`, payload);
        if (result.value.assigned_to) {
          io.to(`user_${result.value.assigned_to.toString()}`).emit(`${config.socketPrefix}_request_priority_changed`, payload);
        }
      }

      res.json({ status: 'success' });
    } catch (error) {
      console.error(`Set ${config.entity} priority error:`, error);
      res.status(500).json({ error: 'Failed to update priority' });
    }
  });

  // GET /my_requests
  router.get('/my_requests', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const collection = config.getCollection();
      const { page, limit, skip } = getPaginationParams(req.query);
      const userId = new ObjectId(req.user!.user_id);

      let filter: Record<string, any> = { assigned_to: userId };
      const search = req.query.search as string | undefined;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.myRequests.map(f => ({ [f]: regex }));
      }

      const pipeline = [
        { $match: filter },
        priorityFields,
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

      const result = await paginatedAggregate(collection, pipeline, page, limit, skip);
      res.json({ requests: result.data, total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages });
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

      // Only work in progress can be completed; completing again would overwrite the remarks and date.
      const filter: Record<string, any> = {
        _id: new ObjectId(request_id),
        assigned_to: userId,
        status: 'IN_PROGRESS'
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
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
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
        io.to('admins').emit(`${config.socketPrefix}_request_completed`, {
          request_id,
          request_code: requestCode,
          status: 'DONE'
        });
        io.to('multimedia_staff').emit(`${config.socketPrefix}_request_completed`, {
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
      const { page, limit, skip } = getPaginationParams(req.query);
      const userId = new ObjectId(req.user!.user_id);

      let filter: Record<string, any> = { created_by: userId };
      const search = req.query.search as string | undefined;
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = { $regex: escaped, $options: 'i' };
        filter.$or = config.searchFields.myHistory.map(f => ({ [f]: regex }));
      }

      const pipeline = [
        { $match: filter },
        {
          $lookup: {
            from: 'users',
            let: { lookupId: '$assigned_to' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
              { $project: { password: 0 } }
            ],
            as: 'assignedTechnician'
          }
        },
        { $sort: { created_at: -1 } }
      ];

      const result = await paginatedAggregate(collection, pipeline, page, limit, skip);
      res.json({ requests: result.data, total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages });
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

      // Admins can open any request; others only ones they filed or are assigned to.
      const roles = req.user!.roles;
      const uid = new ObjectId(req.user!.user_id);
      const filter: Record<string, unknown> = { _id: new ObjectId(request_id) };
      if (!roles.includes('ADMIN') && !roles.includes('MULTIMEDIA_ADMIN')) {
        filter.$or = [{ created_by: uid }, { assigned_to: uid }];
      }

      const collection = config.getCollection();
      const request = await collection.findOne(filter);
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
      const roles = req.user!.roles;

      const collection = config.getCollection();
      const request = await collection.findOne({ _id: new ObjectId(request_id) });
      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }

      // Admins can cancel any open request. Otherwise the owner can cancel before it is assigned,
      // and a staff member can cancel only a request assigned to them.
      const uid = new ObjectId(user_id);
      const isAdmin = roles.includes('ADMIN') || roles.includes('MULTIMEDIA_ADMIN');
      const isOwner = request.created_by?.toString() === user_id;
      const isAssignee = roles.includes('MULTIMEDIA') && request.assigned_to?.toString() === user_id;

      if (!isAdmin && !isOwner && !isAssignee) {
        return res.status(403).json({ error: 'Not authorized to cancel this request' });
      }

      const ownerStatus = config.cancelCheckStatusNot;
      if (!isAdmin && !isAssignee && request.status !== ownerStatus) {
        return res.status(400).json({ error: `Only ${ownerStatus} requests can be cancelled` });
      }

      const filter: Record<string, any> = { _id: new ObjectId(request_id) };
      if (isAdmin) {
        filter.status = { $nin: ['DONE', 'CANCELLED', 'DECLINED'] };
      } else {
        filter.$or = [
          ...(isOwner ? [{ created_by: uid, status: ownerStatus }] : []),
          ...(isAssignee ? [{ assigned_to: uid, status: 'IN_PROGRESS' }] : [])
        ];
      }

      const result = await collection.findOneAndUpdate(
        filter,
        { $set: { status: 'CANCELLED' } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: 'Request cannot be cancelled' });
      }

      const requestCode = result.value.request_code || 'unknown';
      await logAudit(
        new ObjectId(user_id), req.user!.username, req.user!.primary_role,
        'CANCEL_REQUEST', config.auditEntityType, request_id,
        `${req.user!.primary_role} ${req.user!.username} cancelled ${config.entity} request ${requestCode}`
      );

      const io = getIO();
      if (io) {
        io.to(['admins', 'multimedia_staff', `user_${result.value.created_by?.toString()}`]).emit(`${config.socketPrefix}_request_cancelled`, {
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

  // POST /decline
  router.post('/decline', isAuthenticated, isMultimediaAdmin, validateBody(declineRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id } = req.body;
      const reason = String(req.body.reason).trim();
      const collection = config.getCollection();

      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(request_id), status: config.initialStatus, assigned_to: null },
        { $set: { status: 'DECLINED', decline_reason: reason, declined_by: new ObjectId(req.user!.user_id), declined_at: new Date() } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(404).json({ error: 'Request not found or already assigned' });
      }

      const requestCode = result.value.request_code || 'unknown';
      await logAudit(
        new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
        'DECLINE_REQUEST', config.auditEntityType, request_id,
        `Admin ${req.user!.username} declined ${config.entity} request ${requestCode}: ${reason}`,
        { reason }
      );

      const io = getIO();
      if (io) {
        const payload = { request_id, request_code: requestCode, status: 'DECLINED', reason };
        io.to(`user_${result.value.created_by?.toString()}`).emit(`${config.socketPrefix}_request_declined`, payload);
        io.to('admins').emit(`${config.socketPrefix}_request_declined`, payload);
        io.to('multimedia_staff').emit(`${config.socketPrefix}_request_declined`, payload);
      }

      res.json({ status: 'success' });
    } catch (error) {
      console.error(`Decline ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to decline request' });
    }
  });

  // POST /add_note
  router.post('/add_note', isAuthenticated, validateBody(addNoteSchema), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { request_id } = req.body;
      const userId = req.user!.user_id;
      const note = {
        _id: new ObjectId(),
        text: String(req.body.text).trim(),
        author_id: new ObjectId(userId),
        author_name: `${req.user!.first_name} ${req.user!.last_name}`.trim() || req.user!.username,
        created_at: new Date()
      };
      const collection = config.getCollection();

      const result = await collection.findOneAndUpdate(
        {
          _id: new ObjectId(request_id),
          created_by: new ObjectId(userId),
          status: { $in: [config.initialStatus, 'IN_PROGRESS'] },
          [`notes.${MAX_NOTES_PER_REQUEST - 1}`]: { $exists: false }
        },
        { $push: { notes: note } },
        { returnDocument: 'after' }
      );

      if (!result || !result.value) {
        return res.status(400).json({ error: `Notes can only be added to your own open requests (up to ${MAX_NOTES_PER_REQUEST} per request)` });
      }

      const requestCode = result.value.request_code || 'unknown';
      await logAudit(
        new ObjectId(userId), req.user!.username, req.user!.primary_role,
        'ADD_NOTE', config.auditEntityType, request_id,
        `User ${req.user!.username} added a note to ${config.entity} request ${requestCode}`
      );

      const io = getIO();
      if (io) {
        const payload = { request_id, request_code: requestCode };
        if (result.value.assigned_to) {
          io.to(`user_${result.value.assigned_to.toString()}`).emit(`${config.socketPrefix}_request_note_added`, payload);
        }
        io.to('admins').emit(`${config.socketPrefix}_request_note_added`, payload);
      }

      res.json({ status: 'success', note });
    } catch (error) {
      console.error(`Add note to ${config.entity} request error:`, error);
      res.status(500).json({ error: 'Failed to add note' });
    }
  });

  // GET /get_technicians
  router.get('/get_technicians', isAuthenticated, isMultimediaAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const usersCollection = getUsersCollection();
      const technicians = await usersCollection.find({ roles: 'MULTIMEDIA' }).project({ password: 0 }).toArray();
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
            let: { lookupId: '$assigned_to' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', { $convert: { input: '$$lookupId', to: 'objectId', onError: null, onNull: null } }] } } },
              { $project: { password: 0 } }
            ],
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
            row[col.header] = r.created_at ? formatDateTime(r.created_at).slice(0, 10) : '';
          } else if (r[col.field] instanceof Date) {
            // Event and target dates are stored as midnight UTC calendar days.
            row[col.header] = toDay(r[col.field]) || '';
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
