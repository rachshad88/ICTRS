// macOS-style genie for a small panel (the bottom nav's choice bubble): it pours out of a tab through
// a neck the tab's width, its top edge rising and widening first with S-curved sides; the neck opens
// last. Clipping alone would only cut the panel's outline, so the content also travels through the
// neck and is squeezed to the funnel's width, the way macOS warps the window.

export interface GenieGeometry {
  /** The panel's own size. */
  width: number;
  height: number;
  /** Where the neck meets the tab, in the panel's px: y below its bottom, x at the tab's centre. */
  neckY: number;
  neckX: number;
  neckHalf: number;
  /** Room around the panel left unclipped, so its shadow isn't cut once it is full size. */
  margin: number;
}

export interface GenieFrame {
  /** The panel's transform as matrix(a, 0, c, d, e, f), origin top left; c leans it toward the neck. */
  a: number;
  c: number;
  d: number;
  e: number;
  f: number;
  /** The outline in the panel's own (untransformed) px, ready for clip-path. */
  points: Array<[number, number]>;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
const smoother = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);

/**
 * The genie at progress p: 0 = inside the tab, 1 = full size. Above 1 (a spring's overshoot) the
 * panel swells slightly from the tab and settles back.
 */
export function genieFrame(p: number, g: GenieGeometry, rows = 24): GenieFrame {
  // A spring rushes its start; the power gives the pour time to read, and keeps its speed smooth.
  const q = clamp01(p) ** 1.5;
  const top = -g.margin;
  const left = -g.margin;
  const right = g.width + g.margin;
  const fullCentre = (left + right) / 2;
  const fullHalf = (right - left) / 2;

  // The top edge reaches its place by halfway; it widens a little behind; the neck opens last.
  const front = smooth(clamp01(q / 0.5));
  const tipWidth = smoother(clamp01(q / 0.62));
  const neckOpen = smoother(clamp01((q - 0.45) / 0.55));
  // The panel lets go of the tab last. Until then its near edge stretches down to the neck, so the
  // funnel is glass all the way (left empty, the neck showed only a sliver of the panel's shadow).
  const release = smoother(clamp01((q - 0.5) / 0.25));
  // Where the outline ends at the neck side: the neck, then the panel's resting edge plus margin.
  const near = g.neckY + (g.height + g.margin - g.neckY) * release;
  // And the panel's own near edge: the neck, then its resting place.
  const nearEdge = g.neckY + (g.height - g.neckY) * release;

  // Screen-space outline (relative to the panel's resting box).
  const lead = g.neckY + (top - g.neckY) * front;
  const widthAt = (t: number) => tipWidth * (neckOpen + (1 - neckOpen) * smooth(t));
  const leftSide: Array<[number, number]> = [];
  const rightSide: Array<[number, number]> = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const u = widthAt(t);
    const centre = g.neckX + (fullCentre - g.neckX) * u;
    const half = g.neckHalf + (fullHalf - g.neckHalf) * u;
    const y = near + (lead - near) * t;
    leftSide.push([centre - half, y]);
    rightSide.push([centre + half, y]);
  }
  const outline = [...leftSide, ...rightSide.reverse()];

  // The glass only slides up with the leading edge, revealed by the outline. The content is warped
  // row by row instead (genieWarp), which one matrix can't do.
  let a: number, c = 0, d: number, e: number, f: number;
  if (p <= 1) {
    a = 1;
    d = 1;
    e = 0;
    f = lead + g.margin * front;
  } else {
    const k = 1 + (p - 1) * 0.5;
    a = k;
    d = k;
    e = g.neckX * (1 - k);
    f = g.neckY * (1 - k);
  }

  // The clip applies before the transform, so map the outline back into the panel's own px.
  const points = outline.map(([x, y]) => {
    const ly = (y - f) / d;
    return [(x - e - c * ly) / a, ly] as [number, number];
  });
  return { a, c, d, e, f, points };
}

/** Points as a clip-path, shifted into a child's box (dx, dy = its offset in the panel). */
export function toClipPath(points: Array<[number, number]>, dx = 0, dy = 0): string {
  return `polygon(${points.map(([x, y]) => `${(x - dx).toFixed(2)}px ${(y - dy).toFixed(2)}px`).join(',')})`;
}

/**
 * The same genie for a panel that hangs below its tab (a top bar's bubble). Give it the geometry
 * measured upside down (neckY from the panel's bottom edge, growing downward) and it returns the
 * frame the right way up: the panel's matrix and outline mirrored top to bottom.
 */
export function genieFrameBelow(p: number, g: GenieGeometry, rows = 24): GenieFrame {
  const { a, c, d, e, f, points } = genieFrame(p, g, rows);
  const h = g.height;
  return {
    a,
    c: -c,
    d,
    e: e + c * h,
    f: h * (1 - d) - f,
    points: points.map(([x, y]) => [x, h - y] as [number, number]),
  };
}

/** One row of warped content: where the panel's left and right edges land on screen at that row. */
export interface WarpRow {
  left: number;
  right: number;
}

export interface GenieWarp {
  /** Vertical stretch of the content: its near edge is drawn out to the neck until the panel lets go. */
  d: number;
  /** One entry per requested row, top to bottom. */
  rows: WarpRow[];
}

/**
 * The content of the panel as the genie warps it, the way macOS bends a window: every row of the
 * panel is squeezed to the width of the funnel at that height, so the text itself funnels into the
 * neck and doesn't merely get uncovered. Valid while p < 1 (above that the panel swells as a whole,
 * which genieFrame's matrix already does). fracs are row centres, 0 = the panel's far edge from the
 * tab, 1 = its near edge. The panel's left and right edges are positions in the panel's own box
 * (x = 0 .. width), relative to the matrix genieFrame returns, which only translates it.
 */
export function genieWarp(p: number, g: GenieGeometry, fracs: number[]): GenieWarp {
  const q = clamp01(p) ** 1.5;
  const fullCentre = g.width / 2;
  const fullHalf = g.width / 2 + g.margin;
  const front = smooth(clamp01(q / 0.5));
  const tipWidth = smoother(clamp01(q / 0.62));
  const neckOpen = smoother(clamp01((q - 0.45) / 0.55));
  const release = smoother(clamp01((q - 0.5) / 0.25));
  const near = g.neckY + (g.height + g.margin - g.neckY) * release;
  const nearEdge = g.neckY + (g.height - g.neckY) * release;
  const lead = g.neckY + (-g.margin - g.neckY) * front;
  const widthAt = (t: number) => tipWidth * (neckOpen + (1 - neckOpen) * smooth(t));
  const f = lead + g.margin * front;
  const d = Math.max(1, (nearEdge - f) / g.height);
  const rows = fracs.map((r) => {
    // Where this row lands (screen y), and how far along the funnel that is.
    const y = f + d * (r * g.height);
    const t = near === lead ? 0 : clamp01((y - near) / (lead - near));
    const u = widthAt(t);
    const centre = g.neckX + (fullCentre - g.neckX) * u;
    // The outline carries the margin around the panel; the content sits inside it.
    const half = g.neckHalf + (fullHalf - g.neckHalf) * u - g.margin * u;
    return { left: centre - half, right: centre + half };
  });
  return { d, rows };
}
