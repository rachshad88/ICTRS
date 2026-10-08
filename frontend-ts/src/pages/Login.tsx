import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TransitionLink } from '../components/PageCurtain';
import { useAuth, type User } from '../contexts/AuthContext';
import { useLoginTransition } from '../components/LoginTransition';
import { EASE_OUT } from '../lib/motion';
import { playApprovedStamp, playDenied } from '../services/sfx';
import { DecodeText, useRevealDelay } from '../components/Entrance';
import axios from 'axios';

const GEAR_PATH = 'M77.8 -18.7 L98.8 -15.6 L98.8 15.6 L77.8 18.7 L68.2 41.8 L80.9 58.8 L58.8 80.9 L41.8 68.2 L18.7 77.8 L15.6 98.8 L-15.6 98.8 L-18.7 77.8 L-41.8 68.2 L-58.8 80.9 L-80.9 58.8 L-68.2 41.8 L-77.8 18.7 L-98.8 15.6 L-98.8 -15.6 L-77.8 -18.7 L-68.2 -41.8 L-80.9 -58.8 L-58.8 -80.9 L-41.8 -68.2 L-18.7 -77.8 L-15.6 -98.8 L15.6 -98.8 L18.7 -77.8 L41.8 -68.2 L58.8 -80.9 L80.9 -58.8 L68.2 -41.8 Z';

// What people can request through ITRS; shown as stamped tags beside the form (desktop only).
const SERVICES = [
  { title: 'IT Support', icon: 'M2 3h20v14H2z M8 21h8 M12 17v4' },
  { title: 'Multimedia Coverage', icon: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
  { title: 'Digital Media', icon: 'M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21' },
  { title: 'Print Materials', icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z' },
];

function homeFor(user: User) {
  const primary = user.primary_role || user.role;
  if (primary === 'CLIENT') return '/request';
  if (primary === 'MULTIMEDIA') return '/multimedia-dashboard';
  return '/dashboard';
}

// After too many wrong passwords the server pauses sign-in from this computer, for every
// username (backend loginThrottle.ts), and says for how long (Retry-After). Remember it so the
// button stays disabled with a countdown, even after a reload or with another username.
const LOCK_KEY = 'itrs-login-lock';
interface LoginLock { until: number }
function readLock(): LoginLock | null {
  try {
    const lock = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null') as LoginLock | null;
    return lock && lock.until > Date.now() ? lock : null;
  } catch {
    return null;
  }
}
function saveLock(lock: LoginLock | null) {
  try {
    if (lock) localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
    else localStorage.removeItem(LOCK_KEY);
  } catch {
    /* storage unavailable: the lock still holds until the page is reloaded */
  }
}
const formatWait = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// How long the stamp gets to land on the ticket before the curtain closes.
const STAMP_BEAT_MS = 750;

const CREDIT = '© 2026 Dave Shadrach B. Lannu · v1.0.0';

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((p, i) => <path key={i} d={i === 0 ? p : 'M' + p} />)}
    </svg>
  );
}

const rise = {
  hidden: { y: '105%' },
  visible: (delay: number) => ({ y: '0%', transition: { duration: 0.75, delay, ease: EASE_OUT } }),
};

