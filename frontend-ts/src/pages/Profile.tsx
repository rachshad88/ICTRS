import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

import { OFFICES } from '../data/offices';

function Profile() {
  const { user, logout, updateUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const mustChangePassword = !!user?.is_default_password;
  const [activeSection, setActiveSection] = useState<'profile' | 'password' | null>(mustChangePassword ? 'password' : null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState(user?.username || '');
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [middleName, setMiddleName] = useState(user?.middle_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [office, setOffice] = useState(user?.office || '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    // Matches changePasswordSchema on the backend.
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/change_password', {
        current_password: currentPassword,
        new_password: newPassword
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setActiveSection(null);
      // Picks up is_default_password = false, which unlocks the rest of the app.
      await refreshUser();
      setSuccess(mustChangePassword ? 'Password changed. You can now use the rest of the system.' : 'Password changed successfully');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const getInitials = () => {
    if (!user?.first_name || !user?.last_name) return '??';
    return `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!firstName || !lastName) {
      setError('First name and last name are required');
      return;
    }

    setLoading(true);
    try {
      await updateUser({ 
        username: username !== user?.username ? username : undefined,
        first_name: firstName, 
        middle_name: middleName, 
        last_name: lastName,
        office: office
      });
      setSuccess('Profile updated successfully');
      setActiveSection(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const startEditing = () => {
    setUsername(user?.username || '');
    setFirstName(user?.first_name || '');
    setMiddleName(user?.middle_name || '');
    setLastName(user?.last_name || '');
    setOffice(user?.office || '');
    setError('');
    setSuccess('');
    setActiveSection('profile');
  };

  return (
    <div className="profile-page">

      <div className="container">
        <div className="page-header">
          <h2>Profile Settings</h2>
          <p className="page-subtitle">Manage your personal information and security</p>
        </div>

        {mustChangePassword && (
          <div className="error-message" role="alert">
            Your account still uses the default password. Change it under Security to continue using the system.
          </div>
        )}
        
        <div className="profile-layout">
          <div className="profile-sidebar">
            <div className="profile-avatar-section">
              <div className="profile-avatar-large">
                <span>{getInitials()}</span>
              </div>
              <h3>{user?.first_name} {user?.last_name}</h3>
              <p className="role-badge">{user?.primary_role || user?.role}</p>
            </div>
            
            <div className="profile-menu">
              <button 
                className={`menu-item ${activeSection === 'profile' ? 'active' : ''}`}
                onClick={() => activeSection === 'profile' ? setActiveSection(null) : startEditing()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                Personal Info
              </button>
              <button 
                className={`menu-item ${activeSection === 'password' ? 'active' : ''}`}
                onClick={() => {
                  setActiveSection(activeSection === 'password' ? null : 'password');
                  setError('');
                  setSuccess('');
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                Security
              </button>
            </div>
            
            <button onClick={() => { logout(); navigate('/'); }} className="btn btn-danger btn-logout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Logout
            </button>
          </div>

          <div className="profile-content">
            {!activeSection ? (
              <div className="profile-summary">
                <h3>Account Overview</h3>
                <div className="summary-grid">
                  <div className="summary-card">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    </div>
                    <div className="summary-info">
                      <span className="summary-label">Username</span>
                      <span className="summary-value">{user?.username}</span>
                    </div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                      </svg>
                    </div>
                    <div className="summary-info">
                      <span className="summary-label">Full Name</span>
                      <span className="summary-value">{user?.first_name} {user?.middle_name} {user?.last_name}</span>
                    </div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                    </div>
                    <div className="summary-info">
                      <span className="summary-label">Role</span>
                      <span className="summary-value">{(user?.roles || [user?.role]).join(', ')}</span>
                    </div>
                  </div>
                </div>
                <button onClick={startEditing} className="btn btn-primary btn-edit">
                  Edit Profile
                </button>
              </div>
            ) : activeSection === 'profile' ? (
              <div className="edit-form-card">
                <div className="form-header">
                  <button className="back-btn" onClick={() => setActiveSection(null)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="19" y1="12" x2="5" y2="12"></line>
                      <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                  </button>
                  <h3>Personal Information</h3>
                </div>
                
                {error && <div className="message error">{error}</div>}
                {success && <div className="message success">{success}</div>}
                
                <form onSubmit={handleSaveProfile}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Username</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter username"
                      />
                    </div>
                  </div>
                  <div className="form-row three-cols">
                    <div className="form-group">
                      <label>First Name *</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Middle Name</label>
                      <input
                        type="text"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Last Name *</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Office</label>
                      <select
                        value={office}
                        onChange={(e) => setOffice(e.target.value)}
                      >
                        <option value="">Select Office</option>
                        {OFFICES.map((off) => (
                          <option key={off} value={off}>{off}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-secondary"
                      onClick={() => setActiveSection(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="edit-form-card">
                <div className="form-header">
                  <button className="back-btn" onClick={() => setActiveSection(null)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="19" y1="12" x2="5" y2="12"></line>
                      <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                  </button>
                  <h3>Change Password</h3>
                </div>
                
                {error && <div className="message error">{error}</div>}
                {success && <div className="message success">{success}</div>}
                
                <form onSubmit={handleChangePassword}>
                  <div className="form-group">
                    <label>Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Confirm Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? 'Changing...' : 'Change Password'}
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-secondary"
                      onClick={() => setActiveSection(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profile;
