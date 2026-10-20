import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';

// A client's request drawn as the ticket on the landing page (Landing.tsx): navy head, the code,
// what was asked for, a perforation, and a stub with the status stamp. Phones only; wider
// screens keep the table (pages.css, "CLIENT REQUEST TICKETS").

export interface TicketRow {
  label: string;
  value: ReactNode;
}

interface RequestTicketProps {
  /** Which service, in the head: "IT Request", "Event Documentation", ... */
  type: string;
  code: string;
  title: ReactNode;
  status: string;
  statusLabel?: string;
  /** Under the title, two to a row. */
  meta?: TicketRow[];
  /** On the stub, under the status. */
  rows?: TicketRow[];
  actions?: ReactNode;
  /** Position in the list, to stagger the entrance like the table rows. */
  index?: number;
}

function RequestTicket({ type, code, title, status, statusLabel, meta = [], rows = [], actions, index = 0 }: RequestTicketProps) {
  return (
    <motion.article
      className="rq-ticket"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: Math.min(index, 8) * 0.03, ease: EASE_OUT }}
    >
      <div className="rq-ticket-head">
        <img src="/solano-logo.png" alt="" />
        <span className="rq-ticket-brand">ITRS ticket</span>
        <span className="rq-ticket-type">{type}</span>
      </div>
      <div className="rq-ticket-body">
        <span className="rq-ticket-code">{code}</span>
        <p className="rq-ticket-issue">{title}</p>
        {meta.length > 0 && (
          <dl className="rq-ticket-meta">
            {meta.map((m) => (
              <div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>
            ))}
          </dl>
        )}
      </div>
      <div className="rq-ticket-tear" aria-hidden="true" />
      <div className="rq-ticket-stub">
        <div className="rq-ticket-status">
          <span className="rq-ticket-label">Status</span>
          <span className={`rq-stamp rq-stamp-${status.toLowerCase().replace(/_/g, '-')}`}>
            {statusLabel || status.replace(/_/g, ' ')}
          </span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="rq-ticket-row">
            <span className="rq-ticket-label">{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
        {actions && <div className="rq-ticket-actions">{actions}</div>}
      </div>
    </motion.article>
  );
}

export default RequestTicket;
