import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../services/queryClient';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';
import { useConfirm } from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import SearchBox from '../components/SearchBox';
import { useOffices, withCurrentOffice } from '../services/offices';
import Select from '../components/Select';
import RequestTicket from '../components/RequestTicket';
import { useDialogGenie } from '../lib/dialogGenie';

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
  contact_number?: string;
  is_default_password?: boolean;
  /** false for a self sign-up waiting for approval (it cannot sign in until approved). */
  approved?: boolean;
  /** false when an admin has deactivated the account: it cannot sign in. */
  active?: boolean;
  created_at?: string;
}

const DEFAULT_PASSWORD = '12345';
const NO_USERS: User[] = [];

function UserManagement() {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [officeFilter, setOfficeFilter] = useState('');
  useEffect(() => { setCurrentPage(1); }, [searchTerm, officeFilter]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [confirm, confirmDialog] = useConfirm();

  // Each dialog on this page (Edit, Reset password, Sign out, Deactivate...) pours out of the button
  // that opened it and drains back into it on close.
  const pageRef = useRef<HTMLDivElement>(null);
  useDialogGenie(pageRef);
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
    position: '',
    contact_number: ''
  });

  const { data, isPending: loading } = useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => api.get<{ users?: User[] }>('/users/get_users').then((r) => r.data.users || []),
  });
  const allUsers = data ?? NO_USERS;
  const officeChoices = useOffices();
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
        position: user.position || '',
        contact_number: user.contact_number || ''
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
        position: '',
        contact_number: ''
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
          position: formData.position,
          contact_number: formData.contact_number
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

  // The sign-up is no longer waiting: another admin approved or rejected it, or it was removed.
  // Reload the list so its row goes away instead of leaving buttons that can't work.
  const alreadyHandled = async (error: unknown, user: User) => {
    if ((error as { response?: { status?: number } }).response?.status !== 404) return false;
    await refreshUsers();
    setNotice(`The sign-up from ${user.username} was already approved, rejected or removed. The list is now up to date.`);
    return true;
  };

  const handleApprove = async (user: User) => {
    if (approvingId) return;
    setApprovingId(user._id);
    try {
      await api.post('/users/approve_user', { user_id: user._id });
      setNotice(`${user.first_name} ${user.last_name} (${user.username}) was approved and can now sign in.`);
      await refreshUsers();
    } catch (error: unknown) {
      if (await alreadyHandled(error, user)) return;
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to approve the account');
    } finally {
      setApprovingId(null);
    }
  };

  // Rejecting a sign-up removes the account. Only sign-ups still waiting can be removed (reject_user).
  const handleReject = async (user: User) => {
    if (!(await confirm({ title: `Reject ${user.username}?`, message: 'The account will be deleted. If it belongs to a real person, they can sign up again.', confirmLabel: 'Reject and delete', danger: true }))) return;
    try {
      await api.post('/users/reject_user', { user_id: user._id });
      setNotice(`The sign-up from ${user.username} was rejected and deleted.`);
      refreshUsers();
    } catch (error: unknown) {
      if (await alreadyHandled(error, user)) return;
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to reject the account');
    }
  };

  // Deactivating keeps the account and its history, but it can no longer sign in (its session ends
  // at once) and it is not offered for assignment. Activating gives it back.
  const handleSetActive = async (user: User, active: boolean) => {
    const ok = await confirm(active
      ? { title: `Activate ${user.username}?`, message: 'They will be able to sign in and use their account again.', confirmLabel: 'Activate' }
      : { title: `Deactivate ${user.username}?`, message: 'They will be signed out and will not be able to sign in until the account is activated again. Their requests and history stay.', confirmLabel: 'Deactivate', danger: true });
    if (!ok) return;
    try {
      const res = await api.post('/users/set_user_active', { user_id: user._id, active });
      setNotice(res.data?.message || `${user.username} is now ${active ? 'active' : 'inactive'}.`);
      await refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to change the account status');
    }
  };

  // One session per user: someone who left ITRS open on another PC cannot sign in until it ends.
  const handleSignOut = async (user: User) => {
    if (!(await confirm({ title: `Sign out ${user.username}?`, message: 'Their session ends on whatever device they are signed in on, so they can sign in again anywhere.', confirmLabel: 'Sign out' }))) return;
    try {
      const res = await api.post('/users/sign_out_user', { user_id: user._id });
      setNotice(res.data?.message || `${user.username} has been signed out.`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to sign out user');
    }
  };

  const handleResetPassword = async (user: User) => {
    if (!(await confirm({ title: `Reset ${user.username}'s password?`, message: <>It will be set to <strong>{DEFAULT_PASSWORD}</strong>. They will be signed out and must choose a new password when they next sign in.</>, confirmLabel: 'Reset password' }))) return;
    try {
      await api.post('/users/reset_user_password', { user_id: user._id });
      setNotice(`${user.username}'s password was reset to ${DEFAULT_PASSWORD}.`);
      await refreshUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to reset user password');
    }
  };

  // Search covers username, name, position, contact number and office; the office filter lists the offices people
  // are actually in (and "No office" when someone has none). Both work on the list already loaded.
  const NO_OFFICE = '__none';
  const offices = [...new Set(users.map((u) => u.office?.trim() || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const anyWithoutOffice = users.some((u) => !u.office?.trim());
  const term = searchTerm.toLowerCase();
  const shownUsers = users.filter((u) => {
    const office = u.office?.trim() || '';
    if (officeFilter && (officeFilter === NO_OFFICE ? office !== '' : office !== officeFilter)) return false;
    if (!term) return true;
    return [u.username, `${u.first_name} ${u.middle_name || ''} ${u.last_name}`.replace(/\s+/g, ' '), u.position, u.contact_number, office]
      .some((v) => (v || '').toLowerCase().includes(term));
  });
  const isFiltered = !!searchTerm || !!officeFilter;

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(shownUsers.length / ITEMS_PER_PAGE);
  const paginatedUsers = shownUsers.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // In pairs, staff role then its admin, so the grid reads across: IT, multimedia, then the rest.
  const ROLES = [
    { value: 'TECHNICIAN', label: 'Technician', desc: 'Works on IT requests' },
    { value: 'IT_ADMIN', label: 'IT Admin', desc: 'Assigns and oversees IT requests' },
    { value: 'MULTIMEDIA', label: 'Multimedia', desc: 'Works on multimedia, digital media and print' },
    { value: 'MULTIMEDIA_ADMIN', label: 'Multimedia Admin', desc: 'Assigns and oversees multimedia work' },
    { value: 'CLIENT', label: 'Client', desc: 'Submits and tracks requests' },
    { value: 'ADMIN', label: 'Super Admin', desc: 'Everything, including users and audit logs' },
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

  // The row's buttons, shared by the table and the phone tickets. Icons only: the tooltip names the
  // action, and screen readers also hear whose row it is.
  const iconButton = (user: User, className: string, label: string, onClick: () => void, icon: ReactNode) => (
    <button type="button" className={`hbtn hbtn-icon ${className}`} onClick={onClick} title={label} aria-label={`${label}: ${user.first_name} ${user.last_name}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        {icon}
      </svg>
    </button>
  );

  const userActions = (user: User) => (
    <div className="history-actions">
      {iconButton(user, 'hbtn-view', 'Edit', () => openModal(user), (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>
      ))}
      {iconButton(user, 'hbtn-view', 'Reset password', () => handleResetPassword(user), (
        <>
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 3 3L22 7l-3-3" />
        </>
      ))}
      {iconButton(user, 'hbtn-view', 'Sign out', () => handleSignOut(user), (
        <>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </>
      ))}
      {user.active === false
        ? iconButton(user, 'hbtn-assign', 'Activate', () => handleSetActive(user, true), (
          <>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <polyline points="16 11 18 13 22 9" />
          </>
        ))
        : iconButton(user, 'hbtn-cancel', 'Deactivate', () => handleSetActive(user, false), (
          <>
            <circle cx="12" cy="12" r="10" />
            <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
          </>
        ))}
    </div>
  );

  return (
    <div className="page-wrap" ref={pageRef}>
      {confirmDialog}
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
                  <span>{u.username} · {u.office || 'No office'}{u.position ? ` · ${u.position}` : ''}{u.contact_number ? ` · ${u.contact_number}` : ''}</span>
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

      <div className="filters-row um-filters">
        <SearchBox value={searchTerm} onSearch={setSearchTerm} placeholder="Search by name, username, position, contact or office" />
        <Select value={officeFilter} onChange={(e) => setOfficeFilter(e.target.value)} aria-label="Office">
          <option value="">All offices</option>
          {offices.map((o) => <option key={o} value={o}>{o}</option>)}
          {anyWithoutOffice && <option value={NO_OFFICE}>No office</option>}
        </Select>
        {isFiltered && (
          <button type="button" className="hbtn" onClick={() => { setSearchTerm(''); setOfficeFilter(''); }}>Clear</button>
        )}
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : shownUsers.length === 0 ? (
        <div className="history-empty">{isFiltered ? 'No users match this search.' : 'No users yet.'}</div>
      ) : (
        <>
          <div className="history-table-wrap hide-on-mobile">
            <table className="history-table stack-mobile">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Office</th>
                  <th>Role</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => (
                  <tr key={user._id} className={user.active === false ? 'is-inactive' : undefined}>
                    <td className="td-cell" data-label="Username">{user.username}</td>
                    <td data-label="Name">
                      <div>{user.first_name} {user.middle_name} {user.last_name}</div>
                      {(user.position || user.contact_number) && (
                        <div style={{ marginTop: '2px', fontSize: '11px', opacity: 0.75 }}>{[user.position, user.contact_number].filter(Boolean).join(' · ')}</div>
                      )}
                      {user.active === false && <div className="um-inactive">Inactive</div>}
                      {user.is_default_password && (
                        <div style={{ marginTop: '4px', fontSize: '10px', color: '#8a4b00', fontWeight: 600 }}>
                          Default password
                        </div>
                      )}
                    </td>
                    <td className="td-cell" data-label="Office">{user.office?.trim() || '-'}</td>
                    <td data-label="Role">
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {(user.roles || [user.role]).map(r => (
                          <span key={r} className={`role-badge ${getRoleClass(r)}`} style={{ fontSize: '10px' }}>
                            {getRoleLabel(r)}{r === (user.primary_role || user.role) ? '*' : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="col-actions">{userActions(user)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rq-ticket-list">
            {paginatedUsers.map((user, idx) => (
              <RequestTicket
                key={user._id}
                index={idx}
                brand="ITRS account"
                type={getRoleLabel(user.primary_role || user.role)}
                code={user.username}
                title={[user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ')}
                sub={[user.position, user.contact_number].filter(Boolean).join(' · ') || undefined}
                status={user.active === false ? 'INACTIVE' : 'ACTIVE'}
                meta={[
                  { label: 'Office', value: user.office?.trim() || '-' },
                  {
                    label: 'Roles',
                    value: (
                      <span className="rq-ticket-roles">
                        {(user.roles || [user.role]).map((r) => (
                          <span key={r} className={`role-badge ${getRoleClass(r)}`}>
                            {getRoleLabel(r)}{r === (user.primary_role || user.role) ? '*' : ''}
                          </span>
                        ))}
                      </span>
                    ),
                  },
                ]}
                rows={user.is_default_password ? [{ label: 'Password', value: 'Still the default' }] : []}
                actions={userActions(user)}
              />
            ))}
          </div>
        </>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {showModal && (
        <div className="modal">
          <div className="modal-content um-modal">
            <h3>{editingUser ? 'Edit User' : 'Add User'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Username</label>
                <input autoComplete="off" autoCapitalize="none" spellCheck={false} type="text" value={formData.username} onChange={(e) => setFormData({...formData, username: e.target.value})} required />
              </div>
              {!editingUser && (
                <p className="um-note">
                  New accounts start on the default password <strong>{DEFAULT_PASSWORD}</strong> and must change it at their first sign-in.
                </p>
              )}
              <div className="um-name-row">
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
              </div>
              <fieldset className="um-roles">
                <legend>Roles</legend>
                <p className="um-roles-hint">
                  Tick every role this person needs.{formData.roles.length > 1 && ' The primary role picks the page they open on after signing in.'}
                </p>
                <div className="um-role-grid">
                  {ROLES.map((r) => {
                    const on = formData.roles.includes(r.value);
                    const primary = on && formData.primary_role === r.value;
                    const setPrimary = () => setFormData({ ...formData, primary_role: r.value, role: r.value });
                    return (
                      <div key={r.value} className={`um-role${on ? ' is-on' : ''}`}>
                        <label className="um-role-pick">
                          <input
                            type="checkbox"
                            checked={on}
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
                          <span className="um-role-box" aria-hidden="true" />
                          <span className="um-role-text">
                            <span className="um-role-name">{r.label}</span>
                            <span className="um-role-desc">{r.desc}</span>
                          </span>
                        </label>
                        {on && formData.roles.length > 1 && (
                          primary
                            ? <span className="um-role-primary">Primary</span>
                            : <button type="button" className="um-role-make" onClick={setPrimary} aria-label={`Make ${r.label} the primary role`}>Make primary</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <div className="form-group">
                <label>Office</label>
                <Select value={formData.office} onChange={(e) => setFormData({...formData, office: e.target.value})}>
                  <option value="">Select Office</option>
                  {withCurrentOffice(officeChoices, editingUser?.office).map((office) => (
                    <option key={office} value={office}>{office}</option>
                  ))}
                </Select>
              </div>
              <div className="form-group">
                <label>Position</label>
                <input autoComplete="off" type="text" value={formData.position} maxLength={120} placeholder="e.g. Computer Programmer I" onChange={(e) => setFormData({...formData, position: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Contact Number</label>
                <input autoComplete="off" type="tel" inputMode="numeric" value={formData.contact_number} minLength={7} placeholder="e.g. 09XXXXXXXXX" onChange={(e) => setFormData({...formData, contact_number: e.target.value.replace(/\D/g, '').slice(0, 11)})} />
              </div>
              <div className="modal-actions">
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
