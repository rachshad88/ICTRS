import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion } from 'framer-motion';
import { Link, useLocation, useNavigate, type LinkProps } from 'react-router-dom';
import { EASE_OUT, prefersReducedMotion } from '../lib/motion';
import { playBannerSweep, playPageTurn, playRegistrationSlip, playSafeDial } from '../services/sfx';
import { preloadPage } from '../routes';

// Transitions between the public pages. Each destination has its own:
//   landing (/)  → banner sweep: skewed yellow / cobalt / ink bands race across
//   login        → safe dial: a keyhole swallows the screen, a dial cracks the combination,
//                  and you fly through the lit keyhole into the login page
//   guide        → page turn: a blueprint page swings shut like a book, then turns away
//   signup       → registration slip: a paper form slides up, a signature writes itself, a seal
//                  stamps across the perforation, scissors cut along it and the slip tears in two
// Only links rendered with <TransitionLink> to one of these paths play a transition.

export type Kind = 'landing' | 'login' | 'guide' | 'signup';
type Phase = 'idle' | 'in' | 'out';

const KIND_FOR: Record<string, Kind> = { '/': 'landing', '/login': 'login', '/guide': 'guide', '/signup': 'signup' };

// in = until the screen is fully covered; hold = time on the cover after navigating; out = reveal.
const TIMING: Record<Kind, { in: number; hold: number; out: number }> = {
  landing: { in: 700, hold: 450, out: 750 },
  login: { in: 750, hold: 1000, out: 850 },
  guide: { in: 900, hold: 650, out: 900 },
  signup: { in: 750, hold: 1450, out: 900 },
};

const EASE_IN_OUT = [0.76, 0, 0.24, 1] as const;

/**
 * Seconds until a page that is mounting now gets uncovered: the destination's hold plus the start
 * of its reveal when it arrives behind this curtain, or 0 on a direct visit. Pages delay their
 * entrance by this so it plays in view instead of under the cover. Read it once, at mount.
 */
export function curtainRevealDelay(kind: Kind): number {
  if (typeof document === 'undefined' || !document.querySelector(`.pc-root.pc-${kind}`)) return 0;
  const t = TIMING[kind];
  return (t.hold + t.out * REVEAL_LEAD[kind]) / 1000;
}

// How far into each reveal the page is visible enough for its entrance. The keyhole and the tear
// open from the middle, so early; the guide's page turns away on its left hinge, which uncovers
// the left side (where the headline is) last.
const REVEAL_LEAD: Record<Kind, number> = { landing: 0.3, login: 0.3, guide: 0.65, signup: 0.3 };

// Each transition's sound, scored to its own timeline (services/sfx.ts).
const SOUND: Record<Kind, () => void> = {
  landing: playBannerSweep,
  login: playSafeDial,
  guide: playPageTurn,
  signup: playRegistrationSlip,
};

interface PageCurtainApi {
  go: (to: string) => void;
}

const PageCurtainContext = createContext<PageCurtainApi | undefined>(undefined);

export function PageCurtainProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [kind, setKind] = useState<Kind>('landing');
  const timers = useRef<number[]>([]);
  const running = useRef(false);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const go = useCallback((to: string) => {
    const k = KIND_FOR[to];
    if (!k || prefersReducedMotion()) {
      navigate(to);
      return;
    }
    if (running.current) return;
    running.current = true;
    // Fetch the destination's file while the cover closes (routes.ts).
    preloadPage(to);
    const t = TIMING[k];
    setKind(k);
    setPhase('in');
    SOUND[k]();
    timers.current = [
      window.setTimeout(() => {
        navigate(to);
        window.scrollTo(0, 0);
      }, t.in),
      window.setTimeout(() => setPhase('out'), t.in + t.hold),
      window.setTimeout(() => {
        setPhase('idle');
        running.current = false;
      }, t.in + t.hold + t.out + 100),
    ];
  }, [navigate]);

  return (
    <PageCurtainContext.Provider value={{ go }}>
      {children}
      {phase !== 'idle' &&
        createPortal(
          <div className={`pc-root pc-${kind}`} aria-hidden="true">
            {kind === 'landing' && <BannerSweep phase={phase} />}
            {kind === 'login' && <SafeDial phase={phase} />}
            {kind === 'guide' && <PageTurn phase={phase} />}
            {kind === 'signup' && <SignupSlip phase={phase} />}
          </div>,
          document.body,
        )}
    </PageCurtainContext.Provider>
  );
}

