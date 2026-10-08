import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { Server } from 'socket.io';
import { getRequestsCollection, getUsersCollection, generateRequestCode, logAudit, sanitizeInput } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isTechnicianOrAdmin, isItAdmin, isItAdminOrTechnician } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createRequestSchema, acceptRequestSchema, finishRequestSchema, cancelRequestSchema, sharedAccessSchema, declineRequestSchema, addNoteSchema, reassignRequestSchema, setPrioritySchema } from '../middleware/validation';
import { formatDateTime, todayString, semesterFor } from '../utils/dates';
import { normalizePriority, parseDueDate, isOverdue, overdueExpr, toDay, OPEN_STATUSES } from '../utils/priority';
import { liveRequestAdded, liveRequestChanged, liveRequestRemoved } from './live';
import { notify } from '../utils/notify';
import { syncRatingStatus, ratingTypeFor } from '../utils/ratingSync';

// Where each kind of recipient follows up on an IT request.
const OWNER_PAGE = '/requested';
const TECH_PAGE = '/dashboard';
const IT_ADMIN_PAGE = '/it-dashboard';

// IT requests can go to a technician, or the IT admin making the change can take it themselves.
function findAssignableStaff(staffId: string, actor: AuthenticatedRequest['user']) {
  const filter = staffId === actor!.user_id
    ? { _id: new ObjectId(staffId) }
    : { _id: new ObjectId(staffId), roles: 'TECHNICIAN' as const };
  return getUsersCollection().findOne(filter);
}

function clip(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const router = Router();

// IT request events go to IT staff, the super admin and the request's owner, never to every socket
// (and not to multimedia admins, who only handle media requests).
function itAudience(io: Server, ownerId?: string) {
  return io.to(['technicians', 'super_admins', ...(ownerId ? [`user_${ownerId}`] : [])]);
}

router.post('/send_request', isAuthenticated, validateBody(createRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { unit, unit_other, issue } = req.body;
    // "Others" is saved together with what the requester typed, e.g. "others: printer".
    const unitLabel = unit === 'others' ? `others: ${String(unit_other).trim()}` : unit;
    const created_by = req.user!.user_id;

    // Filed under the requester's own office (read fresh, in case an admin changed it), never one from the form.
    const requester = await getUsersCollection().findOne({ _id: new ObjectId(created_by) }, { projection: { office: 1 } });
    const office = requester?.office?.trim();
    if (!office) {
      return res.status(400).json({ status: 'error', message: 'Your account has no office yet. Set it in your profile before submitting.' });
    }

    const requestsCollection = getRequestsCollection();

    let result;
    let request_code;
    // The semester follows the submission date rather than anything the requester picks.
    const created_at = new Date();

    for (let i = 0; i < 100; i++) {
      request_code = await generateRequestCode('IT', 'it_requests');

      try {
        result = await requestsCollection.insertOne({
          request_code,
          created_by: new ObjectId(created_by),
          office: sanitizeInput(office),
          unit: sanitizeInput(unitLabel || ''),
          semester: semesterFor(created_at),
          issue: sanitizeInput(issue),
          priority: normalizePriority(req.body.priority),
          due_date: null,
          status: 'PENDING',
          assigned_to: null,
          finished: null,
          remarks: null,
          recommendation: null,
          created_at,
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

    void syncRatingStatus('requests', result.insertedId);

    await logAudit(new ObjectId(created_by), req.user!.username, req.user!.primary_role, 'CREATE_REQUEST', 'IT_REQUEST', result.insertedId.toString(), `User ${req.user!.username} created IT request ${request_code}`, { office, issue: sanitizeInput(issue) });

    const io = req.app.get('io');
    if (io) {
      itAudience(io, created_by).emit('request_update', {
        event: 'created',
        request_id: result.insertedId.toString(),
        request_code,
        created_by,
        office: sanitizeInput(office),
        issue: sanitizeInput(issue),
        timestamp: new Date()
      });
    }
    liveRequestAdded('it', result.insertedId);
    notify({ roles: ['IT_ADMIN'] }, {
      level: 'info', title: 'New IT request', request_code, link: IT_ADMIN_PAGE,
      message: `${request_code} from ${office}: ${clip(String(issue).trim())}`,
    }, created_by);

    res.json({ status: 'success', request_code });
  } catch (error) {
    console.error('Request creation error:', error);
    res.status(500).json({ status: 'error', message: 'An error occurred while creating your request' });
  }
});

router.post('/accept_request', isAuthenticated, isItAdmin, validateBody(acceptRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, technician_id, priority, due_date } = req.body;

    if (!request_id || !technician_id) {
      return res.status(400).json({ status: 'error', message: 'Request ID and technician ID required' });
    }

    const technician = await findAssignableStaff(technician_id, req.user);
    if (!technician) {
      return res.status(404).json({ error: 'Technician not found' });
    }

    // Priority and due date are optional here; leave them untouched when not sent.
    const update: Record<string, unknown> = { status: 'IN_PROGRESS', assigned_to: new ObjectId(technician_id) };
    if (priority !== undefined) update.priority = normalizePriority(priority);
    if (due_date !== undefined) update.due_date = parseDueDate(due_date);

    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      { _id: new ObjectId(request_id), status: 'PENDING' },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found or already accepted' });
    }

    void syncRatingStatus('requests', result.value._id);

    const assignedTo = `${technician.first_name} ${technician.last_name}`;
    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'ACCEPT_REQUEST', 'IT_REQUEST', request_id, technician_id === req.user!.user_id
      ? `IT Admin ${req.user!.username} took request ${result.value.request_code}`
      : `IT Admin ${req.user!.username} assigned request to ${assignedTo}`);

    const io = req.app.get('io');
    if (io) {
      itAudience(io, result.value.created_by?.toString()).emit('request_update', {
        event: 'accepted',
        request_id,
        request_code: result.value.request_code,
        assigned_to: technician_id,
        status: 'IN_PROGRESS',
        timestamp: new Date()
      });
      io.to(`user_${result.value?.created_by?.toString()}`).emit('my_request_accepted', {
        request_id,
        request_code: result.value.request_code,
        assigned_to: technician_id
      });
      io.to(`user_${technician_id}`).emit('request_assigned_to_you', {
        request_id,
        request_code: result.value.request_code
      });
    }
    liveRequestRemoved('it', request_id, 'ACCEPTED', assignedTo);
    notify(result.value.created_by, {
      level: 'success', title: 'Request accepted', request_code: result.value.request_code, link: OWNER_PAGE,
      message: `${result.value.request_code} was assigned to ${assignedTo}.`,
    }, req.user!.user_id);
    notify(technician_id, {
      level: 'info', title: 'Assigned to you', request_code: result.value.request_code, link: TECH_PAGE,
      message: `IT request ${result.value.request_code} is now yours.`,
    }, req.user!.user_id);

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept request' });
  }
});

