// FUNNEL DOTS: the pure rules behind the tapered Funnel and the River's piles. Unit-tested. Drawn from per-step aggregates only (never rows), so it costs the same at 10 deals and at 50 million.
// ONE idea: a dot is a small, rounded-off share of a count. The number of dots drawn is CAPPED (DOT_CAP) however many deals exist; the legend always says how many deals one dot stands for,
// and the real numbers are always printed as text. A dot count is never the number.
import { pctText, type FlowPaths } from "./flow-paths.ts";
import { measuresOf, type Measure } from "./funnel-flow-layout.ts";

/** Most dots drawn in one picture, over every row. */
export const DOT_CAP = 400;
/** Most falling particles (decoration) in the funnel. */
export const PARTICLE_CAP = 24;

/** What one dot may stand for: 1, 2, 5, 10, 20, 50 ... up to a trillion. The smallest step that keeps the picture under the cap is used. */
const LADDER: number[] = (() => { const a: number[] = []; for (let e = 0; e <= 12; e++) for (const m of [1, 2, 5]) a.push(m * 10 ** e); return a; })();

const clean = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
/** Dots a group of `value` gets at `unit`: none when empty, at least one when anything is there. */
export const dotsFor = (value: number, unit: number): number => { const v = clean(value); return v <= 0 ? 0 : Math.max(1, Math.round(v / Math.max(1, unit))); };

/** The ONE scale for a picture: the smallest unit at which every group together draws at most `cap` dots (a group with anything in it always keeps one). */
export function dotUnit(values: number[], cap = DOT_CAP): number {
  for (const u of LADDER) if (values.reduce((t, v) => t + dotsFor(v, u), 0) <= cap) return u;
  return LADDER[LADDER.length - 1];
}

/** Shorter number for a legend: 1,000 -> "1,000"; 20,000 -> "20,000"; 2,000,000 -> "2 million". */
export function unitText(u: number): string {
  if (u >= 1e12) return `${(u / 1e12).toLocaleString("en-US")} trillion`;
  if (u >= 1e9) return `${(u / 1e9).toLocaleString("en-US")} billion`;
  if (u >= 1e6) return `${(u / 1e6).toLocaleString("en-US")} million`;
  return u.toLocaleString("en-US");
}
/** The small legend line. Always says what a dot stands for when it is more than one; "1 dot = 1 deal" otherwise. `money` counts dollars instead of deals. */
export function dotLegend(unit: number, money = false): string {
  if (money) return unit <= 1 ? "1 dot = about $1" : `each dot = about $${unitText(unit)}`;
  return unit <= 1 ? "1 dot = 1 deal" : `each dot = ${unitText(unit)} deals`;
}

/** Split `total` dots over `parts` in proportion (largest remainder). Every part with anything in it keeps at least one dot when there are enough dots; the dots always add up to `total`. */
export function splitDots(total: number, parts: number[]): number[] {
  const p = parts.map(clean), sum = p.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !(sum > 0)) return p.map(() => 0);
  const raw = p.map((v) => (v / sum) * total), out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; rest > 0 && j < order.length; j++, rest--) out[order[j][1]]++;
  const nonzero = p.filter((v) => v > 0).length;
  if (total >= nonzero) {
    for (let i = 0; i < out.length; i++) {
      if (p[i] > 0 && out[i] === 0) { let big = -1; out.forEach((x, k) => { if (x > 1 && (big < 0 || x > out[big])) big = k; }); if (big >= 0) { out[big]--; out[i] = 1; } }
    }
  }
  return out;
}

/** A step name as at most two lines of about `max` characters, split at spaces. The whole name is always kept (never cut with "..."): a very long last line simply runs on. */
export function wrapLabel(name: string, max: number): string[] {
  const text = name.trim().replace(/\s+/g, " ");
  if (text.length <= Math.max(1, max)) return [text];
  const words = text.split(" ");
  let first = "";
  let i = 0;
  while (i < words.length && (first ? first.length + 1 + words[i].length : words[i].length) <= max) { first = first ? `${first} ${words[i]}` : words[i]; i++; }
  if (!first) { first = words[0].slice(0, max); words[0] = words[0].slice(max); i = 0; }
  const rest = words.slice(i).join(" ");
  return rest ? [first, rest] : [first];
}

