import { io, Socket } from 'socket.io-client';

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

// The server identifies the user from the session cookie sent with the connection.
export const initSocket = (): Socket => {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling']
    });
    socket.onAny(tell);
    socket.io.on('reconnect', () => tell('reconnect'));
    socket.on('connect', () => setConnection(true));
    socket.on('connect_error', () => setConnection(false));
    socket.on('disconnect', (reason) => setConnection(reason === 'io client disconnect'));
  }
  return socket;
};

export const getSocket = (): Socket | null => socket;

export const disconnectSocket = () => {
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
