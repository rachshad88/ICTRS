import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';

interface AssignedRequest {
  _id: string;
  request_code: string;
  proposed_title: string;
  client_name_office: string;
  statement_of_problem: string;
  objective: string;
  status: string;
  formal_request_letter: string;
  process_flow: string;
  requester: Array<{ first_name: string; last_name: string }>;
  created_at: string;
}

function ProgrammerDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<AssignedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => { setCurrentPage(1); }, []);

  const fetchData = useCallback(async () => {
    try {
      const response = await api.get('/software/get_assigned', { params: { page: currentPage, limit: 10 } });
      setRequests(response.data.requests);
      setTotal(response.data.total || 0);
      setError('');
    } catch (error) {
      console.error('Failed to fetch assigned requests:', error);
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchData();
    socket.on('software_request_assigned', handler);
    socket.on('software_request_updated', handler);
    return () => {
      socket.off('software_request_assigned', handler);
      socket.off('software_request_updated', handler);
    };
  }, [user, fetchData]);

  const handleStartWork = async (requestId: string) => {
    setSubmitting(requestId);
    try {
      await api.post('/software/start_work', { request_id: requestId });
      fetchData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to start work');
    } finally {
      setSubmitting(null);
    }
  };

  const handleComplete = async (requestId: string) => {
    if (!confirm('Mark this request as done?')) return;
    setSubmitting(requestId);
    try {
      await api.post('/software/complete_request', { request_id: requestId });
      fetchData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to complete request');
    } finally {
      setSubmitting(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const cls = status.toLowerCase().replace(/_/g, '-');
    return <span className={`hstatus ${cls}`}><span className={`hstatus-dot ${cls}`} />{status}</span>;
  };

  const getFileUrl = (reqId: string, filename: string) => `/api/files/software/${reqId}/${filename}`;

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>My Software Assignments</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : requests.length === 0 ? (
        <div className="empty-state">No assigned software requests</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Proposed Title</th>
                <th>Client/Office</th>
                <th>Status</th>
                <th>Files</th>
                <th>Created</th>
                <th className="col-actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.request_code}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{req.request_code}</td>
                  <td style={{ fontSize: '12px' }}>{req.proposed_title}</td>
                  <td style={{ fontSize: '12px' }}>{req.client_name_office}</td>
                  <td>{getStatusBadge(req.status)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <a href={getFileUrl(req._id, req.formal_request_letter)} target="_blank" rel="noopener noreferrer" className="hbtn hbtn-view" style={{ fontSize: '11px', padding: '2px 6px' }}>Letter</a>
                      <a href={getFileUrl(req._id, req.process_flow)} target="_blank" rel="noopener noreferrer" className="hbtn hbtn-view" style={{ fontSize: '11px', padding: '2px 6px' }}>Flow</a>
                    </div>
                  </td>
                  <td style={{ fontSize: '12px' }}>{req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}</td>
                  <td className="col-actions">
                    {req.status === 'ASSIGNED' && (
                      <button className="hbtn hbtn-view" onClick={() => handleStartWork(req._id)} disabled={submitting === req._id}>
                        {submitting === req._id ? '...' : 'Start Work'}
                      </button>
                    )}
                    {req.status === 'IN_PROGRESS' && (
                      <button className="hbtn hbtn-assign" onClick={() => handleComplete(req._id)} disabled={submitting === req._id}>
                        {submitting === req._id ? '...' : 'Mark Done'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 10 && (
        <div className="history-pagination">
          <button className="hbtn-page" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
          {Array.from({ length: Math.ceil(total / 10) }, (_, i) => i + 1).map(page => (
            <button key={page} className={`hbtn-page ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)}>{page}</button>
          ))}
          <button className="hbtn-page" disabled={currentPage === Math.ceil(total / 10)} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

export default ProgrammerDashboard;