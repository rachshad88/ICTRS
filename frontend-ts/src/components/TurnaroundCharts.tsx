import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';
import { formatDuration, plural, sinceText, type ServiceRow, type StaffRow, type Times } from '../lib/turnaround';

// The charts of the Reports page's Turnaround view (components/TurnaroundReport.tsx); the tables
// below them hold the same figures. Plain HTML bars, so they follow the page's fonts and width.
// Colours (pages.css, "Turnaround charts"): gold is time spent waiting for assignment, cobalt is
// time with staff, red is late. Each bar carries its own value; hovering, tapping or focusing a
// row shows the rest (averages and how many requests a figure covers).

/** How many staff rows show before "Show all". */
const STAFF_ROWS = 10;

// ----- Tooltip ---------------------------------------------------------------------------------

type TipLine = [value: string, label: string];
interface TipState { x: number; y: number; title: string; lines: TipLine[] }

/** One tooltip per chart, shown over the row under the pointer or with keyboard focus. */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  const place = (row: HTMLElement, clientX: number | null, title: string, lines: TipLine[]) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const r = row.getBoundingClientRect();
    const x = clientX === null ? r.left + r.width / 2 : clientX;
    setTip({ x: Math.min(Math.max(x - b.left, 110), b.width - 110), y: r.top - b.top, title, lines });
  };

  const rowProps = (title: string, lines: TipLine[]) => ({
    tabIndex: 0,
    'aria-label': `${title}: ${lines.map(([v, l]) => `${l} ${v}`).join(', ')}`,
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => place(e.currentTarget, e.clientX, title, lines),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => place(e.currentTarget, null, title, lines),
    onBlur: () => setTip(null),
  });

  const layer = tip && (
    <div className="ta-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <span className="ta-tip-title">{tip.title}</span>
      {tip.lines.map(([value, label]) => (
        <span key={label} className="ta-tip-line">
          <strong>{value}</strong> {label}
        </span>
      ))}
    </div>
  );

  return { box, rowProps, layer };
}

// ----- Pieces ----------------------------------------------------------------------------------

/** A bar's fill, grown from the baseline. `share` is its length as a fraction of the longest. */
function Fill({ share, tone, index, end = true }: { share: number; tone: string; index: number; end?: boolean }) {
  if (share <= 0) return null;
  const style = { '--share': share } as CSSProperties;
  return (
    <motion.span
      className={`ta-fill ta-fill--${tone}${end ? ' is-end' : ''}`}
      style={style}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.55, delay: 0.05 + index * 0.05, ease: EASE_OUT }}
    />
  );
}

function Legend({ items }: { items: [tone: string, label: string][] }) {
  return (
    <ul className="ta-legend">
      {items.map(([tone, label]) => (
        <li key={tone}><span className={`ta-key ta-fill--${tone}`} aria-hidden="true" />{label}</li>
      ))}
    </ul>
  );
}

function Card({ title, sub, legend, className = '', children }: { title: string; sub: string; legend?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <figure className={`ta-card ${className}`}>
      <figcaption className="ta-card-head">
        <span className="ta-card-title">{title}</span>
        <span className="ta-card-sub">{sub}</span>
      </figcaption>
      {legend}
      {children}
    </figure>
  );
}

const timeLine = (t: Times, label: string): TipLine | null =>
  t.median === null ? null : [formatDuration(t.median), `${label} · average ${formatDuration(t.average)}, ${plural(t.count, 'request')}`];

// ----- Headline numbers ------------------------------------------------------------------------