router.post('/reassign', isAuthenticated, isItAdmin, validateBody(reassignRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, technician_id } = req.body;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    const technician = await findAssignableStaff(technician_id, req.user);
    if (!technician) {
      return res.status(404).json({ status: 'error', message: 'Technician not found' });
    }

    const newTechId = new ObjectId(technician_id);
    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      { _id: new ObjectId(request_id), status: 'IN_PROGRESS', assigned_to: { $ne: newTechId } },
      { $set: { assigned_to: newTechId } },
      { returnDocument: 'before' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request is not in progress or is already assigned to this technician' });
    }

    const previousTechId = result.value.assigned_to?.toString() || null;
    const requestCode = result.value.request_code || 'unknown';
    const assignedTo = `${technician.first_name} ${technician.last_name}`;
    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'REASSIGN_REQUEST', 'IT_REQUEST', request_id,
      `IT Admin ${req.user!.username} reassigned request ${requestCode} to ${assignedTo}${reason ? `: ${reason}` : ''}`,
      { from: previousTechId, to: technician_id, reason: reason || null });

    const io = req.app.get('io');
    if (io) {
      itAudience(io, result.value.created_by?.toString()).emit('request_update', { event: 'reassigned', request_id, request_code: requestCode, assigned_to: technician_id, timestamp: new Date() });
      io.to(`user_${technician_id}`).emit('request_assigned_to_you', { request_id, request_code: requestCode });
      if (previousTechId) {
        io.to(`user_${previousTechId}`).emit('request_reassigned_from_you', { request_id, request_code: requestCode });
      }
    }
    const actorId = req.user!.user_id;
    notify(technician_id, {
      level: 'info', title: 'Assigned to you', request_code: requestCode, link: TECH_PAGE,
      message: `IT request ${requestCode} was reassigned to you.`,
    }, actorId);
    notify(previousTechId, {
      level: 'info', title: 'Request reassigned', request_code: requestCode, link: TECH_PAGE,
      message: `${requestCode} was moved to ${assignedTo}.`,
    }, actorId);
    notify(result.value.created_by, {
      level: 'info', title: 'Technician changed', request_code: requestCode, link: OWNER_PAGE,
      message: `${requestCode} is now handled by ${assignedTo}.`,
    }, actorId);

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Reassign request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reassign request' });
  }
});

