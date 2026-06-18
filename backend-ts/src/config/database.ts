import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { RedisClientType, createClient } from 'redis';

export const ALL_ROLE_VALUES = ['ADMIN', 'TECHNICIAN', 'CLIENT', 'MULTIMEDIA', 'IT_ADMIN', 'MULTIMEDIA_ADMIN', 'PROGRAMMER'] as const;
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
  created_at?: Date;
}

export interface Request {
  _id?: ObjectId;
  request_code: string;
  created_by: ObjectId;
  office: string;
  unit: string;
  semester: string;
  issue: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  assigned_to: ObjectId | null;
  finished: 'repaired' | 'beyond repair' | null;
  remarks: string | null;
  recommendation: string | null;
  shared_access?: ObjectId[];
  created_at: Date;
  completed_at: Date | null;
}

export interface MultimediaRequest {
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
  status: 'UNASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  remarks: string | null;
  recommendation: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface DigitalMediaRequest {
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
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
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

export interface PrintMaterialsRequest {
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
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  remarks: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface SoftwareRequest {
  _id?: ObjectId;
  request_code: string;
  created_by: ObjectId;
  assigned_to: ObjectId | null;
  reviewed_by: ObjectId | null;
  proposed_title: string;
  client_name_office: string;
  statement_of_problem: string;
  objective: string;
  formal_request_letter: string;
  process_flow: string;
  status: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'NOT_APPROVED' | 'CANCELLED';
  rejection_reason: string | null;
  remarks: string | null;
  created_at: Date;
  completed_at: Date | null;
}

let client: MongoClient;
let db: Db;
let redisClient: RedisClientType | null = null;

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || 'itrs';
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

export async function connectDB(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB || 'itrs';
  if (!mongoUri || mongoUri === '') {
    throw new Error('MONGO_URI environment variable is required');
  }
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  
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

    const softwareCollection = db.collection<SoftwareRequest>('software_requests');
    await softwareCollection.createIndex({ request_code: 1 }, { unique: true });
    await softwareCollection.createIndex({ created_by: 1 });
    await softwareCollection.createIndex({ assigned_to: 1 });
    await softwareCollection.createIndex({ status: 1 });
    await softwareCollection.createIndex({ created_at: -1 });

    const auditCollection = db.collection<AuditLog>('audit_logs');
    await auditCollection.createIndex({ timestamp: -1 });
    await auditCollection.createIndex({ user_id: 1, timestamp: -1 });
    await auditCollection.createIndex({ action: 1, timestamp: -1 });
    await auditCollection.createIndex({ entity_id: 1 });
  } catch (e) {
    // Indexes may already exist
  }
}

export async function connectRedis(): Promise<boolean> {
  try {
    redisClient = createClient({
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        connectTimeout: 5000
      }
    });
    await redisClient.connect();
    return true;
  } catch {
    redisClient = null;
    return false;
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

export function getSoftwareRequestsCollection(): Collection<SoftwareRequest> {
  return db.collection<SoftwareRequest>('software_requests');
}

export function getAuditLogsCollection(): Collection<AuditLog> {
  return db.collection<AuditLog>('audit_logs');
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

export function sanitizeInput(input: string): string {
  return input.trim().slice(0, 1000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function isValidObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

export { db, client, redisClient };
