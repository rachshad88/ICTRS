import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { TransitionLink } from '../components/PageCurtain';
import { useAuth } from '../contexts/AuthContext';
import { useLoginTransition } from '../components/LoginTransition';
import { EASE_OUT } from '../lib/motion';
import { playApprovedStamp, playDenied } from '../services/sfx';
import { OFFICES } from '../data/offices';
import { useRevealDelay } from '../components/Entrance';
import OfficePicker from '../components/OfficePicker';

const GEAR_PATH = 'M77.8 -18.7 L98.8 -15.6 L98.8 15.6 L77.8 18.7 L68.2 41.8 L80.9 58.8 L58.8 80.9 L41.8 68.2 L18.7 77.8 L15.6 98.8 L-15.6 98.8 L-18.7 77.8 L-41.8 68.2 L-58.8 80.9 L-80.9 58.8 L-68.2 41.8 L-77.8 18.7 L-98.8 15.6 L-98.8 -15.6 L-77.8 -18.7 L-68.2 -41.8 L-80.9 -58.8 L-58.8 -80.9 L-41.8 -68.2 L-18.7 -77.8 L-15.6 -98.8 L15.6 -98.8 L18.7 -77.8 L41.8 -68.2 L58.8 -80.9 L80.9 -58.8 L68.2 -41.8 Z';

// Every new account starts on this password and must change it right after signing up.
// Matches DEFAULT_PASSWORD in backend-ts/src/routes/auth.ts.
const DEFAULT_PASSWORD = '12345';

// Matches signupSchema on the backend.
const USERNAME_PATTERN = '[A-Za-z0-9._\\-]{3,30}';

const STAMP_BEAT_MS = 750;
const CREDIT = '© 2026 Dave Shadrach B. Lannu · v1.0.0';

const STEPS = [
  'Fill in your details and pick your office.',
  `You are signed in with the starting password ${DEFAULT_PASSWORD}.`,
  'Choose your own password, then file requests.',
];

// The sign-up entrance follows the registration-slip transition: the headline is inked in like a
// stamp, the steps are written in, and the form prints out under a glowing print head.
const ink = {
  hidden: { opacity: 0, scale: 1.3, filter: 'blur(10px)' },
  visible: (delay: number) => ({ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.65, delay, ease: EASE_OUT } }),
};

// The form prints top to bottom while the paper feeds down out of the "printer".
const PRINT_S = 1.25;
const PRINT_EASE = [0.45, 0, 0.25, 1] as const;
// Clipped a little outside the ticket so its shadow and edges are not cut off once printed.
const PRINT_FROM = 'inset(-10% -10% 100% -10%)';
const PRINT_TO = 'inset(-10% -10% -20% -10%)';

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((p, i) => <path key={i} d={i === 0 ? p : 'M' + p} />)}
    </svg>
  );
}