router.post('/set_priority', isAuthenticated, isItAdmin, validateBody(setPrioritySchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, due_date } = req.body;
    const priority = normalizePriority(req.body.priority);
    const update: Record<string, unknown> = { priority };
    if (due_date !== undefined) update.due_date = parseDueDate(due_date);

    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      { _id: new ObjectId(request_id), status: { $in: ['PENDING', 'IN_PROGRESS'] } },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Only open requests can be reprioritized' });
    }

    const requestCode = result.value.request_code || 'unknown';
    const dueDay = toDay(result.value.due_date);
    const dueText = dueDay ? `, due ${dueDay}` : '';
    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'SET_PRIORITY', 'IT_REQUEST', request_id,
      `IT Admin ${req.user!.username} set request ${requestCode} to ${priority}${dueText}`,
      { priority, due_date: result.value.due_date || null });

    const io = req.app.get('io');
    if (io) {
      io.to('technicians').emit('request_update', { event: 'priority_changed', request_id, request_code: requestCode, timestamp: new Date() });
    }
    liveRequestChanged('it', result.value);
    notify(result.value.assigned_to, {
      level: priority === 'URGENT' ? 'warning' : 'info', title: 'Priority changed', request_code: requestCode, link: TECH_PAGE,
      message: `${requestCode} is now ${priority.toLowerCase()} priority${dueText}.`,
    }, req.user!.user_id);

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Set priority error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update priority' });
  }
});

router.post('/request_finish', isAuthenticated, isItAdminOrTechnician, validateBody(finishRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id, finished, remarks, recommendation } = req.body;

    if (!request_id || !finished) {
      return res.status(400).json({ status: 'error', message: 'Required fields missing' });
    }

    const requestsCollection = getRequestsCollection();
    const userId = req.user!.user_id;

    let filter: Record<string, unknown>;
    if (req.user!.roles.includes('ADMIN')) {
      filter = { _id: new ObjectId(request_id), status: { $nin: ['DONE', 'CANCELLED', 'DECLINED'] } };
    } else if (req.user!.roles.includes('TECHNICIAN') || req.user!.roles.includes('IT_ADMIN')) {
      // Technicians and IT admins can only finish requests assigned to them
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

    void syncRatingStatus('requests', result.value._id);

    const requestCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'FINISH_REQUEST', 'IT_REQUEST', request_id, `${req.user!.roles.includes('ADMIN') ? 'Admin' : req.user!.roles.includes('TECHNICIAN') ? 'Technician' : 'IT Admin'} ${req.user!.username} marked request ${requestCode} as ${finished}`, { finished, remarks: remarks || null, recommendation: recommendation || null });

    const io = req.app.get('io');
    if (io) {
      itAudience(io, result.value.created_by?.toString()).emit('request_update', {
        event: 'finished',
        request_id,
        request_code: requestCode,
        status: 'DONE',
        timestamp: new Date()
      });
      io.to(`user_${result.value?.created_by?.toString()}`).emit('my_request_finished', { request_id, request_code: requestCode });
    }
    notify(result.value.created_by, {
      level: 'success', title: 'Request completed', request_code: requestCode, link: OWNER_PAGE,
      message: `${requestCode} is done (${finished}).`,
      rate: { request_id: result.value._id!.toString(), type: ratingTypeFor('requests')! },
    }, userId);

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
    
    // IT admins can cancel any open request. Otherwise the owner can cancel while it is still pending,
    // and a technician can cancel only a request assigned to them.
    const roles = req.user!.roles;
    const uid = new ObjectId(user_id);
    const filter: Record<string, unknown> = { _id: new ObjectId(request_id) };
    if (roles.includes('ADMIN') || roles.includes('IT_ADMIN')) {
      filter.status = { $nin: ['DONE', 'CANCELLED', 'DECLINED'] };
    } else {
      filter.$or = [
        { created_by: uid, status: 'PENDING' },
        ...(roles.includes('TECHNICIAN') ? [{ assigned_to: uid, status: 'IN_PROGRESS' }] : [])
      ];
    }

    const result = await requestsCollection.findOneAndUpdate(
      filter,
      { $set: { status: 'CANCELLED', assigned_to: null } },
      // 'before' so the technician who had it can be told.
      { returnDocument: 'before' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found or cannot be cancelled' });
    }

    void syncRatingStatus('requests', result.value._id);

    const cancelledCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(user_id), req.user!.username, req.user!.primary_role, 'CANCEL_REQUEST', 'IT_REQUEST', request_id, `${req.user!.primary_role} ${req.user!.username} cancelled request ${cancelledCode}`);

    const io = req.app.get('io');
    if (io) {
      itAudience(io, result.value.created_by?.toString()).emit('request_update', {
        event: 'cancelled',
        request_id,
        request_code: cancelledCode,
        status: 'CANCELLED',
        timestamp: new Date()
      });
    }
    liveRequestRemoved('it', request_id, 'CANCELLED');
    const cancelledBy = `${req.user!.first_name} ${req.user!.last_name}`.trim() || req.user!.username;
    const cancelled = { level: 'warning' as const, title: 'Request cancelled', request_code: cancelledCode, message: `${cancelledCode} was cancelled by ${cancelledBy}.` };
    notify(result.value.created_by, { ...cancelled, link: OWNER_PAGE }, user_id);
    notify(result.value.assigned_to, { ...cancelled, link: TECH_PAGE }, user_id);
    notify({ roles: ['IT_ADMIN'] }, { ...cancelled, link: IT_ADMIN_PAGE }, user_id);

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to cancel request' });
  }
});

