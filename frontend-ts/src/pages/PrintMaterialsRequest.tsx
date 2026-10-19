import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { PriorityField, Priority } from '../components/Priority';
import { DateField } from '../components/DateField';
import { TimeField } from '../components/TimeField';
import FileDrop from '../components/FileDrop';
import Select from '../components/Select';


const FORM_OF_PRINTED_MEDIA = [
  'Tarpaulin',
  'Brochures, Flyers, and other small-size commonly printed publications (Not larger than a long bond paper)',
  'Other Forms of Printed Media'
];

function PrintMaterialsRequest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The backend files the request under the signed-in account's name (first and last).
  const requestorName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username;
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [files, setFiles] = useState<File[]>([]);
  
  const [formData, setFormData] = useState({
    form_of_printed_media: '',
    size_of_printed_media: '',
    printed_media_description: '',
    event_ppa_name: '',
    target_date: '',
    target_time: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!formData.size_of_printed_media.trim() || !formData.printed_media_description.trim() || !formData.event_ppa_name.trim()) {
      setMessage('Please fill in all required fields');
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage('');

    try {
      const submitData = new FormData();
      submitData.append('form_of_printed_media', formData.form_of_printed_media);
      submitData.append('size_of_printed_media', formData.size_of_printed_media);
      submitData.append('printed_media_description', formData.printed_media_description);
      submitData.append('event_ppa_name', formData.event_ppa_name);
      submitData.append('target_date', formData.target_date);
      submitData.append('target_time', formData.target_time);
      submitData.append('priority', priority);
      
      if (files) {
        for (let i = 0; i < files.length; i++) {
          submitData.append('supporting_files', files[i]);
        }
      }

      const response = await api.post('/printmaterials/create_request', submitData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.status === 'success') {
        setMessage(`Request submitted successfully! Your code is: ${response.data.request_code}`);
        setTimeout(() => {
          navigate('/print-materials-history');
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
        <h2>Request for Design and Production of Print Materials for Physical Dissemination</h2>
        <p className="form-description">
          Creation of printed communication materials such as tarpaulins, brochures, flyers, and similar outputs 
          for public information campaigns, announcements, and official LGU notices.
        </p>
        
        {message && (
          <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="request-form grid-ticket" data-ticket="Print Materials">
          <div className="form-row">
            <div className="form-group c6">
              <label>Name of Requestor</label>
              <div className="form-control-static">{requestorName}</div>
              <small>Taken from your account. The name shown shall serve as the official requestor.</small>
            </div>

            <div className="form-group c6">
              <label>Contact Number of Requestor</label>
              <div className="form-control-static">{user?.contact_number || 'None yet'}</div>
              {user?.contact_number ? (
                <small>Taken from your account. Change it on your Profile page.</small>
              ) : (
                <small className="field-error">
                  Your account has no contact number yet. <Link to="/profile">Add it in your profile</Link> before submitting.
                </small>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>Name of Event or PPA Related to the Printed Media Being Requested *</label>
            <input
              type="text"
              name="event_ppa_name"
              value={formData.event_ppa_name}
              onChange={handleInputChange}
              required
              maxLength={100}
              placeholder="State the official name of the event or Program, Project, or Activity (PPA)"
            />
          </div>

          <div className="form-group">
            <label>Description of the Printed Media Being Requested *</label>
            <textarea
              name="printed_media_description"
              value={formData.printed_media_description}
              onChange={handleInputChange}
              required
              rows={4}
              maxLength={100}
              placeholder="Provide a short description of the content, purpose, or layout of the material (e.g., for event backdrop, with official logos, program title, etc.)"
            />
          </div>

          <div className="form-group c6">
            <label>Form of Printed Media Being Requested *</label>
            <Select
              name="form_of_printed_media"
              value={formData.form_of_printed_media}
              onChange={handleInputChange}
              required
            >
              <option value="">Select Form of Printed Media</option>
              {FORM_OF_PRINTED_MEDIA.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Select>
          </div>

          <div className="form-group c6">
            <label>Size of the Printed Media Being Requested *</label>
            <input
              type="text"
              name="size_of_printed_media"
              value={formData.size_of_printed_media}
              onChange={handleInputChange}
              required
              maxLength={20}
              placeholder="e.g., 2ft x 3ft, A4, 5ft x 7ft, etc."
            />
          </div>

          <div className="form-row">
            <div className="form-group c6">
              <label>Target Date of Posting or Use *</label>
              <DateField
                aria-label="Target date"
                min={new Date().toLocaleDateString('en-CA')}
                name="target_date"
                value={formData.target_date}
                onChange={(day) => setFormData((prev) => ({ ...prev, target_date: day }))}
                required
              />
            </div>

            <div className="form-group c6">
              <label>Target Time of Posting or Use *</label>
              <TimeField
                aria-label="Target time"
                name="target_time"
                value={formData.target_time}
                onChange={(time) => setFormData((prev) => ({ ...prev, target_time: time }))}
                required
              />
            </div>
          </div>

          <div className="c6"><PriorityField value={priority} onChange={setPriority} /></div>

          <div className="form-group c6">
            <FileDrop
              label="Upload relevant files and materials (Optional)"
              files={files}
              onChange={setFiles}
              accept=".pdf,.doc,.docx,.pptx,.jpg,.jpeg,.png"
              multiple
              hint="Allowed: PDF, JPG, PNG, Word, PowerPoint (.pptx) (max 10MB each). Save Illustrator files as PDF."
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

export default PrintMaterialsRequest;
