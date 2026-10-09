import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { queryClient, refreshService, type Service } from '../services/queryClient';
import FileViewer from './FileViewer';
import Skeleton from './Skeleton';
import EmptyState from './EmptyState';
import { useConfirm } from './ConfirmDialog';
import Pagination from './Pagination';
import { truncateCell } from '../lib/truncate';
import { openRating } from '../services/rating';
import { NotesList, DeclineReason, AddNoteForm, RequestNote, StaffReport } from './RequestNotes';
import SearchBox from './SearchBox';

export interface ColumnDef {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
}

export interface ModalField {
  label: string;
  key: string;
  date?: boolean;
}

export interface FileViewerConfig {
  fileKey: string;
  type: 'multimedia' | 'digitalmedia' | 'printmaterials';
  isArray: boolean;
}

export interface HistoryTableConfig {
  title: string;
  fetchEndpoint: string;
  cancelEndpoint: string;
  noteEndpoint: string;
  exportEndpoint: string;
  columns: ColumnDef[];
  searchPlaceholder: string;
  emptyMessage: string;
  /** Where an empty history sends the client to make their first request. */
  newRequest: { to: string; label: string };
  cancelStatus: string;
  /** Which service the requests belong to; its socket events refresh the table (services/queryClient.ts). */
  service: Service;
  rateType: string;
  modalTitleKey: string;
  modalFields: ModalField[];
  fileViewer?: FileViewerConfig;
  /** True when staff fill in a recommendation on completion (Multimedia); remarks are always shown. */
  hasRecommendation?: boolean;
}

const ITEMS_PER_PAGE = 10;

export function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function renderAssignedTechnician(technician?: Array<{ first_name: string; last_name: string }>) {
  return technician?.[0]
    ? `${technician[0].first_name} ${technician[0].last_name}`
    : <span style={{ color: 'var(--text-secondary)' }}>Unassigned</span>;
}