router.post('/decline_request', isAuthenticated, isItAdmin, validateBody(declineRequestSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { request_id } = req.body;
    const reason = String(req.body.reason).trim();

    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      { _id: new ObjectId(request_id), status: 'PENDING', assigned_to: null },
      { $set: { status: 'DECLINED', decline_reason: reason, declined_by: new ObjectId(req.user!.user_id), declined_at: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(404).json({ status: 'error', message: 'Request not found or already assigned' });
    }

    void syncRatingStatus('requests', result.value._id);

    const requestCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'DECLINE_REQUEST', 'IT_REQUEST', request_id, `IT Admin ${req.user!.username} declined request ${requestCode}: ${reason}`, { reason });

    const io = req.app.get('io');
    if (io) {
      // 'technicians' holds IT admins and technicians; the owner is told separately below.
      io.to('technicians').emit('request_update', {
        event: 'declined',
        request_id,
        status: 'DECLINED',
        timestamp: new Date()
      });
      io.to(`user_${result.value.created_by?.toString()}`).emit('my_request_declined', {
        request_id,
        request_code: requestCode,
        reason
      });
    }
    liveRequestRemoved('it', request_id, 'DECLINED');
    notify(result.value.created_by, {
      level: 'warning', title: 'Request declined', request_code: requestCode, link: OWNER_PAGE,
      message: `${requestCode} was declined. Reason: ${reason}`,
    }, req.user!.user_id);

    res.json({ status: 'success' });
  } catch (error) {
    console.error('Decline request error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decline request' });
  }
});

const MAX_NOTES_PER_REQUEST = 20;

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

    const requestsCollection = getRequestsCollection();
    const result = await requestsCollection.findOneAndUpdate(
      {
        _id: new ObjectId(request_id),
        created_by: new ObjectId(userId),
        status: { $in: ['PENDING', 'IN_PROGRESS'] },
        [`notes.${MAX_NOTES_PER_REQUEST - 1}`]: { $exists: false }
      },
      { $push: { notes: note } },
      { returnDocument: 'after' }
    );

    if (!result || !result.value) {
      return res.status(400).json({ status: 'error', message: 'Notes can only be added to your own open requests (up to 20 per request)' });
    }

    const requestCode = result.value.request_code || 'unknown';
    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'ADD_NOTE', 'IT_REQUEST', request_id, `User ${req.user!.username} added a note to request ${requestCode}`);

    const io = req.app.get('io');
    if (io) {
      io.to('technicians').emit('request_update', {
        event: 'note_added',
        request_id,
        timestamp: new Date()
      });
      if (result.value.assigned_to) {
        io.to(`user_${result.value.assigned_to.toString()}`).emit('request_note_added', {
          request_id,
          request_code: requestCode
        });
      }
    }
    // The assigned technician, or whoever will assign it while it is still waiting.
    notify(result.value.assigned_to ?? { roles: ['IT_ADMIN'] }, {
      level: 'info', title: 'New note', request_code: requestCode,
      link: result.value.assigned_to ? TECH_PAGE : IT_ADMIN_PAGE,
      message: `${note.author_name} added a note to ${requestCode}: ${clip(note.text)}`,
    }, userId);

    res.json({ status: 'success', note });
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add note' });
  }
});