// The sign-in entrance follows the safe-dial transition: the headline cracks its code, the ticket
// swings open like a vault door, and the fields drop into place like lock pins.
const pin = {
  hidden: { opacity: 0, y: -18 },
  visible: (delay: number) => ({ opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 520, damping: 17, delay } }),
};

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showResetHelp, setShowResetHelp] = useState(false);
  const [granted, setGranted] = useState(false);
  const [lock, setLock] = useState<LoginLock | null>(readLock);
  const [now, setNow] = useState(() => Date.now());
  const { login, user } = useAuth();
  const { play } = useLoginTransition();
  const signingIn = useRef(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const usernameRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  // Waits for the safe dial (or the sign-out fade) to open before the entrance plays.
  const d = useRevealDelay('login');

  useEffect(() => {
    if (searchParams.get('expired') === '1') {
      setSessionExpired(true);
      setTimeout(() => setSessionExpired(false), 4000);
    }
    usernameRef.current?.focus();
  }, []);

  // Already signed in (e.g. opened /login directly): skip the ceremony. A fresh sign-in
  // navigates from handleSubmit once the welcome curtain has covered the page.
  useEffect(() => {
    if (user && !signingIn.current) navigate(homeFor(user));
  }, [user, navigate]);

  // Tick once a second while a lock is active; drop it when the wait is over.
  useEffect(() => {
    if (!lock) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lock]);
  useEffect(() => {
    if (lock && lock.until <= now) {
      setLock(null);
      saveLock(null);
    }
  }, [lock, now]);
  const lockedFor = lock ? Math.max(0, Math.ceil((lock.until - now) / 1000)) : 0;

  const handleCapsLock = (e: React.KeyboardEvent) => {
    setCapsLock(e.getModifierState('CapsLock'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockedFor > 0) return;
    setError('');
    setSessionExpired(false);
    setLoading(true);
    signingIn.current = true;

    try {
      const me = await login(username, password);
      if (!me) throw new Error('No user returned');
      saveLock(null);
      setGranted(true);
      playApprovedStamp();
      window.setTimeout(() => {
        play(me.first_name, () => navigate(homeFor(me)));
      }, STAMP_BEAT_MS);
    } catch (err: unknown) {
      playDenied();
      signingIn.current = false;
      if (axios.isAxiosError(err) && err.response) {
        const status = err.response.status;
        const msg = err.response.data?.error;
        if (status === 429) {
          const seconds = Number(err.response.headers['retry-after']) || 15 * 60;
          const next = { until: Date.now() + seconds * 1000 };
          setLock(next);
          setNow(Date.now());
          saveLock(next);
        } else if (msg) {
          setError(msg);
        } else {
          setError('Login failed. Please try again.');
        }
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container" style={{ '--intro-delay': `${d}s` } as React.CSSProperties}>
      <svg className="login-gear" viewBox="-110 -110 220 220" aria-hidden="true" focusable="false">
        <path d={GEAR_PATH} />
        <circle r="38" />
      </svg>

      <header className="login-topbar">
        <TransitionLink to="/" className="login-brand">
          <img src="/solano-logo.png" alt="" />
          <span>ITRS</span>
        </TransitionLink>
        <TransitionLink to="/" className="login-back-link">
          <Icon d="M19 12H5 M12 19l-7-7 7-7" size={16} />
          Go to landing page
        </TransitionLink>
      </header>

      <div className="login-layout">
        <section className="login-intro">
          <motion.p
            className="login-place"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: d }}
          >
            Municipality of Solano, Nueva Vizcaya
          </motion.p>
          <h1 className="login-headline" aria-label="Welcome back.">
            <span className="login-line" aria-hidden="true">
              <motion.span custom={d + 0.05} variants={rise} initial="hidden" animate="visible">
                <DecodeText text="Welcome" delay={d + 0.05} duration={0.85} />
              </motion.span>
            </span>
            <span className="login-line" aria-hidden="true">
              <motion.span custom={d + 0.15} variants={rise} initial="hidden" animate="visible">
                <span className="login-highlight"><DecodeText text="back." delay={d + 0.3} duration={0.6} /></span>
              </motion.span>
            </span>
          </h1>
          <motion.p
            className="login-lede"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: d + 0.5, ease: EASE_OUT }}
          >
            Report IT problems, book event coverage, order digital and print materials, and follow each request to done.
          </motion.p>

          <motion.ul
            className="login-services"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.07, delayChildren: d + 0.7 } } }}
          >
            {SERVICES.map((svc) => (
              <motion.li
                key={svc.title}
                className="login-service"
                variants={{ hidden: { opacity: 0, scale: 1.25 }, visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 24 } } }}
              >
                <Icon d={svc.icon} size={16} />
                {svc.title}
              </motion.li>
            ))}
          </motion.ul>

          <p className="login-credit">{CREDIT}</p>
        </section>

        <main className="login-ticket-wrap">
          {/* Swings open on its left edge like a vault door */}
          <motion.div
            className="login-ticket"
            style={{ transformOrigin: '0% 50%', transformPerspective: 1600 }}
            initial={{ opacity: 0, rotateY: -78, x: -24 }}
            animate={
              granted
                ? { opacity: 1, rotateY: 0, x: 0, scale: [1, 0.96, 1.015, 1], transition: { scale: { duration: 0.45, delay: 0.12, ease: EASE_OUT } } }
                : { opacity: 1, rotateY: 0, x: 0, scale: 1 }
            }
            transition={{ type: 'spring', stiffness: 60, damping: 13, delay: d + 0.15, opacity: { duration: 0.3, delay: d + 0.15 } }}
          >
            <AnimatePresence>
              {granted && (
                <motion.div
                  className="login-granted"
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: 2.8, rotate: -26 }}
                  animate={{ opacity: 1, scale: 1, rotate: -11 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 26, mass: 0.8 }}
                >
                  <motion.span
                    className="login-granted-ring"
                    initial={{ opacity: 0.6, scale: 0.9 }}
                    animate={{ opacity: 0, scale: 1.7 }}
                    transition={{ duration: 0.6, delay: 0.1, ease: EASE_OUT }}
                  />
                  <span className="login-granted-word">Approved</span>
                  <span className="login-granted-meta">Access granted · {new Date().toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="login-ticket-head">
              <img src="/solano-logo.png" alt="" />
              <span>ITRS sign-in</span>
              <span className="login-ticket-tag">LGU Solano</span>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="login-ticket-body">
                <div className="login-form-header">
                  <h2>Sign in</h2>
                  <p>Use the username and password from the IT Section.</p>
                </div>

                {sessionExpired && (
                  <div className="login-info-message" role="status">
                    <span className="login-stamp">Expired</span>
                    Your session has expired. Please sign in again.
                  </div>
                )}

                {lockedFor > 0 ? (
                  <div className="error-message" role="alert">
                    Too many failed sign-in attempts from this computer, so sign-in is paused for a few minutes. If
                    you forgot your password, ask the IT section to reset it.
                  </div>
                ) : (
                  error && <div className="error-message" role="alert">{error}</div>
                )}

                <motion.div className="form-group" custom={d + 0.55} variants={pin} initial="hidden" animate="visible">
                  <label htmlFor="username">Username</label>
                  <div className="input-wrapper">
                    <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <input
                      ref={usernameRef}
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      required
                      autoComplete="username"
                    />
                  </div>
                </motion.div>

                <motion.div className="form-group" custom={d + 0.67} variants={pin} initial="hidden" animate="visible">
                  <label htmlFor="password">Password</label>
                  <div className="input-wrapper">
                    <svg className="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={handleCapsLock}
                      onKeyDown={handleCapsLock}
                      placeholder="Enter your password"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {capsLock && (
                    <div className="capslock-warning">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      Caps Lock is on
                    </div>
                  )}
                </motion.div>

                <motion.div className="form-options" custom={d + 0.79} variants={pin} initial="hidden" animate="visible">
                  <button
                    type="button"
                    className="forgot-password"
                    aria-expanded={showResetHelp}
                    aria-controls="reset-help"
                    onClick={() => setShowResetHelp((v) => !v)}
                  >
                    Forgot password?
                  </button>
                </motion.div>
                <AnimatePresence initial={false}>
                  {showResetHelp && (
                    <motion.div
                      id="reset-help"
                      className="login-reset-help"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0, transition: { duration: 0.45, ease: EASE_OUT } }}
                      transition={{ duration: reduceMotion ? 0 : 0.9, ease: EASE_OUT }}
                    >
                      <motion.div
                        className="login-reset-card"
                        initial={{ clipPath: 'inset(0 100% 0 0)' }}
                        animate={{ clipPath: 'inset(0 0% 0 0)' }}
                        transition={{ duration: reduceMotion ? 0 : 1.1, delay: reduceMotion ? 0 : 0.15, ease: EASE_OUT }}
                      >
                        <svg className="login-reset-key" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <motion.circle
                            cx="16" cy="32" r="9"
                            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                            transition={{ duration: reduceMotion ? 0 : 0.9, delay: 0.5, ease: EASE_OUT }}
                          />
                          <motion.path
                            d="M23 25 L41 7 M34 14 L39 19 M29 19 L33 23"
                            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                            transition={{ duration: reduceMotion ? 0 : 1.1, delay: 0.9, ease: EASE_OUT }}
                          />
                        </svg>
                        <div className="login-reset-text">
                          {[
                            <strong key="a">Need a new password?</strong>,
                            <span key="b">Ask the Information and Technology Section (Mayor&apos;s Office), 2nd floor of the Municipal Hall, to reset it.</span>,
                            <span key="c">You&apos;ll choose a new one when you sign in.</span>,
                          ].map((line, i) => (
                            <span className="login-reset-line" key={i}>
                              <motion.span
                                initial={{ y: '110%' }}
                                animate={{ y: '0%' }}
                                transition={{ duration: reduceMotion ? 0 : 0.8, delay: reduceMotion ? 0 : 0.9 + i * 0.3, ease: EASE_OUT }}
                              >
                                {line}
                              </motion.span>
                            </span>
                          ))}
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="login-ticket-tear" aria-hidden="true" />

              <motion.div
                className="login-ticket-stub"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: d + 0.95, ease: EASE_OUT }}
              >
                <button type="submit" className={`btn-primary ${granted ? 'is-granted' : ''}`} disabled={loading || granted || lockedFor > 0}>
                  {lockedFor > 0 ? (
                    <span className="btn-loading">Try again in {formatWait(lockedFor)}</span>
                  ) : granted ? (
                    <span className="btn-loading">
                      <Icon d="M20 6L9 17l-5-5" />
                      Welcome in
                    </span>
                  ) : loading ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      Signing in...
                    </span>
                  ) : (
                    <span className="btn-loading">
                      Sign In
                      <Icon d="M5 12h14 M13 6l6 6-6 6" />
                    </span>
                  )}
                </button>
                <div className="login-or" aria-hidden="true"><span>New to ITRS?</span></div>
                <TransitionLink to="/signup" className="login-signup-btn">
                  Sign up for a client account
                </TransitionLink>
                <p className="login-guide-link">
                  Not sure how it works? <TransitionLink to="/guide">Read the client guide</TransitionLink>
                </p>
              </motion.div>
            </form>
          </motion.div>

          <p className="login-mobile-footer">{CREDIT}</p>
        </main>
      </div>
    </div>
  );
}

export default Login;
