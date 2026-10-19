import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { refreshService, type Service } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, DeclineReason, DeclineForm, RequestNote } from '../components/RequestNotes';
import { RequestFlags, PriorityForm, ReassignForm, CompleteForm, PRIORITY_OPTIONS, priorityLabel, formatDay } from '../components/Priority';
import RequestProgress from '../components/RequestProgress';
import SearchBox from '../components/SearchBox';
import { DateField } from '../components/DateField';
import Select from '../components/Select';

/**
 * The multimedia admin's home: the IT admin dashboard's layout for the three media request types
 * (multimedia, digital media, print materials) in one table. Lists come from the combined
 * /overview/requests endpoint; actions go to each type's own endpoints (multimediaFactory.ts).
 */

type TypeKey = 'multimedia' | 'digital_media' | 'print_materials';

interface MediaRequest {
  _id: string;
  type: TypeKey;
  request_code: string;
  title: string | null;
  detail: string | null;
  office: string | null;
  status: string;
  priority?: string;
  due?: string | null;
  overdue?: boolean;
  assigned_to: string | null;
  requester_name: string | null;
  assignee_name: string | null;
  created_at: string;
  completed_at?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  cancelled_at?: string | null;
  reopened_at?: string | null;
  previously_completed_at?: string | null;
  decline_reason?: string | null;
  notes?: RequestNote[];
}

interface Counts {
  waiting: number;
  in_progress: number;
  urgent_open: number;
  overdue: number;
  done: number;
  declined: number;
  cancelled: number;
}

interface ListData {
  requests: MediaRequest[];
  counts: Partial<Counts>;
  total: number;
}

interface Staff {
  _id: string;
  first_name: string;
  last_name: string;
}

const NO_COUNTS: Counts = { waiting: 0, in_progress: 0, urgent_open: 0, overdue: 0, done: 0, declined: 0, cancelled: 0 };

// Per type: its label, the URL prefix of its actions, its cache key, and its full management page.
const TYPES: Record<TypeKey, { label: string; api: string; service: Service; manage: string }> = {
  multimedia: { label: 'Event Documentation', api: '/multimedia', service: 'multimedia', manage: '/multimedia-management' },
  digital_media: { label: 'Digital Media', api: '/digitalmedia', service: 'digitalMedia', manage: '/digitalmedia-management' },
  print_materials: { label: 'Print Materials', api: '/printmaterials', service: 'printMaterials', manage: '/print-materials-management' },
};

const WAITING = ['PENDING', 'UNASSIGNED'];

const PERIODS = [
  { value: 'all', label: 'All' },
  { value: 'daily', label: 'Day' },
  { value: 'weekly', label: 'Week' },
  { value: 'monthly', label: 'Month' },
];

// Heading for the requests still open from before the selected day/week/month (shown above it).
const EARLIER_LABEL: Record<string, string> = {
  daily: 'Still open from earlier days',
  weekly: 'Still open from earlier weeks',
  monthly: 'Still open from earlier months',
};
const PERIOD_LABEL: Record<string, string> = { daily: 'This day', weekly: 'This week', monthly: 'This month' };

// The counter strip, split by ticket tear lines: open work, what needs attention, how it ended.
interface StatDef { key: keyof Counts; label: string; tone?: 'accent' | 'warn' }
const STAT_GROUPS: StatDef[][] = [
  [
    { key: 'waiting', label: 'Waiting', tone: 'accent' },
    { key: 'in_progress', label: 'In progress' },
  ],
  [
    { key: 'urgent_open', label: 'Urgent (open)', tone: 'warn' },
    { key: 'overdue', label: 'Overdue', tone: 'warn' },
  ],
  [
    { key: 'done', label: 'Done' },
    { key: 'declined', label: 'Declined' },
    { key: 'cancelled', label: 'Cancelled' },
  ],
];

/** The selected day, week (Sunday to Saturday, as the IT dashboard) or month, as a created-date range. */
function periodRange(filter: string, day: string): { from: Date; to: Date } | null {
  if (filter === 'all') return null;
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (filter === 'daily') return { from: new Date(y, m - 1, d), to: new Date(y, m - 1, d, 23, 59, 59, 999) };
  if (filter === 'weekly') {
    const start = new Date(y, m - 1, d);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59, 999) };
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusClass = (s: string) => s.toLowerCase().replace(/_/g, '-');
const statusText = (s: string) => (s === 'UNASSIGNED' ? 'PENDING' : s).replace(/_/g, ' ');

