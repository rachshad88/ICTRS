import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import FileViewer from './FileViewer';
import Skeleton from './Skeleton';
import Pagination from './Pagination';
import { truncateCell } from '../lib/truncate';
import { NotesList, DeclineReason, AddNoteForm, RequestNote } from './RequestNotes';

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
  cancelStatus: string;
  /** Prefix of this request type's socket events, e.g. 'multimedia' for multimedia_request_declined. */
  socketPrefix: string;
  rateType: string;
  modalTitleKey: string;
  modalFields: ModalField[];
  fileViewer?: FileViewerConfig;
}

const RATING_URL = import.meta.env.VITE_RATING_SYSTEM_URL || 'http://192.168.110.19';
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
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);

  const fetchRequests = useCallback(async (search?: string) => {
    try {
      const params: Record<string, string | number> = { page: currentPage, limit: ITEMS_PER_PAGE };
      if (search) params.search = search;
      const response = await api.get(config.fetchEndpoint, { params });
      const fresh: any[] = response.data.requests;
      setRequests(fresh);
      setTotal(response.data.total || 0);
      // Keep an open details modal in sync, e.g. when the request is declined while it is being viewed.
      setSelectedRequest((prev: any) => (prev ? fresh.find((r) => r._id === prev._id) || prev : prev));
      setError('');
    } catch (error) {
      console.error(`Failed to fetch ${config.title.toLowerCase()}:`, error);
    } finally { setLoading(false); }
  }, [currentPage, config.fetchEndpoint]);

  useEffect(() => {
    const timer = setTimeout(() => fetchRequests(searchTerm || undefined), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, fetchRequests]);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchRequests(searchTermRef.current || undefined);
    const events = ['assigned', 'completed', 'cancelled', 'declined'].map((e) => `${config.socketPrefix}_request_${e}`);
    events.forEach((e) => socket.on(e, handler));
    return () => {
      events.forEach((e) => socket.off(e, handler));
    };
  }, [user, fetchRequests, config.socketPrefix]);

  const handleCancel = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to cancel this request?')) return;
    try {
      await api.post(config.cancelEndpoint, { request_id: requestId });
      fetchRequests(searchTerm);
      setError('');
    } catch (error) {
      setError('Failed to cancel request');
    }
  };

  const handleNoteAdded = (note: RequestNote) => {
    if (!selectedRequest) return;
    const updated = { ...selectedRequest, notes: [...(selectedRequest.notes || []), note] };
    setSelectedRequest(updated);
    setRequests((prev) => prev.map((r) => (r._id === updated._id ? updated : r)));
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
        <input type="text" placeholder={config.searchPlaceholder} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : requests.length === 0 ? (
        <div className="history-empty">{config.emptyMessage}</div>
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
                    transition={{ duration: 0.26, delay: idx * 0.03, ease: [0.16, 1, 0.3, 1] }}
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
                          <button className="hbtn hbtn-rate" onClick={() => window.open(`${RATING_URL}?request_code=${request.request_code}&type=${config.rateType}`, '_blank')}>
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
            <DeclineReason reason={selectedRequest.decline_reason} />
            <NotesList notes={selectedRequest.notes} heading="Your notes" />
            {canAddNote(selectedRequest.status) && (
              <AddNoteForm endpoint={config.noteEndpoint} requestId={selectedRequest._id} onAdded={handleNoteAdded} />
            )}
            <button onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
