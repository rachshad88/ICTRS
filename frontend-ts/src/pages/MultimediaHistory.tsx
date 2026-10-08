import { HistoryTable, formatDate, HistoryTableConfig } from '../components/HistoryTable';

const config: HistoryTableConfig = {
  title: 'Multimedia Request History',
  fetchEndpoint: '/multimedia/my_history',
  cancelEndpoint: '/multimedia/cancel_request',
  noteEndpoint: '/multimedia/add_note',
  exportEndpoint: '/api/multimedia/export_excel',
  columns: [
    { key: 'event_title', label: 'Event' },
    { key: 'event_date', label: 'Date', render: (r) => formatDate(r.event_date) },
    { key: 'event_start_time', label: 'Time', render: (r) => `${r.event_start_time} - ${r.event_end_time}` },
    { key: 'location_type', label: 'Location' },
  ],
  searchPlaceholder: 'Search by code, event, location...',
  emptyMessage: 'No multimedia requests yet',
  cancelStatus: 'UNASSIGNED',
  service: 'multimedia',
  rateType: 'multimedia',
  modalTitleKey: 'event_title',
  modalFields: [
    { label: 'Event Date', key: 'event_date', date: true },
    { label: 'Time', key: 'event_start_time' },
    { label: 'Specific Location', key: 'specific_location' },
    { label: 'Location Type', key: 'location_type' },
    { label: 'Contact', key: 'contact_number' },
  ],
  fileViewer: { fileKey: 'program_file', type: 'multimedia', isArray: false },
  hasRecommendation: true,
};

function MultimediaHistory() {
  return <HistoryTable config={config} />;
}

export default MultimediaHistory;
