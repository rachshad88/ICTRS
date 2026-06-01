import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import { getUsersCollection, getCache, setCache, redisClient, logAudit } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createUserSchema, updateUserSchema, deleteUserSchema } from '../middleware/validation';

const router = Router();

router.get('/get_technicians', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cacheKey = 'users:technicians';
    const cached = await getCache<unknown[]>(cacheKey);
    
    if (cached) {
      return res.json({ technicians: cached, cached: true });
    }

    const usersCollection = getUsersCollection();
    const technicians = await usersCollection
      .find({ role: 'TECHNICIAN' })
      .project({ password: 0 })
      .limit(100)
      .toArray();

    await setCache(cacheKey, technicians, 300);
    res.json({ technicians });
  } catch (error) {
    console.error('Get technicians error:', error);
    res.status(500).json({ error: 'Failed to get technicians' });
  }
});

router.get('/get_users', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cacheKey = 'users:all:non-admin';
    const cached = await getCache<unknown[]>(cacheKey);
    
    if (cached) {
      return res.json({ users: cached, cached: true });
    }

    const usersCollection = getUsersCollection();
    const users = await usersCollection
      .find({ role: { $ne: 'ADMIN' } })
      .project({ password: 0 })
      .limit(100)
      .toArray();

    await setCache(cacheKey, users, 300);
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

router.post('/create_user', isAuthenticated, isAdmin, validateBody(createUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username, password, first_name, middle_name, last_name, role, office } = req.body;

    const usersCollection = getUsersCollection();
    const existing = await usersCollection.findOne({ username });
    
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await usersCollection.insertOne({
      username,
      password: hashedPassword,
      first_name,
      middle_name: middle_name || '',
      last_name,
      role,
      office: office || '',
      created_at: new Date()
    });

    // Invalidate caches
    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.role, 'CREATE_USER', 'USER', '', `Admin ${req.user!.username} created user ${username} (${role})`);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.post('/update_user', isAuthenticated, isAdmin, validateBody(updateUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id, username, first_name, middle_name, last_name, role, office, password } = req.body;

    const usersCollection = getUsersCollection();
    
    const updateData: Record<string, unknown> = {
      username,
      first_name,
      middle_name: middle_name || '',
      last_name,
      role,
      office: office || ''
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(user_id) },
      { $set: updateData }
    );

    // Invalidate caches
    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.role, 'UPDATE_USER', 'USER', user_id, `Admin ${req.user!.username} updated user ${username}`);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.post('/delete_user', isAuthenticated, isAdmin, validateBody(deleteUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id } = req.body;

    const usersCollection = getUsersCollection();
    const deletedUser = await usersCollection.findOneAndDelete({ _id: new ObjectId(user_id) });
    const deletedUsername = deletedUser?.value?.username || 'unknown';

    // Invalidate caches
    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.role, 'DELETE_USER', 'USER', user_id, `Admin ${req.user!.username} deleted user ${deletedUsername}`);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
