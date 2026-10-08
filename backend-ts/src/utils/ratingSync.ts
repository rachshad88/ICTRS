import { AnyBulkWriteOperation, Db, ObjectId } from 'mongodb';
import { client, db } from '../config/database';

/**
 * Keeps the shared rating database (RATING_DB, default "itrs_rating") in step with request statuses.
 * The client satisfaction (rating) system reads `request_status` to see which requests exist and are DONE,
 * and stores its own ratings in `ratings`; ITRS never touches that collection. See deploy/RATING_DB.md.
 *
 * ITRS writes here in two ways:
 *  - syncRatingStatus() right after a request's status changes, so a just-finished request can be rated at once;
 *  - reconcileRatingStatus() at startup and every RECONCILE_MS, which re-copies every request. That fills the
 *    database the first time and repairs anything a failed or missed write left behind.
 * Failures are logged and swallowed: rating sync must never break submitting or finishing a request.
 */

const RATING_DB = process.env.RATING_DB || 'itrs_rating';
const STATUS_COLLECTION = 'request_status';
const RECONCILE_MS = 10 * 60 * 1000;

// ITRS collection -> the `type` the Rate button sends to the rating system.
const REQUEST_TYPES: Record<string, string> = {
  requests: 'it_request',
  multimedia_requests: 'multimedia',
  digital_media_requests: 'digital_media',
  print_materials_requests: 'print_materials',
};

// The rating system's `type` for a request stored in the given ITRS collection.
export function ratingTypeFor(collectionName: string): string | undefined {
  return REQUEST_TYPES[collectionName];
}

export interface RequestStatusDoc {
  _id: string; // the request's ObjectId as hex, same as request_id
  request_id: string;
  request_code: string;
  type: string;
  status: string;
  updated_at: Date;
}

let disabledLogged = false;

function ratingDb(): Db | null {
  if (process.env.RATING_SYNC === 'off' || !client || !db) return null;
  return client.db(RATING_DB);
}

function logFailure(action: string, error: unknown) {
  const code = (error as { code?: number }).code;
  if (code === 13 /* Unauthorized */) {
    if (!disabledLogged) {
      disabledLogged = true;
      console.warn(
        `Rating sync: no access to the "${RATING_DB}" database yet. Run deploy/rating-db-setup.js as a MongoDB admin ` +
        '(see deploy/RATING_DB.md). ITRS keeps working; the rating database fills on the next sync after that.'
      );
    }
    return;
  }
  console.error(`Rating sync: ${action} failed:`, error);
}

function toStatusDoc(collectionName: string, request: { _id: ObjectId; request_code: string; status: string }): RequestStatusDoc {
  const id = request._id.toHexString();
  return {
    _id: id,
    request_id: id,
    request_code: request.request_code,
    type: REQUEST_TYPES[collectionName],
    status: request.status,
    updated_at: new Date(),
  };
}

/**
 * Copies one request's current status into the rating database. Call after any write that changes status
 * (create, assign, finish, cancel, decline). Fire and forget: `void syncRatingStatus(...)`.
 */
export async function syncRatingStatus(collectionName: string, requestId: string | ObjectId | null | undefined): Promise<void> {
  const target = ratingDb();
  if (!target || !requestId || !REQUEST_TYPES[collectionName]) return;
  try {
    const _id = typeof requestId === 'string' ? new ObjectId(requestId) : requestId;
    const request = await db.collection(collectionName).findOne(
      { _id },
      { projection: { request_code: 1, status: 1 } }
    );
    if (!request) return;
    const { _id: statusId, ...fields } = toStatusDoc(collectionName, request as never);
    await target.collection<RequestStatusDoc>(STATUS_COLLECTION).updateOne({ _id: statusId }, { $set: fields }, { upsert: true });
    disabledLogged = false;
  } catch (error) {
    logFailure(`syncing ${collectionName} ${String(requestId)}`, error);
  }
}

/** Re-copies every request's status. Only writes rows whose status or code changed. */
export async function reconcileRatingStatus(): Promise<void> {
  const target = ratingDb();
  if (!target) return;
  try {
    const statuses = target.collection<RequestStatusDoc>(STATUS_COLLECTION);
    await statuses.createIndex({ request_code: 1 });

    const existing = new Map<string, { status: string; request_code: string }>();
    for await (const row of statuses.find({}, { projection: { status: 1, request_code: 1 } })) {
      existing.set(row._id, row);
    }

    const ops: AnyBulkWriteOperation<RequestStatusDoc>[] = [];
    for (const collectionName of Object.keys(REQUEST_TYPES)) {
      const cursor = db.collection(collectionName).find({}, { projection: { request_code: 1, status: 1 } });
      for await (const request of cursor) {
        const { _id: statusId, ...fields } = toStatusDoc(collectionName, request as never);
        const current = existing.get(statusId);
        if (current && current.status === fields.status && current.request_code === fields.request_code) continue;
        ops.push({ updateOne: { filter: { _id: statusId }, update: { $set: fields }, upsert: true } });
      }
    }
    if (ops.length > 0) {
      await statuses.bulkWrite(ops, { ordered: false });
      console.log(`Rating sync: updated ${ops.length} request status record(s) in "${RATING_DB}"`);
    }
    disabledLogged = false;
  } catch (error) {
    logFailure('reconcile', error);
  }
}

/** Starts the startup copy and the periodic repair. Call once after connectDB(). */
export function startRatingSync(): void {
  if (process.env.RATING_SYNC === 'off') return;
  void reconcileRatingStatus();
  setInterval(() => { void reconcileRatingStatus(); }, RECONCILE_MS).unref();
}
