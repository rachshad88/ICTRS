import { useEffect, useState } from 'react';
import { TransitionLink } from '../components/PageCurtain';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { EASE_OUT } from '../lib/motion';
import { CountUp, useRevealDelay } from '../components/Entrance';

// Public client guide at /guide, styled like the landing page: paper, ink, tickets and stamps.
// Laid out as an infographic: pictures and a few words each, not paragraphs to read.

const GEAR_PATH = 'M77.8 -18.7 L98.8 -15.6 L98.8 15.6 L77.8 18.7 L68.2 41.8 L80.9 58.8 L58.8 80.9 L41.8 68.2 L18.7 77.8 L15.6 98.8 L-15.6 98.8 L-18.7 77.8 L-41.8 68.2 L-58.8 80.9 L-80.9 58.8 L-68.2 41.8 L-77.8 18.7 L-98.8 15.6 L-98.8 -15.6 L-77.8 -18.7 L-68.2 -41.8 L-80.9 -58.8 L-58.8 -80.9 L-41.8 -68.2 L-18.7 -77.8 L-15.6 -98.8 L15.6 -98.8 L18.7 -77.8 L41.8 -68.2 L58.8 -80.9 L80.9 -58.8 L68.2 -41.8 Z';

const I = {
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  signin: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4 M10 17l5-5-5-5 M15 12H3',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  form: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h4',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8 9h8 M8 13h5',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  pointer: 'M4 3l7 17 2.5-7.5L21 10z',
  exit: 'M15 10l5 5-5 5 M4 4v7a4 4 0 0 0 4 4h12',
  x: 'M18 6L6 18 M6 6l12 12',
  it: 'M2 3h20v14H2z M8 21h8 M12 17v4',
  event: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z',
  digital: 'M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
  print: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
};

const STEPS = [
  { icon: I.signin, title: 'Sign in', text: 'Username and password.' },
  { icon: I.grid, title: 'Pick a type', text: 'From the menu bar.' },
  { icon: I.form, title: 'Fill in & submit', text: 'You get a request code.' },
  { icon: I.eye, title: 'Track & rate', text: 'Follow it in History.' },
];

const REQUEST_TYPES = [
  {
    ask: 'Computer or network trouble?',
    name: 'IT Request',
    icon: I.it,
    fields: ['Unit', 'Issue'],
    history: 'IT History',
  },
  {
    ask: 'Need an event covered?',
    name: 'Event Documentation',
    icon: I.event,
    fields: ['Event & date', 'Time', 'Location', 'Program (optional)'],
    history: 'Event Documentation History',
  },
  {
    ask: 'Need a post, poster or presentation?',
    name: 'Digital Media',
    icon: I.digital,
    fields: ['Title & form', 'Description', 'Event / PPA', 'Target date', 'Files (optional)'],
    history: 'Digital Media History',
  },
  {
    ask: 'Need a tarp, flyer or brochure?',
    name: 'Print Materials',
    icon: I.print,
    fields: ['Form & size', 'Description', 'Event / PPA', 'Target date', 'Files (optional)'],
    history: 'Print Materials History',
  },
];

// The happy path, left to right, with what you can do at each stage as chips in its card.
const CANCEL = { label: 'Cancel', icon: I.x, tone: 'cancel' };
const NOTE = { label: 'Add a note', icon: I.note, tone: 'note' };
const RATE = { label: 'Rate', icon: I.star, tone: 'rate' };
const TRACK = [
  { status: 'PENDING', text: 'Waiting for staff', can: [CANCEL, NOTE] },
  { status: 'IN_PROGRESS', text: 'Being worked on', can: [NOTE] },
  { status: 'DONE', text: 'Finished', can: [RATE] },
  { status: 'RATED', text: 'You rated it. Thanks!', can: [] },
];

const TIPS = [
  { icon: I.camera, title: 'Keep your code', text: 'Screenshot it. It finds your request fast.', art: 'code' },
  { icon: I.alert, title: 'Urgent = emergencies', text: 'Work stopped, or due within 2 days.', art: 'priority' },
  { icon: I.note, title: 'Forgot something?', text: 'Add a note while it is still open.', art: 'note' },
  { icon: I.user, title: 'Your Profile', text: 'Change your name or password.', art: 'profile' },
];

