import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';

interface StatsData {
  user_counts: Record<string, number>;
  it_counts: Record<string, number>;
  multimedia_counts: Record<string, number>;
  digital_counts: Record<string, number>;
  print_counts: Record<string, number>;
  recent_requests: Array<{
    type: string;
    request_code: string;
    status: string;
    created_at: string;
  }>;
  recent_audit: Array<{
    username: string;
    action: string;
    entity_type: string;
    details: string;
    timestamp: string;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  FOR_VERIFICATION: 'For Verification',
  DONE: 'Completed',
  NOT_APPROVED: 'Not Approved',
  CANCELLED: 'Cancelled',
  DECLINED: 'Declined',
  UNASSIGNED: 'Unassigned',
};

// Columns of the "Requests by service" table: each groups the statuses that mean the same thing
// across services (IT says PENDING where multimedia says UNASSIGNED for "nobody assigned yet").
const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'waiting', label: 'Waiting', statuses: ['PENDING', 'UNASSIGNED'] },
  { key: 'active', label: 'In progress', statuses: ['ASSIGNED', 'IN_PROGRESS'] },
  { key: 'verify', label: 'For verification', statuses: ['FOR_VERIFICATION'] },
  { key: 'done', label: 'Done', statuses: ['DONE'] },
  { key: 'closed', label: 'Closed', statuses: ['CANCELLED', 'DECLINED', 'NOT_APPROVED'] },
];

const SERVICES: Array<{ key: keyof StatsData; label: string; manage: string }> = [
  { key: 'it_counts', label: 'IT', manage: '/it-dashboard' },
  { key: 'multimedia_counts', label: 'Multimedia', manage: '/multimedia-management' },
  { key: 'digital_counts', label: 'Digital Media', manage: '/digitalmedia-management' },
  { key: 'print_counts', label: 'Print Materials', manage: '/print-materials-management' },
];

const ROLE_LABELS: Record<string, string> = {
  CLIENT: 'Clients',
  TECHNICIAN: 'Technicians',
  MULTIMEDIA: 'Multimedia staff',
  IT_ADMIN: 'IT admins',
  MULTIMEDIA_ADMIN: 'Multimedia admins',
  ADMIN: 'Super admins',
};

