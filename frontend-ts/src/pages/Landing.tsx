import { useEffect, useRef, useState } from 'react';
import { TransitionLink } from '../components/PageCurtain';
import { motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { EASE_OUT } from '../lib/motion';

// Public front page at "/". The idea: ITRS turns scattered requests (calls, notes, chats) into one
// ticket with a code, a status and a record. Sign-in lives at /login.

const GEAR_PATH = 'M77.8 -18.7 L98.8 -15.6 L98.8 15.6 L77.8 18.7 L68.2 41.8 L80.9 58.8 L58.8 80.9 L41.8 68.2 L18.7 77.8 L15.6 98.8 L-15.6 98.8 L-18.7 77.8 L-41.8 68.2 L-58.8 80.9 L-80.9 58.8 L-68.2 41.8 L-77.8 18.7 L-98.8 15.6 L-98.8 -15.6 L-77.8 -18.7 L-68.2 -41.8 L-80.9 -58.8 L-58.8 -80.9 L-41.8 -68.2 L-18.7 -77.8 L-15.6 -98.8 L15.6 -98.8 L18.7 -77.8 L41.8 -68.2 L58.8 -80.9 L80.9 -58.8 L68.2 -41.8 Z';
const STAR = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
const ARROW = 'M5 12h14 M13 6l6 6-6 6';

const SERVICES = ['Computer repairs', 'Network problems', 'Event photo and video', 'Social media posts', 'Presentations', 'Tarpaulins', 'Brochures and flyers'];

// The ticker's bottom row, under the services: what every request gets, scrolling the other way.
const PROMISES = ['Ask once', 'Track it to done', 'One code per request', 'Urgent goes first', 'Notes reach the team', 'Rate the service'];

// Each ticker row scrolls two identical halves (the CSS loop moves by -50%). A half repeats its
// list TICKER_REPEAT times so it is always wider than the screen, even on wide screens; with a
// single copy the bottom row showed bare stretches. Keep the marquee durations in landing.css in step.
const TICKER_REPEAT = 3;

// A fresh order on every visit; the words themselves never change.
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function tickerHalf<T>(items: T[]): T[] {
  return Array.from({ length: TICKER_REPEAT }, () => items).flat();
}

// The sample request in the hero moves through these, the way a real one does on the History page.
const STAGES = [
  { status: 'PENDING', assigned: 'Waiting for a technician' },
  { status: 'IN_PROGRESS', assigned: 'IT technician' },
  { status: 'DONE', assigned: 'IT technician' },
];

// Illustrations of how requests arrive without a shared system. x/y are offsets from the stage centre.
type ScrapKind = 'sticky' | 'slip' | 'chat' | 'chat-reply' | 'lined' | 'pad';
const SCRAPS: Array<{ kind: ScrapKind; x: number; y: number; r: number }> = [
  { kind: 'sticky', x: -190, y: -150, r: -9 },
  { kind: 'slip', x: 175, y: -165, r: 5 },
  { kind: 'chat', x: -215, y: 45, r: 3 },
  { kind: 'lined', x: 200, y: 40, r: -6 },
  { kind: 'chat-reply', x: -70, y: 190, r: -2 },
  { kind: 'pad', x: 150, y: 205, r: 7 },
];

const BENEFITS = [
  { n: 1, title: 'A code for every request', body: 'Quote it when you call the office, or search for it on your History page.' },
  { n: 2, title: 'Urgent goes first', body: 'Keep Urgent for work that has stopped or deadlines within two days, and it gets handled first.' },
  { n: 3, title: 'Always know where it stands', body: 'Your History page shows the status and who is assigned. It updates by itself.' },
  { n: 4, title: 'Add details later', body: 'Write a note while the request is open. The assigned staff member is notified right away.' },
  { n: 5, title: 'Rate the service', body: 'Rate any finished request. Your feedback helps the team improve.' },
];

// How to use it: four queue stubs fed out of a "take a number" dispenser, like the counter at the
// Municipal Hall. Each stub carries a small sketch of what that step looks like in ITRS.
const STEPS = [
  { verb: 'Sign up', body: 'Create a client account with your office and position, or sign in if you already have one. New accounts set their own password first.' },
  { verb: 'Choose', body: 'Pick IT, Multimedia, Digital Media or Print Materials from the sidebar and fill in the form.' },
  { verb: 'Submit', body: 'Set the priority, attach files if they help, and submit. Keep the request code you get.' },
  { verb: 'Track', body: 'Watch the status on your History page. Add notes, cancel while pending, rate when done.' },
];

function Icon({ d, size = 20, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((p, i) => <path key={i} d={i === 0 ? p : 'M' + p} />)}
    </svg>
  );
}

