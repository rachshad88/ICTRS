import { sanitizeInput, getMultimediaRequestsCollection } from '../config/database';
import { createRequestRouter } from './multimediaFactory';
import { createMultimediaSchema } from '../middleware/validation';

export default createRequestRouter({
  entity: 'multimedia',
  prefix: 'MM',
  collectionName: 'multimedia_requests',
  getCollection: getMultimediaRequestsCollection,
  uploadDir: 'uploads/multimedia',
  uploadMethod: 'single',
  fileFieldName: 'program_file',
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  initialStatus: 'UNASSIGNED',
  cancelCheckStatusNot: 'UNASSIGNED',
  auditEntityType: 'MULTIMEDIA',
  socketPrefix: 'multimedia',
  liveLane: 'multimedia',
  label: 'Multimedia',
  pages: { owner: '/multimedia-history', staff: '/multimedia-dashboard', admin: '/multimedia-management' },
  hasRecommendation: true,
  summaryField: 'event_title',
  dueField: 'event_date',
  searchFields: {
    getAll: ['request_code', 'event_title', 'specific_location'],
    getUnassigned: ['request_code', 'event_title', 'specific_location'],
    myRequests: ['request_code', 'event_title', 'location_type'],
    myHistory: ['request_code', 'event_title', 'specific_location', 'contact_number']
  },
  createSchema: createMultimediaSchema,
  buildCreateDoc: (body, userId, requestCode, fileData) => ({
    request_code: requestCode,
    created_by: userId,
    assigned_to: null,
    event_title: sanitizeInput(body.event_title),
    event_date: new Date(body.event_date),
    event_start_time: body.event_start_time,
    event_end_time: body.event_end_time,
    specific_location: sanitizeInput(body.specific_location),
    location_type: body.location_type,
    contact_number: sanitizeInput(body.contact_number),
    program_file: fileData || null,
    status: 'UNASSIGNED',
    remarks: null,
    recommendation: null,
    created_at: new Date(),
    completed_at: null
  }),
  excelSheetName: 'Multimedia History',
  excelFileName: 'multimedia_history.xlsx',
  excelColumns: [
    { header: 'Request Code', field: 'request_code', width: 15 },
    { header: 'Event Title', field: 'event_title', width: 25 },
    { header: 'Date Requested', field: 'date', width: 15 },
    { header: 'Event Date', field: 'event_date', width: 15 },
    { header: 'Start Time', field: 'event_start_time', width: 12 },
    { header: 'End Time', field: 'event_end_time', width: 12 },
    { header: 'Specific Location', field: 'specific_location', width: 30 },
    { header: 'Location Type', field: 'location_type', width: 20 },
    { header: 'Contact', field: 'contact_number', width: 15 },
    { header: 'Status', field: 'status', width: 15 },
    { header: 'Assigned To', field: 'assigned_to', width: 20 }
  ],
  modalFields: [
    { label: 'Request Code', field: 'request_code' },
    { label: 'Event Title', field: 'event_title' },
    { label: 'Event Date', field: 'event_date', date: true },
    { label: 'Time', field: 'event_start_time' },
    { label: 'Specific Location', field: 'specific_location' },
    { label: 'Location Type', field: 'location_type' },
    { label: 'Contact', field: 'contact_number' },
    { label: 'Status', field: 'status' }
  ],
  fileFieldPath: 'program_file',
  fileIsArray: false
});
