// Statuses of a finished request (backend utils/priority.ts COMPLETED_STATUSES). RATED: done, and the
// requester has rated it in the rating system; wherever "done" is shown or counted, both count.
export const COMPLETED = ['DONE', 'RATED'];

export const isCompleted = (status?: string | null) => !!status && COMPLETED.includes(status);
