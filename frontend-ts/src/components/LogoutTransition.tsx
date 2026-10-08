import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { EASE_OUT, prefersReducedMotion } from '../lib/motion';
import { playGoodbyeIn, playSwitchOff, type CueHandle } from '../services/sfx';

// The sign-out ceremony, deliberately unlike the sign-in curtain: a dark iris grows out of
// the button that was clicked, says goodbye, then the whole screen switches off like an old
// CRT monitor (collapse to a line, then a dot) before fading up on the login page.

type Phase = 'idle' | 'iris' | 'off' | 'fade';

interface LogoutTransitionApi {
  signOut: (e?: { clientX: number; clientY: number }) => void;
}

const LogoutTransitionContext = createContext<LogoutTransitionApi | undefined>(undefined);

const IRIS_S = 0.75;
const HOLD_MS = 1500;
const OFF_S = 0.55;
const FADE_S = 0.5;

export function LogoutTransitionProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const timers = useRef<number[]>([]);
  const running = useRef(false);
  const sound = useRef<CueHandle | null>(null);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const finish = useCallback(async () => {
    try {
      await logout();
    } catch {
      // The session cookie may already be gone; the login page is still the right place.
    }
    navigate('/login');
  }, [logout, navigate]);

  const switchOff = useCallback(() => {
    clearTimers();
    // The tube's hum dies with the picture.
    sound.current?.stop(0.12);
    playSwitchOff();
    setPhase('off');
    timers.current.push(window.setTimeout(async () => {
      await finish();
      setPhase('fade');
      timers.current.push(window.setTimeout(() => {
        setPhase('idle');
        running.current = false;
      }, FADE_S * 1000 + 50));
    }, OFF_S * 1000 + 150));
  }, [finish]);

  const signOut = useCallback((e?: { clientX: number; clientY: number }) => {
    if (running.current) return;
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    running.current = true;
    clearTimers();
    setOrigin(e ? { x: e.clientX, y: e.clientY } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setName(user?.first_name || '');
    setTime(new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }));
    setPhase('iris');
    // Pan the opening swell toward the side of the screen the click came from.
    sound.current = playGoodbyeIn(e ? (e.clientX / window.innerWidth) * 1.2 - 0.6 : 0);
    timers.current.push(window.setTimeout(switchOff, IRIS_S * 1000 + HOLD_MS));
  }, [finish, switchOff, user]);

  // Any key or click once the goodbye is up cuts straight to the switch-off.
  useEffect(() => {
    if (phase !== 'iris') return;
    const start = performance.now();
    const skip = () => {
      if (performance.now() - start > IRIS_S * 1000) switchOff();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [phase, switchOff]);

  useEffect(() => clearTimers, []);

  return (
    <LogoutTransitionContext.Provider value={{ signOut }}>
      {children}
      {phase !== 'idle' && createPortal(<Goodbye phase={phase} origin={origin} name={name} time={time} />, document.body)}
    </LogoutTransitionContext.Provider>
  );
}

export function useLogoutTransition() {
  const ctx = useContext(LogoutTransitionContext);
  if (!ctx) throw new Error('useLogoutTransition must be used within LogoutTransitionProvider');
  return ctx;
}

function Goodbye({ phase, origin, name, time }: { phase: Phase; origin: { x: number; y: number }; name: string; time: string }) {
  const at = `${origin.x}px ${origin.y}px`;
  const off = phase === 'off' || phase === 'fade';

  return (
    <motion.div
      className="lo-root"
      role="status"
      aria-live="polite"
      animate={{ opacity: phase === 'fade' ? 0 : 1 }}
      transition={{ duration: FADE_S, ease: 'easeOut' }}
    >
      {/* Black glass behind the "tube", only needed once it starts collapsing */}
      {off && <div className="lo-glass" />}

      <motion.div
        className="lo-screen"
        initial={{ clipPath: `circle(0px at ${at})` }}
        animate={
          off
            ? {
                clipPath: `circle(150% at ${at})`,
                scaleY: [1, 0.004, 0.004],
                scaleX: [1, 1, 0],
                backgroundColor: ['#0c1f4a', '#cfdcff', '#ffffff'],
              }
            : { clipPath: `circle(150% at ${at})` }
        }
        transition={
          off
            ? { duration: OFF_S, times: [0, 0.55, 1], ease: [0.7, 0, 0.84, 0] }
            : { duration: IRIS_S, ease: [0.65, 0, 0.35, 1] }
        }
      >
        <div className="lo-scanlines" aria-hidden="true" />

        <motion.div
          className="lo-content"
          animate={{ opacity: off ? 0 : 1 }}
          transition={{ duration: off ? 0.15 : 0 }}
        >
          <svg className="lo-power" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <motion.path
              d="M15.5 13.5 A 14 14 0 1 0 32.5 13.5"
              initial={{ pathLength: 0, rotate: -90 }}
              animate={{ pathLength: 1, rotate: 0 }}
              transition={{ duration: 0.9, delay: 0.45, ease: EASE_OUT }}
            />
            <motion.path
              d="M24 8 L24 24"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, delay: 1.0, ease: EASE_OUT }}
            />
          </svg>

          <motion.p
            className="lo-meta"
            initial={{ opacity: 0, letterSpacing: '0.6em' }}
            animate={{ opacity: 1, letterSpacing: '0.28em' }}
            transition={{ duration: 0.9, delay: 0.55, ease: EASE_OUT }}
          >
            Signed out{time ? ` · ${time}` : ''}
          </motion.p>

          <h2 className="lo-bye">
            <motion.span
              className="lo-bye-see"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, delay: 0.7, ease: EASE_OUT }}
            >
              See you,
            </motion.span>
            <motion.span
              className="lo-bye-name"
              initial={{ opacity: 0, x: -24, filter: 'blur(12px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.8, delay: 0.9, ease: EASE_OUT }}
            >
              {name || 'friend'}
            </motion.span>
          </h2>

          <motion.p
            className="lo-note"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.25, ease: EASE_OUT }}
          >
            Your session is closed. Salamat po!
          </motion.p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
