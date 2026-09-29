import { useState } from 'react';
import { api } from '../services/api';

export type Priority = 'LOW' | 'NORMAL' | 'URGENT';

export const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent' },
];

export const priorityLabel = (p?: string | null) =>
  PRIORITY_OPTIONS.find((o) => o.value === p)?.label || 'Normal';

function apiErrorMessage(error: unknown, fallback: string) {
  const err = error as { response?: { data?: { message?: string; error?: string; details?: Array<{ message: string }> } } };
  const data = err.response?.data;
  return data?.details?.[0]?.message || data?.message || data?.error || fallback;
}

/** YYYY-MM-DD in the browser's timezone. */
export function toInputDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Starting point for an IT due date when assigning; the admin can change it.
const SUGGESTED_DAYS: Record<Priority, number> = { URGENT: 1, NORMAL: 3, LOW: 7 };
export function suggestedDueDate(priority: string) {
  const d = new Date();
  d.setDate(d.getDate() + (SUGGESTED_DAYS[priority as Priority] ?? 3));
  return toInputDate(d);
}

/** Formats a YYYY-MM-DD day as a calendar date, without timezone shifting it. */
export function formatDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Urgent / Low / Overdue / Due chips shown beside a request code. Normal priority is the default,
 * so it shows nothing; pass `due` only where the due date is not already its own column.
 */
export function RequestFlags({ priority, overdue, due }: { priority?: string | null; overdue?: boolean; due?: string | null }) {
  const showPriority = priority === 'URGENT' || priority === 'LOW';
  if (!showPriority && !overdue && !due) return null;
  return (
    <span className="req-flags">
      {showPriority && <span className={`prio-badge ${priority!.toLowerCase()}`}>{priorityLabel(priority)}</span>}
      {overdue && <span className="overdue-badge">Overdue</span>}
      {due && !overdue && <span className="due-chip">Due {formatDay(due)}</span>}
    </span>
  );
}

/** Priority picker for the client request forms. */
export function PriorityField({ value, onChange }: { value: string; onChange: (v: Priority) => void }) {
  return (
    <div className="form-group">
      <label htmlFor="request-priority">Priority</label>
      <select id="request-priority" value={value} onChange={(e) => onChange(e.target.value as Priority)}>
        {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <small>Choose Urgent only if work has stopped or the deadline is within two days.</small>
    </div>
  );
}

interface StaffOption { _id: string; first_name: string; last_name: string }

/** Moves an in-progress request to another technician or staff member. */
export function ReassignForm({ endpoint, requestId, currentId, staff, staffLabel = 'technician', onDone }: {
  endpoint: string;
  requestId: string;
  currentId?: string | null;
  staff: StaffOption[];
  staffLabel?: string;
  onDone: () => void;
}) {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const others = staff.filter((s) => s._id !== currentId);

  const submit = async () => {
    if (!target || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post(endpoint, { request_id: requestId, technician_id: target, ...(reason.trim() && { reason: reason.trim() }) });
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to reassign request'));
      setSaving(false);
    }
  };

  return (
    <div className="admin-control">
      <p className="admin-control-title">Reassign</p>
      <div className="form-group">
        <label htmlFor={`reassign-${requestId}`}>New {staffLabel}</label>
        <select id={`reassign-${requestId}`} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select {staffLabel}...</option>
          {others.map((s) => <option key={s._id} value={s._id}>{s.first_name} {s.last_name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`reassign-reason-${requestId}`}>Reason (optional)</label>
        <input
          id={`reassign-reason-${requestId}`}
          type="text"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder="For example: on leave this week"
        />
      </div>
      {error && <div className="error-message">{error}</div>}
      <button type="button" className="btn-primary" onClick={submit} disabled={!target || saving}>
        {saving ? 'Reassigning...' : 'Reassign'}
      </button>
    </div>
  );
}

/** Changes priority (and, for IT requests, the due date) of an open request. */
export function PriorityForm({ endpoint, requestId, priority, dueDate, withDueDate = false, onDone }: {
  endpoint: string;
  requestId: string;
  priority?: string | null;
  dueDate?: string | null;
  withDueDate?: boolean;
  onDone: () => void;
}) {
  const initialPriority = (priority || 'NORMAL') as Priority;
  const initialDue = dueDate || '';
  const [value, setValue] = useState<Priority>(initialPriority);
  const [due, setDue] = useState(initialDue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = value !== initialPriority || (withDueDate && due !== initialDue);

  const submit = async () => {
    if (!changed || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post(endpoint, { request_id: requestId, priority: value, ...(withDueDate && { due_date: due }) });
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e, 'Failed to update priority'));
      setSaving(false);
    }
  };

  return (
    <div className="admin-control">
      <p className="admin-control-title">Priority{withDueDate ? ' and due date' : ''}</p>
      <div className={withDueDate ? 'form-row' : undefined}>
        <div className="form-group">
          <label htmlFor={`prio-${requestId}`}>Priority</label>
          <select id={`prio-${requestId}`} value={value} onChange={(e) => setValue(e.target.value as Priority)}>
            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {withDueDate && (
          <div className="form-group">
            <label htmlFor={`due-${requestId}`}>Due date</label>
            <input id={`due-${requestId}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        )}
      </div>
      {error && <div className="error-message">{error}</div>}
      <button type="button" className="btn-secondary" onClick={submit} disabled={!changed || saving}>
        {saving ? 'Saving...' : 'Save priority'}
      </button>
    </div>
  );
}
