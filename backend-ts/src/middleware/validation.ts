import { z } from 'zod';

export const objectIdSchema = z.string().refine((val) => /^[a-fA-F0-9]{24}$/.test(val), {
  message: 'Invalid ID format'
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters')
});

export const updateProfileSchema = z.object({
  username: z.string().min(1).optional(),
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  office: z.string().optional()
});

export const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  role: z.enum(['ADMIN', 'TECHNICIAN', 'CLIENT', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN']),
  office: z.string().optional()
});

export const updateUserSchema = z.object({
  user_id: z.string().min(1, 'User ID is required'),
  username: z.string().min(1, 'Username is required'),
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  role: z.enum(['ADMIN', 'TECHNICIAN', 'CLIENT', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN']),
  office: z.string().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional()
});

export const createRequestSchema = z.object({
  office: z.string().min(1, 'Office is required'),
  unit: z.string().min(1, 'Unit is required'),
  semester: z.string().optional(),
  issue: z.string().min(1, 'Issue is required')
});

export const acceptRequestSchema = z.object({
  request_id: objectIdSchema
});

export const finishRequestSchema = z.object({
  request_id: objectIdSchema,
  finished: z.enum(['repaired', 'beyond repair']),
  remarks: z.string().optional(),
  recommendation: z.string().optional()
});

export const cancelRequestSchema = z.object({
  request_id: objectIdSchema
});

export const sharedAccessSchema = z.object({
  request_id: objectIdSchema,
  user_id: objectIdSchema
});

export const deleteUserSchema = z.object({
  user_id: objectIdSchema
});

export const assignMultimediaSchema = z.object({
  request_id: objectIdSchema,
  technician_id: objectIdSchema
});

export const completeMultimediaSchema = z.object({
  request_id: objectIdSchema,
  remarks: z.string().optional(),
  recommendation: z.string().optional()
});
