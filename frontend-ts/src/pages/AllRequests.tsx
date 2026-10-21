import { useState, useEffect, useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, DeclineReason, RequestNote } from '../components/RequestNotes';
import { RequestFlags, priorityLabel, formatDay } from '../components/Priority';
import RequestProgress from '../components/RequestProgress';
import MovPhotos from '../components/MovPhotos';
import SearchBox from '../components/SearchBox';
import { DateRangeField } from '../components/DateField';
import Select from '../components/Select';
import RequestTicket from '../components/RequestTicket';

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
  accepted_at?: string | null;
  declined_at?: string | null;
  cancelled_at?: string | null;
  reopened_at?: string | null;
  previously_completed_at?: string | null;
  decline_reason?: string | null;
  notes?: RequestNote[];
  /** IT only: photos of the finished work (MOV). */
  mov_files?: string[];
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
  assigned_to: string;
  from: string;
  to: string;
  overdue: boolean;
  sort: string;
}

const DEFAULT_FILTERS: Filters = {
  search: '', type: '', status: '', priority: '', assigned_to: '', from: '', to: '', overdue: false, sort: 'newest',
};

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open (not finished)' },
  { value: 'PENDING', label: 'Pending / Unassigned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'FOR_VERIFICATION', label: 'For verification (IT)' },
  { value: 'DONE', label: 'Done (rated or not)' },
  { value: 'RATED', label: 'Rated' },
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
  multimedia: { to: '/multimedia-management', role: 'MULTIMEDIA_ADMIN', label: 'Event Documentation Management' },
  digital_media: { to: '/digitalmedia-management', role: 'MULTIMEDIA_ADMIN', label: 'Digital Media Management' },
  print_materials: { to: '/print-materials-management', role: 'MULTIMEDIA_ADMIN', label: 'Print Materials Management' },
};

const NO_META: Meta = { types: [], staff: [], offices: [] };
// Still being worked on; a reopened request stops being flagged once it is done again.
const OPEN = ['PENDING', 'UNASSIGNED', 'IN_PROGRESS', 'FOR_VERIFICATION'];
const NO_COUNTS: Counts = { total: 0, open: 0, unassigned: 0, urgent_open: 0, overdue: 0, done: 0 };

const STORAGE_KEY = 'all-requests-filters';
const PAGE_SIZE = 15;