function usePageCurtain() {
  const ctx = useContext(PageCurtainContext);
  if (!ctx) throw new Error('usePageCurtain must be used within PageCurtainProvider');
  return ctx;
}

/** A <Link> that plays the destination's transition when it points at a public page. */
export function TransitionLink({ to, onClick, ...rest }: LinkProps & { to: string }) {
  const { go } = usePageCurtain();
  const location = useLocation();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    // Let the browser handle new-tab / modified clicks, and skip same-page links.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!KIND_FOR[to] || to === location.pathname) return;
    e.preventDefault();
    go(to);
  };

  return <Link to={to} onClick={handleClick} {...rest} />;
}

/* ---------- landing: banner sweep ---------- */

const BANDS = ['pc-band-yellow', 'pc-band-cobalt', 'pc-band-ink'];

function BannerSweep({ phase }: { phase: Phase }) {
  const out = phase === 'out';
  return (
    <>
      {BANDS.map((cls, i) => (
        <motion.div
          key={cls}
          className={`pc-band ${cls}`}
          initial={{ x: '-130%' }}
          animate={{ x: out ? '130%' : '0%' }}
          // In: yellow leads. Out: ink leaves first so the colours peel off in reverse.
          transition={{ duration: 0.55, delay: (out ? BANDS.length - 1 - i : i) * 0.07, ease: EASE_IN_OUT }}
        />
      ))}
      <motion.div
        className="pc-banner-text"
        initial={{ opacity: 0 }}
        animate={{ opacity: out ? 0 : 1 }}
        transition={{ duration: out ? 0.15 : 0.3, delay: out ? 0 : 0.45 }}
      >
        <motion.img
          src="/solano-logo.png"
          alt=""
          className="pc-banner-seal"
          initial={{ scale: 0, rotate: -120 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.55 }}
        />
        <motion.span
          className="pc-banner-line"
          initial={{ x: '30%' }}
          animate={{ x: '-12%' }}
          transition={{ duration: 1.6, delay: 0.3, ease: 'linear' }}
        >
          Municipality of Solano
        </motion.span>
        <motion.span
          className="pc-banner-line pc-banner-line-alt"
          initial={{ x: '-30%' }}
          animate={{ x: '12%' }}
          transition={{ duration: 1.6, delay: 0.3, ease: 'linear' }}
        >
          IT Request System
        </motion.span>
      </motion.div>
    </>
  );
}

/* ---------- login: safe dial ---------- */

// Everything is drawn in one 100×100 SVG space (sliced to cover the viewport) so the keyhole
// cover, the dial and the keyhole the page is revealed through all line up exactly.
const KEYHOLE = 'M50 40 a6 6 0 1 1 0 12 a6 6 0 1 1 0 -12 Z M52.8 50 L55 60 L45 60 L47.2 50 Z';
const DIAL_TICKS = Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2;
  const long = i % 4 === 0;
  const r1 = long ? 9.4 : 10.1;
  const r2 = 11.2;
  return { x1: 50 + Math.sin(a) * r1, y1: 46 - Math.cos(a) * r1, x2: 50 + Math.sin(a) * r2, y2: 46 - Math.cos(a) * r2, long };
});
const CLICK_AT = 1.5;

/** Scales an SVG element about the keyhole centre via its transform attribute (CSS transforms
 *  on elements inside a <mask> are not reliable across browsers). */
function useKeyholeScale(
  ref: RefObject<SVGGElement>,
  active: boolean,
  from: number,
  to: number,
  duration: number,
  ease: readonly [number, number, number, number],
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const set = (t: number) => {
      const sc = from + (to - from) * t;
      el.setAttribute('transform', `translate(50 50) scale(${Math.max(sc, 0.0001)}) translate(-50 -50)`);
    };
    set(0);
    const controls = animate(0, 1, { duration, ease: [...ease], onUpdate: set });
    return () => controls.stop();
  }, [ref, active, from, to, duration, ease]);
}

const COVER_EASE = [0.7, 0, 0.84, 0] as const;
const HOLE_EASE = [0.65, 0, 0.35, 1] as const;