function Gear({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="-110 -110 220 220" aria-hidden="true" focusable="false">
      <path d={GEAR_PATH} />
      <circle r="38" />
    </svg>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/* ---------- The ticket ---------- */

function Stamp({ status }: { status: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={status}
      className={`lp-stamp lp-stamp-${status.toLowerCase()}`}
      initial={reduce ? false : { scale: 1.7, opacity: 0, rotate: -20 }}
      animate={{ scale: 1, opacity: 1, rotate: -9 }}
      transition={{ type: 'spring', stiffness: 520, damping: 24 }}
    >
      {status.replace(/_/g, ' ')}
    </motion.span>
  );
}

function Marker({ n }: { n: number }) {
  return <span className="lp-marker" aria-hidden="true">{n}</span>;
}

function Ticket({ status, assigned, detailed = false, className = '' }: { status: string; assigned: string; detailed?: boolean; className?: string }) {
  return (
    <div className={`lp-ticket ${className}`}>
      <div className="lp-ticket-head">
        <img src="/solano-logo.png" alt="" />
        <span>ITRS request ticket</span>
        <span className="lp-ticket-type">IT Request</span>
      </div>
      <div className="lp-ticket-body">
        <div className="lp-ticket-part">
          {detailed && <Marker n={1} />}
          <span className="lp-ticket-code">IT-2026-0042</span>
        </div>
        <p className="lp-ticket-issue">Office printer not detected by the desktop</p>
        <dl className="lp-ticket-meta">
          <div><dt>Office</dt><dd>Municipal Budget Office</dd></div>
          <div className="lp-ticket-part">
            {detailed && <Marker n={2} />}
            <dt>Priority</dt>
            <dd>{detailed ? <span className="lp-chip-urgent">Urgent</span> : 'Normal'}</dd>
          </div>
        </dl>
      </div>
      <div className="lp-ticket-tear" aria-hidden="true" />
      <div className="lp-ticket-stub">
        <div className="lp-ticket-part lp-ticket-status">
          {detailed && <Marker n={3} />}
          <span className="lp-ticket-label">Status</span>
          <Stamp status={status} />
        </div>
        <div className="lp-ticket-row">
          <span className="lp-ticket-label">Assigned to</span>
          <span>{assigned}</span>
        </div>
        {detailed && (
          <>
            <div className="lp-ticket-part lp-ticket-note">
              <Marker n={4} />
              <span className="lp-ticket-label">Note</span>
              <span>It is the Epson in the records room.</span>
            </div>
            <div className="lp-ticket-part lp-ticket-row">
              <Marker n={5} />
              <span className="lp-ticket-label">Rate</span>
              <span className="lp-stars">{[0, 1, 2, 3, 4].map((i) => <Icon key={i} d={STAR} size={16} />)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CyclingTicket() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(reduce ? STAGES.length - 1 : 0);

  useEffect(() => {
    if (reduce) {
      setStage(STAGES.length - 1);
      return;
    }
    const id = window.setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2800);
    return () => window.clearInterval(id);
  }, [reduce]);

  return <Ticket status={STAGES[stage].status} assigned={STAGES[stage].assigned} />;
}

/* ---------- Why: scraps that become one ticket ---------- */

function ScrapContent({ kind }: { kind: ScrapKind }) {
  switch (kind) {
    case 'sticky':
      return <p className="lp-hand">Pa-check po ng printer sa Budget. Ayaw mag-print!</p>;
    case 'slip':
      return (
        <>
          <p className="lp-slip-title">While you were out</p>
          <p className="lp-slip-line"><span>From</span><span className="lp-hand">MSWDO</span></p>
          <p className="lp-slip-line"><span>Message</span><span className="lp-hand">Walang internet sa 2nd floor</span></p>
        </>
      );
    case 'chat':
      return <p>Sir, pa-cover po ng event namin sa Friday?</p>;
    case 'chat-reply':
      return <p>Nasaan na po yung request ko?</p>;
    case 'lined':
      return <p className="lp-hand">Tarp for Monday!! 3 x 6 ft</p>;
    case 'pad':
      return <p className="lp-hand">Laptop, Engineering. Urgent daw?</p>;
  }
}

// Map scroll progress p from [a, b] onto [from, to], clamped. Used through useTransform's function form:
// framer hands plain range transforms to a native ViewTimeline, which gets this section's range wrong.
const ramp = (a: number, b: number, from: number, to: number) => (p: number) =>
  from + (to - from) * Math.min(1, Math.max(0, (p - a) / (b - a)));

function MovingScrap({ scrap, index, progress }: { scrap: (typeof SCRAPS)[number]; index: number; progress: MotionValue<number> }) {
  const start = 0.14 + index * 0.045;
  const end = start + 0.28;
  const x = useTransform(progress, ramp(start, end, scrap.x, 0));
  const y = useTransform(progress, ramp(start, end, scrap.y, 0));
  const rotate = useTransform(progress, ramp(start, end, scrap.r, 0));
  const scale = useTransform(progress, ramp(start, end, 1, 0.45));
  const opacity = useTransform(progress, ramp(end - 0.07, end, 1, 0));
  return (
    <div className="lp-scrap-anchor">
      <motion.div className={`lp-scrap lp-scrap-${scrap.kind}`} style={{ x, y, rotate, scale, opacity }}>
        <ScrapContent kind={scrap.kind} />
      </motion.div>
    </div>
  );
}

const WHY_BEFORE = 'Without a shared system, requests arrive however they can: a call, a sticky note, a message in a group chat. Easy to send, easy to lose, and hard to follow up.';
const WHY_AFTER = 'ITRS turns each one into a single ticket with a code, a status and a record, so nothing depends on someone remembering.';

function WhyStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });
  const beforeOpacity = useTransform(scrollYProgress, ramp(0.42, 0.56, 1, 0.28));
  const afterOpacity = useTransform(scrollYProgress, ramp(0.5, 0.66, 0, 1));
  const afterY = useTransform(scrollYProgress, ramp(0.5, 0.66, 16, 0));
  const ticketOpacity = useTransform(scrollYProgress, ramp(0.56, 0.7, 0, 1));
  const ticketScale = useTransform(scrollYProgress, ramp(0.56, 0.74, 0.82, 1));

  return (
    <section id="why" ref={sectionRef} className="lp-why lp-why-story">
      <div className="lp-why-sticky">
        <div className="lp-why-text">
          <h2 className="lp-display-md">Why ITRS exists</h2>
          <motion.p style={{ opacity: beforeOpacity }}>{WHY_BEFORE}</motion.p>
          <motion.p className="lp-why-after" style={{ opacity: afterOpacity, y: afterY }}>{WHY_AFTER}</motion.p>
        </div>
        <div className="lp-why-stage">
          {SCRAPS.map((s, i) => <MovingScrap key={s.kind} scrap={s} index={i} progress={scrollYProgress} />)}
          <div className="lp-scrap-anchor">
            <motion.div style={{ opacity: ticketOpacity, scale: ticketScale }}>
              <Ticket status="PENDING" assigned="Waiting for a technician" />
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Phones and reduced motion: the same story, laid out instead of scroll-driven.
function WhyStatic() {
  return (
    <section id="why" className="lp-why lp-why-static">
      <h2 className="lp-display-md">Why ITRS exists</h2>
      <p>{WHY_BEFORE}</p>
      <div className="lp-scrap-pile">
        {SCRAPS.map((s) => (
          <div key={s.kind} className={`lp-scrap lp-scrap-${s.kind}`} style={{ transform: `rotate(${s.r * 0.6}deg)` }}>
            <ScrapContent kind={s.kind} />
          </div>
        ))}
      </div>
      <Icon d="M12 5v14 M6 13l6 6 6-6" size={32} className="lp-why-arrow" />
      <p className="lp-why-after">{WHY_AFTER}</p>
      <Ticket status="PENDING" assigned="Waiting for a technician" className="lp-why-static-ticket" />
    </section>
  );
}

/* ---------- Page ---------- */

/* ---------- How to use it: the queue roll ---------- */

function StepSketch({ step }: { step: number }) {
  if (step === 0) {
    return (
      <>
        <span className="lp-sk-field"><small>Office</small>Municipal Budget Office</span>
        <span className="lp-sk-field"><small>Position</small>Budget Officer</span>
        <span className="lp-sk-btn">Create account</span>
      </>
    );
  }
  if (step === 1) {
    return (
      <span className="lp-sk-chips">
        {['IT', 'Multimedia', 'Digital Media', 'Print'].map((c, i) => (
          <span key={c} className={i === 0 ? 'is-on' : undefined}>{c}</span>
        ))}
      </span>
    );
  }
  if (step === 2) {
    return (
      <>
        <span className="lp-sk-toggle"><span>Normal</span><span className="is-on">Urgent</span></span>
        <span className="lp-sk-field"><small>Your code</small><b className="lp-sk-code">IT-2026-0042</b></span>
      </>
    );
  }
  return (
    <span className="lp-sk-track">
      {['Pending', 'In progress', 'Done'].map((t) => (
        <span key={t}><i />{t}</span>
      ))}
    </span>
  );
}

// The stubs come out of the dispenser one at a time once the roll is in view, and the
// "now serving" screen counts along with them.
function QueueRoll() {
  const reduce = useReducedMotion();
  const across = useMediaQuery('(min-width: 1101px)');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [shown, setShown] = useState(reduce ? STEPS.length : 0);

  useEffect(() => {
    if (reduce) {
      setShown(STEPS.length);
      return;
    }
    if (!inView) return;
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n + 1 >= STEPS.length) window.clearInterval(id);
        return Math.min(n + 1, STEPS.length);
      });
    }, 260);
    return () => window.clearInterval(id);
  }, [inView, reduce]);

  const last = STEPS.length - 1;
  return (
    <div className="lp-roll" ref={ref}>
      <div className="lp-dispenser" aria-hidden="true">
        <img src="/solano-logo.png" alt="" />
        <span className="lp-dispenser-label">Take a number</span>
        <span className="lp-dispenser-screen">
          <small>Now serving</small>
          <b>{String(shown).padStart(2, '0')}</b>
        </span>
      </div>
      <ol className="lp-stubs">
        {STEPS.map((s, i) => {
          // The last stub is torn off: it is the one you keep.
          const out = { opacity: 1, x: 0, y: i === last ? (across ? 18 : 10) : 0, rotate: i === last ? (across ? 3.5 : 1.5) : 0 };
          const tucked = { opacity: 0, x: across ? -70 : 0, y: across ? 0 : -50, rotate: 0 };
          return (
            <motion.li
              key={s.verb}
              className={`lp-stub-slot${i === last ? ' lp-stub-slot-torn' : ''}`}
              initial={reduce ? false : tucked}
              animate={i < shown ? out : tucked}
              transition={{ type: 'spring', stiffness: 170, damping: 20 }}
            >
              <div className="lp-stub">
                <span className="lp-stub-num" aria-hidden="true"><small>No.</small>{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.verb}</h3>
                <p>{s.body}</p>
                <span className="lp-sketch" aria-hidden="true"><StepSketch step={i} /></span>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

const rise = {
  hidden: { y: '105%' },
  visible: (delay: number) => ({ y: '0%', transition: { duration: 0.9, delay, ease: EASE_OUT } }),
};

// The hero flies in back-to-front: gear, nav, place, headline, copy, ticket, then the ticker.
// When the page appears from behind the boot loader (index.html) or a page curtain, hold the
// intro until the cover starts to open so the layers land where they can be seen.
function introDelay() {
  if (document.getElementById('boot')) return 0.55;
  if (document.querySelector('.pc-root')) return 0.75;
  return 0;
}

function Landing() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  // Shuffled once per page load and then held, so the order stays put while you scroll.
  const [services] = useState(() => tickerHalf(shuffled(SERVICES)));
  const [promises] = useState(() => tickerHalf(shuffled(PROMISES)));
  const wide = useMediaQuery('(min-width: 961px)');
  const [d] = useState(introDelay);

  // Smooth scrolling for the in-page nav links; restored when leaving the page.
  useEffect(() => {
    if (reduce) return;
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'smooth';
    return () => { html.style.scrollBehavior = prev; };
  }, [reduce]);

  let home = '/login';
  if (user) {
    const primary = user.primary_role || user.role;
    home = primary === 'CLIENT' ? '/request' : primary === 'MULTIMEDIA' ? '/multimedia-dashboard' : '/dashboard';
  }
  const primaryLabel = user ? 'Open ITRS' : 'Sign in';

  return (
    <div className="lp">
      <motion.header
        className="lp-nav"
        // x keeps the CSS centring (translateX(-50%)) now that framer owns the transform
        style={{ x: '-50%' }}
        initial={{ y: -90, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24, delay: d + 0.05 }}
      >
        <TransitionLink to="/" className="lp-brand">
          <img src="/solano-logo.png" alt="" />
          <span>ITRS</span>
        </TransitionLink>
        <nav className="lp-nav-links" aria-label="On this page">
          <a href="#why">Why</a>
          <a href="#benefits">Benefits</a>
          <a href="#how">How to use it</a>
          <TransitionLink to="/guide">Client guide</TransitionLink>
        </nav>
        <div className="lp-nav-actions">
          {!user && <TransitionLink to="/signup" className="lp-btn lp-btn-line lp-btn-sm">Sign up</TransitionLink>}
          <TransitionLink to={home} className="lp-btn lp-btn-ink lp-btn-sm">{primaryLabel}</TransitionLink>
        </div>
      </motion.header>

      <main>
        {/* ----- Hero ----- */}
        <section className="lp-hero">
          <motion.div
            className="lp-hero-gear-layer"
            initial={{ opacity: 0, scale: 1.35, rotate: -30 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1.8, delay: d, ease: EASE_OUT }}
          >
            <Gear className="lp-gear lp-gear-hero" />
          </motion.div>
          <div className="lp-hero-inner">
            <motion.p
              className="lp-place"
              initial={{ opacity: 0, x: -28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: d + 0.15, ease: EASE_OUT }}
            >
              Municipality of Solano, Nueva Vizcaya
            </motion.p>
            <h1 className="lp-hero-title" aria-label="Ask once. Track it to done.">
              <span className="lp-line" aria-hidden="true">
                <motion.span custom={d + 0.25} variants={rise} initial="hidden" animate="visible">Ask once.</motion.span>
              </span>
              <span className="lp-line" aria-hidden="true">
                <motion.span custom={d + 0.37} variants={rise} initial="hidden" animate="visible">
                  Track it to <span className="lp-highlight">done.</span>
                </motion.span>
              </span>
            </h1>

            <div className="lp-hero-copy">
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: d + 0.55, ease: EASE_OUT }}
              >
                The request system for LGU Solano offices. IT repairs, event coverage, digital media and print, all in one place.
              </motion.p>
              <motion.div
                className="lp-hero-actions"
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22, delay: d + 0.7 }}
              >
                <TransitionLink to={home} className="lp-btn lp-btn-ink">{primaryLabel}<Icon d={ARROW} size={18} /></TransitionLink>
                {user ? (
                  <TransitionLink to="/guide" className="lp-btn lp-btn-line">Read the client guide</TransitionLink>
                ) : (
                  <TransitionLink to="/signup" className="lp-btn lp-btn-line">Create an account</TransitionLink>
                )}
              </motion.div>
            </div>

            <motion.div
              className="lp-hero-ticket"
              initial={{ opacity: 0, x: 140, y: 80, rotate: 16, scale: 0.86 }}
              animate={{ opacity: 1, x: 0, y: 0, rotate: 3, scale: 1 }}
              transition={{ type: 'spring', stiffness: 80, damping: 15, delay: d + 0.45 }}
            >
              <CyclingTicket />
            </motion.div>
          </div>
        </section>

        {/* ----- Ticker: services right to left on top, promises left to right below ----- */}
        <motion.div
          className="lp-ticker"
          aria-label={`What you can request: ${SERVICES.join(', ')}`}
          initial={{ clipPath: 'inset(0 100% 0 0)' }}
          animate={{ clipPath: 'inset(0 0% 0 0)' }}
          transition={{ duration: 1.1, delay: d + 0.9, ease: [0.65, 0, 0.35, 1] }}
        >
          <div className="lp-ticker-row" aria-hidden="true">
            <div className="lp-ticker-track">
              {[0, 1].map((n) => (
                <div className="lp-ticker-set" key={n}>
                  {services.map((s, i) => (
                    <span key={i}>{s}<Gear className="lp-ticker-gear" /></span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="lp-ticker-row" aria-hidden="true">
            <div className="lp-ticker-track lp-ticker-track-reverse">
              {[0, 1].map((n) => (
                <div className="lp-ticker-set" key={n}>
                  {promises.map((p, i) => (
                    <span key={i} className="lp-ticker-promise">{p}<Icon d={STAR} size={14} className="lp-ticker-star" /></span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ----- Why ----- */}
        {wide && !reduce ? <WhyStory /> : <WhyStatic />}

        {/* ----- Benefits: the ticket, annotated ----- */}
        <section id="benefits" className="lp-anatomy">
          <div className="lp-wrap">
            <h2 className="lp-display-md">One ticket, five things it does for you</h2>
            <div className="lp-anatomy-grid">
              <ol className="lp-notes lp-notes-left">
                {BENEFITS.slice(0, 2).map((b, i) => (
                  <motion.li
                    key={b.n}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: EASE_OUT }}
                  >
                    <Marker n={b.n} />
                    <h3>{b.title}</h3>
                    <p>{b.body}</p>
                  </motion.li>
                ))}
              </ol>
              <motion.div
                className="lp-anatomy-ticket"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.7, ease: EASE_OUT }}
              >
                <Ticket status="IN_PROGRESS" assigned="IT technician" detailed />
              </motion.div>
              <ol className="lp-notes lp-notes-right">
                {BENEFITS.slice(2).map((b, i) => (
                  <motion.li
                    key={b.n}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: EASE_OUT }}
                  >
                    <Marker n={b.n} />
                    <h3>{b.title}</h3>
                    <p>{b.body}</p>
                  </motion.li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ----- How: queue stubs from a take-a-number dispenser ----- */}
        <section id="how" className="lp-how">
          <div className="lp-how-head">
            <h2 className="lp-display-md">How to use it</h2>
            <p>
              Like taking a number at the Municipal Hall, except you do it from your own desk. Four steps, and the office
              takes it from there.
            </p>
          </div>
          <QueueRoll />
          <TransitionLink to="/guide" className="lp-guide-link">Read the client guide<Icon d={ARROW} size={18} /></TransitionLink>
        </section>
      </main>

      {/* ----- Finale ----- */}
      <footer className="lp-finale">
        <Gear className="lp-gear lp-gear-finale" />
        <div className="lp-wrap lp-finale-inner">
          <h2 className="lp-finale-title">
            Your next request starts <span className="lp-finale-mark">here.</span>
          </h2>
          <div className="lp-finale-row">
            <p>
              No account yet? Offices can sign up for a client account in a minute. Staff accounts come from the
              Information and Technology Section (Mayor&apos;s Office), 2nd floor of the Municipal Hall.
            </p>
            <div className="lp-finale-actions">
              {!user && <TransitionLink to="/signup" className="lp-btn lp-btn-line-light">Sign up</TransitionLink>}
              <TransitionLink to={home} className="lp-btn lp-btn-yellow">{primaryLabel}<Icon d={ARROW} size={18} /></TransitionLink>
            </div>
          </div>
          <div className="lp-credits">
            <span className="lp-credits-brand">
              <img src="/solano-logo.png" alt="Seal of the Municipality of Solano" />
              ITRS, Municipality of Solano, Nueva Vizcaya
            </span>
            <span>&copy; 2026 Dave Shadrach B. Lannu</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
