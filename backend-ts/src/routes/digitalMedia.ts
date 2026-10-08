import { sanitizeInput, getDigitalMediaRequestsCollection } from '../config/database';
import { createRequestRouter } from './multimediaFactory';
import { createDigitalMediaSchema } from '../middleware/validation';

export default createRequestRouter({
  entity: 'digital_media',
  prefix: 'DM',
  collectionName: 'digital_media_requests',
  getCollection: getDigitalMediaRequestsCollection,
  uploadDir: 'uploads/digitalmedia',
  uploadMethod: 'array',
  fileFieldName: 'supporting_files',
  maxFiles: 10,
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4',
    'video/webm'
  ],
  initialStatus: 'PENDING',
  cancelCheckStatusNot: 'PENDING',
  auditEntityType: 'DIGITAL_MEDIA',
  socketPrefix: 'digital_media',
  liveLane: 'digital_media',
  label: 'Digital media',
  pages: { owner: '/digitalmedia-history', staff: '/digitalmedia-dashboard', admin: '/digitalmedia-management' },
  hasRecommendation: false,
  summaryField: 'description',
  dueField: 'target_date',
  searchFields: {
    getAll: ['request_code', 'description', 'event_ppa_name', 'requestor_name'],
    getUnassigned: ['request_code', 'description', 'event_ppa_name', 'requestor_name'],
    myRequests: ['request_code', 'event_ppa_name', 'requestor_name', 'form_of_digital_media'],
    myHistory: ['request_code', 'description', 'digital_media_description', 'event_ppa_name', 'requestor_name']
  },
  createSchema: createDigitalMediaSchema,
  buildCreateDoc: (body, userId, requestCode, fileData) => ({
    request_code: requestCode,
    created_by: userId,
    assigned_to: null,
    description: sanitizeInput(body.description),
    form_of_digital_media: body.form_of_digital_media,
    digital_media_description: sanitizeInput(body.digital_media_description),
    event_ppa_name: sanitizeInput(body.event_ppa_name),
    target_date: new Date(body.target_date),
    target_time: body.target_time,
    requestor_name: sanitizeInput(body.requestor_name),
    requestor_contact: sanitizeInput(body.requestor_contact),
    supporting_files: fileData,
    status: 'PENDING',
    remarks: null,
    created_at: new Date(),
    completed_at: null
  }),
  excelSheetName: 'Digital Media History',
  excelFileName: 'digital_media_history.xlsx',
  excelColumns: [
    { header: 'Request Code', field: 'request_code', width: 15 },
    { header: 'Description', field: 'description', width: 25 },
    { header: 'Form of Digital Media', field: 'form_of_digital_media', width: 20 },
    { header: 'Digital Media Description', field: 'digital_media_description', width: 25 },
    { header: 'Event/PPA', field: 'event_ppa_name', width: 20 },
    { header: 'Date Requested', field: 'date', width: 15 },
    { header: 'Target Date', field: 'target_date', width: 15 },
    { header: 'Requestor', field: 'requestor_name', width: 20 },
    { header: 'Contact', field: 'requestor_contact', width: 15 },
    { header: 'Status', field: 'status', width: 15 },
    { header: 'Assigned To', field: 'assigned_to', width: 20 },
    { header: 'Remarks', field: 'remarks', width: 25 }
  ],
  modalFields: [
    { label: 'Request Code', field: 'request_code' },
    { label: 'Title', field: 'description' },
    { label: 'Description', field: 'digital_media_description' },
    { label: 'Event/PPA', field: 'event_ppa_name' },
    { label: 'Target Date', field: 'target_date', date: true },
    { label: 'Target Time', field: 'target_time' },
    { label: 'Requestor', field: 'requestor_name' },
    { label: 'Contact', field: 'requestor_contact' },
    { label: 'Remarks', field: 'remarks' }
  ],
  fileFieldPath: 'supporting_files',
  fileIsArray: true
});