const sum = (counts: Record<string, number>, statuses?: string[]) =>
  Object.entries(counts).reduce((n, [s, c]) => (!statuses || statuses.includes(s) ? n + c : n), 0);

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Today: the time only. Earlier: the date. The full date and time is the tooltip. */
function shortTime(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function AdminDashboard() {
  const { user } = useAuth();
  // Counts across every service; any service's socket events refresh them (['overview'] in
  // services/queryClient.ts).
  const { data = null, isPending: loading, error: loadError } = useQuery({
    queryKey: ['overview', 'admin-stats'],
    queryFn: () => api.get<StatsData>('/dashboard/admin-stats').then((r) => r.data),
    enabled: !!user,
  });
  // Only a failed first load replaces the page; a failed background refresh keeps the last counts.
  const error = !data && loadError
    ? (loadError as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load dashboard'
    : '';

  if (loading) {
    return (
      <div className="page-wrap">
        <div className="page-header"><h2>Admin Dashboard</h2></div>
        <Skeleton variant="table" rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-wrap">
        <div className="page-header"><h2>Admin Dashboard</h2></div>
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const userTotal = sum(data.user_counts);
  const rows = SERVICES.map((svc) => ({ ...svc, counts: data[svc.key] as Record<string, number> }));
  const allCounts = rows.reduce<Record<string, number>>((acc, r) => {
    for (const [s, c] of Object.entries(r.counts)) acc[s] = (acc[s] || 0) + c;
    return acc;
  }, {});

  const getStatusClass = (s: string) => {
    const map: Record<string, string> = {
      PENDING: 'pending', ASSIGNED: 'pending', UNASSIGNED: 'pending',
      IN_PROGRESS: 'in-progress', FOR_VERIFICATION: 'for-verification', DONE: 'done',
      NOT_APPROVED: 'cancelled', CANCELLED: 'cancelled', DECLINED: 'declined',
    };
    return map[s] || 'pending';
  };

  // A count cell; zero is drawn faint so the numbers that matter stand out.
  const countCell = (n: number) => <td className={n === 0 ? 'adm-zero' : undefined}>{n}</td>;

  return (
    <div className="page-wrap adm-dash">
      <div className="page-header">
        <h2>Admin Dashboard</h2>
      </div>

      <div className="adm-grid adm-grid--top">
        <section className="adm-panel" aria-labelledby="adm-services">
          <header className="adm-panel-head">
            <h3 id="adm-services">Requests by service</h3>
            <Link to="/all-requests">All requests</Link>
          </header>
          <div className="adm-ledger-wrap">
            <table className="adm-ledger">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  {COLUMNS.map((c) => <th key={c.key} scope="col">{c.label}</th>)}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const waiting = sum(r.counts, COLUMNS[0].statuses);
                  return (
                    <tr key={r.key}>
                      <th scope="row"><Link to={r.manage}>{r.label}</Link></th>
                      {/* Requests nobody is assigned to yet: the one number an admin acts on. */}
                      <td className={waiting === 0 ? 'adm-zero' : undefined}>
                        {waiting > 0 ? (
                          <Link to={r.manage} className="adm-waiting" title={`Assign ${r.label} requests`}>{waiting}</Link>
                        ) : 0}
                      </td>
                      {COLUMNS.slice(1).map((c) => <Fragment key={c.key}>{countCell(sum(r.counts, c.statuses))}</Fragment>)}
                      <td className="adm-total">{sum(r.counts)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All services</th>
                  {COLUMNS.map((c) => <Fragment key={c.key}>{countCell(sum(allCounts, c.statuses))}</Fragment>)}
                  <td className="adm-total">{sum(allCounts)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="adm-panel" aria-labelledby="adm-users">
          <header className="adm-panel-head">
            <h3 id="adm-users">Users <span className="adm-head-count">{userTotal}</span></h3>
            <Link to="/users">Manage</Link>
          </header>
          <dl className="adm-roles">
            {Object.entries(data.user_counts)
              .sort(([, a], [, b]) => b - a)
              .map(([role, count]) => (
                <div key={role}>
                  <dt>{ROLE_LABELS[role] || role}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
          </dl>
        </section>
      </div>

      <div className="adm-grid">
        <section className="adm-panel" aria-labelledby="adm-recent">
          <header className="adm-panel-head">
            <h3 id="adm-recent">Recent requests</h3>
            <Link to="/all-requests">View all</Link>
          </header>
          {data.recent_requests.length === 0 ? (
            <p className="adm-empty">No requests yet.</p>
          ) : (
            <ul className="adm-list">
              {data.recent_requests.map((r, i) => (
                <li key={i}>
                  <span className="adm-list-main">
                    <span className="td-code">{r.request_code}</span>
                    <span className="adm-list-sub">{r.type}</span>
                  </span>
                  <span className={`hstatus ${getStatusClass(r.status)}`}>
                    <span className={`hstatus-dot ${getStatusClass(r.status)}`} />
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                  <time className="adm-time" dateTime={r.created_at} title={fmtDateTime(r.created_at)}>{shortTime(r.created_at)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="adm-panel" aria-labelledby="adm-activity">
          <header className="adm-panel-head">
            <h3 id="adm-activity">Recent activity</h3>
            <Link to="/audit-logs">Audit log</Link>
          </header>
          {data.recent_audit.length === 0 ? (
            <p className="adm-empty">No recent activity.</p>
          ) : (
            <ul className="adm-list">
              {data.recent_audit.map((a, i) => (
                <li key={i}>
                  <span className="adm-list-main">
                    <span className="adm-activity">{a.details || a.action}</span>
                    <span className="adm-list-sub">{a.username}</span>
                  </span>
                  <time className="adm-time" dateTime={a.timestamp} title={fmtDateTime(a.timestamp)}>{shortTime(a.timestamp)}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default AdminDashboard;