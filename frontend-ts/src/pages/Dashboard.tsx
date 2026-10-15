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
import { DateField } from '../components/DateField';

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
  /** Reopened by the client ("still not fixed") and open again. */
  reopened?: boolean;
  notes?: RequestNote[];
  /** Why an IT admin sent this request's MOV back (it is in progress again). */
  mov_return_reason?: string | null;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  verification_count: number;
  done_count: number;
  repaired_count: number;
  beyond_repair_count: number;
}

interface DashboardData {
  requests: Request[];
  counts: Counts;
  total?: number;
}

const NO_COUNTS: Counts = { pending_count: 0, progress_count: 0, verification_count: 0, done_count: 0, repaired_count: 0, beyond_repair_count: 0 };

// Heading for the requests still open from before the selected day/week/month (shown above it).
const EARLIER_LABEL: Record<string, string> = {
  daily: 'Still open from earlier days',
  weekly: 'Still open from earlier weeks',
  monthly: 'Still open from earlier months',
};
const PERIOD_LABEL: Record<string, string> = { daily: 'This day', weekly: 'This week', monthly: 'This month' };

const PERIODS = [
  { value: 'all', label: 'All' },
  { value: 'daily', label: 'Day' },
  { value: 'weekly', label: 'Week' },
  { value: 'monthly', label: 'Month' },
];

// The counters, in two groups: work still open, and how this period's finished work turned out.
// The hint is the tooltip (the old cards printed it under each number).
interface StatDef { key: keyof Counts; label: string; hint: string; tone?: 'accent' | 'warn' }
const OPEN_STATS: StatDef[] = [
  { key: 'pending_count', label: 'Pending', hint: 'Requests awaiting technician assignment.' },
  { key: 'progress_count', label: 'In progress', hint: 'Requests currently being serviced.', tone: 'accent' },
  { key: 'verification_count', label: 'For verification', hint: 'Finished, waiting for the IT admin to check the MOV.' },
];
const CLOSED_STATS: StatDef[] = [
  { key: 'done_count', label: 'Completed', hint: 'Requests finished this period.' },
  { key: 'repaired_count', label: 'Repaired', hint: 'Equipment successfully repaired.' },
  { key: 'beyond_repair_count', label: 'Beyond repair', hint: 'Requests requiring escalation.', tone: 'warn' },
];

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
    if (req.status === 'FOR_VERIFICATION') {
      return <span className="td-sub">Waiting for the IT admin</span>;
    }
    if (req.status === 'IN_PROGRESS') {
      return <button className="hbtn hbtn-view" onClick={() => setFinishTarget(req)}>{req.mov_return_reason ? 'Resend MOV' : 'Mark Done'}</button>;
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
        <RequestFlags priority={req.priority} overdue={req.overdue} due={req.due_date} reopened={req.reopened} />
      </td>
      <td className="td-cell" data-label="Requested By">
        {req.client_name}
        <span className="td-sub">{req.office}</span>
      </td>
      <td className="tech-issue" data-label="Issue">
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
        {req.mov_return_reason && <span className="td-sub mov-returned-sub">MOV returned: {req.mov_return_reason}</span>}
      </td>
      <td className="td-cell tech-dates" data-label="Filed">
        {req.created_at}
        {req.completed_at && req.completed_at !== '-' && <span className="td-sub">Done {req.completed_at}</span>}
      </td>
      <td className="col-actions">{getActionButtons(req)}</td>
    </motion.tr>
  );

  return (
    <div className="page-wrap tech-dash">
      <div className="page-header">
        <h2>Dashboard</h2>
        <div className="tech-toolbar">
          <div className="tech-period" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={filterType === p.value ? 'on' : ''}
                aria-pressed={filterType === p.value}
                onClick={() => setFilterType(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* "All" ignores the date, so the picker is off rather than silently doing nothing. */}
          <DateField className="tech-date" aria-label="Date" value={selectedDate} disabled={filterType === 'all'} onChange={setSelectedDate} />
          <label className="tech-check">
            <input type="checkbox" checked={showDone === '1'} onChange={(e) => setShowDone(e.target.checked ? '1' : '0')} />
            Show done
          </label>
        </div>
        <SearchBox className="tech-search" placeholder="Search by code, issue, office..." value={searchTerm} onSearch={setSearchTerm} />
      </div>

      {error && <div className="error-message">{error}</div>}

      <motion.div className="tech-stats" variants={staggerContainer} initial="hidden" animate="visible">
        {[OPEN_STATS, CLOSED_STATS].map((group, i) => (
          <div key={i} className="tech-stats-group">
            {group.map((stat) => (
              <motion.div
                key={stat.key}
                variants={staggerItem}
                className={`tech-stat ${stat.tone === 'accent' ? 'accent' : ''} ${stat.tone === 'warn' && counts[stat.key] > 0 ? 'warn' : ''}`}
                title={stat.hint}
              >
                <span className="tech-stat-label">{stat.label}</span>
                <span className="tech-stat-num"><AnimatedNumber value={counts[stat.key]} /></span>
              </motion.div>
            ))}
          </div>
        ))}
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
                  <th>Requested By</th>
                  <th>Issue</th>
                  <th>Status</th>
                  <th>Filed</th>
                  <th className="col-actions">Action</th>
                </tr>
              </thead>
              <tbody>
                {earlier.length > 0 && (
                  <tr className="group-row"><td colSpan={6}>{EARLIER_LABEL[filterType]} ({earlier.length})</td></tr>
                )}
                {earlier.map(renderRow)}
                {earlier.length > 0 && (
                  <tr className="group-row"><td colSpan={6}>{PERIOD_LABEL[filterType]}{requests.length === 0 ? ': nothing yet' : ''}</td></tr>
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