function SafeDial({ phase }: { phase: Phase }) {
  const out = phase === 'out';
  const coverRef = useRef<SVGGElement>(null);
  const holeRef = useRef<SVGGElement>(null);
  useKeyholeScale(coverRef, !out, 0, 24, 0.75, COVER_EASE);
  useKeyholeScale(holeRef, out, 1, 24, 0.85, HOLE_EASE);

  return (
    <svg className="pc-safe" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs>
        <mask id="pc-keyhole-mask" maskUnits="userSpaceOnUse" x="-100" y="-100" width="300" height="300">
          <rect x="-100" y="-100" width="300" height="300" fill="#fff" />
          <g ref={holeRef}>
            <path d={KEYHOLE} fill="#000" />
          </g>
        </mask>
        <radialGradient id="pc-safe-bg" cx="50%" cy="46%" r="60%">
          <stop offset="0%" stopColor="#1a56c4" />
          <stop offset="60%" stopColor="#0b3a8c" />
          <stop offset="100%" stopColor="#061f52" />
        </radialGradient>
      </defs>

      {out ? (
        // Reveal: the navy now has a keyhole-shaped hole that grows until it swallows the screen
        <rect x="-100" y="-100" width="300" height="300" fill="url(#pc-safe-bg)" mask="url(#pc-keyhole-mask)" />
      ) : (
        // Cover: a solid keyhole grows out of the page until it fills the viewport
        <g ref={coverRef} transform="translate(50 50) scale(0.0001) translate(-50 -50)">
          <path d={KEYHOLE} fill="url(#pc-safe-bg)" />
        </g>
      )}

      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: out ? 0 : 1 }}
        transition={{ duration: out ? 0.15 : 0.3, delay: out ? 0 : 0.55 }}
      >
        {/* The dial: spins one way, back the other, and settles — a combination being cracked */}
        <motion.g
          initial={{ rotate: -40 }}
          animate={{ rotate: [-40, -190, 70, 0] }}
          transition={{ duration: 0.85, delay: 0.62, times: [0, 0.42, 0.78, 1], ease: 'easeInOut' }}
        >
          <circle cx="50" cy="46" r="11.9" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.25" />
          {DIAL_TICKS.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={t.long ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)'}
              strokeWidth={t.long ? 0.32 : 0.18}
              strokeLinecap="round"
            />
          ))}
        </motion.g>

        {/* Fixed pointer at twelve o'clock */}
        <path d="M48.9 32.6 L51.1 32.6 L50 34.4 Z" fill="#ffd91a" />

        {/* Keyhole outline, then it lights up on the click */}
        <motion.path
          d={KEYHOLE}
          fill="none"
          stroke="#ffd91a"
          strokeWidth="0.45"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, delay: 0.6, ease: EASE_OUT }}
        />
        <motion.path
          d={KEYHOLE}
          fill="#ffd91a"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, delay: CLICK_AT }}
        />
        {/* Shock ring on the click */}
        <motion.circle
          cx="50"
          cy="46"
          r="12"
          fill="none"
          stroke="#ffd91a"
          strokeWidth="0.4"
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1.6], opacity: [0.9, 0] }}
          transition={{ duration: 0.5, delay: CLICK_AT, ease: 'easeOut' }}
        />

        <motion.text
          x="50"
          y="70"
          textAnchor="middle"
          className="pc-safe-label"
          initial={{ opacity: 0, y: 1.5 }}
          animate={{ opacity: [0, 1, 1, 0], y: [1.5, 0, 0, -1.5] }}
          transition={{ duration: CLICK_AT - 0.5, delay: 0.6, times: [0, 0.25, 0.85, 1] }}
        >
          Unlocking sign-in
        </motion.text>
        <motion.text
          x="50"
          y="70"
          textAnchor="middle"
          className="pc-safe-label pc-safe-label-done"
          initial={{ opacity: 0, y: 1.5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: CLICK_AT + 0.05, ease: EASE_OUT }}
        >
          Unlocked
        </motion.text>
      </motion.g>
    </svg>
  );
}

/* ---------- guide: page turn ---------- */

const GUIDE_TITLE = ['Client', 'Guide'];
const SILK = [0.22, 1, 0.36, 1] as const;

