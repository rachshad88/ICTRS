import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

// Listeners for every event on whichever socket is current, so they survive logout/login (which
// replace the socket). Besides server events they get 'reconnect' after a dropped connection
// comes back, since events sent while it was down were missed.
type AnyListener = (event: string) => void;
const anyListeners = new Set<AnyListener>();
const tell = (event: string) => anyListeners.forEach((l) => l(event));

// The server identifies the user from the session cookie sent with the connection.
export const initSocket = (): Socket => {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling']
    });
    socket.onAny(tell);
    socket.io.on('reconnect', () => tell('reconnect'));
  }
  return socket;
};

export const getSocket = (): Socket | null => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

/** Calls `listener` with the name of every socket event from now on. Returns an unsubscribe. */
export const onAnySocketEvent = (listener: AnyListener): (() => void) => {
  anyListeners.add(listener);
  return () => anyListeners.delete(listener);
};
