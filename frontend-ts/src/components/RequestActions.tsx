import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { refreshService, type Service } from '../services/queryClient';
import { NotesList, DeclineForm, RequestNote } from './RequestNotes';
import { ReassignForm, PriorityForm, CompleteForm, PRIORITY_OPTIONS, priorityLabel, suggestedDueDate, formatDay } from './Priority';
import FinishRequestModal from './FinishRequestModal';
import { DateField } from './DateField';
import Select from './Select';

// Assign, take, decline, reassign and finish for the All Requests list (pages/AllRequests.tsx), for whoever
// manages the request's type: the super admin every type, IT and multimedia admins their own. Each
// action goes to the type's own endpoint, the same ones the IT and media assign dashboards use.

export interface ActionRequest {
  _id: string;
  type: string;
  request_code: string;
  title: string | null;
  status: string;
  priority?: string;
  due?: string | null;
  assigned_to?: string | null;
  assignee_name?: string | null;
  requester_name?: string | null;
  notes?: RequestNote[];
}

interface Staff {
  _id: string;
  first_name: string;
  last_name: string;
}

const TYPES: Record<string, { api: string; assign: string; decline: string; service: Service; adminRole: string; staffLabel: string }> = {
  it: { api: '/requests', assign: '/requests/accept_request', decline: '/requests/decline_request', service: 'it', adminRole: 'IT_ADMIN', staffLabel: 'technician' },
  multimedia: { api: '/multimedia', assign: '/multimedia/assign', decline: '/multimedia/decline', service: 'multimedia', adminRole: 'MULTIMEDIA_ADMIN', staffLabel: 'staff member' },
  digital_media: { api: '/digitalmedia', assign: '/digitalmedia/assign', decline: '/digitalmedia/decline', service: 'digitalMedia', adminRole: 'MULTIMEDIA_ADMIN', staffLabel: 'staff member' },
  print_materials: { api: '/printmaterials', assign: '/printmaterials/assign', decline: '/printmaterials/decline', service: 'printMaterials', adminRole: 'MULTIMEDIA_ADMIN', staffLabel: 'staff member' },
};

const isWaiting = (r: ActionRequest) => ['PENDING', 'UNASSIGNED'].includes(r.status) && !r.assigned_to;

function apiError(e: unknown, fallback: string) {
  const err = e as { response?: { data?: { error?: string; message?: string } } };
  return err.response?.data?.error || err.response?.data?.message || fallback;
}

