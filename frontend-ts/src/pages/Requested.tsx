import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { queryClient, refreshService } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import RequestProgress from '../components/RequestProgress';
import MovPhotos from '../components/MovPhotos';
import { useConfirm } from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import RequestTicket from '../components/RequestTicket';
import { truncateCell } from '../lib/truncate';
import { openRating } from '../services/rating';
import { NotesList, DeclineReason, StaffReport, AddNoteForm, ReopenForm, canReopen, RequestNote } from '../components/RequestNotes';
import SearchBox from '../components/SearchBox';
import { isCompleted } from '../lib/status';


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
  accepted_at?: string | null;
  declined_at?: string | null;
  cancelled_at?: string | null;
  reopened_at?: string | null;
  previously_completed_at?: string | null;
  decline_reason?: string | null;
  notes?: RequestNote[];
  /** Photos of the finished work (MOV), checked by an IT admin before the request is done. */
  mov?: { files: string[] } | null;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  verification_count?: number;
  done_count: number;
  declined_count: number;
}

interface MyRequestsData {
  requests: MyRequest[];
  counts: Counts;
  total: number;
}

const NO_COUNTS: Counts = { pending_count: 0, progress_count: 0, done_count: 0, declined_count: 0 };

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS', 'FOR_VERIFICATION'];

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  FOR_VERIFICATION: 'For Verification',
  DONE: 'Completed',
  RATED: 'Rated',
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

  const detailsButton = (req: MyRequest) => (
    <button className="btn btn-sm btn-view" onClick={() => setSelectedRequest(req)}>
      {OPEN_STATUSES.includes(req.status) ? 'Details / Add note' : 'Details'}
    </button>
  );

  const cancelButton = (req: MyRequest) => req.status === 'PENDING' && user?.roles?.includes('CLIENT') && (
    <button
      onClick={() => handleCancel(req._id)}
      className="btn btn-sm btn-cancel"
    >
      Cancel
    </button>
  );

  // Once rated, the rating system won't take another, so the button goes.
  const rateButton = (req: MyRequest) => req.status === 'DONE' && (
    <button
      className="btn-rate"
      onClick={() => openRating(req._id, req.request_code, 'it_request')}
    >
      Rate
    </button>
  );

  const resultLabel = (req: MyRequest) => (req.finished === 'repaired' ? 'Repaired' : 'Beyond Repair');

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

      {/* Same header row, counter strip and fit-the-window layout as the IT dashboards (pages.css). */}
      <div className="container tech-dash it-dash client-dash">
        <div className="page-header">
          <h2>My Requests</h2>
          <SearchBox className="tech-search" placeholder="Search by code, issue, office..." value={searchTerm} onSearch={setSearchTerm} />
        </div>

        <div className="tech-stats">
          <div className="tech-stats-group">
            <div className="tech-stat"><span className="tech-stat-label">Pending</span><span className="tech-stat-num">{counts.pending_count}</span></div>
            <div className="tech-stat accent"><span className="tech-stat-label">In progress</span><span className="tech-stat-num">{counts.progress_count + (counts.verification_count || 0)}</span></div>
            <div className="tech-stat"><span className="tech-stat-label">Completed</span><span className="tech-stat-num">{counts.done_count}</span></div>
            <div className="tech-stat"><span className="tech-stat-label">Declined</span><span className="tech-stat-num">{counts.declined_count}</span></div>
          </div>
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
          <>
            <div className="table-container it-table hide-on-mobile">
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
                        <td className="issue-cell" data-label="Issue" title={req.issue}>{truncateCell(req.issue)}</td>
                        <td data-label="Status">
                          <span className={`status-badge ${getStatusClass(req.status)}`}>
                            {STATUS_LABELS[req.status] || req.status}
                          </span>
                        </td>
                        <td className="date-cell" data-label="Created">{formatDate(req.created_at)}</td>
                        <td className="date-cell" data-label="Completed">{formatDate(req.completed_at)}</td>
                        <td className="col-actions">
                          <span className="req-actions">
                          {detailsButton(req)}
                          {cancelButton(req)}
                          {isCompleted(req.status) && (
                            <span className="req-actions">
                              <span className={`status-badge ${req.finished === 'repaired' ? 'badge-repaired' : 'badge-beyond-repair'}`}>
                                {resultLabel(req)}
                              </span>
                              {rateButton(req)}
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

            <div className="rq-ticket-list">
              {requests.map((req, idx) => (
                <RequestTicket
                  key={req._id}
                  index={idx}
                  type="IT Request"
                  code={req.request_code}
                  title={req.issue}
                  status={req.status}
                  statusLabel={STATUS_LABELS[req.status]}
                  meta={[
                    ...(req.unit ? [{ label: 'Unit', value: req.unit }] : []),
                    { label: 'Created', value: formatDate(req.created_at) },
                    ...(req.completed_at ? [{ label: 'Completed', value: formatDate(req.completed_at) }] : []),
                  ]}
                  rows={isCompleted(req.status)
                    ? [{ label: 'Result', value: resultLabel(req) }]
                    : OPEN_STATUSES.includes(req.status)
                      ? [{ label: 'Technician', value: req.assigned_to ? 'Assigned' : 'Not assigned yet' }]
                      : []}
                  actions={<>{cancelButton(req)}{rateButton(req)}{detailsButton(req)}</>}
                />
              ))}
            </div>
          </>
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
              </div>
              <RequestProgress request={selectedRequest} />
              {(isCompleted(selectedRequest.status) || selectedRequest.status === 'FOR_VERIFICATION') && (
                <StaffReport
                  title="Technician's report"
                  result={selectedRequest.finished === 'repaired' ? 'Repaired' : 'Beyond Repair'}
                  remarks={selectedRequest.remarks}
                  recommendation={selectedRequest.recommendation}
                  showRecommendation
                />
              )}
              <MovPhotos requestId={selectedRequest._id} files={selectedRequest.mov?.files} heading="Photos of the finished work" />
              {canReopen(selectedRequest.status, selectedRequest.completed_at) && (
                <ReopenForm requestId={selectedRequest._id} onReopened={() => refreshService('it')} />
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
