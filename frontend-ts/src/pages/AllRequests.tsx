import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, DeclineReason, RequestNote } from '../components/RequestNotes';
import { RequestFlags, PRIORITY_OPTIONS, priorityLabel, formatDay } from '../components/Priority';

interface OverviewRequest {
  _id: string;
  type: string;
  request_code: string;
  title: string;
  detail?: string | null;
  office?: string | null;
  requester_name?: string | null;
  assignee_name?: string | null;
  status: string;
  priority: string;
  due: string | null;
  overdue: boolean;
  created_at: string;
  completed_at?: string | null;
  decline_reason?: string | null;
  notes?: RequestNote[];
}

interface Counts {
  total: number;
  open: number;
  unassigned: number;
  urgent_open: number;
  overdue: number;
  done: number;
}

interface Meta {
  types: Array<{ key: string; label: string }>;
  staff: Array<{ _id: string; name: string; team: string }>;
  offices: string[];
}

interface Filters {
  search: string;
  type: string;
  status: string;
  priority: string;
  office: string;
  assigned_to: string;
  from: string;
  to: string;
  overdue: boolean;
  sort: string;
}

const DEFAULT_FILTERS: Filters = {
  search: '', type: '', status: '', priority: '', office: '', assigned_to: '', from: '', to: '', overdue: false, sort: 'newest',
};

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open (not finished)' },
  { value: 'PENDING', label: 'Pending / Unassigned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'priority', label: 'Most urgent first' },
  { value: 'due', label: 'Due soonest' },
];

// Each tile narrows the list to one slice; clicking an active tile removes that narrowing.
const TILES: Array<{ key: keyof Counts; label: string; filter: Partial<Filters>; warn?: boolean }> = [
  { key: 'open', label: 'Open', filter: { status: 'OPEN' } },
  { key: 'unassigned', label: 'Unassigned', filter: { status: 'OPEN', assigned_to: 'unassigned' } },
  { key: 'urgent_open', label: 'Urgent', filter: { status: 'OPEN', priority: 'URGENT' }, warn: true },
  { key: 'overdue', label: 'Overdue', filter: { overdue: true }, warn: true },
  { key: 'done', label: 'Done', filter: { status: 'DONE' } },
];

// Where an admin goes to act on a request, and the role that page needs.
const MANAGE_PAGES: Record<string, { to: string; role: string; label: string }> = {
  it: { to: '/it-dashboard', role: 'IT_ADMIN', label: 'IT Assign Dashboard' },
  multimedia: { to: '/multimedia-management', role: 'MULTIMEDIA_ADMIN', label: 'Multimedia Management' },
  digital_media: { to: '/digitalmedia-management', role: 'MULTIMEDIA_ADMIN', label: 'Digital Media Management' },
  print_materials: { to: '/print-materials-management', role: 'MULTIMEDIA_ADMIN', label: 'Print Materials Management' },
};

const REFRESH_EVENTS = ['request_update', ...['multimedia', 'digital_media', 'print_materials'].flatMap((p) =>
  ['created', 'assigned_admin', 'completed', 'cancelled', 'declined', 'priority_changed'].map((e) => `${p}_request_${e}`))];

const STORAGE_KEY = 'all-requests-filters';
const PAGE_SIZE = 15;

function loadFilters(): Filters {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_FILTERS, ...JSON.parse(saved) } : DEFAULT_FILTERS;
  } catch {
    return DEFAULT_FILTERS;
  }
}

const toLocalDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const statusClass = (s: string) => s.toLowerCase().replace(/_/g, '-');
const statusText = (s: string) => s.replace(/_/g, ' ');
const formatDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

// Date inputs are local calendar days; send the matching instants so the server's timezone doesn't matter.
function dayBoundary(day: string, end: boolean) {
  const [y, m, d] = day.split('-').map(Number);
  return (end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d)).toISOString();
}