/** The row buttons and the dialogs they open. Render `dialogs` once on the page. */
export function useRequestActions(onError: (message: string) => void) {
  const { user } = useAuth();
  const roles = user?.roles || (user ? [user.role] : []);
  const can = (role: string) => roles.includes('ADMIN') || roles.includes(role);
  const canManage = (r: ActionRequest) => !!TYPES[r.type] && can(TYPES[r.type].adminRole);

  const [assignTarget, setAssignTarget] = useState<ActionRequest | null>(null);
  const [assignStaff, setAssignStaff] = useState('');
  const [assignPriority, setAssignPriority] = useState('NORMAL');
  const [assignDue, setAssignDue] = useState('');
  const [manageTarget, setManageTarget] = useState<ActionRequest | null>(null);
  const [finishTarget, setFinishTarget] = useState<ActionRequest | null>(null);
  const [declineTarget, setDeclineTarget] = useState<ActionRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Staff for the pickers; changes only when accounts do (the same caches as the assign dashboards).
  const { data: technicians = [] } = useQuery({
    queryKey: ['users', 'technicians', 'it'],
    queryFn: () => api.get<{ technicians: Staff[] }>('/requests/get_technicians').then((r) => r.data.technicians),
    staleTime: 5 * 60_000,
    enabled: !!user && can('IT_ADMIN'),
  });
  const { data: mediaStaff = [] } = useQuery({
    queryKey: ['users', 'technicians', 'multimedia'],
    queryFn: () => api.get<{ technicians: Staff[] }>('/multimedia/get_technicians').then((r) => r.data.technicians),
    staleTime: 5 * 60_000,
    enabled: !!user && can('MULTIMEDIA_ADMIN'),
  });
  const staffFor = (r: ActionRequest) => (r.type === 'it' ? technicians : mediaStaff);
  const isMine = (r: ActionRequest) => !!user && r.assigned_to === user.user_id;
  const refresh = (r: ActionRequest) => refreshService(TYPES[r.type].service);

  const openAssign = (r: ActionRequest) => {
    const priority = r.priority || 'NORMAL';
    setAssignTarget(r);
    setAssignStaff('');
    setAssignPriority(priority);
    setAssignDue(r.due || suggestedDueDate(priority));
  };

  // Keep the suggested IT due date in step with priority until the admin picks a date themselves.
  const changeAssignPriority = (priority: string) => {
    if (assignDue === suggestedDueDate(assignPriority)) setAssignDue(suggestedDueDate(priority));
    setAssignPriority(priority);
  };

  // Assigns from the dialog, or "Take" with the signed-in admin's own id. IT requests also carry a
  // due date: the one chosen, or the request's own (or the one suggested for its priority).
  const assign = async (r: ActionRequest, staffId: string, priority: string, due: string) => {
    if (submitting || !staffId) return;
    setSubmitting(true);
    try {
      await api.post(TYPES[r.type].assign, {
        request_id: r._id,
        technician_id: staffId,
        priority,
        ...(r.type === 'it' && { due_date: due }),
      });
      setAssignTarget(null);
      onError('');
      refresh(r);
    } catch (e) {
      onError(apiError(e, staffId === user?.user_id ? 'Failed to take request' : 'Failed to assign request'));
    } finally {
      setSubmitting(false);
    }
  };

  const take = (r: ActionRequest) => {
    if (!user) return;
    const priority = r.priority || 'NORMAL';
    assign(r, user.user_id, priority, r.due || suggestedDueDate(priority));
  };

  // Moves an in-progress request from whoever has it to the signed-in admin.
  const takeOver = async (r: ActionRequest) => {
    if (submitting || !user) return;
    setSubmitting(true);
    try {
      await api.post(`${TYPES[r.type].api}/reassign`, { request_id: r._id, technician_id: user.user_id });
      setManageTarget(null);
      onError('');
      refresh(r);
    } catch (e) {
      onError(apiError(e, 'Failed to take request'));
    } finally {
      setSubmitting(false);
    }
  };

  const closeManage = () => {
    if (manageTarget) refresh(manageTarget);
    setManageTarget(null);
  };

  /** The buttons for one request, or null when there is nothing to do. `before` runs first (to close a details dialog). */
  const buttons = (r: ActionRequest, before?: () => void): ReactNode => {
    if (!canManage(r)) return null;
    const run = (fn: () => void) => () => { before?.(); fn(); };
    if (isWaiting(r)) {
      return (
        <div className="history-actions">
          <button type="button" className="hbtn hbtn-assign" onClick={run(() => openAssign(r))}>Assign</button>
          <button type="button" className="hbtn hbtn-done" onClick={run(() => take(r))} disabled={submitting}>Take</button>
          <button type="button" className="hbtn hbtn-cancel" onClick={run(() => setDeclineTarget(r))}>Decline</button>
        </div>
      );
    }
    if (r.status === 'IN_PROGRESS') {
      return (
        <div className="history-actions">
          {isMine(r) && r.type === 'it' && (
            <button type="button" className="hbtn hbtn-done" onClick={run(() => setFinishTarget(r))}>Mark Done</button>
          )}
          <button type="button" className="hbtn hbtn-view" onClick={run(() => setManageTarget(r))}>Manage</button>
        </div>
      );
    }
    return null;
  };

  const staffLabel = (r: ActionRequest) => TYPES[r.type].staffLabel;

  const dialogs = (
    <>
      {assignTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Assign {assignTarget.request_code}</h3>
            <p><strong>Summary:</strong> {assignTarget.title || '-'}</p>
            <p><strong>Requested By:</strong> {assignTarget.requester_name || 'Unknown'}</p>
            <NotesList notes={assignTarget.notes} />
            <div className="form-group">
              <label htmlFor="overview-assign-staff">{assignTarget.type === 'it' ? 'Technician' : 'Multimedia staff'} *</label>
              <Select id="overview-assign-staff" value={assignStaff} onChange={(e) => setAssignStaff(e.target.value)} required>
                <option value="">Select {staffLabel(assignTarget)}...</option>
                {staffFor(assignTarget).map((s) => <option key={s._id} value={s._id}>{s.first_name} {s.last_name}</option>)}
              </Select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="overview-assign-priority">Priority</label>
                <Select id="overview-assign-priority" value={assignPriority} onChange={(e) => changeAssignPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </div>
              {assignTarget.type === 'it' && (
                <div className="form-group">
                  <label htmlFor="overview-assign-due">Due date</label>
                  <DateField id="overview-assign-due" aria-label="Due date" placeholder="No due date" value={assignDue} onChange={setAssignDue} onClear={assignDue ? () => setAssignDue('') : undefined} />
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={() => assign(assignTarget, assignStaff, assignPriority, assignDue)} disabled={submitting || !assignStaff}>
                {submitting ? 'Assigning...' : 'Assign'}
              </button>
              <button data-modal-dismiss type="button" className="btn-secondary" onClick={() => setAssignTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {manageTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Manage {manageTarget.request_code}</h3>
            <p><strong>Summary:</strong> {manageTarget.title || '-'}</p>
            <p><strong>Assigned To:</strong> {isMine(manageTarget) ? 'You' : manageTarget.assignee_name || '-'}</p>
            <p>
              <strong>Priority:</strong> {priorityLabel(manageTarget.priority)}
              {manageTarget.due && <>, due {formatDay(manageTarget.due)}</>}
            </p>
            <NotesList notes={manageTarget.notes} />
            {isMine(manageTarget) ? (
              manageTarget.type === 'it' ? (
                <div className="admin-control">
                  <p className="admin-control-title">Finish</p>
                  <button type="button" className="btn-primary" onClick={() => { setFinishTarget(manageTarget); setManageTarget(null); }}>
                    Mark Done
                  </button>
                </div>
              ) : (
                <CompleteForm
                  endpoint={`${TYPES[manageTarget.type].api}/complete_request`}
                  requestId={manageTarget._id}
                  withRecommendation
                  onDone={closeManage}
                />
              )
            ) : (
              <div className="admin-control">
                <p className="admin-control-title">Take it yourself</p>
                <button type="button" className="btn-primary" onClick={() => takeOver(manageTarget)} disabled={submitting}>
                  {submitting ? 'Taking...' : `Take from ${manageTarget.assignee_name || 'them'}`}
                </button>
              </div>
            )}
            <ReassignForm
              endpoint={`${TYPES[manageTarget.type].api}/reassign`}
              requestId={manageTarget._id}
              currentId={manageTarget.assigned_to}
              staff={staffFor(manageTarget)}
              staffLabel={staffLabel(manageTarget)}
              onDone={closeManage}
            />
            <PriorityForm
              endpoint={`${TYPES[manageTarget.type].api}/set_priority`}
              requestId={manageTarget._id}
              priority={manageTarget.priority}
              dueDate={manageTarget.type === 'it' ? manageTarget.due : undefined}
              withDueDate={manageTarget.type === 'it'}
              onDone={closeManage}
            />
            <div className="modal-actions">
              <button data-modal-dismiss type="button" className="btn-secondary" onClick={() => setManageTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {declineTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Decline {declineTarget.request_code}</h3>
            <p><strong>Summary:</strong> {declineTarget.title || '-'}</p>
            <p><strong>Requested By:</strong> {declineTarget.requester_name || 'Unknown'}</p>
            <NotesList notes={declineTarget.notes} />
            <DeclineForm
              endpoint={TYPES[declineTarget.type].decline}
              requestId={declineTarget._id}
              onBack={() => setDeclineTarget(null)}
              onDeclined={() => { refresh(declineTarget); setDeclineTarget(null); onError(''); }}
            />
          </div>
        </div>
      )}

      {finishTarget && (
        <FinishRequestModal
          request={{ _id: finishTarget._id, request_code: finishTarget.request_code, issue: finishTarget.title || '', notes: finishTarget.notes }}
          onClose={() => setFinishTarget(null)}
          onFinished={() => { refresh(finishTarget); setFinishTarget(null); }}
          onError={onError}
        />
      )}
    </>
  );

  return { buttons, dialogs };
}
