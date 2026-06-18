import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';

interface SoftwareRequest {
  _id: string;
  request_code: string;
  proposed_title: string;
  client_name_office: string;
  statement_of_problem: string;
  objective: string;
  formal_request_letter: string;
  process_flow: string;
  status: string;
  rejection_reason: string | null;
  remarks: string | null;
  assignedProgrammer: Array<{ first_name: string; last_name: string }>;
  created_at: string;
  completed_at: string | null;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
}

function SoftwareHistory() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SoftwareRequest[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending_count: 0, progress_count: 0, done_count: 0 });
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<SoftwareRequest | null>(null);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);
  const pageRef = useRef(currentPage);
  useEffect(() => { pageRef.current = currentPage; }, [currentPage]);

  const fetchData = useCallback(async (search?: string, page?: number) => {
    try {
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      params.page = page || currentPage;
      params.limit = 10;
      const response = await api.get('/software/get_history', { params });
      setRequests(response.data.requests || []);
      setCounts(response.data.counts || { pending_count: 0, progress_count: 0, done_count: 0 });
      setTotal(response.data.total || 0);
      setError('');
    } catch (error) {
      console.error('Failed to fetch software history:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => fetchData(searchTerm, currentPage), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, currentPage, fetchData]);

  useEffect(() => {
    if (user) fetchData(undefined, 1);
  }, [user, fetchData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchData(searchTermRef.current, pageRef.current);
    socket.on('software_request_updated', handler);
    socket.on('software_request_completed', handler);
    socket.on('software_request_approved', handler);
    socket.on('software_request_rejected', handler);
    return () => {
      socket.off('software_request_updated', handler);
      socket.off('software_request_completed', handler);
      socket.off('software_request_approved', handler);
      socket.off('software_request_rejected', handler);
    };
  }, [user, fetchData]);

  const handleCancel = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to cancel this request?')) return;
    try {
      await api.post('/software/cancel_request', { request_id: requestId });
      fetchData(searchTerm, currentPage);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to cancel request');
    }
  };

  const sendToCSF = (requestCode: string) => {
    try {
      const ratingUrl = `${import.meta.env.VITE_RATING_SYSTEM_URL || 'http://localhost:3001/rate'}?request_code=${requestCode}&type=software_request`;
      window.open(ratingUrl, '_blank');
    } catch (error) {
      console.error('Failed to send data to rating system:', error);
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
  const getStatusClass = (status: string) => 'status-' + status.toLowerCase().replace('_', '-');
  const getProgrammer = (req: SoftwareRequest) => req.assignedProgrammer?.[0]
    ? `${req.assignedProgrammer[0].first_name} ${req.assignedProgrammer[0].last_name}`
    : '-';
  const getFileUrl = (reqId: string, filename: string) => `/api/files/software/${reqId}/${filename}`;

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      PENDING: 'Pending',
      ASSIGNED: 'Assigned',
      IN_PROGRESS: 'In Progress',
      DONE: 'Completed',
      NOT_APPROVED: 'Not Approved',
      CANCELLED: 'Cancelled'
    };
    return labels[status] || status;
  };

  return (
    <div className="requested-page">
      <div className="container">
        <div className="page-header">
          <h2>Software Request History</h2>
          <p className="page-subtitle">Track your software development requests</p>
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
        </div>

        <div className="filters-row">
          <input type="text" placeholder="Search by code, title, problem, objective..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
        </div>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">
            <Skeleton variant="table" rows={5} />
            <p>Loading your requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#128203;</div>
            <h3>No requests yet</h3>
            <p>You haven't submitted any software development requests.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="requests-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Proposed Title</th>
                  <th>Status</th>
                  <th>Programmer</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req._id}>
                    <td className="request-code">{req.request_code}</td>
                    <td className="issue-cell">{req.proposed_title}</td>
                    <td>
                      <span className={`status-badge ${getStatusClass(req.status)}`}>
                        {statusLabel(req.status)}
                      </span>
                    </td>
                    <td className="date-cell">{getProgrammer(req)}</td>
                    <td className="date-cell">{formatDate(req.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {req.status === 'PENDING' && (
                          <button onClick={() => handleCancel(req._id)} className="btn btn-sm btn-cancel">Cancel</button>
                        )}
                        {req.status === 'DONE' && (
                          <button className="btn-rate" onClick={() => sendToCSF(req.request_code)} style={{ padding: '6px 12px', fontSize: '11px' }}>Rate</button>
                        )}
                        <button className="btn btn-sm btn-view" onClick={() => setSelectedRequest(req)}>View</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="history-pagination">
            <button className="hbtn-page" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button key={page} className={`hbtn-page ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)}>{page}</button>
            ))}
            <button className="hbtn-page" disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
          </div>
        )}
      </div>

      {selectedRequest && (
        <div className="modal-overlay" onClick={() => setSelectedRequest(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h3>{selectedRequest.request_code}</h3>
              <button className="modal-close" onClick={() => setSelectedRequest(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: '20px', fontSize: '13px', lineHeight: '1.6' }}>
              <div className="detail-row">
                <span className="detail-label">Status</span>
                <span className={`status-badge ${getStatusClass(selectedRequest.status)}`}>{statusLabel(selectedRequest.status)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Proposed Title</span>
                <span>{selectedRequest.proposed_title}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Client/Office</span>
                <span>{selectedRequest.client_name_office}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Statement of Problem</span>
                <span>{selectedRequest.statement_of_problem}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Objective</span>
                <span>{selectedRequest.objective}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Programmer</span>
                <span>{getProgrammer(selectedRequest)}</span>
              </div>
              {selectedRequest.rejection_reason && (
                <div className="detail-row">
                  <span className="detail-label">Rejection Reason</span>
                  <span style={{ color: '#ef4444' }}>{selectedRequest.rejection_reason}</span>
                </div>
              )}
              {selectedRequest.remarks && (
                <div className="detail-row">
                  <span className="detail-label">Remarks</span>
                  <span>{selectedRequest.remarks}</span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span>{formatDate(selectedRequest.created_at)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Completed</span>
                <span>{formatDate(selectedRequest.completed_at)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Files</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <a href={getFileUrl(selectedRequest._id, selectedRequest.formal_request_letter)} target="_blank" rel="noopener noreferrer" className="hbtn hbtn-view" style={{ fontSize: '11px', padding: '4px 10px' }}>Formal Request Letter</a>
                  <a href={getFileUrl(selectedRequest._id, selectedRequest.process_flow)} target="_blank" rel="noopener noreferrer" className="hbtn hbtn-view" style={{ fontSize: '11px', padding: '4px 10px' }}>Process Flow</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SoftwareHistory;