import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server | null = null;

export function initSocket(httpServer: HttpServer, corsOrigin: string | boolean): Server {
    io = new Server(httpServer, {
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
