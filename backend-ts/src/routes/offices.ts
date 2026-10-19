import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import {
  getOfficesCollection, getUsersCollection, getRequestsCollection, logAudit, sanitizeInput,
  isValidObjectId, forgetUserLists
} from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createOfficeSchema, renameOfficeSchema, setOfficeActiveSchema } from '../middleware/validation';
import { activeOfficeNames } from '../utils/officeList';

const router = Router();

const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

// The offices people can pick. Public: the sign-up page needs it before anyone is signed in.
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json({ offices: await activeOfficeNames() });
  } catch (error) {
    console.error('Get offices error:', error);
    res.status(500).json({ error: 'Failed to load offices' });
  }
});

// Every office, hidden ones too, with how many accounts use each (Offices page).
router.get('/all', isAuthenticated, isAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [offices, counts] = await Promise.all([
      getOfficesCollection().find({}).collation(CASE_INSENSITIVE).sort({ name: 1 }).toArray(),
      getUsersCollection().aggregate<{ _id: string; n: number }>([
        { $match: { office: { $nin: [null, ''] } } },
        { $group: { _id: '$office', n: { $sum: 1 } } }
      ]).toArray()
    ]);
    const users = new Map(counts.map((c) => [c._id, c.n]));
    res.json({
      offices: offices.map((o) => ({
        _id: o._id!.toString(),
        name: o.name,
        active: o.active,
        users: users.get(o.name) || 0,
        created_at: o.created_at
      }))
    });
  } catch (error) {
    console.error('Get all offices error:', error);
    res.status(500).json({ error: 'Failed to load offices' });
  }
});

router.post('/', isAuthenticated, isAdmin, validateBody(createOfficeSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = sanitizeInput(req.body.name.trim());
    const offices = getOfficesCollection();
    const existing = await offices.findOne({ name }, { collation: CASE_INSENSITIVE });
    if (existing) {
      return res.status(409).json({
        error: existing.active ? 'That office is already on the list.' : 'That office already exists but is hidden. Show it again instead.'
      });
    }
    const result = await offices.insertOne({ name, active: true, created_at: new Date(), created_by: req.user!.username });
    await logAudit(
      new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
      'CREATE_OFFICE', 'SETTINGS', result.insertedId.toString(), `Admin ${req.user!.username} added office ${name}`
    );
    res.json({ status: 'success', _id: result.insertedId.toString(), name });
  } catch (error) {
    console.error('Create office error:', error);
    res.status(500).json({ error: 'Failed to add office' });
  }
});

// Renames an office everywhere it is used: the accounts on it and their IT requests, so reports and
// filters keep grouping them together. Media requests don't store an office.
router.put('/:id', isAuthenticated, isAdmin, validateBody(renameOfficeSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid office' });
    const id = new ObjectId(req.params.id);
    const name = sanitizeInput(req.body.name.trim());
    const offices = getOfficesCollection();
    const office = await offices.findOne({ _id: id });
    if (!office) return res.status(404).json({ error: 'Office not found' });
    if (office.name === name) return res.json({ status: 'success', name, users: 0, requests: 0 });

    const clash = await offices.findOne({ name, _id: { $ne: id } }, { collation: CASE_INSENSITIVE });
    if (clash) return res.status(409).json({ error: 'Another office already has that name.' });

    await offices.updateOne({ _id: id }, { $set: { name } });
    const [users, requests] = await Promise.all([
      getUsersCollection().updateMany({ office: office.name }, { $set: { office: name } }),
      getRequestsCollection().updateMany({ office: office.name }, { $set: { office: name } })
    ]);
    await forgetUserLists();
    await logAudit(
      new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
      'RENAME_OFFICE', 'SETTINGS', id.toString(),
      `Admin ${req.user!.username} renamed office ${office.name} to ${name} (${users.modifiedCount} accounts, ${requests.modifiedCount} IT requests)`
    );
    res.json({ status: 'success', name, users: users.modifiedCount, requests: requests.modifiedCount });
  } catch (error) {
    console.error('Rename office error:', error);
    res.status(500).json({ error: 'Failed to rename office' });
  }
});

// Hides an office from the pickers, or shows it again. Accounts already on it keep it.
router.put('/:id/active', isAuthenticated, isAdmin, validateBody(setOfficeActiveSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid office' });
    const id = new ObjectId(req.params.id);
    const office = await getOfficesCollection().findOneAndUpdate(
      { _id: id }, { $set: { active: req.body.active } }, { returnDocument: 'after' }
    );
    const doc = office && 'value' in office ? office.value : office;
    if (!doc) return res.status(404).json({ error: 'Office not found' });
    await logAudit(
      new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
      req.body.active ? 'SHOW_OFFICE' : 'HIDE_OFFICE', 'SETTINGS', id.toString(),
      `Admin ${req.user!.username} ${req.body.active ? 'showed' : 'hid'} office ${doc.name}`
    );
    res.json({ status: 'success', active: req.body.active });
  } catch (error) {
    console.error('Set office active error:', error);
    res.status(500).json({ error: 'Failed to update office' });
  }
});

export default router;
