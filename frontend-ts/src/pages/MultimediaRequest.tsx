import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { PriorityField, Priority } from '../components/Priority';


const LOCATION_TYPES = [
  'Within the LGU Solano Compound',
  'Within Solano, but outside the LGU Solano Compound',
  'Within Nueva Vizcaya, but outside Solano',
  'Outside of Nueva Vizcaya'
];

function MultimediaRequest() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [file, setFile] = useState<File | null>(null);
  
  const [formData, setFormData] = useState({
    event_title: '',
    event_date: '',
    event_start_time: '',
    event_end_time: '',
    specific_location: '',
    location_type: '',
    contact_number: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'contact_number') {
      const numericValue = value.replace(/\D/g, '').slice(0, 11);
      setFormData(prev => ({ ...prev, [name]: numericValue }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      
      // Check file size (10MB limit)
      if (selectedFile.size > 10 * 1024 * 1024) {
        setMessage('File size exceeds 10MB limit');
        return;
      }
      
      // Check file type
      // Checked by extension, as the server does; browsers report inconsistent MIME types.
      const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
      const extension = selectedFile.name.split('.').pop()?.toLowerCase() || '';
      if (!allowedExtensions.includes(extension)) {
        setMessage('Only PDF, images, and Word documents are allowed');
        return;
      }
      
      setFile(selectedFile);
      setMessage('');
    }
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
      submitData.append('contact_number', formData.contact_number);
      submitData.append('priority', priority);
      
      if (file) {
        submitData.append('program_file', file);
      }

      const response = await api.post('/multimedia/create_request', submitData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.status === 'success') {
        setMessage(`Multimedia request submitted successfully! Your code is: ${response.data.request_code}`);
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
    <div className="request-page">

      <div className="container">
        <h2>Multimedia Request</h2>
        
        {message && (
          <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="request-form" data-ticket="Multimedia">
          <div className="form-group">
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
            <div className="form-group">
              <label>Event Date *</label>
              <input
                type="date"
                min={new Date().toLocaleDateString('en-CA')}
                name="event_date"
                value={formData.event_date}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label>Start Time *</label>
              <input
                type="time"
                name="event_start_time"
                value={formData.event_start_time}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label>Estimated End Time *</label>
              <input
                type="time"
                name="event_end_time"
                value={formData.event_end_time}
                onChange={handleInputChange}
                required
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Contact Number *</label>
              <input
                autoComplete="tel"
                type="tel"
                name="contact_number"
                value={formData.contact_number}
                onChange={handleInputChange}
                required
                maxLength={11}
                placeholder="e.g., 09XXXXXXXXX"
              />
            </div>
            
            <div className="form-group">
              <label>Location Type *</label>
              <select
                name="location_type"
                value={formData.location_type}
                onChange={handleInputChange}
                required
              >
                <option value="">Select Location Type</option>
                {LOCATION_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="form-group">
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
          
          <PriorityField value={priority} onChange={setPriority} />

          <div className="form-group">
            <label>Program/Schedule of Event (Optional)</label>
            <input
              type="file"
              onChange={handleFileChange}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            />
            {file && <p className="file-selected">✓ {file.name}</p>}
            <small>Max 10MB. Allowed: PDF, images, Word documents</small>
          </div>
          
          <div className="ticket-tear" aria-hidden="true" />
          
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default MultimediaRequest;
