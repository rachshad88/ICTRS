import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let currentUserId = '';
let currentRoles: string[] = [];

export const initSocket = (userId: string, roles: string[]): Socket => {
  currentUserId = userId;
  currentRoles = roles;
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      socket?.emit('register_user', { user_id: currentUserId, role: currentRoles[0] || '', roles: currentRoles });
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
