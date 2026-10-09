import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { queryClient, refreshService } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useConfirm } from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import { truncateCell } from '../lib/truncate';
import { openRating } from '../services/rating';
import { NotesList, DeclineReason, StaffReport, AddNoteForm, RequestNote } from '../components/RequestNotes';
import SearchBox from '../components/SearchBox';


interface MyRequest {
  _id: string;
  request_code: string;
  office: string;
  unit: string;
  semester: string;
  issue: string;
  status: string;
  assigned_to: string | null;
  finished: string | null;
  remarks?: string | null;
  recommendation?: string | null;
  created_at: string;
  completed_at: string | null;
  decline_reason?: string | null;
  notes?: RequestNote[];
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
  declined_count: number;
}

interface MyRequestsData {
  requests: MyRequest[];
  counts: Counts;
  total: number;
}

const NO_COUNTS: Counts = { pending_count: 0, progress_count: 0, done_count: 0, declined_count: 0 };

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS'];

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  DONE: 'Completed',
  CANCELLED: 'Cancelled',
  DECLINED: 'Declined',
};

function Requested() {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  const [selectedRequest, setSelectedRequest] = useState<MyRequest | null>(null);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  // Cached per search and page (services/queryClient.ts); IT socket events, including the
  // my_request_* ones about this client's own requests, refresh it.
  const params = { page: currentPage, limit: 10, ...(searchTerm && { search: searchTerm }) };
  const { data, isPending: loading } = useQuery({
    queryKey: ['it', 'my-requests', params],
    queryFn: () => api.get<MyRequestsData>('/requests/my_requests', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or search loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const requests = data?.requests ?? [];
  const counts = data?.counts ?? NO_COUNTS;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (!data) return;
    setError('');
    // Keep an open details modal in sync, e.g. when the request is declined while it is being viewed.
    setSelectedRequest((prev) => (prev ? data.requests.find((r) => r._id === prev._id) || prev : prev));
  }, [data]);

  const handleCancel = async (requestId: string) => {
    if (!(await confirm({ title: 'Cancel this request?', message: 'The team will stop working on it. This cannot be undone.', confirmLabel: 'Cancel request', cancelLabel: 'Keep it', danger: true }))) return;

    try {
      await api.post('/requests/cancel_request', { request_id: requestId });
      refreshService('it');
    } catch (error) {
      setError('Failed to cancel request');
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const getStatusClass = (status: string) => {
    return 'badge-' + status.toLowerCase().replace(/_/g, '-');
  };

  const handleNoteAdded = (note: RequestNote) => {
    if (!selectedRequest) return;
    const updated = { ...selectedRequest, notes: [...(selectedRequest.notes || []), note] };
    setSelectedRequest(updated);
    // Show the note in the list straight away, without a round trip.
    queryClient.setQueryData<MyRequestsData>(['it', 'my-requests', params], (prev) =>
      prev && { ...prev, requests: prev.requests.map((r) => (r._id === updated._id ? updated : r)) },
    );
  };

  return (
    <div className="requested-page">
      {confirmDialog}

      <div className="container">
        <div className="page-header">
          <h2>My Requests</h2>
          <p className="page-subtitle">Track and manage your support tickets</p>
        </div>
        
        <div className="stats-container">
          <div className="stat-card">
            <div className="stat-label">Pending</div>
            <div className="stat-number">{counts.pending_count}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">In Progress</div>
            <div className="stat-number">{counts.progress_count}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Completed</div>
            <div className="stat-number">{counts.done_count}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Declined</div>
            <div className="stat-number">{counts.declined_count}</div>
          </div>
        </div>

        <div className="filters-row">
          <SearchBox placeholder="Search by code, issue, office..." value={searchTerm} onSearch={setSearchTerm} />
        </div>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">
            <Skeleton variant="table" rows={5} />
            <p>Loading your requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            title="No requests yet"
            hint="You haven't submitted any IT support requests."
            action={{ to: '/request', label: 'Make an IT request' }}
            searchTerm={searchTerm}
            onClearSearch={() => setSearchTerm('')}
          />
        ) : (
          <div className="table-container">
            <table className="requests-table stack-mobile">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Issue</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => {
                  const isAssigned = req.assigned_to !== null;
                  return (
                    <tr key={req._id}>
                      <td className="request-code" data-label="Request ID">{req.request_code}</td>
                      <td className="issue-cell" data-label="Issue">{truncateCell(req.issue)}</td>
                      <td data-label="Status">
                        <span className={`status-badge ${getStatusClass(req.status)}`}>
                          {STATUS_LABELS[req.status] || req.status}
                        </span>
                      </td>
                      <td className="date-cell" data-label="Created">{formatDate(req.created_at)}</td>
                      <td className="date-cell" data-label="Completed">{formatDate(req.completed_at)}</td>
                      <td className="col-actions">
                        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-view" onClick={() => setSelectedRequest(req)}>
                          {OPEN_STATUSES.includes(req.status) ? 'Details / Add note' : 'Details'}
                        </button>
                        {req.status === 'PENDING' && user?.roles?.includes('CLIENT') && (
                          <button 
                            onClick={() => handleCancel(req._id)}
                            className="btn btn-sm btn-cancel"
                          >
                            Cancel
                          </button>
                        )}
                        {req.status === 'DONE' && (
                          <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <span className={`status-badge ${req.finished === 'repaired' ? 'badge-repaired' : 'badge-beyond-repair'}`}>
                              {req.finished === 'repaired' ? 'Repaired' : 'Beyond Repair'}
                            </span>
                            <button 
                              className="btn-rate"
                              onClick={() => openRating(req._id, req.request_code, 'it_request')}
                              style={{ padding: '6px 12px', fontSize: '11px' }}
                            >
                              Rate
                            </button>
                          </span>
                        )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

        {selectedRequest && (
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-content">
              <h3>Request {selectedRequest.request_code}</h3>
              <div className="detail-section">
                <p><strong>Status:</strong> {STATUS_LABELS[selectedRequest.status] || selectedRequest.status}</p>
                <p><strong>Unit:</strong> {selectedRequest.unit || '-'}</p>
                <p><strong>Issue:</strong> {selectedRequest.issue}</p>
                <p><strong>Created:</strong> {formatDate(selectedRequest.created_at)}</p>
                {selectedRequest.completed_at && <p><strong>Completed:</strong> {formatDate(selectedRequest.completed_at)}</p>}
              </div>
              {selectedRequest.status === 'DONE' && (
                <StaffReport
                  title="Technician's report"
                  result={selectedRequest.finished === 'repaired' ? 'Repaired' : 'Beyond Repair'}
                  remarks={selectedRequest.remarks}
                  recommendation={selectedRequest.recommendation}
                  showRecommendation
                />
              )}
              <DeclineReason reason={selectedRequest.decline_reason} />
              <NotesList notes={selectedRequest.notes} heading="Your notes" />
              {OPEN_STATUSES.includes(selectedRequest.status) && (
                <AddNoteForm endpoint="/requests/add_note" requestId={selectedRequest._id} onAdded={handleNoteAdded} />
              )}
              <div className="modal-actions">
                <button data-modal-dismiss className="btn-secondary" onClick={() => setSelectedRequest(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Requested;
