import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../services/queryClient';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';
import { useConfirm } from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import { OFFICES } from '../data/offices';

interface User {
  _id: string;
  username: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  role: string;
  roles: string[];
  primary_role: string;
  office?: string;
  position?: string;
  is_default_password?: boolean;
  /** false for a self sign-up waiting for approval (it cannot sign in until approved). */
  approved?: boolean;
  created_at?: string;
}

const DEFAULT_PASSWORD = '12345';
const NO_USERS: User[] = [];

function UserManagement() {
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  const [saving, setSaving] = useState(false);
  // Confirmation of the last action (e.g. a password reset); shown in place of the standing warning.
  const [notice, setNotice] = useState('');

  const [formData, setFormData] = useState({
    username: '',
    password: DEFAULT_PASSWORD,
    first_name: '',
    middle_name: '',
    last_name: '',
    role: 'CLIENT',
    roles: [] as string[],
    primary_role: 'CLIENT',
    office: '',
    position: ''
  });

  const { data, isPending: loading } = useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => api.get<{ users?: User[] }>('/users/get_users').then((r) => r.data.users || []),
  });
  const allUsers = data ?? NO_USERS;
  // Self sign-ups waiting for approval get their own section above the list.
  const pending = allUsers.filter((u) => u.approved === false);
  const users = allUsers.filter((u) => u.approved !== false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  // A successful refresh clears an earlier action error, as the hand-rolled fetch used to.
  useEffect(() => { setError(''); }, [data]);
  const defaultPasswordWarning = users.some((u) => u.is_default_password)
    ? `Some users are still using the default password ${DEFAULT_PASSWORD}.`
    : '';

  // Accounts feed other screens too: the staff lists in the assign forms and All Requests filters.
  const refreshUsers = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['users'] }),
    queryClient.invalidateQueries({ queryKey: ['meta'] }),
  ]);

  const openModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        password: '',
        first_name: user.first_name,
        middle_name: user.middle_name || '',
        last_name: user.last_name,
        role: user.role || (user.roles?.[0] || 'CLIENT'),
        roles: user.roles || [user.role || 'CLIENT'],
        primary_role: user.primary_role || user.role || 'CLIENT',
        office: user.office || '',
        position: user.position || ''
      });
    } else {
      setEditingUser(null);
      setFormData({
        username: '',
        password: '',
        first_name: '',
        middle_name: '',
        last_name: '',
        role: 'CLIENT',
        roles: ['CLIENT'],
        primary_role: 'CLIENT',
        office: '',
        position: ''
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          user_id: editingUser._id,
          username: formData.username,
          first_name: formData.first_name,
          middle_name: formData.middle_name,
          last_name: formData.last_name,
          role: formData.role,
          roles: formData.roles,
          primary_role: formData.primary_role,
          office: formData.office,
          position: formData.position
        };
        if (formData.password) payload.password = formData.password;
        await api.post('/users/update_user', payload);
      } else {
        await api.post('/users/create_user', { ...formData, roles: formData.roles, primary_role: formData.primary_role });
      }
      setShowModal(false);
      refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; details?: Array<{ message: string }> } } };
      setError(err.response?.data?.details?.[0]?.message || err.response?.data?.error || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (user: User) => {
    if (approvingId) return;
    setApprovingId(user._id);
    try {
      await api.post('/users/approve_user', { user_id: user._id });
      setNotice(`${user.first_name} ${user.last_name} (${user.username}) was approved and can now sign in.`);
      await refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to approve the account');
    } finally {
      setApprovingId(null);
    }
  };

  // Rejecting a sign-up removes the account, like Delete, but says so in sign-up terms.
  const handleReject = async (user: User) => {
    if (!(await confirm({ title: `Reject ${user.username}?`, message: 'The account will be deleted. If it belongs to a real person, they can sign up again.', confirmLabel: 'Reject and delete', danger: true }))) return;
    try {
      await api.post('/users/delete_user', { user_id: user._id });
      setNotice(`The sign-up from ${user.username} was rejected and deleted.`);
      refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to reject the account');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!(await confirm({ title: 'Delete this user?', message: 'They will no longer be able to sign in. This cannot be undone.', confirmLabel: 'Delete user', danger: true }))) return;
    try {
      await api.post('/users/delete_user', { user_id: userId });
      refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleResetPassword = async () => {
    if (!editingUser) return;
    if (!(await confirm({ title: `Reset ${editingUser.username}'s password?`, message: <>It will be set to <strong>{DEFAULT_PASSWORD}</strong>, They will be signed out and must choose a new password when they next sign in.</>, confirmLabel: 'Reset password' }))) return;
    try {
      await api.post('/users/reset_user_password', { user_id: editingUser._id });
      setNotice(`${editingUser.username}'s password was reset to ${DEFAULT_PASSWORD}.`);
      await refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to reset user password');
    }
  };

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(users.length / ITEMS_PER_PAGE);
  const paginatedUsers = users.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const ROLES = [
    { value: 'CLIENT', label: 'Client' },
    { value: 'TECHNICIAN', label: 'Technician' },
    { value: 'MULTIMEDIA', label: 'Multimedia' },
    { value: 'IT_ADMIN', label: 'IT Admin' },
    { value: 'MULTIMEDIA_ADMIN', label: 'Multimedia Admin' },
    { value: 'ADMIN', label: 'Super Admin' },
  ];

  const getRoleClass = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'admin';
      case 'IT_ADMIN': return 'it-admin';
      case 'TECHNICIAN': return 'technician';
      case 'MULTIMEDIA_ADMIN': return 'multimedia-admin';
      case 'MULTIMEDIA': return 'multimedia';
      default: return 'client';
    }
  };

  const ROLE_LABELS: Record<string, string> = {
    CLIENT: 'Client',
    TECHNICIAN: 'Technician',
    MULTIMEDIA: 'Multimedia',
    IT_ADMIN: 'IT Admin',
    MULTIMEDIA_ADMIN: 'Multimedia Admin',
    ADMIN: 'Super Admin',
  };

  const getRoleLabel = (role: string) => ROLE_LABELS[role] || role;

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>User Management</h2>
        <button onClick={() => openModal()} className="hbtn hbtn-assign" style={{ fontWeight: 600 }}>
          + Add User
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {(notice || defaultPasswordWarning) && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '6px', background: '#fff7e6', color: '#8a4b00', border: '1px solid #f0c36d' }}>
          {notice || defaultPasswordWarning}
        </div>
      )}

      {pending.length > 0 && (
        <section className="approval-queue" aria-labelledby="approval-queue-title">
          <h3 id="approval-queue-title">Waiting for approval ({pending.length})</h3>
          <p className="approval-queue-hint">These people signed up themselves. They can't sign in until you approve them. Reject anything that looks fake.</p>
          <ul>
            {pending.map((u) => (
              <li key={u._id} className="approval-item">
                <div className="approval-who">
                  <strong>{u.first_name} {u.middle_name} {u.last_name}</strong>
                  <span>{u.username} · {u.office || 'No office'}{u.position ? ` · ${u.position}` : ''}</span>
                  {u.created_at && <time dateTime={u.created_at}>Signed up {new Date(u.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>}
                </div>
                <div className="history-actions">
                  <button className="hbtn hbtn-assign" onClick={() => handleApprove(u)} disabled={approvingId !== null}>
                    {approvingId === u._id ? 'Approving...' : 'Approve'}
                  </button>
                  <button className="hbtn hbtn-cancel" onClick={() => handleReject(u)} disabled={approvingId !== null}>Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.map((user) => (
                <tr key={user._id}>
                  <td className="td-cell" data-label="Username">{user.username}</td>
                  <td data-label="Name">
                    <div>{user.first_name} {user.middle_name} {user.last_name}</div>
                    {user.position && (
                      <div style={{ marginTop: '2px', fontSize: '11px', opacity: 0.75 }}>{user.position}</div>
                    )}
                    {user.is_default_password && (
                      <div style={{ marginTop: '4px', fontSize: '10px', color: '#8a4b00', fontWeight: 600 }}>
                        Default password
                      </div>
                    )}
                  </td>
                  <td data-label="Role">
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {(user.roles || [user.role]).map(r => (
                        <span key={r} className={`role-badge ${getRoleClass(r)}`} style={{ fontSize: '10px' }}>
                          {getRoleLabel(r)}{r === (user.primary_role || user.role) ? '*' : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="col-actions">
                    <div className="history-actions">
                      <button className="hbtn hbtn-view" onClick={() => openModal(user)}>Edit</button>
                      <button className="hbtn hbtn-cancel" onClick={() => handleDelete(user._id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>{editingUser ? 'Edit User' : 'Add User'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Username</label>
                <input autoComplete="off" autoCapitalize="none" spellCheck={false} type="text" value={formData.username} onChange={(e) => setFormData({...formData, username: e.target.value})} required />
              </div>
              {!editingUser && (
                <div className="form-group">
                  <label>Password</label>
                  <div style={{ padding: '8px 10px', borderRadius: '6px', background: '#f3f6ff', color: '#234a8c', fontSize: '13px' }}>
                    New accounts will use the default password <strong>{DEFAULT_PASSWORD}</strong> and must change it when they first log in.
                  </div>
                </div>
              )}
              <div className="form-group">
                <label>First Name</label>
                <input autoComplete="off" type="text" value={formData.first_name} onChange={(e) => setFormData({...formData, first_name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Middle Name</label>
                <input autoComplete="off" type="text" value={formData.middle_name} onChange={(e) => setFormData({...formData, middle_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input autoComplete="off" type="text" value={formData.last_name} onChange={(e) => setFormData({...formData, last_name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Roles (check all that apply)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
                  {ROLES.map((r) => (
                    <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                      <input
                        type="checkbox"
                        checked={formData.roles.includes(r.value)}
                        onChange={(e) => {
                          const newRoles = e.target.checked
                            ? [...formData.roles, r.value]
                            : formData.roles.filter(v => v !== r.value);
                          const newPrimary = newRoles.includes(formData.primary_role)
                            ? formData.primary_role
                            : newRoles[0] || 'CLIENT';
                          setFormData({...formData, roles: newRoles, primary_role: newPrimary, role: newPrimary});
                        }}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
              {formData.roles.length > 1 && (
                <div className="form-group">
                  <label>Primary Role</label>
                  <select value={formData.primary_role} onChange={(e) => setFormData({...formData, primary_role: e.target.value, role: e.target.value})}>
                    {formData.roles.map(r => (
                      <option key={r} value={r}>{ROLES.find(ro => ro.value === r)?.label || r}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Office</label>
                <select value={formData.office} onChange={(e) => setFormData({...formData, office: e.target.value})}>
                  <option value="">Select Office</option>
                  {OFFICES.map((office) => (
                    <option key={office} value={office}>{office}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Position</label>
                <input autoComplete="off" type="text" value={formData.position} maxLength={120} placeholder="e.g. Computer Programmer I" onChange={(e) => setFormData({...formData, position: e.target.value})} />
              </div>
              <div className="modal-actions">
                {editingUser && (
                  <button type="button" onClick={handleResetPassword} className="btn-secondary">
                    Reset Password
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                <button data-modal-dismiss type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
