// Sound effects for the page transitions, synthesised with the Web Audio API so there are no
// sound files to ship. Each transition has its own cue sheet, timed against the same constants
// as its animation (see the comments on each cue), so every sound lands on something you see.
//
// Browsers only allow audio after the user has interacted with the page; the first click, tap or
// key press anywhere unlocks it. Every transition starts from a click, so this is always in time.
// Cues are skipped when sound is turned off (setSoundEnabled) and never throw: audio is decoration.

type Ctor = typeof AudioContext;

const STORAGE_KEY = 'itrs-sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the setting just doesn't persist.
  }
}

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const C: Ctor | undefined = window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    return null;
  }
  // A gentle limiter so overlapping layers never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(comp);
  comp.connect(ctx.destination);

  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/** Resumes audio. Only works from inside a user gesture (click, tap or key press). */
function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  c.resume().catch(() => {});
  try {
    // Older iOS also needs a sound started from within the gesture.
    const silent = c.createBufferSource();
    silent.buffer = c.createBuffer(1, 1, 22050);
    silent.connect(c.destination);
    silent.start(0);
  } catch {
    // Ignore.
  }
}

// Unlock on the visitor's gestures until it takes, so later cues can start even when they follow
// an await. A finger going down does not count as a gesture on touch screens (lifting it, or the
// click, does), so keep listening until the context is actually running.
if (typeof window !== 'undefined') {
  const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const onGesture = () => {
    unlockAudio();
    if (ctx?.state === 'running') events.forEach((e) => window.removeEventListener(e, onGesture, true));
  };
  events.forEach((e) => window.addEventListener(e, onGesture, true));
}

/* ---------- building blocks ---------- */

interface Stage {
  c: AudioContext;
  out: AudioNode;
  /** Absolute context time for `sec` seconds into the cue. */
  at: (sec: number) => number;
}

export interface CueHandle {
  /** Fades out whatever of this cue is still playing (e.g. when the transition is skipped). */
  stop: (fade?: number) => void;
}

const NOOP: CueHandle = { stop: () => {} };

function cue(build: (s: Stage) => void): CueHandle {
  if (!soundEnabled()) return NOOP;
  const c = getCtx();
  if (!c || !master) return NOOP;
  try {
    if (c.state !== 'running') c.resume().catch(() => {});
    // While the context is still resuming its clock is frozen, so times scheduled from it stay
    // in step with each other and just start a moment later.
    const t0 = c.currentTime + 0.03;
    const bus = c.createGain();
    bus.connect(master);
    build({ c, out: bus, at: (sec) => t0 + sec });
    let stopped = false;
    return {
      stop: (fade = 0.15) => {
        if (stopped) return;
        stopped = true;
        const now = c.currentTime;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.linearRampToValueAtTime(0, now + fade);
        window.setTimeout(() => bus.disconnect(), (fade + 0.1) * 1000);
      },
    };
  } catch {
    return NOOP;
  }
}

/** Optional stereo position; a [from, to] pair glides across the sound's duration. */
type Pan = number | [number, number];

function panned(s: Stage, pan: Pan | undefined, start: number, dur: number): AudioNode {
  if (pan === undefined || !s.c.createStereoPanner) return s.out;
  const [from, to] = Array.isArray(pan) ? pan : [pan, pan];
  const p = s.c.createStereoPanner();
  p.pan.setValueAtTime(from, start);
  if (to !== from) p.pan.linearRampToValueAtTime(to, start + dur);
  p.connect(s.out);
  return p;
}

function noiseSource(s: Stage, start: number, dur: number): AudioBufferSourceNode {
  const src = s.c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start(start, Math.random() * 1.5);
  src.stop(start + dur + 0.05);
  return src;
}

/** Exponential swell up to `peak` at `peakAt` (0-1 of dur), then away by the end. */
function swell(g: AudioParam, start: number, dur: number, peak: number, peakAt: number) {
  g.setValueAtTime(0.0001, start);
  g.exponentialRampToValueAtTime(peak, start + Math.max(dur * peakAt, 0.005));
  g.exponentialRampToValueAtTime(0.0001, start + dur);
}

