import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE_OUT } from '../lib/motion';
import { io } from 'socket.io-client';
import api from '../services/api';

// Wall display of requests still waiting for assignment. It has no login; the backend only serves it to
// addresses in LIVE_ALLOWED_CIDRS. The initial queue comes from /api/live/queue and changes arrive on
// the /live Socket.IO namespace.

type Lane = 'it' | 'multimedia' | 'digital_media' | 'print_materials';
type Outcome = 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

interface LiveCard {
  id: string;
  lane: Lane;
  request_code: string;
  priority: string;
  summary: string;
  requester: string;
  office: string;
  due: string | null;
  created_at: string;
}

interface BoardCard extends LiveCard {
  isNew?: boolean;
  leaving?: { outcome: Outcome; by: string | null };
}

const LANES: { key: Lane; label: string; dueLabel: string }[] = [
  { key: 'it', label: 'IT Repair', dueLabel: 'Due' },
  { key: 'multimedia', label: 'Multimedia', dueLabel: 'Event' },
  { key: 'digital_media', label: 'Digital Media', dueLabel: 'Target' },
  { key: 'print_materials', label: 'Print Materials', dueLabel: 'Target' }
];

// Minutes waiting before a card's border turns amber, then red.
const AGE_WARN_MIN = 15;
const AGE_ALERT_MIN = 60;
const NEW_HIGHLIGHT_MS = 10_000;
const LEAVE_MS = 5_000;
// Reload the whole queue now and then, in case an update was lost without the socket dropping.
const RESYNC_MS = 10 * 60_000;
const RETRY_MS = 15_000;
const CHIME_GAP_MS = 2_000;
const TIME_ZONE = 'Asia/Manila';

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, NORMAL: 1, LOW: 2 };
const OUTCOME_TEXT: Record<Outcome, string> = { ACCEPTED: 'Accepted', DECLINED: 'Declined', CANCELLED: 'Cancelled' };

// Most urgent first, then longest waiting.
function byQueueOrder(a: BoardCard, b: BoardCard) {
  const rank = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  return rank !== 0 ? rank : Date.parse(a.created_at) - Date.parse(b.created_at);
}

function formatWait(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// Due dates are YYYY-MM-DD calendar days.
function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

type AudioContextCtor = typeof AudioContext;

function createAudioContext(): AudioContext | null {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

// Two short rising tones, generated so there is no sound file to ship.
function playChime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = t + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  });
}

