import { AnyBulkWriteOperation, Db, ObjectId } from 'mongodb';
import { client, db, logAudit } from '../config/database';
import { getIO } from '../config/socket';

/**
 * The link with the client satisfaction (CSF) rating system, through the shared database RATING_DB
 * (default "itrs_rating"). See deploy/RATING_DB.md.
 *
 *  1. When a request is completed, ITRS copies it into `requests` there as { request_code, status: 'DONE' }
 *     (copyCompleted, right after finishing; backfillCompleted at startup and every BACKFILL_MS, which also
 *     copies requests finished before this existed and repairs a missed write).
 *  2. After the client rates it, the CSF sets that row's status to 'RATED'.
 *  3. ITRS checks for rated rows every PULL_MS (pullRatings) and marks its own request RATED.
 *
 * ITRS only ever inserts rows ($setOnInsert), so it never undoes the CSF's 'RATED'. And it only takes a
 * request from DONE to RATED, whatever else the CSF might write. Failures are logged and swallowed: the
 * link must never break finishing a request.
 */

const RATING_DB = process.env.RATING_DB || 'itrs_rating';
const COPIES = 'requests';
const BACKFILL_MS = 10 * 60 * 1000;
const PULL_MS = 15 * 1000;

// ITRS collection -> the `type` the Rate button sends to the rating system.
const REQUEST_TYPES: Record<string, string> = {
  requests: 'it_request',
  multimedia_requests: 'multimedia',
  digital_media_requests: 'digital_media',
  print_materials_requests: 'print_materials',
};

// Where to tell the screens that a request was rated: IT requests use request_update, the media
// services their own `<prefix>_request_*` events (frontend services/queryClient.ts).
const SOCKET_PREFIX: Record<string, string> = {
  multimedia_requests: 'multimedia',
  digital_media_requests: 'digital_media',
  print_materials_requests: 'print_materials',
};
const AUDIT_ENTITY: Record<string, string> = {
  requests: 'IT_REQUEST',
  multimedia_requests: 'MULTIMEDIA',
  digital_media_requests: 'DIGITAL_MEDIA',
  print_materials_requests: 'PRINT_MATERIALS',
};

// The rating system's `type` for a request stored in the given ITRS collection.
export function ratingTypeFor(collectionName: string): string | undefined {
  return REQUEST_TYPES[collectionName];
}

