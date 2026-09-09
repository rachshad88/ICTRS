import { useState, useEffect } from 'react';
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
  DONE: 'Completed',
  NOT_APPROVED: 'Not Approved',
  CANCELLED: 'Cancelled',
  UNASSIGNED: 'Unassigned',
};

function RequestTypeCard({ label, counts, bgColor }: { label: string; counts: Record<string, number>; bgColor: string }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="stat-card-sm" style={{ borderLeft: `4px solid ${bgColor}` }}>
      <h4>{label}</h4>
      <div className="stat-num">{total}</div>
      <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>
        {Object.entries(counts)
          .filter(([, c]) => c > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([s, c]) => `${STATUS_LABELS[s] || s}: ${c}`)
          .join(' | ')}
      </div>
    </div>
  );
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await api.get('/dashboard/admin-stats');
        setData(response.data);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } } };
        setError(e.response?.data?.error || 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

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

  const userTotal = Object.values(data.user_counts).reduce((a, b) => a + b, 0);
  const unassignedMultimedia = data.multimedia_counts.UNASSIGNED || 0;
  const unassignedDigital = data.digital_counts.PENDING || 0;
  const unassignedPrint = data.print_counts.PENDING || 0;

  const getStatusClass = (s: string) => {
    const map: Record<string, string> = {
      PENDING: 'pending', ASSIGNED: 'pending',
      IN_PROGRESS: 'in-progress', DONE: 'done',
      NOT_APPROVED: 'cancelled', CANCELLED: 'cancelled',
      UNASSIGNED: 'pending',
    };
    return map[s] || 'pending';
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Admin Dashboard</h2>
      </div>

      <div className="stat-row">
        <div className="stat-card-sm" style={{ borderLeft: '4px solid #6366f1' }}>
          <h4>Total Users</h4>
          <div className="stat-num">{userTotal}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {Object.entries(data.user_counts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([role, count]) => `${role}: ${count}`)
              .join(' | ')}
          </div>
        </div>
      </div>

      <div className="stat-row">
        <RequestTypeCard label="IT Requests" counts={data.it_counts} bgColor="#3b82f6" />
        <RequestTypeCard label="Multimedia" counts={data.multimedia_counts} bgColor="#8b5cf6" />
        <RequestTypeCard label="Digital Media" counts={data.digital_counts} bgColor="#06b6d4" />
        <RequestTypeCard label="Print Materials" counts={data.print_counts} bgColor="#f59e0b" />
      </div>

      {(unassignedMultimedia > 0 || unassignedDigital > 0 || unassignedPrint > 0) && (
        <div className="page-header" style={{ marginTop: '24px', marginBottom: '12px' }}>
          <h3>Needs Attention</h3>
        </div>
      )}
      <div className="stat-row" style={{ marginBottom: '20px' }}>
        {unassignedMultimedia > 0 && (
            <Link to="/multimedia-management" className="hbtn hbtn-view" style={{ padding: '10px 16px', fontSize: '13px' }}>
            <span className="count-circle" style={{ background: '#f59e0b' }}>{unassignedMultimedia}</span>
            Unassigned Multimedia
          </Link>
        )}
        {unassignedDigital > 0 && (
            <Link to="/digitalmedia-management" className="hbtn hbtn-view" style={{ padding: '10px 16px', fontSize: '13px' }}>
            <span className="count-circle" style={{ background: '#06b6d4' }}>{unassignedDigital}</span>
            Unassigned Digital Media
          </Link>
        )}
        {unassignedPrint > 0 && (
            <Link to="/print-materials-management" className="hbtn hbtn-view" style={{ padding: '10px 16px', fontSize: '13px' }}>
            <span className="count-circle" style={{ background: '#f59e0b' }}>{unassignedPrint}</span>
            Unassigned Print Materials
          </Link>
        )}
      </div>

      <div className="page-header" style={{ marginTop: '24px', marginBottom: '12px' }}>
        <h3>Recent Requests</h3>
      </div>

      {data.recent_requests.length === 0 ? (
        <div className="empty-state">No requests yet</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Code</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_requests.map((r, i) => (
                <tr key={i}>
                  <td><span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-secondary)' }}>{r.type}</span></td>
                  <td className="td-code">{r.request_code}</td>
                  <td>
                    <span className={`hstatus ${getStatusClass(r.status)}`}>
                      <span className={`hstatus-dot ${getStatusClass(r.status)}`} />
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </td>
                  <td className="td-cell">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="page-header" style={{ marginTop: '24px', marginBottom: '12px' }}>
        <h3>Recent Activity</h3>
      </div>

      {data.recent_audit.length === 0 ? (
        <div className="empty-state">No recent activity</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_audit.map((a, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{a.username}</td>
                  <td><code style={{ fontSize: '11px', padding: '2px 4px', background: 'var(--bg-secondary)', borderRadius: '3px' }}>{a.action}</code></td>
                  <td className="td-cell">{a.entity_type}</td>
                  <td className="td-truncate" style={{ maxWidth: '300px' }}>{a.details}</td>
                  <td className="td-cell">{fmtDateTime(a.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;