function PageTurn({ phase }: { phase: Phase }) {
  const out = phase === 'out';
  let letterIndex = 0;

  return (
    <div className="pc-book">
      {/* Shadow the turning page casts on whatever is underneath */}
      <motion.div
        className="pc-cast"
        initial={{ opacity: 0 }}
        animate={{ opacity: out ? [0.55, 0] : 0.55 }}
        transition={{ duration: out ? 0.85 : 0.6, ease: 'easeOut' }}
      />

      <motion.div
        className="pc-page"
        style={{ transformOrigin: '0% 50%' }}
        initial={{ rotateY: 96, scale: 0.96 }}
        animate={out ? { rotateY: -104, scale: 1.03 } : { rotateY: 0, scale: 1 }}
        transition={{ duration: out ? 0.9 : 0.85, ease: out ? [0.6, 0, 0.8, 0.25] : SILK }}
      >
        <div className="pc-page-grain" />

        {/* A soft band of light that rolls across the paper as it settles */}
        <motion.div
          className="pc-page-glint"
          initial={{ x: '-120%', opacity: 0 }}
          animate={{ x: '120%', opacity: [0, 0.9, 0] }}
          transition={{ duration: 1.3, delay: 0.25, ease: [0.45, 0, 0.2, 1] }}
        />

        <motion.div
          className="pc-page-shade"
          initial={{ opacity: 0.75 }}
          animate={{ opacity: out ? 0.85 : 0 }}
          transition={{ duration: out ? 0.75 : 0.7, ease: 'easeOut' }}
        />

        {/* Hairline frame, drawn out from the middle of each side */}
        <motion.span className="pc-rule pc-rule-top" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, delay: 0.5, ease: SILK }} />
        <motion.span className="pc-rule pc-rule-bottom" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, delay: 0.6, ease: SILK }} />

        <motion.div
          className="pc-folio"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.75 }}
        >
          <span>ITRS — Client Guide</span>
          <span>Vol. 01</span>
          <span>LGU Solano · Nueva Vizcaya</span>
          <span>p. 01</span>
        </motion.div>

        <div className="pc-page-content">
          <div className="pc-page-kicker">
            <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, delay: 0.45, ease: SILK }} style={{ originX: 1 }} />
            <motion.span
              initial={{ opacity: 0, letterSpacing: '0.6em' }}
              animate={{ opacity: 1, letterSpacing: '0.32em' }}
              transition={{ duration: 0.9, delay: 0.45, ease: SILK }}
            >
              Chapter 01
            </motion.span>
            <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, delay: 0.45, ease: SILK }} style={{ originX: 0 }} />
          </div>

          <h2 className="pc-page-title" aria-label={GUIDE_TITLE.join(' ')}>
            {GUIDE_TITLE.map((word) => (
              <span key={word} className="pc-word" aria-hidden="true">
                {word.split('').map((ch) => {
                  const i = letterIndex++;
                  return (
                    <span key={i} className="pc-letter-mask">
                      <motion.span
                        initial={{ y: '105%', opacity: 0, filter: 'blur(8px)' }}
                        animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
                        transition={{ duration: 0.8, delay: 0.55 + i * 0.035, ease: SILK }}
                      >
                        {ch}
                      </motion.span>
                    </span>
                  );
                })}
              </span>
            ))}
            {/* Gold sheen that passes over the finished title */}
            <span className="pc-title-sheen" aria-hidden="true">
              {GUIDE_TITLE.map((word) => <span key={word}>{word}</span>)}
            </span>
          </h2>

          <motion.span
            className="pc-page-note"
            initial={{ opacity: 0, y: 6, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: -3 }}
            transition={{ duration: 0.7, delay: 1.0, ease: SILK }}
          >
            how to ask for help, step by step
          </motion.span>
          <svg className="pc-page-arrow" viewBox="0 0 160 40" fill="none">
            {/* Smile-style arrow: the curve draws left to right, then the head lands at its tip.
                Both start hidden so the round line caps don't show as dots before drawing. */}
            <motion.path
              d="M4 12 C 40 34, 100 34, 140 18"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ pathLength: { duration: 0.6, delay: 1.1, ease: [0.65, 0, 0.35, 1] }, opacity: { duration: 0.01, delay: 1.1 } }}
            />
            <motion.path
              d="M128 14 L142 17 L134 29"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ pathLength: { duration: 0.22, delay: 1.68, ease: EASE_OUT }, opacity: { duration: 0.01, delay: 1.68 } }}
            />
          </svg>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------- signup: registration slip ---------- */

// The slip is drawn twice, once per half, each clipped along the same torn edge, so on the way out
// the two halves can pull apart and everything printed across the tear (the stamp, the
// perforation) splits with them.
const TEAR_Y = 64; // % of the screen height
const TEAR_POINTS = Array.from({ length: 41 }, (_, i) => {
  // Fixed pseudo-random jitter, a few px either way, so the edge reads as torn paper.
  const n = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return { x: (i / 40) * 100, off: Math.round((n - Math.floor(n) - 0.5) * 60) / 10 };
});
const tearEdge = (points: typeof TEAR_POINTS) => points.map((p) => `${p.x}% calc(${TEAR_Y}% + ${p.off}px)`).join(', ');
const TOP_CLIP = `polygon(0 0, 100% 0, ${tearEdge([...TEAR_POINTS].reverse())})`;
const BOTTOM_CLIP = `polygon(${tearEdge(TEAR_POINTS)}, 100% 100%, 0 100%)`;

