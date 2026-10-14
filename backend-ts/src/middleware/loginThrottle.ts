import { getRedisClient } from '../config/database';

// Slows down password guessing. Only failed logins are counted. Office PCs each have their own
// LAN address, so "IP" here means one computer:
// - 5 failures for one username from one IP locks that IP (every username) for 15 minutes, so
//   trying another name doesn't get round it;
// - 10 failures from one IP across any usernames also locks it for 15 minutes.
// Counters live in Redis, shared by every backend process (PM2 runs one per core), so guesses
// spread over the processes still add up. While Redis is down each process counts in memory.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 10;

interface Counter { count: number; resetAt: number }

const accountKey = (username: string, ip: string) => `acct:${username.trim().toLowerCase()}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

// ----- Counter store: Redis when it is up, else this process's memory -----

const failures = new Map<string, Counter>();
const redisKey = (key: string) => `login:${key}`;

function redis() {
  const c = getRedisClient();
  return c?.isReady ? c : null;
}

function memoryRead(key: string, now: number): Counter | undefined {
  const c = failures.get(key);
  if (c && c.resetAt <= now) {
    failures.delete(key);
    return undefined;
  }
  return c;
}

async function read(key: string, now: number): Promise<Counter | undefined> {
  const r = redis();
  if (r) {
    try {
      const [count, ttl] = (await r.multi().get(redisKey(key)).pTTL(redisKey(key)).exec()) as unknown as [string | null, number];
      return count === null || ttl <= 0 ? undefined : { count: Number(count), resetAt: now + ttl };
    } catch {
      // fall back to memory
    }
  }
  return memoryRead(key, now);
}

/** Adds one, starting a window of windowMs on the first count. */
async function bump(key: string, windowMs: number, now: number): Promise<Counter> {
  const r = redis();
  if (r) {
    try {
      const k = redisKey(key);
      const [count, , ttl] = (await r.multi().incr(k).pExpire(k, windowMs, 'NX').pTTL(k).exec()) as unknown as [number, number, number];
      return { count, resetAt: now + Math.max(ttl, 0) };
    } catch {
      // fall back to memory
    }
  }
  const c = memoryRead(key, now);
  if (c) {
    c.count++;
    return c;
  }
  const fresh = { count: 1, resetAt: now + windowMs };
  failures.set(key, fresh);
  return fresh;
}

/** Raises a counter to at least `count`, lasting until at least `resetAt`. */
async function raise(key: string, current: Counter, count: number, resetAt: number, now: number): Promise<void> {
  const r = redis();
  if (r) {
    try {
      const k = redisKey(key);
      const tx = r.multi();
      if (current.count < count) tx.set(k, String(count), { KEEPTTL: true });
      if (current.resetAt < resetAt) tx.pExpire(k, resetAt - now);
      await tx.exec();
      return;
    } catch {
      // fall back to memory
    }
  }
  const c = memoryRead(key, now) ?? current;
  c.count = Math.max(c.count, count);
  c.resetAt = Math.max(c.resetAt, resetAt);
  failures.set(key, c);
}

async function remove(key: string): Promise<void> {
  failures.delete(key);
  await redis()?.del(redisKey(key)).catch(() => {});
}

// ----- Sign-in -----

// Seconds until the caller may try again, or 0 when not locked.
export async function loginRetryAfter(username: string, ip: string, now = Date.now()): Promise<number> {
  const [account, machine] = await Promise.all([read(accountKey(username, ip), now), read(ipKey(ip), now)]);
  const locked = [account && account.count >= MAX_PER_ACCOUNT ? account : null, machine && machine.count >= MAX_PER_IP ? machine : null]
    .filter((c): c is Counter => !!c);
  if (locked.length === 0) return 0;
  return Math.ceil((Math.max(...locked.map((c) => c.resetAt)) - now) / 1000);
}

export async function recordLoginFailure(username: string, ip: string, now = Date.now()): Promise<void> {
  const [account, machine] = await Promise.all([bump(accountKey(username, ip), WINDOW_MS, now), bump(ipKey(ip), WINDOW_MS, now)]);
  // A locked username locks the whole computer, for as long as that username's lock lasts.
  if (account.count >= MAX_PER_ACCOUNT) {
    await raise(ipKey(ip), machine, MAX_PER_IP, account.resetAt, now);
  }
}

export async function recordLoginSuccess(username: string, ip: string): Promise<void> {
  await remove(accountKey(username, ip));
}

// ----- Self sign-up -----
// At most MAX_SIGNUPS_PER_IP new accounts per IP per hour, so one machine cannot flood the user
// list. Counts successful sign-ups only.
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const MAX_SIGNUPS_PER_IP = 5;
const signupKey = (ip: string) => `signup:${ip}`;

export async function signupRetryAfter(ip: string, now = Date.now()): Promise<number> {
  const c = await read(signupKey(ip), now);
  if (!c || c.count < MAX_SIGNUPS_PER_IP) return 0;
  return Math.ceil((c.resetAt - now) / 1000);
}

export async function recordSignup(ip: string, now = Date.now()): Promise<void> {
  await bump(signupKey(ip), SIGNUP_WINDOW_MS, now);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, c] of failures) if (c.resetAt <= now) failures.delete(key);
}, WINDOW_MS).unref();
