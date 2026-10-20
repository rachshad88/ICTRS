import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';

// A request drawn as the ticket on the landing page (Landing.tsx): navy head, the code, what was
// asked for, a perforation, and a stub with the status stamp. Phones only; wider screens keep
// the table (pages.css, "REQUEST TICKETS"). Used by the clients' histories and the staff lists.

/** Closed statuses whose table Action column holds only a status pill, which the stamp already shows. */
export const STAMP_ONLY = ['CANCELLED', 'DONE', 'RATED'];

export interface TicketRow {
  label: string;
  value: ReactNode;
}

interface RequestTicketProps {
  /** Which service, in the head: "IT Request", "Event Documentation", ... */
  type: string;
  code: string;
  /** Priority, overdue and reopened chips (RequestFlags), under the code. */
  flags?: ReactNode;
  title: ReactNode;
  /** A smaller line under the title: the request's detail, or how many notes it has. */
  sub?: ReactNode;
  status: string;
  statusLabel?: string;
  /** Under the title, two to a row. */
  meta?: TicketRow[];
  /** On the stub, under the status. */
  rows?: TicketRow[];
  /** Behind a Show details button, for what the list leaves out. */
  details?: ReactNode;
  actions?: ReactNode;
  /** Opens the request, like clicking its table row; the code becomes a button too. */
  onOpen?: () => void;
  /** Position in the list, to stagger the entrance like the table rows. */
  index?: number;
}

function RequestTicket({
  type, code, flags, title, sub, status, statusLabel, meta = [], rows = [], details, actions, onOpen, index = 0,
}: RequestTicketProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.article
      className={`rq-ticket${onOpen ? ' is-openable' : ''}`}
      onClick={onOpen}
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
        {onOpen ? (
          <button type="button" className="rq-ticket-code" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{code}</button>
        ) : (
          <span className="rq-ticket-code">{code}</span>
        )}
        {flags && <div className="rq-ticket-flags">{flags}</div>}
        <p className="rq-ticket-issue">{title}</p>
        {sub && <p className="rq-ticket-sub">{sub}</p>}
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
        {details && (
          <>
            <button type="button" className="rq-ticket-toggle" aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
              {expanded ? 'Hide details' : 'Show details'}
            </button>
            {expanded && <div className="rq-ticket-details" onClick={(e) => e.stopPropagation()}>{details}</div>}
          </>
        )}
        {actions && <div className="rq-ticket-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
    </motion.article>
  );
}

export default RequestTicket;
