import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import Skeleton from './Skeleton';
import RequestTicket from './RequestTicket';

// The Turnaround view of the Reports page (pages/Reports.tsx): how fast requests are handled in the
// chosen period, per service and per staff member. Built by GET /api/reports/turnaround
// (backend-ts/src/routes/reports.ts), which also explains what each number counts.

interface Times {
  median: number | null;
  average: number | null;
  count: number;
}

interface ServiceRow {
  key: string;
  label: string;
  finished: number;
  wait: Times;
  work: Times;
  check: Times | null;
  total: Times;
  late: number;
  with_due: number;
  reopened: number;
  open_now: number;
  waiting_now: number;
  oldest_waiting: string | null;
}

interface StaffRow {
  id: string;
  name: string;
  services: string[];
  finished: number;
  work: Times;
  late: number;
  with_due: number;
  reopened: number;
  open_now: number;
}

interface TurnaroundData {
  services: ServiceRow[];
  staff: StaffRow[];
}

const HOUR = 3600000;

/** A duration as people say it: "under 1 min", "45 min", "3.5 h", "2.1 days". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 60000) return 'under 1 min';
  if (ms < HOUR) return `${Math.round(ms / 60000)} min`;
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (ms < 48 * HOUR) return `${trim(ms / HOUR)} h`;
  return `${trim(ms / (24 * HOUR))} days`;
}

/** The median shown in the cell; the average and how many requests it covers in the tooltip. */
function TimeCell({ t }: { t: Times }) {
  if (t.median === null) return <span title="Nothing to measure in this period">-</span>;
  return <span title={`Average ${formatDuration(t.average)}, from ${t.count} ${t.count === 1 ? 'request' : 'requests'}`}>{formatDuration(t.median)}</span>;
}

const lateText = (late: number, withDue: number) => (withDue ? `${late} (${Math.round((late / withDue) * 100)}%)` : '-');

const sinceText = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function TurnaroundReport({ query }: { query: Record<string, string> }) {
  // ['overview', ...]: any request event refreshes it (services/queryClient.ts).
  const { data, isPending, isError } = useQuery({
    queryKey: ['overview', 'turnaround', query],
    queryFn: () => api.get<TurnaroundData>('/reports/turnaround', { params: query }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });

  if (isPending) return <Skeleton variant="table" rows={4} />;
  if (isError || !data) return <div className="error-message">Could not load the turnaround report. Try again in a moment.</div>;

  const { services, staff } = data;

  return (
    <div className="turnaround">
      <p className="turnaround-note">
        Times are typical (the median): half of the requests took less, half took longer. The Excel export also has the averages.
        They are calendar time, so nights and weekends count. Late means finished after the due, event or target date.
      </p>

      <section aria-labelledby="turnaround-services">
        <h3 id="turnaround-services" className="turnaround-heading">By service</h3>
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
        <div className="rq-ticket-list">
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
            <div className="rq-ticket-list">
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
