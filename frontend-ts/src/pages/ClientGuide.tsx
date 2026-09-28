import { Link } from 'react-router-dom';
import { renderStatusBadge } from '../components/HistoryTable';

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
      'Unit: Desktop, Laptop, Network or Others',
      'Semester (optional)',
      'Issue: a short description, up to 100 characters',
    ],
    note: 'Your office is filled in automatically from your account.',
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
    icon: 'M2 3h20v14H2z M8 21h8 M12 17v4',
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
  { status: 'IN_PROGRESS', meaning: 'Someone has been assigned and is working on it. The Assigned To column shows who.' },
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

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ClientGuide() {
  return (
    <div className="guide-page">
      <header className="guide-topbar">
        <div className="guide-topbar-inner">
          <Link to="/" className="guide-brand">
            <img src="/solano-logo.png" alt="" className="guide-brand-seal" />
            <span>ITRS</span>
          </Link>
          <Link to="/" className="guide-signin">Sign in</Link>
        </div>
      </header>

      <main className="guide-main">
        <div className="guide-intro">
          <p className="guide-eyebrow">Client guide</p>
          <h1>How to request IT and media services</h1>
          <p className="guide-lede">
            ITRS is how LGU Solano offices ask the IT and multimedia teams for help: computer and network
            repairs, event coverage, digital media, and print materials. This page walks you through
            submitting a request and following it until it is done.
          </p>
        </div>

        <nav className="guide-toc" aria-label="On this page">
          <p className="guide-toc-title">On this page</p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.label}</a></li>
            ))}
          </ol>
        </nav>

        <section id="sign-in" className="guide-section">
          <h2><span className="guide-num">1</span>Signing in</h2>
          <ol className="guide-steps">
            <li>Open ITRS and enter the <strong>username</strong> and <strong>password</strong> given to you by the IT office.</li>
            <li>Select <strong>Sign In</strong>. You will land on the IT Request page.</li>
            <li>If you are still using the default password, the system will remind you to change it. Go to <strong>Profile</strong> and set a new one before continuing.</li>
          </ol>
        </section>

        <section id="request-types" className="guide-section">
          <h2><span className="guide-num">2</span>Request types</h2>
          <p>The left sidebar lists four kinds of requests. Each one has its own form and its own history page.</p>
          <div className="guide-cards">
            {REQUEST_TYPES.map((t) => (
              <article key={t.name} className="guide-card">
                <div className="guide-card-head">
                  <span className="guide-card-icon"><Icon d={t.icon} /></span>
                  <h3>{t.name}</h3>
                </div>
                <p className="guide-card-use">{t.use}</p>
                <p className="guide-card-label">What you will fill in</p>
                <ul>
                  {t.fields.map((f) => <li key={f}>{f}</li>)}
                </ul>
                {t.note && <p className="guide-card-note">{t.note}</p>}
                <p className="guide-card-foot">Track it under <strong>{t.history}</strong>.</p>
              </article>
            ))}
          </div>
        </section>

        <section id="submit" className="guide-section">
          <h2><span className="guide-num">3</span>Submitting a request</h2>
          <ol className="guide-steps">
            <li>Choose the request type from the sidebar.</li>
            <li>Fill in the form. Fields marked with <strong>*</strong> are required.</li>
            <li>Attach files if the form allows it and they will help the team.</li>
            <li>Select <strong>Submit</strong>. A confirmation shows your <strong>request code</strong>.</li>
          </ol>
          <div className="guide-callout">
            <Icon d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z M12 16v-4 M12 8h.01" size={18} />
            <p>Write down or screenshot your request code. It is the fastest way to find your request and to refer to it when you talk to the IT office.</p>
          </div>
        </section>

        <section id="track" className="guide-section">
          <h2><span className="guide-num">4</span>Tracking your requests</h2>
          <p>
            Open the matching <strong>History</strong> page in the sidebar. Each row shows the request code, its
            status and who it is assigned to. The list refreshes on its own when your request is accepted or
            finished, so there is no need to reload. Use the search box to find a request by code or keyword,
            and <strong>View</strong> to see its full details and attachments.
          </p>
          <div className="guide-table-wrap">
            <table className="guide-table">
              <thead>
                <tr><th>Status</th><th>What it means</th></tr>
              </thead>
              <tbody>
                {STATUSES.map((s) => (
                  <tr key={s.status}>
                    <td>{renderStatusBadge(s.status)}</td>
                    <td>{s.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="notes" className="guide-section">
          <h2><span className="guide-num">5</span>Adding details later</h2>
          <p>
            Forgot something, or did something change? While a request is Pending, Unassigned or In Progress, open it
            from its History page (<strong>Details / Add note</strong> on IT History, <strong>View / Add note</strong> on the
            others) and write a note of up to 500 characters. The assigned staff member is notified right away, and your
            notes stay attached to the request.
          </p>
          <p>Notes cannot be added after a request is Done, Declined or Cancelled.</p>
        </section>

        <section id="cancel-rate" className="guide-section">
          <h2><span className="guide-num">6</span>Cancelling and rating</h2>
          <div className="guide-two">
            <div>
              <h3>Cancel</h3>
              <p>A <strong>Cancel</strong> button appears on a request while it is Pending or Unassigned. Confirm when asked. After someone is assigned, the request can no longer be cancelled from ITRS.</p>
            </div>
            <div>
              <h3>Rate</h3>
              <p>When a request is Done, select <strong>Rate</strong> to open the client satisfaction feedback form in a new tab. Your rating helps the team improve its service.</p>
            </div>
          </div>
        </section>

        <section id="account" className="guide-section">
          <h2><span className="guide-num">7</span>Your account</h2>
          <p>Open <strong>Profile</strong> at the bottom of the sidebar to:</p>
          <ul className="guide-list">
            <li>Update your first, middle and last name.</li>
            <li>Change your password (at least 8 characters). You will need your current password.</li>
          </ul>
          <p>The sidebar also has a light and dark mode switch, and <strong>Logout</strong> to end your session on shared computers.</p>
        </section>

        <section id="faq" className="guide-section">
          <h2><span className="guide-num">8</span>Common questions</h2>
          <div className="guide-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="guide-cta">
          <p>Ready to submit a request?</p>
          <Link to="/" className="guide-cta-btn">Go to sign in</Link>
        </div>
      </main>

      <footer className="guide-footer">2026 © Dave Shadrach B. Lannu</footer>
    </div>
  );
}

export default ClientGuide;
