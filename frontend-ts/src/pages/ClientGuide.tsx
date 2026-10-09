import { useEffect, useState } from 'react';
import { TransitionLink } from '../components/PageCurtain';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { EASE_OUT } from '../lib/motion';
import { CountUp, useRevealDelay } from '../components/Entrance';

// Public client guide at /guide, styled like the landing page: paper, ink, tickets and stamps.

const GEAR_PATH = 'M77.8 -18.7 L98.8 -15.6 L98.8 15.6 L77.8 18.7 L68.2 41.8 L80.9 58.8 L58.8 80.9 L41.8 68.2 L18.7 77.8 L15.6 98.8 L-15.6 98.8 L-18.7 77.8 L-41.8 68.2 L-58.8 80.9 L-80.9 58.8 L-68.2 41.8 L-77.8 18.7 L-98.8 15.6 L-98.8 -15.6 L-77.8 -18.7 L-68.2 -41.8 L-80.9 -58.8 L-58.8 -80.9 L-41.8 -68.2 L-18.7 -77.8 L-15.6 -98.8 L15.6 -98.8 L18.7 -77.8 L41.8 -68.2 L58.8 -80.9 L80.9 -58.8 L68.2 -41.8 Z';
const ARROW = 'M5 12h14 M13 6l6 6-6 6';

const SECTIONS = [
  { id: 'sign-in', label: 'Signing in' },
  { id: 'request-types', label: 'Request types' },
  { id: 'submit', label: 'Submitting a request' },
  { id: 'track', label: 'Tracking your requests' },
  { id: 'notes', label: 'Adding details later' },
  { id: 'cancel-rate', label: 'Cancelling and rating' },
  { id: 'account', label: 'Your account' },
  { id: 'faq', label: 'Common questions' },
];

const REQUEST_TYPES = [
  {
    name: 'IT Request',
    icon: 'M2 3h20v14H2z M8 21h8 M12 17v4',
    use: 'Repairs and troubleshooting for office computers and network.',
    fields: [
      'Unit: Desktop, Laptop, Network or Others (say what it is)',
      'Issue: a short description, up to 100 characters',
    ],
    note: 'Your office is filled in automatically from your account, and the semester from the date you submit.',
    history: 'IT History',
  },
  {
    name: 'Multimedia Request',
    icon: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z',
    use: 'Photo and video coverage of an event.',
    fields: [
      'Event title, date, start time and estimated end time',
      'Contact number',
      'Location type (inside the LGU Solano compound, elsewhere in Solano, elsewhere in Nueva Vizcaya, or outside Nueva Vizcaya) and the specific location',
      'Program or schedule of the event (optional): one PDF, Word or image file, up to 10MB',
    ],
    history: 'Multimedia History',
  },
  {
    name: 'Digital Media Request',
    icon: 'M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
    use: 'Social media posts, digital posters, PowerPoint or video presentations.',
    fields: [
      'Title and form of digital media',
      'Description of what you need',
      'Name of the related event or PPA',
      'Target date and time of posting or use',
      'Requestor name and contact number',
      'Supporting files (optional): up to 10 files, 100MB total (PDF, Word, images, PowerPoint, MP4, WebM)',
    ],
    history: 'Digital Media History',
  },
  {
    name: 'Print Materials Request',
    icon: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z',
    use: 'Design and production of tarpaulins, brochures, flyers and other printed materials.',
    fields: [
      'Form of printed media and its size',
      'Description of what you need',
      'Name of the related event or PPA',
      'Target date and time of posting or use',
      'Requestor name and contact number',
      'Reference files (optional): up to 10 files, 100MB total (PDF, Word, images, AI, PSD, TIFF)',
    ],
    history: 'Print Materials History',
  },
];

const STATUSES = [
  { status: 'PENDING', meaning: 'Received and waiting for a technician or staff member to be assigned. You can still cancel it.' },
  { status: 'UNASSIGNED', meaning: 'Same as Pending. Multimedia requests use this label before someone is assigned.' },
  { status: 'IN_PROGRESS', meaning: 'Someone has been assigned and is working on it. The Assigned To column shows who; if the team moves it to another staff member, the name updates on its own.' },
  { status: 'DONE', meaning: 'Finished. On IT History this shows as Completed, along with whether the unit was Repaired or is Beyond Repair.' },
  { status: 'DECLINED', meaning: 'The team could not take this request, for example because of a schedule conflict or because it is outside what they handle. Open the request to read the reason.' },
  { status: 'CANCELLED', meaning: 'You cancelled the request. No further action will be taken.' },
];