const FAQ = [
  { q: 'I forgot my password.', a: 'Ask the IT office to reset it.' },
  { q: 'Can I edit a request?', a: 'Add a note with the correction. If it is all wrong, cancel it while Pending and submit a new one.' },
  { q: 'Why is there no Cancel button?', a: 'Someone is already working on it. Contact the office handling it.' },
  { q: 'My request was declined.', a: 'Open it to read the reason. If you can fix it (a new date, say), submit a new request.' },
  { q: 'I was signed out on my own.', a: 'Sessions end after a while idle. Sign in again; your requests are saved.' },
];

const STATS = [
  { value: '4', label: 'request types' },
  { value: '1', label: 'code to track it all' },
  { value: '0', label: 'page reloads needed' },
];

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function Stamp({ status, small }: { status: string; small?: boolean }) {
  return <span className={`gd-stamp gd-stamp-${status.toLowerCase()}${small ? ' gd-stamp-sm' : ''}`}>{status.replace(/_/g, ' ')}</span>;
}

// Little drawings of the real screens, one per step. Decorative: the caption says it in words.
function StepArt({ n }: { n: number }) {
  if (n === 0) {
    return (
      <div className="gd-mock">
        <div className="gd-mock-field"><Icon d={I.user} size={13} /><span>username</span></div>
        <div className="gd-mock-field"><Icon d={I.lock} size={13} /><span>••••••••</span></div>
        <div className="gd-mock-btn">Sign In</div>
      </div>
    );
  }
  if (n === 1) {
    return (
      <div className="gd-mock gd-mock-menu">
        {[['IT', I.it], ['Events', I.event], ['Digital', I.digital], ['Print', I.print]].map(([label, d], i) => (
          <div key={label} className={`gd-mock-pill${i === 0 ? ' is-on' : ''}`}>
            <Icon d={d} size={14} />
            <span>{label}</span>
            {i === 0 && <span className="gd-mock-cursor"><Icon d={I.pointer} size={18} /></span>}
          </div>
        ))}
      </div>
    );
  }
  if (n === 2) {
    return (
      <div className="gd-mock">
        <div className="gd-mock-line" style={{ width: '40%' }} />
        <div className="gd-mock-box" />
        <div className="gd-mock-line" style={{ width: '55%' }} />
        <div className="gd-mock-box" />
        <div className="gd-mock-code"><Icon d={I.check} size={14} />IT-2026-0042</div>
      </div>
    );
  }
  return (
    <div className="gd-mock">
      <div className="gd-mock-row">
        <span className="gd-mock-mono">IT-2026-0042</span>
        <Stamp status="DONE" small />
      </div>
      <div className="gd-mock-rate"><Icon d={I.star} size={14} />Rate</div>
    </div>
  );
}

function TipArt({ art }: { art: string }) {
  if (art === 'code') return <div className="gd-tip-code">IT-2026-0042</div>;
  if (art === 'priority') {
    return (
      <div className="gd-tip-prio">
        <span>Low</span>
        <span className="is-on">Normal</span>
        <span className="is-hot">Urgent</span>
      </div>
    );
  }
  if (art === 'note') return <div className="gd-tip-bubble">Wrong room, it is 2B<em>up to 500 characters</em></div>;
  return (
    <div className="gd-tip-profile">
      <span className="gd-tip-avatar">JD</span>
      <span className="gd-tip-menu"><span>Profile</span><span>Logout</span></span>
    </div>
  );
}

// A guide block: a small kicker, a big short title, and the picture. Rises in once on scroll.
function Block({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: React.ReactNode }) {
  return (
    <motion.section
      id={id}
      className="gd-block"
      aria-labelledby={`${id}-title`}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.08 }}
      variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } } }}
    >
      <p className="gd-kicker">{kicker}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </motion.section>
  );
}

// The guide's entrance follows the page-turn transition: the headline lines flip down onto the
// page like index cards on a top hinge, the copy comes into focus, and the numbers count up.
const SILK = [0.22, 1, 0.36, 1] as const;
const flipDown = {
  hidden: { rotateX: -100, opacity: 0 },
  visible: (delay: number) => ({ rotateX: 0, opacity: 1, transition: { duration: 0.95, delay, ease: SILK } }),
};

// Children that pop in one after another when their parent scrolls into view.
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.12 } } };
const pop = {
  hidden: { opacity: 0, y: 26, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 150, damping: 17 } },
};