/** Plain-words picture for a step name: used to pick a small icon. Pure, so it is tested. */
export type IconKey = "new" | "contact" | "book" | "qualify" | "offer" | "deal" | "won" | "step";
export function stageIconKey(name: string): IconKey {
  const n = name.toLowerCase();
  if (/\b(won|closed won|customer|paid|onboard)/.test(n)) return "won";
  if (/(book|appoint|meeting|demo|schedul|call booked|audit call)/.test(n)) return "book";
  if (/(propos|quote|offer|estimate|invoice)/.test(n)) return "offer";
  if (/(negoti|contract|sign|agree|deal|commit|close)/.test(n)) return "deal";
  if (/(qualif|discover|fit|review|screen|assess)/.test(n)) return "qualify";
  if (/(contact|call|reach|follow|reply|respon|touch|attempt)/.test(n)) return "contact";
  if (/(new|lead|inquir|enquir|inbound|subscri|opt)/.test(n)) return "new";
  return "step";
}

export type DotParts = { moved: number; waiting: number; stuck: number; lost: number };
export type FunnelRow = {
  index: number; id: string; name: string; kind: "stage" | "won"; icon: IconKey;
  /** In the chosen measure (deals, or dollars when `measure` is money). */
  reach: number; moved: number; waiting: number; stuck: number; lost: number;
  /** Share of the first step, 0 to 1 (never NaN), and the same as plain text ("62%") or null when there is nothing to divide by. */
  frac: number; pctFirst: string | null;
  /** "moved on" share to the next step as text, null for Won, for an empty step, or when nothing reached it. */
  conv: string | null;
  /** Drop-off: what reached this step and did not move on (lost + still waiting). */
  dropOff: number;
  /** Band width as a share of the widest band (0 to 1): never wider than the step before it, never NaN, never negative. */
  width: number;
  dots: DotParts;
  /** Open deals in this step with no dollar value. Counted in the Deals measure, never in Money; shown as a hatched count beside the step. */
  noValue: number;
};
export type FunnelModel = { rows: FunnelRow[]; unit: number; totalDots: number; leakIndex: number | null; empty: boolean; money: boolean };

/** Narrowest a non-empty band is drawn (share of the widest), so a tiny step is still a visible, clickable band. */
export const MIN_BAND = 0.07;

export function funnelModel(p: Pick<FlowPaths, "stages" | "won"> & Partial<FlowPaths>, measure: Measure, o: { enough: boolean; cap?: number }): FunnelModel {
  const k = p.stages.length, m = measuresOf(p, measure), money = measure === "money";
  const reach = m.reach.map(clean);
  if (k === 0 || !(reach[0] > 0)) return { rows: [], unit: 1, totalDots: 0, leakIndex: null, empty: true, money };
  const groups = (i: number): DotParts => {
    const open = clean(m.open[i]), stuck = Math.min(open, clean(m.stuck[i]));
    return { moved: clean(reach[i + 1]), waiting: open - stuck, stuck, lost: clean(m.lost[i]) };
  };
  // Won is drawn as its own gold row: its dots are the won deals, drawn as "moved" (the end of the road).
  const all = Array.from({ length: k + 1 }, (_, i) => (i === k ? { moved: clean(m.won), waiting: 0, stuck: 0, lost: 0 } : groups(i)));
  const rowTotals = all.map((g, i) => (i === k ? g.moved : reach[i]));
  // Money is counted in cents but a dot stands for whole dollars.
  const scale = money ? 100 : 1, unit = dotUnit(rowTotals.map((v) => v / scale), o.cap ?? DOT_CAP);
  const cap = o.cap ?? DOT_CAP;
  let want = rowTotals.map((v) => dotsFor(v / scale, unit));
  // Hard guarantee: never over the cap, even when every group keeps its one dot.
  let sum = want.reduce((a, b) => a + b, 0);
  while (sum > cap) { let big = 0; want.forEach((x, i) => { if (x > want[big]) big = i; }); if (want[big] <= 0) break; want[big]--; sum--; }
  want = want.map((x) => Math.max(0, x));
  const rows: FunnelRow[] = [];
  let leakIndex: number | null = null, worst = 0, prev = 1;
  for (let i = 0; i <= k; i++) {
    const won = i === k, g = all[i], total = rowTotals[i];
    const frac = Math.min(1, total / reach[0]);
    const width = total > 0 ? Math.min(prev, Math.max(MIN_BAND, frac)) : 0;
    prev = width > 0 ? width : prev;
    const a = reach[i], b = won ? 0 : reach[i + 1];
    let dots: DotParts;
    if (won) dots = { moved: want[i], waiting: 0, stuck: 0, lost: 0 };
    else { const [mv, wt, st, ls] = splitDots(want[i], [g.moved, g.waiting, g.stuck, g.lost]); dots = { moved: mv, waiting: wt, stuck: st, lost: ls }; }
    rows.push({
      index: i, id: won ? "won" : p.stages[i].id, name: won ? "Won" : p.stages[i].name, kind: won ? "won" : "stage", icon: won ? "won" : stageIconKey(p.stages[i].name),
      reach: won ? clean(m.won) : a, moved: won ? 0 : g.moved, waiting: won ? 0 : g.waiting + g.stuck, stuck: won ? 0 : g.stuck, lost: won ? 0 : g.lost,
      frac, pctFirst: total > 0 ? pctText(total, reach[0]) : null, conv: won || !(a > 0) ? null : pctText(b, a),
      dropOff: won ? 0 : Math.max(0, a - b), width, dots, noValue: won ? 0 : Math.max(0, p.stages[i].noValue ?? 0),
    });
    if (!won && g.lost > worst) { worst = g.lost; leakIndex = i; }
  }
  if (!o.enough) leakIndex = null;
  return { rows, unit, totalDots: rows.reduce((t, r) => t + r.dots.moved + r.dots.waiting + r.dots.stuck + r.dots.lost, 0), leakIndex, empty: false, money };
}

