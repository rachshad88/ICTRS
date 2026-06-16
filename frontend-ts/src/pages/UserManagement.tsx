import { useState, useEffect } from 'react';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';
import { OFFICES } from '../data/offices';

interface User {
  _id: string;
  username: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  role: string;
  office?: string;
}

function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    role: 'CLIENT',
    office: ''
  });

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users/get_users');
      setUsers(response.data.users);
      setError('');
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally { setLoading(false); }
  };

  const openModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        password: '',
        first_name: user.first_name,
        middle_name: user.middle_name || '',
        last_name: user.last_name,
        role: user.role,
        office: user.office || ''
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
        office: ''
      });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          user_id: editingUser._id,
          username: formData.username,
          first_name: formData.first_name,
          middle_name: formData.middle_name,
          last_name: formData.last_name,
          role: formData.role,
          office: formData.office
        };
        if (formData.password) payload.password = formData.password;
        await api.post('/users/update_user', payload);
      } else {
        await api.post('/users/create_user', formData);
      }
      setShowModal(false);
      fetchUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; details?: Array<{ message: string }> } } };
      setError(err.response?.data?.details?.[0]?.message || err.response?.data?.error || 'Failed to save user');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await api.post('/users/delete_user', { user_id: userId });
      fetchUsers();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(users.length / ITEMS_PER_PAGE);
  const paginatedUsers = users.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const ROLES = [
    { value: 'CLIENT', label: 'Client' },
    { value: 'TECHNICIAN', label: 'Technician' },
    { value: 'MULTIMEDIA', label: 'Multimedia' },
    { value: 'PROGRAMMER', label: 'Programmer' },
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
      case 'PROGRAMMER': return 'programmer';
      default: return 'client';
    }
  };

  const ROLE_LABELS: Record<string, string> = {
    CLIENT: 'Client',
    TECHNICIAN: 'Technician',
    MULTIMEDIA: 'Multimedia',
    PROGRAMMER: 'Programmer',
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

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
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
                  <td style={{ fontSize: '12px' }}>{user.username}</td>
                  <td>{user.first_name} {user.middle_name} {user.last_name}</td>
                  <td>
                    <span className={`role-badge ${getRoleClass(user.role)}`}>
                      {getRoleLabel(user.role)}
                    </span>
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

      {totalPages > 1 && (
        <div className="history-pagination">
          <button className="hbtn-page" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <button key={page} className={`hbtn-page ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)}>{page}</button>
          ))}
          <button className="hbtn-page" disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
        </div>
      )}

      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>{editingUser ? 'Edit User' : 'Add User'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Username</label>
                <input type="text" value={formData.username} onChange={(e) => setFormData({...formData, username: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Password {editingUser && '(leave blank to keep current)'}</label>
                <input type="password" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} required={!editingUser} />
              </div>
              <div className="form-group">
                <label>First Name</label>
                <input type="text" value={formData.first_name} onChange={(e) => setFormData({...formData, first_name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Middle Name</label>
                <input type="text" value={formData.middle_name} onChange={(e) => setFormData({...formData, middle_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Last Name</label>
                <input type="text" value={formData.last_name} onChange={(e) => setFormData({...formData, last_name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={formData.role} onChange={(e) => setFormData({...formData, role: e.target.value})}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Office</label>
                <select value={formData.office} onChange={(e) => setFormData({...formData, office: e.target.value})}>
                  <option value="">Select Office</option>
                  {OFFICES.map((office) => (
                    <option key={office} value={office}>{office}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn-primary">Save</button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
