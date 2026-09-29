import { sanitizeInput, getPrintMaterialsRequestsCollection } from '../config/database';
import { createRequestRouter } from './multimediaFactory';
import { createPrintMaterialsSchema } from '../middleware/validation';

export default createRequestRouter({
  entity: 'print_materials',
  prefix: 'PM',
  collectionName: 'print_materials_requests',
  getCollection: getPrintMaterialsRequestsCollection,
  uploadDir: 'uploads/printmaterials',
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
    'application/postscript',
    'image/vnd.adobe.photoshop',
    'image/tiff'
  ],
  initialStatus: 'PENDING',
  cancelCheckStatusNot: 'PENDING',
  auditEntityType: 'PRINT_MATERIALS',
  socketPrefix: 'print_materials',
  hasRecommendation: false,
  summaryField: 'form_of_printed_media',
  dueField: 'target_date',
  searchFields: {
    getAll: ['request_code', 'printed_media_description', 'event_ppa_name'],
    getUnassigned: ['request_code', 'printed_media_description', 'event_ppa_name'],
    myRequests: ['request_code', 'event_ppa_name', 'requestor_name', 'form_of_printed_media'],
    myHistory: ['request_code', 'printed_media_description', 'event_ppa_name', 'requestor_name']
  },
  createSchema: createPrintMaterialsSchema,
  buildCreateDoc: (body, userId, requestCode, fileData) => ({
    request_code: requestCode,
    created_by: userId,
    assigned_to: null,
    form_of_printed_media: body.form_of_printed_media,
    size_of_printed_media: body.size_of_printed_media,
    printed_media_description: sanitizeInput(body.printed_media_description),
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
  excelSheetName: 'Print Materials History',
  excelFileName: 'print_materials_history.xlsx',
  excelColumns: [
    { header: 'Request Code', field: 'request_code', width: 15 },
    { header: 'Form of Printed Media', field: 'form_of_printed_media', width: 25 },
    { header: 'Size', field: 'size_of_printed_media', width: 15 },
    { header: 'Description', field: 'printed_media_description', width: 25 },
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
    { label: 'Form', field: 'form_of_printed_media' },
    { label: 'Size', field: 'size_of_printed_media' },
    { label: 'Description', field: 'printed_media_description' },
    { label: 'Event/PPA', field: 'event_ppa_name' },
    { label: 'Target Date', field: 'target_date', date: true },
    { label: 'Requestor', field: 'requestor_name' },
    { label: 'Contact', field: 'requestor_contact' },
    { label: 'Remarks', field: 'remarks' }
  ],
  fileFieldPath: 'supporting_files',
  fileIsArray: true
});
