import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { initSocket, getSocket } from '../services/socket';
import FileViewer from '../components/FileViewer';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { NotesList, RequestNote } from '../components/RequestNotes';
import RequestMobileCard from '../components/RequestMobileCard';

interface MultimediaRequest {
  _id: string;
  request_code: string;
  event_title: string;
  event_date: string;
  event_start_time: string;
  event_end_time: string;
  specific_location: string;
  location_type: string;
  contact_number: string;
  program_file: string | null;
  status: string;
  notes?: RequestNote[];
  remarks?: string;
  recommendation?: string;
  requester?: Array<{ first_name: string; last_name: string }>;
  created_at: string;
}

function MultimediaRequestsDashboard() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<MultimediaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<MultimediaRequest | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [recommendation, setRecommendation] = useState('');
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
      const response = await api.get('/multimedia/my_requests', { params });
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
    socket.on('multimedia_request_assigned', handler);
    socket.on('multimedia_request_completed', handler);
    socket.on('multimedia_request_cancelled', handler);
    socket.on('multimedia_request_note_added', handler);
    return () => {
      socket.off('multimedia_request_assigned', handler);
      socket.off('multimedia_request_completed', handler);
      socket.off('multimedia_request_cancelled', handler);
      socket.off('multimedia_request_note_added', handler);
    };
  }, [user]);

  const handleCompleteRequest = async () => {
    if (!selectedRequest) return;
    try {
      await api.post('/multimedia/complete_request', {
        request_id: selectedRequest._id,
        remarks,
        recommendation
      });
      setShowCompleteModal(false);
      setRemarks('');
      setRecommendation('');
      setSelectedRequest(null);
      fetchRequests();
    } catch (error) {
      setError('Failed to complete request');
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>Multimedia Requests</h2>
      </div>

      <div className="filters-row">
        <input type="text" placeholder="Search by code, event, location..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : requests.length === 0 ? (
        <div className="history-empty">No assigned multimedia requests</div>
      ) : (
        <>
          <div className="history-table-wrap hide-on-mobile">
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
                {requests.map((request) => (
                  <tr key={request._id}>
                    <td>
                      <span className={`hstatus ${request.status.toLowerCase().replace(/_/g, '-')}`}>
                        <span className={`hstatus-dot ${request.status.toLowerCase().replace(/_/g, '-')}`} />
                        {request.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="td-code">{request.request_code}</td>
                    <td>{request.event_title}</td>
                    <td>{formatDate(request.event_date)}</td>
                    <td className="td-cell">{request.event_start_time} - {request.event_end_time}</td>
                    <td className="td-cell">{request.location_type}</td>
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
                title={request.event_title}
                subtitle={request.location_type}
                thumbnailLabel={request.request_code}
                typeLabel="Multimedia"
                statusLabel={request.status.replace(/_/g, ' ')}
                statusClass={request.status.toLowerCase().replace(/_/g, '-')}
                metaItems={[
                  { label: 'Date', value: formatDate(request.event_date) },
                  { label: 'Time', value: `${request.event_start_time} - ${request.event_end_time}` },
                  { label: 'Contact', value: request.contact_number },
                ]}
                details={(
                  <>
                    <p><strong>Specific Location:</strong> {request.specific_location}</p>
                    <p><strong>Requested By:</strong> {request.requester?.[0] ? `${request.requester[0].first_name} ${request.requester[0].last_name}` : 'Unknown'}</p>
                    {request.program_file && (
                      <div className="file-section">
                        <p><strong>Program File:</strong></p>
                        <FileViewer files={[request.program_file]} requestId={request._id} type="multimedia" />
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
            <h3>{selectedRequest.event_title}</h3>
            <div className="detail-section">
              <p><strong>Request Code:</strong> {selectedRequest.request_code}</p>
              <p><strong>Requester:</strong> {selectedRequest.requester?.[0]?.first_name} {selectedRequest.requester?.[0]?.last_name}</p>
              <p><strong>Event Date:</strong> {formatDate(selectedRequest.event_date)}</p>
              <p><strong>Time:</strong> {selectedRequest.event_start_time} - {selectedRequest.event_end_time}</p>
              <p><strong>Specific Location:</strong> {selectedRequest.specific_location}</p>
              <p><strong>Location Type:</strong> {selectedRequest.location_type}</p>
              <p><strong>Contact Number:</strong> {selectedRequest.contact_number}</p>
              {selectedRequest.program_file && (
                <div className="file-section">
                  <p><strong>Program File:</strong></p>
                  <FileViewer files={[selectedRequest.program_file]} requestId={selectedRequest._id} type="multimedia" />
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
            <h3>Complete Multimedia Request</h3>
            <p><strong>Event:</strong> {selectedRequest.event_title}</p>
            <NotesList notes={selectedRequest.notes} />
            <div className="form-group">
              <label>Remarks</label>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any additional remarks about the event" rows={3} />
            </div>
            <div className="form-group">
              <label>Recommendation</label>
              <textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} placeholder="Recommendations for future events" rows={3} />
            </div>
            <div className="modal-actions">
              <button onClick={handleCompleteRequest} className="btn-primary">Complete Request</button>
              <button onClick={() => { setShowCompleteModal(false); setRemarks(''); setRecommendation(''); }} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MultimediaRequestsDashboard;
