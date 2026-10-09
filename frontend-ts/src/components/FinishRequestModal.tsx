import { useState } from 'react';
import { api } from '../services/api';
import { NotesList, RequestNote } from './RequestNotes';

interface FinishTarget {
  _id: string;
  request_code: string;
  issue: string;
  notes?: RequestNote[];
}

/** Marks an in-progress IT request as done, used by technicians and by IT admins on requests they took. */
function FinishRequestModal({ request, onClose, onFinished, onError }: {
  request: FinishTarget;
  onClose: () => void;
  onFinished: () => void;
  onError: (message: string) => void;
}) {
  const [finished, setFinished] = useState('repaired');
  const [remarks, setRemarks] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleMarkDone = async () => {
    setSubmitting(true);
    try {
      await api.post('/requests/request_finish', {
        request_id: request._id,
        finished,
        ...(remarks && { remarks }),
        ...(recommendation && { recommendation })
      });
      onFinished();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; error?: string } } };
      onError(err.response?.data?.message || err.response?.data?.error || 'Failed to mark request as done');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>Mark Request as Done</h3>
        <p><strong>Request:</strong> {request.request_code}</p>
        <p><strong>Issue:</strong> {request.issue}</p>
        <NotesList notes={request.notes} />

        <div className="form-group">
          <label>Status *</label>
          <select value={finished} onChange={(e) => setFinished(e.target.value)} required>
            <option value="repaired">Repaired</option>
            <option value="beyond repair">Beyond Repair</option>
          </select>
        </div>

        <div className="form-group">
          <label>Remarks</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Optional" />
        </div>

        <div className="form-group">
          <label>Recommendation</label>
          <textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} rows={3} placeholder="Optional" />
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleMarkDone} disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </button>
          <button data-modal-dismiss className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default FinishRequestModal;
