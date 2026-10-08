import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { getMultimediaRequestsCollection, getDigitalMediaRequestsCollection, getPrintMaterialsRequestsCollection, getNotificationsCollection, isValidObjectId } from '../config/database';
import { toNotificationDTO } from '../utils/notify';

const router = Router();

const PAGE_SIZE = 30;

// The signed-in user's latest notifications and how many are unread.
router.get('/', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = new ObjectId(req.user!.user_id);
    const collection = getNotificationsCollection();
    const [items, unread] = await Promise.all([
      collection.find({ user_id: userId }).sort({ created_at: -1 }).limit(PAGE_SIZE).toArray(),
      collection.countDocuments({ user_id: userId, read_at: null }),
    ]);
    res.json({ items: items.map(toNotificationDTO), unread });
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.post('/read_all', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await getNotificationsCollection().updateMany(
      { user_id: new ObjectId(req.user!.user_id), read_at: null },
      { $set: { read_at: new Date() } }
    );
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.post('/:id/read', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    // Scoped to the owner, so one user can't touch another's notifications.
    await getNotificationsCollection().updateOne(
      { _id: new ObjectId(id), user_id: new ObjectId(req.user!.user_id), read_at: null },
      { $set: { read_at: new Date() } }
    );
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Clearing deletes the user's notifications for good (they would expire after 90 days anyway).
router.post('/clear_all', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await getNotificationsCollection().deleteMany({ user_id: new ObjectId(req.user!.user_id) });
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

router.post('/:id/clear', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    // Scoped to the owner, so one user can't clear another's notifications.
    await getNotificationsCollection().deleteOne({ _id: new ObjectId(id), user_id: new ObjectId(req.user!.user_id) });
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Clear notification error:', error);
    res.status(500).json({ error: 'Failed to clear notification' });
  }
});

router.get('/unassigned-count', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const roles = req.user!.roles;

    // Multimedia admins see how many requests are waiting to be assigned on their management pages.
    if (roles.includes('MULTIMEDIA_ADMIN')) {
      const [multimedia, digitalMedia, printMaterials] = await Promise.all([
        getMultimediaRequestsCollection().countDocuments({ status: 'UNASSIGNED' }),
        getDigitalMediaRequestsCollection().countDocuments({ status: 'PENDING', assigned_to: null }),
        getPrintMaterialsRequestsCollection().countDocuments({ status: 'PENDING', assigned_to: null }),
      ]);
      const total = multimedia + digitalMedia + printMaterials;
      return res.json({ total, multimedia, digitalMedia, printMaterials });
    }

    // Multimedia staff see how many of their assignments are still open (not done, cancelled or declined).
    if (roles.includes('MULTIMEDIA')) {
      const uid = new ObjectId(userId);
      const [multimedia, digitalMedia, printMaterials] = await Promise.all([
        getMultimediaRequestsCollection().countDocuments({ assigned_to: uid, status: 'IN_PROGRESS' }),
        getDigitalMediaRequestsCollection().countDocuments({ assigned_to: uid, status: 'IN_PROGRESS' }),
        getPrintMaterialsRequestsCollection().countDocuments({ assigned_to: uid, status: 'IN_PROGRESS' }),
      ]);
      const total = multimedia + digitalMedia + printMaterials;
      return res.json({ total, multimedia, digitalMedia, printMaterials });
    }

    res.json({ total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 });
  } catch (error) {
    console.error('Unassigned count error:', error);
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

export default router;