function MediaAdminDashboard() {
  const { user } = useAuth();
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [typeFilter, setTypeFilter] = useState<'' | TypeKey>('');
  const [showClosed, setShowClosed] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [assignTarget, setAssignTarget] = useState<MediaRequest | null>(null);
  const [assignStaff, setAssignStaff] = useState('');
  const [assignPriority, setAssignPriority] = useState('NORMAL');
  const [manageTarget, setManageTarget] = useState<MediaRequest | null>(null);
  const [declineTarget, setDeclineTarget] = useState<MediaRequest | null>(null);
  const [detailTarget, setDetailTarget] = useState<MediaRequest | null>(null);

  const ITEMS_PER_PAGE = 10;
  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, typeFilter, showClosed, searchTerm]);

  const range = periodRange(filterType, selectedDate);
  // Filters every list here shares: type, search and the period's created-date range.
  const base = {
    ...(typeFilter && { type: typeFilter }),
    ...(searchTerm && { search: searchTerm }),
    ...(range && { from: range.from.toISOString(), to: range.to.toISOString() }),
  };
  const listParams = { ...base, ...(!showClosed && { status: 'OPEN' }), sort: 'newest', page: currentPage, limit: ITEMS_PER_PAGE };
  // ['overview', ...] keys: any request event, of any type, refreshes these (services/queryClient.ts).
  const { data, isPending: loading } = useQuery({
    queryKey: ['overview', 'media-dashboard', listParams],
    queryFn: () => api.get<ListData>('/overview/requests', { params: listParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  // The counters cover the whole period whatever "Show closed" hides, so they come on their own.
  const countParams = { ...base, limit: 1 };
  const { data: countData } = useQuery({
    queryKey: ['overview', 'media-dashboard-counts', countParams],
    queryFn: () => api.get<ListData>('/overview/requests', { params: countParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  // Requests still open from before the selected period, oldest first. Shown on page 1 above the
  // period's own requests, so nothing older is forgotten behind the Day filter (as the IT dashboard).
  const earlierParams = range
    ? {
        ...(typeFilter && { type: typeFilter }),
        ...(searchTerm && { search: searchTerm }),
        status: 'OPEN',
        to: new Date(range.from.getTime() - 1).toISOString(),
        sort: 'oldest',
        limit: 100,
      }
    : null;
  const { data: earlierData } = useQuery({
    queryKey: ['overview', 'media-dashboard-earlier', earlierParams],
    queryFn: () => api.get<ListData>('/overview/requests', { params: earlierParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user && !!earlierParams,
  });
  // Staff for the assign and reassign forms; changes only when accounts do.
  const { data: staff = [] } = useQuery({
    queryKey: ['users', 'technicians', 'multimedia'],
    queryFn: () => api.get<{ technicians: Staff[] }>('/multimedia/get_technicians').then((r) => r.data.technicians),
    staleTime: 5 * 60_000,
    enabled: !!user,
  });

  const requests = data?.requests ?? [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const earlier = earlierParams && currentPage === 1 ? earlierData?.requests ?? [] : [];
  const counts: Counts = { ...NO_COUNTS, ...countData?.counts };
  useEffect(() => { setError(''); }, [data]);

  const refresh = (r: MediaRequest) => refreshService(TYPES[r.type].service);

  const openAssign = (r: MediaRequest) => {
    setAssignTarget(r);
    setAssignStaff('');
    setAssignPriority(r.priority || 'NORMAL');
  };

  // Assigns from the modal, or "Take" (in the row) with the signed-in admin's own id.
  const assign = async (r: MediaRequest, staffId: string, priority = r.priority || 'NORMAL') => {
    if (submitting || !staffId) return;
    setSubmitting(true);
    try {
      await api.post(`${TYPES[r.type].api}/assign`, { request_id: r._id, technician_id: staffId, priority });
      setAssignTarget(null);
      refresh(r);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; message?: string } } };
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to assign request');
    } finally {
      setSubmitting(false);
    }
  };

  const closeManage = () => {
    if (manageTarget) refresh(manageTarget);
    setManageTarget(null);
  };

  const getActionButtons = (r: MediaRequest) => {
    if (r.status === 'CANCELLED') {
      return <span className="hstatus cancelled"><span className="hstatus-dot cancelled" />Cancelled</span>;
    }
    if (r.status === 'DONE') {
      return <span className="hstatus done"><span className="hstatus-dot done" />Done</span>;
    }
    if (r.status === 'RATED') {
      return <span className="hstatus rated"><span className="hstatus-dot rated" />Rated</span>;
    }
    if (r.status === 'DECLINED') {
      return <button className="hbtn hbtn-view" onClick={() => setDetailTarget(r)}>View reason</button>;
    }
    if (WAITING.includes(r.status) && !r.assigned_to) {
      return (
        <div className="history-actions">
          <button className="hbtn hbtn-assign" onClick={() => openAssign(r)}>Assign</button>
          <button className="hbtn hbtn-done" onClick={() => user && assign(r, user.user_id)} disabled={submitting}>Take</button>
          <button className="hbtn hbtn-cancel" onClick={() => setDeclineTarget(r)}>Decline</button>
        </div>
      );
    }
    if (r.status === 'IN_PROGRESS') {
      return <button className="hbtn hbtn-view" onClick={() => setManageTarget(r)}>Manage</button>;
    }
    return null;
  };

  // One table row, shared by the earlier-open group and the period's own requests.
  // Clicking a row (or its code) opens the request's details.
  const renderRow = (r: MediaRequest) => (
    <tr key={r._id} className="overview-row" onClick={() => setDetailTarget(r)}>
      <td className="td-code" data-label="Code">
        <button type="button" className="code-link" onClick={(e) => { e.stopPropagation(); setDetailTarget(r); }}>
          {r.request_code}
        </button>
        <RequestFlags priority={r.priority} overdue={r.overdue} due={r.due} reopened={!!r.reopened_at && !['DONE', 'RATED', 'CANCELLED', 'DECLINED'].includes(r.status)} />
      </td>
      <td className="td-cell" data-label="Type">{TYPES[r.type]?.label ?? r.type}</td>
      <td className="it-issue" data-label="Request" title={[r.title, r.detail].filter(Boolean).join(', ')}>
        {r.notes && r.notes.length > 0 && (
          <span className="note-count" title="Notes from the client">{r.notes.length} {r.notes.length === 1 ? 'note' : 'notes'}</span>
        )}
        {r.title || '-'}
        {r.detail && <span className="td-sub media-detail">{r.detail}</span>}
      </td>
      <td className="td-cell" data-label="Requested By">
        <span className="it-requester" title={[r.requester_name, r.office].filter(Boolean).join(', ')}>
          {r.requester_name || 'Unknown'}
          {r.office && <span className="td-sub">{r.office}</span>}
        </span>
      </td>
      <td className="td-cell" data-label="Assigned To">{r.assignee_name || '-'}</td>
      <td data-label="Status">
        <span className={`hstatus ${statusClass(r.status)}`}>
          <span className={`hstatus-dot ${statusClass(r.status)}`} />
          {statusText(r.status)}
        </span>
      </td>
      <td className="td-cell it-created" data-label="Created" title={r.completed_at ? `Completed ${formatWhen(r.completed_at)}` : undefined}>
        <span className="td-stack">
          {formatWhen(r.created_at)}
          {r.completed_at && <span className="td-sub">Completed {formatWhen(r.completed_at)}</span>}
        </span>
      </td>
      <td className="col-actions" onClick={(e) => e.stopPropagation()}>{getActionButtons(r)}</td>
    </tr>
  );

  return (
    <div className="page-wrap tech-dash it-dash media-dash">
      <div className="page-header">
        <h2>Media Assign Dashboard</h2>
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
          <Select className="tech-date" aria-label="Request type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '' | TypeKey)}>
            <option value="">All types</option>
            {(Object.keys(TYPES) as TypeKey[]).map((k) => <option key={k} value={k}>{TYPES[k].label}</option>)}
          </Select>
          <label className="tech-check" title="Done, declined and cancelled requests">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed
          </label>
        </div>
        <SearchBox className="tech-search" placeholder="Search by code, title, requester..." value={searchTerm} onSearch={setSearchTerm} />
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="tech-stats">
        {STAT_GROUPS.map((group, i) => (
          <div key={i} className="tech-stats-group">
            {group.map((stat) => (
              <div
                key={stat.key}
                className={`tech-stat ${stat.tone === 'accent' && counts[stat.key] > 0 ? 'accent' : ''} ${stat.tone === 'warn' && counts[stat.key] > 0 ? 'warn' : ''}`}
              >
                <span className="tech-stat-label">{stat.label}</span>
                <span className="tech-stat-num">{counts[stat.key]}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <>
          <div className="history-table-wrap it-table">
            <table className="history-table stack-mobile">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Request</th>
                  <th>Requested By</th>
                  <th>Assigned To</th>
                  <th>Status</th>
                  <th>Created</th>
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
          {requests.length === 0 && earlier.length === 0 && (
            <div className="history-empty">No requests match the current filter.</div>
          )}
        </>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {assignTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Assign {TYPES[assignTarget.type].label} Request</h3>
            <p><strong>Request:</strong> {assignTarget.request_code}</p>
            <p><strong>Title:</strong> {assignTarget.title || '-'}</p>
            <p><strong>Requested By:</strong> {assignTarget.requester_name || 'Unknown'}</p>
            <NotesList notes={assignTarget.notes} />
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="media-assign-staff">Multimedia staff *</label>
                <Select id="media-assign-staff" value={assignStaff} onChange={(e) => setAssignStaff(e.target.value)} required>
                  <option value="">Select staff...</option>
                  {staff.map((s) => <option key={s._id} value={s._id}>{s.first_name} {s.last_name}</option>)}
                </Select>
              </div>
              <div className="form-group">
                <label htmlFor="media-assign-priority">Priority</label>
                <Select id="media-assign-priority" value={assignPriority} onChange={(e) => setAssignPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => assign(assignTarget, assignStaff, assignPriority)} disabled={submitting || !assignStaff}>
                {submitting ? 'Assigning...' : 'Assign'}
              </button>
              <button data-modal-dismiss className="btn-secondary" onClick={() => setAssignTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {manageTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Manage {TYPES[manageTarget.type].label} Request</h3>
            <p><strong>Request:</strong> {manageTarget.request_code}</p>
            <p><strong>Title:</strong> {manageTarget.title || '-'}</p>
            <p><strong>Assigned To:</strong> {manageTarget.assignee_name || '-'}</p>
            <p>
              <strong>Priority:</strong> {priorityLabel(manageTarget.priority)}
              {manageTarget.due && <>, due {formatDay(manageTarget.due)}</>}
              <RequestFlags overdue={manageTarget.overdue} />
            </p>
            <NotesList notes={manageTarget.notes} />
            {manageTarget.assigned_to === user?.user_id && (
              <CompleteForm
                endpoint={`${TYPES[manageTarget.type].api}/complete_request`}
                requestId={manageTarget._id}
                withRecommendation
                onDone={closeManage}
              />
            )}
            <ReassignForm
              endpoint={`${TYPES[manageTarget.type].api}/reassign`}
              requestId={manageTarget._id}
              currentId={manageTarget.assigned_to}
              staff={staff}
              staffLabel="staff member"
              onDone={closeManage}
            />
            <PriorityForm
              endpoint={`${TYPES[manageTarget.type].api}/set_priority`}
              requestId={manageTarget._id}
              priority={manageTarget.priority}
              onDone={closeManage}
            />
            <div className="modal-actions">
              <button data-modal-dismiss className="btn-secondary" onClick={() => setManageTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {declineTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Decline {TYPES[declineTarget.type].label} Request</h3>
            <p><strong>Request:</strong> {declineTarget.request_code}</p>
            <p><strong>Requested By:</strong> {declineTarget.requester_name || 'Unknown'}</p>
            <p><strong>Title:</strong> {declineTarget.title || '-'}</p>
            <NotesList notes={declineTarget.notes} />
            <DeclineForm
              endpoint={`${TYPES[declineTarget.type].api}/decline`}
              requestId={declineTarget._id}
              onBack={() => setDeclineTarget(null)}
              onDeclined={() => { refresh(declineTarget); setDeclineTarget(null); }}
            />
          </div>
        </div>
      )}

      {detailTarget && (
        <div className="modal" onClick={() => setDetailTarget(null)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="media-detail-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="media-detail-title">{detailTarget.request_code}</h3>
            <div className="detail-section">
              <p><strong>Type:</strong> {TYPES[detailTarget.type]?.label ?? detailTarget.type}</p>
              <p><strong>Title:</strong> {detailTarget.title || '-'}</p>
              {detailTarget.detail && <p><strong>Details:</strong> {detailTarget.detail}</p>}
              <p><strong>Requested By:</strong> {detailTarget.requester_name || 'Unknown'}{detailTarget.office ? `, ${detailTarget.office}` : ''}</p>
              <p>
                <strong>Status:</strong>{' '}
                <span className={`hstatus ${statusClass(detailTarget.status)}`}>
                  <span className={`hstatus-dot ${statusClass(detailTarget.status)}`} />
                  {statusText(detailTarget.status)}
                </span>
              </p>
              <p><strong>Assigned To:</strong> {detailTarget.assignee_name || 'Not assigned yet'}</p>
              <p>
                <strong>Priority:</strong> {priorityLabel(detailTarget.priority)}
                {detailTarget.due && <>, due {formatDay(detailTarget.due)}</>}
                <RequestFlags overdue={detailTarget.overdue} />
              </p>
            </div>
            <RequestProgress request={detailTarget} assigneeName={detailTarget.assignee_name} />
            <DeclineReason reason={detailTarget.decline_reason} />
            <NotesList notes={detailTarget.notes} />
            <div className="modal-actions">
              {/* Files, event times and the rest live on the type's own management page. */}
              <Link className="btn-secondary" to={TYPES[detailTarget.type].manage}>Open {TYPES[detailTarget.type].label} Mgmt</Link>
              <button data-modal-dismiss type="button" className="btn-secondary" onClick={() => setDetailTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MediaAdminDashboard;
