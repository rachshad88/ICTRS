import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, ZodIssue } from 'zod';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e: ZodIssue) => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ error: 'Validation failed', details: errors });
        return;
      }
      next(error);
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e: ZodIssue) => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ error: 'Validation failed', details: errors });
        return;
      }
      next(error);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.issues.map((e: ZodIssue) => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ error: 'Validation failed', details: errors });
        return;
      }
      next(error);
    }
  };
}
