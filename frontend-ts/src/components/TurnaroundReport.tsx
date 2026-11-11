import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import Skeleton from './Skeleton';
import RequestTicket from './RequestTicket';
import { ServiceCharts, StaffChart, TurnaroundSummary } from './TurnaroundCharts';
import { formatDuration, lateText, sinceText, type Times, type TurnaroundData } from '../lib/turnaround';

// The Turnaround view of the Reports page (pages/Reports.tsx): how fast requests are handled in the
// chosen period, per service and per staff member. Built by GET /api/reports/turnaround
// (backend-ts/src/routes/reports.ts), which also explains what each number counts. Charts first
// (components/TurnaroundCharts.tsx), then the same figures as tables; on phones the tables'
// tickets fold away behind a button, since the charts already carry their numbers.

/** The median shown in the cell; the average and how many requests it covers in the tooltip. */
function TimeCell({ t }: { t: Times }) {
  if (t.median === null) return <span title="Nothing to measure in this period">-</span>;
  return <span title={`Average ${formatDuration(t.average)}, from ${t.count} ${t.count === 1 ? 'request' : 'requests'}`}>{formatDuration(t.median)}</span>;
}

function TurnaroundReport({ query }: { query: Record<string, string> }) {
  // ['overview', ...]: any request event refreshes it (services/queryClient.ts).
  const [figures, setFigures] = useState({ services: false, staff: false });
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: ['overview', 'turnaround', query],
    queryFn: () => api.get<TurnaroundData>('/reports/turnaround', { params: query }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isPending) return <Skeleton variant="table" rows={4} />;
  if (isError || !data) return <div className="error-message">Could not load the turnaround report. Try again in a moment.</div>;

  const { services, staff } = data;
  const toggle = (part: 'services' | 'staff', count: number) => (
    <button type="button" className="ta-figures-toggle" aria-expanded={figures[part]} onClick={() => setFigures((f) => ({ ...f, [part]: !f[part] }))}>
      {figures[part] ? 'Hide the figures' : `Show the figures for each ${part === 'services' ? 'service' : 'person'} (${count})`}
    </button>
  );

  return (
    // Held at reduced opacity while another period loads, instead of flashing a skeleton.
    <div className={`turnaround${isPlaceholderData ? ' is-stale' : ''}`} aria-busy={isPlaceholderData}>
      <p className="turnaround-note">
        Times are typical (the median): half of the requests took less, half took longer. The Excel export also has the averages.
        They are calendar time, so nights and weekends count. Late means finished after the due, event or target date.
      </p>

      <TurnaroundSummary services={services} />

      <section aria-labelledby="turnaround-services">
        <h3 id="turnaround-services" className="turnaround-heading">By service</h3>
        <ServiceCharts services={services} />
        <div className="history-table-wrap hide-on-mobile">
          <table className="history-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Finished</th>
                <th>Wait for assignment</th>
                <th>Work time</th>
                <th>Total</th>
                <th>Late</th>
                <th>Reopened</th>
                <th>Open now</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.key}>
                  <td className="td-wrap"><strong>{s.label}</strong></td>
                  <td className="td-cell">{s.finished}</td>
                  <td className="td-cell"><TimeCell t={s.wait} /></td>
                  <td className="td-cell">
                    <TimeCell t={s.work} />
                    {s.check && s.check.median !== null && (
                      <span className="td-sub" title="From the technician sending the MOV to an IT admin verifying it">
                        MOV check {formatDuration(s.check.median)}
                      </span>
                    )}
                  </td>
                  <td className="td-cell"><TimeCell t={s.total} /></td>
                  <td className="td-cell">{lateText(s.late, s.with_due)}</td>
                  <td className="td-cell">{s.reopened}</td>
                  <td className="td-cell">
                    {s.open_now}
                    {s.waiting_now > 0 && (
                      <span className="td-sub">{s.waiting_now} waiting since {sinceText(s.oldest_waiting)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {toggle('services', services.length)}
        <div className={`rq-ticket-list ta-figures${figures.services ? ' is-open' : ''}`}>
          {services.map((s, idx) => (
            <RequestTicket
              key={s.key}
              index={idx}
              brand="ITRS turnaround"
              type="Service"
              title={s.label}
              meta={[
                { label: 'Finished', value: s.finished },
                { label: 'Wait for assignment', value: formatDuration(s.wait.median) },
                { label: 'Work time', value: formatDuration(s.work.median) },
                { label: 'Total', value: formatDuration(s.total.median) },
                ...(s.check && s.check.median !== null ? [{ label: 'MOV check', value: formatDuration(s.check.median) }] : []),
              ]}
              rows={[
                { label: 'Late', value: lateText(s.late, s.with_due) },
                { label: 'Reopened', value: s.reopened },
                { label: 'Open now', value: s.waiting_now > 0 ? `${s.open_now}, ${s.waiting_now} waiting` : s.open_now },
              ]}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="turnaround-staff">
        <h3 id="turnaround-staff" className="turnaround-heading">By staff member</h3>
        {staff.length === 0 ? (
          <div className="history-empty">Nobody finished or holds a request in this period.</div>
        ) : (
          <>
            <StaffChart staff={staff} />
            <div className="history-table-wrap hide-on-mobile">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Staff member</th>
                    <th>Finished</th>
                    <th>Work time</th>
                    <th>Late</th>
                    <th>Reopened</th>
                    <th>Assigned and open now</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((p) => (
                    <tr key={p.id}>
                      <td className="td-wrap">
                        <strong>{p.name}</strong>
                        <span className="td-sub">{p.services.join(', ')}</span>
                      </td>
                      <td className="td-cell">{p.finished}</td>
                      <td className="td-cell"><TimeCell t={p.work} /></td>
                      <td className="td-cell">{lateText(p.late, p.with_due)}</td>
                      <td className="td-cell">{p.reopened}</td>
                      <td className="td-cell">{p.open_now}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {toggle('staff', staff.length)}
            <div className={`rq-ticket-list ta-figures${figures.staff ? ' is-open' : ''}`}>
              {staff.map((p, idx) => (
                <RequestTicket
                  key={p.id}
                  index={idx}
                  brand="ITRS turnaround"
                  type="Staff"
                  title={p.name}
                  sub={p.services.join(', ')}
                  meta={[
                    { label: 'Finished', value: p.finished },
                    { label: 'Work time', value: formatDuration(p.work.median) },
                  ]}
                  rows={[
                    { label: 'Late', value: lateText(p.late, p.with_due) },
                    { label: 'Reopened', value: p.reopened },
                    { label: 'Assigned and open now', value: p.open_now },
                  ]}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default TurnaroundReport;