export function renderStatusBadge(status: string) {
  const cls = status.toLowerCase().replace(/_/g, '-');
  return (
    <span className={`hstatus ${cls}`}>
      <span className={`hstatus-dot ${cls}`} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function HistoryTable({ config }: { config: HistoryTableConfig }) {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  // Cached per search and page; any of this service's socket events refreshes it.
  const params = { page: currentPage, limit: ITEMS_PER_PAGE, ...(searchTerm && { search: searchTerm }) };
  const queryKey = [config.service, 'history', params];
  const { data, isPending: loading } = useQuery({
    queryKey,
    queryFn: () => api.get<{ requests: any[]; total?: number }>(config.fetchEndpoint, { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or search loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const requests = data?.requests ?? [];
  const total = data?.total || 0;

  useEffect(() => {
    if (!data) return;
    setError('');
    // Keep an open details modal in sync, e.g. when the request is declined while it is being viewed.
    setSelectedRequest((prev: any) => (prev ? data.requests.find((r) => r._id === prev._id) || prev : prev));
  }, [data]);

  const handleCancel = async (requestId: string) => {
    if (!(await confirm({ title: 'Cancel this request?', message: 'The team will stop working on it. This cannot be undone.', confirmLabel: 'Cancel request', cancelLabel: 'Keep it', danger: true }))) return;
    try {
      await api.post(config.cancelEndpoint, { request_id: requestId });
      refreshService(config.service);
      setError('');
    } catch (error) {
      setError('Failed to cancel request');
    }
  };

  const handleNoteAdded = (note: RequestNote) => {
    if (!selectedRequest) return;
    const updated = { ...selectedRequest, notes: [...(selectedRequest.notes || []), note] };
    setSelectedRequest(updated);
    // Show the note in the list straight away, without a round trip.
    queryClient.setQueryData<{ requests: any[]; total?: number }>(queryKey, (prev) =>
      prev && { ...prev, requests: prev.requests.map((r) => (r._id === updated._id ? updated : r)) },
    );
  };

  const canAddNote = (status: string) => status === config.cancelStatus || status === 'IN_PROGRESS';

  const handleExport = () => {
    window.location.href = config.exportEndpoint;
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const defaultRender = (row: any, col: ColumnDef) => {
    if (col.render) return col.render(row);
    const value = row[col.key];
    if (value === null || value === undefined) return '-';
    return truncateCell(value);
  };

  return (
    <div className="history-page">
      {confirmDialog}
      <div className="page-header">
        <h2>{config.title}</h2>
        {requests.length > 0 && (
          <button className="btn-export" onClick={handleExport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        )}
      </div>

      <div className="filters-row">
        <SearchBox placeholder={config.searchPlaceholder} value={searchTerm} onSearch={setSearchTerm} />
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : requests.length === 0 ? (
        <EmptyState
          title={config.emptyMessage}
          hint="Requests you submit will show up here, with their status."
          action={config.newRequest}
          searchTerm={searchTerm}
          onClearSearch={() => setSearchTerm('')}
        />
      ) : (
        <>
          <div className="history-table-wrap">
            <table className="history-table stack-mobile">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Code</th>
                  {config.columns.map(col => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                  <th>Assigned To</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request, idx) => (
                  <motion.tr
                    key={request._id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.26, delay: Math.min(idx, 8) * 0.03, ease: EASE_OUT }}
                  >
                    <td data-label="Status">{renderStatusBadge(request.status)}</td>
                    <td className="td-code" data-label="Code">{request.request_code}</td>
                    {config.columns.map(col => (
                      <td key={col.key} className="td-cell" data-label={col.label}>{defaultRender(request, col)}</td>
                    ))}
                    <td className="td-cell" data-label="Assigned To">{renderAssignedTechnician(request.assignedTechnician)}</td>
                    <td className="col-actions">
                      <div className="history-actions">
                        {request.status === config.cancelStatus && (
                          <button className="hbtn hbtn-cancel" onClick={() => handleCancel(request._id)}>
                            Cancel
                          </button>
                        )}
                        {request.status === 'DONE' && (
                          <button className="hbtn hbtn-rate" onClick={() => openRating(request._id, request.request_code, config.rateType)}>
                            Rate
                          </button>
                        )}
                        <button className="hbtn hbtn-view" onClick={() => setSelectedRequest(request)}>
                          {canAddNote(request.status) ? 'View / Add note' : 'View'}
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </>
      )}

      {selectedRequest && (
        <div className="modal">
          <div className="modal-content">
            <h3>{selectedRequest[config.modalTitleKey]}</h3>
            <div className="detail-section">
              <p><strong>Request Code:</strong> {selectedRequest.request_code}</p>
              <p><strong>Status:</strong> {selectedRequest.status}</p>
              {config.modalFields.map(f => (
                <p key={f.key}>
                  <strong>{f.label}:</strong> {f.date ? formatDate(selectedRequest[f.key]) : selectedRequest[f.key] || '-'}
                </p>
              ))}
              {selectedRequest.assignedTechnician?.[0] && (
                <p><strong>Assigned To:</strong> {selectedRequest.assignedTechnician[0].first_name} {selectedRequest.assignedTechnician[0].last_name}</p>
              )}
              {config.fileViewer && selectedRequest[config.fileViewer.fileKey] && (
                <div className="file-section">
                  <p><strong>{config.fileViewer.isArray ? 'Files' : 'File'}:</strong></p>
                  <FileViewer
                    files={config.fileViewer.isArray ? selectedRequest[config.fileViewer.fileKey] : [selectedRequest[config.fileViewer.fileKey]]}
                    requestId={selectedRequest._id}
                    type={config.fileViewer.type}
                  />
                </div>
              )}
            </div>
            {selectedRequest.status === 'DONE' && (
              <StaffReport
                title="Staff report"
                remarks={selectedRequest.remarks}
                recommendation={selectedRequest.recommendation}
                showRecommendation={config.hasRecommendation}
              />
            )}
            <DeclineReason reason={selectedRequest.decline_reason} />
            <NotesList notes={selectedRequest.notes} heading="Your notes" />
            {canAddNote(selectedRequest.status) && (
              <AddNoteForm endpoint={config.noteEndpoint} requestId={selectedRequest._id} onAdded={handleNoteAdded} />
            )}
            <button data-modal-dismiss onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
