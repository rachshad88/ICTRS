import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { refreshService } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, DeclineReason, DeclineForm, RequestNote } from '../components/RequestNotes';
import FinishRequestModal from '../components/FinishRequestModal';
import { RequestFlags, PriorityForm, ReassignForm, PRIORITY_OPTIONS, suggestedDueDate, priorityLabel, formatDay } from '../components/Priority';
import SearchBox from '../components/SearchBox';

interface Request {
  _id: string;
  request_code: string;
  office: string;
  unit: string;
  issue: string;
  client_name: string;
  status: string;
  statusClass: string;
  created_at: string;
  completed_at: string;
  assigned_to: string | null;
  assigned_name?: string | null;
  priority?: string;
  due_date?: string | null;
  overdue?: boolean;
  decline_reason?: string | null;
  notes?: RequestNote[];
}

interface Technician {
  _id: string;
  first_name: string;
  last_name: string;
}

interface Counts {
  pending_count: number;
  progress_count: number;
  done_count: number;
  declined_count: number;
  repaired_count: number;
  beyond_repair_count: number;
  urgent_count: number;
  overdue_count: number;
}

const NO_COUNTS: Counts = {
  pending_count: 0,
  progress_count: 0,
  done_count: 0,
  declined_count: 0,
  repaired_count: 0,
  beyond_repair_count: 0,
  urgent_count: 0,
  overdue_count: 0
};

interface DashboardData {
  requests: Request[];
  counts: Partial<Counts>;
  total?: number;
}

// Heading for the requests still open from before the selected day/week/month (shown above it).
const EARLIER_LABEL: Record<string, string> = {
  daily: 'Still open from earlier days',
  weekly: 'Still open from earlier weeks',
  monthly: 'Still open from earlier months',
};
const PERIOD_LABEL: Record<string, string> = { daily: 'This day', weekly: 'This week', monthly: 'This month' };

