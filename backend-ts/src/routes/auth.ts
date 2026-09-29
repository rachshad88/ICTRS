import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getUsersCollection, logAudit, Role } from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { loginSchema, changePasswordSchema, updateProfileSchema } from '../middleware/validation';
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from '../middleware/loginThrottle';

const router = Router();

async function passwordMatchesDefault(userPassword: string): Promise<boolean> {
  if (!userPassword) return false;

  if (userPassword.startsWith('$2')) {
    const hashToCheck = userPassword.startsWith('$2y$')
      ? '$2b$' + userPassword.substring(4)
      : userPassword;
    return bcrypt.compare('12345', hashToCheck);
  }

  const md5Hash = crypto.createHash('md5').update('12345').digest('hex');
  return md5Hash === userPassword;
}

function getRedirect(role: Role): string {
  switch (role) {
    case 'CLIENT': return '/request';
    case 'MULTIMEDIA': return '/multimedia-dashboard';
    default: return '/dashboard';
  }
}

router.post('/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const ip = req.ip || '';
    const retryAfter = loginRetryAfter(username, ip);
    if (retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
    }

    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ username });

    if (!user) {
      recordLoginFailure(username, ip);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    let isValid = false;
    let needsUpgrade = false;
    
    if (user.password.startsWith('$2')) {
      const hashToCheck = user.password.startsWith('$2y$') 
        ? '$2b$' + user.password.substring(4) 
        : user.password;
      
      isValid = await bcrypt.compare(password, hashToCheck);
      needsUpgrade = isValid && bcrypt.getRounds(hashToCheck) < 10;
    } else {
      const md5Hash = crypto.createHash('md5').update(password).digest('hex');
      isValid = md5Hash === user.password;
      needsUpgrade = isValid;
    }
    
    if (needsUpgrade) {
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { password: await bcrypt.hash(password, 10) } }
      );
    }

    if (!isValid) {
      recordLoginFailure(username, ip);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    recordLoginSuccess(username, ip);

    const roles = user.roles || [user.role];
    const primary_role = user.primary_role || user.role;
    const isDefaultPassword = await passwordMatchesDefault(user.password);

    req.session.regenerate(async (err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      try {
        req.session.user_id = user._id?.toString();
        req.session.username = user.username;
        req.session.first_name = user.first_name;
        req.session.middle_name = user.middle_name;
        req.session.last_name = user.last_name;
        req.session.roles = roles;
        req.session.primary_role = primary_role;
        req.session.office = user.office || '';
        req.session.is_default_password = isDefaultPassword;
        req.session.session_version = user.session_version || 0;

        await logAudit(user._id!, user.username, primary_role, 'LOGIN', 'USER', user._id!.toString(), `User ${user.username} logged in`);

        const userData = {
          user_id: user._id?.toString(),
          username: user.username,
          first_name: user.first_name,
          middle_name: user.middle_name,
          last_name: user.last_name,
          roles,
          primary_role,
          office: user.office || '',
          is_default_password: isDefaultPassword
        };

        return res.json({ redirect: getRedirect(primary_role), user: userData });
      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  const uid = req.session?.user_id;
  const uname = req.session?.username;
  const urole = req.session?.primary_role || req.session?.roles?.[0];
  if (uid && uname) {
    await logAudit(new ObjectId(uid), uname, urole || 'UNKNOWN', 'LOGOUT', 'USER', uid, `User ${uname} logged out`);
  }
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid', {
      path: '/',
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax'
    });
    res.json({ status: 'success' });
  });
});

router.get('/me', isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
  res.json({
    user_id: req.user?.user_id,
    username: req.user?.username,
    first_name: req.user?.first_name,
    middle_name: req.user?.middle_name,
    last_name: req.user?.last_name,
    roles: req.user?.roles,
    primary_role: req.user?.primary_role,
    office: req.user?.office,
    is_default_password: req.user?.is_default_password || false
  });
});

router.post('/change_password', isAuthenticated, validateBody(changePasswordSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body;
    const userId = req.user!.user_id;

    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let isValid = false;
    
    if (user.password.startsWith('$2')) {
      const hashToCheck = user.password.startsWith('$2y$') 
        ? '$2b$' + user.password.substring(4) 
        : user.password;
      isValid = await bcrypt.compare(current_password, hashToCheck);
    } else {
      const md5Hash = crypto.createHash('md5').update(current_password).digest('hex');
      isValid = md5Hash === user.password;
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Changing your own password signs out your other sessions but keeps this one.
    const hashedPassword = await bcrypt.hash(new_password, 10);
    const updated = await usersCollection.findOneAndUpdate(
      { _id: user._id },
      { $set: { password: hashedPassword }, $inc: { session_version: 1 } },
      { returnDocument: 'after', projection: { session_version: 1 } }
    );

    req.session.is_default_password = false;
    req.session.session_version = updated.value?.session_version || 0;

    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'CHANGE_PASSWORD', 'USER', userId, `User ${req.user!.username} changed their password`);
    res.json({ status: 'success', message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.put('/update_profile', isAuthenticated, validateBody(updateProfileSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username, first_name, middle_name, last_name, office } = req.body;
    const userId = req.user!.user_id;

    const usersCollection = getUsersCollection();

    if (username) {
      const existing = await usersCollection.findOne({ username, _id: { $ne: new ObjectId(userId) } });
      if (existing) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    const updateData: Record<string, unknown> = {
      first_name,
      middle_name: middle_name || '',
      last_name
    };

    if (username) {
      updateData.username = username;
    }

    if (office !== undefined) {
      updateData.office = office;
    }

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );

    req.session.first_name = first_name;
    req.session.middle_name = middle_name || '';
    req.session.last_name = last_name;
    if (username) {
      req.session.username = username;
    }
    if (office !== undefined) {
      req.session.office = office;
    }

    await logAudit(new ObjectId(userId), req.user!.username, req.user!.primary_role, 'UPDATE_PROFILE', 'USER', userId, `User ${req.user!.username} updated their profile`);
    res.json({ status: 'success', message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;