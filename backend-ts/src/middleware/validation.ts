import { z } from 'zod';
import { PRIORITIES } from '../utils/priority';
import { isValidDay, isValidTime, todayString } from '../utils/dates';

export const objectIdSchema = z.string().refine((val) => /^[a-fA-F0-9]{24}$/.test(val), {
  message: 'Invalid ID format'
});

const prioritySchema = z.enum(PRIORITIES);

// Empty string or null clears the due date.
const dueDateSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
  z.literal(''),
  z.null()
]);

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

// Options offered by the request forms; the server accepts only these.
export const IT_UNITS = ['desktop', 'laptop', 'network', 'others'] as const;
export const SEMESTERS = ['1st Semester (January-June)', '2nd Semester (July-December)'] as const;
export const LOCATION_TYPES = [
  'Within the LGU Solano Compound',
  'Within Solano, but outside the LGU Solano Compound',
  'Within Nueva Vizcaya, but outside Solano',
  'Outside of Nueva Vizcaya'
] as const;
export const DIGITAL_MEDIA_FORMS = [
  'Social Media Post or Digital Poster',
  'Powerpoint Presentation',
  'Video Presentation',
  'Other form of digital media'
] as const;
export const PRINTED_MEDIA_FORMS = [
  'Tarpaulin',
  'Brochures, Flyers, and other small-size commonly printed publications (Not larger than a long bond paper)',
  'Other Forms of Printed Media'
] as const;

const TEXT_MAX = 1000;
const text = (label: string, max = TEXT_MAX) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`);
const optionalText = (label: string, max = TEXT_MAX) =>
  z.string().max(max, `${label} must be ${max} characters or fewer`).optional();
const contactNumber = (label: string) => z.string().regex(/^\d{7,11}$/, `${label} must be 7 to 11 digits`);
// Event and target dates must be real days, today or later (in the app timezone).
const upcomingDay = (label: string) => z.string()
  .refine(isValidDay, `${label} must be a valid date`)
  .refine((d) => d >= todayString(), `${label} cannot be in the past`);
const time = (label: string) => z.string().refine(isValidTime, `${label} must be a valid time`);

// The office is taken from the requester's account, so any office sent here is ignored.
export const createRequestSchema = z.object({
  office: z.string().optional(),
  unit: z.enum(IT_UNITS, { errorMap: () => ({ message: 'Please choose a unit from the list' }) }),
  semester: z.union([z.enum(SEMESTERS), z.literal('')]).optional(),
  issue: text('Issue'),
  priority: prioritySchema.optional()
});

export const createMultimediaSchema = z.object({
  event_title: text('Event title', 200),
  event_date: upcomingDay('Event date'),
  event_start_time: time('Start time'),
  event_end_time: time('End time'),
  specific_location: text('Specific location', 300),
  location_type: z.enum(LOCATION_TYPES, { errorMap: () => ({ message: 'Please choose a location type from the list' }) }),
  contact_number: contactNumber('Contact number'),
  priority: prioritySchema.optional()
}).refine((b) => b.event_end_time > b.event_start_time, { message: 'End time must be after the start time', path: ['event_end_time'] });

const targetFields = {
  target_date: upcomingDay('Target date'),
  target_time: time('Target time'),
  event_ppa_name: text('Event / PPA name', 300),
  requestor_name: text('Requestor name', 200),
  requestor_contact: contactNumber('Requestor contact'),
  priority: prioritySchema.optional()
};

export const createDigitalMediaSchema = z.object({
  description: text('Title', 300),
  form_of_digital_media: z.enum(DIGITAL_MEDIA_FORMS, { errorMap: () => ({ message: 'Please choose a form of digital media from the list' }) }),
  digital_media_description: text('Description'),
  ...targetFields
});

export const createPrintMaterialsSchema = z.object({
  form_of_printed_media: z.enum(PRINTED_MEDIA_FORMS, { errorMap: () => ({ message: 'Please choose a form of printed media from the list' }) }),
  size_of_printed_media: text('Size', 100),
  printed_media_description: text('Description'),
  ...targetFields
});

export const acceptRequestSchema = z.object({
  request_id: objectIdSchema,
  technician_id: objectIdSchema,
  priority: prioritySchema.optional(),
  due_date: dueDateSchema.optional()
});

export const reassignRequestSchema = z.object({
  request_id: objectIdSchema,
  technician_id: objectIdSchema,
  reason: z.string().trim().max(500, 'Reason must be 500 characters or fewer').optional()
});

// due_date is only accepted by the IT route; the media routes ignore it.
export const setPrioritySchema = z.object({
  request_id: objectIdSchema,
  priority: prioritySchema,
  due_date: dueDateSchema.optional()
});

export const finishRequestSchema = z.object({
  request_id: objectIdSchema,
  finished: z.enum(['repaired', 'beyond repair']),
  remarks: optionalText('Remarks'),
  recommendation: optionalText('Recommendation')
});

export const cancelRequestSchema = z.object({
  request_id: objectIdSchema
});

export const declineRequestSchema = z.object({
  request_id: objectIdSchema,
  reason: z.string().trim().min(3, 'Please give a reason (at least 3 characters)').max(500, 'Reason must be 500 characters or fewer')
});

export const addNoteSchema = z.object({
  request_id: objectIdSchema,
  text: z.string().trim().min(1, 'Note cannot be empty').max(500, 'Note must be 500 characters or fewer')
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

export const assignWithPrioritySchema = assignMultimediaSchema.extend({
  priority: prioritySchema.optional()
});

export const completeMultimediaSchema = z.object({
  request_id: objectIdSchema,
  remarks: optionalText('Remarks'),
  recommendation: optionalText('Recommendation')
});

const ALL_ROLES = ['ADMIN', 'TECHNICIAN', 'CLIENT', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN', 'PROGRAMMER'] as const;

// Blank means "keep" (update) or "use the default password" (create); otherwise the same rule as a user's own change.
const adminPasswordSchema = z.union([
  z.literal(''),
  z.string().min(8, 'Password must be at least 8 characters')
]).optional();

const primaryRoleInRoles = { message: 'Primary role must be one of the selected roles', path: ['primary_role'] };

export const createUserSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: adminPasswordSchema,
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  roles: z.array(z.enum(ALL_ROLES)).min(1, 'At least one role is required'),
  primary_role: z.enum(ALL_ROLES),
  office: z.string().optional()
}).refine((b) => b.roles.includes(b.primary_role), primaryRoleInRoles);

export const updateUserSchema = z.object({
  user_id: objectIdSchema,
  username: z.string().trim().min(1, 'Username is required'),
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  roles: z.array(z.enum(ALL_ROLES)).min(1, 'At least one role is required'),
  primary_role: z.enum(ALL_ROLES),
  office: z.string().optional(),
  password: adminPasswordSchema
}).refine((b) => b.roles.includes(b.primary_role), primaryRoleInRoles);

export const createSoftwareRequestSchema = z.object({
  proposed_title: z.string().min(1, 'Proposed title is required'),
  client_name_office: z.string().min(1, 'Client name/office is required'),
  statement_of_problem: z.string().min(1, 'Statement of the problem is required'),
  objective: z.string().min(1, 'Objective is required')
});

export const reviewSoftwareRequestSchema = z.object({
  request_id: objectIdSchema,
  action: z.enum(['approve', 'reject']),
  technician_id: z.string().optional(),
  rejection_reason: z.string().optional()
});

export const completeSoftwareRequestSchema = z.object({
  request_id: objectIdSchema,
  remarks: z.string().optional()
});