function ItAdminDashboard() {
  const { user } = useAuth();
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [showDone, setShowDone] = useState('1');

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [assignPriority, setAssignPriority] = useState('NORMAL');
  const [assignDue, setAssignDue] = useState('');
  const [manageTarget, setManageTarget] = useState<Request | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [declineTarget, setDeclineTarget] = useState<Request | null>(null);
  const [viewTarget, setViewTarget] = useState<Request | null>(null);
  const [finishTarget, setFinishTarget] = useState<Request | null>(null);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm]);

  // Cached per filter and page, shared with the technician dashboard's identical requests
  // (services/queryClient.ts); IT socket events refresh it.
  const params = { filter: filterType, date: selectedDate, show_done: showDone, page: currentPage, limit: 10, ...(searchTerm && { search: searchTerm }) };
  const { data, isPending: loading } = useQuery({
    queryKey: ['it', 'dashboard', params],
    queryFn: () => api.get<DashboardData>('/requests/get_dashboard', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or filter loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const requests = data?.requests ?? [];
  const counts: Counts = { ...NO_COUNTS, ...data?.counts };
  const total = data?.total || 0;
  // Requests still open from before the selected period, oldest first (open_earlier=1). Shown on
  // page 1 above the period's own requests, so nothing older is forgotten behind the Daily filter.
  const earlierParams = { filter: filterType, date: selectedDate, open_earlier: '1', limit: 100, ...(searchTerm && { search: searchTerm }) };
  const { data: earlierData } = useQuery({
    queryKey: ['it', 'dashboard-earlier', earlierParams],
    queryFn: () => api.get<DashboardData>('/requests/get_dashboard', { params: earlierParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user && filterType !== 'all',
  });
  const earlier = filterType !== 'all' && currentPage === 1 ? earlierData?.requests ?? [] : [];
  // A successful refresh clears an earlier action error, as the hand-rolled fetch used to.
  useEffect(() => { setError(''); }, [data]);

  const fetchTechnicians = async () => {
    try {
      const response = await api.get('/requests/get_technicians');
      setTechnicians(response.data.technicians);
    } catch (error) {
      console.error('Failed to fetch technicians:', error);
    }
  };

  const openAssignModal = async (req: Request) => {
    const priority = req.priority || 'NORMAL';
    setSelectedRequest(req);
    setSelectedTechnician('');
    setAssignPriority(priority);
    setAssignDue(req.due_date || suggestedDueDate(priority));
    setShowAssignModal(true);
    await fetchTechnicians();
  };

  // Keep the suggested due date in step with priority until the admin picks a date themselves.
  const changeAssignPriority = (priority: string) => {
    if (assignDue === suggestedDueDate(assignPriority)) setAssignDue(suggestedDueDate(priority));
    setAssignPriority(priority);
  };

  const openManageModal = async (req: Request) => {
    setManageTarget(req);
    await fetchTechnicians();
  };

  const closeManageModal = () => {
    setManageTarget(null);
    refreshService('it');
  };

  // "Take" passes the signed-in IT admin's own id instead of the selected technician.
  const handleAssign = async (assigneeId = selectedTechnician) => {
    if (!selectedRequest || !assigneeId) return;
    setSubmitting(true);
    try {
      await api.post('/requests/accept_request', {
        request_id: selectedRequest._id,
        technician_id: assigneeId,
        priority: assignPriority,
        due_date: assignDue
      });
      setShowAssignModal(false);
      setSelectedRequest(null);
      refreshService('it');
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to assign request');
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const getActionButtons = (req: Request) => {
    if (req.status === 'CANCELLED') {
      return <span className="hstatus cancelled"><span className="hstatus-dot cancelled" />Cancelled</span>;
    }
    if (req.status === 'DONE') {
      return <span className="hstatus done"><span className="hstatus-dot done" />Done</span>;
    }
    if (req.status === 'DECLINED') {
      return <button className="hbtn hbtn-view" onClick={() => setViewTarget(req)}>View reason</button>;
    }
    if (!req.assigned_to) {
      return (
        <div className="history-actions">
          <button className="hbtn hbtn-assign" onClick={() => openAssignModal(req)}>Assign</button>
          <button className="hbtn hbtn-cancel" onClick={() => setDeclineTarget(req)}>Decline</button>
        </div>
      );
    }
    if (req.status === 'IN_PROGRESS') {
      return (
        <div className="history-actions">
          {req.assigned_to === user?.user_id && (
            <button className="hbtn hbtn-assign" onClick={() => setFinishTarget(req)}>Mark Done</button>
          )}
          <button className="hbtn hbtn-view" onClick={() => openManageModal(req)}>Manage</button>
        </div>
      );
    }
    return null;
  };

  // One table row, shared by the earlier-open group and the period's own requests.
  const renderRow = (req: Request) => (
    <tr key={req.request_code}>
      <td className="td-code" data-label="Code">
        {req.request_code}
        <RequestFlags priority={req.priority} overdue={req.overdue} due={req.due_date} />
      </td>
      <td className="td-cell td-wrap" data-label="Requested By">
        <span className="td-stack">
          {req.client_name}
          <span className="td-sub">{req.office}</span>
        </span>
      </td>
      <td className="td-cell" data-label="Assigned To">{req.assigned_name || '-'}</td>
      <td className="td-wrap" data-label="Issue">
        {req.issue}
        {req.notes && req.notes.length > 0 && (
          <span className="note-count" title="Notes from the client">{req.notes.length} {req.notes.length === 1 ? 'note' : 'notes'}</span>
        )}
      </td>
      <td data-label="Status">
        <span className={`hstatus ${req.statusClass}`}>
          <span className={`hstatus-dot ${req.statusClass}`} />
          {req.status}
        </span>
      </td>
      <td className="td-cell" data-label="Created">
        <span className="td-stack">
          {req.created_at}
          {req.completed_at !== '-' && <span className="td-sub">Completed {req.completed_at}</span>}
        </span>
      </td>
      <td className="col-actions">{getActionButtons(req)}</td>
    </tr>
  );

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>IT Assign Dashboard</h2>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="filters-row">
        <SearchBox placeholder="Search by code, issue, office..." value={searchTerm} onSearch={setSearchTerm} />

        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="all">All</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>

        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />

        <label>
          <input type="checkbox" checked={showDone === '1'} onChange={(e) => setShowDone(e.target.checked ? '1' : '0')} />
          <span>Show Done</span>
        </label>
      </div>

      <div className="stat-row">
        <div className="stat-card-sm">
          <h4>Pending</h4>
          <p className="stat-num">{counts.pending_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>In Progress</h4>
          <p className="stat-num">{counts.progress_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Done</h4>
          <p className="stat-num">{counts.done_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Declined</h4>
          <p className="stat-num">{counts.declined_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Urgent (open)</h4>
          <p className="stat-num">{counts.urgent_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Overdue</h4>
          <p className="stat-num">{counts.overdue_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Repaired</h4>
          <p className="stat-num">{counts.repaired_count}</p>
        </div>
        <div className="stat-card-sm">
          <h4>Beyond Repair</h4>
          <p className="stat-num">{counts.beyond_repair_count}</p>
        </div>
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                <th>Code</th>
                <th>Requested By</th>
                <th>Assigned To</th>
                <th>Issue</th>
                <th>Status</th>
                <th>Created</th>
                <th className="col-actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {earlier.length > 0 && (
                <tr className="group-row"><td colSpan={7}>{EARLIER_LABEL[filterType]} ({earlier.length})</td></tr>
              )}
              {earlier.map(renderRow)}
              {earlier.length > 0 && (
                <tr className="group-row"><td colSpan={7}>{PERIOD_LABEL[filterType]}{requests.length === 0 ? ': nothing yet' : ''}</td></tr>
              )}
              {requests.map(renderRow)}
            </tbody>
          </table>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {showAssignModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>Assign Request</h3>
            <p><strong>Request:</strong> {selectedRequest?.request_code}</p>
            <p><strong>Issue:</strong> {selectedRequest?.issue}</p>
            <NotesList notes={selectedRequest?.notes} />

            <div className="form-group">
              <label>Technician *</label>
              <select value={selectedTechnician} onChange={(e) => setSelectedTechnician(e.target.value)} required>
                <option value="">Select technician...</option>
                {technicians.map((tech) => (
                  <option key={tech._id} value={tech._id}>
                    {tech.first_name} {tech.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="assign-priority">Priority</label>
                <select id="assign-priority" value={assignPriority} onChange={(e) => changeAssignPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="assign-due">Due date</label>
                <input id="assign-due" type="date" value={assignDue} onChange={(e) => setAssignDue(e.target.value)} />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={() => handleAssign()} disabled={submitting || !selectedTechnician}>
                {submitting ? 'Assigning...' : 'Assign'}
              </button>
              <button className="btn-primary" onClick={() => user && handleAssign(user.user_id)} disabled={submitting}>
                Take
              </button>
              <button data-modal-dismiss className="btn-secondary" onClick={() => setShowAssignModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {manageTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Manage Request</h3>
            <p><strong>Request:</strong> {manageTarget.request_code}</p>
            <p><strong>Issue:</strong> {manageTarget.issue}</p>
            <p><strong>Assigned To:</strong> {manageTarget.assigned_name || '-'}</p>
            <p>
              <strong>Priority:</strong> {priorityLabel(manageTarget.priority)}
              {manageTarget.due_date && <>, due {formatDay(manageTarget.due_date)}</>}
              <RequestFlags overdue={manageTarget.overdue} />
            </p>
            <NotesList notes={manageTarget.notes} />
            <ReassignForm
              endpoint="/requests/reassign"
              requestId={manageTarget._id}
              currentId={manageTarget.assigned_to}
              staff={technicians}
              onDone={closeManageModal}
            />
            <PriorityForm
              endpoint="/requests/set_priority"
              requestId={manageTarget._id}
              priority={manageTarget.priority}
              dueDate={manageTarget.due_date}
              withDueDate
              onDone={closeManageModal}
            />
            <div className="modal-actions">
              <button data-modal-dismiss className="btn-secondary" onClick={() => setManageTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {declineTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Decline Request</h3>
            <p><strong>Request:</strong> {declineTarget.request_code}</p>
            <p><strong>Requested By:</strong> {declineTarget.client_name}</p>
            <p><strong>Issue:</strong> {declineTarget.issue}</p>
            <NotesList notes={declineTarget.notes} />
            <DeclineForm
              endpoint="/requests/decline_request"
              requestId={declineTarget._id}
              onBack={() => setDeclineTarget(null)}
              onDeclined={() => { setDeclineTarget(null); refreshService('it'); }}
            />
          </div>
        </div>
      )}

      {finishTarget && (
        <FinishRequestModal
          request={finishTarget}
          onClose={() => setFinishTarget(null)}
          onFinished={() => { setFinishTarget(null); refreshService('it'); }}
          onError={setError}
        />
      )}

      {viewTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Declined Request</h3>
            <p><strong>Request:</strong> {viewTarget.request_code}</p>
            <p><strong>Requested By:</strong> {viewTarget.client_name}</p>
            <p><strong>Issue:</strong> {viewTarget.issue}</p>
            <DeclineReason reason={viewTarget.decline_reason} />
            <NotesList notes={viewTarget.notes} />
            <div className="modal-actions">
              <button data-modal-dismiss className="btn-secondary" onClick={() => setViewTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ItAdminDashboard;