import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import FileViewer from '../components/FileViewer';
import Skeleton from '../components/Skeleton';

interface MultimediaRequest {
  _id: string;
  request_code: string;
  event_title: string;
  status: string;
  contact_number: string;
  event_date: string;
  event_start_time: string;
  event_end_time: string;
  location_type: string;
  specific_location: string;
  program_file?: string;
  requester?: Array<{ first_name: string; last_name: string }>;
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
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'unassigned' | 'all'>('unassigned');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { setCurrentPage(1); }, [activeTab, searchTerm]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);

  const fetchData = async (search?: string) => {
    try {
      const unassignedParams: Record<string, string> = {};
      const allParams: Record<string, string> = {};
      if (search) { unassignedParams.search = search; allParams.search = search; }
      const [unassignedRes, allRes, techniciansRes] = await Promise.all([
        api.get('/multimedia/get_unassigned', { params: unassignedParams }),
        api.get('/multimedia/get_all', { params: allParams }),
        api.get('/multimedia/get_technicians')
      ]);
      setRequests(unassignedRes.data.requests);
      setAllRequests(allRes.data.requests);
      setTechnicians(techniciansRes.data.technicians);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchData(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
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
    return () => {
      socket.off('multimedia_request_created', handler);
      socket.off('multimedia_request_assigned', handler);
      socket.off('multimedia_request_assigned_admin', handler);
      socket.off('multimedia_request_completed', handler);
      socket.off('multimedia_request_cancelled', handler);
    };
  }, [user]);

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
    } catch (error) {
      setMessage('Failed to assign request');
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const displayRequests = activeTab === 'unassigned' ? requests : allRequests;
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(displayRequests.length / ITEMS_PER_PAGE);
  const paginatedRequests = displayRequests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>Multimedia Management</h2>
      </div>

      <div className="mgmt-tabs">
        <button className={`mgmt-tab ${activeTab === 'unassigned' ? 'active' : ''}`} onClick={() => setActiveTab('unassigned')}>
          Unassigned ({requests.length})
        </button>
        <button className={`mgmt-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          All ({allRequests.length})
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
          <table className="history-table">
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
              {paginatedRequests.map((request) => (
                <tr key={request._id}>
                  <td>
                    <span className={`hstatus ${request.status.toLowerCase().replace(/_/g, '-')}`}>
                      <span className={`hstatus-dot ${request.status.toLowerCase().replace(/_/g, '-')}`} />
                      {request.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{request.request_code}</td>
                  <td>{request.event_title}</td>
                  <td>{formatDate(request.event_date)}</td>
                  <td style={{ fontSize: '12px' }}>{request.event_start_time} - {request.event_end_time}</td>
                  <td style={{ fontSize: '12px' }}>{request.location_type}</td>
                  <td style={{ fontSize: '12px' }}>
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
                          View
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

      {totalPages > 1 && (
        <div className="history-pagination">
          <button className="hbtn-page" disabled={currentPage === 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
            <button key={page} className={`hbtn-page ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)}>{page}</button>
          ))}
          <button className="hbtn-page" disabled={currentPage === totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
        </div>
      )}

      {selectedRequest && (
        <div className="modal">
          <div className="modal-content">
            <h3>Assign Multimedia Request</h3>
            <p><strong>Event:</strong> {selectedRequest.event_title}</p>
            <p><strong>Request Code:</strong> {selectedRequest.request_code}</p>
            <p><strong>Requested By:</strong> {selectedRequest.requester?.[0] ? `${selectedRequest.requester[0].first_name} ${selectedRequest.requester[0].last_name}` : 'Unknown'}</p>
            <p><strong>Date:</strong> {formatDate(selectedRequest.event_date)}</p>
            <p><strong>Time:</strong> {selectedRequest.event_start_time} - {selectedRequest.event_end_time}</p>
            <p><strong>Contact:</strong> {selectedRequest.contact_number}</p>

            {selectedRequest.program_file && (
              <div className="file-section">
                <p><strong>Program File:</strong></p>
                <FileViewer files={[selectedRequest.program_file]} requestId={selectedRequest._id} type="multimedia" />
              </div>
            )}

            {selectedRequest.status === 'UNASSIGNED' && (
              <div className="form-group">
                <label>Select Multimedia Technician</label>
                <select value={selectedTechnician} onChange={(e) => setSelectedTechnician(e.target.value)}>
                  <option value="">Choose a technician...</option>
                  {technicians.map((tech) => (
                    <option key={tech._id} value={tech._id}>{tech.first_name} {tech.last_name} (@{tech.username})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="modal-actions">
              {selectedRequest.status === 'UNASSIGNED' && (
                <button onClick={handleAssign} className="btn-primary" disabled={!selectedTechnician}>
                  Assign Request
                </button>
              )}
              <button onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MultimediaManagement;
