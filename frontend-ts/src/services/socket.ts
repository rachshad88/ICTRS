import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let currentUserId = '';
let currentRole = '';

export const initSocket = (userId: string, role: string): Socket => {
  currentUserId = userId;
  currentRole = role;
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      socket?.emit('register_user', { user_id: currentUserId, role: currentRole });
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
