import { useEffect, type RefObject } from 'react';
import { animate } from 'framer-motion';
import { genieFrame, genieFrameBelow, toClipPath, type GenieFrame, type GenieGeometry } from './genie';
import { prefersReducedMotion } from './motion';

// The macOS genie for a page's dialogs (.modal): each pours out of the button that opened it and,
// when it closes, drains back into that same button. Uses the bottom nav's genie (lib/genie.ts),
// turned to whichever side of the dialog the button is on. Watches the container's DOM, so the
// dialogs themselves need no changes; a closing dialog is gone from React's tree at once, so a copy
// of it plays the drain. Phones keep their bottom sheet, and reduced motion keeps the plain fade.

const OPEN = { type: 'spring', stiffness: 80, damping: 13, mass: 1, restDelta: 0.0005, restSpeed: 0.005 } as const;
const CLOSE = { type: 'spring', stiffness: 150, damping: 24, mass: 1, restDelta: 0.003, restSpeed: 0.01 } as const;
/** Room kept around the dialog inside the outline, so its shadow isn't cut once it is full size. */
const MARGIN = 40;
/** Phones (the bottom sheet in components.css) are this wide or narrower. */
const PHONE = '(max-width: 640px)';

type Side = 'bottom' | 'top' | 'right' | 'left';

interface Origin {
  x: number;
  y: number;
  half: number;
}

/** The genie's frame at progress p, with the button on any side of the dialog. */
function frameAt(p: number, side: Side, box: DOMRect, o: Origin): { transform: string; clip: string } {
  const along = side === 'bottom' || side === 'top';
  // lib/genie.ts pours a panel upward out of a neck below it (genieFrameBelow: downward out of one
  // above). For a button beside the dialog the same is done on its side, x and y swapped.
  const g: GenieGeometry = along
    ? { width: box.width, height: box.height, neckX: o.x - box.left, neckY: side === 'bottom' ? o.y - box.top : box.height + (box.top - o.y), neckHalf: o.half, margin: MARGIN }
    : { width: box.height, height: box.width, neckX: o.y - box.top, neckY: side === 'right' ? o.x - box.left : box.width + (box.left - o.x), neckHalf: o.half, margin: MARGIN };
  const f: GenieFrame = side === 'bottom' || side === 'right' ? genieFrame(p, g) : genieFrameBelow(p, g);
  if (along) {
    return { transform: `matrix(${f.a}, 0, ${f.c}, ${f.d}, ${f.e}, ${f.f})`, clip: toClipPath(f.points) };
  }
  return {
    transform: `matrix(${f.d}, ${f.c}, 0, ${f.a}, ${f.f}, ${f.e})`,
    clip: toClipPath(f.points.map(([x, y]) => [y, x] as [number, number])),
  };
}

/** Which side of the dialog the button is on: beside it when it is clear of the dialog's width. */
function sideOf(box: DOMRect, o: Origin): Side {
  if (o.x >= box.right) return 'right';
  if (o.x <= box.left) return 'left';
  return o.y >= box.top + box.height / 2 ? 'bottom' : 'top';
}

function play(content: HTMLElement, overlay: HTMLElement, o: Origin, opening: boolean, done?: () => void) {
  const box = content.getBoundingClientRect();
  const side = sideOf(box, o);
  content.style.animation = 'none';
  content.style.transformOrigin = '0 0';
  const apply = (p: number) => {
    const { transform, clip } = frameAt(p, side, box, o);
    content.style.transform = transform;
    content.style.clipPath = clip;
    // The dimmed backdrop follows the pour, so it is clear while the dialog is still in the button.
    overlay.style.opacity = String(Math.min(1, Math.max(0, p * 1.6)));
  };
  apply(opening ? 0 : 1);
  return animate(opening ? 0 : 1, opening ? 1 : 0, {
    ...(opening ? OPEN : CLOSE),
    onUpdate: apply,
    onComplete: () => {
      content.style.transform = '';
      content.style.clipPath = '';
      content.style.transformOrigin = '';
      overlay.style.opacity = '';
      done?.();
    },
  });
}

/** Gives every dialog opened inside `ref` the genie, from and back to the button that opened it. */
export function useDialogGenie(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let pressed: Origin | null = null;
    const origins = new WeakMap<Element, Origin>();
    const running = new WeakMap<Element, { stop: () => void }>();
    const off = () => prefersReducedMotion() || window.matchMedia(PHONE).matches;

    // The opener is the last button pressed outside a dialog (Save and Cancel inside one don't count).
    const onPress = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn || btn.closest('.modal')) return;
      const r = btn.getBoundingClientRect();
      pressed = { x: r.left + r.width / 2, y: r.top + r.height / 2, half: r.width / 2 };
    };

    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.matches('.modal') || node.dataset.genieGhost) return;
          const content = node.querySelector<HTMLElement>('.modal-content');
          if (!content || !pressed || off()) return;
          origins.set(node, pressed);
          running.set(node, play(content, node, pressed, true));
        });
        rec.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.matches('.modal') || node.dataset.genieGhost) return;
          const o = origins.get(node);
          running.get(node)?.stop();
          if (!o || off() || !rec.target.isConnected) return;
          // React has already taken the dialog out; a lifeless copy drains back into the button.
          const ghost = node.cloneNode(true) as HTMLElement;
          ghost.dataset.genieGhost = '1';
          ghost.setAttribute('aria-hidden', 'true');
          ghost.inert = true;
          ghost.style.pointerEvents = 'none';
          ghost.style.animation = 'none';
          rec.target.appendChild(ghost);
          const content = ghost.querySelector<HTMLElement>('.modal-content');
          if (!content) { ghost.remove(); return; }
          content.style.transform = '';
          content.style.clipPath = '';
          play(content, ghost, o, false, () => ghost.remove());
        });
      }
    });

    root.addEventListener('click', onPress, true);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener('click', onPress, true);
      observer.disconnect();
    };
  }, [ref]);
}
