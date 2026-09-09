import { Request, Response, NextFunction } from 'express';
import { Role } from '../config/database';

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

export function isAuthenticated(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.session || !req.session.user_id) {
    res.status(401).json({ error: 'Unauthorized' });
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