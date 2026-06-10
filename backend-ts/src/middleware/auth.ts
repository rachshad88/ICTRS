import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    user_id?: string;
    username?: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    role?: string;
    office?: string;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: {
    user_id: string;
    username: string;
    first_name: string;
    middle_name: string;
    last_name: string;
    role: string;
    office?: string;
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
    role: req.session.role || '',
    office: req.session.office || ''
  };
  next();
}

export function isTechnicianOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'TECHNICIAN' && req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isTechnicianOnly(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'TECHNICIAN') {
    res.status(403).json({ error: 'Only technicians can accept requests' });
    return;
  }
  next();
}

export function isAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isItAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'IT_ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isMultimediaAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'MULTIMEDIA_ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isItAdminOrTechnician(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'IT_ADMIN' && req.user?.role !== 'TECHNICIAN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