/** Air moving: band-passed noise whose pitch glides from `from` to `to` Hz. */
function whoosh(s: Stage, sec: number, dur: number, o: { from: number; to: number; gain: number; q?: number; peakAt?: number; pan?: Pan }) {
  const start = s.at(sec);
  const bp = s.c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = o.q ?? 0.9;
  bp.frequency.setValueAtTime(o.from, start);
  bp.frequency.exponentialRampToValueAtTime(o.to, start + dur);
  const g = s.c.createGain();
  swell(g.gain, start, dur, o.gain, o.peakAt ?? 0.6);
  noiseSource(s, start, dur).connect(bp);
  bp.connect(g);
  g.connect(panned(s, o.pan, start, dur));
}

/** A pitched note, optionally gliding to `to` Hz. */
function tone(s: Stage, sec: number, freq: number, dur: number, o: { gain: number; type?: OscillatorType; to?: number; attack?: number; pan?: Pan }) {
  const start = s.at(sec);
  const osc = s.c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, start);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, start + dur);
  const g = s.c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain, start + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(panned(s, o.pan, start, dur));
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** A struck glassy bell: a fundamental plus two inharmonic partials that die away faster. */
function bell(s: Stage, sec: number, freq: number, o: { gain: number; dur?: number; pan?: Pan }) {
  const dur = o.dur ?? 1;
  [[1, 1, 1], [2.76, 0.32, 0.5], [5.4, 0.12, 0.3]].forEach(([ratio, level, life]) =>
    tone(s, sec, freq * ratio, dur * life, { gain: o.gain * level, attack: 0.003, pan: o.pan }),
  );
}

/** A very short filtered noise tick: ratchets, keys, latches. */
function click(s: Stage, sec: number, o: { freq: number; gain: number; q?: number; dur?: number; pan?: Pan }) {
  const start = s.at(sec);
  const dur = o.dur ?? 0.012;
  const bp = s.c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = o.freq;
  bp.Q.value = o.q ?? 4;
  const g = s.c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain, start + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  noiseSource(s, start, dur).connect(bp);
  bp.connect(g);
  g.connect(panned(s, o.pan, start, dur));
}

/** A low body hit: a falling sine plus a muffled noise burst. */
function thud(s: Stage, sec: number, o: { from: number; to: number; gain: number; dur?: number; pan?: Pan }) {
  const dur = o.dur ?? 0.3;
  tone(s, sec, o.from, dur, { gain: o.gain, to: o.to, attack: 0.004, pan: o.pan });
  const start = s.at(sec);
  const lp = s.c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 450;
  const g = s.c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain * 0.5, start + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
  noiseSource(s, start, 0.1).connect(lp);
  lp.connect(g);
  g.connect(panned(s, o.pan, start, 0.1));
}

/** Friction with grain (pen nib, pencil, marker, paper): noise whose level jitters `rate` times a second. */
function scratch(s: Stage, sec: number, dur: number, o: { freq: number; gain: number; rate?: number; q?: number; pan?: Pan }) {
  const start = s.at(sec);
  const bp = s.c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = o.freq;
  bp.Q.value = o.q ?? 1.2;
  const g = s.c.createGain();
  const step = 1 / (o.rate ?? 28);
  g.gain.setValueAtTime(0.0001, start);
  for (let t = 0; t < dur; t += step) {
    // Fade in and out over the first and last fifth so the grain never starts or stops on a cliff.
    const edge = Math.min(1, t / (dur * 0.2), (dur - t) / (dur * 0.2));
    g.gain.setValueAtTime(Math.max(0.0001, o.gain * edge * (0.35 + Math.random() * 0.65)), start + t);
  }
  g.gain.setValueAtTime(0.0001, start + dur);
  noiseSource(s, start, dur).connect(bp);
  bp.connect(g);
  g.connect(panned(s, o.pan, start, dur));
}

