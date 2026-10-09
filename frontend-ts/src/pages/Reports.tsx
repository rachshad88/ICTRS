import { useState, useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';
import { api } from '../services/api';
import { fmt } from '../services/reportFormat';
import type { DarRow, DarSignatories } from '../services/darDocx';
import { queryClient } from '../services/queryClient';
import Skeleton from '../components/Skeleton';
import Pagination from '../components/Pagination';
import { useAuth } from '../contexts/AuthContext';
import SearchBox from '../components/SearchBox';

interface Column {
  key: string;
  label: string;
  render?: (val: unknown) => string;
}

type TabKey = 'it' | 'multimedia' | 'digital-media' | 'print-materials';
type ReportPrintFilter = 'range' | 'all' | 'daily' | 'weekly' | 'monthly' | 'calendar';
type ReportStatusScope = 'all' | 'done' | 'not-done';

interface TabConfig {
  key: TabKey;
  label: string;
}

interface PrintableColumn {
  key: string;
  label: string;
  render?: (val: unknown) => string;
}

interface PrintableRow {
  type: string;
  request_code: string;
  office?: string;
  client_name?: string;
  technician_name?: string;
  status?: string;
  created_at?: string;
  summary?: string;
  event_date?: string;
  event_start_time?: string;
  event_end_time?: string;
  specific_location?: string;
  form_of_digital_media?: string;
  event_ppa_name?: string;
  target_date?: string;
  requestor_name?: string;
  form_of_printed_media?: string;
  size_of_printed_media?: string;
  unit?: string;
  issue?: string;
  finished?: string;
  completed_at?: string;
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
  MULTIMEDIA: ALL_TABS.slice(1, 4),
  MULTIMEDIA_ADMIN: ALL_TABS.slice(1, 4),
};

const REPORT_TYPE_LABELS: Record<TabKey, string> = {
  it: 'IT Requests',
  multimedia: 'Multimedia',
  'digital-media': 'Digital Media',
  'print-materials': 'Print Materials',
};

const PRINT_TYPE_COLUMNS: Record<TabKey, PrintableColumn[]> = {
  it: [
    { key: 'request_code', label: 'Code' },
    { key: 'office', label: 'Office' },
    { key: 'unit', label: 'Unit' },
    { key: 'issue', label: 'Issue', render: truncateCell },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Finished', render: fmtDateTime },
  ],
  multimedia: [
    { key: 'request_code', label: 'Code' },
    { key: 'event_date', label: 'Event Date', render: fmt },
    { key: 'event_start_time', label: 'Start Time' },
    { key: 'event_end_time', label: 'End Time' },
    { key: 'specific_location', label: 'Specific Location' },
    { key: 'client_name', label: 'Client' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'digital-media': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_digital_media', label: 'Form of Media' },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'print-materials': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_printed_media', label: 'Form of Media' },
    { key: 'size_of_printed_media', label: 'Size' },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'status', label: 'Status' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
};

function truncateCell(v: unknown): string {
  const s = fmt(v);
  return s.length > 33 ? s.slice(0, 30) + '...' : s;
}

function fmtDateTime(v: unknown): string {
  if (!v) return '-';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPrintableCell(row: PrintableRow, col: PrintableColumn): string {
  const raw = row[col.key as keyof PrintableRow];
  if (col.render) return col.render(raw);
  if (raw === undefined || raw === null || raw === '') return '-';
  return String(raw);
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
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'recommendation', label: 'Recommendation' },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'multimedia': [
    { key: 'request_code', label: 'Code' },
    { key: 'event_title', label: 'Event Title', render: truncateCell },
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
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'digital-media': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_digital_media', label: 'Form of Media', render: truncateCell },
    { key: 'digital_media_description', label: 'Description', render: truncateCell },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'target_time', label: 'Target Time' },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'requestor_contact', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
  'print-materials': [
    { key: 'request_code', label: 'Code' },
    { key: 'form_of_printed_media', label: 'Form of Media', render: truncateCell },
    { key: 'size_of_printed_media', label: 'Size' },
    { key: 'printed_media_description', label: 'Description', render: truncateCell },
    { key: 'event_ppa_name', label: 'Event/PPA' },
    { key: 'target_date', label: 'Target Date', render: fmt },
    { key: 'target_time', label: 'Target Time' },
    { key: 'requestor_name', label: 'Requestor' },
    { key: 'requestor_contact', label: 'Contact' },
    { key: 'client_name', label: 'Client' },
    { key: 'technician_name', label: 'Technician' },
    { key: 'status', label: 'Status' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'decline_reason', label: 'Decline Reason', render: truncateCell },
    { key: 'completed_at', label: 'Completed', render: fmtDateTime },
  ],
};

function Reports() {
  const { user } = useAuth();
  const userRoles = user?.roles || [user?.role || 'ADMIN'];
  const tabs = (() => {
    const seen = new Set<string>();
    return ALL_TABS.filter(t => {
      if (seen.has(t.key)) return false;
      const hasAccess = userRoles.some(r => {
        const roleTabs = ROLE_TABS[r];
        return roleTabs && roleTabs.some(rt => rt.key === t.key);
      });
      if (hasAccess) {
        seen.add(t.key);
        return true;
      }
      return false;
    });
  })();
  const [activeTab, setActiveTab] = useState<TabKey>(tabs[0]?.key || 'it');
  const [filterType, setFilterType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [showDone, setShowDone] = useState('1');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printFilterType, setPrintFilterType] = useState<ReportPrintFilter>('range');
  const [printDate, setPrintDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [printFrom, setPrintFrom] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
  });
  const [printTo, setPrintTo] = useState(new Date().toLocaleDateString('en-CA'));
  const printRangeInvalid = printFilterType === 'range' && (!printFrom || !printTo || printFrom > printTo);
  const [printStatusScope, setPrintStatusScope] = useState<ReportStatusScope>('all');
  const [printLoading, setPrintLoading] = useState(false);

  const columns = COLUMNS[activeTab];

  useEffect(() => { setCurrentPage(1); }, [filterType, selectedDate, showDone, searchTerm, activeTab]);

  const ITEMS_PER_PAGE = 10;

  // Cached per tab, filter and page. Request changes in any service refresh it, batched per
  // burst (['overview'] in services/queryClient.ts).
  const params = { type: activeTab, filter: filterType, date: selectedDate, show_done: showDone, page: currentPage, limit: ITEMS_PER_PAGE, ...(searchTerm && { search: searchTerm }) };
  const { data, isPending: loading } = useQuery({
    queryKey: ['overview', 'reports', params],
    queryFn: () => api.get<{ reports: Record<string, unknown>[]; total?: number }>('/reports/get_reports', { params }).then((r) => r.data),
    // Keep the current rows on screen while another page or filter loads.
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  const reports = data?.reports ?? [];
  const total = data?.total || 0;

  const exportToExcel = () => {
    const params = new URLSearchParams({ type: activeTab, filter: filterType, date: selectedDate, show_done: showDone });
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    window.location.href = `/api/reports/export_excel?${params}`;
  };

  // Start fetching the DAR builder (and the docx library) while the options are being chosen.
  const openPrintModal = () => {
    import('../services/darDocx').catch(() => {});
    setShowPrintModal(true);
  };

  const downloadCombinedReport = async () => {
    try {
      setPrintLoading(true);
      const isRange = printFilterType === 'range';
      const activeFilter =
        printFilterType === 'calendar' ? 'daily' : isRange ? 'all' : printFilterType;
      const effectiveDate =
        printFilterType === 'all' ? new Date().toLocaleDateString('en-CA') : isRange ? printFrom : printDate;
      const paramsBase = {
        filter: activeFilter,
        date: effectiveDate,
        show_done: '1',
      };

      // The server returns at most 100 rows per page, so read every page; otherwise a report
      // covering more than 100 requests of one type would silently leave the rest out.
      const PAGE_LIMIT = 100;
      const fetchAllReports = async (typeKey: TabKey) => {
        const all: Record<string, unknown>[] = [];
        for (let page = 1; ; page++) {
          const response = await api.get('/reports/get_reports', {
            params: { ...paramsBase, type: typeKey, page, limit: PAGE_LIMIT },
          });
          all.push(...((response.data.reports || []) as Record<string, unknown>[]));
          if (page >= (response.data.totalPages || 0)) return all;
        }
      };

      const printableTypes = tabs.map(tab => tab.key) as TabKey[];
      const responses = await Promise.all(printableTypes.map(fetchAllReports));

      const groupedByType: Record<string, DarRow[]> = {};

      printableTypes.forEach((typeKey) => {
        groupedByType[typeKey] = [];
      });

      printableTypes.forEach((typeKey, idx) => {
        const rows = responses[idx] || [];

        rows.forEach((row) => {
          const status = String(row.status || '');
          // A declined request was never worked on, so it is neither an accomplishment nor outstanding work.
          if (status === 'DECLINED') return;
          const matchesStatus =
            printStatusScope === 'all'
              ? true
              : printStatusScope === 'done'
                ? status === 'DONE'
                : status !== 'DONE';

          if (!matchesStatus) return;

          const dateValue = (() => {
            if (typeKey === 'multimedia') return String(row.event_date || row.created_at || row.completed_at || '-');
            if (typeKey === 'digital-media') return String(row.target_date || row.event_date || row.created_at || row.completed_at || '-');
            if (typeKey === 'print-materials') return String(row.target_date || row.event_date || row.created_at || row.completed_at || '-');
            return String(row.created_at || row.completed_at || '-');
          })();

          if (isRange) {
            const parsed = new Date(dateValue);
            if (Number.isNaN(parsed.getTime())) return;
            const day = parsed.toLocaleDateString('en-CA');
            if (day < printFrom || day > printTo) return;
          }

          const detailValue = (() => {
            if (typeKey === 'it') return String(row.issue || '-');
            if (typeKey === 'multimedia') return String(row.event_title || '-');
            if (typeKey === 'digital-media') return String(row.digital_media_description || row.description || '-');
            if (typeKey === 'print-materials') return String(row.form_of_printed_media || row.printed_media_description || '-');
            return '-';
          })();

          groupedByType[typeKey].push({ date: dateValue, type: REPORT_TYPE_LABELS[typeKey], detail: detailValue });
        });
      });

      const rows: DarRow[] = printableTypes.flatMap((typeKey) => groupedByType[typeKey]);
      rows.sort((a, b) => {
        const aTime = a.date === '-' ? Infinity : new Date(a.date).getTime();
        const bTime = b.date === '-' ? Infinity : new Date(b.date).getTime();
        return (Number.isNaN(aTime) ? Infinity : aTime) - (Number.isNaN(bTime) ? Infinity : bTime);
      });

      // Shared with the Signatories page, so names saved there are used without another request.
      const signatories = await queryClient
        .fetchQuery({ queryKey: ['meta', 'signatories'], queryFn: () => api.get<DarSignatories>('/signatories').then((res) => res.data) })
        .catch(() => ({ supervisor_name: '', supervisor_position: '', mayor_name: '' }));

      const middleInitial = user?.middle_name?.trim() ? ` ${user.middle_name.trim().charAt(0)}.` : '';
      const preparedBy = user ? `${user.first_name.trim()}${middleInitial} ${user.last_name.trim()}`.trim() : '';

      // Loaded on demand: the docx library only downloads when a DAR is actually made.
      const { buildDesignedDocx } = await import('../services/darDocx');
      const docxBlob = await buildDesignedDocx(rows, {
        signatories,
        preparedBy,
        preparedByPosition: user?.position?.trim() || '',
        filter: printFilterType,
        status: printStatusScope,
        date: effectiveDate,
        ...(isRange ? { from: printFrom, to: printTo } : {}),
      });

      const objectUrl = URL.createObjectURL(docxBlob);
      const downloadLink = document.createElement('a');
      downloadLink.href = objectUrl;
      const normalizedDate = isRange ? `${printFrom}_to_${printTo}` : effectiveDate.replace(/\//g, '-');
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      downloadLink.download = `DAR-${normalizedDate}-${stamp}.docx`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(objectUrl);

      setPrintLoading(false);
    } catch (error) {
      console.error('Failed to generate combined DOCX report:', error);
      setPrintLoading(false);
    }
  };

  const renderStatus = (status: unknown) => {
    const s = String(status || '');
    const cls = s === 'DONE' ? 'done' : s === 'CANCELLED' ? 'cancelled' : s === 'DECLINED' ? 'declined' : 'pending';
    return (
      <span className={`hstatus ${cls}`}>
        <span className={`hstatus-dot ${cls}`} />
        {s || '-'}
      </span>
    );
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2>Reports</h2>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={openPrintModal} className="btn-export btn-export-alt">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v8H6z" />
            </svg>
            Download DOCX
          </button>
          <button onClick={exportToExcel} className="btn-export">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </div>

      <div className="reports-toolbar">
        <div className="reports-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`reports-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {activeTab === tab.key && (
                <motion.span
                  layoutId="reports-tab-indicator"
                  className="reports-tab-indicator"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
            </button>
          ))}
        </div>

        <div className="filters-row">
          <SearchBox placeholder="Search by code, description, name..." value={searchTerm} onSearch={setSearchTerm} />

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
      </div>

      {loading ? (
        <Skeleton variant="table" rows={5} />
      ) : reports.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#128202;</div>
          <h3>No reports found</h3>
          <p>Try adjusting your search or date filters.</p>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table stack-mobile">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((report, idx) => (
                <motion.tr
                  key={report.request_code as string || idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, delay: Math.min(idx, 8) * 0.03, ease: EASE_OUT }}
                >
                  {columns.map(col => (
                    <td key={col.key} className={col.key === 'request_code' ? 'td-code' : 'td-cell'} data-label={col.label}>
                      {col.key === 'status' ? renderStatus(report[col.key]) : col.render ? col.render(report[col.key]) : fmt(report[col.key])}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPrintModal && (
        <div className="modal">
          <div className="modal-content" style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3>Print combined PDF report</h3>
              <button type="button" className="modal-close" onClick={() => setShowPrintModal(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Filter range</label>
                <select value={printFilterType} onChange={(e) => setPrintFilterType(e.target.value as ReportPrintFilter)}>
                  <option value="range">Date range (From – To)</option>
                  <option value="all">All</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="calendar">Calendar</option>
                </select>
              </div>

              {printFilterType === 'range' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ flex: '1 1 180px' }}>
                    <label>From</label>
                    <input type="date" value={printFrom} max={printTo || undefined} onChange={(e) => setPrintFrom(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: '1 1 180px' }}>
                    <label>To</label>
                    <input type="date" value={printTo} min={printFrom || undefined} onChange={(e) => setPrintTo(e.target.value)} />
                  </div>
                  {printRangeInvalid && (
                    <p style={{ color: '#dc2626', fontSize: 13, margin: 0, width: '100%' }}>
                      Pick a From date that is on or before the To date.
                    </p>
                  )}
                </div>
              )}

              {printFilterType !== 'all' && printFilterType !== 'range' && (
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={printDate} onChange={(e) => setPrintDate(e.target.value)} />
                </div>
              )}

              <div className="form-group">
                <label>Status</label>
                <select value={printStatusScope} onChange={(e) => setPrintStatusScope(e.target.value as ReportStatusScope)}>
                  <option value="all">Done and not done</option>
                  <option value="done">Done</option>
                  <option value="not-done">Not done</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button data-modal-dismiss type="button" className="btn-secondary" onClick={() => setShowPrintModal(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={async () => {
                setShowPrintModal(false);
                await downloadCombinedReport();
              }} disabled={printLoading || printRangeInvalid}>
                {printLoading ? 'Preparing...' : 'Download .docx'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
    </div>
  );
}

export default Reports;