// Seconds from the start: fields rule in, the signature writes, the seal lands, the scissors cut.
// The cut ends exactly when the reveal starts (TIMING.signup in + hold).
const SLIP = { lines: 0.85, sign: 1.05, stamp: 1.6, cut: 1.78, cutFor: 0.42 };
const SLIP_FIELDS = ['Name', 'Office', 'Position'];
const SLIP_TITLE = ['Sign', 'up.'];

function SignupSlip({ phase }: { phase: Phase }) {
  const out = phase === 'out';
  const tear = out ? { duration: 0.85, times: [0, 0.16, 1], ease: [0.6, 0, 0.3, 1] as const } : { duration: 0 };

  return (
    <motion.div
      className="pc-reg"
      initial={{ y: '104%', rotate: 2.5 }}
      animate={{ y: '0%', rotate: 0 }}
      transition={{ duration: 0.75, ease: EASE_IN_OUT }}
    >
      {/* The thud of the stamp landing */}
      <motion.div
        className="pc-reg-stack"
        initial={{ y: 0 }}
        animate={{ y: [0, 7, -2, 0] }}
        transition={{ duration: 0.3, delay: SLIP.stamp + 0.05, ease: 'easeOut' }}
      >
        <motion.div
          className="pc-reg-piece"
          style={{ clipPath: TOP_CLIP, WebkitClipPath: TOP_CLIP, transformOrigin: `0% ${TEAR_Y}%` }}
          animate={out ? { y: ['0%', '-1.4%', '-115%'], rotate: [0, -0.8, -6] } : { y: '0%', rotate: 0 }}
          transition={tear}
        >
          <SlipSheet out={out} id="t" />
        </motion.div>
        <motion.div
          className="pc-reg-piece"
          style={{ clipPath: BOTTOM_CLIP, WebkitClipPath: BOTTOM_CLIP, transformOrigin: `100% ${TEAR_Y}%` }}
          animate={out ? { y: ['0%', '1.4%', '115%'], rotate: [0, 0.8, 5] } : { y: '0%', rotate: 0 }}
          transition={out ? { ...tear, delay: 0.05 } : tear}
        >
          <SlipSheet out={out} id="b" />
        </motion.div>

        {/* Scissors snipping along the perforation */}
        <motion.div
          className="pc-reg-scissors"
          initial={{ left: '-6%', opacity: 0 }}
          animate={out ? { opacity: 0 } : { left: '103%', opacity: 1 }}
          transition={
            out
              ? { duration: 0.1 }
              : { left: { duration: SLIP.cutFor, delay: SLIP.cut, ease: 'linear' }, opacity: { duration: 0.08, delay: SLIP.cut } }
          }
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <g className="pc-reg-blade pc-reg-blade-a">
              <circle cx="6" cy="6" r="3" />
              <path d="M8.12 8.12 20 20" />
            </g>
            <g className="pc-reg-blade pc-reg-blade-b">
              <circle cx="6" cy="18" r="3" />
              <path d="M8.12 15.88 20 4" />
            </g>
          </svg>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function SlipSheet({ out, id }: { out: boolean; id: string }) {
  const today = new Date().toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
  let letterIndex = 0;

  return (
    <div className="pc-reg-sheet">
      <div className="pc-page-grain pc-reg-grain" />
      <span className="pc-reg-frame" />

      <motion.div className="pc-reg-folio" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.45 }}>
        <span>LGU Solano · ITRS</span>
        <span>Form CR-01</span>
        <span>Client registration</span>
        <span>{today}</span>
      </motion.div>

      <div className="pc-reg-head">
        <motion.span
          className="pc-reg-kicker"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.55, ease: EASE_OUT }}
        >
          New account · for LGU offices
        </motion.span>
        <h2 className="pc-reg-title" aria-label={SLIP_TITLE.join(' ')}>
          {SLIP_TITLE.map((word, w) => (
            <span key={word} className={`pc-word ${w === 1 ? 'pc-reg-hl' : ''}`} aria-hidden="true">
              {w === 1 && (
                <motion.i
                  className="pc-reg-hl-bar"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.55, delay: 1.0, ease: EASE_OUT }}
                />
              )}
              {word.split('').map((ch) => {
                const i = letterIndex++;
                return (
                  <span key={i} className="pc-letter-mask">
                    <motion.span
                      initial={{ y: '105%' }}
                      animate={{ y: '0%' }}
                      transition={{ duration: 0.7, delay: 0.6 + i * 0.045, ease: SILK }}
                    >
                      {ch}
                    </motion.span>
                  </span>
                );
              })}
            </span>
          ))}
        </h2>
      </div>

      <div className="pc-reg-fields">
        {SLIP_FIELDS.map((field, i) => (
          <div key={field} className="pc-reg-field">
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: SLIP.lines + i * 0.1 }}>
              {field}
            </motion.span>
            <motion.i
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.55, delay: SLIP.lines + i * 0.1, ease: SILK }}
            />
          </div>
        ))}
      </div>

      {/* Perforation: printed faintly, then cut dark behind the scissors */}
      <motion.span className="pc-reg-perf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.9 }} />
      <motion.span
        className="pc-reg-cut"
        initial={{ clipPath: 'inset(0 100% 0 0)' }}
        animate={{ clipPath: 'inset(0 0% 0 0)' }}
        transition={{ duration: SLIP.cutFor, delay: SLIP.cut + 0.03, ease: 'linear' }}
      />
      <motion.span className="pc-reg-detach" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 1.0 }}>
        Detach here
      </motion.span>

      <div className="pc-reg-sign">
        <div className="pc-reg-sign-ink">
          <motion.span
            className="pc-reg-sign-text"
            initial={{ clipPath: 'inset(-20% 100% -20% 0)' }}
            animate={{ clipPath: 'inset(-20% 0% -20% 0)' }}
            transition={{ duration: 0.6, delay: SLIP.sign, ease: [0.45, 0, 0.55, 1] }}
          >
            Signed, you.
          </motion.span>
          {/* The pen tip riding the edge of the ink */}
          <motion.span
            className="pc-reg-nib"
            initial={{ left: '0%', opacity: 0 }}
            animate={{ left: '100%', opacity: [0, 1, 1, 0] }}
            transition={{
              left: { duration: 0.6, delay: SLIP.sign, ease: [0.45, 0, 0.55, 1] },
              opacity: { duration: 0.75, delay: SLIP.sign, times: [0, 0.08, 0.8, 1] },
            }}
          />
        </div>
        <motion.i
          className="pc-reg-sign-line"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, delay: SLIP.lines + 0.2, ease: SILK }}
        />
        <span className="pc-reg-sign-label">Signature of applicant</span>
      </div>

      <span className="pc-reg-stub">Applicant&apos;s copy · keep this stub</span>

      {/* The seal lands across the perforation, so the tear splits it in two */}
      <motion.div
        className="pc-reg-stamp"
        initial={{ opacity: 0, scale: 2.4, rotate: -34 }}
        animate={{ opacity: 1, scale: 1, rotate: -12 }}
        transition={{ type: 'spring', stiffness: 520, damping: 30, mass: 0.9, delay: SLIP.stamp, opacity: { duration: 0.08, delay: SLIP.stamp } }}
      >
        <motion.span
          className="pc-reg-stamp-bleed"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: [0, 0.55, 0], scale: [0.9, 1.5] }}
          transition={{ duration: 0.6, delay: SLIP.stamp + 0.12, ease: 'easeOut' }}
        />
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <path id={`pc-reg-ring-${id}`} d="M100 100 m-73 0 a73 73 0 1 1 146 0 a73 73 0 1 1 -146 0" />
            {/* Rough ink edge, like a rubber stamp */}
            <filter id={`pc-reg-rough-${id}`} x="-10%" y="-10%" width="120%" height="120%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" />
            </filter>
          </defs>
          <g filter={`url(#pc-reg-rough-${id})`}>
            <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="5" />
            <circle cx="100" cy="100" r="86" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="56" fill="none" stroke="currentColor" strokeWidth="2" />
            <text className="pc-reg-stamp-ring">
              <textPath href={`#pc-reg-ring-${id}`} textLength="452">
                CLIENT · REGISTERED · ITRS · LGU SOLANO ·
              </textPath>
            </text>
            <path d="M74 101 L93 119 L128 82" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      </motion.div>

      {/* Shading along the torn edge once the halves separate */}
      <motion.span className="pc-reg-edge" initial={{ opacity: 0 }} animate={{ opacity: out ? 1 : 0 }} transition={{ duration: 0.2 }} />
    </div>
  );
}
