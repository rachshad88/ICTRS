import { useState, useEffect } from 'react';

/**
 * Search input that only applies its text when the user presses Enter or clicks Search,
 * so the page doesn't reload results on every keystroke.
 */
function SearchBox({ value, onSearch, placeholder, className = '' }: {
  value: string;
  onSearch: (term: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);

  // Follow outside changes to the applied term, such as a "reset filters" button.
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <form
      className={`search-form ${className}`.trim()}
      role="search"
      onSubmit={(e) => { e.preventDefault(); onSearch(draft.trim()); }}
    >
      <input
        type="search"
        enterKeyHint="search"
        spellCheck={false}
        className="search-input"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={placeholder || 'Search'}
      />
      <button type="submit" className="hbtn hbtn-view search-btn">Search</button>
    </form>
  );
}

export default SearchBox;
