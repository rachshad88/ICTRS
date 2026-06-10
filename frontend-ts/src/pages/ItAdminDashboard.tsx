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

interface Technician {
  _id: string;
  first_name: string;
  last_name: string;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
  repaired_count: number;
  beyond_repair_count: number;
}

function ItAdminDashboard() {
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

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.role);
    }
  }, [user]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);

  const fetchData = useCallback(async (search?: string) => {
    try {
      const params: Record<string, string | number> = { filter: filterType, date: selectedDate, show_done: showDone };
      if (search) params.search = search;
      const response = await api.get('/requests/get_dashboard', { params });
      setRequests(response.data.requests);
      setCounts(response.data.counts);
      setError('');
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, [filterType, selectedDate, showDone]);

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

  const fetchTechnicians = async () => {
    try {
      const response = await api.get('/requests/get_technicians');
      setTechnicians(response.data.technicians);
    } catch (error) {
      console.error('Failed to fetch technicians:', error);
    }
  };

  const openAssignModal = async (req: Request) => {
    setSelectedRequest(req);
    setSelectedTechnician('');
    setShowAssignModal(true);
    await fetchTechnicians();
  };

  const handleAssign = async () => {
    if (!selectedRequest || !selectedTechnician) return;
    setSubmitting(true);
    try {
      await api.post('/requests/accept_request', {
        request_id: selectedRequest._id,
        technician_id: selectedTechnician
      });
      setShowAssignModal(false);
      setSelectedRequest(null);
      fetchData(searchTerm);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to assign request');
    } finally {
      setSubmitting(false);
    }
  };

  const ITEMS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm]);

  const totalPages = Math.ceil(requests.length / ITEMS_PER_PAGE);
  const paginatedRequests = requests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const getActionButtons = (req: Request) => {
    if (req.status === 'CANCELLED') {
      return <span className="hstatus cancelled"><span className="hstatus-dot cancelled" />Cancelled</span>;
    }
    if (req.status === 'DONE') {
      return <span className="hstatus done"><span className="hstatus-dot done" />Done</span>;
    }
    if (!req.assigned_to) {
      return <button className="hbtn hbtn-assign" onClick={() => openAssignModal(req)}>Assign</button>;
    }
    if (req.status === 'IN_PROGRESS') {
      return <span className="hstatus progress"><span className="hstatus-dot progress" />In Progress</span>;
    }
    return null;
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>IT Assign Dashboard</h2>
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
              {paginatedRequests.map((req) => (
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

      {showAssignModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Assign Request</h3>
            <p><strong>Request:</strong> {selectedRequest?.request_code}</p>
            <p><strong>Issue:</strong> {selectedRequest?.issue}</p>

            <div className="form-group">
              <label>Technician *</label>
              <select value={selectedTechnician} onChange={(e) => setSelectedTechnician(e.target.value)} required>
                <option value="">Select technician...</option>
                {technicians.map((tech) => (
                  <option key={tech._id} value={tech._id}>
                    {tech.first_name} {tech.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={handleAssign} disabled={submitting || !selectedTechnician}>
                {submitting ? 'Assigning...' : 'Assign'}
              </button>
              <button className="btn-secondary" onClick={() => setShowAssignModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ItAdminDashboard;