import { Router, Request, Response, NextFunction } from 'express';
import { BlockList, isIPv4, isIPv6 } from 'net';
import { Collection, ObjectId } from 'mongodb';
import { Server } from 'socket.io';
import {
  getRequestsCollection,
  getMultimediaRequestsCollection,
  getDigitalMediaRequestsCollection,
  getPrintMaterialsRequestsCollection,
  getUsersCollection
} from '../config/database';
import { getIO } from '../config/socket';
import { normalizePriority, toDay } from '../utils/priority';

// Public, read-only queue of requests still waiting for assignment, shown on the wall display at /live.
// There is no login, so every endpoint here is limited to client addresses in LIVE_ALLOWED_CIDRS.

export type LiveLane = 'it' | 'multimedia' | 'digital_media' | 'print_materials';
export type LiveOutcome = 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

interface LaneDef {
  getCollection: () => Collection<any>;
  summary: (doc: any) => string;
  dueField: string;
}

const LANES: Record<LiveLane, LaneDef> = {
  it: { getCollection: getRequestsCollection, summary: (d) => d.issue, dueField: 'due_date' },
  multimedia: { getCollection: getMultimediaRequestsCollection, summary: (d) => d.event_title, dueField: 'event_date' },
  digital_media: { getCollection: getDigitalMediaRequestsCollection, summary: (d) => d.description, dueField: 'target_date' },
  print_materials: {
    getCollection: getPrintMaterialsRequestsCollection,
    summary: (d) => [d.form_of_printed_media, d.event_ppa_name].filter(Boolean).join(' · '),
    dueField: 'target_date'
  }
};

// Waiting means not yet assigned. Multimedia requests start UNASSIGNED; the other types start PENDING.
const WAITING_STATUSES = ['PENDING', 'UNASSIGNED'];

function isWaiting(doc: any): boolean {
  return WAITING_STATUSES.includes(doc?.status) && !doc?.assigned_to;
}

export interface LiveCard {
  id: string;
  lane: LiveLane;
  request_code: string;
  priority: string;
  summary: string;
  requester: string;
  office: string;
  due: string | null;
  created_at: string;
}

async function toCards(lane: LiveLane, docs: any[]): Promise<LiveCard[]> {
  const ownerIds = [...new Set(docs.map((d) => d.created_by?.toString()).filter(Boolean))];
  const owners = ownerIds.length
    ? await getUsersCollection()
        .find({ _id: { $in: ownerIds.map((id) => new ObjectId(id)) } }, { projection: { first_name: 1, last_name: 1, office: 1 } })
        .toArray()
    : [];
  const ownerById = new Map(owners.map((u) => [u._id.toString(), u]));

  return docs.map((d) => {
    const owner = ownerById.get(d.created_by?.toString());
    const accountName = owner ? `${owner.first_name || ''} ${owner.last_name || ''}`.trim() : '';
    return {
      id: d._id.toString(),
      lane,
      request_code: d.request_code || '',
      priority: normalizePriority(d.priority),
      summary: LANES[lane].summary(d) || '',
      // Digital media and print forms name the requesting person, who may not be the account holder.
      requester: d.requestor_name || accountName,
      office: d.office || owner?.office || '',
      due: toDay(d[LANES[lane].dueField]),
      created_at: new Date(d.created_at).toISOString()
    };
  });
}

// --- LAN allowlist ---------------------------------------------------------------------------

let allowlist: BlockList | null | undefined;

// LIVE_ALLOWED_CIDRS is a comma-separated list such as "192.168.110.0/24,10.0.0.5".
// Unset or empty allows nobody, so a missing setting never makes the feed public.
function getAllowlist(): BlockList | null {
  if (allowlist !== undefined) return allowlist;
  const entries = (process.env.LIVE_ALLOWED_CIDRS || '').split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) {
    console.warn('LIVE_ALLOWED_CIDRS is not set; the /live display is disabled.');
    allowlist = null;
    return allowlist;
  }
  const list = new BlockList();
  for (const entry of entries) {
    const [address, bits] = entry.split('/');
    const type = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
    const maxBits = type === 'ipv4' ? 32 : 128;
    const prefix = bits === undefined ? maxBits : Number(bits);
    if (!type || !Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) {
      console.warn(`LIVE_ALLOWED_CIDRS: ignoring invalid entry "${entry}"`);
      continue;
    }
    list.addSubnet(address, prefix, type);
  }
  allowlist = list;
  return allowlist;
}

