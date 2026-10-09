import { Link } from 'react-router-dom';

/**
 * The note shown when a request list is empty, with a next step: a search that found nothing offers
 * to clear it; a list that is truly empty offers to make the first request.
 */
function EmptyState({ title, hint, action, searchTerm, onClearSearch }: {
  title: string;
  hint?: string;
  action?: { to: string; label: string };
  searchTerm?: string;
  onClearSearch?: () => void;
}) {
  if (searchTerm) {
    return (
      <div className="empty-state">
        <h3>Nothing matches “{searchTerm}”</h3>
        <p>Check the spelling, or try a request code.</p>
        {onClearSearch && (
          <button type="button" className="btn-primary empty-action" onClick={onClearSearch}>
            Clear search
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action && (
        <Link to={action.to} className="btn-primary empty-action">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export default EmptyState;
