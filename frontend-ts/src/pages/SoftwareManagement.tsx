import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';

interface SoftwareRequest {
  _id: string;
  request_code: string;
  proposed_title: string;
  client_name_office: string;
  statement_of_problem: string;
  objective: string;
  status: string;
  rejection_reason: string | null;
  remarks: string | null;
  formal_request_letter: string;
  process_flow: string;
  requester: Array<{ first_name: string; last_name: string }>;
  assignedProgrammer: Array<{ first_name: string; last_name: string }>;
  created_at: string;
  completed_at: string | null;
}

interface Programmer {
  _id: string;
  first_name: string;
  last_name: string;
}

function SoftwareManagement() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<SoftwareRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<SoftwareRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [programmers, setProgrammers] = useState<Programmer[]>([]);
  const [selectedProgrammer, setSelectedProgrammer] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  const fetchData = useCallback(async (search?: string) => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const response = await api.get('/software/get_all', { params });
      setRequests(response.data.requests);
      setError('');
    } catch (error) {
      console.error('Failed to fetch software requests:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchData(searchTerm);
  }, [user, fetchData, searchTerm]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => { fetchData(searchTerm); };
    socket.on('software_request_created', handler);
    socket.on('software_request_updated', handler);
    return () => {
      socket.off('software_request_created', handler);
      socket.off('software_request_updated', handler);
    };
  }, [user, fetchData, searchTerm]);

  const fetchProgrammers = async () => {
    try {
      const response = await api.get('/software/get_programmers');
      setProgrammers(response.data.programmers);
    } catch (error) {
      console.error('Failed to fetch programmers:', error);
    }
  };

  const openReviewModal = async (req: SoftwareRequest) => {
    setSelectedRequest(req);
    setReviewAction('approve');
    setSelectedProgrammer('');
    setRejectionReason('');
    setShowReviewModal(true);
    await fetchProgrammers();
  };

  const handleReview = async () => {
    if (!selectedRequest) return;
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {
        request_id: selectedRequest._id,
        action: reviewAction
      };
      if (reviewAction === 'approve') {
        if (!selectedProgrammer) {
          setError('Please select a programmer');
          setSubmitting(false);
          return;
        }
        payload.technician_id = selectedProgrammer;
      } else {
        if (!rejectionReason) {
          setError('Please provide a rejection reason');
          setSubmitting(false);
          return;
        }
        payload.rejection_reason = rejectionReason;
      }

      await api.post('/software/review', payload);
      setShowReviewModal(false);
      setSelectedRequest(null);
      fetchData(searchTerm);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to review request');
    } finally {
      setSubmitting(false);
    }
  };

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(requests.length / ITEMS_PER_PAGE);
  const paginatedRequests = requests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const getStatusBadge = (status: string) => {
    const cls = status.toLowerCase().replace(/_/g, '-');
    return <span className={`hstatus ${cls}`}><span className={`hstatus-dot ${cls}`} />{status}</span>;
  };

  const getActionButton = (req: SoftwareRequest) => {
    if (req.status === 'PENDING') {
      return <button className="hbtn hbtn-assign" onClick={() => openReviewModal(req)}>Review</button>;
    }
    return null;
  };

  const getFileUrl = (reqId: string, filename: string) => `/api/files/software/${reqId}/${filename}`;

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Software Development Management</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="filters-row">
        <input type="text" placeholder="Search by code, title, client..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Proposed Title</th>
                <th>Client/Office</th>
                <th>Status</th>
                <th>Programmer</th>
                <th>Files</th>
                <th>Created</th>
                <th className="col-actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRequests.map((req) => (
                <tr key={req.request_code}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{req.request_code}</td>
                  <td style={{ fontSize: '12px' }}>{req.proposed_title}</td>
                  <td style={{ fontSize: '12px' }}>{req.client_name_office}</td>
                  <td>{getStatusBadge(req.status)}</td>
                  <td style={{ fontSize: '12px' }}>
                    {req.assignedProgrammer?.[0]
                      ? `${req.assignedProgrammer[0].first_name} ${req.assignedProgrammer[0].last_name}`
                      : '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <a href={getFileUrl(req._id, req.formal_request_letter)} target="_blank" rel="noopener noreferrer" className="hbtn hbtn-view" style={{ fontSize: '11px', padding: '2px 6px' }}>Letter</a>
                      <a href={getFileUrl(req._id, req.process_flow)} target="_blank" rel="noopener noreferrer" className="hbtn hbtn-view" style={{ fontSize: '11px', padding: '2px 6px' }}>Flow</a>
                    </div>
                  </td>
                  <td style={{ fontSize: '12px' }}>{req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}</td>
                  <td className="col-actions">{getActionButton(req)}</td>
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

      {showReviewModal && (
        <div className="modal">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <h3>Review Request</h3>
            <p><strong>Code:</strong> {selectedRequest?.request_code}</p>
            <p><strong>Title:</strong> {selectedRequest?.proposed_title}</p>
            <p><strong>Problem:</strong> {selectedRequest?.statement_of_problem}</p>
            <p><strong>Objective:</strong> {selectedRequest?.objective}</p>

            <div className="form-group">
              <label>Decision</label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input type="radio" checked={reviewAction === 'approve'} onChange={() => setReviewAction('approve')} />
                  Approve & Assign
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                  <input type="radio" checked={reviewAction === 'reject'} onChange={() => setReviewAction('reject')} />
                  Not Approve
                </label>
              </div>
            </div>

            {reviewAction === 'approve' ? (
              <div className="form-group">
                <label>Programmer *</label>
                <select value={selectedProgrammer} onChange={(e) => setSelectedProgrammer(e.target.value)} required>
                  <option value="">Select programmer...</option>
                  {programmers.map((p) => (
                    <option key={p._id} value={p._id}>{p.first_name} {p.last_name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label>Rejection Reason *</label>
                <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={3} required />
              </div>
            )}

            <div className="modal-actions">
              <button className="btn-primary" onClick={handleReview} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
              <button className="btn-secondary" onClick={() => setShowReviewModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SoftwareManagement;