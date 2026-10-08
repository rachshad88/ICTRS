import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_OUT, prefersReducedMotion } from '../lib/motion';
import { playWelcomeIn, playWelcomeOut, type CueHandle } from '../services/sfx';

// The welcome curtain played after a successful sign-in: two staggered layers of columns
// (seal yellow, then ink) close over the login page, the user is greeted by name while the
// app loads underneath, then the columns lift away to reveal their dashboard.

type Phase = 'idle' | 'in' | 'out';

interface LoginTransitionApi {
  play: (firstName: string, onCovered: () => void) => void;
}

const LoginTransitionContext = createContext<LoginTransitionApi | undefined>(undefined);

const GEAR_PATH = 'M77.8 -18.7 L98.8 -15.6 L98.8 15.6 L77.8 18.7 L68.2 41.8 L80.9 58.8 L58.8 80.9 L41.8 68.2 L18.7 77.8 L15.6 98.8 L-15.6 98.8 L-18.7 77.8 L-41.8 68.2 L-58.8 80.9 L-80.9 58.8 L-68.2 41.8 L-77.8 18.7 L-98.8 15.6 L-98.8 -15.6 L-77.8 -18.7 L-68.2 -41.8 L-80.9 -58.8 L-58.8 -80.9 L-41.8 -68.2 L-18.7 -77.8 L-15.6 -98.8 L15.6 -98.8 L18.7 -77.8 L41.8 -68.2 L58.8 -80.9 L80.9 -58.8 L68.2 -41.8 Z';

const COLUMNS = 6;
const COL_DURATION = 0.55;
const COL_STAGGER = 0.05;
const LAYER_GAP = 0.12;
// When the ink layer has fully closed (last column + layer offset).
const COVERED_AT = (COL_DURATION + COL_STAGGER * (COLUMNS - 1) + LAYER_GAP) * 1000;
const HOLD_MS = 1250;
const OUT_MS = (COL_DURATION + COL_STAGGER * (COLUMNS - 1) + LAYER_GAP) * 1000;

const GRANTED = 'ACCESS GRANTED';

export function LoginTransitionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [name, setName] = useState('');
  const timers = useRef<number[]>([]);
  const covered = useRef(false);
  const onCoveredRef = useRef<() => void>(() => {});
  const sound = useRef<CueHandle | null>(null);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const reveal = useCallback(() => {
    clearTimers();
    // Skipped early: cut the greeting's sounds short so they don't ring over the dashboard.
    sound.current?.stop(0.2);
    playWelcomeOut();
    setPhase('out');
    timers.current.push(window.setTimeout(() => setPhase('idle'), OUT_MS + 100));
  }, []);

  const cover = useCallback(() => {
    if (covered.current) return;
    covered.current = true;
    onCoveredRef.current();
  }, []);

  const play = useCallback((firstName: string, onCovered: () => void) => {
    if (prefersReducedMotion()) {
      onCovered();
      return;
    }
    clearTimers();
    covered.current = false;
    onCoveredRef.current = onCovered;
    setName(firstName);
    setPhase('in');
    sound.current = playWelcomeIn();
    timers.current.push(window.setTimeout(cover, COVERED_AT));
    timers.current.push(window.setTimeout(reveal, COVERED_AT + HOLD_MS));
  }, [cover, reveal]);

  // Any key or click skips straight to the reveal once the page underneath has switched.
  useEffect(() => {
    if (phase !== 'in') return;
    const skip = () => {
      if (!covered.current) return;
      reveal();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [phase, reveal]);

  useEffect(() => clearTimers, []);

  return (
    <LoginTransitionContext.Provider value={{ play }}>
      {children}
      {phase !== 'idle' && createPortal(<Curtain phase={phase} name={name} />, document.body)}
    </LoginTransitionContext.Provider>
  );
}

export function useLoginTransition() {
  const ctx = useContext(LoginTransitionContext);
  if (!ctx) throw new Error('useLoginTransition must be used within LoginTransitionProvider');
  return ctx;
}

function Columns({ layer, phase }: { layer: 'yellow' | 'ink'; phase: Phase }) {
  const closing = phase === 'in';
  // The yellow layer leads on the way in and trails on the way out, so it peeks out both times.
  const layerDelay = closing ? (layer === 'ink' ? LAYER_GAP : 0) : (layer === 'yellow' ? LAYER_GAP : 0);

  return (
    <div className={`lt-columns lt-columns-${layer}`} aria-hidden="true">
      {Array.from({ length: COLUMNS }, (_, i) => {
        // Close right-to-left, lift left-to-right: the wipe keeps travelling the same way.
        const order = closing ? COLUMNS - 1 - i : i;
        return (
          <motion.span
            key={i}
            className="lt-col"
            style={{ transformOrigin: closing ? '50% 100%' : '50% 0%' }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: closing ? 1 : 0 }}
            transition={{ duration: COL_DURATION, delay: layerDelay + order * COL_STAGGER, ease: [0.76, 0, 0.24, 1] }}
          />
        );
      })}
    </div>
  );
}

function Curtain({ phase, name }: { phase: Phase; name: string }) {
  return (
    <div className="lt-root" role="status" aria-live="polite">
      <Columns layer="yellow" phase={phase} />
      <Columns layer="ink" phase={phase} />

      <AnimatePresence>
        {phase === 'in' && (
          <motion.div
            className="lt-stage"
            exit={{ opacity: 0, y: -40, transition: { duration: 0.35, ease: [0.7, 0, 0.84, 0] } }}
          >
            <motion.svg
              className="lt-gear"
              viewBox="-110 -110 220 220"
              aria-hidden="true"
              initial={{ rotate: -90, scale: 0.6, opacity: 0 }}
              animate={{ rotate: 45, scale: 1, opacity: 1 }}
              transition={{ duration: 2.4, delay: 0.45, ease: EASE_OUT }}
            >
              <path d={GEAR_PATH} />
              <circle r="38" />
            </motion.svg>

            <motion.div
              className="lt-seal"
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.7 }}
            >
              <img src="/solano-logo.png" alt="" />
            </motion.div>

            <p className="lt-granted" aria-label={GRANTED}>
              {GRANTED.split('').map((ch, i) => (
                <motion.span
                  key={i}
                  aria-hidden="true"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.85 + i * 0.025, ease: EASE_OUT }}
                >
                  {ch === ' ' ? ' ' : ch}
                </motion.span>
              ))}
            </p>

            <h2 className="lt-hello">
              <span className="lt-mask">
                <motion.span
                  initial={{ y: '110%' }}
                  animate={{ y: '0%' }}
                  transition={{ duration: 0.7, delay: 0.95, ease: EASE_OUT }}
                >
                  Good Day,
                </motion.span>
              </span>
              <span className="lt-mask lt-name-mask">
                <motion.span
                  className="lt-name"
                  initial={{ y: '110%', rotate: 6 }}
                  animate={{ y: '0%', rotate: -3 }}
                  transition={{ duration: 0.8, delay: 1.1, ease: EASE_OUT }}
                >
                  {name || 'there'}!
                </motion.span>
              </span>
            </h2>

            <svg className="lt-underline" viewBox="0 0 300 24" fill="none" aria-hidden="true">
              <motion.path
                d="M6 16 C 60 6, 120 4, 170 10 S 260 20, 294 8"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.7, delay: 1.45, ease: EASE_OUT }}
              />
            </svg>

            <div className="lt-loading">
              <span>Opening your desk</span>
              <span className="lt-bar">
                <motion.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: (COVERED_AT + HOLD_MS) / 1000 - 1.1, delay: 1.1, ease: 'linear' }}
                />
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
