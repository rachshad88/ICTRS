import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { IDLE_LIMIT_MS, IDLE_WARN_MS, lastActivity, markActive } from '../services/idle';

// Signs the user out after an hour without real activity, warning two minutes before. Socket
// events make open pages refetch on their own, so the server alone cannot tell an unattended
// screen from a busy one; this counts only what the person does. The server's own one-hour
// rolling cookie (backend index.ts) is the backstop for closed browsers and sleeping PCs.

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const RECORD_EVERY_MS = 15_000;
const CHECK_EVERY_MS = 30_000;
// While someone is active, keep the server session alive even if the page makes no requests
// (a long form being typed), so the submit does not land on an expired session.
const KEEPALIVE_EVERY_MS = 10 * 60 * 1000;

function IdleLogout() {
  const { logout } = useAuth();
  const [warning, setWarning] = useState(false);
  // Fallback for when localStorage is unavailable.
  const local = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const signingOut = useRef(false);
  // logout is a new function on every AuthProvider render; the timers should not restart with it.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const since = () => Date.now() - (lastActivity() ?? local.current);

    const signOut = async () => {
      if (signingOut.current) return;
      signingOut.current = true;
      try {
        await logoutRef.current();
      } catch {
        // The server session lapses by itself within the hour.
      }
      window.location.assign('/login?idle=1');
    };

    const check = () => {
      const idle = since();
      if (idle >= IDLE_LIMIT_MS) signOut();
      else setWarning(idle >= IDLE_WARN_MS);
    };

    // Reopened after the limit (another tab, or a PC that slept): sign out now. Otherwise this
    // mount (a sign-in or a page opened) counts as activity.
    if (since() >= IDLE_LIMIT_MS && lastActivity() !== null) {
      signOut();
      return;
    }
    markActive();

    let recorded = Date.now();
    const onActivity = () => {
      const now = Date.now();
      local.current = now;
      if (now - recorded < RECORD_EVERY_MS) return;
      recorded = now;
      markActive(now);
      setWarning(false);
      if (now - lastPing.current >= KEEPALIVE_EVERY_MS) {
        lastPing.current = now;
        api.get('/auth/me').catch(() => {});
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, []);

  if (!warning) return null;

  const stay = () => {
    const now = Date.now();
    local.current = now;
    markActive(now);
    setWarning(false);
  };

  return (
    <div className="modal confirm-modal">
      <div className="modal-content confirm-content" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-message">
        <h3 id="idle-title">Still there?</h3>
        <p id="idle-message" className="confirm-message">
          You have been inactive for almost an hour. You will be signed out in 2 minutes.
        </p>
        <div className="modal-actions">
          <button data-modal-dismiss type="button" className="btn-primary" onClick={stay} autoFocus>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}

export default IdleLogout;
