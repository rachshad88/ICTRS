// Cell formatting shared by the Reports table and the DAR export (darDocx.ts).
export function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (v instanceof Date) {
    return v.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime()) && v.includes('T')) return d.toLocaleDateString();
    return v;
  }
  return String(v);
}
