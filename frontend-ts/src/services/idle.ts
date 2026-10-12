// Last real activity (mouse, keys, touch, scroll) of the signed-in user, shared by every open tab
// through localStorage, so an idle sign-out happens in all tabs together (components/IdleLogout.tsx).

export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const IDLE_WARN_MS = IDLE_LIMIT_MS - 2 * 60 * 1000;

const KEY = 'itrs:lastActivity';

export function lastActivity(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function markActive(at = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    // Storage blocked (private window): each tab keeps its own clock in IdleLogout instead.
  }
}

/** Forget the clock on sign-in and sign-out, so the next account does not inherit an old value. */
export function clearActivity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
