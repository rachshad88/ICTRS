import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getSettingsCollection, logAudit, sanitizeInput, Signatories } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { updateSignatoriesSchema } from '../middleware/validation';

const router = Router();

const SETTINGS_ID = 'signatories';

const EMPTY: Signatories = { supervisor_name: '', supervisor_position: '', mayor_name: '' };

function toResponse(doc: Partial<Signatories> | null) {
  return {
    supervisor_name: doc?.supervisor_name || '',
    supervisor_position: doc?.supervisor_position || '',
    mayor_name: doc?.mayor_name || '',
    updated_at: doc?.updated_at || null,
    updated_by: doc?.updated_by || null
  };
}

// Any signed-in user may read the names: everyone who can export the DAR needs them.
router.get('/', isAuthenticated, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const doc = await getSettingsCollection().findOne({ _id: SETTINGS_ID });
    res.json(toResponse(doc?.value ?? EMPTY));
  } catch (error) {
    console.error('Get signatories error:', error);
    res.status(500).json({ error: 'Failed to fetch signatories' });
  }
});

router.put('/', isAuthenticated, isAdmin, validateBody(updateSignatoriesSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const value: Signatories = {
      supervisor_name: sanitizeInput(req.body.supervisor_name).slice(0, 120),
      supervisor_position: sanitizeInput(req.body.supervisor_position).slice(0, 120),
      mayor_name: sanitizeInput(req.body.mayor_name).slice(0, 120),
      updated_at: new Date(),
      updated_by: req.user!.username
    };

    await getSettingsCollection().updateOne(
      { _id: SETTINGS_ID },
      { $set: { value } },
      { upsert: true }
    );

    await logAudit(
      new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role,
      'UPDATE_SIGNATORIES', 'SETTINGS', SETTINGS_ID,
      `Admin ${req.user!.username} set IT head to ${value.supervisor_name || '(blank)'} (${value.supervisor_position || 'no position'}) and municipal mayor to ${value.mayor_name || '(blank)'}`
    );

    res.json(toResponse(value));
  } catch (error) {
    console.error('Update signatories error:', error);
    res.status(500).json({ error: 'Failed to save signatories' });
  }
});

export default router;
