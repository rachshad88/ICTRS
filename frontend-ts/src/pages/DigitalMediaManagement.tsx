import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { refreshService } from '../services/queryClient';
import FileViewer from '../components/FileViewer';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, DeclineReason, DeclineForm, RequestNote } from '../components/RequestNotes';
import { RequestFlags, PriorityForm, ReassignForm } from '../components/Priority';
import SearchBox from '../components/SearchBox';

interface DigitalMediaRequest {
  _id: string;
  priority?: string;
  overdue?: boolean;
  assigned_to?: string | null;
  request_code: string;
  description: string;
  form_of_digital_media: string;
  digital_media_description: string;
  event_ppa_name: string;
  target_date: string;
  target_time: string;
  requestor_name: string;
  requestor_contact: string;
  supporting_files: string[];
  status: string;
  notes?: RequestNote[];
  decline_reason?: string | null;
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

function DigitalMediaManagement() {
  const { user } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<DigitalMediaRequest | null>(null);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const ITEMS_PER_PAGE = 10;

  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm]);

  // Both tabs are cached per search and page (the hidden tab stays on page 1 for its count);
  // any of this service's socket events refreshes them (services/queryClient.ts).
  type Page = { requests: DigitalMediaRequest[]; total?: number };
  const search = searchTerm ? { search: searchTerm } : {};
  const unassignedParams = { page: activeTab === 'unassigned' ? currentPage : 1, limit: ITEMS_PER_PAGE, ...search };
  const allParams = { page: activeTab === 'all' ? currentPage : 1, limit: ITEMS_PER_PAGE, ...search };
  const unassignedQuery = useQuery({
    queryKey: ['digitalMedia', 'unassigned', unassignedParams],
    queryFn: () => api.get<Page>('/digitalmedia/get_unassigned', { params: unassignedParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const allQuery = useQuery({
    queryKey: ['digitalMedia', 'all', allParams],
    queryFn: () => api.get<Page>('/digitalmedia/get_all', { params: allParams }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  // Staff list for the assign form. It changes only when accounts do, so request events leave it be.
  const { data: technicians = [] } = useQuery({
    queryKey: ['users', 'technicians', 'digitalMedia'],
    queryFn: () => api.get<{ technicians: User[] }>('/digitalmedia/get_technicians').then((r) => r.data.technicians),
    staleTime: 5 * 60_000,
    enabled: !!user,
  });
  const requests = unassignedQuery.data?.requests ?? [];
  const allRequests = allQuery.data?.requests ?? [];
  const totalUnassigned = unassignedQuery.data?.total || 0;
  const totalAll = allQuery.data?.total || 0;
  const loading = (activeTab === 'unassigned' ? unassignedQuery : allQuery).isPending;

  const handleAssign = async () => {
    if (assigning) return;
    if (!selectedRequest || !selectedTechnician) {
      setMessage('Please select a technician');
      return;
    }
    setAssigning(true);
    try {
      await api.post('/digitalmedia/assign', {
        request_id: selectedRequest._id,
        technician_id: selectedTechnician
      });
      setMessage('Request assigned successfully');
      setSelectedRequest(null);
      setSelectedTechnician('');
      setTimeout(() => { setMessage(''); refreshService('digitalMedia'); }, 1500);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setMessage(err.response?.data?.error || 'Failed to assign request');
    } finally {
      setAssigning(false);
    }
  };

  // Shared follow-up for reassigning and reprioritizing: close the modal, confirm, refresh.
  const handleAdminChange = (text: string) => {
    setSelectedRequest(null);
    setMessage(text);
    setTimeout(() => { setMessage(''); refreshService('digitalMedia'); }, 1500);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const displayRequests = activeTab === 'unassigned' ? requests : allRequests;
  const totalItems = activeTab === 'unassigned' ? totalUnassigned : totalAll;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>Digital Media Management</h2>
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
        <SearchBox placeholder="Search by code, description, event, requestor..." value={searchTerm} onSearch={setSearchTerm} />
      </div>

      {message && (
        <div className={`mgmt-message ${message.includes('success') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : displayRequests.length === 0 ? (
        <div className="history-empty">No {activeTab === 'unassigned' ? 'unassigned ' : ''}digital media requests</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                <th>Status</th>
                <th>Code</th>
                <th>Form</th>
                <th>Event / PPA</th>
                <th>Target Date</th>
                <th>Requestor</th>
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
                  <td data-label="Form">{request.form_of_digital_media}</td>
                  <td className="td-cell" data-label="Event / PPA">{request.event_ppa_name}</td>
                  <td className="td-cell" data-label="Target Date">{formatDate(request.target_date)}</td>
                  <td className="td-cell" data-label="Requestor">{request.requestor_name}</td>
                  <td className="td-cell" data-label="Requested By">
                    {request.requester?.[0] ? `${request.requester[0].first_name} ${request.requester[0].last_name}` : 'Unknown'}
                  </td>
                  <td className="col-actions">
                    <div className="history-actions">
                      {request.status === 'PENDING' && !request.assignedTechnician?.[0] ? (
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
            <h3>Digital Media Request Details</h3>
            <div className="detail-section">
              <p><strong>Request Code:</strong> {selectedRequest.request_code}</p>
              <p><strong>Requested By:</strong> {selectedRequest.requester?.[0] ? `${selectedRequest.requester[0].first_name} ${selectedRequest.requester[0].last_name}` : 'Unknown'}</p>
              <p><strong>Title:</strong> {selectedRequest.description}</p>
              <p><strong>Form:</strong> {selectedRequest.form_of_digital_media}</p>
              <p><strong>Description:</strong> {selectedRequest.digital_media_description}</p>
              <p><strong>Event/PPA:</strong> {selectedRequest.event_ppa_name}</p>
              <p><strong>Target Date:</strong> {formatDate(selectedRequest.target_date)}</p>
              <p><strong>Requestor:</strong> {selectedRequest.requestor_name}</p>
              <p><strong>Contact:</strong> {selectedRequest.requestor_contact}</p>
              {selectedRequest.assignedTechnician?.[0] && (
                <p><strong>Assigned To:</strong> {selectedRequest.assignedTechnician[0].first_name} {selectedRequest.assignedTechnician[0].last_name}</p>
              )}
              {selectedRequest.supporting_files?.length > 0 && (
                <div className="file-section">
                  <p><strong>Supporting Files:</strong></p>
                  <FileViewer files={selectedRequest.supporting_files} requestId={selectedRequest._id} type="digitalmedia" />
                </div>
              )}
            </div>

            <DeclineReason reason={selectedRequest.decline_reason} />
            <NotesList notes={selectedRequest.notes} />

            {!declining && selectedRequest.status === 'IN_PROGRESS' && (
              <ReassignForm
                endpoint="/digitalmedia/reassign"
                requestId={selectedRequest._id}
                currentId={selectedRequest.assigned_to}
                staff={technicians}
                staffLabel="staff member"
                onDone={() => handleAdminChange('Request reassigned successfully')}
              />
            )}
            {!declining && ['PENDING', 'IN_PROGRESS'].includes(selectedRequest.status) && (
              <PriorityForm
                endpoint="/digitalmedia/set_priority"
                requestId={selectedRequest._id}
                priority={selectedRequest.priority}
                onDone={() => handleAdminChange('Priority updated successfully')}
              />
            )}

            {!declining && selectedRequest.status === 'PENDING' && !selectedRequest.assignedTechnician?.[0] && (
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Assign Multimedia Staff</label>
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
                endpoint="/digitalmedia/decline"
                requestId={selectedRequest._id}
                onBack={() => setDeclining(false)}
                onDeclined={() => {
                  setDeclining(false);
                  setSelectedRequest(null);
                  setMessage('Request declined successfully');
                  setTimeout(() => { setMessage(''); refreshService('digitalMedia'); }, 1500);
                }}
              />
            ) : (
              <div className="modal-actions">
                {selectedRequest.status === 'PENDING' && !selectedRequest.assignedTechnician?.[0] && (
                  <>
                    <button onClick={handleAssign} className="btn-primary" disabled={!selectedTechnician || assigning}>
                      {assigning ? 'Assigning...' : 'Assign Request'}
                    </button>
                    <button onClick={() => setDeclining(true)} className="btn-danger">
                      Decline
                    </button>
                  </>
                )}
                <button data-modal-dismiss onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DigitalMediaManagement;
