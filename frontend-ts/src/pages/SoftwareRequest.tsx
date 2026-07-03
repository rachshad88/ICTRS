import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import { api } from '../services/api';

function SoftwareRequest() {
  const { user } = useAuth();
  const [proposedTitle, setProposedTitle] = useState('');
  const [clientNameOffice, setClientNameOffice] = useState('');
  const [statementOfProblem, setStatementOfProblem] = useState('');
  const [objective, setObjective] = useState('');
  const [formalLetter, setFormalLetter] = useState<File | null>(null);
  const [processFlow, setProcessFlow] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [liveUpdate, setLiveUpdate] = useState('');

  useEffect(() => {
    if (user) initSocket(user.user_id, user.roles || [user.role]);
  }, [user]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onApproved = (data: { request_code?: string }) => {
      setLiveUpdate(`Request ${data.request_code || ''} has been approved and assigned to a programmer.`);
    };
    const onRejected = (data: { request_code?: string; rejection_reason?: string }) => {
      setLiveUpdate(`Request ${data.request_code || ''} was rejected. Reason: ${data.rejection_reason || ''}`);
    };
    const onCompleted = (data: { request_code?: string }) => {
      setLiveUpdate(`Request ${data.request_code || ''} has been completed!`);
    };

    socket.on('software_request_approved', onApproved);
    socket.on('software_request_rejected', onRejected);
    socket.on('software_request_completed', onCompleted);

    return () => {
      socket.off('software_request_approved', onApproved);
      socket.off('software_request_rejected', onRejected);
      socket.off('software_request_completed', onCompleted);
    };
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSuccess('');
    setLiveUpdate('');

    if (!formalLetter || !processFlow) {
      setError('Both formal request letter and process flow are required');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('proposed_title', proposedTitle);
      formData.append('client_name_office', clientNameOffice);
      formData.append('statement_of_problem', statementOfProblem);
      formData.append('objective', objective);
      formData.append('formal_request_letter', formalLetter);
      formData.append('process_flow', processFlow);

      const response = await api.post('/software/create_request', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setSuccess(`Request submitted successfully! Code: ${response.data.request_code}`);
      setProposedTitle('');
      setClientNameOffice('');
      setStatementOfProblem('');
      setObjective('');
      setFormalLetter(null);
      setProcessFlow(null);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string; message?: string } } };
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to submit request');
    } finally {
      setTimeout(() => setSubmitting(false), 5000);
    }
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Software Development Request</h2>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      {liveUpdate && <div className="success-message">{liveUpdate}</div>}

      <div className="card" style={{ maxWidth: '700px', margin: '0 auto' }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Proposed Title *</label>
            <input type="text" value={proposedTitle} onChange={(e) => setProposedTitle(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>Client Name / Office *</label>
            <input type="text" value={clientNameOffice} onChange={(e) => setClientNameOffice(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>Statement of the Problem *</label>
            <textarea value={statementOfProblem} onChange={(e) => setStatementOfProblem(e.target.value)} rows={4} required />
          </div>

          <div className="form-group">
            <label>Objective *</label>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={3} required />
          </div>

          <div className="form-group">
            <label>Formal Request Letter * (PDF, JPG, PNG, DOC, DOCX)</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => setFormalLetter(e.target.files?.[0] || null)} required />
            {formalLetter && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{formalLetter.name}</span>}
          </div>

          <div className="form-group">
            <label>Process Flow * (PDF, JPG, PNG, DOC, DOCX)</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => setProcessFlow(e.target.files?.[0] || null)} required />
            {processFlow && <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{processFlow.name}</span>}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SoftwareRequest;