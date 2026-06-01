import { useState, useEffect } from 'react';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';

interface Report {
  request_code: string;
  office: string;
  issue: string;
  client_name: string;
  technician_name: string;
  finished: string;
  remarks: string;
  recommendation: string;
  completed_at: string;
}

function Reports() {
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showDone, setShowDone] = useState('1');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm]);

  const fetchReports = async (search?: string) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { filter: filterType, date: selectedDate, show_done: showDone };
      if (search) params.search = search;
      const response = await api.get('/reports/get_reports', { params });
      setReports(response.data.reports);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchReports(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, filterType, selectedDate, showDone]);

  const exportToExcel = () => {
    window.location.href = `/api/reports/export_excel?filter=${filterType}&date=${selectedDate}&show_done=${showDone}`;
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Reports</h2>
        <button onClick={exportToExcel} className="btn-export" style={{ fontSize: '12px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
      </div>

      <div className="filters-row">
        <input type="text" placeholder="Search by code, issue, office..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />

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

      {(() => { const ITEMS_PER_PAGE = 10; const totalPages = Math.ceil(reports.length / ITEMS_PER_PAGE); const paginatedReports = reports.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE); return (<>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : reports.length === 0 ? (
        <div className="history-empty">No reports found</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Office</th>
                <th>Issue</th>
                <th>Client</th>
                <th>Technician</th>
                <th>Status</th>
                <th>Remarks</th>
                <th>Recommendation</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {paginatedReports.map((report) => (
                <tr key={report.request_code}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{report.request_code}</td>
                  <td style={{ fontSize: '12px' }}>{report.office}</td>
                  <td>{report.issue}</td>
                  <td style={{ fontSize: '12px' }}>{report.client_name}</td>
                  <td style={{ fontSize: '12px' }}>{report.technician_name}</td>
                  <td>
                    <span className={`hstatus ${report.finished === 'repaired' ? 'done' : 'cancelled'}`}>
                      <span className={`hstatus-dot ${report.finished === 'repaired' ? 'done' : 'cancelled'}`} />
                      {report.finished}
                    </span>
                  </td>
                  <td style={{ fontSize: '12px' }}>{report.remarks}</td>
                  <td style={{ fontSize: '12px' }}>{report.recommendation}</td>
                  <td style={{ fontSize: '12px' }}>{report.completed_at}</td>
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

      </>)})()}
    </div>
  );
}

export default Reports;
