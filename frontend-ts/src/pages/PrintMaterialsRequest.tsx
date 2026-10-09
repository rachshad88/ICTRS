import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { PriorityField, Priority } from '../components/Priority';


const FORM_OF_PRINTED_MEDIA = [
  'Tarpaulin',
  'Brochures, Flyers, and other small-size commonly printed publications (Not larger than a long bond paper)',
  'Other Forms of Printed Media'
];

function PrintMaterialsRequest() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [files, setFiles] = useState<FileList | null>(null);
  
  const [formData, setFormData] = useState({
    form_of_printed_media: '',
    size_of_printed_media: '',
    printed_media_description: '',
    event_ppa_name: '',
    target_date: '',
    target_time: '',
    requestor_name: '',
    requestor_contact: ''
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'requestor_contact') {
      const digitsOnly = value.replace(/\D/g, '').slice(0, 11);
      setFormData(prev => ({ ...prev, [name]: digitsOnly }));
      return;
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (e.target.files.length > 10) {
        setMessage('Maximum 10 files allowed');
        return;
      }
      
      let totalSize = 0;
      for (let i = 0; i < e.target.files.length; i++) {
        totalSize += e.target.files[i].size;
      }
      
      if (totalSize > 10 * 1024 * 1024 * 10) {
        setMessage('Total file size exceeds 100MB limit');
        return;
      }
      
      setFiles(e.target.files);
      setMessage('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!formData.size_of_printed_media.trim() || !formData.printed_media_description.trim() || !formData.event_ppa_name.trim() || !formData.requestor_name.trim()) {
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
      submitData.append('requestor_name', formData.requestor_name);
      submitData.append('requestor_contact', formData.requestor_contact);
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
    <div className="request-page">

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
        
        <form onSubmit={handleSubmit} className="request-form" data-ticket="Print Materials">
          <div className="form-group">
            <label>Form of Printed Media Being Requested *</label>
            <select
              name="form_of_printed_media"
              value={formData.form_of_printed_media}
              onChange={handleInputChange}
              required
            >
              <option value="">Select Form of Printed Media</option>
              {FORM_OF_PRINTED_MEDIA.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
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

          <div className="form-row">
            <div className="form-group">
              <label>Target Date of Posting or Use *</label>
              <input
                type="date"
                min={new Date().toLocaleDateString('en-CA')}
                name="target_date"
                value={formData.target_date}
                onChange={handleInputChange}
                required
              />
            </div>

            <div className="form-group">
              <label>Target Time of Posting or Use *</label>
              <input
                type="time"
                name="target_time"
                value={formData.target_time}
                onChange={handleInputChange}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Name of Requestor *</label>
            <input
              autoComplete="name"
              type="text"
              name="requestor_name"
              value={formData.requestor_name}
              onChange={handleInputChange}
              required
              maxLength={20}
              placeholder="The name provided shall serve as the official requestor"
            />
            </div>

            <div className="form-group">
              <label>Contact Number of Requestor *</label>
            <input
              autoComplete="tel"
              type="tel"
              name="requestor_contact"
              value={formData.requestor_contact}
              onChange={handleInputChange}
              required
              maxLength={11}
              placeholder="Please provide a mobile or landline number"
            />
            </div>
          </div>

          <PriorityField value={priority} onChange={setPriority} />

          <div className="form-group">
            <label>Upload relevant files and materials (Optional)</label>
            <input
              type="file"
              onChange={handleFileChange}
              multiple
              accept=".pdf,.doc,.docx,.pptx,.jpg,.jpeg,.png,.eps,.ps,.psd,.tif,.tiff"
            />
            {files && files.length > 0 && (
              <div className="file-list">
                {Array.from(files).map((file, index) => (
                  <p key={index} className="file-selected">
                    ✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  </p>
                ))}
              </div>
            )}
            <small>Max 10 files. Allowed: PDF, JPG, PNG, Word, PowerPoint (.pptx), EPS, Photoshop, TIFF (max 10MB each). Save Illustrator files as PDF or EPS.</small>
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

export default PrintMaterialsRequest;
