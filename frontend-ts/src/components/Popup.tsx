import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion, useMotionValue, usePresence } from 'framer-motion';
import { prefersReducedMotion } from '../lib/motion';
import { genieFrame, genieFrameBelow, genieWarp, toClipPath } from '../lib/genie';

const PHONE_QUERY = '(max-width: 768px)';
const GAP = 6;

// The popover's genie, as the nav's choice bubbles do it (BottomNav.tsx ChoiceBubble): it pours
// out of the field and drains back into it. Same springs: it opens with a little speed so it shows
// at once, swells slightly and settles; it drains straight back in.
const GENIE_OPEN = { type: 'spring', stiffness: 80, damping: 13, mass: 1, restDelta: 0.0005, restSpeed: 0.005, velocity: 6 } as const;
const GENIE_CLOSE = { type: 'spring', stiffness: 150, damping: 24, mass: 1, restDelta: 0.003, restSpeed: 0.01, velocity: 0 } as const;
/** Room left around the panel, so the funnel's outline never cuts its shadow (~70px below it). */
const GENIE_MARGIN = 72;
/** How far into the field's edge the neck reaches, in px. */
const GENIE_NECK_DEPTH = 4;
/** The content is bent in horizontal slices cut along these rows, and no taller than this. */
const GENIE_ROWS = '.cal-head, .cal-row, .cal-foot, .cal-pick, .opt-search, .opt-item, .opt-empty';
const GENIE_MAX_SLICE = 48;
/** The field taking the panel back in, like the nav's lens (BottomNav.tsx absorb): it starts to
 *  bulge toward the panel once it is this far drained, up to this much wider and taller, and
 *  eases back to its shape near the end. */
const FIELD_SWELL_FROM = 0.5;
const FIELD_SWELL_X = 0.02;
const FIELD_SWELL_Y = 0.12;
const FIELD_MERGE_AT = 0.03;
const FIELD_SETTLE_MS = 420;
const smooth01 = (v: number) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };

export function usePhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * A panel that opens from a field: a popover under it on desktop (above it when there's no room
 * below), a bottom sheet with a Done button on phones. Used by the date fields and the dropdowns.
 * Put it inside AnimatePresence so it can animate out.
 */