/** The period at a glance, in the counter strip the dashboards use. */
export function TurnaroundSummary({ services }: { services: ServiceRow[] }) {
  const sum = (f: (s: ServiceRow) => number) => services.reduce((n, s) => n + f(s), 0);
  const finished = sum((s) => s.finished);
  const withDue = sum((s) => s.with_due);
  const late = sum((s) => s.late);
  const open = sum((s) => s.open_now);
  const waiting = sum((s) => s.waiting_now);
  const oldest = services.map((s) => s.oldest_waiting).filter((d): d is string => !!d).sort()[0] ?? null;

  return (
    <div className="tech-stats ta-summary">
      <div className="tech-stat">
        <span className="ta-summary-note">in this period</span>
        <span className="tech-stat-label">Finished</span>
        <span className="tech-stat-num">{finished}</span>
      </div>
      <div className={`tech-stat${withDue && late / withDue > 0.25 ? ' warn' : ''}`}>
        <span className="ta-summary-note">{withDue ? `${late} late of ${withDue} with a due date` : 'no due dates yet'}</span>
        <span className="tech-stat-label">On time</span>
        <span className="tech-stat-num">{withDue ? `${Math.round(((withDue - late) / withDue) * 100)}%` : '-'}</span>
      </div>
      <div className="tech-stat accent">
        <span className="ta-summary-note">right now</span>
        <span className="tech-stat-label">Open</span>
        <span className="tech-stat-num">{open}</span>
      </div>
      <div className="tech-stat">
        <span className="ta-summary-note">{oldest ? `oldest since ${sinceText(oldest)}` : 'none waiting'}</span>
        <span className="tech-stat-label">Waiting for assignment</span>
        <span className="tech-stat-num">{waiting}</span>
      </div>
    </div>
  );
}

// ----- By service ------------------------------------------------------------------------------

