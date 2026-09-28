import { HistoryTable, formatDate, HistoryTableConfig } from '../components/HistoryTable';

const config: HistoryTableConfig = {
  title: 'Print Materials Request History',
  fetchEndpoint: '/printmaterials/my_history',
  cancelEndpoint: '/printmaterials/cancel_request',
  noteEndpoint: '/printmaterials/add_note',
  exportEndpoint: '/api/printmaterials/export_excel',
  columns: [
    { key: 'form_of_printed_media', label: 'Form' },
    { key: 'size_of_printed_media', label: 'Size' },
    { key: 'event_ppa_name', label: 'Event / PPA' },
    { key: 'target_date', label: 'Target Date', render: (r) => formatDate(r.target_date) },
  ],
  searchPlaceholder: 'Search by code, description, event, requestor...',
  emptyMessage: 'No print materials requests yet',
  cancelStatus: 'PENDING',
  socketPrefix: 'print_materials',
  rateType: 'print_materials',
  modalTitleKey: 'form_of_printed_media',
  modalFields: [
    { label: 'Form', key: 'form_of_printed_media' },
    { label: 'Size', key: 'size_of_printed_media' },
    { label: 'Description', key: 'printed_media_description' },
    { label: 'Event/PPA', key: 'event_ppa_name' },
    { label: 'Target Date', key: 'target_date', date: true },
    { label: 'Requestor', key: 'requestor_name' },
    { label: 'Contact', key: 'requestor_contact' },
    { label: 'Remarks', key: 'remarks' },
  ],
  fileViewer: { fileKey: 'supporting_files', type: 'printmaterials', isArray: true },
};

function PrintMaterialsHistory() {
  return <HistoryTable config={config} />;
}

export default PrintMaterialsHistory;
