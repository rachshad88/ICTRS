import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import FileViewer from '../components/FileViewer';
import Skeleton from '../components/Skeleton';

interface PrintMaterialsRequest {
  _id: string;
  request_code: string;
  form_of_printed_media: string;
  size_of_printed_media: string;
  printed_media_description: string;
  event_ppa_name: string;
  target_date: string;
  target_time: string;
  requestor_name: string;
  requestor_contact: string;
  supporting_files: string[];
  status: string;
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

function PrintMaterialsManagement() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PrintMaterialsRequest[]>([]);
  const [allRequests, setAllRequests] = useState<PrintMaterialsRequest[]>([]);
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<PrintMaterialsRequest | null>(null);
  const [selectedTechnician, setSelectedTechnician] = useState('');
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
      unassignedParams.page = activeTab === 'unassigned' ? currentPage : 1;
      unassignedParams.limit = ITEMS_PER_PAGE;
      allParams.page = activeTab === 'all' ? currentPage : 1;
      allParams.limit = ITEMS_PER_PAGE;
      const [unassignedRes, allRes, techniciansRes] = await Promise.all([
        api.get('/printmaterials/get_unassigned', { params: unassignedParams }),
        api.get('/printmaterials/get_all', { params: allParams }),
        api.get('/printmaterials/get_technicians')
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
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchData(searchTermRef.current);
    socket.on('print_materials_request_created', handler);
    socket.on('print_materials_request_assigned', handler);
    socket.on('print_materials_request_assigned_admin', handler);
    socket.on('print_materials_request_completed', handler);
    socket.on('print_materials_request_cancelled', handler);
    return () => {
      socket.off('print_materials_request_created', handler);
      socket.off('print_materials_request_assigned', handler);
      socket.off('print_materials_request_assigned_admin', handler);
      socket.off('print_materials_request_completed', handler);
      socket.off('print_materials_request_cancelled', handler);
    };
  }, [user, fetchData]);

  const handleAssign = async () => {
    if (!selectedRequest || !selectedTechnician) {
      setMessage('Please select a technician');
      return;
    }
    try {
      await api.post('/printmaterials/assign', {
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
  const totalItems = activeTab === 'unassigned' ? totalUnassigned : totalAll;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>Print Materials Management</h2>
      </div>

      <div className="mgmt-tabs">
        <button className={`mgmt-tab ${activeTab === 'unassigned' ? 'active' : ''}`} onClick={() => setActiveTab('unassigned')}>
          Unassigned ({totalUnassigned})
        </button>
        <button className={`mgmt-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
          All ({totalAll})
        </button>
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
        <input type="text" placeholder="Search by code, description, event, requestor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      </div>

      {message && (
        <div className={`mgmt-message ${message.includes('success') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : displayRequests.length === 0 ? (
        <div className="history-empty">No {activeTab === 'unassigned' ? 'unassigned ' : ''}print materials requests</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Code</th>
                <th>Form</th>
                <th>Size</th>
                <th>Event / PPA</th>
                <th>Target Date</th>
                <th>Requested By</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRequests.map((request) => (
                <tr key={request._id}>
                  <td>
                    <span className={`hstatus ${request.status.toLowerCase().replace(/_/g, '-')}`}>
                      <span className={`hstatus-dot ${request.status.toLowerCase().replace(/_/g, '-')}`} />
                      {request.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{request.request_code}</td>
                  <td>{request.form_of_printed_media}</td>
                  <td style={{ fontSize: '12px' }}>{request.size_of_printed_media}</td>
                  <td style={{ fontSize: '12px' }}>{request.event_ppa_name}</td>
                  <td style={{ fontSize: '12px' }}>{formatDate(request.target_date)}</td>
                  <td style={{ fontSize: '12px' }}>
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
            <h3>Print Materials Request Details</h3>
            <div className="detail-section">
              <p><strong>Request Code:</strong> {selectedRequest.request_code}</p>
              <p><strong>Requested By:</strong> {selectedRequest.requester?.[0] ? `${selectedRequest.requester[0].first_name} ${selectedRequest.requester[0].last_name}` : 'Unknown'}</p>
              <p><strong>Form:</strong> {selectedRequest.form_of_printed_media}</p>
              <p><strong>Size:</strong> {selectedRequest.size_of_printed_media}</p>
              <p><strong>Description:</strong> {selectedRequest.printed_media_description}</p>
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
                  <FileViewer files={selectedRequest.supporting_files} requestId={selectedRequest._id} type="printmaterials" />
                </div>
              )}
            </div>

            {selectedRequest.status === 'PENDING' && !selectedRequest.assignedTechnician?.[0] && (
              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label>Assign Technician</label>
                <select value={selectedTechnician} onChange={(e) => setSelectedTechnician(e.target.value)}>
                  <option value="">Choose a technician...</option>
                  {technicians.map((tech) => (
                    <option key={tech._id} value={tech._id}>{tech.first_name} {tech.last_name} (@{tech.username})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="modal-actions">
              {selectedRequest.status === 'PENDING' && !selectedRequest.assignedTechnician?.[0] && (
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

export default PrintMaterialsManagement;
