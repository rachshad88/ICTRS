import { useState, useEffect } from 'react';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';

interface AuditEntry {
  _id: string;
  timestamp: string;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
}

function AuditLogs() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: currentPage, limit: 25 };
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity_type = entityFilter;
      const response = await api.get('/audit/logs', { params });
      setLogs(response.data.logs);
      setTotalPages(response.data.pagination.totalPages);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setCurrentPage(1); }, [actionFilter, entityFilter]);
  useEffect(() => { fetchLogs(); }, [currentPage, actionFilter, entityFilter]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const actionLabels: Record<string, string> = {
    LOGIN: 'Login',
    LOGOUT: 'Logout',
    CHANGE_PASSWORD: 'Change Password',
    UPDATE_PROFILE: 'Update Profile',
    CREATE_USER: 'Create User',
    UPDATE_USER: 'Update User',
    DELETE_USER: 'Delete User',
    CREATE_REQUEST: 'Create Request',
    ACCEPT_REQUEST: 'Accept Request',
    ASSIGN_REQUEST: 'Assign Request',
    FINISH_REQUEST: 'Finish Request',
    COMPLETE_REQUEST: 'Complete Request',
    CANCEL_REQUEST: 'Cancel Request',
    SHARED_ACCESS: 'Share Access'
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Audit Logs</h2>
      </div>

      <div className="filters-row audit-filters">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="">All Actions</option>
          {Object.entries(actionLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="USER">User</option>
          <option value="IT_REQUEST">IT Request</option>
          <option value="MULTIMEDIA">Multimedia</option>
          <option value="DIGITAL_MEDIA">Digital Media</option>
          <option value="PRINT_MATERIALS">Print Materials</option>
        </select>
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : logs.length === 0 ? (
        <div className="history-empty">No audit logs found</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Type</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id}>
                  <td className="td-cell" style={{ whiteSpace: 'nowrap' }}>{formatDate(log.timestamp)}</td>
                    <td className="td-cell">{log.username || '-'}</td>
                  <td>
                    <span className={`role-badge ${(log.role || '').toLowerCase()}`}>{log.role ? log.role.charAt(0) + log.role.slice(1).toLowerCase() : '-'}</span>
                  </td>
                  <td className="td-cell">{actionLabels[log.action] || log.action || '-'}</td>
                  <td className="td-cell">{(log.entity_type || '').replace(/_/g, ' ') || '-'}</td>
                  <td className="td-truncate" style={{ maxWidth: '400px' }}>{typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
    </div>
  );
}

export default AuditLogs;