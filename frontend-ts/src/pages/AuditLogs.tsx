import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  useEffect(() => { setCurrentPage(1); }, [actionFilter, entityFilter]);

  const params: Record<string, string | number> = { page: currentPage, limit: 25 };
  if (actionFilter) params.action = actionFilter;
  if (entityFilter) params.entity_type = entityFilter;
  const { data, isPending: loading } = useQuery({
    queryKey: ['audit', params],
    queryFn: () => api.get<{ logs: AuditEntry[]; pagination: { totalPages: number } }>('/audit/logs', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or filter loads.
    placeholderData: keepPreviousData,
  });
  const logs = data?.logs ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

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
    REASSIGN_REQUEST: 'Reassign Request',
    SET_PRIORITY: 'Set Priority',
    SHARED_ACCESS: 'Share Access',
    UPDATE_SIGNATORIES: 'Update Signatories'
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
          <option value="SETTINGS">Settings</option>
        </select>
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : logs.length === 0 ? (
        <div className="history-empty">No audit logs found</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
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
                  <td className="td-cell" style={{ whiteSpace: 'nowrap' }} data-label="Timestamp">{formatDate(log.timestamp)}</td>
                    <td className="td-cell" data-label="User">{log.username || '-'}</td>
                  <td data-label="Role">
                    <span className={`role-badge ${(log.role || '').toLowerCase()}`}>{log.role ? log.role.charAt(0) + log.role.slice(1).toLowerCase() : '-'}</span>
                  </td>
                  <td className="td-cell" data-label="Action">{actionLabels[log.action] || log.action || '-'}</td>
                  <td className="td-cell" data-label="Type">{(log.entity_type || '').replace(/_/g, ' ') || '-'}</td>
                  <td className="td-truncate" style={{ maxWidth: '400px' }} data-label="Details">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}</td>
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