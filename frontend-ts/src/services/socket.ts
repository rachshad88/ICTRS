import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

// The server identifies the user from the session cookie sent with the connection.
export const initSocket = (): Socket => {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling']
    });
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