function loadFilters(): Filters {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_FILTERS;
    // Priority, office and assignee have no dropdowns any more (search covers office and names,
    // the tiles cover urgent and unassigned), so a choice saved from before must not stay applied
    // where it can't be seen or cleared.
    const parsed = JSON.parse(saved) as Partial<Filters>;
    const f = { ...DEFAULT_FILTERS };
    for (const k of Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>) {
      if (parsed[k] !== undefined) (f as Record<string, unknown>)[k] = parsed[k];
    }
    if (f.priority !== 'URGENT') f.priority = '';
    if (f.assigned_to !== 'unassigned') f.assigned_to = '';
    return f;
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
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<OverviewRequest | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ }
  }, [filters]);

  // Every filter change returns to page 1 in the same render, so only one fetch goes out.
  const updateFilters = useCallback((update: (f: Filters) => Filters) => {
    setFilters(update);
    setCurrentPage(1);
  }, []);

  // Filter options (request types, staff, offices) change only with accounts and settings.
  const metaQuery = useQuery({
    queryKey: ['meta', 'overview'],
    queryFn: () => api.get<Meta>('/overview/meta').then((r) => r.data),
    staleTime: 5 * 60_000,
    enabled: !!user,
  });
  const meta = metaQuery.data ?? NO_META;

  const params: Record<string, string | number> = { page: currentPage, limit: PAGE_SIZE, sort: filters.sort };
  if (filters.search.trim()) params.search = filters.search.trim();
  if (filters.type) params.type = filters.type;
  if (filters.status) params.status = filters.status;
  if (filters.priority) params.priority = filters.priority;
  if (filters.assigned_to) params.assigned_to = filters.assigned_to;
  if (filters.overdue) params.overdue = '1';
  if (filters.from) params.from = dayBoundary(filters.from, false);
  if (filters.to) params.to = dayBoundary(filters.to, true);

  // Every service's requests, cached per filter set and page. Socket events from any service
  // refresh it, batched per burst (['overview'] in services/queryClient.ts).
  const listQuery = useQuery({
    queryKey: ['overview', 'requests', params],
    queryFn: () => api.get<{ requests: OverviewRequest[]; counts: Counts; totalPages?: number }>('/overview/requests', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or filter loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const requests = listQuery.data?.requests ?? [];
  const counts = listQuery.data?.counts ?? NO_COUNTS;
  const totalPages = listQuery.data?.totalPages || 0;
  const loading = listQuery.isPending;
  const error = listQuery.isError
    ? 'Could not load requests. Try again in a moment.'
    : metaQuery.isError ? 'Could not load the filter options.' : '';

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
        <div className="overview-search">
          <span>Search</span>
          <SearchBox
            value={filters.search}
            onSearch={(term) => setFilter('search', term)}
            placeholder="Code, title, office, requester or staff name"
          />
        </div>
        {meta.types.length > 1 && (
          <label>
            Type
            <Select value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="">All types</option>
              {meta.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </label>
        )}
        <label>
          Status
          <Select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
        <label>
          Created
          <DateRangeField
            placeholder="Any date"
            range={filters.from && filters.to ? { from: filters.from, to: filters.to } : null}
            onChange={(r) => updateFilters((f) => ({ ...f, from: r.from, to: r.to }))}
            onClear={filters.from || filters.to ? () => updateFilters((f) => ({ ...f, from: '', to: '' })) : undefined}
          />
        </label>
        <label>
          Sort
          <Select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
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
        <>
          <div className="history-table-wrap hide-on-mobile">
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
                          <RequestFlags priority={r.priority} overdue={r.overdue} reopened={!!r.reopened_at && OPEN.includes(r.status)} />
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
          <div className="rq-ticket-list">
            {requests.map((r, idx) => (
              <RequestTicket
                key={`${r.type}-${r._id}`}
                index={idx}
                type={typeLabel(r.type)}
                code={r.request_code}
                onOpen={() => setSelected(r)}
                flags={<RequestFlags priority={r.priority} overdue={r.overdue} reopened={!!r.reopened_at && OPEN.includes(r.status)} />}
                title={r.title || '-'}
                sub={r.detail && r.detail.trim() ? r.detail : undefined}
                status={r.status}
                statusLabel={statusText(r.status)}
                meta={[
                  { label: 'Requested by', value: r.requester_name || 'Unknown' },
                  ...(r.office ? [{ label: 'Office', value: r.office }] : []),
                  { label: 'Created', value: formatDay(toLocalDay(r.created_at)) },
                  { label: 'Due', value: r.due ? formatDay(r.due) : '-' },
                ]}
                rows={[{ label: 'Assigned to', value: r.assignee_name || 'Not assigned yet' }]}
                actions={<button type="button" className="hbtn hbtn-view" onClick={() => setSelected(r)}>Details</button>}
              />
            ))}
          </div>
        </>
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
            </div>
            <RequestProgress request={selected} assigneeName={selected.assignee_name} />
            {selected.type === 'it' && <MovPhotos requestId={selected._id} code={selected.request_code} files={selected.mov_files} />}
            <DeclineReason reason={selected.decline_reason} />
            <NotesList notes={selected.notes} />
            <div className="modal-actions">
              {manage && roles.includes(manage.role) && (
                <Link to={manage.to} className="btn-primary">Open {manage.label}</Link>
              )}
              <button data-modal-dismiss type="button" className="btn-secondary" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AllRequests;
