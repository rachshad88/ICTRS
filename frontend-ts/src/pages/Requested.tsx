import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';


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
  created_at: string;
  completed_at: string | null;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
}

function Requested() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending_count: 0, progress_count: 0, done_count: 0 });
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  const fetchData = useCallback(async (search?: string, page?: number) => {
    try {
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      params.page = page || currentPage;
      params.limit = 10;
      const response = await api.get('/requests/my_requests', { params });
      setRequests(response.data.requests);
      setCounts(response.data.counts);
      setTotal(response.data.total);
      setError('');
    } catch (error) {
      console.error('Failed to fetch requests:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const sendToCSF = (requestCode: string) => {
    try {
      const ratingUrl = `${import.meta.env.VITE_RATING_SYSTEM_URL || 'http://localhost:3001/rate'}?request_code=${requestCode}&type=it_request`;
      window.open(ratingUrl, '_blank');
    } catch (error) {
      console.error('Failed to send data to rating system:', error);
    }
  }

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);
  const pageRef = useRef(currentPage);
  useEffect(() => { pageRef.current = currentPage; }, [currentPage]);

  useEffect(() => {
    const timer = setTimeout(() => fetchData(searchTerm, currentPage), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, currentPage, fetchData]);

  useEffect(() => {
    
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData(undefined, 1);
    }
  }, [user, fetchData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchData(searchTermRef.current, pageRef.current);
    socket.on('my_request_accepted', handler);
    socket.on('my_request_finished', handler);
    socket.on('request_update', handler);
    return () => {
      socket.off('my_request_accepted', handler);
      socket.off('my_request_finished', handler);
      socket.off('request_update', handler);
    };
  }, [user, fetchData]);

  const handleCancel = async (requestId: string) => {
    if (!window.confirm('Are you sure you want to cancel this request?')) return;
    
    try {
      await api.post('/requests/cancel_request', { request_id: requestId });
      fetchData(searchTerm, currentPage);
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
    return 'status-' + status.toLowerCase().replace(' ', '-');
  };

  return (
    <div className="requested-page">

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
        </div>

        <div className="filters-row">
          <input type="text" placeholder="Search by code, issue, office..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
        </div>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">
            <Skeleton variant="table" rows={5} />
            <p>Loading your requests...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h3>No requests yet</h3>
            <p>You haven't submitted any support requests.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="requests-table">
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
                      <td className="request-code">{req.request_code}</td>
                      <td className="issue-cell">{req.issue}</td>
                      <td>
                        <span className={`status-badge ${getStatusClass(req.status)}`}>
                          {req.status === 'PENDING' && 'Pending'}
                          {req.status === 'IN_PROGRESS' && 'In Progress'}
                          {req.status === 'DONE' && 'Completed'}
                          {req.status === 'CANCELLED' && 'Cancelled'}
                        </span>
                      </td>
                      <td className="date-cell">{formatDate(req.created_at)}</td>
                      <td className="date-cell">{formatDate(req.completed_at)}</td>
                      <td>
                        {req.status === 'PENDING' && !isAssigned && user?.role === 'CLIENT' && (
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
                              onClick={() => sendToCSF(req.request_code)}
                              style={{ padding: '6px 12px', fontSize: '11px' }}
                            >
                              Rate
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
    </div>
  );
}

export default Requested;