router.get('/get_dashboard', isAuthenticated, isItAdminOrTechnician, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const filterType = (req.query.filter as string) || 'all';
    const selectedDate = (req.query.date as string) || todayString();
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

    // open_earlier=1: the requests still open from before this day/week/month, oldest first, so the
    // dashboards can list them above the period's own requests and nothing old gets forgotten.
    const openEarlier = req.query.open_earlier === '1';
    const matchFilter: Record<string, unknown> = openEarlier
      ? { created_at: { $lt: startDate }, status: { $in: OPEN_STATUSES } }
      : { created_at: { $gte: startDate, $lte: endDate } };

    if (req.user!.roles.includes('TECHNICIAN')) {
      matchFilter.assigned_to = new ObjectId(userId);
    }

    if (!showDone && !openEarlier) {
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
              { $project: { first_name: 1, last_name: 1 } }
            ],
            as: 'assignee'
          }
        },
        { $sort: { created_at: openEarlier ? 1 : -1 } },
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
                  declined_count: { $sum: { $cond: [{ $eq: ['$status', 'DECLINED'] }, 1, 0] } },
                  repaired_count: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'DONE'] }, { $eq: ['$finished', 'repaired'] }] }, 1, 0] } },
                  beyond_repair_count: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'DONE'] }, { $eq: ['$finished', 'beyond repair'] }] }, 1, 0] } },
                  urgent_count: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $eq: ['$priority', 'URGENT'] }] }, 1, 0] } },
                  overdue_count: { $sum: { $cond: [overdueExpr('$due_date'), 1, 0] } }
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
      declined_count: meta.declined_count || 0,
      repaired_count: meta.repaired_count || 0,
      beyond_repair_count: meta.beyond_repair_count || 0,
      urgent_count: meta.urgent_count || 0,
      overdue_count: meta.overdue_count || 0
    };
    const total = meta.total || 0;
    const docs = results[0]?.data || [];

    const rows = docs.map((r: any) => {
      const status = r.status || '';
      const statusClass = status.toLowerCase().replace(/[_ ]/g, '-');
      const createdAtStr = r.created_at ? formatDateTime(r.created_at) : '-';
      const completedAtStr = r.completed_at ? formatDateTime(r.completed_at) : '-';
      const requesterArr = r.requester || [];
      const clientName = requesterArr.length > 0 ? `${requesterArr[0].first_name} ${requesterArr[0].last_name}` : 'Unknown';
      const assignee = r.assignee?.[0];

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
        assigned_to: r.assigned_to?.toString() || null,
        assigned_name: assignee ? `${assignee.first_name} ${assignee.last_name}` : null,
        priority: normalizePriority(r.priority),
        due_date: toDay(r.due_date),
        overdue: isOverdue(status, r.due_date),
        decline_reason: r.decline_reason || null,
        notes: r.notes || []
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
    
    // IT admins can look up any request; technicians their own assignments; everyone else only what they filed.
    const roles = req.user!.roles;
    const uid = new ObjectId(userId);
    const query: Record<string, unknown> = { request_code: requestCode };
    if (!roles.includes('IT_ADMIN') && !roles.includes('ADMIN')) {
      query.$or = roles.includes('TECHNICIAN')
        ? [{ created_by: uid }, { assigned_to: uid }]
        : [{ created_by: uid }];
    }

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
        completed_at: request.completed_at,
        decline_reason: request.decline_reason || null,
        notes: request.notes || []
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
    notify(user_id, {
      level: 'info', title: 'Request shared with you', request_code: sharedCode, link: OWNER_PAGE,
      message: `${`${req.user!.first_name} ${req.user!.last_name}`.trim() || req.user!.username} shared ${sharedCode} with you.`,
    }, granted_by);

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
    
    // Technicians see what is assigned to them; everyone else only the requests they filed.
    const roles = req.user!.roles;
    const filter: Record<string, unknown> = roles.includes('TECHNICIAN') && !roles.includes('CLIENT')
      ? { assigned_to: new ObjectId(userId) }
      : { created_by: new ObjectId(userId) };
    
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
      done_count: countsResult.find(c => c._id === 'DONE')?.count || 0,
      declined_count: countsResult.find(c => c._id === 'DECLINED')?.count || 0
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
    const technicians = await usersCollection.find({ roles: 'TECHNICIAN' }).project({ password: 0 }).toArray();
    res.json({ technicians });
  } catch (error) {
    console.error('Get technicians error:', error);
    res.status(500).json({ error: 'Failed to fetch technicians' });
  }
});

export default router;
