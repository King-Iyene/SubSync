// Booking funnel (stage BF): the geometry of THE LADDER, kept apart from the screen so the tests can read it. Six steps are drawn as a descending staircase of ledges, left-aligned, each ledge as
// wide as the number of leads that reached it. A step is narrower than the one above, and the overhang is where leads fall off: each leak drops from the ledge's right end into a labelled
// catch-basin beside the next step. A different shape from the river, the tree, the coin stacks and the sorting gate: no stream splits here, leads step down and the ones that do not fit fall.
// Pure functions: layout, which step each little lead stops at, and where a lead is along its path.

export type LadderStepIn = { key: string; label: string; count: number };
export type LadderOpts = { width: number; compact?: boolean };
export type Rect = { x: number; y: number; w: number; h: number };
export type LadderStep = LadderStepIn & Rect & { /** Share of the first step, 0..100. */ pct: number };
export type Leak = { /** The step the lost leads never reached. */ toKey: string; lost: number; basin: Rect; /** Quadratic curve from the ledge end to the basin mouth. */ x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; stream: number };
export type LadderLayout = { width: number; height: number; steps: LadderStep[]; chutes: Rect[]; leaks: Leak[]; narrow: boolean };

const MIN_W = 8;

export function layoutLadder(steps: readonly LadderStepIn[], o: LadderOpts): LadderLayout {
  const narrow = o.width < 520, compact = !!o.compact || narrow;
  const rowH = compact ? 34 : 44, gap = compact ? 22 : 30, pad = 8;
  const basinW = narrow ? 104 : 168, basinH = rowH, space = narrow ? 14 : 28;
  const maxW = Math.max(60, o.width - basinW - space - pad * 2);
  const first = Math.max(1, steps[0]?.count ?? 1);
  const out: LadderStep[] = steps.map((s, i) => {
    const share = first > 0 ? Math.min(1, Math.max(0, s.count / first)) : 0;
    const w = s.count <= 0 ? MIN_W : Math.max(MIN_W, Math.round(maxW * share));
    return { ...s, x: pad, y: pad + i * (rowH + gap), w, h: rowH, pct: Math.round(share * 1000) / 10 };
  });
  // A ledge is never wider than the one above it, even when rounding or bad data says otherwise.
  for (let i = 1; i < out.length; i++) if (out[i].w > out[i - 1].w) out[i].w = out[i - 1].w;
  const chutes: Rect[] = [], leaks: Leak[] = [];
  const reach = pad + maxW + space; // where the basins start
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    chutes.push({ x: b.x, y: a.y + a.h, w: b.w, h: gap });
    const lost = Math.max(0, a.count - b.count), basin: Rect = { x: reach, y: b.y, w: basinW, h: basinH };
    const x0 = a.x + a.w, y0 = a.y + a.h / 2;
    leaks.push({ toKey: b.key, lost, basin, x0, y0, cx: Math.min(reach + 6, x0 + (reach - x0) * 0.7 + 14), cy: y0 + 4, x1: basin.x + 12, y1: basin.y, stream: Math.max(2, Math.min(rowH - 8, Math.round((lost / first) * (rowH - 8) * 3))) });
  }
  const last = out[out.length - 1];
  return { width: o.width, height: last ? last.y + last.h + pad : 0, steps: out, chutes, leaks, narrow };
}

/** A point on a leak's curve, t from 0 to 1. */
export function pointOnLeak(l: Leak, t: number): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, t)), v = 1 - u;
  return { x: v * v * l.x0 + 2 * v * u * l.cx + u * u * l.x1, y: v * v * l.y0 + 2 * v * u * l.cy + u * u * l.y1 };
}

/** A spread of 0..1 numbers with no clumps (the golden ratio), so any count of little leads is evenly mixed. */
export const spread = (j: number) => (j * 0.6180339887498949 + 0.5) % 1;

/**
 * Which step the lead number `j` of `n` stops at: 0 means it never gets past the first step, steps.length - 1 means it reaches the end. A lead reaches step i when its spread is under that
 * step's share of the first step, so the little leads that reach each step are in proportion to the real counts.
 */
export function depthOf(j: number, counts: readonly number[]): number {
  const first = counts[0] > 0 ? counts[0] : 1;
  const u = spread(j);
  let d = 0;
  for (let i = 1; i < counts.length; i++) if (u < counts[i] / first) d = i; else break;
  return d;
}

export type Waypoint = { x: number; y: number };
/** The path of one lead that stops at step `depth`: down every chute to its ledge, then (if it is not the last step) along to the ledge end and down into the basin. */
export function pathFor(L: LadderLayout, j: number, depth: number): Waypoint[] {
  const pts: Waypoint[] = [];
  const u = spread(j * 7 + 3);
  const px = (i: number) => L.steps[i].x + 6 + Math.max(0, L.steps[i].w - 12) * (0.1 + 0.8 * u);
  pts.push({ x: px(0), y: L.steps[0].y - 14 });
  for (let i = 0; i <= depth; i++) {
    const s = L.steps[i];
    pts.push({ x: px(i), y: s.y + s.h / 2 });
    if (i < depth) pts.push({ x: px(i + 1), y: L.steps[i + 1].y - 2 });
  }
  if (depth < L.steps.length - 1) {
    const leak = L.leaks[depth];
    pts.push({ x: leak.x0 - 3, y: leak.y0 });
    for (let k = 1; k <= 6; k++) pts.push(pointOnLeak(leak, k / 6));
    pts.push({ x: leak.basin.x + leak.basin.w / 2, y: leak.basin.y + leak.basin.h - 8 });
  }
  return pts;
}

/** The position at progress 0..1 along a polyline (equal speed). */
export function along(pts: readonly Waypoint[], p: number): Waypoint {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[lens.length - 1] || 1, at = Math.min(1, Math.max(0, p)) * total;
  for (let i = 1; i < pts.length; i++) if (at <= lens[i]) { const f = (at - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1); return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f }; }
  return pts[pts.length - 1];
}
