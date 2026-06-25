import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';

interface Request {
  _id: string;
  request_code: string;
  office: string;
  unit: string;
  issue: string;
  client_name: string;
  status: string;
  statusClass: string;
  created_at: string;
  completed_at: string;
  assigned_to: string | null;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
  repaired_count: number;
  beyond_repair_count: number;
}

function Dashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [counts, setCounts] = useState<Counts>({
    pending_count: 0,
    progress_count: 0,
    done_count: 0,
    repaired_count: 0,
    beyond_repair_count: 0
  });
  const [filterType, setFilterType] = useState('all');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showDone, setShowDone] = useState('1');
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [finished, setFinished] = useState('repaired');
  const [remarks, setRemarks] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);

  const fetchData = useCallback(async (search?: string) => {
    try {
      const params: Record<string, string | number> = { filter: filterType, date: selectedDate, show_done: showDone, page: currentPage, limit: 10 };
      if (search) params.search = search;
      const response = await api.get('/requests/get_dashboard', { params });
      setRequests(response.data.requests);
      setCounts(response.data.counts);
      setTotal(response.data.total || 0);
      setError('');
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, [filterType, selectedDate, showDone, currentPage]);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData(searchTerm);
    }
  }, [user, fetchData, searchTerm]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchData(searchTermRef.current);
    socket.on('request_update', handler);
    return () => {
      socket.off('request_update', handler);
    };
  }, [user, fetchData]);

  const openFinishModal = (req: Request) => {
    setSelectedRequest(req);
    setFinished('repaired');
    setRemarks('');
    setRecommendation('');
    setShowModal(true);
  };

  const handleMarkDone = async () => {
    if (!selectedRequest || !user) return;
    setSubmitting(true);

    const payload = {
      request_id: selectedRequest._id,
      finished,
      ...(remarks && { remarks }),
      ...(recommendation && { recommendation })
    };

    try {
      await api.post('/requests/request_finish', payload);
      setShowModal(false);
      setSelectedRequest(null);
      fetchData(searchTerm);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; error?: string; details?: unknown[] } } };
      const errorMsg = err.response?.data?.message || err.response?.data?.error || 'Failed to mark request as done';
      setError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const getActionButtons = (req: Request) => {
    if (req.status === 'CANCELLED') {
      return <span className="hstatus cancelled"><span className="hstatus-dot cancelled" />Cancelled</span>;
    }
    if (req.status === 'DONE') {
      return <span className="hstatus done"><span className="hstatus-dot done" />Done</span>;
    }
    if (req.status === 'IN_PROGRESS') {
      return <button className="hbtn hbtn-view" onClick={() => openFinishModal(req)}>Mark Done</button>;
    }
    if (req.status === 'PENDING' && !req.assigned_to) {
      return <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Pending</span>;
    }
    return null;
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="filters-row">
        <input type="text" placeholder="Search by code, issue, office..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />

        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="all">All</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>

        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />

        <label>
          <input type="checkbox" checked={showDone === '1'} onChange={(e) => setShowDone(e.target.checked ? '1' : '0')} />
          <span>Show Done</span>
        </label>
      </div>

      <div className="stat-row">
        <div className="stat-card-sm">
          <h4>Pending</h4>
          <p className="stat-num">{counts.pending_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>In Progress</h4>
          <p className="stat-num">{counts.progress_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Done</h4>
          <p className="stat-num">{counts.done_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Repaired</h4>
          <p className="stat-num">{counts.repaired_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Beyond Repair</h4>
          <p className="stat-num">{counts.beyond_repair_count}</p>
        </div>
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Office</th>
                <th>Requested By</th>
                <th>Issue</th>
                <th>Status</th>
                <th>Created</th>
                <th>Completed</th>
                <th className="col-actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.request_code}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{req.request_code}</td>
                  <td style={{ fontSize: '12px' }}>{req.office}</td>
                  <td style={{ fontSize: '12px' }}>{req.client_name}</td>
                  <td>{req.issue}</td>
                  <td>
                    <span className={`hstatus ${req.statusClass}`}>
                      <span className={`hstatus-dot ${req.statusClass}`} />
                      {req.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px' }}>{req.created_at}</td>
                  <td style={{ fontSize: '12px' }}>{req.completed_at}</td>
                  <td className="col-actions">{getActionButtons(req)}</td>
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

      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Mark Request as Done</h3>
            <p><strong>Request:</strong> {selectedRequest?.request_code}</p>
            <p><strong>Issue:</strong> {selectedRequest?.issue}</p>

            <div className="form-group">
              <label>Status *</label>
              <select value={finished} onChange={(e) => setFinished(e.target.value)} required>
                <option value="repaired">Repaired</option>
                <option value="beyond repair">Beyond Repair</option>
              </select>
            </div>

            <div className="form-group">
              <label>Remarks</label>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Optional" />
            </div>

            <div className="form-group">
              <label>Recommendation</label>
              <textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} rows={3} placeholder="Optional" />
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={handleMarkDone} disabled={submitting}>
                {submitting ? 'Saving...' : 'Save'}
              </button>
              <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
