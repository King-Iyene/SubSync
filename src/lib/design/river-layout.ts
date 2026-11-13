// RIVER (sankey-style) geometry for the Pipeline money view. Pure and unit-tested. Drawn from per-stage AGGREGATES only (never rows), so it is as fast at 100k deals as at 10.
// Two axes: "along" (the direction the money flows) and "across" (thickness). The renderer maps them to x/y (wide screens) or y/x (phones).
// Measure = money in cents, or deal COUNT when no deal has a value. Reach(stage) = open here + lost here + everything that reached a later step or was won (an estimate of what got this far).

export type RiverIn = { id: string; name: string; open: number; stuck: number; lost: number };
export type RiverNode = {
  id: string; kind: "stage" | "won"; index: number;
  al: number; w: number; // along start, along size (bar width)
  ac: number; h: number; // across start, total thickness
  flowH: number; openH: number; stuckH: number; lostH: number; // parts, stacked top to bottom: flow on, open pile (stuck at its bottom), lost
  reach: number; open: number; stuck: number; lost: number;
  conv: number | null; // share of what reached here that reached the next step (0..1)
};
export type RiverLink = { from: number; to: number; al0: number; al1: number; ac0: number; ac1: number; th: number; conv: number | null; amount: number };
export type RiverTail = { from: number; al0: number; ac0: number; th: number; al1: number; ac1: number; amount: number; leak: boolean };
export type RiverLayout = { nodes: RiverNode[]; links: RiverLink[]; tails: RiverTail[]; leakIndex: number | null; empty: boolean };

const MIN_TH = 2;

export function riverLayout(stages: RiverIn[], won: number, o: { length: number; thick: number; nodeW: number; enough?: boolean }): RiverLayout {
  const n = stages.length, wonV = Math.max(0, won);
  const reach: number[] = new Array(n + 1).fill(0);
  reach[n] = wonV;
  for (let i = n - 1; i >= 0; i--) reach[i] = reach[i + 1] + Math.max(0, stages[i].open) + Math.max(0, stages[i].lost);
  if (n === 0 || reach[0] <= 0) return { nodes: [], links: [], tails: [], leakIndex: null, empty: true };
  const k = o.thick / reach[0], t = (v: number) => (v > 0 ? Math.max(MIN_TH, v * k) : 0);
  // Heights are built from the end so a ribbon has the same thickness where it leaves one node and where it enters the next.
  const h: number[] = new Array(n + 1).fill(0);
  h[n] = t(wonV);
  const openH: number[] = [], lostH: number[] = [], stuckH: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const op = Math.max(0, stages[i].open), ls = Math.max(0, stages[i].lost);
    openH[i] = t(op); lostH[i] = t(ls); stuckH[i] = op > 0 ? Math.min(openH[i], t(Math.min(op, Math.max(0, stages[i].stuck)))) : 0;
    h[i] = h[i + 1] + openH[i] + lostH[i];
  }
  const s = Math.min(1, o.thick / Math.max(h[0], 1e-9));
  const pitch = n > 0 ? (o.length - o.nodeW) / n : 0;
  let leakIndex: number | null = null, worst = 0;
  const nodes: RiverNode[] = [];
  for (let i = 0; i <= n; i++) {
    const isWon = i === n, hh = h[i] * s;
    nodes.push({
      id: isWon ? "won" : stages[i].id, kind: isWon ? "won" : "stage", index: i, al: i * pitch, w: o.nodeW, ac: (o.thick - hh) / 2, h: hh,
      flowH: isWon ? 0 : h[i + 1] * s, openH: isWon ? hh : openH[i] * s, stuckH: isWon ? 0 : stuckH[i] * s, lostH: isWon ? 0 : lostH[i] * s,
      reach: reach[i], open: isWon ? wonV : Math.max(0, stages[i].open), stuck: isWon ? 0 : Math.max(0, stages[i].stuck), lost: isWon ? 0 : Math.max(0, stages[i].lost),
      conv: !isWon && reach[i] > 0 ? reach[i + 1] / reach[i] : null,
    });
    if (!isWon && stages[i].lost > worst) { worst = stages[i].lost; leakIndex = i; }
  }
  if (!o.enough) leakIndex = null;
  const links: RiverLink[] = [], tails: RiverTail[] = [];
  for (let i = 0; i < n; i++) {
    const a = nodes[i], b = nodes[i + 1], th = a.flowH;
    if (th > 0) links.push({ from: i, to: i + 1, al0: a.al + a.w, al1: b.al, ac0: a.ac, ac1: b.ac, th, conv: a.conv, amount: reach[i + 1] });
    if (a.lostH > 0) {
      const top = a.ac + a.flowH + a.openH;
      tails.push({ from: i, al0: a.al + a.w, ac0: top, th: a.lostH, al1: a.al + a.w + Math.max(8, (pitch - a.w) * 0.7), ac1: top + Math.max(10, a.lostH) + 8, amount: a.lost, leak: i === leakIndex });
    }
  }
  return { nodes, links, tails, leakIndex, empty: false };
}

