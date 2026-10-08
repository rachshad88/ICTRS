import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { refreshService } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import AnimatedNumber from '../components/AnimatedNumber';
import { RequestNote } from '../components/RequestNotes';
import FinishRequestModal from '../components/FinishRequestModal';
import { RequestFlags } from '../components/Priority';
import { EASE_OUT, staggerContainer, staggerItem } from '../lib/motion';
import SearchBox from '../components/SearchBox';

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
  priority?: string;
  due_date?: string | null;
  overdue?: boolean;
  notes?: RequestNote[];
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
  repaired_count: number;
  beyond_repair_count: number;
}

interface DashboardData {
  requests: Request[];
  counts: Counts;
  total?: number;
}

const NO_COUNTS: Counts = { pending_count: 0, progress_count: 0, done_count: 0, repaired_count: 0, beyond_repair_count: 0 };

// Heading for the requests still open from before the selected day/week/month (shown above it).
const EARLIER_LABEL: Record<string, string> = {
  daily: 'Still open from earlier days',
  weekly: 'Still open from earlier weeks',
  monthly: 'Still open from earlier months',
};
const PERIOD_LABEL: Record<string, string> = { daily: 'This day', weekly: 'This week', monthly: 'This month' };

function Dashboard() {
  const { user } = useAuth();
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [showDone, setShowDone] = useState('1');

  const [finishTarget, setFinishTarget] = useState<Request | null>(null);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm]);

  // Cached per filter and page (services/queryClient.ts); IT socket events refresh it.
  const params = { filter: filterType, date: selectedDate, show_done: showDone, page: currentPage, limit: 10, ...(searchTerm && { search: searchTerm }) };
  const { data, isPending: loading } = useQuery({
    queryKey: ['it', 'dashboard', params],
    queryFn: () => api.get<DashboardData>('/requests/get_dashboard', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or filter loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const requests = data?.requests ?? [];
  const counts = data?.counts ?? NO_COUNTS;
  const total = data?.total || 0;
  // Requests still open from before the selected period, oldest first (open_earlier=1). Shown on
  // page 1 above the period's own requests, so nothing older is forgotten behind the Daily filter.
  const earlierParams = { filter: filterType, date: selectedDate, open_earlier: '1', limit: 100, ...(searchTerm && { search: searchTerm }) };
  const { data: earlierData } = useQuery({
    queryKey: ['it', 'dashboard-earlier', earlierParams],
    queryFn: () => api.get<DashboardData>('/requests/get_dashboard', { params: earlierParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user && filterType !== 'all',
  });
  const earlier = filterType !== 'all' && currentPage === 1 ? earlierData?.requests ?? [] : [];
  // A successful refresh clears an earlier action error, as the hand-rolled fetch used to.
  useEffect(() => { setError(''); }, [data]);

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
      return <button className="hbtn hbtn-view" onClick={() => setFinishTarget(req)}>Mark Done</button>;
    }
    if (req.status === 'PENDING' && !req.assigned_to) {
      return <span className="td-code">Pending</span>;
    }
    return null;
  };

  // One table row, shared by the earlier-open group and the period's own requests.
  const renderRow = (req: Request) => (
    <motion.tr
      key={req.request_code}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: EASE_OUT }}
    >
      <td className="td-code" data-label="Code">
        {req.request_code}
        <RequestFlags priority={req.priority} overdue={req.overdue} due={req.due_date} />
      </td>
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
          {req.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td className="td-cell" data-label="Created">{req.created_at}</td>
      <td className="td-cell" data-label="Completed">{req.completed_at}</td>
      <td className="col-actions">{getActionButtons(req)}</td>
    </motion.tr>
  );

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="filters-row">
        <SearchBox placeholder="Search by code, issue, office..." value={searchTerm} onSearch={setSearchTerm} />

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
                {earlier.length > 0 && (
                  <tr className="group-row"><td colSpan={8}>{EARLIER_LABEL[filterType]} ({earlier.length})</td></tr>
                )}
                {earlier.map(renderRow)}
                {earlier.length > 0 && (
                  <tr className="group-row"><td colSpan={8}>{PERIOD_LABEL[filterType]}{requests.length === 0 ? ': nothing yet' : ''}</td></tr>
                )}
                {requests.map(renderRow)}
              </tbody>
            </table>
          </div>
          {requests.length === 0 && earlier.length === 0 && <div className="history-empty">No requests match the current filter. Try broadening search criteria.</div>}
        </>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {finishTarget && (
        <FinishRequestModal
          request={finishTarget}
          onClose={() => setFinishTarget(null)}
          onFinished={() => { setFinishTarget(null); refreshService('it'); }}
          onError={setError}
        />
      )}
    </div>
  );
}

export default Dashboard;
