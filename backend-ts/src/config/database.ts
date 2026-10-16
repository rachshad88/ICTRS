import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { RedisClientType, createClient } from 'redis';
import { Priority } from '../utils/priority';

export const ALL_ROLE_VALUES = ['ADMIN', 'TECHNICIAN', 'CLIENT', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN'] as const;
export type Role = typeof ALL_ROLE_VALUES[number];

export interface User {
  _id?: ObjectId;
  username: string;
  password: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  role: Role;
  roles: Role[];
  primary_role: Role;
  office?: string;
  position?: string;
  created_at?: Date;
  // Bumped when an admin changes the user's access or password; sessions started under an
  // older version are rejected (see isAuthenticated).
  session_version?: number;
  // false for a self sign-up an admin has not approved yet: it cannot sign in, and any session it
  // has is refused (sessionStatus). Missing means approved: older accounts, and ones admins made.
  approved?: boolean;
  // false when an admin has deactivated the account: it cannot sign in, and any session it has is
  // refused (sessionStatus). Missing means active.
  active?: boolean;
  // Session id of the latest sign-in. Only one session per user: a sign-in elsewhere replaces it,
  // and any other session is refused (sessionStatus). Missing (signed in before this existed): any.
  current_session?: string;
}

export interface RequestNote {
  _id: ObjectId;
  text: string;
  author_id: ObjectId;
  author_name: string;
  created_at: Date;
}

// Fields shared by every request type for declining and client follow-up notes, plus the times
// of the steps a request goes through (shown as its progress in the details). accepted_at is the
// first acceptance or assignment; a reassignment keeps it. Older requests got these from the audit
// log (utils/backfillTimestamps.ts); null there means the log had no entry.
export interface DeclineAndNotes {
  decline_reason?: string | null;
  declined_by?: ObjectId | null;
  declined_at?: Date | null;
  accepted_at?: Date | null;
  cancelled_at?: Date | null;
  notes?: RequestNote[];
  // "Still not fixed" (IT only, routes/requests.ts reopen_request): when the client last reopened
  // it, how many times, and when it had been marked done before that.
  reopened_at?: Date | null;
  reopen_count?: number;
  previously_completed_at?: Date | null;
}

// Urgency set by the client and adjustable by admins. Only IT requests store a due date;
// the media types use their event or target date instead.
export interface PriorityAndDue {
  priority?: Priority;
  due_date?: Date | null;
}

export interface Request extends DeclineAndNotes, PriorityAndDue {
  _id?: ObjectId;
  request_code: string;
  created_by: ObjectId;
  office: string;
  unit: string;
  semester: string;
  issue: string;
  // FOR_VERIFICATION: the technician finished and sent their MOV photos; an IT admin approves it (DONE)
  // or returns it (back to IN_PROGRESS). See routes/requests.ts request_finish, verify_mov, return_mov.
  // RATED: done and rated by the requester (utils/ratingSync.ts).
  status: 'PENDING' | 'IN_PROGRESS' | 'FOR_VERIFICATION' | 'DONE' | 'RATED' | 'CANCELLED' | 'DECLINED';
  assigned_to: ObjectId | null;
  finished: 'repaired' | 'beyond repair' | null;
  remarks: string | null;
  recommendation: string | null;
  shared_access?: ObjectId[];
  created_at: Date;
  completed_at: Date | null;
  // The MOV (means of verification) waiting for, or given, approval: photo file names in
  // uploads/requests/<id>/ and who sent them when.
  mov?: MovSubmission | null;
  mov_verified_by?: ObjectId | null;
  mov_verified_at?: Date | null;
  // Earlier submissions an IT admin sent back, with the reason (their photos stay on disk).
  mov_returns?: Array<MovSubmission & { returned_by: ObjectId; returned_at: Date; reason: string }>;
}

export interface MovSubmission {
  files: string[];
  submitted_by: ObjectId;
  submitted_at: Date;
}

export interface MultimediaRequest extends DeclineAndNotes, PriorityAndDue {
  _id?: ObjectId;
  request_code: string;
  created_by: ObjectId;
  assigned_to: ObjectId | null;
  event_title: string;
  event_date: Date;
  event_start_time: string;
  event_end_time: string;
  specific_location: string;
  location_type: 'Within the LGU Solano Compound' | 'Within Solano, but outside the LGU Solano Compound' | 'Within Nueva Vizcaya, but outside Solano' | 'Outside of Nueva Vizcaya';
  contact_number: string;
  program_file: string | null;
  status: 'UNASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'RATED' | 'CANCELLED' | 'DECLINED';
  remarks: string | null;
  recommendation: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface DigitalMediaRequest extends DeclineAndNotes, PriorityAndDue {
  _id?: ObjectId;
  request_code: string;
  created_by: ObjectId;
  assigned_to: ObjectId | null;
  description: string;
  form_of_digital_media: string;
  digital_media_description: string;
  event_ppa_name: string;
  target_date: Date;
  target_time: string;
  requestor_name: string;
  requestor_contact: string;
  supporting_files: string[];
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'RATED' | 'CANCELLED' | 'DECLINED';
  remarks: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface AuditLog {
  _id?: ObjectId;
  timestamp: Date;
  user_id: ObjectId;
  username: string;
  role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  metadata?: Record<string, unknown>;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

// One row per recipient, so read state is per user.
export interface Notification {
  _id?: ObjectId;
  user_id: ObjectId;
  level: NotificationLevel;
  title: string;
  message: string;
  // In-app path the notification opens, e.g. '/requested'.
  link: string | null;
  request_code: string | null;
  // Set on "request completed" notifications so the requester can open the rating form straight from it.
  rate?: NotificationRate | null;
  read_at: Date | null;
  created_at: Date;
}

export interface NotificationRate {
  request_id: string;
  type: string; // the rating system's request type, e.g. 'it_request'
}

export interface PrintMaterialsRequest extends DeclineAndNotes, PriorityAndDue {
  _id?: ObjectId;
  request_code: string;
  created_by: ObjectId;
  assigned_to: ObjectId | null;
  form_of_printed_media: string;
  size_of_printed_media: string;
  printed_media_description: string;
  event_ppa_name: string;
  target_date: Date;
  target_time: string;
  requestor_name: string;
  requestor_contact: string;
  supporting_files: string[];
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'RATED' | 'CANCELLED' | 'DECLINED';
  remarks: string | null;
  created_at: Date;
  completed_at: Date | null;
}

// Names printed on the signature lines of the Daily Accomplishment Report.
export interface Signatories {
  supervisor_name: string;
  supervisor_position: string;
  mayor_name: string;
  updated_at?: Date;
  updated_by?: string;
}

// App-wide settings, one document per setting keyed by name.
export interface SettingDoc {
  _id: string;
  value: Signatories;
}

let client: MongoClient;
let db: Db;
let redisClient: RedisClientType | null = null;

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || 'itrs';
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// True once connectDB() has succeeded. Until then `db` is unset, so the API answers 503 (index.ts).
let dbReady = false;
let resolveClient: (c: MongoClient) => void;
// Resolves with the connected client; the session store waits on it instead of opening its own
// connection, which would fail for good if MongoDB was still starting when the backend did.
export const mongoClientReady = new Promise<MongoClient>((resolve) => { resolveClient = resolve; });

export function isDBReady(): boolean {
  return dbReady;
}

/** True when MongoDB answers a ping within timeoutMs. Used by /api/health. */
export async function pingDB(timeoutMs = 2000): Promise<boolean> {
  if (!dbReady) return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const ping = db.command({ ping: 1 }).then(() => true, () => false);
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Connects once; throws if MongoDB is unreachable. index.ts retries until it succeeds. */
export async function connectDB(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB || 'itrs';
  if (!mongoUri || mongoUri === '') {
    throw new Error('MONGO_URI environment variable is required');
  }
  const candidate = new MongoClient(mongoUri);
  try {
    await candidate.connect();
  } catch (error) {
    await candidate.close().catch(() => {});
    throw error;
  }
  client = candidate;
  db = client.db(dbName);
  dbReady = true;
  resolveClient(client);

  // Migrate users: add roles[] and primary_role from existing role field
  try {
    const usersCollection = db.collection<User>('users');
    await usersCollection.updateMany(
      { roles: { $exists: false } },
      [{ $set: { roles: ['$role'], primary_role: '$role' } }]
    );
  } catch (e) {
    console.error('Migration error:', e);
  }

  await createIndexes();
}

async function createIndexes(): Promise<void> {
  const usersCollection = db.collection<User>('users');
  const requestsCollection = db.collection<Request>('requests');
  const multimediaCollection = db.collection<MultimediaRequest>('multimedia_requests');
  const digitalMediaCollection = db.collection<DigitalMediaRequest>('digital_media_requests');
  const printMaterialsCollection = db.collection<PrintMaterialsRequest>('print_materials_requests');
  
  try {
    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await requestsCollection.createIndex({ request_code: 1 }, { unique: true });
    await requestsCollection.createIndex({ created_by: 1 });
    await requestsCollection.createIndex({ assigned_to: 1 });
    await requestsCollection.createIndex({ status: 1 });
    await requestsCollection.createIndex({ created_at: -1 });
    await requestsCollection.createIndex({ created_at: -1, status: 1, assigned_to: 1 });
    await requestsCollection.createIndex({ status: 1, assigned_to: 1 });
    
    await multimediaCollection.createIndex({ request_code: 1 }, { unique: true });
    await multimediaCollection.createIndex({ created_by: 1 });
    await multimediaCollection.createIndex({ assigned_to: 1 });
    await multimediaCollection.createIndex({ status: 1 });
    await multimediaCollection.createIndex({ created_at: -1 });

    await digitalMediaCollection.createIndex({ request_code: 1 }, { unique: true });
    await digitalMediaCollection.createIndex({ created_by: 1 });
    await digitalMediaCollection.createIndex({ assigned_to: 1 });
    await digitalMediaCollection.createIndex({ status: 1 });
    await digitalMediaCollection.createIndex({ created_at: -1 });

    await printMaterialsCollection.createIndex({ request_code: 1 }, { unique: true });
    await printMaterialsCollection.createIndex({ created_by: 1 });
    await printMaterialsCollection.createIndex({ assigned_to: 1 });
    await printMaterialsCollection.createIndex({ status: 1 });
    await printMaterialsCollection.createIndex({ created_at: -1 });


    const auditCollection = db.collection<AuditLog>('audit_logs');
    await auditCollection.createIndex({ timestamp: -1 });
    await auditCollection.createIndex({ user_id: 1, timestamp: -1 });
    await auditCollection.createIndex({ action: 1, timestamp: -1 });
    await auditCollection.createIndex({ entity_id: 1 });

    const notificationsCollection = db.collection<Notification>('notifications');
    await notificationsCollection.createIndex({ user_id: 1, created_at: -1 });
    await notificationsCollection.createIndex({ user_id: 1, read_at: 1 });
    // Old notifications clean themselves up after 90 days.
    await notificationsCollection.createIndex({ created_at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
  } catch (e) {
    // Indexes may already exist
  }
}

// Redis is shared by every backend process (PM2 runs one per core): it relays Socket.IO events
// between them, holds the login throttle's counters and caches a few lists. Everything falls back
// when it is down: no cache, per-process login counts, and live events only within one process.
let redisEverConnected = false;
let redisErrorLogged = false;

function watchRedis(c: RedisClientType, name: string): RedisClientType {
  // Without an 'error' listener a dropped connection would crash the process. Logged once per outage.
  c.on('error', (err: Error) => {
    if (redisErrorLogged) return;
    redisErrorLogged = true;
    console.error(`Redis (${name}) unavailable: ${err.message}`);
  });
  c.on('ready', () => {
    if (redisErrorLogged) console.log(`Redis (${name}) reconnected`);
    redisErrorLogged = false;
  });
  return c;
}

export async function connectRedis(): Promise<boolean> {
  const c = createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      connectTimeout: 5000,
      // After the first connection, keep retrying (at most every 5 s) through a Redis restart. Before
      // it, give up quickly so a server without Redis still starts.
      reconnectStrategy: (retries: number) =>
        redisEverConnected ? Math.min(250 * (retries + 1), 5000) : retries < 2 ? 500 : new Error('Redis not reachable'),
    },
    // While disconnected, commands fail at once instead of queueing, so requests never wait on Redis.
    disableOfflineQueue: true,
  }) as RedisClientType;
  watchRedis(c, 'main');
  try {
    await c.connect();
    redisEverConnected = true;
    redisClient = c;
    return true;
  } catch {
    redisClient = null;
    return false;
  }
}

/** A connected publisher/subscriber pair for the Socket.IO adapter, or null without Redis. */
export async function createRedisPubSub(): Promise<[RedisClientType, RedisClientType] | null> {
  if (!redisClient) return null;
  const pub = watchRedis(redisClient.duplicate() as RedisClientType, 'pub');
  const sub = watchRedis(redisClient.duplicate() as RedisClientType, 'sub');
  try {
    await Promise.all([pub.connect(), sub.connect()]);
    return [pub, sub];
  } catch (error) {
    console.error('Redis pub/sub connection failed:', error);
    return null;
  }
}

export function getUsersCollection(): Collection<User> {
  return db.collection<User>('users');
}

export function getRequestsCollection(): Collection<Request> {
  return db.collection<Request>('requests');
}

export function getMultimediaRequestsCollection(): Collection<MultimediaRequest> {
  return db.collection<MultimediaRequest>('multimedia_requests');
}

export function getDigitalMediaRequestsCollection(): Collection<DigitalMediaRequest> {
  return db.collection<DigitalMediaRequest>('digital_media_requests');
}

export function getPrintMaterialsRequestsCollection(): Collection<PrintMaterialsRequest> {
  return db.collection<PrintMaterialsRequest>('print_materials_requests');
}

export function getAuditLogsCollection(): Collection<AuditLog> {
  return db.collection<AuditLog>('audit_logs');
}

export function getNotificationsCollection(): Collection<Notification> {
  return db.collection<Notification>('notifications');
}

export function getSettingsCollection(): Collection<SettingDoc> {
  return db.collection<SettingDoc>('settings');
}

export async function logAudit(
  userId: ObjectId,
  username: string,
  role: string,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const auditCollection = getAuditLogsCollection();
    const safeDetails = typeof details === 'string' ? details : JSON.stringify(details);
    await auditCollection.insertOne({
      timestamp: new Date(),
      user_id: userId,
      username,
      role,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: safeDetails,
      metadata: metadata || {}
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// Whether a session may still be used: 'revoked' when the user is gone, unapproved, deactivated, or their access or
// password changed since it started; 'replaced' when the user has since signed in somewhere else.
export type SessionStatus = 'ok' | 'revoked' | 'replaced';

export async function sessionStatus(userId: string | undefined, sessionVersion: number | undefined, sessionId: string | undefined): Promise<SessionStatus> {
  if (!userId || !isValidObjectId(userId)) return 'revoked';
  const user = await getUsersCollection().findOne(
    { _id: new ObjectId(userId) },
    { projection: { session_version: 1, approved: 1, active: 1, current_session: 1 } }
  );
  if (!user || user.approved === false || user.active === false || (user.session_version || 0) !== (sessionVersion || 0)) return 'revoked';
  if (user.current_session && user.current_session !== sessionId) return 'replaced';
  return 'ok';
}

export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

export async function getCache<T>(key: string): Promise<T | null> {
  if (!redisClient) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T, ttl: number = 60): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch {
    // Ignore cache errors
  }
}

/** Drops the cached user lists (routes/users.ts) after any change to a user they show. */
export async function forgetUserLists(): Promise<void> {
  await redisClient?.del(['users:technicians', 'users:all:non-admin']).catch(() => {});
}

export async function generateRequestCode(prefix: string, collectionName?: string): Promise<string> {
  const countersCollection = db.collection<{ _id: string; seq: number }>('counters');
  const year = new Date().getFullYear();
  const counterId = collectionName || `${prefix.toLowerCase()}_counters`;

  const result = await countersCollection.findOneAndUpdate(
    { _id: `${counterId}_${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );

  const seq = result?.value?.seq || 1;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

// Normalizes free text for storage: trimmed and capped at 1000 characters. Text is stored as typed,
// not HTML-escaped; React escapes it on render, and escaping here showed entities such as &#x27;
// to users and in exports. Anything that builds HTML from stored text must escape it itself.
export function sanitizeInput(input: unknown): string {
  return String(input ?? '').trim().slice(0, 1000);
}

export function isValidObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

export { db, client, redisClient };
