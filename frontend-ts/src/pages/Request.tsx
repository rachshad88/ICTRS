import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

function Request() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [unit, setUnit] = useState('');
  const [semester, setSemester] = useState('');
  const [issue, setIssue] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showDefaultPasswordModal, setShowDefaultPasswordModal] = useState(false);

  useEffect(() => {
    const checkDefaultPasswordStatus = async () => {
      if (!user?.user_id) return;

      const modalKey = `default-password-modal-seen:${user.user_id}`;
      const storedState = sessionStorage.getItem(modalKey);

      if (storedState === 'pending') {
        setShowDefaultPasswordModal(true);
        return;
      }

      if (user?.is_default_password) {
        if (!storedState) {
          setShowDefaultPasswordModal(true);
        }
        return;
      }

      try {
        const response = await api.get('/auth/me', {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });

        const isDefaultPassword = Boolean(response.data.is_default_password);
        if (isDefaultPassword && !storedState) {
          setShowDefaultPasswordModal(true);
        }
      } catch {
        // Ignore auth refresh failures here; the request page will still render normally.
      }
    };

    checkDefaultPasswordStatus();
  }, [user?.user_id, user?.is_default_password]);

  const dismissDefaultPasswordModal = () => {
    if (!user?.user_id) return;
    const modalKey = `default-password-modal-seen:${user.user_id}`;
    sessionStorage.setItem(modalKey, 'true');
    setShowDefaultPasswordModal(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!issue.trim()) {
      setMessage('Please fill in all required fields');
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage('');

    try {
      const response = await api.post('/requests/send_request', {
        office: user?.office,
        unit,
        semester,
        issue: issue.trim()
      });

      if (response.data.status === 'success') {
        setMessage(`Request submitted successfully! Your code is: ${response.data.request_code}`);
        setTimeout(() => {
          navigate('/requested');
        }, 1500);
      }
    } catch (error) {
      setMessage('Failed to submit request. Please try again.');
    } finally {
      setTimeout(() => setLoading(false), 5000);
    }
  };

  return (
    <div className="request-page">

      <div className="container">
        <h2>Submit Request</h2>

        {showDefaultPasswordModal && (
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-content" style={{ maxWidth: 520 }}>
              <div className="modal-header">
                <h3>Change your password</h3>
                <button type="button" className="modal-close" onClick={dismissDefaultPasswordModal} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="modal-body">
                <p>
                  Your account is still using the default password. Please update it in your profile before continuing.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={dismissDefaultPasswordModal}>Dismiss</button>
                <button type="button" className="btn-primary" onClick={() => {
                  dismissDefaultPasswordModal();
                  navigate('/profile');
                }}>Go to Profile</button>
              </div>
            </div>
          </div>
        )}
        
        {message && (
          <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="request-form">
          <div className="form-group">
            <label>Office</label>
            <div className="form-control-static">{user?.office || 'N/A'}</div>
          </div>
          
          <div className="form-group">
            <label>Unit *</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
            >
              <option value="">Select Unit</option>
              <option value="desktop">Desktop</option>
              <option value="laptop">Laptop</option>
              <option value="network">Network</option>
              <option value="others">Others</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Semester</label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
            >
              <option value="">Select Semester</option>
              <option value="1st Semester (January-June)">1st Semester (January-June)</option>
              <option value="2nd Semester (July-December)">2nd Semester (July-December)</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Issue *</label>
            <textarea
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              required
              rows={4}
              maxLength={100}
            />
          </div>
          
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Request;