const FAQ = [
  {
    q: 'I forgot my password. What do I do?',
    a: 'Contact the IT office and ask them to reset it. Password reset is not available from the sign-in page yet.',
  },
  {
    q: 'Can I edit a request after submitting it?',
    a: 'You cannot change the original form, but you can add a note with corrections or extra details while the request is Pending, Unassigned or In Progress. If the details are completely wrong, cancel it while it is still Pending and submit a new one.',
  },
  {
    q: 'Why can I not cancel my request?',
    a: 'Cancelling is only possible before someone is assigned. Once it is In Progress, contact the office handling it.',
  },
  {
    q: 'My request was declined. What now?',
    a: 'Read the reason on the request, then contact the office that declined it if you need clarification. If the reason can be fixed, such as a different date, submit a new request.',
  },
  {
    q: 'I was signed out on my own.',
    a: 'Sessions expire after a period of inactivity. Sign in again and continue where you left off; submitted requests are saved.',
  },
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

function Stamp({ status }: { status: string }) {
  return <span className={`gd-stamp gd-stamp-${status.toLowerCase()}`}>{status.replace(/_/g, ' ')}</span>;
}

// A numbered guide section that rises in once as it scrolls into view; its number flips over
// like an index tab as it arrives.
function Section({ id, n, title, tag, children }: { id: string; n: number; title: string; tag?: string; children: React.ReactNode }) {
  return (
    <motion.section
      id={id}
      className="gd-section"
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.08 }}
      variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } } }}
    >
      <h2>
        <motion.span
          className="gd-num"
          aria-hidden="true"
          style={{ transformPerspective: 400 }}
          variants={{ hidden: { rotateY: -180 }, visible: { rotateY: 0, transition: { type: 'spring', stiffness: 160, damping: 14, delay: 0.15 } } }}
        >
          {n}
        </motion.span>
        {title}
        {tag && <span className="gd-tag">{tag}</span>}
      </h2>
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
  const [active, setActive] = useState(SECTIONS[0].id);

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

  // Highlight the section being read in the table of contents.
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    // Sections crossing a band near the top of the screen; the latest one in reading order wins.
    const inBand = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? inBand.add(e.target.id) : inBand.delete(e.target.id)));
        const current = [...SECTIONS].reverse().find((s) => inBand.has(s.id));
        if (current) setActive(current.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

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
            <p>
              ITRS is how LGU Solano offices ask the IT and multimedia teams for help: computer and network
              repairs, event coverage, digital media, and print materials. This page walks you through
              submitting a request and following it until it is done.
            </p>
            <div className="gd-hero-actions">
              <a href="#submit" className="gd-btn gd-btn-ink">See how it works<Icon d={ARROW} size={18} /></a>
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

      {/* ----- Body: contents + sections ----- */}
      <div className="gd-wrap gd-body">
        <nav className="gd-toc" aria-label="On this page">
          <p className="gd-toc-title">On this page</p>
          <ol>
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={active === s.id ? 'is-active' : ''} aria-current={active === s.id ? 'location' : undefined}>
                  <span className="gd-toc-n">{i + 1}</span>
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className="gd-main">
          <Section id="sign-in" n={1} title="Signing in">
            <ol className="gd-steps">
              <li>Open ITRS and enter your <strong>username</strong> and <strong>password</strong>. If you signed up yourself, wait until the IT office approves your account first; until then, signing in says it is waiting for approval.</li>
              <li>Select <strong>Sign In</strong>. You will land on the IT Request page.</li>
              <li>If you are still using the default password, the system will remind you to change it. Go to <strong>Profile</strong> and set a new one before continuing.</li>
            </ol>
          </Section>

          <Section id="request-types" n={2} title="Request types">
            <p>The left sidebar lists four kinds of requests. Each one has its own form and its own history page.</p>
            <div className="gd-tickets">
              {/* Dealt onto the table one after another, each landing from its own angle */}
              {REQUEST_TYPES.map((t, i) => (
                <motion.article
                  key={t.name}
                  className="gd-ticket"
                  initial={{ opacity: 0, y: 60, x: (i % 2 ? 1 : -1) * 30, rotate: (i % 2 ? 1 : -1) * 7 }}
                  whileInView={{ opacity: 1, y: 0, x: 0, rotate: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ type: 'spring', stiffness: 120, damping: 16, delay: (i % 2) * 0.1 }}
                >
                  <div className="gd-ticket-head">
                    <Icon d={t.icon} size={16} />
                    <h3>{t.name}</h3>
                  </div>
                  <div className="gd-ticket-body">
                    <p className="gd-ticket-use">{t.use}</p>
                    <p className="gd-ticket-label">What you will fill in</p>
                    <ul>
                      {t.fields.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                    {t.note && <p className="gd-ticket-note">{t.note}</p>}
                  </div>
                  <div className="gd-ticket-tear" aria-hidden="true" />
                  <p className="gd-ticket-stub">Track it under <strong>{t.history}</strong></p>
                </motion.article>
              ))}
            </div>
          </Section>

          <Section id="submit" n={3} title="Submitting a request">
            <ol className="gd-steps">
              <li>Choose the request type from the sidebar.</li>
              <li>Fill in the form. Fields marked with <strong>*</strong> are required.</li>
              <li>Set the <strong>Priority</strong>. Leave it at Normal unless work has stopped or your deadline is within two days. Keeping Urgent for real emergencies means they get handled first.</li>
              <li>Attach files if the form allows it and they will help the team.</li>
              <li>Select <strong>Submit</strong>. A confirmation shows your <strong>request code</strong>.</li>
            </ol>
            <aside className="gd-sticky">
              <p className="gd-sticky-title">Keep your code</p>
              <p>Write down or screenshot your request code. It is the fastest way to find your request and to refer to it when you talk to the IT office.</p>
            </aside>
          </Section>

          <Section id="track" n={4} title="Tracking your requests">
            <p>
              Open the matching <strong>History</strong> page in the sidebar. Each row shows the request code, its
              status and who it is assigned to. The list refreshes on its own when your request is accepted or
              finished, so there is no need to reload. Use the search box to find a request by code or keyword,
              and <strong>View</strong> to see its full details and attachments.
            </p>
            <dl className="gd-statuses">
              {STATUSES.map((s) => (
                <div key={s.status}>
                  <dt><Stamp status={s.status} /></dt>
                  <dd>{s.meaning}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="notes" n={5} title="Adding details later" tag="Bonus">
            <p>
              Forgot something, or did something change? While a request is Pending, Unassigned or In Progress, open it
              from its History page (<strong>Details / Add note</strong> on IT History, <strong>View / Add note</strong> on the
              others) and write a note of up to 500 characters. The assigned staff member is notified right away, and your
              notes stay attached to the request.
            </p>
            <p>Notes cannot be added after a request is Done, Declined or Cancelled.</p>
          </Section>

          <Section id="cancel-rate" n={6} title="Cancelling and rating">
            <div className="gd-two">
              <div>
                <h3>Cancel</h3>
                <p>A <strong>Cancel</strong> button appears on a request while it is Pending or Unassigned. Confirm when asked. After someone is assigned, the request can no longer be cancelled from ITRS.</p>
              </div>
              <div>
                <h3>Rate</h3>
                <p>When a request is Done, select <strong>Rate</strong> to open the client satisfaction feedback form in a new tab. Your rating helps the team improve its service.</p>
              </div>
            </div>
          </Section>

          <Section id="account" n={7} title="Your account">
            <p>Open <strong>Profile</strong> at the bottom of the sidebar to:</p>
            <ul className="gd-list">
              <li>Update your first, middle and last name.</li>
              <li>Change your password (at least 8 characters). You will need your current password.</li>
            </ul>
            <p>The sidebar also has <strong>Logout</strong> to end your session on shared computers.</p>
          </Section>

          <Section id="faq" n={8} title="Common questions">
            <div className="gd-faq">
              {FAQ.map((item, i) => (
                <FaqItem key={item.q} id={`faq-a-${i}`} q={item.q} a={item.a} />
              ))}
            </div>
          </Section>
        </main>
      </div>

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
            <TransitionLink to={home} className="gd-btn gd-btn-yellow">{primaryLabel}<Icon d={ARROW} size={18} /></TransitionLink>
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
