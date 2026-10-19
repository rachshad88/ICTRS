import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { DateField } from '../components/DateField';
import { TimeField } from '../components/TimeField';
import FileDrop from '../components/FileDrop';
import Select from '../components/Select';


const LOCATION_TYPES = [
  'Within the LGU Solano Compound',
  'Within Solano, but outside the LGU Solano Compound',
  'Within Nueva Vizcaya, but outside Solano',
  'Outside of Nueva Vizcaya'
];

function MultimediaRequest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  
  const [formData, setFormData] = useState({
    event_title: '',
    event_date: '',
    event_start_time: '',
    event_end_time: '',
    specific_location: '',
    location_type: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!formData.event_title.trim() || !formData.specific_location.trim()) {
      setMessage('Please fill in all required fields');
      setLoading(false);
      return;
    }
    if (formData.event_end_time <= formData.event_start_time) {
      setMessage('End time must be after the start time');
      return;
    }
    setLoading(true);
    setMessage('');

    try {
      const submitData = new FormData();
      submitData.append('event_title', formData.event_title.trim());
      submitData.append('event_date', formData.event_date);
      submitData.append('event_start_time', formData.event_start_time);
      submitData.append('event_end_time', formData.event_end_time);
      submitData.append('specific_location', formData.specific_location);
      submitData.append('location_type', formData.location_type);
      
      if (files[0]) {
        submitData.append('program_file', files[0]);
      }

      const response = await api.post('/multimedia/create_request', submitData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.status === 'success') {
        setMessage(`Event documentation request submitted successfully! Your code is: ${response.data.request_code}`);
        setTimeout(() => {
          navigate('/multimedia-history');
        }, 1500);
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setMessage(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setTimeout(() => setLoading(false), 5000);
    }
  };

  return (
    <div className="request-page fit-request">

      <div className="container">
        <h2>Event Documentation Request</h2>
        
        {message && (
          <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="request-form grid-ticket" data-ticket="Event Documentation">
          <div className="form-group c6">
            <label>Event Title *</label>
            <input
              type="text"
              name="event_title"
              value={formData.event_title}
              onChange={handleInputChange}
              required
              maxLength={100}
              placeholder="e.g., Annual Conference 2026"
            />
          </div>
          
          <div className="form-row three-cols">
            <div className="form-group c2">
              <label>Event Date *</label>
              <DateField
                aria-label="Event date"
                min={new Date().toLocaleDateString('en-CA')}
                name="event_date"
                value={formData.event_date}
                onChange={(day) => setFormData((prev) => ({ ...prev, event_date: day }))}
                required
              />
            </div>
            
            <div className="form-group c2">
              <label>Start Time *</label>
              <TimeField
                aria-label="Start time"
                name="event_start_time"
                value={formData.event_start_time}
                onChange={(time) => setFormData((prev) => ({ ...prev, event_start_time: time }))}
                required
              />
            </div>
            
            <div className="form-group c2">
              <label>Estimated End Time *</label>
              <TimeField
                aria-label="End time"
                name="event_end_time"
                value={formData.event_end_time}
                onChange={(time) => setFormData((prev) => ({ ...prev, event_end_time: time }))}
                required
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group c4">
              <label>Contact Number</label>
              <div className="form-control-static">{user?.contact_number || 'None yet'}</div>
              {user?.contact_number ? (
                <small>Taken from your account. Change it on your Profile page.</small>
              ) : (
                <small className="field-error">
                  Your account has no contact number yet. <Link to="/profile">Add it in your profile</Link> before submitting.
                </small>
              )}
            </div>
            
            <div className="form-group c4">
              <label>Location Type *</label>
              <Select
                name="location_type"
                value={formData.location_type}
                onChange={handleInputChange}
                required
              >
                <option value="">Select Location Type</option>
                {LOCATION_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </Select>
            </div>
          </div>
          
          <div className="form-group c4">
            <label>Specific Location *</label>
            <textarea
              name="specific_location"
              value={formData.specific_location}
              onChange={handleInputChange}
              required
              rows={3}
              maxLength={100}
              placeholder="e.g., Conference Hall, 2nd Floor, LGU Building"
            />
          </div>
          
          <div className="form-group">
            <FileDrop
              label="Program/Schedule of Event (Optional)"
              files={files}
              onChange={setFiles}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              hint="One file, max 10MB. Allowed: PDF, images, Word documents"
            />
          </div>
          
          <div className="ticket-tear" aria-hidden="true" />
          
          <button type="submit" className="btn-primary" disabled={loading || !user?.contact_number}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default MultimediaRequest;
