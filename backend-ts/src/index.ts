import 'dotenv/config';

// Users are in the Philippines. Day filters ("today", "this week") and displayed times are
// computed in this timezone rather than the server's (UTC). Set before any date is handled.
process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Manila';
import express, { Express, ErrorRequestHandler } from 'express';
import session, { SessionData } from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import { createServer, IncomingMessage } from 'http';
import { Socket } from 'socket.io';
import helmet from 'helmet';
import { ObjectId } from 'mongodb';
import { connectDB, connectRedis, createRedisPubSub, client as mongoClient, redisClient, getUsersCollection, sessionStatus, isDBReady, pingDB, mongoClientReady } from './config/database';
import { createAdapter } from '@socket.io/redis-adapter';
import { startRatingSync } from './utils/ratingSync';
import { startOverdueAlerts } from './utils/overdueAlerts';
import { backfillRequestTimestamps } from './utils/backfillTimestamps';
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
import csfRoutes from './routes/csf_route';
import dashboardRoutes from './routes/dashboard';
import overviewRoutes from './routes/overview';
import signatoryRoutes from './routes/signatories';
import officeRoutes from './routes/offices';
import liveRoutes, { registerLiveNamespace } from './routes/live';

const app: Express = express();
// nginx and the Vite dev proxy run on this machine; trust their X-Forwarded-* headers only.
app.set('trust proxy', 'loopback');
// Query strings are parsed flat: "?office[$ne]=x" stays the literal key "office[$ne]" instead of
// becoming a MongoDB operator, and a repeated key keeps only its first value, so every
// req.query value is a plain string. Must be set before any app.use(), which fixes the parser.
app.set('query parser', 'simple');
app.use((req, _res, next) => {
  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) req.query[key] = value[0];
  }
  next();
});
const httpServer = createServer(app);

// The app itself is same-origin (nginx or the Vite proxy forward /api and /socket.io), so it needs no
// CORS. Other sites may only read the API from these origins, and never with the user's cookies;
// by default that is the CSF rating site, which may use /api/csf.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://192.168.110.19')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const io = initSocket(httpServer, false);
registerLiveNamespace(io);

app.set('io', io);

app.use(cors({
  origin: CORS_ORIGINS,
  credentials: false
}));
app.use(helmet({
  contentSecurityPolicy: false
}));
// PM2 runs one backend process per core (ecosystem.config.js) and numbers them from 0.
const INSTANCE = process.env.NODE_APP_INSTANCE ?? '0';

// 503 when MongoDB is down, so monitoring and nginx see it. Ahead of the session middleware,
// which would otherwise wait on the database.
app.use('/api/health', async (_req, res) => {
  const database = await pingDB();
  res.status(database ? 200 : 503).json({
    status: database ? 'ok' : 'error',
    database: database ? 'up' : 'down',
    timestamp: new Date(),
    instance: INSTANCE,
  });
});

// Until the first MongoDB connection succeeds (startServer retries it), every other API call
// gets a clear 503 instead of failing on an unset database.
app.use('/api', (_req, res, next) => {
  if (isDBReady()) return next();
  res.status(503).json({ error: 'The server is starting up. Please try again in a moment.' });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable is required');
}

// Sessions end one hour after the last request: rolling renews the cookie on every response.
// The frontend signs people out after an hour without real activity (components/IdleLogout.tsx);
// this is the backstop for a closed browser or a PC left asleep.
const SESSION_IDLE_MS = 60 * 60 * 1000;

const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({
    clientPromise: mongoClientReady,
    dbName: process.env.MONGO_DB,
    collectionName: 'sessions',
    ttl: SESSION_IDLE_MS / 1000,
    autoRemove: 'native'
  }),
  cookie: {
    // HTTPS-only whenever the request arrived over HTTPS (nginx sets X-Forwarded-Proto), while
    // still working over plain HTTP on the LAN dev port.
    secure: 'auto',
    httpOnly: true,
    maxAge: SESSION_IDLE_MS,
    sameSite: 'lax'
  }
});

app.use(sessionMiddleware);

// Sockets use the same login session as the API. The user comes from the session cookie,
// never from anything the client sends, so a socket can only join its own rooms.
io.engine.use(sessionMiddleware);

function socketSession(socket: Socket): Partial<SessionData> | undefined {
  return (socket.request as IncomingMessage & { session?: Partial<SessionData> }).session;
}

function socketUserId(socket: Socket): string | undefined {
  return socketSession(socket)?.user_id;
}

io.use(async (socket, next) => {
  try {
    const session = socketSession(socket);
    const sessionId = (socket.request as IncomingMessage & { sessionID?: string }).sessionID;
    if ((await sessionStatus(session?.user_id, session?.session_version, sessionId)) !== 'ok') {
      next(new Error('Unauthorized'));
      return;
    }
    // Kept so a sign-in elsewhere can find and close this connection (auth.ts startSession).
    socket.data.sessionId = sessionId;
    next();
  } catch (error) {
    console.error('Socket session check error:', error);
    next(new Error('Unauthorized'));
  }
});

