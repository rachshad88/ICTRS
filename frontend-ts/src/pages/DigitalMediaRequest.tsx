import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { PriorityField, Priority } from '../components/Priority';


const FORM_OF_DIGITAL_MEDIA = [
  'Social Media Post or Digital Poster',
  'Powerpoint Presentation',
  'Video Presentation',
  'Other form of digital media'
];

function DigitalMediaRequest() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [files, setFiles] = useState<FileList | null>(null);
  
  const [formData, setFormData] = useState({
    description: 'Request for Digital Media Production and Online Information Dissemination',
    form_of_digital_media: '',
    digital_media_description: '',
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
    if (!formData.digital_media_description.trim() || !formData.event_ppa_name.trim() || !formData.requestor_name.trim()) {
      setMessage('Please fill in all required fields');
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage('');

    try {
      const submitData = new FormData();
      submitData.append('description', formData.description);
      submitData.append('form_of_digital_media', formData.form_of_digital_media);
      submitData.append('digital_media_description', formData.digital_media_description);
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

      const response = await api.post('/digitalmedia/create_request', submitData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.status === 'success') {
        setMessage(`Request submitted successfully! Your code is: ${response.data.request_code}`);
        setTimeout(() => {
          navigate('/digitalmedia-history');
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
        <h2>Digital Media Production and Online Information Dissemination</h2>
        <p className="form-description">
          Development and publication of multimedia content for digital platforms, including social media posts, 
          digital posters, video presentations, powerpoints, and other creative outputs intended for online public communication.
        </p>
        
        {message && (
          <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="request-form" data-ticket="Digital Media">
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              required
              disabled
              className="input-disabled"
            />
          </div>

          <div className="form-group">
            <label>Form of Digital Media *</label>
            <select
              name="form_of_digital_media"
              value={formData.form_of_digital_media}
              onChange={handleInputChange}
              required
            >
              <option value="">Select Form of Digital Media</option>
              {FORM_OF_DIGITAL_MEDIA.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Description of the Digital Media Being Requested *</label>
            <textarea
              name="digital_media_description"
              value={formData.digital_media_description}
              onChange={handleInputChange}
              required
              rows={4}
              maxLength={100}
              placeholder="Briefly describe the type of digital media you are requesting (e.g., social media post, infographic, poster, teaser video, etc.). Include specific details or key messages if available."
            />
          </div>

          <div className="form-group">
            <label>Name of Event or PPA Related to the Digital Media Being Requested *</label>
            <input
              type="text"
              name="event_ppa_name"
              value={formData.event_ppa_name}
              onChange={handleInputChange}
              required
              maxLength={100}
              placeholder="Enter the official name of the event or Program, Project, or Activity (PPA)"
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
              maxLength={30}
              placeholder="The name provided shall serve as the official requestor"
            />
            </div>

            <div className="form-group">
              <label>Contact Number of the Requestor *</label>
            <input
              autoComplete="tel"
              type="tel"
              name="requestor_contact"
              value={formData.requestor_contact}
              onChange={handleInputChange}
              required
              maxLength={11}
              placeholder="Mangyaring magbigay ng mobile o landline number"
            />
            </div>
          </div>

          <PriorityField value={priority} onChange={setPriority} />

          <div className="form-group">
            <label>Supporting Files (Optional)</label>
            <input
              type="file"
              onChange={handleFileChange}
              multiple
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.pptx,.mp4,.webm"
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
            <small>Max 10 files. Allowed: PDF, JPG, PNG, Word, PowerPoint (.pptx), MP4, WebM (max 10MB each)</small>
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

export default DigitalMediaRequest;
