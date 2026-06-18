import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { getMultimediaRequestsCollection, getDigitalMediaRequestsCollection, getPrintMaterialsRequestsCollection } from '../config/database';

const router = Router();

router.get('/unassigned-count', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const roles = req.user!.roles;

    if (roles.includes('ADMIN')) {
      const [multimedia, digitalMedia, printMaterials] = await Promise.all([
        getMultimediaRequestsCollection().countDocuments({ status: 'UNASSIGNED' }),
        getDigitalMediaRequestsCollection().countDocuments({ status: 'PENDING', assigned_to: null }),
        getPrintMaterialsRequestsCollection().countDocuments({ status: 'PENDING', assigned_to: null }),
      ]);
      const total = multimedia + digitalMedia + printMaterials;
      return res.json({ total, multimedia, digitalMedia, printMaterials });
    }

    if (roles.includes('MULTIMEDIA')) {
      const uid = new ObjectId(userId);
      const [multimedia, digitalMedia, printMaterials] = await Promise.all([
        getMultimediaRequestsCollection().countDocuments({ assigned_to: uid, status: { $ne: 'DONE' } }),
        getDigitalMediaRequestsCollection().countDocuments({ assigned_to: uid, status: { $ne: 'DONE' } }),
        getPrintMaterialsRequestsCollection().countDocuments({ assigned_to: uid, status: { $ne: 'DONE' } }),
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