/** A request's row in the rating database: its code and status, nothing else. */
export interface RatingCopy {
  request_code: string;
  status: 'DONE' | 'RATED' | string;
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

const insertOnly = (request_code: string): AnyBulkWriteOperation<RatingCopy> => ({
  updateOne: {
    filter: { request_code },
    update: { $setOnInsert: { request_code, status: 'DONE' } },
    upsert: true,
  },
});

/** Copies a just-completed request into the rating database. Fire and forget: `void copyCompleted(...)`. */
export async function copyCompleted(collectionName: string, requestId: string | ObjectId | null | undefined): Promise<void> {
  const target = ratingDb();
  if (!target || !requestId || !REQUEST_TYPES[collectionName]) return;
  try {
    const _id = typeof requestId === 'string' ? new ObjectId(requestId) : requestId;
    const request = await db.collection(collectionName).findOne({ _id, status: 'DONE' }, { projection: { request_code: 1 } });
    if (!request?.request_code) return;
    await target.collection<RatingCopy>(COPIES).bulkWrite([insertOnly(request.request_code)]);
    disabledLogged = false;
  } catch (error) {
    logFailure(`copying ${collectionName} ${String(requestId)}`, error);
  }
}

/**
 * Takes a reopened request back out of the rating database, so it can't be rated while being worked on
 * again; finishing it copies it back. A row the CSF already marked RATED stays.
 */
export async function removeCopy(requestCode: string | null | undefined): Promise<void> {
  const target = ratingDb();
  if (!target || !requestCode) return;
  try {
    await target.collection<RatingCopy>(COPIES).deleteOne({ request_code: requestCode, status: 'DONE' });
  } catch (error) {
    logFailure(`removing ${requestCode}`, error);
  }
}

/** Copies every completed request that isn't in the rating database yet. Never changes a row there. */
export async function backfillCompleted(): Promise<void> {
  const target = ratingDb();
  if (!target) return;
  try {
    const copies = target.collection<RatingCopy>(COPIES);
    await copies.createIndex({ request_code: 1 }, { unique: true });
    const have = new Set<string>();
    for await (const row of copies.find({}, { projection: { _id: 0, request_code: 1 } })) have.add(row.request_code);

    const ops: AnyBulkWriteOperation<RatingCopy>[] = [];
    for (const collectionName of Object.keys(REQUEST_TYPES)) {
      for await (const r of db.collection(collectionName).find({ status: 'DONE' }, { projection: { request_code: 1 } })) {
        if (r.request_code && !have.has(r.request_code)) ops.push(insertOnly(r.request_code));
      }
    }
    if (ops.length > 0) {
      await copies.bulkWrite(ops, { ordered: false });
      console.log(`Rating sync: copied ${ops.length} completed request(s) into "${RATING_DB}"`);
    }
    disabledLogged = false;
  } catch (error) {
    logFailure('backfill', error);
  }
}

// Codes already marked RATED in ITRS, so each check only looks at new ones.
const applied = new Set<string>();

/** Marks requests RATED in ITRS once the CSF has set their row to RATED. */
export async function pullRatings(): Promise<void> {
  const target = ratingDb();
  if (!target) return;
  try {
    const rated: string[] = [];
    for await (const row of target.collection<RatingCopy>(COPIES).find({ status: 'RATED' }, { projection: { _id: 0, request_code: 1 } })) {
      if (typeof row.request_code === 'string' && !applied.has(row.request_code)) rated.push(row.request_code);
    }
    if (rated.length === 0) return;

    for (const collectionName of Object.keys(REQUEST_TYPES)) {
      const collection = db.collection(collectionName);
      // Already RATED (e.g. marked before a restart): nothing to do, just remember them.
      for await (const r of collection.find({ request_code: { $in: rated }, status: 'RATED' }, { projection: { request_code: 1 } })) {
        applied.add(r.request_code);
      }
      for await (const r of collection.find({ request_code: { $in: rated }, status: 'DONE' }, { projection: { request_code: 1, created_by: 1 } })) {
        const now = new Date();
        const res = await collection.updateOne({ _id: r._id, status: 'DONE' }, { $set: { status: 'RATED', rated_at: now } });
        applied.add(r.request_code);
        if (res.modifiedCount === 0) continue;
        await logAudit(
          r.created_by instanceof ObjectId ? r.created_by : new ObjectId(),
          'Rating system', 'SYSTEM', 'RATE_REQUEST', AUDIT_ENTITY[collectionName], r._id.toHexString(),
          `${r.request_code} was rated by its requester`,
        );
        tellScreens(collectionName, r._id.toHexString(), r.request_code, r.created_by?.toString());
      }
    }
    disabledLogged = false;
  } catch (error) {
    logFailure('checking ratings', error);
  }
}

function tellScreens(collectionName: string, requestId: string, requestCode: string, ownerId?: string) {
  let io;
  try { io = getIO(); } catch { return; }
  if (!io) return;
  const owner = ownerId ? [`user_${ownerId}`] : [];
  const payload = { request_id: requestId, request_code: requestCode, status: 'RATED' };
  const prefix = SOCKET_PREFIX[collectionName];
  if (prefix) {
    io.to(['admins', 'multimedia_staff', ...owner]).emit(`${prefix}_request_rated`, payload);
  } else {
    io.to(['technicians', 'super_admins', ...owner]).emit('request_update', { event: 'rated', ...payload, timestamp: new Date() });
  }
}

/** Starts the startup copy, the periodic repair and the rating check. Call once after connectDB(). */
export function startRatingSync(): void {
  if (process.env.RATING_SYNC === 'off') return;
  void backfillCompleted().then(pullRatings);
  setInterval(() => { void backfillCompleted(); }, BACKFILL_MS).unref();
  setInterval(() => { void pullRatings(); }, PULL_MS).unref();
}
