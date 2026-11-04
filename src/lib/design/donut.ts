// The geometry of the "What needs attention" donut, kept out of the component so it can be tested: where each slice starts and ends, the path of an
// annular sector, and where a label sits. Angles are in degrees, clockwise from the top (12 o'clock).

export type Arc = { index: number; from: number; to: number; mid: number };

/** One arc per count, in order, with a small gap between neighbours. A single slice is a whole ring with no gap. Zero counts get no arc. */
export function arcsOf(counts: readonly number[], gapDeg = 1.6): Arc[] {
  const total = counts.reduce((s, c) => s + Math.max(0, c), 0);
  if (total <= 0) return [];
  const live = counts.map((c, index) => ({ c, index })).filter((x) => x.c > 0);
  const gap = live.length > 1 ? gapDeg : 0;
  let start = 0;
  return live.map(({ c, index }) => {
    const sweep = (c / total) * 360;
    const from = start + gap / 2, to = start + sweep - gap / 2;
    start += sweep;
    return { index, from, to: Math.max(from + 0.01, Math.min(to, from + 359.99)), mid: (from + to) / 2 };
  });
}

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
export const pointAt = (cx: number, cy: number, r: number, deg: number) => ({ x: cx + r * Math.cos(rad(deg)), y: cy + r * Math.sin(rad(deg)) });

/** The path of a ring segment between two radii and two angles. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, from: number, to: number): string {
  const f = (n: number) => n.toFixed(2);
  const a = pointAt(cx, cy, r1, from), b = pointAt(cx, cy, r1, to), c = pointAt(cx, cy, r0, to), d = pointAt(cx, cy, r0, from);
  const large = to - from > 180 ? 1 : 0;
  return `M${f(a.x)} ${f(a.y)} A${r1} ${r1} 0 ${large} 1 ${f(b.x)} ${f(b.y)} L${f(c.x)} ${f(c.y)} A${r0} ${r0} 0 ${large} 0 ${f(d.x)} ${f(d.y)} Z`;
}

/** Where the label of a slice goes: just outside the ring, anchored to the side it is on so the text grows away from the ring. */
export function labelAt(cx: number, cy: number, r: number, mid: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const p = pointAt(cx, cy, r, mid);
  const side = Math.cos(rad(mid));
  return { x: p.x, y: p.y, anchor: side > 0.25 ? "start" : side < -0.25 ? "end" : "middle" };
}

/** A slice that is too thin to carry a label of its own (the legend still names it). */
export const LABEL_MIN_SHARE = 4;