function Popup({ anchor, title, onClose, width, matchWidth = false, className = '', children }: {
  anchor: HTMLElement | null;
  title: string;
  onClose: () => void;
  /** Popover width in px; with matchWidth, at least the field's own width. */
  width: number;
  matchWidth?: boolean;
  /** Extra class on the popover or sheet, e.g. for its padding. */
  className?: string;
  children: ReactNode;
}) {
  const phone = usePhone();
  const reduce = prefersReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Above the field it hangs from its bottom edge, so a list that shrinks as you search stays put.
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; above: boolean; width: number } | null>(null);

  // Under the field, kept on screen; above it when there's no room below.
  const side = useRef<'below' | 'above' | null>(null);
  useLayoutEffect(() => {
    if (phone || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = panel.current?.offsetHeight || 360;
      const w = Math.min(matchWidth ? Math.max(width, r.width) : width, window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      // The side is chosen once, when it opens; it doesn't jump across as its height changes.
      if (side.current === null) side.current = r.bottom + GAP + h <= window.innerHeight - 8 || r.top - GAP - h < 8 ? 'below' : 'above';
      const below = side.current === 'below';
      setPos(below
        ? { left, top: r.bottom + GAP, above: false, width: w }
        : { left, bottom: window.innerHeight - r.top + GAP, above: true, width: w });
    };
    place();
    // Its height changes as a list is searched or a calendar changes view: place it again.
    const ro = new ResizeObserver(() => place());
    if (panel.current) ro.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, phone, width, matchWidth]);

  // Pours out of the field once it has its place, and drains back into it on close. A motion value,
  // so closing mid-pour turns it around from where it is.
  const [isPresent, safeToRemove] = usePresence();
  const progress = useMotionValue(0);
  const posRef = useRef(pos);
  posRef.current = pos;
  const placed = pos !== null;
  useLayoutEffect(() => {
    const el = panel.current;
    if (phone) {
      // The sheet animates itself (motion.div exit); nothing to wait for here.
      if (!isPresent) safeToRemove?.();
      return;
    }
    if (!el || !anchor || !posRef.current) {
      if (!isPresent) safeToRemove?.();
      return;
    }
    if (reduce) {
      const fade = el.animate([{ opacity: isPresent ? 0 : 1 }, { opacity: isPresent ? 1 : 0 }], { duration: 150, fill: 'forwards' });
      if (!isPresent) fade.onfinish = () => safeToRemove?.();
      return () => fade.cancel();
    }
    const at = posRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const field = anchor.getBoundingClientRect();
    const panelLeft = at.left;
    // The neck meets the field's edge facing the panel, a little way in, as wide as the field
    // (up to the panel's own width). Measured from the panel's far side (lib/genie.ts).
    const geometry = {
      width: w,
      height: h,
      neckY: h + GAP + GENIE_NECK_DEPTH,
      neckX: field.left + field.width / 2 - panelLeft,
      neckHalf: Math.min(field.width, w) / 2,
      margin: GENIE_MARGIN,
    };
    const frameAt = at.above ? genieFrame : genieFrameBelow;
    const below = !at.above;

    // The content bends like macOS bends a window: while it pours, the content is swapped for thin
    // horizontal slices of a copy of it, each squeezed to the funnel's width at its height
    // (lib/genie.ts genieWarp). The real content is back once the panel is full size.
    const b = body.current;
    let warp: HTMLDivElement | null = null;
    let slices: HTMLDivElement[] = [];
    let fracs: number[] = [];
    let bodyX = 0, bodyY = 0;
    let bandTops: number[] = [];
    // Built a frame after the pour starts: its first frame is only a sliver at the field's edge, so
    // making the copies then would only hold up the click.
    const build = () => {
      if (!b) return;
      bodyX = b.offsetLeft;
      bodyY = b.offsetTop;
      const bodyW = b.offsetWidth;
      const bodyH = b.offsetHeight;
      const box = b.getBoundingClientRect();
      // The content's rows (a calendar week, the header, a list option), where they sit in the
      // panel, and the part of each that shows (an option scrolled half out of its list, half).
      const rows = Array.from(b.querySelectorAll<HTMLElement>(GENIE_ROWS), (n) => {
        const r = n.getBoundingClientRect();
        const list = n.closest('.opt-list')?.getBoundingClientRect();
        return {
          n,
          x: r.left - box.left,
          y: r.top - box.top,
          w: r.width,
          h: r.height,
          y0: (list ? Math.max(r.top, list.top) : r.top) - box.top,
          y1: (list ? Math.min(r.bottom, list.bottom) : r.bottom) - box.top,
        };
      }).filter((row) => row.y1 > row.y0 && row.y1 > 0 && row.y0 < bodyH);
      // Slices are cut along those rows, so no line of text is split between two slices squeezed
      // by different amounts. A tall row is cut again, so the bend still follows the funnel.
      const cuts = new Set<number>([0, bodyH]);
      rows.forEach((row) => { cuts.add(Math.round(row.y0)); cuts.add(Math.round(row.y1)); });
      const sorted = [...cuts].filter((y) => y >= 0 && y <= bodyH).sort((x, y) => x - y);
      const edges: number[] = [];
      sorted.forEach((y) => { if (!edges.length || y - edges[edges.length - 1] >= 3) edges.push(y); });
      edges[edges.length - 1] = bodyH;
      const bands: Array<[number, number]> = [];
      for (let i = 0; i < edges.length - 1; i++) {
        const [y0, y1] = [edges[i], edges[i + 1]];
        const parts = Math.max(1, Math.round((y1 - y0) / GENIE_MAX_SLICE));
        for (let k = 0; k < parts; k++) bands.push([y0 + ((y1 - y0) * k) / parts, y0 + ((y1 - y0) * (k + 1)) / parts]);
      }
      bandTops = bands.map(([y0]) => y0);
      fracs = bands.map(([y0, y1]) => {
        const f = (bodyY + (y0 + y1) / 2) / h;
        return below ? 1 - f : f;
      });
      warp = document.createElement('div');
      warp.className = 'popup-warp';
      warp.setAttribute('aria-hidden', 'true');
      warp.setAttribute('inert', '');
      // Each slice holds copies of only the rows it shows, in their places: copying the whole
      // content into every slice made the browser lay it all out many times over, which stuttered.
      slices = bands.map(([y0, y1]) => {
        const slice = document.createElement('div');
        slice.style.width = `${bodyW}px`;
        // Exactly its share: slices sit on the panel's solid card, so a seam between two can't
        // show, while an overlap would repeat the edge of the next row as stray marks.
        slice.style.height = `${y1 - y0}px`;
        rows.forEach((row) => {
          if (row.y1 <= y0 || row.y0 >= y1) return;
          // A frame the size of the row's visible part, holding a copy of the whole row.
          const frame = document.createElement('div');
          frame.style.cssText = `position:absolute;overflow:hidden;left:${row.x}px;top:${row.y0 - y0}px;width:${row.w}px;height:${row.y1 - row.y0}px`;
          const copy = row.n.cloneNode(true) as HTMLElement;
          copy.style.position = 'absolute';
          copy.style.left = '0';
          copy.style.top = `${row.y - row.y0}px`;
          copy.style.width = `${row.w}px`;
          copy.style.height = `${row.h}px`;
          copy.style.margin = '0';
          copy.style.boxSizing = 'border-box';
          frame.appendChild(copy);
          slice.appendChild(frame);
        });
        warp!.appendChild(slice);
        return slice;
      });
      el.appendChild(warp);
      bend(progress.get());
    };
    // Until then the content is see-through, so the first frame shows the funnel only, never
    // content that isn't bent yet. (Transparent rather than hidden: it must still take focus.)
    if (b && progress.get() < 0.999) b.style.opacity = '0';
    const buildFrame = requestAnimationFrame(build);
    // Once full size, the real content stays: the spring's settling wobble dips just under full.
    let reached = false;
    const bend = (p: number) => {
      if (isPresent && p >= 0.999) reached = true;
      if (!b || !warp) return;
      if (p >= 0.999 || reached) {
        b.style.opacity = '';
        // Open: the copies are done with (closing makes fresh ones from what is shown then).
        if (reached) {
          warp.remove();
          warp = null;
        } else {
          warp.style.display = 'none';
        }
        return;
      }
      warp.style.display = '';
      b.style.opacity = '0';
      const { d, rows } = genieWarp(p, geometry, fracs);
      slices.forEach((slice, i) => {
        const { left, right } = rows[i];
        const sx = (right - left) / w;
        const y = bodyY + bandTops[i];
        const ty = below ? h * (1 - d) + d * y : d * y;
        slice.style.transform = `translate(${(left + bodyX * sx).toFixed(2)}px, ${ty.toFixed(2)}px) scale(${sx.toFixed(4)}, ${d.toFixed(4)})`;
      });
    };

    // Draining, the field takes the panel back in like one blob of liquid merging into another:
    // it bulges toward the panel as the last of it pours in, then eases back to its own shape.
    // On the CSS scale and translate properties, so it stacks with anything else on the field.
    let swollen = false;
    let merged = false;
    const fieldH = anchor.offsetHeight;
    const bulge = (k: number) => {
      const sy = 1 + FIELD_SWELL_Y * k;
      const shift = ((sy - 1) * fieldH) / 2;
      anchor.style.scale = `${(1 + FIELD_SWELL_X * k).toFixed(4)} ${sy.toFixed(4)}`;
      anchor.style.translate = `0 ${(below ? shift : -shift).toFixed(2)}px`;
      swollen = true;
    };
    const unbulge = () => {
      anchor.style.scale = '';
      anchor.style.translate = '';
      swollen = false;
    };
    const absorb = (p: number) => {
      if (isPresent || merged) return;
      if (p > FIELD_MERGE_AT) {
        bulge(smooth01(1 - p / FIELD_SWELL_FROM));
        return;
      }
      merged = true;
      const from = { scale: anchor.style.scale || '1 1', translate: anchor.style.translate || '0 0' };
      unbulge();
      anchor.animate([from, { scale: '1 1', translate: '0 0' }], { duration: FIELD_SETTLE_MS, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
    };

    const apply = (p: number) => {
      const { a, c, d, e, f, points } = frameAt(p, geometry, 24);
      el.style.transform = `matrix(${a.toFixed(4)}, 0, ${c.toFixed(4)}, ${d.toFixed(4)}, ${e.toFixed(2)}, ${f.toFixed(2)})`;
      const clip = toClipPath(points);
      el.style.clipPath = clip;
      el.style.setProperty('-webkit-clip-path', clip);
      bend(p);
      absorb(p);
      // Drained: gone at once, without waiting out the spring's last fraction of a pixel.
      if (!isPresent && p < 0.004 && !removed) {
        removed = true;
        safeToRemove?.();
      }
    };
    let removed = false;
    const settle = () => {
      el.style.transform = '';
      el.style.clipPath = '';
      el.style.removeProperty('-webkit-clip-path');
      if (warp) warp.style.display = 'none';
      if (b) b.style.opacity = '';
    };
    el.style.transformOrigin = '0 0';
    apply(progress.get());
    const unsubscribe = progress.on('change', apply);
    const controls = animate(progress, isPresent ? 1 : 0, {
      ...(isPresent ? GENIE_OPEN : GENIE_CLOSE),
      onComplete: () => {
        if (isPresent) settle();
        else if (!removed) { removed = true; safeToRemove?.(); }
      },
    });
    return () => {
      controls.stop();
      unsubscribe();
      cancelAnimationFrame(buildFrame);
      warp?.remove();
      if (b) b.style.opacity = '';
      // Opened again mid-drain: the field lets go of what it had taken in.
      if (swollen && !merged) unbulge();
    };
    // Starts once the panel is placed and again when it closes; moving it (pos) must not restart it.
  }, [placed, isPresent, phone, anchor, reduce, progress, safeToRemove]);

  // A press anywhere else closes the popover (the sheet has its own backdrop). Not while it
  // drains: by then a new one may be open, and a press inside that one is not outside this one.
  useEffect(() => {
    if (phone || !isPresent) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [phone, anchor, onClose, isPresent]);

  if (phone) {
    return createPortal(
      <>
        <motion.div className="popup-backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
        <motion.div
          ref={panel}
          className={`popup-sheet ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={reduce ? { opacity: 0 } : { y: '100%' }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: '100%' }}
          transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="popup-grip" aria-hidden="true" />
          <div className="popup-head">
            <span className="popup-title">{title}</span>
            <button type="button" className="cal-link" onClick={onClose}>Done</button>
          </div>
          {children}
        </motion.div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={panel}
      className={`popup-popover ${className}`.trim()}
      role="dialog"
      aria-label={title}
      style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width } : { visibility: 'hidden' }}
    >
      <div className="popup-body" ref={body}>{children}</div>
    </div>,
    document.body,
  );
}

export default Popup;