const userRoles = new Map<string, string[]>();

io.on('connection', async (socket) => {
  const userId = socketUserId(socket)!;

  try {
    // Roles are read fresh from the database so role changes apply on the next connection.
    const user = await getUsersCollection().findOne({ _id: new ObjectId(userId) }, { projection: { role: 1, roles: 1 } });
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const roles = user.roles || [user.role];
    userRoles.set(socket.id, roles);
    socket.join(`user_${userId}`);

    if (roles.includes('ADMIN') || roles.includes('MULTIMEDIA_ADMIN')) {
      socket.join('admins');
    }
    // Only the super admin gets IT request events alongside IT staff; multimedia admins don't.
    if (roles.includes('ADMIN')) {
      socket.join('super_admins');
    }
    if (roles.includes('MULTIMEDIA')) {
      socket.join('multimedia_staff');
    }
    if (roles.includes('TECHNICIAN') || roles.includes('IT_ADMIN')) {
      socket.join('technicians');
    }
    if (roles.includes('CLIENT')) {
      socket.join('clients');
    }

    console.log(`User ${userId} (${roles.join(', ')}) connected with socket ${socket.id}`);
  } catch (error) {
    console.error('Error registering socket user:', error);
    socket.disconnect(true);
    return;
  }

  socket.on('disconnect', () => {
    const roles = userRoles.get(socket.id);
    userRoles.delete(socket.id);
    console.log(`Client disconnected: ${socket.id} (User: ${userId}, Roles: ${roles?.join(', ')})`);
  });
});

// Timed jobs run in one process only, or each would run once per core (duplicate overdue alerts).
const IS_PRIMARY = INSTANCE === '0';

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/multimedia', multimediaRoutes);
app.use('/api/digitalmedia', digitalMediaRoutes);
app.use('/api/printmaterials', printMaterialsRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/csf', csfRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/signatories', signatoryRoutes);
app.use('/api/offices', officeRoutes);
// Wall display queue: no login, limited to LIVE_ALLOWED_CIDRS (see routes/live.ts).
app.use('/api/live', liveRoutes);

// Last resort for errors no route handled (e.g. malformed JSON from express.json()). Always JSON,
// never Express's default HTML page, which includes the stack trace outside production.
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status >= 500) {
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid request body' });
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large' });
  } else {
    res.status(status).json({ error: err?.expose ? err.message : 'Bad request' });
  }
};
app.use(errorHandler);

const rawPort = process.env.PORT || '3000';
const PORT = parseInt(rawPort, 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid PORT value: "${rawPort}". Must be a number between 1 and 65535.`);
  process.exit(1);
}

// Everything reaches the backend through nginx or the Vite proxy on this machine, so it can listen on
// 127.0.0.1 only. The default stays 0.0.0.0 until it is confirmed nothing (e.g. the CSF system)
// calls port 3000 directly; then set BIND_HOST=127.0.0.1 in .env.
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// After a reboot MongoDB (Docker) can still be starting when PM2 starts the backend, so keep trying
// instead of running on without a database until someone restarts it.
async function connectDBWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await connectDB();
      return;
    } catch (error) {
      const delayMs = Math.min(attempt * 2000, 15000);
      console.error(`MongoDB connection attempt ${attempt} failed (${(error as Error).message}); retrying in ${delayMs / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function startServer() {
  // Not awaited: the server listens meanwhile, answering 503 until MongoDB is connected.
  connectDBWithRetry().then(() => {
    console.log('Connected to MongoDB');
    if (IS_PRIMARY) {
      // Copy request statuses into the shared rating database now and every 10 minutes (deploy/RATING_DB.md).
      startRatingSync();
      // Notify staff and admins about requests past their due/event/target date, every 30 minutes.
      startOverdueAlerts();
      // One-time: older requests get their accepted/cancelled times from the audit log.
      backfillRequestTimestamps().catch((err) => console.error('Timestamp backfill failed:', err));
    }
  });

  const redisConnected = await connectRedis();
  // The other backend processes hold other users' sockets; Redis relays each broadcast to them.
  const pubSub = redisConnected ? await createRedisPubSub() : null;
  if (pubSub) {
    io.adapter(createAdapter(pubSub[0], pubSub[1]));
    console.log(`Connected to Redis (instance ${INSTANCE}: caching, shared login throttle, live events across processes)`);
  } else {
    console.warn(`Redis unavailable (instance ${INSTANCE}): live events only reach users on this process; run a single instance without Redis.`);
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
            httpServer.listen(PORT, BIND_HOST);
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

  httpServer.listen(PORT, BIND_HOST, () => {
    console.log(`Server running on ${BIND_HOST}:${PORT}`);
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
