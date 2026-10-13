import { type Variants } from 'framer-motion';

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, delay: i * 0.05, ease: EASE_OUT },
  }),
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: (stagger: number = 0.05) => ({
    transition: { staggerChildren: stagger },
  }),
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: EASE_OUT },
  },
};

/**
 * True on phones with little memory or few cores, which stutter on blurs, blend modes and filters
 * redrawn every frame. They get lighter versions of those effects: the `lite` class on <html>
 * (set in main.tsx, used by lite.css) and checks of this flag in animated components.
 * deviceMemory is reported by Chrome only; other browsers are judged by core count.
 */
export const LITE_DEVICE =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency ?? 8) <= 4 ||
    ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4);
