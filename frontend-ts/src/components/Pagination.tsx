import { useEffect, useState } from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Names this set of pages for screen readers, where a page has more than one. */
  label?: string;
  /** On phones, return to the top of the page when the page number changes. */
  scrollToTop?: boolean;
}

const MOBILE_QUERY = '(max-width: 768px)';

export default function Pagination({ currentPage, totalPages, onPageChange, label, scrollToTop }: PaginationProps) {
  const [jump, setJump] = useState(String(currentPage));

  useEffect(() => {
    setJump(String(currentPage));
  }, [currentPage]);

  if (totalPages <= 1) return null;

  const changeTo = (page: number) => {
    onPageChange(page);
    if (scrollToTop && page !== currentPage && window.matchMedia(MOBILE_QUERY).matches) window.scrollTo(0, 0);
  };

  const applyJump = () => {
    const parsed = parseInt(jump, 10);
    if (!isNaN(parsed)) {
      const page = Math.min(Math.max(parsed, 1), totalPages);
      changeTo(page);
      setJump(String(page));
    } else {
      setJump(String(currentPage));
    }
  };

  const goTo = (page: number) => {
    changeTo(page);
    setJump(String(page));
  };

  return (
    <div className="history-pagination" role={label ? 'navigation' : undefined} aria-label={label}>
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
        inputMode="numeric"
        enterKeyHint="go"
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