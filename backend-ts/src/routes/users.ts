import { Router, Response } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { z } from 'zod';
import { getUsersCollection, getCache, setCache, redisClient, logAudit } from '../config/database';
import { notify } from '../utils/notify';
import { AuthenticatedRequest, isAuthenticated, isAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createUserSchema, updateUserSchema, deleteUserSchema, objectIdSchema } from '../middleware/validation';

const router = Router();
const DEFAULT_PASSWORD = '12345';

// Closes the user's live socket connections; their HTTP sessions are rejected by isAuthenticated
// once session_version no longer matches (or the user no longer exists).
function disconnectUserSockets(req: AuthenticatedRequest, userId: string): void {
  const io = req.app.get('io');
  if (io) io.in(`user_${userId}`).disconnectSockets(true);
}

const sameRoles = (a: unknown, b: unknown) =>
  JSON.stringify([...((a as string[]) || [])].sort()) === JSON.stringify([...((b as string[]) || [])].sort());

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
    const projection = {
        password: 1,
        username: 1,
        first_name: 1,
        middle_name: 1,
        last_name: 1,
        role: 1,
        roles: 1,
        primary_role: 1,
        office: 1,
        position: 1,
        created_at: 1,
        approved: 1
    };
    // Sign-ups waiting for approval always come first and are never cut off by the limit.
    const [pending, others] = await Promise.all([
      usersCollection.find({ roles: { $ne: 'ADMIN' }, approved: false }).project(projection).sort({ created_at: -1 }).toArray(),
      usersCollection.find({ roles: { $ne: 'ADMIN' }, approved: { $ne: false } }).project(projection).limit(100).toArray()
    ]);
    const users = [...pending, ...others];

    const usersWithStatus = await Promise.all(users.map(async (user) => {
      const { password, ...safeUser } = user;
      return {
        ...safeUser,
        is_default_password: await passwordMatchesDefault(password),
        approved: user.approved !== false
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
    const { username, password, first_name, middle_name, last_name, roles, primary_role, office, position } = req.body;

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
      position: (position || '').trim(),
      created_at: new Date(),
      approved: true
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
    const { user_id, username, first_name, middle_name, last_name, roles, primary_role, office, position, password } = req.body;

    const usersCollection = getUsersCollection();
    
    const updateData: Record<string, unknown> = {
      username,
      first_name,
      middle_name: middle_name || '',
      last_name,
      role: primary_role,
      roles,
      primary_role,
      office: office || '',
      position: (position || '').trim()
    };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const existingUser = await usersCollection.findOne({ _id: new ObjectId(user_id) });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (username !== existingUser.username && await usersCollection.findOne({ username, _id: { $ne: existingUser._id } })) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const wasAdmin = (existingUser.roles || [existingUser.role]).includes('ADMIN');
    if (wasAdmin && !roles.includes('ADMIN') && await usersCollection.countDocuments({ roles: 'ADMIN' }) <= 1) {
      return res.status(400).json({ error: 'You cannot remove the admin role from the last admin account' });
    }

    // A change to what the user can access, or how they sign in, ends their current sessions.
    const accessChanged = !!password
      || existingUser.username !== username
      || (existingUser.primary_role || existingUser.role) !== primary_role
      || !sameRoles(existingUser.roles || [existingUser.role], roles);

    await usersCollection.updateOne(
      { _id: existingUser._id },
      { $set: updateData, ...(accessChanged && { $inc: { session_version: 1 } }) }
    );

    if (accessChanged) {
      disconnectUserSockets(req, user_id);
    }

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
      { $set: { password: hashedPassword }, $inc: { session_version: 1 } }
    );
    disconnectUserSockets(req, user_id);

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

// Lets a self sign-up sign in (spam protection, see the signup route).
router.post('/approve_user', isAuthenticated, isAdmin, validateBody(z.object({ user_id: objectIdSchema })), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id } = req.body;
    const result = await getUsersCollection().findOneAndUpdate(
      { _id: new ObjectId(user_id), approved: false },
      { $set: { approved: true } },
      { returnDocument: 'after', projection: { username: 1 } }
    );
    if (!result || !result.value) {
      return res.status(404).json({ error: 'No account waiting for approval was found. Refresh the list.' });
    }

    if (redisClient) {
      await redisClient.del('users:all:non-admin').catch(() => {});
    }

    await logAudit(new ObjectId(req.user!.user_id), req.user!.username, req.user!.primary_role, 'APPROVE_USER', 'USER', user_id, `Admin ${req.user!.username} approved the sign-up of ${result.value.username}`);
    notify(user_id, {
      level: 'success', title: 'Account approved',
      message: 'Your account was approved by the IT office. Welcome to ITRS!', link: '/request'
    });
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

router.post('/delete_user', isAuthenticated, isAdmin, validateBody(deleteUserSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { user_id } = req.body;

    if (user_id === req.user!.user_id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const usersCollection = getUsersCollection();
    const target = await usersCollection.findOne({ _id: new ObjectId(user_id) }, { projection: { roles: 1, role: 1 } });
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    if ((target.roles || [target.role]).includes('ADMIN') && await usersCollection.countDocuments({ roles: 'ADMIN' }) <= 1) {
      return res.status(400).json({ error: 'You cannot delete the last admin account' });
    }

    const deletedUser = await usersCollection.findOneAndDelete({ _id: new ObjectId(user_id) });
    const deletedUsername = deletedUser?.value?.username || 'unknown';
    disconnectUserSockets(req, user_id);

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