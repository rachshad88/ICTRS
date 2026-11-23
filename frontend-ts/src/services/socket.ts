import { io, Socket } from 'socket.io-client';
import { api } from './api';

let socket: Socket | null = null;

// Listeners for every event on whichever socket is current, so they survive logout/login (which
// replace the socket). Besides server events they get 'reconnect' after a dropped connection
// comes back, since events sent while it was down were missed.
type AnyListener = (event: string) => void;
const anyListeners = new Set<AnyListener>();
const tell = (event: string) => anyListeners.forEach((l) => l(event));

// Whether the live connection is up, for the offline banner. Starts "up": a socket that has not
// connected yet is not a lost connection, and a deliberate disconnect (logout) is not one either.
type ConnectionListener = (up: boolean) => void;
let connectionUp = true;
const connectionListeners = new Set<ConnectionListener>();
const setConnection = (up: boolean) => {
  if (up === connectionUp) return;
  connectionUp = up;
  connectionListeners.forEach((l) => l(up));
};

// Socket.IO retries by itself after a network drop, but gives up for good when the server refused
// the connection (its session check failed, e.g. while the backend was still starting) or closed it.
// The page kept working over HTTP while the banner said "Reconnecting…" forever. So ask the API
// whether the session is still good: if it ended, go to the login page; otherwise connect again.
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30000;
let retryDelay = RETRY_MIN_MS;
let retryTimer: number | undefined;

const retryAfterRefusal = (s: Socket) => {
  if (retryTimer !== undefined) return;
  retryTimer = window.setTimeout(async () => {
    retryTimer = undefined;
    if (socket !== s || s.connected) return;
    try {
      await api.get('/auth/me', { headers: { 'Cache-Control': 'no-cache' } });
    } catch (error) {
      const res = (error as { response?: { status?: number; data?: { code?: string } } }).response;
      if (res?.status === 401 && (res.data?.code === 'SESSION_EXPIRED' || res.data?.code === 'SESSION_REPLACED')) {
        window.location.assign(res.data.code === 'SESSION_REPLACED' ? '/login?replaced=1' : '/login?expired=1');
        return;
      }
      // Anything else (network down, server restarting): just try again.
    }
    if (socket !== s || s.connected) return;
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    s.connect();
  }, retryDelay);
};

// The server identifies the user from the session cookie sent with the connection.
export const initSocket = (): Socket => {
  if (!socket) {
    // WebSocket only: the backend runs one process per core, and long-polling would need every
    // request of a connection to reach the same one (backend-ts/src/config/socket.ts).
    const s = io('/', {
      transports: ['websocket']
    });
    socket = s;
    s.onAny(tell);
    s.io.on('reconnect', () => tell('reconnect'));
    s.on('connect', () => {
      retryDelay = RETRY_MIN_MS;
      setConnection(true);
    });
    s.on('connect_error', () => {
      setConnection(false);
      // Not active: the server refused, and the client will not retry on its own.
      if (!s.active) retryAfterRefusal(s);
    });
    s.on('disconnect', (reason) => {
      setConnection(reason === 'io client disconnect');
      if (reason === 'io server disconnect') retryAfterRefusal(s);
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  window.clearTimeout(retryTimer);
  retryTimer = undefined;
  retryDelay = RETRY_MIN_MS;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  setConnection(true);
};

/** Calls `listener` with the name of every socket event from now on. Returns an unsubscribe. */
export const onAnySocketEvent = (listener: AnyListener): (() => void) => {
  anyListeners.add(listener);
  return () => anyListeners.delete(listener);
};

export const isConnectionUp = (): boolean => connectionUp;

/** Calls `listener` whenever the live connection drops or comes back. Returns an unsubscribe. */
export const onConnectionChange = (listener: ConnectionListener): (() => void) => {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
};
