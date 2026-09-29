import { Request, Response, NextFunction } from 'express';
import { Role, isSessionCurrent } from '../config/database';

declare module 'express-session' {
  interface SessionData {
    user_id?: string;
    username?: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    roles?: Role[];
    primary_role?: Role;
    office?: string;
    is_default_password?: boolean;
    session_version?: number;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    username: string;
    first_name: string;
    middle_name: string;
    last_name: string;
    roles: Role[];
    primary_role: Role;
    office?: string;
    is_default_password?: boolean;
  };
}

// The frontend sends the user back to the login page when it sees this code.
const SESSION_EXPIRED = { error: 'Unauthorized', code: 'SESSION_EXPIRED' };

export async function isAuthenticated(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.session || !req.session.user_id) {
    res.status(401).json(SESSION_EXPIRED);
    return;
  }

  // The session is checked against the database on every request, so a deleted user, or one whose
  // roles or password an admin changed, is logged out on their next request instead of up to 24h later.
  try {
    if (!(await isSessionCurrent(req.session.user_id, req.session.session_version))) {
      req.session.destroy(() => res.status(401).json(SESSION_EXPIRED));
      return;
    }
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  // Accounts still on the default password may only use the account routes (profile, change
  // password, logout) until they change it; the frontend sends them to the Profile page.
  if (req.session.is_default_password && !req.originalUrl.startsWith('/api/auth/')) {
    res.status(403).json({ error: 'Change your default password to continue', code: 'PASSWORD_CHANGE_REQUIRED' });
    return;
  }

  req.user = {
    user_id: req.session.user_id,
    username: req.session.username || '',
    first_name: req.session.first_name || '',
    middle_name: req.session.middle_name || '',
    last_name: req.session.last_name || '',
    roles: req.session.roles || [],
    primary_role: (req.session.primary_role || 'CLIENT') as Role,
    office: req.session.office || '',
    is_default_password: req.session.is_default_password || false
  };
  next();
}

function hasRole(req: AuthenticatedRequest, role: Role): boolean {
  return req.user?.roles?.includes(role) || false;
}

export function isTechnicianOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req, 'TECHNICIAN') && !hasRole(req, 'ADMIN')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isTechnicianOnly(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req, 'TECHNICIAN')) {
    res.status(403).json({ error: 'Only technicians can accept requests' });
    return;
  }
  next();
}

export function isAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req, 'ADMIN')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isItAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req, 'IT_ADMIN')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isMultimediaAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req, 'MULTIMEDIA_ADMIN')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isItAdminOrTechnician(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!hasRole(req, 'IT_ADMIN') && !hasRole(req, 'TECHNICIAN')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}