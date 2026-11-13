// FUNNEL FLOW geometry (Sankey-style) for the Pipeline "Funnel flow" view. Pure and unit-tested. Drawn from the per-step aggregates of flow-paths only (never rows).
// Two axes like the river: "along" (the direction of the funnel) and "across" (thickness). The renderer maps them to x/y (wide screens) or y/x (phones).
// A step's band is as thick as the deals (or money) that GOT to it. The band narrows step by step; what falls out of a step leaves it as lost (up) or waits there (down),
// centred, so the shape looks like a funnel. At the end the last band splits like a Y: the won branch carries on, the lost branch leaves.
import { reachOf, type FlowPaths } from "./flow-paths.ts";

export type FfNode = {
  id: string; kind: "stage" | "won"; index: number; name: string;
  al: number; w: number; ac: number; h: number;
  /** Parts of the bar, top to bottom: lost here, got through, waiting here (stuck part at the bottom). */
  lostAc: number; lostH: number; flowAc: number; flowH: number; waitAc: number; waitH: number; stuckH: number;
  /** In the chosen measure (deals or money): got to here, waiting here, lost here, stuck here. */
  reach: number; open: number; lost: number; stuck: number;
};
export type FfLink = { from: number; to: number; al0: number; al1: number; ac0: number; ac1: number; th: number };
export type FfTail = { from: number; al0: number; ac0: number; th: number; al1: number; ac1: number; amount: number; leak: boolean };
export type FfLayout = { nodes: FfNode[]; links: FfLink[]; tails: FfTail[]; leakIndex: number | null; empty: boolean };

const MIN_TH = 2;
export type Measure = "deals" | "money";

/** Per-step values in the chosen measure. Deal mode also counts open deals that have no value. */
export function measuresOf(p: Pick<FlowPaths, "stages" | "won">, measure: Measure) {
  const money = measure === "money", r = reachOf(p, !money);
  return {
    reach: money ? r.cents : r.n,
    open: p.stages.map((s) => (money ? s.openCents : s.open + s.noValue)),
    stuck: p.stages.map((s) => (money ? s.stuckCents : s.stuck)),
    lost: p.stages.map((s) => (money ? s.lostCents : s.lost)),
    won: money ? p.won.cents : p.won.n,
  };
}

export function funnelFlowLayout(p: Pick<FlowPaths, "stages" | "won">, measure: Measure, o: { length: number; thick: number; nodeW: number; enough?: boolean }): FfLayout {
  const n = p.stages.length, m = measuresOf(p, measure);
  if (n === 0 || !(m.reach[0] > 0)) return { nodes: [], links: [], tails: [], leakIndex: null, empty: true };
  const k = o.thick / m.reach[0], t = (v: number) => (v > 0 ? Math.max(MIN_TH, v * k) : 0);
  // Heights are built from the end so a band is as thick where it leaves one bar as where it enters the next.
  const h: number[] = new Array(n + 1).fill(0), openH: number[] = [], lostH: number[] = [], stuckH: number[] = [];
  h[n] = t(Math.max(0, m.won));
  for (let i = n - 1; i >= 0; i--) {
    const op = Math.max(0, m.open[i]), ls = Math.max(0, m.lost[i]);
    openH[i] = t(op); lostH[i] = t(ls); stuckH[i] = op > 0 ? Math.min(openH[i], t(Math.min(op, Math.max(0, m.stuck[i])))) : 0;
    h[i] = h[i + 1] + openH[i] + lostH[i];
  }
  const s = Math.min(1, o.thick / Math.max(h[0], 1e-9)), pitch = (o.length - o.nodeW) / n;
  let leakIndex: number | null = null, worst = 0;
  const nodes: FfNode[] = [];
  for (let i = 0; i <= n; i++) {
    const won = i === n, hh = h[i] * s, ac = (o.thick - hh) / 2;
    const lH = won ? 0 : lostH[i] * s, fH = won ? hh : h[i + 1] * s, wH = won ? 0 : openH[i] * s;
    nodes.push({
      id: won ? "won" : p.stages[i].id, kind: won ? "won" : "stage", index: i, name: won ? "Won" : p.stages[i].name,
      al: i * pitch, w: o.nodeW, ac, h: hh, lostAc: ac, lostH: lH, flowAc: ac + lH, flowH: fH, waitAc: ac + lH + fH, waitH: wH, stuckH: won ? 0 : stuckH[i] * s,
      reach: m.reach[i], open: won ? m.won : Math.max(0, m.open[i]), lost: won ? 0 : Math.max(0, m.lost[i]), stuck: won ? 0 : Math.max(0, m.stuck[i]),
    });
    if (!won && m.lost[i] > worst) { worst = m.lost[i]; leakIndex = i; }
  }
  if (!o.enough) leakIndex = null;
  const links: FfLink[] = [], tails: FfTail[] = [];
  for (let i = 0; i < n; i++) {
    const a = nodes[i], b = nodes[i + 1];
    if (a.flowH > 0) links.push({ from: i, to: i + 1, al0: a.al + a.w, al1: b.al, ac0: a.flowAc, ac1: b.ac, th: a.flowH });
    if (a.lostH > 0) tails.push({ from: i, al0: a.al + a.w, ac0: a.lostAc, th: a.lostH, al1: a.al + a.w + Math.max(8, (pitch - a.w) * 0.7), ac1: a.lostAc - (Math.min(a.lostH, 28) + 8), amount: a.lost, leak: i === leakIndex });
  }
  return { nodes, links, tails, leakIndex, empty: false };
}
