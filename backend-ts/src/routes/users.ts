import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { getUsersCollection, getCache, setCache, redisClient, logAudit } from '../config/database';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createUserSchema, updateUserSchema, deleteUserSchema, objectIdSchema } from '../middleware/validation';

const router = Router();
const DEFAULT_PASSWORD = '12345';

async function passwordMatchesDefault(userPassword: string): Promise<boolean> {
  if (!userPassword) return false;

  if (userPassword.startsWith('$2')) {
    const hashToCheck = userPassword.startsWith('$2y$')
      ? '$2b$' + userPassword.substring(4)
      : userPassword;
    return bcrypt.compare(DEFAULT_PASSWORD, hashToCheck);
  }

  const md5Hash = crypto.createHash('md5').update(DEFAULT_PASSWORD).digest('hex');
  return md5Hash === userPassword;
}

router.get('/get_technicians', isAuthenticated, isAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const cacheKey = 'users:technicians';
    const cached = await getCache<unknown[]>(cacheKey);
    
    if (cached) {
      return res.json({ technicians: cached, cached: true });
    }

    const usersCollection = getUsersCollection();
    const technicians = await usersCollection
      .find({ roles: 'TECHNICIAN' })
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
      .find({ roles: { $ne: 'ADMIN' } })
      .project({
        password: 1,
        username: 1,
        first_name: 1,
        middle_name: 1,
        last_name: 1,
        role: 1,
        roles: 1,
        primary_role: 1,
        office: 1,
        created_at: 1
      })
      .limit(100)
      .toArray();

    const usersWithStatus = await Promise.all(users.map(async (user) => {
      const { password, ...safeUser } = user;
      return {
        ...safeUser,
        is_default_password: await passwordMatchesDefault(password)
      };
    }));

    await setCache(cacheKey, usersWithStatus, 300);
    res.json({ users: usersWithStatus });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

router.post('/create_user', isAuthenticated, isAdmin, validateBody(createUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username, password, first_name, middle_name, last_name, roles, primary_role, office } = req.body;

    const usersCollection = getUsersCollection();
    const existing = await usersCollection.findOne({ username });
    
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordToUse = password || DEFAULT_PASSWORD;
    const hashedPassword = await bcrypt.hash(passwordToUse, 10);

    await usersCollection.insertOne({
      username,
      password: hashedPassword,
      first_name,
      middle_name: middle_name || '',
      last_name,
      role: primary_role,
      roles,
      primary_role,
      office: office || '',
      created_at: new Date()
    });

    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'CREATE_USER', 'USER', '', `Admin ${req.user!.username} created user ${username} (${primary_role})`);
    res.json({ status: 'success', message: `User created successfully. Default password is ${DEFAULT_PASSWORD}` });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.post('/update_user', isAuthenticated, isAdmin, validateBody(updateUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id, username, first_name, middle_name, last_name, roles, primary_role, office, password } = req.body;

    const usersCollection = getUsersCollection();
    
    const updateData: Record<string, unknown> = {
      username,
      first_name,
      middle_name: middle_name || '',
      last_name,
      role: primary_role,
      roles,
      primary_role,
      office: office || ''
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(user_id) },
      { $set: updateData }
    );

    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'UPDATE_USER', 'USER', user_id, `Admin ${req.user!.username} updated user ${username}`);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.post('/reset_user_password', isAuthenticated, isAdmin, validateBody(z.object({ user_id: objectIdSchema })), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id } = req.body;
    const usersCollection = getUsersCollection();
    const targetUser = await usersCollection.findOne({ _id: new ObjectId(user_id) });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetRoles = (targetUser.roles || [targetUser.primary_role || targetUser.role || 'CLIENT']).filter(Boolean);
    const isSuperAdmin = targetRoles.includes('ADMIN');
    const roleLabel = isSuperAdmin ? 'super admin' : targetRoles.join(', ').toLowerCase();

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await usersCollection.updateOne(
      { _id: targetUser._id },
      { $set: { password: hashedPassword } }
    );

    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'RESET_USER_PASSWORD', 'USER', user_id, `Admin ${req.user!.username} reset the password for ${targetUser.username} (${roleLabel})`);
    res.json({ status: 'success', message: `Password reset to ${DEFAULT_PASSWORD}` });
  } catch (error) {
    console.error('Reset user password error:', error);
    res.status(500).json({ error: 'Failed to reset user password' });
  }
});

router.post('/delete_user', isAuthenticated, isAdmin, validateBody(deleteUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id } = req.body;

    const usersCollection = getUsersCollection();
    const deletedUser = await usersCollection.findOneAndDelete({ _id: new ObjectId(user_id) });
    const deletedUsername = deletedUser?.value?.username || 'unknown';

    if (redisClient) {
      await redisClient.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'DELETE_USER', 'USER', user_id, `Admin ${req.user!.username} deleted user ${deletedUsername}`);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;