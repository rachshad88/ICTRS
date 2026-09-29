export const PRIORITIES = ['LOW', 'NORMAL', 'URGENT'] as const;
export type Priority = typeof PRIORITIES[number];

// Statuses in which a request still needs work and can therefore be overdue.
export const OPEN_STATUSES = ['PENDING', 'UNASSIGNED', 'IN_PROGRESS'];

const DAY_MS = 24 * 60 * 60 * 1000;

// Requests created before priorities existed have no field; they count as NORMAL.
export function normalizePriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : 'NORMAL';
}

// Due dates arrive as YYYY-MM-DD and are stored like event_date/target_date (midnight UTC).
export function parseDueDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

// YYYY-MM-DD for API responses; null for missing or unparseable dates.
export function toDay(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as string | Date);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// A request is overdue once the whole due day has passed and it is still open.
export function isOverdue(status: string, due: Date | null | undefined, now = Date.now()): boolean {
  if (!due || !OPEN_STATUSES.includes(status)) return false;
  return new Date(due).getTime() + DAY_MS <= now;
}

// Aggregation equivalents of the helpers above, for pipelines that filter or count on them.
export function priorityExpr(field = '$priority') {
  return { $ifNull: [field, 'NORMAL'] };
}

export function priorityRankExpr(field = '$priority') {
  return {
    $switch: {
      branches: [
        { case: { $eq: [priorityExpr(field), 'URGENT'] }, then: 0 },
        { case: { $eq: [priorityExpr(field), 'LOW'] }, then: 2 }
      ],
      default: 1
    }
  };
}

export function overdueExpr(dueField: string, statusField = '$status') {
  return {
    $and: [
      { $in: [statusField, OPEN_STATUSES] },
      { $eq: [{ $type: dueField }, 'date'] },
      { $lte: [{ $add: [dueField, DAY_MS] }, '$$NOW'] }
    ]
  };
}
