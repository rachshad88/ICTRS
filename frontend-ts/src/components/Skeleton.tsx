interface SkeletonProps {
  variant?: 'table' | 'card' | 'text';
  rows?: number;
}

function Skeleton({ variant = 'text', rows = 5 }: SkeletonProps) {
  if (variant === 'table') {
    return (
      <div className="skeleton-table">
        <div className="skeleton-row skeleton-header" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.05}s` }} />
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="skeleton-card">
        <div className="skeleton-card-line skeleton-card-title" />
        <div className="skeleton-card-line skeleton-card-body" />
        <div className="skeleton-card-line skeleton-card-body short" />
      </div>
    );
  }

  return (
    <div className="skeleton-text">
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  );
}

export default Skeleton;