// "::ffff:192.168.110.5" is how Node reports an IPv4 client on a dual-stack socket.
function normalizeAddress(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped ? mapped[1] : address;
}

function isLoopback(address: string): boolean {
  return address === '::1' || /^127\./.test(address);
}

// Matches req.ip under index.ts's 'trust proxy' = 'loopback': X-Forwarded-For is believed only when the
// connection comes from this machine (nginx or the Vite proxy), so a remote client cannot fake it.
// Socket.IO handshakes are plain Node requests without req.ip, so both paths use this.
function clientAddress(remote: string | undefined, forwardedFor: string | string[] | undefined): string {
  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor || '')
    .split(',')
    .map((a) => normalizeAddress(a.trim()))
    .filter(Boolean)
    .reverse();
  let address = normalizeAddress(remote || '');
  for (const hop of forwarded) {
    if (!isLoopback(address)) break;
    address = hop;
  }
  return address;
}

function isAllowedClient(remote: string | undefined, forwardedFor: string | string[] | undefined): boolean {
  const list = getAllowlist();
  if (!list) return false;
  const address = clientAddress(remote, forwardedFor);
  const type = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
  return type !== null && list.check(address, type);
}

function lanOnly(req: Request, res: Response, next: NextFunction) {
  if (!isAllowedClient(req.socket.remoteAddress, req.headers['x-forwarded-for'])) {
    return res.status(403).json({ status: 'error', message: 'The live display is only available on the office network.' });
  }
  next();
}

// --- HTTP ------------------------------------------------------------------------------------

const router = Router();

router.get('/queue', lanOnly, async (_req: Request, res: Response) => {
  try {
    const lanes = Object.keys(LANES) as LiveLane[];
    const results = await Promise.all(lanes.map(async (lane) => {
      const docs = await LANES[lane].getCollection()
        .find({ status: { $in: WAITING_STATUSES }, assigned_to: null })
        .sort({ created_at: 1 })
        .limit(500)
        .toArray();
      return [lane, await toCards(lane, docs)] as const;
    }));
    res.json({ status: 'success', server_time: new Date().toISOString(), lanes: Object.fromEntries(results) });
  } catch (error) {
    console.error('Live queue error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the queue' });
  }
});

export default router;

// --- Socket.IO -------------------------------------------------------------------------------

const NAMESPACE = '/live';

// The /live namespace skips the login check on the default namespace; the allowlist replaces it.
// Clients only listen: the namespace registers no handlers for anything they send.
export function registerLiveNamespace(io: Server) {
  io.of(NAMESPACE).use((socket, next) => {
    if (isAllowedClient(socket.request.socket.remoteAddress, socket.request.headers['x-forwarded-for'])) {
      next();
    } else {
      next(new Error('Forbidden'));
    }
  });
}

// The emitters below run after the response is on its way; a failure is logged and never reaches the caller.
function emit(event: string, build: () => Promise<unknown> | unknown) {
  Promise.resolve()
    .then(build)
    .then((payload) => { if (payload) getIO().of(NAMESPACE).emit(event, payload); })
    .catch((error) => console.error(`Live ${event} error:`, error));
}

// A new request entered the queue. It is read back here, off the request's path.
export function liveRequestAdded(lane: LiveLane, requestId: ObjectId) {
  emit('live:added', async () => {
    const doc = await LANES[lane].getCollection().findOne({ _id: requestId });
    return isWaiting(doc) ? { card: (await toCards(lane, [doc]))[0] } : null;
  });
}

// A waiting request changed (e.g. its priority) and is still waiting.
export function liveRequestChanged(lane: LiveLane, doc: any) {
  emit('live:changed', async () => (isWaiting(doc) ? { card: (await toCards(lane, [doc]))[0] } : null));
}

// A request left the queue. The display ignores ids it is not showing, so callers need not check.
export function liveRequestRemoved(lane: LiveLane, requestId: string, outcome: LiveOutcome, by: string | null = null) {
  emit('live:removed', () => ({ lane, id: requestId, outcome, by }));
}
