// A request's journey in its details: Submitted → Accepted → Done (or Declined / Cancelled), with
// when each step happened and how long it took after the one before. Steps not reached yet are
// shown faintly so the client can see what comes next.
//
// accepted_at and cancelled_at exist since 2026-10-09; older requests had them copied from the
// audit log, and where the log had nothing the step is still shown as reached, just without a time.

export interface ProgressTimes {
  status: string;
  created_at?: string | null;
  accepted_at?: string | null;
  completed_at?: string | null;
  declined_at?: string | null;
  cancelled_at?: string | null;
  /** "Still not fixed": when the client sent it back, and when it had been marked done before. */
  reopened_at?: string | null;
  previously_completed_at?: string | null;
}

type StepState = 'done' | 'current' | 'upcoming' | 'declined' | 'cancelled' | 'reopened';

interface Step {
  label: string;
  at?: string | null;
  state: StepState;
  note?: string;
}

const WAITING = ['PENDING', 'UNASSIGNED'];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "45 min", "3 h 20 min", "2 days 4 h": how long a step took after the previous one. */
function formatGap(from: string, to: string): string | null {
  const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days} ${days === 1 ? 'day' : 'days'}${rest ? ` ${rest} h` : ''}`;
}

function buildSteps(r: ProgressTimes, assigneeName?: string | null): Step[] {
  const steps: Step[] = [{ label: 'Submitted', at: r.created_at, state: 'done' }];
  const waiting = WAITING.includes(r.status);
  const accepted = !!r.accepted_at || r.status === 'IN_PROGRESS' || r.status === 'DONE';

  if (accepted) {
    steps.push({ label: 'Accepted', at: r.accepted_at, state: 'done', note: assigneeName ? `Handled by ${assigneeName}` : undefined });
  } else if (waiting) {
    steps.push({ label: 'Accepted', state: 'current', note: 'Waiting for the team to accept it' });
  }

  if (r.reopened_at) {
    steps.push({ label: 'Marked done', at: r.previously_completed_at, state: 'done' });
    steps.push({ label: 'Reopened', at: r.reopened_at, state: 'reopened', note: 'Sent back as still not fixed' });
  }

  if (r.status === 'DONE') {
    steps.push({ label: 'Done', at: r.completed_at, state: 'done' });
  } else if (r.status === 'DECLINED') {
    steps.push({ label: 'Declined', at: r.declined_at, state: 'declined' });
  } else if (r.status === 'CANCELLED') {
    steps.push({ label: 'Cancelled', at: r.cancelled_at, state: 'cancelled' });
  } else {
    const working = r.status === 'IN_PROGRESS';
    const note = working ? (r.reopened_at ? 'Being worked on again' : 'Being worked on') : r.reopened_at ? 'Waiting for the IT office to assign it' : undefined;
    steps.push({ label: 'Done', state: working || r.reopened_at ? 'current' : 'upcoming', note });
  }
  return steps;
}

function RequestProgress({ request, assigneeName }: { request: ProgressTimes; assigneeName?: string | null }) {
  const steps = buildSteps(request, assigneeName);
  // The gap is measured from the last step that has a time.
  let lastAt: string | null = null;

  return (
    <div className="req-progress">
      <h4 className="req-progress-title">Progress</h4>
      <ol>
        {steps.map((step) => {
          const gap = step.at && lastAt ? formatGap(lastAt, step.at) : null;
          if (step.at) lastAt = step.at;
          return (
            <li key={step.label} className={`req-step is-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
              <span className="req-step-dot" aria-hidden="true" />
              <div className="req-step-body">
                <span className="req-step-label">{step.label}</span>
                {step.at && <time className="req-step-time" dateTime={step.at}>{formatWhen(step.at)}</time>}
                {gap && <span className="req-step-gap">{gap} later</span>}
                {step.note && <span className="req-step-note">{step.note}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default RequestProgress;