/** Paper tearing: crackling fibres, a rapid random burst pattern swept upward in pitch. */
function tear(s: Stage, sec: number, dur: number, o: { from: number; to: number; gain: number; pan?: Pan }) {
  const start = s.at(sec);
  const hp = s.c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 500;
  const bp = s.c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(o.from, start);
  bp.frequency.exponentialRampToValueAtTime(o.to, start + dur);
  const g = s.c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  let t = 0;
  while (t < dur) {
    const shape = Math.sin(Math.PI * Math.min(1, t / dur)) ** 0.6;
    const v = Math.random();
    g.gain.setValueAtTime(Math.max(0.0001, o.gain * shape * v * v * 1.6), start + t);
    t += 0.004 + Math.random() * 0.01;
  }
  g.gain.setValueAtTime(0.0001, start + dur);
  noiseSource(s, start, dur).connect(hp);
  hp.connect(bp);
  bp.connect(g);
  g.connect(panned(s, o.pan, start, dur));
}

/** Mains hum of an old monitor: a low sawtooth under a low-pass, swelling in and holding. */
function hum(s: Stage, sec: number, dur: number, o: { freq: number; gain: number; attack: number }) {
  const start = s.at(sec);
  const osc = s.c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = o.freq;
  const lp = s.c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const g = s.c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(o.gain, start + o.attack);
  g.gain.setValueAtTime(o.gain, start + dur - 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(lp);
  lp.connect(g);
  g.connect(s.out);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/* ---------- cue sheets ---------- */

/** Landing: banner sweep (PageCurtain BannerSweep: bands 0.55s, 0.07s apart; reveal at 1.15s). */
export function playBannerSweep(): CueHandle {
  return cue((s) => {
    // Yellow, cobalt, ink race across left to right, each a little lower in pitch.
    [0, 1, 2].forEach((i) =>
      whoosh(s, i * 0.07, 0.55, { from: 260 - i * 40, to: 2200 - i * 400, gain: 0.42, peakAt: 0.55, pan: [-0.8, 0.8] }),
    );
    // The seal springs in at 0.55s.
    tone(s, 0.56, 420, 0.12, { gain: 0.14, to: 660, type: 'triangle' });
    bell(s, 0.6, 880, { gain: 0.09, dur: 0.9 });
    // Bands peel off to the right, ink first, falling in pitch.
    [0, 1, 2].forEach((i) =>
      whoosh(s, 1.15 + i * 0.07, 0.55, { from: 1800 - i * 200, to: 380, gain: 0.36, peakAt: 0.35, pan: [-0.4, 0.9] }),
    );
  });
}

// Smooth in-out curve close to CSS/framer 'easeInOut'.
const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** Login: safe dial (PageCurtain SafeDial). */
export function playSafeDial(): CueHandle {
  return cue((s) => {
    // The keyhole swallows the screen (0-0.75s, ease-in), shutting like a vault door.
    whoosh(s, 0, 0.75, { from: 120, to: 900, gain: 0.24, q: 0.7, peakAt: 0.95 });
    thud(s, 0.74, { from: 95, to: 40, gain: 0.32, dur: 0.32 });

    // The dial spins -40 → -190 → 70 → 0 degrees (0.85s from 0.62s). One ratchet click per
    // 7.5 degree tick it passes, so the clicks speed up and slow down with the dial itself.
    const keys = [-40, -190, 70, 0];
    const times = [0, 0.42, 0.78, 1];
    for (let seg = 0; seg < 3; seg++) {
      const segStart = 0.62 + times[seg] * 0.85;
      const segDur = (times[seg + 1] - times[seg]) * 0.85;
      const [a, b] = [keys[seg], keys[seg + 1]];
      let lastTick = Math.floor(a / 7.5);
      for (let i = 1; i <= 120; i++) {
        const angle = a + (b - a) * easeInOut(i / 120);
        const tick = Math.floor(angle / 7.5);
        if (tick !== lastTick) {
          lastTick = tick;
          // Each change of direction gets its own pitch, like a real combination dial.
          click(s, segStart + (segDur * i) / 120, { freq: [2600, 3300, 2900][seg], gain: 0.06, q: 6, dur: 0.01, pan: angle / 400 });
        }
      }
    }

    // The bolt gives at 1.5s and the keyhole lights gold.
    thud(s, 1.5, { from: 170, to: 55, gain: 0.38, dur: 0.26 });
    click(s, 1.5, { freq: 1700, gain: 0.22, q: 2, dur: 0.045 });
    bell(s, 1.53, 1318.5, { gain: 0.05, dur: 0.8 });

    // Reveal at 1.75s: you fly through the opening keyhole.
    whoosh(s, 1.75, 0.85, { from: 280, to: 3200, gain: 0.22, q: 0.8, peakAt: 0.45 });
  });
}

/** Guide: page turn (PageCurtain PageTurn: page lands ~0.45s; sheen 1.15s; turns away at 1.55s). */
export function playPageTurn(): CueHandle {
  return cue((s) => {
    // The page swings shut: a paper swish with a flutter, then it lands.
    whoosh(s, 0, 0.5, { from: 700, to: 2600, gain: 0.3, peakAt: 0.4, pan: [0.5, -0.1] });
    scratch(s, 0.02, 0.42, { freq: 1900, gain: 0.05, rate: 40, q: 0.8, pan: [0.4, 0] });
    click(s, 0.44, { freq: 850, gain: 0.18, q: 0.8, dur: 0.06 });
    thud(s, 0.44, { from: 110, to: 50, gain: 0.14, dur: 0.18 });

    // The handwritten note's arrow is drawn in pencil (1.1-1.7s, head at 1.68s).
    scratch(s, 1.1, 0.6, { freq: 4600, gain: 0.03, rate: 24, pan: 0.15 });
    scratch(s, 1.68, 0.2, { freq: 4800, gain: 0.03, rate: 24, pan: 0.25 });

    // Gold sheen passing over the title.
    bell(s, 1.15, 2093, { gain: 0.03, dur: 1.1 });
    bell(s, 1.27, 2637, { gain: 0.022, dur: 1 });

    // The page turns away to the left, accelerating.
    whoosh(s, 1.55, 0.8, { from: 500, to: 3000, gain: 0.34, peakAt: 0.8, pan: [0.2, -0.7] });
    scratch(s, 1.75, 0.55, { freq: 2100, gain: 0.05, rate: 45, q: 0.8, pan: [0, -0.6] });
  });
}

/** Sign-up: registration slip (PageCurtain SignupSlip; times match its SLIP constants). */
export function playRegistrationSlip(): CueHandle {
  return cue((s) => {
    // The slip slides up over the page and settles.
    whoosh(s, 0, 0.75, { from: 200, to: 1100, gain: 0.16, peakAt: 0.7 });
    scratch(s, 0.05, 0.65, { freq: 900, gain: 0.025, rate: 30, q: 0.7 });
    click(s, 0.76, { freq: 700, gain: 0.09, q: 0.7, dur: 0.05 });

    // "Sign up." is set letter by letter (0.6s + 0.045s each), like type keys.
    for (let i = 0; i < 7; i++) {
      click(s, 0.6 + i * 0.045 + 0.08, { freq: 1700 + (i % 3) * 260, gain: 0.05, q: 3, dur: 0.016, pan: -0.5 + i * 0.08 });
      tone(s, 0.6 + i * 0.045 + 0.08, 190, 0.03, { gain: 0.03 });
    }
    // The highlighter swipes behind "up." (1.0s).
    scratch(s, 1.0, 0.4, { freq: 2300, gain: 0.025, rate: 18, pan: -0.1 });
    // Pencil rules for the three fields (0.85s, 0.95s, 1.05s).
    [0, 1, 2].forEach((i) => scratch(s, 0.85 + i * 0.1, 0.3, { freq: 5200, gain: 0.012, rate: 30, pan: -0.6 + i * 0.6 }));

    // The signature is written (1.05-1.65s), bottom left.
    scratch(s, 1.05, 0.6, { freq: 3200, gain: 0.065, rate: 30, q: 1.4, pan: -0.45 });

    // The seal slams down on the right (lands ~1.66s).
    thud(s, 1.66, { from: 130, to: 45, gain: 0.5, dur: 0.36, pan: 0.45 });
    click(s, 1.66, { freq: 420, gain: 0.22, q: 0.7, dur: 0.07, pan: 0.45 });

    // Scissors snip along the perforation, left to right; the blades close every 0.16s.
    [1.78, 1.94, 2.1].forEach((t, i) => {
      const pan = -0.8 + i * 0.7;
      click(s, t, { freq: 5200, gain: 0.1, q: 3, dur: 0.02, pan });
      tone(s, t, 3400, 0.05, { gain: 0.02, type: 'triangle', pan });
      scratch(s, t - 0.07, 0.07, { freq: 6200, gain: 0.015, rate: 60, pan });
    });

    // At 2.2s the slip tears in two and the halves fly apart.
    tear(s, 2.2, 0.38, { from: 700, to: 2600, gain: 0.24 });
    whoosh(s, 2.32, 0.6, { from: 900, to: 280, gain: 0.1, peakAt: 0.3 });
  });
}

/** Sign-in success: welcome curtain, closing part (LoginTransition: covered at 0.92s). */
export function playWelcomeIn(): CueHandle {
  return cue((s) => {
    // Two layers of shutters close right to left: yellow, then ink 0.12s later.
    whoosh(s, 0, 0.8, { from: 300, to: 1400, gain: 0.17, peakAt: 0.7, pan: [0.8, -0.8] });
    whoosh(s, 0.12, 0.8, { from: 200, to: 900, gain: 0.17, peakAt: 0.75, pan: [0.8, -0.8] });
    thud(s, 0.92, { from: 100, to: 45, gain: 0.26, dur: 0.3 });
    // The seal pops in (0.7s) and ACCESS GRANTED ticks out (0.85s + 0.025s per letter).
    tone(s, 0.72, 520, 0.1, { gain: 0.08, to: 780, type: 'triangle' });
    for (let i = 0; i < 13; i++) click(s, 0.85 + i * 0.027, { freq: 3500, gain: 0.03, q: 5, dur: 0.008 });
    // "Good Day, <name>!" (1.1s): a bright rising arpeggio.
    [1046.5, 1318.5, 1568].forEach((f, i) => bell(s, 1.15 + i * 0.1, f, { gain: 0.06, dur: 1.2 }));
    // The underline is penned (1.45s).
    scratch(s, 1.45, 0.55, { freq: 3000, gain: 0.025, rate: 26 });
  });
}

/** Sign-in success: the shutters lift left to right to reveal the dashboard. */
export function playWelcomeOut(): CueHandle {
  return cue((s) => {
    whoosh(s, 0, 0.8, { from: 1400, to: 320, gain: 0.34, peakAt: 0.35, pan: [-0.8, 0.8] });
    whoosh(s, 0.12, 0.8, { from: 1000, to: 260, gain: 0.26, peakAt: 0.35, pan: [-0.8, 0.8] });
  });
}

/** Sign-out: the goodbye iris (LogoutTransition) opening from the clicked point. */
export function playGoodbyeIn(pan: number): CueHandle {
  return cue((s) => {
    // The dark iris grows out of the button (0.75s).
    whoosh(s, 0, 0.75, { from: 90, to: 600, gain: 0.42, q: 0.6, peakAt: 0.9, pan: [pan, 0] });
    // The power symbol draws (0.45s) and the old tube hums while the goodbye is up.
    hum(s, 0.45, 3.2, { freq: 58, gain: 0.045, attack: 0.6 });
    // "See you," (0.7s): a falling two-note farewell.
    bell(s, 0.72, 784, { gain: 0.08, dur: 1.1 });
    bell(s, 0.92, 523.25, { gain: 0.08, dur: 1.4 });
  });
}

/** Sign-out: the screen switches off like a CRT (collapse to a line, then a dot, 0.55s). */
export function playSwitchOff(): CueHandle {
  return cue((s) => {
    click(s, 0, { freq: 1200, gain: 0.18, q: 1, dur: 0.03 });
    thud(s, 0, { from: 75, to: 35, gain: 0.2, dur: 0.25 });
    tear(s, 0, 0.14, { from: 2500, to: 5000, gain: 0.12 });
    // The picture collapsing: a falling zap, then the last dot fades with a tiny blip.
    tone(s, 0.02, 2400, 0.5, { gain: 0.1, to: 80, type: 'triangle' });
    tone(s, 0.53, 1800, 0.04, { gain: 0.025 });
  });
}

/* ---------- landing boot loader (index.html, opened directly) ---------- */

/** The bed under the loader: a soft open fifth that breathes while the request icons orbit. */
function playBootBed(): CueHandle {
  return cue((s) => {
    [[220, -0.3], [329.6, 0.3], [440.5, 0]].forEach(([freq, pan], i) => {
      const start = s.at(0);
      const osc = s.c.createOscillator();
      osc.frequency.value = freq;
      const g = s.c.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(i === 2 ? 0.008 : 0.018, start + 1.2);
      // A slow tremolo, like the orbit turning.
      const lfo = s.c.createOscillator();
      lfo.frequency.value = 0.45 + i * 0.13;
      const depth = s.c.createGain();
      depth.gain.value = 0.006;
      lfo.connect(depth);
      depth.connect(g.gain);
      osc.connect(g);
      g.connect(panned(s, pan, start, 10));
      osc.start(start);
      lfo.start(start);
      osc.stop(start + 10);
      lfo.stop(start + 10);
    });
  });
}

/** Each status line as loading moves on (35% "Sorting the queue", 70% "Opening the desk", 100% "Ready"). */
function playBootStep(step: number): CueHandle {
  return cue((s) => {
    const notes = [0, 659.3, 784, 987.8];
    if (!notes[step]) return;
    bell(s, 0, notes[step], { gain: 0.035, dur: 0.7, pan: -0.2 + step * 0.15 });
    if (step === 3) bell(s, 0.06, 1318.5, { gain: 0.02, dur: 0.8 });
  });
}

/** At 100%: icons collapse into the seal, the seal pops, the seam flashes and the screen splits
 *  open onto the landing page, whose hero then lands (Landing intro, delayed 0.55s by the loader). */
function playBootOpen(): CueHandle {
  return cue((s) => {
    // The four request icons are pulled into the seal (0-0.45s, ease-in) and click home
    // from their places on the orbit: right, bottom, left, top.
    whoosh(s, 0, 0.45, { from: 300, to: 2400, gain: 0.22, peakAt: 0.95 });
    [0.7, 0, -0.7, 0].forEach((pan, i) => click(s, 0.37 + i * 0.022, { freq: 4200 - i * 300, gain: 0.05, q: 6, dur: 0.012, pan }));

    // The seal pops (peak ~0.22s): ITRS's sting, a warm G major chord over a soft low root.
    [392, 587.3, 987.8].forEach((f, i) => bell(s, 0.22 + i * 0.03, f, { gain: 0.075 - i * 0.012, dur: 1.7 }));
    tone(s, 0.22, 98, 0.9, { gain: 0.1, attack: 0.02 });

    // The gold seam flashes from the centre outwards (0.2-0.5s).
    whoosh(s, 0.2, 0.5, { from: 3000, to: 8000, gain: 0.06, q: 0.7, peakAt: 0.3, pan: [0, -0.9] });
    whoosh(s, 0.2, 0.5, { from: 3000, to: 8000, gain: 0.06, q: 0.7, peakAt: 0.3, pan: [0, 0.9] });

    // The two halves part, top and bottom (0.3-1.15s): a wide, airy release.
    whoosh(s, 0.3, 0.85, { from: 150, to: 700, gain: 0.26, q: 0.6, peakAt: 0.45, pan: [-0.1, -0.8] });
    whoosh(s, 0.3, 0.85, { from: 160, to: 760, gain: 0.26, q: 0.6, peakAt: 0.45, pan: [0.1, 0.8] });

    // The landing page's hero: the headline's two lines rise (0.8s, 0.92s), the sample ticket
    // swings in from the right and settles (~1.4s), then the ticker wipes in left to right (1.45s).
    tone(s, 0.95, 160, 0.06, { gain: 0.05 });
    tone(s, 1.07, 196, 0.06, { gain: 0.05 });
    click(s, 1.4, { freq: 800, gain: 0.08, q: 0.8, dur: 0.05, pan: 0.5 });
    scratch(s, 1.45, 1.0, { freq: 1500, gain: 0.03, rate: 50, q: 0.9, pan: [-0.8, 0.8] });
  });
}

export interface BootScore {
  /** Whether the browser let sound start on page load (settles within 0.3s). */
  allowed: Promise<boolean>;
  step: (step: number) => void;
  open: () => void;
}

/**
 * Sound for the landing page's boot loader. Browsers keep audio off until the visitor has clicked,
 * tapped or pressed a key on the page; opening the site from the address bar or a search result
 * does not count. Where sound is allowed on load the whole loader is scored; where it is not, the
 * loader plays through silently.
 */
export function bootScore(): BootScore | null {
  if (!soundEnabled()) return null;
  const c = getCtx();
  if (!c) return null;
  const allowed: Promise<boolean> =
    c.state === 'running'
      ? Promise.resolve(true)
      : Promise.race([
          c.resume().then(() => c.state === 'running'),
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 300)),
        ]).catch(() => false);
  let bed: CueHandle | null = null;
  allowed.then((ok) => {
    if (ok) bed = playBootBed();
  });
  return {
    allowed,
    step: (step) => {
      allowed.then((ok) => ok && playBootStep(step));
    },
    open: () => {
      bed?.stop(0.5);
      playBootOpen();
    },
  };
}

