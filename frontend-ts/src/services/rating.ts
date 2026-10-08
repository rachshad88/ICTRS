const RATING_URL = import.meta.env.VITE_RATING_SYSTEM_URL || 'http://192.168.110.19/';

// Opens the client satisfaction (rating) form for a finished request in a new tab. The rating system
// looks the request up by request_id in the shared rating database (deploy/RATING_DB.md).
export function openRating(requestId: string, requestCode: string, type: string) {
  const params = new URLSearchParams({ request_id: requestId, request_code: requestCode, type });
  window.open(`${RATING_URL}?${params}`, '_blank');
}
