import { QueryClient } from '@tanstack/react-query';
import { onAnySocketEvent } from './socket';

// Server data cache (TanStack Query). Pages read through useQuery with keys that start with the
// service they belong to: ['it', ...], ['multimedia', ...], ['digitalMedia', ...],
// ['printMaterials', ...]. Socket events mark a whole service's data stale (startLiveUpdates), so
// every screen showing it refetches; screens not on display refetch when next opened.
// Views across all services (All Requests, the admin dashboard) use ['overview', ...] and follow
// every service's changes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live updates come over the socket, so cached data counts as fresh for a while; going back
      // to a page within this window shows it instantly without a request.
      staleTime: 30_000,
      // One retry for a blip on the office network; a real failure shows quickly.
      retry: 1,
    },
  },
});

export type Service = 'it' | 'multimedia' | 'digitalMedia' | 'printMaterials';

/** Which service's data a socket event changes, or null for events that change none. */
export function serviceForEvent(event: string): Service | null {
  if (event.startsWith('multimedia_')) return 'multimedia';
  if (event.startsWith('digital_media_')) return 'digitalMedia';
  if (event.startsWith('print_materials_')) return 'printMaterials';
  if (event === 'request_update' || event.startsWith('my_request_') || event.startsWith('request_')) return 'it';
  return null;
}

// The overview queries are the heaviest, and one action often fires several events (a
// reassignment tells the admin, both staff and the client), so they refetch once per burst.
let overviewTimer: ReturnType<typeof setTimeout> | undefined;
function refreshOverviewSoon() {
  clearTimeout(overviewTimer);
  overviewTimer = setTimeout(() => queryClient.invalidateQueries({ queryKey: ['overview'] }), 500);
}

/** Marks one service's data stale after a change made on this screen (accept, finish, cancel...). */
export function refreshService(service: Service): Promise<void> {
  refreshOverviewSoon();
  return queryClient.invalidateQueries({ queryKey: [service] });
}

/** Keeps the cache in step with the server. Call once at startup. */
export function startLiveUpdates(): () => void {
  return onAnySocketEvent((event) => {
    // Back from a dropped connection: anything may have changed meanwhile.
    if (event === 'reconnect') {
      queryClient.invalidateQueries();
      return;
    }
    const service = serviceForEvent(event);
    if (service) refreshService(service);
  });
}
