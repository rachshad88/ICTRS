import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

import { OFFICES } from '../data/offices';

function Request() {
  const navigate = useNavigate();
  const [office, setOffice] = useState('');
  const [unit, setUnit] = useState('');
  const [semester, setSemester] = useState('');
  const [issue, setIssue] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await api.post('/requests/send_request', {
        office,
        unit,
        semester,
        issue
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
      setLoading(false);
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
            <label>Office *</label>
            <select
              value={office}
              onChange={(e) => setOffice(e.target.value)}
              required
            >
              <option value="">Select Office</option>
              {OFFICES.map((off) => (
                <option key={off} value={off}>{off}</option>
              ))}
            </select>
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