/** Typical wait for assignment and work time, side by side for each service, on one scale. */
function ServiceTimes({ services }: { services: ServiceRow[] }) {
  const { box, rowProps, layer } = useTip();
  const longest = Math.max(1, ...services.flatMap((s) => [s.wait.median ?? 0, s.work.median ?? 0]));
  return (
    <Card
      className="ta-card--times"
      title="Typical time per request"
      sub="The median: half took less, half took longer."
      legend={<Legend items={[['wait', 'Waiting for assignment'], ['work', 'With staff']]} />}
    >
      <div className="ta-rows" ref={box}>
        {services.map((s, i) => {
          const measured = s.wait.median !== null || s.work.median !== null;
          const lines = [timeLine(s.wait, 'waiting for assignment'), timeLine(s.work, 'with staff'), s.check && timeLine(s.check, 'MOV check'), timeLine(s.total, 'start to finish')].filter((l): l is TipLine => !!l);
          return (
            <div key={s.key} className="ta-row" {...(measured ? rowProps(s.label, lines) : {})}>
              <span className="ta-row-label">
                <strong>{s.label}</strong>
                <span>{s.total.median !== null ? `${formatDuration(s.total.median)} start to finish` : 'Nothing finished'}</span>
              </span>
              {measured ? (
                <span className="ta-row-bars">
                  {([['wait', s.wait], ['work', s.work]] as const).map(([tone, t]) => (
                    <span key={tone} className="ta-line">
                      <Fill share={(t.median ?? 0) / longest} tone={tone} index={i} />
                      <span className="ta-value">{t.median === null ? '-' : formatDuration(t.median)}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="ta-row-empty">Nothing to measure in this period</span>
              )}
            </div>
          );
        })}
        {layer}
      </div>
    </Card>
  );
}

/** Of the finished requests that had a due date, how many were on time. */
function OnTime({ services }: { services: ServiceRow[] }) {
  const { box, rowProps, layer } = useTip();
  return (
    <Card title="Finished on time" sub="Of the finished requests with a due, event or target date." legend={<Legend items={[['ontime', 'On time'], ['late', 'Late']]} />}>
      <div className="ta-rows ta-rows--split" ref={box}>
        {services.map((s, i) => {
          const onTime = s.with_due - s.late;
          const pct = s.with_due ? Math.round((onTime / s.with_due) * 100) : 0;
          return (
            <div key={s.key} className="ta-row" {...(s.with_due ? rowProps(s.label, [[`${pct}%`, 'on time'], [`${s.late} of ${s.with_due}`, 'late'], [String(s.reopened), 'reopened']]) : {})}>
              <span className="ta-row-label">
                <strong>{s.label}</strong>
                <span>{s.with_due ? `${s.late} late of ${s.with_due}` : 'No due dates in this period'}</span>
              </span>
              {s.with_due > 0 && (
                <span className="ta-split">
                  <span className="ta-split-bar">
                    <Fill share={onTime / s.with_due} tone="ontime" index={i} end={false} />
                    <Fill share={s.late / s.with_due} tone="late" index={i} end={false} />
                  </span>
                  <span className="ta-value ta-value--lead">{pct}%</span>
                </span>
              )}
            </div>
          );
        })}
        {layer}
      </div>
    </Card>
  );
}

/** What is open now: with staff, or still waiting for someone to be assigned. */
function OpenNow({ services }: { services: ServiceRow[] }) {
  const { box, rowProps, layer } = useTip();
  const most = Math.max(1, ...services.map((s) => s.open_now));
  return (
    <Card title="Open right now" sub="Not finished yet, whatever the period." legend={<Legend items={[['work', 'With staff'], ['wait', 'Waiting for assignment']]} />}>
      <div className="ta-rows" ref={box}>
        {services.map((s, i) => {
          const withStaff = s.open_now - s.waiting_now;
          const lines: TipLine[] = [[String(withStaff), 'with staff'], [String(s.waiting_now), 'waiting for assignment']];
          if (s.oldest_waiting) lines.push([sinceText(s.oldest_waiting), 'oldest waiting since']);
          return (
            <div key={s.key} className="ta-row" {...(s.open_now ? rowProps(s.label, lines) : {})}>
              <span className="ta-row-label">
                <strong>{s.label}</strong>
                <span>{s.waiting_now ? `${s.waiting_now} waiting since ${sinceText(s.oldest_waiting)}` : s.open_now ? 'All assigned' : 'Nothing open'}</span>
              </span>
              <span className="ta-line">
                <Fill share={withStaff / most} tone="work" index={i} end={s.waiting_now === 0} />
                <Fill share={s.waiting_now / most} tone="wait" index={i} />
                <span className="ta-value">{s.open_now}</span>
              </span>
            </div>
          );
        })}
        {layer}
      </div>
    </Card>
  );
}

export function ServiceCharts({ services }: { services: ServiceRow[] }) {
  return (
    <div className="ta-grid">
      <ServiceTimes services={services} />
      <OnTime services={services} />
      <OpenNow services={services} />
    </div>
  );
}

// ----- By staff member -------------------------------------------------------------------------

/** Requests each person finished in the period, most first. */
export function StaffChart({ staff }: { staff: StaffRow[] }) {
  const { box, rowProps, layer } = useTip();
  const [all, setAll] = useState(false);
  const most = Math.max(1, ...staff.map((p) => p.finished));
  const shown = all ? staff : staff.slice(0, STAFF_ROWS);
  return (
    <Card className="ta-card--staff" title="Finished in this period" sub="Each staff member's finished requests, with their typical work time.">
      <div className="ta-rows ta-rows--staff" ref={box}>
        {shown.map((p, i) => {
          const lines: TipLine[] = [[String(p.finished), 'finished']];
          const work = timeLine(p.work, 'typical work time');
          if (work) lines.push(work);
          lines.push([p.with_due ? `${p.late} of ${p.with_due}` : '-', 'late'], [String(p.reopened), 'reopened'], [String(p.open_now), 'assigned and open now']);
          return (
            <div key={p.id} className="ta-row" {...rowProps(p.name, lines)}>
              <span className="ta-row-label">
                <strong>{p.name}</strong>
                <span>{p.services.join(', ')}</span>
              </span>
              <span className="ta-line">
                <Fill share={p.finished / most} tone="work" index={i} />
                <span className="ta-value">{p.finished}</span>
              </span>
              <span className="ta-row-meta">
                <span>{p.work.median === null ? 'No work time' : `${formatDuration(p.work.median)} typical`}</span>
                <span className={p.late ? 'is-late' : undefined}>{p.with_due ? `${p.late} late` : 'No due dates'}</span>
              </span>
            </div>
          );
        })}
        {layer}
      </div>
      {staff.length > STAFF_ROWS && (
        <button type="button" className="ta-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${staff.length}`}
        </button>
      )}
    </Card>
  );
}
