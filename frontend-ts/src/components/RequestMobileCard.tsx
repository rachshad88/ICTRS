import { useState, type ReactNode } from 'react';

interface MetaItem {
  label: string;
  value: ReactNode;
}

interface RequestMobileCardProps {
  title: string;
  subtitle?: string;
  thumbnailLabel?: string;
  typeLabel?: string;
  statusLabel?: string;
  statusClass?: string;
  metaItems?: MetaItem[];
  details?: ReactNode;
  actions?: ReactNode;
}

function RequestMobileCard({
  title,
  subtitle,
  thumbnailLabel,
  typeLabel = 'Request',
  statusLabel,
  statusClass = 'pending',
  metaItems = [],
  details,
  actions,
}: RequestMobileCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="mobile-request-card">
      <div className="mobile-request-thumb">
        <div className="mobile-request-thumb-top">
          <span className="mobile-request-chip">{typeLabel}</span>
          {statusLabel && <span className={`mobile-request-status ${statusClass}`}>{statusLabel}</span>}
        </div>
        <div className="mobile-request-thumb-body">
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {thumbnailLabel && <span className="mobile-request-code">{thumbnailLabel}</span>}
      </div>

      <div className="mobile-request-body">
        <div className="mobile-request-meta">
          {metaItems.map((item) => (
            <div key={item.label} className="mobile-request-meta-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        {details && (
          <>
            <button className="mobile-request-toggle" onClick={() => setExpanded((prev) => !prev)}>
              {expanded ? 'Hide details' : 'Show details'}
            </button>
            {expanded && <div className="mobile-request-details">{details}</div>}
          </>
        )}

        {actions && <div className="mobile-request-actions">{actions}</div>}
      </div>
    </article>
  );
}

export default RequestMobileCard;
