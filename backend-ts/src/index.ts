import 'dotenv/config';
import express, { Express } from 'express';
import session from 'express-session';
import cors from 'cors';
import { createServer } from 'http';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ObjectId } from 'mongodb';
import { connectDB, connectRedis, client as mongoClient, redisClient, getUsersCollection } from './config/database';
import { initSocket } from './config/socket';

import authRoutes from './routes/auth';
import requestRoutes from './routes/requests';
import userRoutes from './routes/users';
import reportRoutes from './routes/reports';
import multimediaRoutes from './routes/multimedia';
import digitalMediaRoutes from './routes/digitalMedia';
import printMaterialsRoutes from './routes/printMaterials';
import fileRoutes from './routes/files';
import auditRoutes from './routes/audit';
import notificationRoutes from './routes/notifications';

const app: Express = express();
const httpServer = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const io = initSocket(httpServer, isProduction ? FRONTEND_URL : true);

app.set('io', io);

app.use(cors({
  origin: isProduction ? FRONTEND_URL : true,
  credentials: true
}));
app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable is required');
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: isProduction ? 'strict' : 'lax'
  }
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const connectedUsers = new Map<string, string>();
const userRoles = new Map<string, string>();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register_user', async (data: { user_id: string; role: string }) => {
    try {
      const userId = data.user_id;
      if (!userId || !/^[a-fA-F0-9]{24}$/.test(userId)) return;

      const usersCollection = getUsersCollection();
      const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
      if (!user) return;

      const role = user.role;
      connectedUsers.set(socket.id, userId);
      userRoles.set(socket.id, role);
      socket.join(`user_${userId}`);
      
      if (role === 'ADMIN' || role === 'MULTIMEDIA_ADMIN') {
        socket.join('admins');
      }
      if (role === 'MULTIMEDIA') {
        socket.join('multimedia_staff');
      }
      if (role === 'TECHNICIAN' || role === 'IT_ADMIN') {
        socket.join('technicians');
      }
      if (role === 'CLIENT') {
        socket.join('clients');
      }
      
      console.log(`User ${userId} (${role}) registered with socket ${socket.id}`);
    } catch (error) {
      console.error('Error registering user:', error);
    }
  });

  socket.on('disconnect', () => {
    const userId = connectedUsers.get(socket.id);
    const role = userRoles.get(socket.id);
    connectedUsers.delete(socket.id);
    userRoles.delete(socket.id);
    console.log(`Client disconnected: ${socket.id} (User: ${userId}, Role: ${role})`);
  });
});

app.use('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/multimedia', multimediaRoutes);
app.use('/api/digitalmedia', digitalMediaRoutes);
app.use('/api/printmaterials', printMaterialsRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);

const rawPort = process.env.PORT || '3000';
const PORT = parseInt(rawPort, 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT value: "${rawPort}". Must be a number between 1 and 65535.`);
  process.exit(1);
}

async function startServer() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    console.log('Server will start but database operations will fail');
  }

  const redisConnected = await connectRedis();
  if (redisConnected) {
    console.log('Connected to Redis (caching enabled)');
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is in use, attempting to kill the old process...`);
      try {
        require('child_process').exec(`netstat -ano | findstr :${PORT}`, (e: unknown, o: string) => {
          const lines = o.split('\n').filter((l: string) => l.includes('LISTENING'));
          for (const line of lines) {
            const parts = line.trim().split(/ +/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid && pid !== process.pid) {
              try { process.kill(pid, 'SIGTERM'); } catch {}
            }
          }
          setTimeout(() => {
            httpServer.close();
            httpServer.listen(PORT, '0.0.0.0');
          }, 1000);
        });
      } catch {
        console.error(`Failed to kill process on port ${PORT}. Please run: npm run restart`);
        process.exit(1);
      }
      return;
    }
    throw err;
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  httpServer.close(async () => {
    console.log('HTTP server closed');
    try {
      if (mongoClient) {
        await mongoClient.close();
        console.log('MongoDB connection closed');
      }
    } catch (e) {
      console.error('Error closing MongoDB connection:', e);
    }
    try {
      if (redisClient) {
        await redisClient.quit();
        console.log('Redis connection closed');
      }
    } catch (e) {
      console.error('Error closing Redis connection:', e);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

startServer();

export { app, io };