function AllRequests() {
  const { user } = useAuth();
  const roles = user?.roles || (user ? [user.role] : []);
  const [meta, setMeta] = useState<Meta>({ types: [], staff: [], offices: [] });
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [search, setSearch] = useState(filters.search);
  const [requests, setRequests] = useState<OverviewRequest[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, open: 0, unassigned: 0, urgent_open: 0, overdue: 0, done: 0 });
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<OverviewRequest | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ }
  }, [filters]);

  // Every filter change returns to page 1 in the same render, so only one fetch goes out.
  const updateFilters = useCallback((update: (f: Filters) => Filters) => {
    setFilters(update);
    setCurrentPage(1);
  }, []);

  // Debounce typing into the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== filters.search) updateFilters((f) => ({ ...f, search }));
    }, 300);
    return () => clearTimeout(t);
  }, [search, filters.search, updateFilters]);

  useEffect(() => {
    api.get('/overview/meta')
      .then((res) => setMeta(res.data))
      .catch(() => setError('Could not load the filter options.'));
  }, []);

  const fetchData = useCallback(async () => {
    const params: Record<string, string | number> = { page: currentPage, limit: PAGE_SIZE, sort: filters.sort };
    if (filters.search.trim()) params.search = filters.search.trim();
    if (filters.type) params.type = filters.type;
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.office) params.office = filters.office;
    if (filters.assigned_to) params.assigned_to = filters.assigned_to;
    if (filters.overdue) params.overdue = '1';
    if (filters.from) params.from = dayBoundary(filters.from, false);
    if (filters.to) params.to = dayBoundary(filters.to, true);
    try {
      const res = await api.get('/overview/requests', { params });
      setRequests(res.data.requests);
      setCounts(res.data.counts);
      setTotalPages(res.data.totalPages || 0);
      setError('');
    } catch {
      setError('Could not load requests. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [filters, currentPage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (user) initSocket();
  }, [user]);

  // Live updates: refetch shortly after any request changes, batching bursts of events.
  const fetchRef = useRef(fetchData);
  useEffect(() => { fetchRef.current = fetchData; }, [fetchData]);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchRef.current(), 500);
    };
    REFRESH_EVENTS.forEach((e) => socket.on(e, handler));
    return () => {
      clearTimeout(timer);
      REFRESH_EVENTS.forEach((e) => socket.off(e, handler));
    };
  }, [user]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => updateFilters((f) => ({ ...f, [key]: value }));

  const tileActive = (filter: Partial<Filters>) =>
    (Object.keys(filter) as Array<keyof Filters>).every((k) => filters[k] === filter[k]);

  const toggleTile = (filter: Partial<Filters>) => {
    const keys = Object.keys(filter) as Array<keyof Filters>;
    if (tileActive(filter)) {
      updateFilters((f) => ({ ...f, ...Object.fromEntries(keys.map((k) => [k, DEFAULT_FILTERS[k]])) }));
    } else {
      // Tiles are alternatives, so drop the narrowing of any other tile first.
      const cleared = { status: '', priority: '', assigned_to: '', overdue: false };
      updateFilters((f) => ({ ...f, ...cleared, ...filter }));
    }
  };

  const resetFilters = () => {
    setSearch('');
    updateFilters(() => DEFAULT_FILTERS);
  };

  const typeLabel = (key: string) => meta.types.find((t) => t.key === key)?.label || key;
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const manage = selected ? MANAGE_PAGES[selected.type] : null;

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>All Requests</h2>
      </div>

      <div className="overview-stats">
        <div className="overview-stat" aria-live="polite">
          <span>Matching</span>
          <strong>{counts.total}</strong>
        </div>
        {TILES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`overview-stat ${t.warn && counts[t.key] > 0 ? 'warn' : ''} ${tileActive(t.filter) ? 'active' : ''}`}
            aria-pressed={tileActive(t.filter)}
            onClick={() => toggleTile(t.filter)}
          >
            <span>{t.label}</span>
            <strong>{counts[t.key]}</strong>
          </button>
        ))}
      </div>

      <div className="overview-filters">
        <label className="overview-search">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, title, office, requester or staff name"
          />
        </label>
        {meta.types.length > 1 && (
          <label>
            Type
            <select value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="">All types</option>
              {meta.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
        )}
        <label>
          Status
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>
          Priority
          <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>
          Office
          <select value={filters.office} onChange={(e) => setFilter('office', e.target.value)}>
            <option value="">All offices</option>
            {meta.offices.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>
          Assigned to
          <select value={filters.assigned_to} onChange={(e) => setFilter('assigned_to', e.target.value)}>
            <option value="">Anyone</option>
            <option value="unassigned">Not assigned yet</option>
            {meta.staff.map((s) => (
              <option key={s._id} value={s._id}>{s.name}{meta.types.length > 1 ? ` (${s.team})` : ''}</option>
            ))}
          </select>
        </label>
        <label>
          Created from
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label>
          Created to
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        <label>
          Sort
          <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="overview-check">
          <input type="checkbox" checked={filters.overdue} onChange={(e) => setFilter('overdue', e.target.checked)} />
          Overdue only
        </label>
        {isFiltered && (
          <button type="button" className="hbtn overview-reset" onClick={resetFilters}>Clear filters</button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <Skeleton variant="table" rows={6} />
      ) : requests.length === 0 ? (
        <div className="history-empty">
          {isFiltered ? 'No requests match these filters.' : 'No requests yet.'}
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                <th>Code</th>
                <th>Summary</th>
                <th>Requested By</th>
                <th>Assigned To</th>
                <th>Due</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={`${r.type}-${r._id}`} className="overview-row" onClick={() => setSelected(r)}>
                  <td className="td-code" data-label="Code">
                    <span className="td-stack">
                      <button type="button" className="code-link" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>
                        {r.request_code}
                      </button>
                      <span className="req-flags">
                        <span className={`type-tag ${r.type}`}>{typeLabel(r.type)}</span>
                        <RequestFlags priority={r.priority} overdue={r.overdue} />
                      </span>
                    </span>
                  </td>
                  <td className="td-wrap" data-label="Summary">
                    <span className="td-stack">
                      {r.title || '-'}
                      {r.detail && r.detail.trim() && <span className="td-sub">{r.detail}</span>}
                    </span>
                  </td>
                  <td className="td-cell td-wrap" data-label="Requested By">
                    <span className="td-stack">
                      {r.requester_name || 'Unknown'}
                      {r.office && <span className="td-sub">{r.office}</span>}
                    </span>
                  </td>
                  <td className="td-cell" data-label="Assigned To">{r.assignee_name || '-'}</td>
                  <td className="td-cell" data-label="Due">{r.due ? formatDay(r.due) : '-'}</td>
                  <td data-label="Status">
                    <span className={`hstatus ${statusClass(r.status)}`}>
                      <span className={`hstatus-dot ${statusClass(r.status)}`} />
                      {statusText(r.status)}
                    </span>
                  </td>
                  <td className="td-cell" data-label="Created">{formatDay(toLocalDay(r.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {selected && (
        <div className="modal" onClick={() => setSelected(null)}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="overview-detail-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="overview-detail-title">{selected.request_code}</h3>
            <div className="detail-section">
              <p><strong>Type:</strong> {typeLabel(selected.type)}</p>
              <p><strong>Summary:</strong> {selected.title || '-'}</p>
              {selected.detail && selected.detail.trim() && <p><strong>Details:</strong> {selected.detail}</p>}
              <p>
                <strong>Status:</strong>{' '}
                <span className={`hstatus ${statusClass(selected.status)}`}>
                  <span className={`hstatus-dot ${statusClass(selected.status)}`} />
                  {statusText(selected.status)}
                </span>
              </p>
              <p><strong>Priority:</strong> {priorityLabel(selected.priority)}<RequestFlags overdue={selected.overdue} /></p>
              <p><strong>{selected.type === 'it' ? 'Due date' : 'Event / target date'}:</strong> {selected.due ? formatDay(selected.due) : 'Not set'}</p>
              <p><strong>Office:</strong> {selected.office || '-'}</p>
              <p><strong>Requested By:</strong> {selected.requester_name || 'Unknown'}</p>
              <p><strong>Assigned To:</strong> {selected.assignee_name || 'Not assigned yet'}</p>
              <p><strong>Created:</strong> {formatDateTime(selected.created_at)}</p>
              {selected.completed_at && <p><strong>Completed:</strong> {formatDateTime(selected.completed_at)}</p>}
            </div>
            <DeclineReason reason={selected.decline_reason} />
            <NotesList notes={selected.notes} />
            <div className="modal-actions">
              {manage && roles.includes(manage.role) && (
                <Link to={manage.to} className="btn-primary">Open {manage.label}</Link>
              )}
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AllRequests;
