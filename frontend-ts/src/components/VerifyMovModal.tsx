import { useState } from 'react';
import { api } from '../services/api';
import { NotesList, RequestNote } from './RequestNotes';
import MovPhotos from './MovPhotos';

interface VerifyTarget {
  _id: string;
  request_code: string;
  issue: string;
  client_name?: string;
  office?: string;
  assigned_name?: string | null;
  finished?: string | null;
  remarks?: string | null;
  recommendation?: string | null;
  mov_files?: string[];
  mov_submitted_at?: string | null;
  notes?: RequestNote[];
}

/**
 * The IT admin's check of a finished IT request: the MOV photos and the technician's report. Approve
 * marks the request done (the client is told and asked to rate it); Return sends it back to the
 * technician with a reason.
 */
function VerifyMovModal({ request, onClose, onDone, onError }: {
  request: VerifyTarget;
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const send = async (path: string, body: Record<string, string>, fallback: string) => {
    setSubmitting(true);
    try {
      await api.post(path, body);
      onDone();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; error?: string; details?: { message: string }[] } } };
      const data = err.response?.data;
      onError(data?.message || data?.details?.[0]?.message || data?.error || fallback);
    } finally {
      setSubmitting(false);
    }
  };

  const approve = () => send('/requests/verify_mov', { request_id: request._id }, 'Failed to verify the MOV');
  const sendBack = () => send('/requests/return_mov', { request_id: request._id, reason: reason.trim() }, 'Failed to return the MOV');

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>Verify MOV</h3>
        <p><strong>Request:</strong> {request.request_code}</p>
        {request.client_name && <p><strong>Requested By:</strong> {request.client_name}{request.office ? `, ${request.office}` : ''}</p>}
        <p><strong>Issue:</strong> {request.issue}</p>
        <p><strong>Done by:</strong> {request.assigned_name || '-'}{request.mov_submitted_at ? ` (sent ${request.mov_submitted_at})` : ''}</p>
        <p><strong>Result:</strong> {request.finished === 'beyond repair' ? 'Beyond Repair' : 'Repaired'}</p>
        {request.remarks && <p><strong>Remarks:</strong> {request.remarks}</p>}
        {request.recommendation && <p><strong>Recommendation:</strong> {request.recommendation}</p>}

        <MovPhotos requestId={request._id} code={request.request_code} files={request.mov_files} />
        <NotesList notes={request.notes} />

        {returning ? (
          <>
            <div className="form-group">
              <label htmlFor="mov-return-reason">What needs to be redone? *</label>
              <textarea
                id="mov-return-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. The photo does not show the printer working"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn-danger" onClick={sendBack} disabled={submitting || reason.trim().length < 3}>
                {submitting ? 'Sending...' : 'Return to technician'}
              </button>
              <button className="btn-secondary" onClick={() => setReturning(false)} disabled={submitting}>Back</button>
            </div>
          </>
        ) : (
          <div className="modal-actions">
            <button className="btn-primary" onClick={approve} disabled={submitting}>
              {submitting ? 'Saving...' : 'Approve and mark done'}
            </button>
            <button className="btn-secondary" onClick={() => setReturning(true)} disabled={submitting}>Return</button>
            <button data-modal-dismiss className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default VerifyMovModal;
