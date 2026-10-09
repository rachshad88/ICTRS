import { HistoryTable, formatDate, HistoryTableConfig } from '../components/HistoryTable';

const config: HistoryTableConfig = {
  title: 'Digital Media Request History',
  fetchEndpoint: '/digitalmedia/my_history',
  cancelEndpoint: '/digitalmedia/cancel_request',
  noteEndpoint: '/digitalmedia/add_note',
  exportEndpoint: '/api/digitalmedia/export_excel',
  columns: [
    { key: 'form_of_digital_media', label: 'Form' },
    { key: 'event_ppa_name', label: 'Event / PPA' },
    { key: 'target_date', label: 'Target Date', render: (r) => formatDate(r.target_date) },
    { key: 'requestor_name', label: 'Requestor' },
  ],
  searchPlaceholder: 'Search by code, description, event, requestor...',
  emptyMessage: 'No digital media requests yet',
  newRequest: { to: '/digital-media-request', label: 'Make a digital media request' },
  cancelStatus: 'PENDING',
  service: 'digitalMedia',
  rateType: 'digital_media',
  modalTitleKey: 'form_of_digital_media',
  modalFields: [
    { label: 'Title', key: 'description' },
    { label: 'Description', key: 'digital_media_description' },
    { label: 'Event/PPA', key: 'event_ppa_name' },
    { label: 'Target Date', key: 'target_date', date: true },
    { label: 'Target Time', key: 'target_time' },
    { label: 'Requestor', key: 'requestor_name' },
    { label: 'Contact', key: 'requestor_contact' },
  ],
  fileViewer: { fileKey: 'supporting_files', type: 'digitalmedia', isArray: true },
};

function DigitalMediaHistory() {
  return <HistoryTable config={config} />;
}

export default DigitalMediaHistory;
