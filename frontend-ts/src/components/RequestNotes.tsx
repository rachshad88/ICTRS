import { useState } from 'react';
import { api } from '../services/api';

export interface RequestNote {
  _id?: string;
  text: string;
  author_name: string;
  created_at: string;
}

const TEXT_MAX = 500;

function apiErrorMessage(error: unknown, fallback: string) {
  const err = error as { response?: { data?: { message?: string; error?: string; details?: Array<{ message: string }> } } };
  const data = err.response?.data;
  return data?.details?.[0]?.message || data?.message || data?.error || fallback;
}

function formatNoteDate(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Shows why a request was declined. Renders nothing when there is no reason. */
export function DeclineReason({ reason }: { reason?: string | null }) {
  if (!reason) return null;
  return (
    <div className="decline-reason">
      <p className="decline-reason-title">Reason for declining</p>
      <p>{reason}</p>
    </div>
  );
}

/**
 * What the staff member wrote when finishing a request, shown to the client in the request details.
 * `result` is the IT outcome (Repaired / Beyond Repair); pass `showRecommendation` for request types whose
 * completion form asks for one (IT and Multimedia). Empty fields say so instead of disappearing.
 */
export function StaffReport({ title, result, remarks, recommendation, showRecommendation = false }: {
  title: string;
  result?: string;
  remarks?: string | null;
  recommendation?: string | null;
  showRecommendation?: boolean;
}) {
  return (
    <div className="staff-report">
      <p className="staff-report-title">{title}</p>
      <dl>
        {result && (
          <div>
            <dt>Result</dt>
            <dd>{result}</dd>
          </div>
        )}
        <div>
          <dt>Remarks</dt>
          <dd className={remarks ? '' : 'staff-report-empty'}>{remarks || 'No remarks given'}</dd>
        </div>
        {showRecommendation && (
          <div>
            <dt>Recommendation</dt>
            <dd className={recommendation ? '' : 'staff-report-empty'}>{recommendation || 'No recommendation given'}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Read-only list of client notes. Renders nothing when there are none. */
export function NotesList({ notes, heading = 'Notes from the client' }: { notes?: RequestNote[]; heading?: string }) {
  if (!notes || notes.length === 0) return null;
  return (
    <div className="request-notes">
      <p className="request-notes-title">{heading} ({notes.length})</p>
      <ul>
        {notes.map((n, i) => (
          <li key={n._id || i}>
            <p>{n.text}</p>
            <span>{n.author_name}, {formatNoteDate(n.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lets the request owner add a note to an open request. */
export function AddNoteForm({ endpoint, requestId, onAdded }: { endpoint: string; requestId: string; onAdded: (note: RequestNote) => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.post(endpoint, { request_id: requestId, text: text.trim() });
      onAdded(res.data.note);
      setText('');
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to add note'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-group add-note">
      <label htmlFor={`note-${requestId}`}>Add a note</label>
      <textarea
        id={`note-${requestId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={TEXT_MAX}
        placeholder="Extra details for the team, for example a property number or a changed event time"
      />
      <div className="add-note-footer">
        <span className="char-count">{text.length}/{TEXT_MAX}</span>
        <button type="button" className="hbtn hbtn-assign" onClick={submit} disabled={saving || !text.trim()}>
          {saving ? 'Adding...' : 'Add note'}
        </button>
      </div>
      {error && <p className="add-note-error">{error}</p>}
    </div>
  );
}

/** Days after being marked done that a client can still reopen an IT request (backend REOPEN_DAYS). */
export const REOPEN_DAYS = 7;

/** True when this finished IT request can still be sent back as "still not fixed". */
export function canReopen(status: string, completedAt?: string | null): boolean {
  if (status !== 'DONE' || !completedAt) return false;
  return Date.now() - new Date(completedAt).getTime() < REOPEN_DAYS * 24 * 60 * 60 * 1000;
}

/** "Still not fixed?": the client says what is still wrong and the request goes back to its technician. */
export function ReopenForm({ requestId, onReopened }: { requestId: string; onReopened: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const valid = reason.trim().length >= 3;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/requests/reopen_request', { request_id: requestId, reason: reason.trim() });
      setOpen(false);
      setReason('');
      onReopened();
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to reopen the request'));
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="reopen-prompt">
        <span>Problem came back, or wasn't fixed?</span>
        <button type="button" className="hbtn hbtn-cancel" onClick={() => setOpen(true)}>Still not fixed</button>
      </div>
    );
  }
  return (
    <div className="form-group add-note reopen-form">
      <label htmlFor={`reopen-${requestId}`}>What is still wrong?</label>
      <textarea
        id={`reopen-${requestId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={TEXT_MAX}
        placeholder="For example: the printer jams again after a few pages"
        autoFocus
      />
      <p className="reopen-hint">It goes back to the technician who handled it, with your note.</p>
      <div className="add-note-footer">
        <button type="button" className="hbtn hbtn-view" onClick={() => { setOpen(false); setError(''); }} disabled={saving}>Never mind</button>
        <button type="button" className="hbtn hbtn-cancel" onClick={submit} disabled={!valid || saving}>
          {saving ? 'Reopening...' : 'Reopen request'}
        </button>
      </div>
      {error && <p className="add-note-error">{error}</p>}
    </div>
  );
}

/** Reason prompt an admin fills in before declining an unassigned request. */
export function DeclineForm({ endpoint, requestId, onDeclined, onBack }: { endpoint: string; requestId: string; onDeclined: () => void; onBack: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const valid = reason.trim().length >= 3;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post(endpoint, { request_id: requestId, reason: reason.trim() });
      onDeclined();
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to decline request'));
      setSaving(false);
    }
  };

  return (
    <div className="decline-form">
      <div className="form-group">
        <label htmlFor={`decline-${requestId}`}>Reason for declining *</label>
        <textarea
          id={`decline-${requestId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={TEXT_MAX}
          placeholder="The client will see this, for example: schedule conflicts with another event"
          autoFocus
        />
        <span className="char-count">{reason.length}/{TEXT_MAX}</span>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-danger" onClick={submit} disabled={!valid || saving}>
          {saving ? 'Declining...' : 'Decline request'}
        </button>
        <button data-modal-dismiss type="button" className="btn-secondary" onClick={onBack} disabled={saving}>Back</button>
      </div>
    </div>
  );
}