/** How many falling particles each band gets (decoration only): at most `cap` over the whole funnel, none for a band that carries nothing. */
export function particleBudget(carried: number[], cap = PARTICLE_CAP): number[] {
  const live = carried.filter((v) => v > 0).length;
  if (live === 0) return carried.map(() => 0);
  const each = Math.max(1, Math.min(3, Math.floor(cap / live)));
  const out = carried.map((v) => (v > 0 ? each : 0));
  let sum = out.reduce((a, b) => a + b, 0);
  for (let i = out.length - 1; sum > cap && i >= 0; i--) if (out[i] > 0) { out[i] = 0; sum--; }
  return out;
}

export type Pt = { x: number; y: number };
/** Half width of a band at height `t` (0 top to 1 bottom): a smooth S-curve from the top width to the bottom width, like a flowing band. */
export const halfWidthAt = (w0: number, w1: number, t: number): number => { const u = Math.max(0, Math.min(1, t)); return (w0 + (w1 - w0) * (u * u * (3 - 2 * u))) / 2; };

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Where `count` dots go inside one band (a smooth taper from width `w0` at the top to `w1` at the bottom, `h` tall, centred on x = `cx`). A hex-ish grid is made as fine as needed to hold them,
 * an even subset is kept, and the dots come back lowest first (so the caller can give the lowest ones to "moved on"). Deterministic for a seed. Never more than `count`, never outside the band.
 */
export function placeDots(count: number, o: { cx: number; w0: number; w1: number; h: number; pad?: number; spacing?: number; seed?: number }): Pt[] {
  if (!(count > 0)) return [];
  const pad = o.pad ?? 4, base = o.spacing ?? 8, jr = rng((o.seed ?? 1) * 7919 + count);
  const make = (s: number): Pt[] => {
    const pts: Pt[] = [], dy = s * 0.866;
    for (let y = pad, r = 0; y <= o.h - pad + 1e-6; y += dy, r++) {
      const half = halfWidthAt(o.w0, o.w1, y / o.h) - pad;
      if (half < 0) continue;
      let n = Math.max(1, Math.floor((half * 2) / s) + 1);
      if (r % 2 && n > 1) n -= 1; // every other row has one dot fewer, which offsets it by half a step
      const span = (n - 1) * s;
      for (let j = 0; j < n; j++) pts.push({ x: Math.max(o.cx - half, Math.min(o.cx + half, o.cx - span / 2 + j * s)), y });
    }
    return pts;
  };
  let pts: Pt[] = [];
  for (let s = base; s >= 2.6; s -= 0.4) { pts = make(s); if (pts.length >= count) break; }
  const keep = pts.length <= count ? pts : Array.from({ length: count }, (_, i) => pts[Math.floor((i * pts.length) / count)]);
  const jit = Math.min(0.9, base * 0.1);
  return keep.slice(0, count).map((q) => ({ x: q.x + (jr() - 0.5) * jit, y: q.y + (jr() - 0.5) * jit })).sort((a, b) => b.y - a.y || a.x - b.x);
}

/** A pile of `dots` dots inside a box of `w` by `h`: columns, rows, spacing and dot radius. The dots always fit the columns and rows (cols * rows >= dots); the spacing shrinks (to a floor) when the pile is dense. */
export function pileGrid(dots: number, w: number, h: number): { cols: number; rows: number; step: number; r: number } {
  if (!(dots > 0)) return { cols: 1, rows: 0, step: 6, r: 2 };
  const inner = Math.max(4, w - 4), s = Math.max(2.8, Math.min(7, Math.sqrt((inner * Math.max(h, 12)) / dots)));
  const cols = Math.max(1, Math.floor(inner / s)), rows = Math.ceil(dots / cols);
  return { cols, rows, step: s, r: Math.max(0.9, Math.min(2.6, s * 0.38)) };
}
