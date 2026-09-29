// Slows down password guessing. Only failed logins are counted, so people sharing an office
// network (one public IP) are not blocked by each other's normal use:
// - 5 failures for one username from one IP locks that pair for 15 minutes;
// - 20 failures from one IP across any usernames locks that IP for 15 minutes.
// State is in memory, which is enough for the single backend process PM2 runs.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 20;

interface Counter { count: number; resetAt: number }
const failures = new Map<string, Counter>();

const accountKey = (username: string, ip: string) => `acct:${username.trim().toLowerCase()}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

function current(key: string, now: number): Counter | undefined {
  const c = failures.get(key);
  if (c && c.resetAt <= now) {
    failures.delete(key);
    return undefined;
  }
  return c;
}

// Seconds until the caller may try again, or 0 when not locked.
export function loginRetryAfter(username: string, ip: string, now = Date.now()): number {
  const locked = [current(accountKey(username, ip), now), current(ipKey(ip), now)]
    .filter((c, i): c is Counter => !!c && c.count >= (i === 0 ? MAX_PER_ACCOUNT : MAX_PER_IP));
  if (locked.length === 0) return 0;
  return Math.ceil((Math.max(...locked.map((c) => c.resetAt)) - now) / 1000);
}

export function recordLoginFailure(username: string, ip: string, now = Date.now()): void {
  for (const key of [accountKey(username, ip), ipKey(ip)]) {
    const c = current(key, now);
    if (c) c.count++;
    else failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  }
}

export function recordLoginSuccess(username: string, ip: string): void {
  failures.delete(accountKey(username, ip));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, c] of failures) if (c.resetAt <= now) failures.delete(key);
}, WINDOW_MS).unref();
