// Slows down password guessing. Only failed logins are counted. Office PCs each have their own
// LAN address, so "IP" here means one computer:
// - 5 failures for one username from one IP locks that IP (every username) for 15 minutes, so
//   trying another name doesn't get round it;
// - 10 failures from one IP across any usernames also locks it for 15 minutes.
// State is in memory, which is enough for the single backend process PM2 runs.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 10;

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
  // A locked username locks the whole computer, for as long as that username's lock lasts.
  const account = current(accountKey(username, ip), now)!;
  if (account.count >= MAX_PER_ACCOUNT) {
    const ipCounter = current(ipKey(ip), now)!;
    ipCounter.count = Math.max(ipCounter.count, MAX_PER_IP);
    ipCounter.resetAt = Math.max(ipCounter.resetAt, account.resetAt);
  }
}

export function recordLoginSuccess(username: string, ip: string): void {
  failures.delete(accountKey(username, ip));
}

// Self sign-up: at most MAX_SIGNUPS_PER_IP new accounts per IP per hour, so one machine cannot
// flood the user list. Counts successful sign-ups only.
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const MAX_SIGNUPS_PER_IP = 5;
const signupKey = (ip: string) => `signup:${ip}`;

export function signupRetryAfter(ip: string, now = Date.now()): number {
  const c = current(signupKey(ip), now);
  if (!c || c.count < MAX_SIGNUPS_PER_IP) return 0;
  return Math.ceil((c.resetAt - now) / 1000);
}

export function recordSignup(ip: string, now = Date.now()): void {
  const c = current(signupKey(ip), now);
  if (c) c.count++;
  else failures.set(signupKey(ip), { count: 1, resetAt: now + SIGNUP_WINDOW_MS });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, c] of failures) if (c.resetAt <= now) failures.delete(key);
}, WINDOW_MS).unref();