function LaneColumn({ lane, label, dueLabel, cards, now }: { lane: Lane; label: string; dueLabel: string; cards: BoardCard[]; now: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  // Cards that do not fit whole are hidden and counted in the footer instead of being cut off.
  const [hiddenKey, setHiddenKey] = useState('');

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const current = new Set(cards.map((c) => c.id));
    const hidden: string[] = [];
    list.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
      const id = el.dataset.cardId!;
      // Cards still playing their exit animation are not part of the queue.
      if (current.has(id) && el.offsetTop + el.offsetHeight > list.clientHeight) hidden.push(id);
    });
    const key = hidden.join(',');
    setHiddenKey((prev) => (prev === key ? prev : key));
  }, [cards]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const hidden = new Set(hiddenKey ? hiddenKey.split(',') : []);
  const waiting = cards.filter((c) => !c.leaving);
  const hiddenWaiting = waiting.filter((c) => hidden.has(c.id));
  const hiddenNew = hiddenWaiting.filter((c) => c.isNew);

  return (
    <section className={`live-lane live-lane--${lane}`}>
      <header className="live-lane-head">
        <h2>{label}</h2>
        <span className="live-lane-count">{waiting.length}</span>
      </header>
      <div className="live-lane-list" ref={listRef}>
        {cards.length === 0 && <p className="live-lane-empty">No requests waiting</p>}
        <AnimatePresence initial={false} onExitComplete={measure}>
          {cards.map((card) => {
            const waitedMin = (now - Date.parse(card.created_at)) / 60_000;
            const classes = ['live-card'];
            if (card.priority === 'URGENT') classes.push('live-card--urgent');
            if (waitedMin >= AGE_ALERT_MIN) classes.push('live-card--age-alert');
            else if (waitedMin >= AGE_WARN_MIN) classes.push('live-card--age-warn');
            if (card.isNew) classes.push('live-card--new');
            if (card.leaving) classes.push(`live-card--leaving live-card--${card.leaving.outcome.toLowerCase()}`);
            return (
              <motion.article
                key={card.id}
                data-card-id={card.id}
                className={classes.join(' ')}
                style={hidden.has(card.id) ? { visibility: 'hidden' } : undefined}
                layout="position"
                initial={{ opacity: 0, y: -24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 60, transition: { duration: 0.25, ease: EASE_OUT } }}
                transition={{ duration: 0.4, ease: EASE_OUT }}
              >
                <div className="live-card-top">
                  <span className="live-card-code">{card.request_code}</span>
                  {card.priority !== 'NORMAL' && (
                    <span className={`live-card-priority live-card-priority--${card.priority.toLowerCase()}`}>{card.priority}</span>
                  )}
                  {!card.leaving && <span className="live-card-wait">{formatWait(now - Date.parse(card.created_at))}</span>}
                </div>
                {card.summary && <p className="live-card-summary">{card.summary}</p>}
                <p className="live-card-meta">
                  {[card.requester, card.office].filter(Boolean).join(' · ')}
                  {card.due && <span className="live-card-due"> · {dueLabel} {formatDay(card.due)}</span>}
                </p>
                {card.leaving && (
                  <p className="live-card-outcome">
                    {OUTCOME_TEXT[card.leaving.outcome]}
                    {card.leaving.by ? ` by ${card.leaving.by}` : ''}
                  </p>
                )}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
      {hiddenWaiting.length > 0 && (
        <footer className={`live-lane-more ${hiddenNew.length > 0 ? 'live-lane-more--new' : ''}`}>
          +{hiddenWaiting.length} more waiting
          {hiddenNew.length > 0 && <span> · new: {hiddenNew.map((c) => c.request_code).join(', ')}</span>}
        </footer>
      )}
    </section>
  );
}

export default function LiveQueue() {
  const [cards, setCards] = useState<BoardCard[]>([]);
  // Socket handlers read the latest cards from here; they are registered once.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  // The TV's own clock may be wrong, so waiting times run on the server's clock.
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const audioRef = useRef<AudioContext | null>(null);
  const lastChimeRef = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const retryPendingRef = useRef(false);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/live/queue');
      offsetRef.current = Date.parse(data.server_time) - Date.now();
      setNow(Date.now() + offsetRef.current);
      const incoming: LiveCard[] = LANES.flatMap((l) => data.lanes?.[l.key] || []);
      setCards((prev) => {
        const incomingIds = new Set(incoming.map((c) => c.id));
        const prevById = new Map(prev.map((c) => [c.id, c]));
        // Keep highlights on cards already shown, and let cards that just left finish their outcome flash.
        const kept = incoming.map((c) => ({ ...c, isNew: prevById.get(c.id)?.isNew }));
        const leaving = prev.filter((c) => c.leaving && !incomingIds.has(c.id));
        return [...kept, ...leaving];
      });
      setForbidden(false);
      setLoaded(true);
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 403) {
        setForbidden(true);
      } else if (!retryPendingRef.current) {
        // One retry at a time, however many loads (reconnects, resyncs) fail during an outage.
        retryPendingRef.current = true;
        later(() => {
          retryPendingRef.current = false;
          load();
        }, RETRY_MS);
      }
    }
  }, [later]);

  const chime = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || ctx.state !== 'running' || Date.now() - lastChimeRef.current < CHIME_GAP_MS) return;
    lastChimeRef.current = Date.now();
    playChime(ctx);
  }, []);

  useEffect(() => {
    const socket = io('/live', { transports: ['websocket', 'polling'] });

    // Fires on the first connection and on every reconnection; reloading covers anything missed meanwhile.
    socket.on('connect', () => {
      setConnected(true);
      load();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'Forbidden') setForbidden(true);
    });

    socket.on('live:added', ({ card }: { card: LiveCard }) => {
      if (cardsRef.current.some((c) => c.id === card.id)) return;
      setCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, { ...card, isNew: true }]));
      chime();
      later(() => setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, isNew: false } : c))), NEW_HIGHLIGHT_MS);
    });

    socket.on('live:changed', ({ card }: { card: LiveCard }) => {
      setCards((prev) => prev.map((c) => (c.id === card.id && !c.leaving ? { ...card, isNew: c.isNew } : c)));
    });

    socket.on('live:removed', ({ id, outcome, by }: { id: string; outcome: Outcome; by: string | null }) => {
      setCards((prev) => prev.map((c) => (c.id === id && !c.leaving ? { ...c, isNew: false, leaving: { outcome, by } } : c)));
      later(() => setCards((prev) => prev.filter((c) => c.id !== id)), LEAVE_MS);
    });

    const resync = setInterval(load, RESYNC_MS);
    const tick = setInterval(() => setNow(Date.now() + offsetRef.current), 10_000);
    const timers = timersRef.current;

    return () => {
      socket.disconnect();
      clearInterval(resync);
      clearInterval(tick);
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [load, chime, later]);

  // Browsers keep sound off until someone interacts with the page. A kiosk browser started with
  // autoplay allowed needs no click; otherwise the first click anywhere turns the chime on.
  useEffect(() => {
    const ctx = createAudioContext();
    audioRef.current = ctx;
    if (ctx?.state === 'running') setSoundOn(true);
    return () => {
      ctx?.close();
    };
  }, []);

  useEffect(() => {
    if (soundOn) return;
    const enable = () => {
      const ctx = audioRef.current;
      if (!ctx) return;
      ctx.resume().then(() => {
        setSoundOn(true);
        playChime(ctx);
      }).catch(() => {});
    };
    window.addEventListener('pointerdown', enable);
    window.addEventListener('keydown', enable);
    return () => {
      window.removeEventListener('pointerdown', enable);
      window.removeEventListener('keydown', enable);
    };
  }, [soundOn]);

  if (forbidden) {
    return (
      <div className="live-board live-board--message">
        <p>The live request queue is only available on the office network.</p>
      </div>
    );
  }

  const totalWaiting = cards.filter((c) => !c.leaving).length;
  const clock = new Date(now);

  return (
    <div className="live-board">
      <header className="live-head">
        <img src="/solano-logo.png" alt="" className="live-head-logo" />
        <div className="live-head-title">
          <h1>Request Queue</h1>
          <span>{loaded ? `${totalWaiting} waiting` : 'Loading…'}</span>
        </div>
        <div className="live-head-clock">
          <span className="live-head-time">
            {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE })}
          </span>
          <span className="live-head-date">
            {clock.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TIME_ZONE })}
          </span>
        </div>
        <span className={`live-status ${connected ? 'live-status--on' : ''}`}>{connected ? 'Live' : 'Reconnecting…'}</span>
      </header>

      <main className="live-lanes">
        {LANES.map((lane) => (
          <LaneColumn
            key={lane.key}
            lane={lane.key}
            label={lane.label}
            dueLabel={lane.dueLabel}
            cards={cards.filter((c) => c.lane === lane.key).sort(byQueueOrder)}
            now={now}
          />
        ))}
      </main>

      {!soundOn && <div className="live-sound-hint">Click anywhere to turn on the new-request chime</div>}
    </div>
  );
}