// Answer height animates through grid rows (0fr -> 1fr); a native <details> can't ease closed.
function FaqItem({ q, a, id }: { q: string; a: string; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`gd-faq-item${open ? ' is-open' : ''}`}>
      <button type="button" className="gd-faq-q" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {q}
      </button>
      <div className="gd-faq-a" id={id} role="region">
        <div>
          <p>{a}</p>
        </div>
      </div>
    </div>
  );
}

function ClientGuide() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  // Waits for the page turn to open before the entrance plays.
  const d = useRevealDelay('guide');

  // Reading progress. Function form keeps framer from handing this to a native scroll timeline.
  const { scrollYProgress } = useScroll();
  const progress = useTransform(scrollYProgress, (p) => Math.min(1, Math.max(0, p)));

  // Smooth scrolling for the in-page links; restored when leaving the page.
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
    <div className="gd" style={{ '--intro-delay': `${d}s` } as React.CSSProperties}>
      <motion.div className="gd-progress" style={{ scaleX: progress }} aria-hidden="true" />

      <header className="gd-nav">
        <TransitionLink to="/" className="gd-brand">
          <img src="/solano-logo.png" alt="" />
          <span>ITRS</span>
          <span className="gd-brand-sub">Client guide</span>
        </TransitionLink>
        <TransitionLink to={home} className="gd-btn gd-btn-ink gd-btn-sm">{primaryLabel}</TransitionLink>
      </header>

      {/* ----- Hero ----- */}
      <section className="gd-hero">
        <Gear className="gd-gear gd-gear-hero" />
        <div className="gd-wrap gd-hero-inner">
          <motion.p
            className="gd-place"
            initial={{ opacity: 0, letterSpacing: '0.6em' }}
            animate={{ opacity: 1, letterSpacing: '0.16em' }}
            transition={{ duration: 0.9, delay: d, ease: SILK }}
          >
            Client guide
          </motion.p>
          <h1 className="gd-hero-title" aria-label="Request it in four steps.">
            <span className="gd-line" aria-hidden="true">
              <motion.span style={{ transformOrigin: '50% 0%', transformPerspective: 900 }} custom={d + 0.1} variants={flipDown} initial="hidden" animate="visible">
                Request it in
              </motion.span>
            </span>
            <span className="gd-line" aria-hidden="true">
              <motion.span style={{ transformOrigin: '50% 0%', transformPerspective: 900 }} custom={d + 0.26} variants={flipDown} initial="hidden" animate="visible">
                <span className="gd-highlight">four steps.</span>
              </motion.span>
            </span>
          </h1>
          {/* Comes into focus, like a page settling under the reading light */}
          <motion.div
            className="gd-hero-copy"
            initial={{ opacity: 0, y: 8, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, delay: d + 0.5, ease: EASE_OUT }}
          >
            <p>Repairs, event coverage, digital media and print, all from one place.</p>
            <div className="gd-hero-actions">
              <a href="#steps" className="gd-btn gd-btn-ink">See how it works<Icon d={I.arrow} size={18} /></a>
              <TransitionLink to={home} className="gd-btn gd-btn-line">{primaryLabel}</TransitionLink>
            </div>
          </motion.div>

          {/* Each stat's rule draws down, then its number counts to its value ("0 reloads" counts down) */}
          <dl className="gd-stats">
            {STATS.map((s, i) => {
              const at = d + 0.7 + i * 0.12;
              const to = Number(s.value);
              return (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
                  animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
                  transition={{ duration: 0.6, delay: at, ease: SILK }}
                >
                  <dt><CountUp from={to === 0 ? 9 : 0} to={to} delay={at} duration={1.1} /></dt>
                  <dd>{s.label}</dd>
                </motion.div>
              );
            })}
          </dl>
        </div>
      </section>

      <main className="gd-wrap gd-info">
        {/* ----- 1. The four steps ----- */}
        <Block id="steps" kicker="How it works" title="Four steps, start to finish">
          <motion.ol className="gd-flow" variants={stagger}>
            {STEPS.map((s, i) => (
              <motion.li key={s.title} className="gd-step" variants={pop}>
                <span className="gd-step-n" aria-hidden="true">{i + 1}</span>
                <div className="gd-step-art" aria-hidden="true"><StepArt n={i} /></div>
                <h3><Icon d={s.icon} size={20} />{s.title}</h3>
                <p>{s.text}</p>
                {i < STEPS.length - 1 && <span className="gd-step-arrow" aria-hidden="true"><Icon d={I.arrow} size={22} /></span>}
              </motion.li>
            ))}
          </motion.ol>
        </Block>

        {/* ----- 2. Which request ----- */}
        <Block id="types" kicker="Step 2" title="Which one do I pick?">
          <motion.div className="gd-types" variants={stagger}>
            {REQUEST_TYPES.map((t) => (
              <motion.article key={t.name} className="gd-type" variants={pop}>
                <span className="gd-type-icon" aria-hidden="true"><Icon d={t.icon} size={30} /></span>
                <p className="gd-type-ask">{t.ask}</p>
                <h3>{t.name}</h3>
                <ul className="gd-chips" aria-label="You will fill in">
                  {t.fields.map((f) => <li key={f}>{f}</li>)}
                </ul>
                <p className="gd-type-track"><Icon d={I.eye} size={14} />{t.history}</p>
              </motion.article>
            ))}
          </motion.div>
          <p className="gd-footnote">Your name, office and contact number fill in on their own, from your Profile.</p>
        </Block>

        {/* ----- 3. Statuses ----- */}
        <Block id="status" kicker="Step 4" title="Where is my request?">
          <div className="gd-track">
            <motion.span
              className="gd-track-line"
              aria-hidden="true"
              variants={{ hidden: { scaleX: 0, scaleY: 0 }, visible: { scaleX: 1, scaleY: 1, transition: { duration: 1.1, delay: 0.2, ease: SILK } } }}
            />
            {TRACK.map((t, i) => (
              <div key={t.status} className="gd-node" style={{ '--i': i + 1 } as React.CSSProperties}>
                <Stamp status={t.status} />
                <p>{t.text}</p>
                <div className="gd-can">
                  {t.can.length > 0 ? (
                    <>
                      <span className="gd-can-label">You can</span>
                      {t.can.map((c) => (
                        <span key={c.label} className={`gd-band gd-band-${c.tone}`}>
                          <Icon d={c.icon} size={14} />
                          {c.label}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="gd-can-label">All done</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="gd-offramp">
            <span className="gd-offramp-lead"><Icon d={I.exit} size={18} />Can also end as</span>
            <div><Stamp status="DECLINED" small /><span>The team can&apos;t take it. Open it to see why.</span></div>
            <div><Stamp status="CANCELLED" small /><span>You cancelled it.</span></div>
          </div>

          <div className="gd-live">
            <span className="gd-live-dot" aria-hidden="true" />
            Updates on its own. No need to reload.
          </div>
          <p className="gd-footnote">Event requests say <strong>Unassigned</strong> instead of Pending.</p>
        </Block>

        {/* ----- 4. Tips ----- */}
        <Block id="tips" kicker="Good to know" title="Four quick tips">
          <motion.div className="gd-tips" variants={stagger}>
            {TIPS.map((t) => (
              <motion.article key={t.title} className="gd-tip" variants={pop}>
                <div className="gd-tip-art" aria-hidden="true"><TipArt art={t.art} /></div>
                <h3><Icon d={t.icon} size={18} />{t.title}</h3>
                <p>{t.text}</p>
              </motion.article>
            ))}
          </motion.div>
        </Block>

        {/* ----- 5. FAQ ----- */}
        <Block id="faq" kicker="Still stuck?" title="Quick answers">
          <div className="gd-faq">
            {FAQ.map((item, i) => (
              <FaqItem key={item.q} id={`faq-a-${i}`} q={item.q} a={item.a} />
            ))}
          </div>
        </Block>
      </main>

      {/* ----- Finale ----- */}
      <footer className="gd-finale">
        <Gear className="gd-gear gd-gear-finale" />
        <div className="gd-wrap gd-finale-inner">
          <h2 className="gd-finale-title">
            Ready to submit a <span className="gd-finale-mark">request?</span>
          </h2>
          <div className="gd-finale-row">
            <p>
              No account yet? Visit the Information and Technology Section (Mayor&apos;s Office), 2nd floor of the
              Municipal Hall.
            </p>
            <TransitionLink to={home} className="gd-btn gd-btn-yellow">{primaryLabel}<Icon d={I.arrow} size={18} /></TransitionLink>
          </div>
          <div className="gd-credits">
            <TransitionLink to="/" className="gd-credits-brand">
              <img src="/solano-logo.png" alt="Seal of the Municipality of Solano" />
              ITRS, Municipality of Solano, Nueva Vizcaya
            </TransitionLink>
            <span>&copy; 2026 Dave Shadrach B. Lannu</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default ClientGuide;
