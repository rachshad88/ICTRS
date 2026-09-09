export function truncateCell(value: unknown, max = 25): string {
  const s = typeof value === 'string' ? value : String(value);
  return s.length > max ? s.slice(0, max) + '...' : s;
}