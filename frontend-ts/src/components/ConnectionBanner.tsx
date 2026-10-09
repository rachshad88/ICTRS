import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';
import { isConnectionUp, onConnectionChange } from '../services/socket';

// A dropped live connection usually comes back within a second or two (a server restart, a Wi-Fi
// blip), so only say something once it has stayed down this long. The browser reporting itself
// offline is shown at once: that one is certain.
const GRACE_MS = 4000;
const BACK_MS = 2500;

type Shown = 'offline' | 'reconnecting' | 'back' | null;

/** A slim strip at the top of the screen while the network or the live connection is down. */
function ConnectionBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [socketUp, setSocketUp] = useState(isConnectionUp);
  const [shown, setShown] = useState<Shown>(null);
  const wasShown = useRef(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const unsubscribe = onConnectionChange(setSocketUp);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    if (!online) {
      setShown('offline');
    } else if (!socketUp) {
      timer = window.setTimeout(() => setShown('reconnecting'), wasShown.current ? 0 : GRACE_MS);
    } else if (wasShown.current) {
      setShown('back');
      timer = window.setTimeout(() => setShown(null), BACK_MS);
    } else {
      setShown(null);
    }
    return () => window.clearTimeout(timer);
  }, [online, socketUp]);

  useEffect(() => {
    if (shown === 'offline' || shown === 'reconnecting') wasShown.current = true;
    else if (shown === null) wasShown.current = false;
  }, [shown]);

  const text =
    shown === 'offline' ? "You're offline. Changes won't save until the connection is back."
    : shown === 'reconnecting' ? 'Lost connection to ITRS. Reconnecting…'
    : 'Back online.';

  return (
    <div className="conn-banner-slot" role="status" aria-live="polite">
      <AnimatePresence>
        {shown && (
          <motion.div
            key="banner"
            className={`conn-banner is-${shown}`}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
          >
            <span className="conn-banner-dot" aria-hidden="true" />
            {text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ConnectionBanner;
