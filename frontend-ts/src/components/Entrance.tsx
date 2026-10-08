import { useEffect, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { curtainRevealDelay, type Kind } from './PageCurtain';

// Shared pieces for the public pages' entrances (sign in, sign up, guide). Each page plays its
// own entrance after its transition opens; these hold the timing and the two text effects.

/**
 * Seconds the page's entrance should wait: until its page curtain opens, until the sign-out
 * screen fades (login only), or 0 on a direct visit. Fixed at mount.
 */
export function useRevealDelay(kind: Kind): number {
  const [delay] = useState(() => {
    if (kind === 'login' && document.querySelector('.lo-root')) return 0.25;
    return curtainRevealDelay(kind);
  });
  return delay;
}

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*';

/**
 * Text that cracks its own code: every letter flickers through random glyphs, then locks in,
 * left to right, like tumblers falling into place. The real letters keep their space from the
 * start, so nothing shifts. Screen readers should get the text from an aria-label on the parent.
 */
export function DecodeText({ text, delay, duration = 0.9 }: { text: string; delay: number; duration?: number }) {
  const reduce = useReducedMotion();
  // Seconds since the decode started (negative before it); Infinity once every letter is locked.
  const [elapsed, setElapsed] = useState(reduce ? Infinity : -1);

  useEffect(() => {
    if (reduce) return;
    const start = performance.now() + delay * 1000;
    let last = 0;
    let raf = requestAnimationFrame(function tick(now) {
      const e = (now - start) / 1000;
      if (e > duration + 0.05) {
        setElapsed(Infinity);
        return;
      }
      // About 20 changes a second: fast enough to read as scrambling, slow enough to see.
      if (now - last > 50) {
        last = now;
        setElapsed(e);
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [delay, duration, reduce]);

  const chars = [...text];
  const last = Math.max(1, chars.length - 1);
  return (
    <>
      {chars.map((ch, i) => {
        if (ch === ' ') return ' ';
        // The first quarter is pure scramble; then the letters lock one after another.
        const lockAt = duration * (0.25 + 0.75 * (i / last));
        const locked = elapsed >= lockAt;
        return (
          <span key={i} className={`dc-ch ${locked ? 'is-locked' : ''}`} aria-hidden="true">
            {ch}
            {!locked && <span className="dc-glyph">{GLYPHS[Math.floor(Math.random() * GLYPHS.length)]}</span>}
          </span>
        );
      })}
    </>
  );
}

/** A number that counts from `from` to `to` once its delay has passed. */
export function CountUp({ from, to, delay, duration = 1 }: { from: number; to: number; delay: number; duration?: number }) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : from);

  useEffect(() => {
    if (reduce) return;
    const controls = animate(from, to, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [from, to, delay, duration, reduce]);

  return <>{value}</>;
}
