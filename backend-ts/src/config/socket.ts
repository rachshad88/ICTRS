import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer, corsOrigin: string | boolean): Server {
    io = new Server(httpServer, {
        // WebSocket only: PM2 spreads connections over several processes, and long-polling needs
        // every request of a session to reach the same one. nginx forwards the upgrade.
        transports: ['websocket'],
        cors: {
            origin: corsOrigin,
            methods: ['GET', 'POST'],
            credentials: true
        }
    });
    return io;
}

export function getIO(): Server {
    if (!io) {
        throw new Error('Socket.IO not initialized. Call initSocket first.');
    }
    return io;
}

// Tells open User Management pages to reload the account list: a sign-up waiting for approval,
// or someone changing their own profile or password.
export function tellUsersChanged(): void {
    io?.to('super_admins').emit('users_changed');
}
