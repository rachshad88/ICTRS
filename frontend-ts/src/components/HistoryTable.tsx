import { useState, useEffect } from 'react';
import { api } from '../services/api';
import FileViewer from './FileViewer';
import Skeleton from './Skeleton';

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
  exportEndpoint: string;
  columns: ColumnDef[];
  searchPlaceholder: string;
  emptyMessage: string;
  cancelStatus: string;
  rateType: string;
  modalTitleKey: string;
  modalFields: ModalField[];
  fileViewer?: FileViewerConfig;
}

const RATING_URL = import.meta.env.VITE_RATING_SYSTEM_URL || 'http://localhost:3001/rate';
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
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const fetchRequests = async (search?: string) => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const response = await api.get(config.fetchEndpoint, { params });
      setRequests(response.data.requests);
      setError('');
    } catch (error) {
      console.error(`Failed to fetch ${config.title.toLowerCase()}:`, error);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchRequests(searchTerm || undefined), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

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

  const handleExport = () => {
    window.location.href = config.exportEndpoint;
  };

  const totalPages = Math.ceil(requests.length / ITEMS_PER_PAGE);
  const paginatedRequests = requests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const defaultRender = (row: any, col: ColumnDef) => {
    if (col.render) return col.render(row);
    const value = row[col.key];
    if (value === null || value === undefined) return '-';
    return value;
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
            <table className="history-table">
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
                {paginatedRequests.map((request) => (
                  <tr key={request._id}>
                    <td>{renderStatusBadge(request.status)}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{request.request_code}</td>
                    {config.columns.map(col => (
                      <td key={col.key} style={{ fontSize: '12px' }}>{defaultRender(request, col)}</td>
                    ))}
                    <td style={{ fontSize: '12px' }}>{renderAssignedTechnician(request.assignedTechnician)}</td>
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
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="history-pagination">
              <button className="hbtn-page" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button key={page} className={`hbtn-page ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)}>{page}</button>
              ))}
              <button className="hbtn-page" disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
            </div>
          )}
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
            <button onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
