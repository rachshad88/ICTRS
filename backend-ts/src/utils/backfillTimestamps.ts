import { Collection, ObjectId } from 'mongodb';
import {
  getAuditLogsCollection,
  getDigitalMediaRequestsCollection,
  getMultimediaRequestsCollection,
  getPrintMaterialsRequestsCollection,
  getRequestsCollection,
} from '../config/database';

// Requests made before accepted_at and cancelled_at existed (2026-10-09) only have those moments in
// the audit log. Copy them onto the requests once, so their progress shows real times. Runs at
// startup and only touches requests that lack the field, so later runs find nothing to do. A
// request with no matching log entry gets null, which marks it as checked.

const SOURCES: Array<{ entityType: string; getCollection: () => Collection<any> }> = [
  { entityType: 'IT_REQUEST', getCollection: getRequestsCollection },
  { entityType: 'MULTIMEDIA', getCollection: getMultimediaRequestsCollection },
  { entityType: 'DIGITAL_MEDIA', getCollection: getDigitalMediaRequestsCollection },
  { entityType: 'PRINT_MATERIALS', getCollection: getPrintMaterialsRequestsCollection },
];

const STEPS = [
  // Accepted: anything that has left the waiting state. The first accept/assign wins over later reassignments.
  { field: 'accepted_at', actions: ['ACCEPT_REQUEST', 'ASSIGN_REQUEST'], filter: { status: { $nin: ['PENDING', 'UNASSIGNED'] } } },
  { field: 'cancelled_at', actions: ['CANCEL_REQUEST'], filter: { status: 'CANCELLED' } },
];

/** Earliest log time per request id for these actions. */
async function firstLogged(entityType: string, actions: string[], ids: string[]): Promise<Map<string, Date>> {
  const rows = await getAuditLogsCollection()
    .aggregate<{ _id: string; at: Date }>([
      { $match: { entity_type: entityType, action: { $in: actions }, entity_id: { $in: ids } } },
      { $group: { _id: '$entity_id', at: { $min: '$timestamp' } } },
    ])
    .toArray();
  return new Map(rows.map((r) => [r._id, r.at]));
}

export async function backfillRequestTimestamps(): Promise<void> {
  let filled = 0;
  for (const { entityType, getCollection } of SOURCES) {
    const collection = getCollection();
    for (const step of STEPS) {
      const missing = await collection
        .find({ ...step.filter, [step.field]: { $exists: false } }, { projection: { _id: 1 } })
        .toArray();
      if (missing.length === 0) continue;

      const times = await firstLogged(entityType, step.actions, missing.map((d) => d._id.toString()));
      await collection.bulkWrite(
        missing.map((d: { _id: ObjectId }) => ({
          updateOne: {
            filter: { _id: d._id, [step.field]: { $exists: false } },
            update: { $set: { [step.field]: times.get(d._id.toString()) ?? null } },
          },
        })),
      );
      filled += times.size;
    }
  }
  if (filled > 0) console.log(`Filled in ${filled} accepted/cancelled times from the audit log`);
}
