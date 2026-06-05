import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getUsersCollection, logAudit } from '../config/database';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { loginSchema, changePasswordSchema, updateProfileSchema } from '../middleware/validation';

const router = Router();

router.post('/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ username });

    if (!user) {
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
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Regenerate session to prevent session fixation
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
        req.session.role = user.role;
        req.session.office = user.office || '';

        await logAudit(user._id!, user.username, user.role, 'LOGIN', 'USER', user._id!.toString(), `User ${user.username} logged in`);

        const userData = {
          user_id: user._id?.toString(),
          username: user.username,
          first_name: user.first_name,
          middle_name: user.middle_name,
          last_name: user.last_name,
          role: user.role,
          office: user.office || ''
        };

        if (user.role === 'CLIENT') {
          return res.json({ redirect: '/request', user: userData });
        } else if (user.role === 'MULTIMEDIA') {
          return res.json({ redirect: '/multimedia-dashboard', user: userData });
        } else {
          return res.json({ redirect: '/dashboard', user: userData });
        }
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
  const urole = req.session?.role;
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
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
    role: req.user?.role,
    office: req.user?.office
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

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    await logAudit(new ObjectId(userId), req.user!.username, req.user!.role, 'CHANGE_PASSWORD', 'USER', userId, `User ${req.user!.username} changed their password`);
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

    await logAudit(new ObjectId(userId), req.user!.username, req.user!.role, 'UPDATE_PROFILE', 'USER', userId, `User ${req.user!.username} updated their profile`);
    res.json({ status: 'success', message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
