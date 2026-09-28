import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import AnimatedNumber from '../components/AnimatedNumber';
import { NotesList, RequestNote } from '../components/RequestNotes';
import { staggerContainer, staggerItem } from '../lib/motion';

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
  notes?: RequestNote[];
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
    if (req.status === 'DECLINED') {
      return <span className="hstatus declined"><span className="hstatus-dot declined" />Declined</span>;
    }
    if (req.status === 'IN_PROGRESS') {
      return <button className="hbtn hbtn-view" onClick={() => openFinishModal(req)}>Mark Done</button>;
    }
    if (req.status === 'PENDING' && !req.assigned_to) {
      return <span className="td-code">Pending</span>;
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

      <motion.div className="stats-container" variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div className="stat-card" variants={staggerItem}>
          <div className="stat-label">Pending Requests</div>
          <div className="stat-number"><AnimatedNumber value={counts.pending_count} /></div>
          <p className="stat-note">Requests awaiting technician assignment.</p>
        </motion.div>
        <motion.div className="stat-card" variants={staggerItem}>
          <div className="stat-label">In Progress</div>
          <div className="stat-number"><AnimatedNumber value={counts.progress_count} /></div>
          <p className="stat-note">Requests currently being serviced.</p>
        </motion.div>
        <motion.div className="stat-card" variants={staggerItem}>
          <div className="stat-label">Completed</div>
          <div className="stat-number"><AnimatedNumber value={counts.done_count} /></div>
          <p className="stat-note">Requests finished this period.</p>
        </motion.div>
        <motion.div className="stat-card" variants={staggerItem}>
          <div className="stat-label">Repaired</div>
          <div className="stat-number"><AnimatedNumber value={counts.repaired_count} /></div>
          <p className="stat-note">Equipment successfully repaired.</p>
        </motion.div>
        <motion.div className="stat-card" variants={staggerItem}>
          <div className="stat-label">Beyond Repair</div>
          <div className="stat-number"><AnimatedNumber value={counts.beyond_repair_count} /></div>
          <p className="stat-note">Requests requiring escalation.</p>
        </motion.div>
      </motion.div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <>
          <div className="history-table-wrap">
            <table className="history-table stack-mobile">
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
                  <motion.tr
                    key={req.request_code}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <td className="td-code" data-label="Code">{req.request_code}</td>
                    <td className="td-cell" data-label="Office">{req.office}</td>
                    <td className="td-cell" data-label="Requested By">{req.client_name}</td>
                    <td data-label="Issue">
                      {req.issue}
                      {req.notes && req.notes.length > 0 && (
                        <span className="note-count" title="Notes from the client">{req.notes.length} {req.notes.length === 1 ? 'note' : 'notes'}</span>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={`hstatus ${req.statusClass}`}>
                        <span className={`hstatus-dot ${req.statusClass}`} />
                        {req.status}
                      </span>
                    </td>
                    <td className="td-cell" data-label="Created">{req.created_at}</td>
                    <td className="td-cell" data-label="Completed">{req.completed_at}</td>
                    <td className="col-actions">{getActionButtons(req)}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          {requests.length === 0 && <div className="history-empty">No requests match the current filter. Try broadening search criteria.</div>}
        </>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Mark Request as Done</h3>
            <p><strong>Request:</strong> {selectedRequest?.request_code}</p>
            <p><strong>Issue:</strong> {selectedRequest?.issue}</p>
            <NotesList notes={selectedRequest?.notes} />

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
