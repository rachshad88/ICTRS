import { ObjectId } from 'mongodb';
import { getIO } from '../config/socket';
import { getNotificationsCollection, getUsersCollection, isValidObjectId, Notification, NotificationLevel, NotificationRate, Role } from '../config/database';

type UserRef = string | ObjectId | null | undefined;

// Specific users, or everyone holding one of the given roles.
export type Recipients = UserRef | UserRef[] | { roles: Role[] };

export interface NotificationInput {
  level: NotificationLevel;
  title: string;
  message: string;
  link?: string | null;
  request_code?: string | null;
  rate?: NotificationRate | null;
}

export interface NotificationDTO {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  link: string | null;
  request_code: string | null;
  rate: NotificationRate | null;
  read: boolean;
  created_at: Date;
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  return {
    id: n._id!.toString(),
    level: n.level,
    title: n.title,
    message: n.message,
    link: n.link,
    request_code: n.request_code,
    rate: n.rate ?? null,
    read: n.read_at !== null,
    created_at: n.created_at,
  };
}

async function resolveRecipients(to: Recipients): Promise<string[]> {
  if (to && typeof to === 'object' && 'roles' in to) {
    const users = await getUsersCollection()
      .find({ $or: [{ roles: { $in: to.roles } }, { role: { $in: to.roles } }] }, { projection: { _id: 1 } })
      .toArray();
    return users.map((u) => u._id!.toString());
  }
  const refs = Array.isArray(to) ? to : [to];
  return refs.filter((r): r is string | ObjectId => !!r).map((r) => r.toString());
}

async function deliver(to: Recipients, input: NotificationInput, except?: string): Promise<void> {
  const ids = [...new Set(await resolveRecipients(to))].filter((id) => id !== except && isValidObjectId(id));
  if (ids.length === 0) return;

  const now = new Date();
  const docs: Notification[] = ids.map((id) => ({
    _id: new ObjectId(),
    user_id: new ObjectId(id),
    level: input.level,
    title: input.title,
    message: input.message,
    link: input.link ?? null,
    request_code: input.request_code ?? null,
    rate: input.rate ?? null,
    read_at: null,
    created_at: now,
  }));
  await getNotificationsCollection().insertMany(docs);

  const io = getIO();
  for (const doc of docs) {
    io.to(`user_${doc.user_id.toString()}`).emit('notification:new', toNotificationDTO(doc));
  }
}

// Saves a notification for each recipient and pushes it to their open sessions.
// `except` is the user who caused the event; they already know, so they are skipped.
// Never throws: a failed notification must not fail the request that triggered it.
export function notify(to: Recipients, input: NotificationInput, except?: string): void {
  deliver(to, input, except).catch((error) => {
    console.error('Notification delivery failed:', error);
  });
}