export type Pt = (al: number, ac: number) => [number, number];
const f = (v: number) => Math.round(v * 10) / 10;
/** Closed ribbon path between two across-intervals, bending at the middle of the gap. */
export function ribbonPath(al0: number, ac0: number, th0: number, al1: number, ac1: number, th1: number, p: Pt): string {
  const m = (al0 + al1) / 2, q = (al: number, ac: number) => { const [x, y] = p(al, ac); return `${f(x)} ${f(y)}`; };
  return `M${q(al0, ac0)} C${q(m, ac0)} ${q(m, ac1)} ${q(al1, ac1)} L${q(al1, ac1 + th1)} C${q(m, ac1 + th1)} ${q(m, ac0 + th0)} ${q(al0, ac0 + th0)} Z`;
}
/** Centre line of a ribbon, used for the flowing bills. */
export function centerPath(l: Pick<RiverLink, "al0" | "al1" | "ac0" | "ac1" | "th">, p: Pt): string {
  const m = (l.al0 + l.al1) / 2, q = (al: number, ac: number) => { const [x, y] = p(al, ac); return `${f(x)} ${f(y)}`; };
  return `M${q(l.al0, l.ac0 + l.th / 2)} C${q(m, l.ac0 + l.th / 2)} ${q(m, l.ac1 + l.th / 2)} ${q(l.al1, l.ac1 + l.th / 2)}`;
}
/** How many bills fall along a ribbon: share of the thickest ribbon, at least 1, never more than `cap` in total. */
export function particleCounts(ths: number[], cap = 60): number[] {
  const max = Math.max(0, ...ths);
  if (max <= 0) return ths.map(() => 0);
  const c = ths.map((x) => (x > 0 ? Math.max(1, Math.round((x / max) * 5)) : 0));
  while (c.reduce((a, b) => a + b, 0) > cap) { const i = c.indexOf(Math.max(...c)); if (c[i] <= 1) break; c[i]--; }
  return c;
}
/** Rows of bills (or cards) in a pile: proportional to its height, at most 40. */
export const pileRows = (h: number): number => (h <= 0 ? 0 : Math.max(1, Math.min(40, Math.round(h / 6))));

/** Most cards (or bills) any one pile may draw. */
export const MAX_PILE_CARDS = 30;
/**
 * The ONE scale for every pile on the screen: how much a card stands for. With few deals it is exactly 1 (one card per deal, so a pile always matches its count).
 * With many deals (or large money) it is the smallest "nice" step (1, 2, 5, 10, 20, 50 ...) that keeps the biggest pile at MAX_PILE_CARDS or fewer.
 */
export function pileUnit(values: number[], maxCards = MAX_PILE_CARDS): number {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (max <= maxCards) return 1;
  const raw = max / maxCards, mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}
/** Cards for one pile: none when empty, at least one when anything is there, never more than MAX_PILE_CARDS. With unit 1 it is exactly the count. */
export const pileCards = (value: number, unit: number): number => (value <= 0 ? 0 : Math.min(MAX_PILE_CARDS, Math.max(1, Math.ceil(value / Math.max(1, unit)))));
