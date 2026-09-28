import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import FileViewer from '../components/FileViewer';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, RequestNote } from '../components/RequestNotes';
import RequestMobileCard from '../components/RequestMobileCard';

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
  notes?: RequestNote[];
  remarks?: string;
  requester?: Array<{ first_name: string; last_name: string }>;
  created_at: string;
}

function PrintMaterialsDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PrintMaterialsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<PrintMaterialsRequest | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const fetchRequests = useCallback(async (search?: string) => {
    try {
      const params: Record<string, string | number> = {};
      if (search) params.search = search;
      params.page = currentPage;
      params.limit = 10;
      const response = await api.get('/printmaterials/my_requests', { params });
      setRequests(response.data.requests);
      setTotal(response.data.total || 0);
      setError('');
    } catch (error) {
      console.error('Failed to fetch requests:', error);
    } finally { setLoading(false); }
  }, [currentPage]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const searchTermRef = useRef(searchTerm);
  useEffect(() => { searchTermRef.current = searchTerm; }, [searchTerm]);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchRequests(searchTerm);
    }
  }, [user, searchTerm, fetchRequests]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => fetchRequests(searchTermRef.current);
    socket.on('print_materials_request_assigned', handler);
    socket.on('print_materials_request_completed', handler);
    socket.on('print_materials_request_cancelled', handler);
    socket.on('print_materials_request_note_added', handler);
    return () => {
      socket.off('print_materials_request_assigned', handler);
      socket.off('print_materials_request_completed', handler);
      socket.off('print_materials_request_cancelled', handler);
      socket.off('print_materials_request_note_added', handler);
    };
  }, [user]);

  const handleCompleteRequest = async () => {
    if (!selectedRequest) return;
    try {
      await api.post('/printmaterials/complete_request', { request_id: selectedRequest._id, remarks });
      setShowCompleteModal(false); setRemarks(''); setSelectedRequest(null); fetchRequests();
    } catch (error) { setError('Failed to complete request'); }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>Print Materials Requests</h2>
      </div>

      <div className="filters-row">
        <input type="text" placeholder="Search by code, form, event, requestor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : requests.length === 0 ? (
        <div className="history-empty">No assigned print materials requests</div>
      ) : (
        <>
          <div className="history-table-wrap hide-on-mobile">
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
                {requests.map((request) => (
                  <tr key={request._id}>
                    <td>
                      <span className={`hstatus ${request.status.toLowerCase().replace(/_/g, '-')}`}>
                        <span className={`hstatus-dot ${request.status.toLowerCase().replace(/_/g, '-')}`} />
                        {request.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="td-code">{request.request_code}</td>
                    <td>{request.form_of_printed_media}</td>
                    <td className="td-cell">{request.size_of_printed_media}</td>
                    <td className="td-cell">{request.event_ppa_name}</td>
                    <td className="td-cell">{formatDate(request.target_date)}</td>
                    <td className="td-cell">
                      {request.requester?.[0] ? `${request.requester[0].first_name} ${request.requester[0].last_name}` : 'Unknown'}
                    </td>
                    <td className="col-actions">
                      <div className="history-actions">
                        <button className="hbtn hbtn-view" onClick={() => setSelectedRequest(request)}>
                          Files
                        </button>
                        {request.status === 'IN_PROGRESS' && (
                          <button className="hbtn hbtn-done" onClick={() => { setSelectedRequest(request); setShowCompleteModal(true); }}>
                            Done
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mobile-request-list">
            {requests.map((request) => (
              <RequestMobileCard
                key={request._id}
                title={request.form_of_printed_media}
                subtitle={request.event_ppa_name}
                thumbnailLabel={request.request_code}
                typeLabel="Print Materials"
                statusLabel={request.status.replace(/_/g, ' ')}
                statusClass={request.status.toLowerCase().replace(/_/g, '-')}
                metaItems={[
                  { label: 'Size', value: request.size_of_printed_media },
                  { label: 'Target', value: formatDate(request.target_date) },
                  { label: 'Contact', value: request.requestor_contact },
                ]}
                details={(
                  <>
                    <p><strong>Description:</strong> {request.printed_media_description}</p>
                    <p><strong>Requestor:</strong> {request.requestor_name}</p>
                    <p><strong>Requested By:</strong> {request.requester?.[0] ? `${request.requester[0].first_name} ${request.requester[0].last_name}` : 'Unknown'}</p>
                    {request.supporting_files?.length > 0 && (
                      <div className="file-section">
                        <p><strong>Supporting Files:</strong></p>
                        <FileViewer files={request.supporting_files} requestId={request._id} type="printmaterials" />
                      </div>
                    )}
                  </>
                )}
                actions={(
                  <>
                    <button className="btn-primary" onClick={() => setSelectedRequest(request)}>
                      View Files
                    </button>
                    {request.status === 'IN_PROGRESS' && (
                      <button className="btn-secondary" onClick={() => { setSelectedRequest(request); setShowCompleteModal(true); }}>
                        Mark Done
                      </button>
                    )}
                  </>
                )}
              />
            ))}
          </div>
        </>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      {selectedRequest && !showCompleteModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>{selectedRequest.form_of_printed_media}</h3>
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
              {selectedRequest.supporting_files?.length > 0 && (
                <div className="file-section">
                  <p><strong>Supporting Files:</strong></p>
                  <FileViewer files={selectedRequest.supporting_files} requestId={selectedRequest._id} type="printmaterials" />
                </div>
              )}
              <NotesList notes={selectedRequest.notes} />
            </div>
            <button onClick={() => setSelectedRequest(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      )}

      {showCompleteModal && selectedRequest && (
        <div className="modal">
          <div className="modal-content">
            <h3>Complete Print Materials Request</h3>
            <p><strong>Request:</strong> {selectedRequest.form_of_printed_media}</p>
            <NotesList notes={selectedRequest.notes} />
            <div className="form-group">
              <label>Remarks</label>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any additional remarks" rows={3} />
            </div>
            <div className="modal-actions">
              <button onClick={handleCompleteRequest} className="btn-primary">Complete Request</button>
              <button onClick={() => { setShowCompleteModal(false); setRemarks(''); }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PrintMaterialsDashboard;