function Signup() {
  const [form, setForm] = useState({ username: '', first_name: '', middle_name: '', last_name: '', office: '', position: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [granted, setGranted] = useState(false);
  const [printed, setPrinted] = useState(false);
  const { signup, user } = useAuth();
  const { play } = useLoginTransition();
  const signingUp = useRef(false);
  const navigate = useNavigate();
  const usernameRef = useRef<HTMLInputElement>(null);
  // Waits for the registration slip to tear open before the entrance plays.
  const d = useRevealDelay('signup');

  // Focus the first field once it has printed.
  useEffect(() => {
    const t = window.setTimeout(() => usernameRef.current?.focus(), (d + 0.5) * 1000);
    return () => window.clearTimeout(t);
  }, [d]);

  // Already signed in: there is nothing to sign up for. ProtectedRoute sends them on from /request.
  useEffect(() => {
    if (user && !signingUp.current) navigate('/request', { replace: true });
  }, [user, navigate]);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    signingUp.current = true;

    try {
      const me = await signup(form);
      if (!me) throw new Error('No user returned');
      setGranted(true);
      playApprovedStamp();
      window.setTimeout(() => {
        play(me.first_name, () => navigate('/profile'));
      }, STAMP_BEAT_MS);
    } catch (err: unknown) {
      playDenied();
      signingUp.current = false;
      if (axios.isAxiosError(err) && err.response) {
        const data = err.response.data;
        setError(data?.details?.[0]?.message || data?.error || 'Sign up failed. Please try again.');
      } else {
        setError('Sign up failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container signup-page" style={{ '--intro-delay': `${d}s` } as React.CSSProperties}>
      <svg className="login-gear" viewBox="-110 -110 220 220" aria-hidden="true" focusable="false">
        <path d={GEAR_PATH} />
        <circle r="38" />
      </svg>

      <header className="login-topbar">
        <TransitionLink to="/" className="login-brand">
          <img src="/solano-logo.png" alt="" />
          <span>ITRS</span>
        </TransitionLink>
        <TransitionLink to="/login" className="login-back-link">
          <Icon d="M19 12H5 M12 19l-7-7 7-7" size={16} />
          Back to sign in
        </TransitionLink>
      </header>

      <div className="login-layout">
        <section className="login-intro">
          <motion.p className="login-place" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: d }}>
            Municipality of Solano, Nueva Vizcaya
          </motion.p>
          <h1 className="login-headline" aria-label="Join ITRS.">
            <span className="login-line" aria-hidden="true">
              <motion.span custom={d + 0.1} variants={ink} initial="hidden" animate="visible">Join</motion.span>
            </span>
            <span className="login-line" aria-hidden="true">
              <motion.span custom={d + 0.3} variants={ink} initial="hidden" animate="visible">
                <span className="login-highlight">ITRS.</span>
              </motion.span>
            </span>
          </h1>
          <motion.p
            className="login-lede"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: d + 0.55, ease: EASE_OUT }}
          >
            Client accounts are for LGU offices filing IT, multimedia, digital media and print requests.
          </motion.p>

          {/* Each step is written in, left to right, after its number drops in */}
          <ol className="signup-steps">
            {STEPS.map((step, i) => (
              <li key={step}>
                <motion.span
                  className="signup-step-no"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 20, delay: d + 0.75 + i * 0.32 }}
                >
                  {String(i + 1).padStart(2, '0')}
                </motion.span>
                <motion.span
                  initial={{ clipPath: 'inset(-20% 100% -20% 0)' }}
                  animate={{ clipPath: 'inset(-20% 0% -20% 0)' }}
                  transition={{ duration: 0.55, delay: d + 0.82 + i * 0.32, ease: [0.45, 0, 0.55, 1] }}
                >
                  {step}
                </motion.span>
              </li>
            ))}
          </ol>

          <p className="login-credit">{CREDIT}</p>
        </section>

        <main className="login-ticket-wrap">
          <motion.div
            className="login-ticket"
            initial={{ clipPath: PRINT_FROM, y: -22 }}
            animate={
              granted
                ? { clipPath: printed ? 'none' : PRINT_TO, y: 0, scale: [1, 0.96, 1.015, 1], transition: { scale: { duration: 0.45, delay: 0.12, ease: EASE_OUT } } }
                : { clipPath: printed ? 'none' : PRINT_TO, y: 0, scale: 1 }
            }
            transition={printed ? { duration: 0 } : { duration: PRINT_S, delay: d + 0.1, ease: PRINT_EASE }}
            // Once printed, drop the clip so the office list can open past the ticket's edge.
            onAnimationComplete={() => setPrinted(true)}
          >
            {/* The print head riding the edge of the paper as it comes out */}
            <motion.span
              className="signup-printhead"
              aria-hidden="true"
              initial={{ top: '0%', opacity: 0 }}
              animate={{ top: '100%', opacity: [0, 1, 1, 0] }}
              transition={{
                top: { duration: PRINT_S, delay: d + 0.1, ease: PRINT_EASE },
                opacity: { duration: PRINT_S + 0.15, delay: d + 0.1, times: [0, 0.06, 0.85, 1] },
              }}
            />

            {granted && (
              <motion.div
                className="login-granted"
                aria-hidden="true"
                initial={{ opacity: 0, scale: 2.8, rotate: -26 }}
                animate={{ opacity: 1, scale: 1, rotate: -11 }}
                transition={{ type: 'spring', stiffness: 700, damping: 26, mass: 0.8 }}
              >
                <span className="login-granted-word">Registered</span>
                <span className="login-granted-meta">Client account · {new Date().toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </motion.div>
            )}

            <div className="login-ticket-head">
              <img src="/solano-logo.png" alt="" />
              <span>ITRS sign-up</span>
              <span className="login-ticket-tag">Clients</span>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="login-ticket-body">
                <div className="login-form-header">
                  <h2>Create account</h2>
                  <p>For offices requesting services. Staff accounts come from the IT Section.</p>
                </div>

                {error && <div className="error-message" role="alert">{error}</div>}

                <div className="form-group">
                  <label htmlFor="su-username">Username</label>
                  <input
                    ref={usernameRef}
                    id="su-username"
                    type="text"
                    value={form.username}
                    onChange={set('username')}
                    placeholder="e.g. jdelacruz"
                    required
                    pattern={USERNAME_PATTERN}
                    title="3 to 30 letters, numbers, dots, dashes or underscores"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>

                <div className="signup-row signup-names">
                  <div className="form-group">
                    <label htmlFor="su-first">First name</label>
                    <input id="su-first" type="text" value={form.first_name} onChange={set('first_name')} required maxLength={60} autoComplete="given-name" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="su-middle">Middle name</label>
                    <input id="su-middle" type="text" value={form.middle_name} onChange={set('middle_name')} maxLength={60} placeholder="Optional" autoComplete="additional-name" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="su-last">Last name</label>
                    <input id="su-last" type="text" value={form.last_name} onChange={set('last_name')} required maxLength={60} autoComplete="family-name" />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="su-office">Office</label>
                  <OfficePicker id="su-office" value={form.office} options={OFFICES} onChange={(office) => setForm((f) => ({ ...f, office }))} />
                </div>

                <div className="form-group">
                  <label htmlFor="su-position">Position</label>
                  <input
                    id="su-position"
                    type="text"
                    value={form.position}
                    onChange={set('position')}
                    placeholder="e.g. Administrative Aide IV"
                    required
                    maxLength={120}
                    autoComplete="organization-title"
                  />
                </div>

                <div className="login-info-message signup-password-note">
                  {/* Stamped once the note has printed */}
                  <motion.span
                    className="login-stamp"
                    initial={{ opacity: 0, scale: 2.4, rotate: -30 }}
                    animate={{ opacity: 1, scale: 1, rotate: -8 }}
                    transition={{ type: 'spring', stiffness: 600, damping: 22, delay: d + 1.25, opacity: { duration: 0.08, delay: d + 1.25 } }}
                  >
                    Note
                  </motion.span>
                  <span>
                    Your starting password is <strong>{DEFAULT_PASSWORD}</strong>. You&apos;ll be asked to change it as soon as
                    your account is made.
                  </span>
                </div>
              </div>

              <div className="login-ticket-tear" aria-hidden="true" />

              <div className="login-ticket-stub">
                <button type="submit" className={`btn-primary ${granted ? 'is-granted' : ''}`} disabled={loading || granted}>
                  {granted ? (
                    <span className="btn-loading">
                      <Icon d="M20 6L9 17l-5-5" />
                      Account created
                    </span>
                  ) : loading ? (
                    <span className="btn-loading">
                      <span className="spinner" />
                      Creating account...
                    </span>
                  ) : (
                    <span className="btn-loading">
                      Create account
                      <Icon d="M5 12h14 M13 6l6 6-6 6" />
                    </span>
                  )}
                </button>
                <p className="login-guide-link">
                  Already have an account? <TransitionLink to="/login">Sign in</TransitionLink>
                </p>
              </div>
            </form>
          </motion.div>

          <p className="login-mobile-footer">{CREDIT}</p>
        </main>
      </div>
    </div>
  );
}

export default Signup;
