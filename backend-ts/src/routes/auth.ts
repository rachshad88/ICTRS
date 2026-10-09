import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getUsersCollection, logAudit, redisClient, Role, User } from '../config/database';
import { notify } from '../utils/notify';
import { AuthenticatedRequest, isAuthenticated } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { loginSchema, changePasswordSchema, updateProfileSchema, signupSchema } from '../middleware/validation';
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess, recordSignup, signupRetryAfter } from '../middleware/loginThrottle';

const router = Router();
// Same default as routes/users.ts; accounts on it must change it before using the app.
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

function getRedirect(role: Role): string {
  switch (role) {
    case 'CLIENT': return '/request';
    case 'MULTIMEDIA': return '/multimedia-dashboard';
    default: return '/dashboard';
  }
}

function sendLockout(res: Response, retryAfter: number) {
  const minutes = Math.ceil(retryAfter / 60);
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
}

// Counts a failed sign-in. The failure that triggers the lockout answers as locked straight away,
// so the sign-in page can pause the button now instead of one attempt later.
function rejectLogin(res: Response, username: string, ip: string) {
  recordLoginFailure(username, ip);
  const retryAfter = loginRetryAfter(username, ip);
  if (retryAfter > 0) return sendLockout(res, retryAfter);
  return res.status(401).json({ error: 'Invalid username or password' });
}

router.post('/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const ip = req.ip || '';
    const retryAfter = loginRetryAfter(username, ip);
    if (retryAfter > 0) return sendLockout(res, retryAfter);

    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ username });

    if (!user) {
      return rejectLogin(res, username, ip);
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
      return rejectLogin(res, username, ip);
    }
    recordLoginSuccess(username, ip);

    const isDefaultPassword = await passwordMatchesDefault(user.password);
    const userData = await startSession(req, user, isDefaultPassword);
    await logAudit(user._id!, user.username, userData.primary_role, 'LOGIN', 'USER', user._id!.toString(), `User ${user.username} logged in`);

    return res.json({ redirect: getRedirect(userData.primary_role), user: userData });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Signs the user in on a fresh session id (so a session id set before login can't be reused) and
// returns the user details the frontend keeps.
function startSession(req: Request, user: User, isDefaultPassword: boolean) {
  const roles = user.roles || [user.role];
  const primary_role = user.primary_role || user.role;

  return new Promise<{
    user_id: string; username: string; first_name: string; middle_name: string; last_name: string;
    roles: Role[]; primary_role: Role; office: string; position: string; is_default_password: boolean;
  }>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);

      req.session.user_id = user._id!.toString();
      req.session.username = user.username;
      req.session.first_name = user.first_name;
      req.session.middle_name = user.middle_name;
      req.session.last_name = user.last_name;
      req.session.roles = roles;
      req.session.primary_role = primary_role;
      req.session.office = user.office || '';
      req.session.is_default_password = isDefaultPassword;
      req.session.session_version = user.session_version || 0;

      resolve({
        user_id: user._id!.toString(),
        username: user.username,
        first_name: user.first_name,
        middle_name: user.middle_name,
        last_name: user.last_name,
        roles,
        primary_role,
        office: user.office || '',
        position: user.position || '',
        is_default_password: isDefaultPassword
      });
    });
  });
}

// Public sign-up for clients. The account always gets the CLIENT role and the default password,
// and is signed in straight away; isAuthenticated then keeps it on the Profile page until the
// password is changed, so nobody else can use the known default for long.
//
// Spam: ITRS is reachable from the internet, so a new account cannot submit requests until an
// admin approves it (approved: false, isApproved), and the admins are told about each one. Forms
// that fill the hidden "website" field, arrive without form_ms, or were filled in under 3 seconds
// are bots and get a vague error, so they learn nothing from it.
const MIN_FORM_MS = 3000;
router.post('/signup', validateBody(signupSchema), async (req: Request, res: Response) => {
  try {
    const ip = req.ip || '';
    const retryAfter = signupRetryAfter(ip);
    if (retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Too many new accounts from this computer. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
    }

    // validateBody only checks; parse again to get the trimmed values.
    const { username, first_name, middle_name, last_name, office, position, website, form_ms } = signupSchema.parse(req.body);
    if (website || form_ms === undefined || form_ms < MIN_FORM_MS) {
      return res.status(400).json({ error: 'Sign-up could not be completed. Please check your details and try again.' });
    }

    const usersCollection = getUsersCollection();
    // Usernames are matched exactly at login, but "Juan" and "juan" side by side would only confuse people.
    const taken = await usersCollection.findOne(
      { username },
      { collation: { locale: 'en', strength: 2 }, projection: { _id: 1 } }
    );
    if (taken) {
      return res.status(409).json({ error: 'That username is already taken. Please choose another.' });
    }

    const newUser: User = {
      username,
      password: await bcrypt.hash(DEFAULT_PASSWORD, 10),
      first_name,
      middle_name: middle_name || '',
      last_name,
      role: 'CLIENT',
      roles: ['CLIENT'],
      primary_role: 'CLIENT',
      office,
      position,
      created_at: new Date(),
      approved: false
    };

    try {
      const result = await usersCollection.insertOne(newUser);
      newUser._id = result.insertedId;
    } catch (error) {
      // Lost a race with someone taking the same username (unique index).
      if ((error as { code?: number }).code === 11000) {
        return res.status(409).json({ error: 'That username is already taken. Please choose another.' });
      }
      throw error;
    }
    recordSignup(ip);

    if (redisClient) {
      await redisClient.del('users:all:non-admin').catch(() => {});
    }

    await logAudit(newUser._id!, username, 'CLIENT', 'SIGNUP', 'USER', newUser._id!.toString(), `User ${username} signed up (${office})`);
    notify({ roles: ['ADMIN'] }, {
      level: 'info', title: 'Account waiting for approval', link: '/users',
      message: `${first_name} ${last_name} (${username}) of ${office} signed up and needs approval before they can submit requests.`
    });

    const userData = await startSession(req, newUser, true);
    return res.status(201).json({ redirect: '/profile', user: userData });
  } catch (error) {
    console.error('Signup error:', error);
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
  // Read from the database rather than the session so a position set by an admin shows up without re-login.
  const stored = await getUsersCollection()
    .findOne({ _id: new ObjectId(req.user!.user_id) }, { projection: { position: 1, approved: 1 } })
    .catch(() => null);
  res.json({
    user_id: req.user?.user_id,
    username: req.user?.username,
    first_name: req.user?.first_name,
    middle_name: req.user?.middle_name,
    last_name: req.user?.last_name,
    roles: req.user?.roles,
    primary_role: req.user?.primary_role,
    office: req.user?.office,
    position: stored?.position || '',
    is_default_password: req.user?.is_default_password || false,
    approved: stored?.approved !== false
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
    const { username, first_name, middle_name, last_name, office, position } = req.body;
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

    if (position !== undefined) {
      updateData.position = position.trim();
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