/* ---------- sign-in and sign-up form results ---------- */

/** The "Approved" / "Registered" stamp hitting the ticket (Login and Signup: the stamp springs
 *  down from 2.8x and lands ~0.1s in, as the ticket squashes under it). */
export function playApprovedStamp(): CueHandle {
  return cue((s) => {
    // The stamp coming down through the air.
    whoosh(s, 0, 0.1, { from: 1400, to: 400, gain: 0.12, peakAt: 0.9 });
    // Impact: rubber on paper over a desk, with the wooden handle's knock.
    thud(s, 0.08, { from: 140, to: 50, gain: 0.55, dur: 0.3 });
    click(s, 0.08, { freq: 380, gain: 0.3, q: 0.7, dur: 0.08 });
    tone(s, 0.08, 620, 0.07, { gain: 0.06, type: 'triangle' });
    // The ink pad's soft squelch as it lifts off.
    scratch(s, 0.14, 0.12, { freq: 1100, gain: 0.03, rate: 60, q: 0.8 });
    // The ring of ink spreading out (the stamp's ring, 0.1s): a faint, warm confirmation.
    bell(s, 0.16, 784, { gain: 0.035, dur: 0.6 });
  });
}

/** Sign-in refused (or sign-up rejected): a locked latch rattling, then a low falling "denied". */
export function playDenied(): CueHandle {
  return cue((s) => {
    [0, 0.07].forEach((t, i) => {
      click(s, t, { freq: 900 - i * 120, gain: 0.28, q: 1.5, dur: 0.035 });
      thud(s, t, { from: 120, to: 70, gain: 0.24, dur: 0.1 });
    });
    tone(s, 0.16, 330, 0.16, { gain: 0.1, type: 'triangle' });
    tone(s, 0.3, 233, 0.26, { gain: 0.1, type: 'triangle', to: 220 });
  });
}
