import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import FileViewer from '../components/FileViewer';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, DeclineReason, DeclineForm, RequestNote } from '../components/RequestNotes';
import { RequestFlags, PriorityForm, ReassignForm } from '../components/Priority';

interface MultimediaRequest {
  _id: string;
  priority?: string;
  overdue?: boolean;
  assigned_to?: string | null;
  request_code: string;
  event_title: string;
  status: string;
  notes?: RequestNote[];
  decline_reason?: string | null;
  contact_number: string;
  event_date: string;
  event_start_time: string;
  event_end_time: string;
  location_type: string;
  specific_location: string;
  program_file?: string;
  requester?: Array<{ first_name: string; last_name: string }>;
  assignedTechnician?: Array<{ first_name: string; last_name: string }>;
  created_at: string;
}

interface User {
  _id: string;
  username: string;
  first_name: string;
  last_name: string;
}

function MultimediaManagement() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<MultimediaRequest[]>([]);
  const [allRequests, setAllRequests] = useState<MultimediaRequest[]>([]);
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<MultimediaRequest | null>(null);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [declining, setDeclining] = useState(false);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [totalUnassigned, setTotalUnassigned] = useState(0);
  const [totalAll, setTotalAll] = useState(0);

  const ITEMS_PER_PAGE = 10;

  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);

  const fetchData = useCallback(async (search?: string) => {
    try {
      const unassignedParams: Record<string, string | number> = {};
      const allParams: Record<string, string | number> = {};
      if (search) { unassignedParams.search = search; allParams.search = search; }
      const page = activeTab === 'unassigned' ? currentPage : 1;
      unassignedParams.page = activeTab === 'unassigned' ? currentPage : 1;
      unassignedParams.limit = ITEMS_PER_PAGE;
      allParams.page = activeTab === 'all' ? currentPage : 1;
      allParams.limit = ITEMS_PER_PAGE;
      const [unassignedRes, allRes, techniciansRes] = await Promise.all([
        api.get('/multimedia/get_unassigned', { params: unassignedParams }),
        api.get('/multimedia/get_all', { params: allParams }),
        api.get('/multimedia/get_technicians')
      ]);
      setRequests(unassignedRes.data.requests);
      setTotalUnassigned(unassignedRes.data.total || 0);
      setAllRequests(allRes.data.requests);
      setTotalAll(allRes.data.total || 0);
      setTechnicians(techniciansRes.data.technicians);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, currentPage]);

  useEffect(() => {
    const timer = setTimeout(() => fetchData(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, fetchData]);

  useEffect(() => {
    if (user) {
      initSocket();
    }
  }, [user]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchData(searchTermRef.current);
    socket.on('multimedia_request_created', handler);
    socket.on('multimedia_request_assigned', handler);
    socket.on('multimedia_request_assigned_admin', handler);
    socket.on('multimedia_request_completed', handler);
    socket.on('multimedia_request_cancelled', handler);
    socket.on('multimedia_request_declined', handler);
    socket.on('multimedia_request_note_added', handler);
    socket.on('multimedia_request_priority_changed', handler);
    return () => {
      socket.off('multimedia_request_created', handler);
      socket.off('multimedia_request_assigned', handler);
      socket.off('multimedia_request_assigned_admin', handler);
      socket.off('multimedia_request_completed', handler);
      socket.off('multimedia_request_cancelled', handler);
      socket.off('multimedia_request_declined', handler);
      socket.off('multimedia_request_note_added', handler);
      socket.off('multimedia_request_priority_changed', handler);
    };
  }, [user, fetchData]);

  const handleAssign = async () => {
    if (!selectedRequest || !selectedTechnician) {
      setMessage('Please select a technician');
      return;
    }
    try {
      await api.post('/multimedia/assign', {
        request_id: selectedRequest._id,
        technician_id: selectedTechnician
      });
      setMessage('Request assigned successfully');
      setSelectedRequest(null);
      setSelectedTechnician('');
      setTimeout(() => { setMessage(''); fetchData(searchTerm); }, 1500);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setMessage(err.response?.data?.error || 'Failed to assign request');
    }
  };

  // Shared follow-up for reassigning and reprioritizing: close the modal, confirm, refresh.
  const handleAdminChange = (text: string) => {
    setSelectedRequest(null);
    setMessage(text);
    setTimeout(() => { setMessage(''); fetchData(searchTermRef.current); }, 1500);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const displayRequests = activeTab === 'unassigned' ? requests : allRequests;
  const totalItems = activeTab === 'unassigned' ? totalUnassigned : totalAll;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>Multimedia Management</h2>
      </div>

      <div className="mgmt-tabs">
        <button className={`mgmt-tab ${activeTab === 'unassigned' ? 'active' : ''}`} onClick={() => setActiveTab('unassigned')}>
          Unassigned ({totalUnassigned})
        </button>
        <button className={`mgmt-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          All ({totalAll})
        </button>
      </div>

      <div className="filters-row">
        <input type="text" placeholder="Search by code, event, location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      </div>

      {message && (
        <div className={`mgmt-message ${message.includes('success') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : displayRequests.length === 0 ? (
        <div className="history-empty">No {activeTab === 'unassigned' ? 'unassigned ' : ''}multimedia requests</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                <th>Status</th>
                <th>Code</th>
                <th>Event</th>
                <th>Date</th>
                <th>Time</th>
                <th>Location</th>
                <th>Requested By</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRequests.map((request) => (
                <tr key={request._id}>
                  <td data-label="Status">
                    <span className={`hstatus ${request.status.toLowerCase().replace(/_/g, '-')}`}>
                      <span className={`hstatus-dot ${request.status.toLowerCase().replace(/_/g, '-')}`} />
                      {request.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="td-code" data-label="Code">
                    {request.request_code}
                    <RequestFlags priority={request.priority} overdue={request.overdue} />
                  </td>
                  <td data-label="Event">{request.event_title}</td>
                  <td data-label="Date">{formatDate(request.event_date)}</td>
                  <td className="td-cell" data-label="Time">{request.event_start_time} - {request.event_end_time}</td>
                  <td className="td-cell" data-label="Location">{request.location_type}</td>
                  <td className="td-cell" data-label="Requested By">
                    {request.requester?.[0] ? `${request.requester[0].first_name} ${request.requester[0].last_name}` : 'Unknown'}
                  </td>
                  <td className="col-actions">
                    <div className="history-actions">
                      {request.status === 'UNASSIGNED' ? (
                        <button className="hbtn hbtn-assign" onClick={() => { setSelectedRequest(request); setSelectedTechnician(''); }}>
                          Assign
                        </button>
                      ) : (
                        <button className="hbtn hbtn-view" onClick={() => setSelectedRequest(request)}>
                          {request.status === 'IN_PROGRESS' ? 'Manage' : 'View'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {selectedRequest && (
        <div className="modal">
          <div className="modal-content">
            <h3>{selectedRequest.status === 'UNASSIGNED' ? 'Assign Multimedia Request' : 'Multimedia Request'}</h3>
            <p><strong>Event:</strong> {selectedRequest.event_title}</p>
            <p><strong>Request Code:</strong> {selectedRequest.request_code}</p>
            <p><strong>Requested By:</strong> {selectedRequest.requester?.[0] ? `${selectedRequest.requester[0].first_name} ${selectedRequest.requester[0].last_name}` : 'Unknown'}</p>
            <p><strong>Date:</strong> {formatDate(selectedRequest.event_date)}</p>
            <p><strong>Time:</strong> {selectedRequest.event_start_time} - {selectedRequest.event_end_time}</p>
            <p><strong>Contact:</strong> {selectedRequest.contact_number}</p>
            {selectedRequest.assignedTechnician?.[0] && (
              <p><strong>Assigned To:</strong> {selectedRequest.assignedTechnician[0].first_name} {selectedRequest.assignedTechnician[0].last_name}</p>
            )}

            {selectedRequest.program_file && (
              <div className="file-section">
                <p><strong>Program File:</strong></p>
                <FileViewer files={[selectedRequest.program_file]} requestId={selectedRequest._id} type="multimedia" />
              </div>
            )}

            <DeclineReason reason={selectedRequest.decline_reason} />
            <NotesList notes={selectedRequest.notes} />

            {!declining && selectedRequest.status === 'IN_PROGRESS' && (
              <ReassignForm
                endpoint="/multimedia/reassign"
                requestId={selectedRequest._id}
                currentId={selectedRequest.assigned_to}
                staff={technicians}
                staffLabel="staff member"
                onDone={() => handleAdminChange('Request reassigned successfully')}
              />
            )}
            {!declining && ['UNASSIGNED', 'IN_PROGRESS'].includes(selectedRequest.status) && (
              <PriorityForm
                endpoint="/multimedia/set_priority"
                requestId={selectedRequest._id}
                priority={selectedRequest.priority}
                onDone={() => handleAdminChange('Priority updated successfully')}
              />
            )}

            {!declining && selectedRequest.status === 'UNASSIGNED' && (
              <div className="form-group">
                <label>Select Multimedia Staff</label>
                <select value={selectedTechnician} onChange={(e) => setSelectedTechnician(e.target.value)}>
                  <option value="">Choose a Multimedia Staff</option>
                  {technicians.map((tech) => (
                    <option key={tech._id} value={tech._id}>{tech.first_name} {tech.last_name} (@{tech.username})</option>
                  ))}
                </select>
              </div>
            )}

            {declining ? (
              <DeclineForm
                endpoint="/multimedia/decline"
                requestId={selectedRequest._id}
                onBack={() => setDeclining(false)}
                onDeclined={() => {
                  setDeclining(false);
                  setSelectedRequest(null);
                  setMessage('Request declined successfully');
                  setTimeout(() => { setMessage(''); fetchData(searchTermRef.current); }, 1500);
                }}
              />
            ) : (
              <div className="modal-actions">
                {selectedRequest.status === 'UNASSIGNED' && (
                  <>
                    <button onClick={handleAssign} className="btn-primary" disabled={!selectedTechnician}>
                      Assign Request
                    </button>
                    <button onClick={() => setDeclining(true)} className="btn-danger">
                      Decline
                    </button>
                  </>
                )}
                <button onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MultimediaManagement;
