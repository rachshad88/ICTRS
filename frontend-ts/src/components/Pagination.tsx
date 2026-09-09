import { useEffect, useState } from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const [jump, setJump] = useState(String(currentPage));

  useEffect(() => {
    setJump(String(currentPage));
  }, [currentPage]);

  if (totalPages <= 1) return null;

  const applyJump = () => {
    const parsed = parseInt(jump, 10);
    if (!isNaN(parsed)) {
      const page = Math.min(Math.max(parsed, 1), totalPages);
      onPageChange(page);
      setJump(String(page));
    } else {
      setJump(String(currentPage));
    }
  };

  const goTo = (page: number) => {
    onPageChange(page);
    setJump(String(page));
  };

  return (
    <div className="history-pagination">
      <button className="hp-btn" disabled={currentPage === 1} onClick={() => goTo(currentPage - 1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Prev
      </button>

      <span className="hp-label">Page</span>
      <input
        className="hp-input"
        type="number"
        min={1}
        max={totalPages}
        value={jump}
        onChange={(e) => setJump(e.target.value)}
        onBlur={applyJump}
        onKeyDown={(e) => {
          if (e.key === 'Enter') applyJump();
        }}
        aria-label="Go to page"
      />
      <span className="hp-label">of {totalPages}</span>

      <button className="hp-btn" disabled={currentPage === totalPages} onClick={() => goTo(currentPage + 1)}>
        Next
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </button>
    </div>
  );
}