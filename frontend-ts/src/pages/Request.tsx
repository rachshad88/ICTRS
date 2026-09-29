import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { PriorityField, Priority } from '../components/Priority';

function Request() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [unit, setUnit] = useState('');
  const [semester, setSemester] = useState('');
  const [issue, setIssue] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

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
        issue: issue.trim(),
        priority
      });

      if (response.data.status === 'success') {
        setMessage(`Request submitted successfully! Your code is: ${response.data.request_code}`);
        setTimeout(() => {
          navigate('/requested');
        }, 1500);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; error?: string; details?: Array<{ message: string }> } } };
      const data = err.response?.data;
      setMessage(data?.details?.[0]?.message || data?.message || data?.error || 'Failed to submit request. Please try again.');
    } finally {
      setTimeout(() => setLoading(false), 5000);
    }
  };

  return (
    <div className="request-page">

      <div className="container">
        <h2>Submit Request</h2>

        {message && (
          <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="request-form">
          <div className="form-group">
            <label>Office</label>
            <div className="form-control-static">{user?.office || 'N/A'}</div>
            {!user?.office && (
              <small className="field-error">
                Your account has no office yet. <Link to="/profile">Set it in your profile</Link> before submitting.
              </small>
            )}
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
          
          <PriorityField value={priority} onChange={setPriority} />

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
          
          <button type="submit" className="btn-primary" disabled={loading || !user?.office}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Request;
