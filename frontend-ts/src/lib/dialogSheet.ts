import { useEffect } from 'react';
import { prefersReducedMotion } from './motion';

// On phones a dialog (.modal) is a bottom sheet that slides up as it opens (components.css). This
// slides it back down as it closes, however it was closed, so the dialogs themselves need no changes.
// React has already taken a closing dialog out of the page, so that same element is put back, lifeless,
// for the length of the slide. A copy would lose picked photos (blob URLs) and drawn PDF pages (canvas).
// Larger screens use the genie (dialogGenie.ts), and reduced motion closes at once.

/** Phones (the bottom sheet in components.css) are this wide or narrower. */
const PHONE = '(max-width: 640px)';
const DURATION = 260;
const EASE_IN = 'cubic-bezier(0.3, 0, 1, 1)';
/** What can be scrolled in a dialog. Taking an element out of the page forgets its position. */
const SCROLLERS = '.modal-content, .file-preview-body';

export function useSheetDismiss() {
  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    const scrolled = new WeakMap<Element, number>();

    const onScroll = (e: Event) => {
      if (e.target instanceof HTMLElement && e.target.matches(SCROLLERS)) scrolled.set(e.target, e.target.scrollTop);
    };

    const observer = new MutationObserver((records) => {
      if (!phone.matches || prefersReducedMotion()) return;
      for (const rec of records) {
        rec.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.matches('.modal') || node.dataset.genieGhost) return;
          const content = node.querySelector<HTMLElement>('.modal-content');
          if (!content || !rec.target.isConnected) return;

          // Marked so nothing mistakes it for an open dialog (useModalEscape, dialogGenie).
          node.dataset.genieGhost = '1';
          node.setAttribute('aria-hidden', 'true');
          node.inert = true;
          node.style.pointerEvents = 'none';
          node.style.animation = 'none';
          content.style.animation = 'none';
          rec.target.appendChild(node);

          // Close is at the bottom of a long sheet; it leaves from where the user had scrolled to.
          [node, ...node.querySelectorAll(SCROLLERS)].forEach((el) => {
            const top = scrolled.get(el);
            if (top !== undefined) el.scrollTop = top;
          });

          const distance = window.innerHeight - content.getBoundingClientRect().top;
          const timing = { duration: DURATION, easing: EASE_IN, fill: 'forwards' } as const;
          // Only the dimming fades. Fading the dialog would turn the sheet see-through as it leaves.
          node.animate([{ backgroundColor: 'transparent', backdropFilter: 'blur(0px)', webkitBackdropFilter: 'blur(0px)' }], timing);
          const slide = content.animate(
            [{ transform: 'translateY(0)' }, { transform: `translateY(${distance}px)` }],
            timing,
          );
          slide.onfinish = () => node.remove();
          slide.oncancel = () => node.remove();
        });
      }
    });

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      observer.disconnect();
    };
  }, []);
}
