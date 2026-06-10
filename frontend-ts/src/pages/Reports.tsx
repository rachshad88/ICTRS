import { useState, useEffect } from 'react';
import { api } from '../services/api';
import Skeleton from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';

interface Column {
  key: string;
  label: string;
  render?: (val: unknown) => string;
}

type TabKey = 'it' | 'multimedia' | 'digital-media' | 'print-materials';

interface TabConfig {
  key: TabKey;
  label: string;
}

const ALL_TABS: TabConfig[] = [
  { key: 'it', label: 'IT Requests' },
  { key: 'multimedia', label: 'Multimedia' },
  { key: 'digital-media', label: 'Digital Media' },
  { key: 'print-materials', label: 'Print Materials' },
];

const ROLE_TABS: Record<string, TabConfig[]> = {
  ADMIN: ALL_TABS,
  TECHNICIAN: [ALL_TABS[0]],
  IT_ADMIN: [ALL_TABS[0]],
  MULTIMEDIA: ALL_TABS.slice(1),
  MULTIMEDIA_ADMIN: ALL_TABS.slice(1),
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime()) && v.includes('T')) return d.toLocaleDateString();
    return v;
  }
  return String(v);
}

function fmtDateTime(v: unknown): string {
  if (!v) return '-';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const COLUMNS: Record<TabKey, Column[]> = {
  'it': [
    { key: 'request_code', label: 'Code' },
    { key: 'office', label: 'Office' },
    { key: 'unit', label: 'Unit' },
    { key: 'issue', label: 'Issue' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'finished', label: 'Finished' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'recommendation', label: 'Recommendation' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'multimedia': [
    { key: 'request_code', label: 'Code' },
    { key: 'event_title', label: 'Event Title' },
    { key: 'event_date', label: 'Event Date', render: fmt },
    { key: 'event_start_time', label: 'Start Time' },
    { key: 'event_end_time', label: 'End Time' },
    { key: 'location_type', label: 'Location Type' },
    { key: 'specific_location', label: 'Specific Location' },
    { key: 'contact_number', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'digital-media': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_digital_media', label: 'Form of Media' },
    { key: 'digital_media_description', label: 'Description' },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'target_time', label: 'Target Time' },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'requestor_contact', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'print-materials': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_printed_media', label: 'Form of Media' },
    { key: 'size_of_printed_media', label: 'Size' },
    { key: 'printed_media_description', label: 'Description' },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'target_time', label: 'Target Time' },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'requestor_contact', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
};

function Reports() {
  const { user } = useAuth();
  const role = user?.role || 'ADMIN';
  const tabs = ROLE_TABS[role] || ALL_TABS;
  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]?.key || 'it');
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [showDone, setShowDone] = useState('1');
  const [reports, setReports] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const columns = COLUMNS[activeTab];

  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm, activeTab]);

  const fetchReports = async (search?: string) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { type: activeTab, filter: filterType, date: selectedDate, show_done: showDone };
      if (search) params.search = search;
      const response = await api.get('/reports/get_reports', { params });
      setReports(response.data.reports);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchReports(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, filterType, selectedDate, showDone, activeTab]);

  const exportToExcel = () => {
    window.location.href = `/api/reports/export_excel?type=${activeTab}&filter=${filterType}&date=${selectedDate}&show_done=${showDone}`;
  };

  const renderStatus = (status: unknown) => {
    const s = String(status || '');
    const cls = s === 'DONE' ? 'done' : s === 'CANCELLED' ? 'cancelled' : 'pending';
    return (
      <span className={`hstatus ${cls}`}>
        <span className={`hstatus-dot ${cls}`} />
        {s || '-'}
      </span>
    );
  };

  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(reports.length / ITEMS_PER_PAGE);
  const paginatedReports = reports.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

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

      <div className="reports-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`reports-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="filters-row">
        <input
          type="text"
          placeholder="Search by code, description, name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />

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

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : reports.length === 0 ? (
        <div className="history-empty">No reports found</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedReports.map((report, idx) => (
                <tr key={report.request_code as string || idx}>
                  {columns.map(col => (
                    <td key={col.key} style={col.key === 'request_code' ? { color: 'var(--text-secondary)', fontSize: '12px' } : { fontSize: '12px' }}>
                      {col.key === 'status' ? renderStatus(report[col.key]) : col.render ? col.render(report[col.key]) : fmt(report[col.key])}
                    </td>
                  ))}
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
    </div>
  );
}

export default Reports;
