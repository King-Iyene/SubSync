import type { ApFlowCloser, ApFlowSetter, ApFlowTree, ApOutcome, ApStats } from "../analytics/appointments3-types-interim.ts";

// Pure layout for the Appointment Flow Tree. Every node owns its own band of rows, so two labels can never overlap by construction (a test proves it too).
// Columns left to right: root (booked leads) -> setters (who booked) -> closers (who took the meeting) -> leaves (what happened). Width of a branch = number of appointments,
// colour = health against the agency's OWN overall rates (never an outside benchmark), glow = best converters.

export type Tone = "green" | "amber" | "red" | "grey" | "cyan" | "violet";
export type FlowKind = "root" | "setter" | "closer" | "leaf" | "more";
export type FlowNode = {
  id: string; kind: FlowKind; label: string; x: number; y: number; w: number; h: number; count: number; tone: Tone; best: boolean; parent: string | null;
  setterId?: string; closerId?: string; outcome?: ApOutcome; stats?: ApStats;
  /** On a leaf: where the pair's appointments were booked (a calendar name, or "N calendars"). */
  calendar?: string;
};
export type FlowLink = { id: string; from: string; to: string; d: string; width: number; tone: Tone };
export type FlowLayout = { width: number; height: number; nodes: FlowNode[]; links: FlowLink[]; columns: { x: number; w: number; title: string }[] };

export const LEAF_ORDER: readonly ApOutcome[] = ["won", "showed", "lost", "noshow", "unmarked", "cancelled"];
export const OUTCOME_LABEL: Record<ApOutcome, string> = { won: "Won", showed: "Showed, open", lost: "Lost", noshow: "No-show", cancelled: "Cancelled", unmarked: "No outcome yet" };
export const OUTCOME_TONE: Record<ApOutcome, Tone> = { won: "green", showed: "cyan", lost: "amber", noshow: "red", cancelled: "grey", unmarked: "violet" };

export const NODE_H = 92, LEAF_H = 22, LEAF_GAP = 4, PAIR_GAP = 12, SETTER_GAP = 18;

/** Colour of a person against the agency's own overall rates. Grey when there are too few bookings (or no marked outcomes) to judge. */
export function healthTone(s: Pick<ApStats, "bookings" | "showRate" | "closeRate">, overall: { showRate: number | null; closeRate: number | null }, min: number): Tone {
  if (s.bookings < min || s.showRate === null || overall.showRate === null) return "grey";
  const dShow = s.showRate - overall.showRate;
  const dClose = s.closeRate !== null && overall.closeRate !== null ? s.closeRate - overall.closeRate : 0;
  if (dShow <= -0.1 || dClose <= -0.15) return "red";
  if (dShow >= 0.03 && dClose >= 0) return "green";
  return "amber";
}

const conv = (s: ApStats) => (s.showRate ?? 0) * (s.closeRate ?? 0);

/** Rates from raw outcome counts, same definitions as the server (docs/METRICS.md): show rate = held / (held + no-show), close rate = won / held. */
export function ratesFromOutcomes(o: Record<ApOutcome, number>, min: number): { showRate: number | null; noShowRate: number | null; closeRate: number | null } {
  const held = o.won + o.lost + o.showed, marked = held + o.noshow;
  return { showRate: marked >= min ? held / marked : null, noShowRate: marked >= min ? o.noshow / marked : null, closeRate: held > 0 ? o.won / held : null };
}

export type ClosersTotal = ApStats & { id: string; name: string; outcomes: Record<ApOutcome, number> };
/** One row per closer, added up over every setter that hands to them (compare panel, closer ranking, next-lead suggestion). */
export function closerTotals(tree: ApFlowTree): ClosersTotal[] {
  const by = new Map<string, ClosersTotal & { _lead: number }>();
  for (const s of tree.setters) for (const c of s.closers) {
    const t = by.get(c.id) ?? { id: c.id, name: c.name, outcomes: { won: 0, lost: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0 }, bookings: 0, showRate: null, noShowRate: null, closeRate: null, revenueCents: 0, avgLeadToBookedHours: null, _lead: 0 };
    for (const k of LEAF_ORDER) t.outcomes[k] += c.outcomes[k];
    t.bookings += c.bookings; t.revenueCents += c.revenueCents; t._lead += (c.avgLeadToBookedHours ?? 0) * c.bookings;
    by.set(c.id, t);
  }
  return [...by.values()].map(({ _lead, ...t }) => ({ ...t, ...ratesFromOutcomes(t.outcomes, tree.minBookings), avgLeadToBookedHours: t.bookings ? _lead / t.bookings : null })).sort((a, b) => b.bookings - a.bookings);
}

export type Leak = { nodeId: string; setterId: string; closerId: string | null; excess: number; rate: number; overall: number; text: string };
/** The single biggest drop: the closer-after-setter pair whose no-shows sit furthest above the agency's own rate. Null when nothing stands out. */
export function findLeak(tree: ApFlowTree): Leak | null {
  const o = tree.overall.noShowRate;
  if (o === null) return null;
  let best: Leak | null = null;
  for (const s of tree.setters) for (const c of s.closers) {
    const marked = c.outcomes.won + c.outcomes.lost + c.outcomes.showed + c.outcomes.noshow;
    if (c.bookings < tree.minBookings || marked < tree.minBookings) continue;
    const rate = c.outcomes.noshow / marked, excess = c.outcomes.noshow - marked * o;
    if (excess >= 3 && rate > o && (!best || excess > best.excess)) {
      best = { nodeId: `c:${s.id}:${c.id}`, setterId: s.id, closerId: c.id, excess: Math.round(excess), rate, overall: o,
        text: `${c.outcomes.noshow} no-shows when ${s.name} hands to ${c.name}: ${Math.round(rate * 100)}% against ${Math.round(o * 100)}% across everyone.` };
    }
  }
  return best;
}

export type LayoutOptions = { width: number; maxSetters?: number; maxClosers?: number };

const leafCount = (c: ApFlowCloser) => Math.max(1, LEAF_ORDER.filter((k) => c.outcomes[k] > 0).length);

export function layoutFlow(tree: ApFlowTree, opts: LayoutOptions): FlowLayout {
  const compact = opts.width < 860;
  const W = { root: compact ? 92 : 128, setter: compact ? 176 : 224, closer: compact ? 176 : 224, leaf: compact ? 188 : 220 };
  const sum = W.root + W.setter + W.closer + W.leaf;
  const gap = Math.max(36, (opts.width - sum) / 3);
  const X = { root: 0, setter: W.root + gap, closer: W.root + W.setter + 2 * gap, leaf: W.root + W.setter + W.closer + 3 * gap };
  const width = Math.max(opts.width, X.leaf + W.leaf);
  const nodes: FlowNode[] = [], links: FlowLink[] = [];
  const setters = tree.setters.slice(0, opts.maxSetters ?? tree.setters.length);
  const maxCl = opts.maxClosers ?? 4;
  const total = Math.max(1, tree.booked);
  const lw = (n: number) => (n <= 0 ? 0 : 1.5 + 22 * Math.sqrt(Math.min(1, n / total)));
  const toneOf = (s: ApStats) => healthTone(s, tree.overall, tree.minBookings);

  const greens: Array<{ id: string; c: number }> = [];
  for (const s of setters) {
    if (toneOf(s) === "green") greens.push({ id: `s:${s.id}`, c: conv(s) });
    for (const c of s.closers.slice(0, maxCl)) if (toneOf(c) === "green") greens.push({ id: `c:${s.id}:${c.id}`, c: conv(c) });
  }
  const bestIds = new Set(greens.sort((a, b) => b.c - a.c).slice(0, 2).map((g) => g.id));

  let y = 0;
  const addLink = (from: FlowNode, to: FlowNode, count: number, tone: Tone) => {
    const x1 = from.x + from.w, y1 = from.y + from.h / 2, x2 = to.x, y2 = to.y + to.h / 2, xm = (x1 + x2) / 2;
    links.push({ id: `${from.id}>${to.id}`, from: from.id, to: to.id, d: `M${x1} ${y1} C${xm} ${y1} ${xm} ${y2} ${x2} ${y2}`, width: lw(count), tone });
  };
  const setterNodes: FlowNode[] = [];
  for (const s of setters) {
    const shown = s.closers.slice(0, maxCl);
    const hidden = s.hiddenClosers + (s.closers.length - shown.length);
    const heights = shown.map((c) => Math.max(NODE_H, leafCount(c) * (LEAF_H + LEAF_GAP) - LEAF_GAP));
    const moreH = hidden > 0 ? 30 : 0;
    const spanH = Math.max(NODE_H, heights.reduce((a, b) => a + b, 0) + PAIR_GAP * Math.max(0, shown.length - 1) + (moreH ? PAIR_GAP + moreH : 0));
    const top = y;
    const sNode: FlowNode = { id: `s:${s.id}`, kind: "setter", label: s.name, x: X.setter, y: top + (spanH - NODE_H) / 2, w: W.setter, h: NODE_H, count: s.bookings, tone: toneOf(s), best: bestIds.has(`s:${s.id}`), parent: "root", setterId: s.id, stats: s };
    nodes.push(sNode); setterNodes.push(sNode);
    let cy = top;
    shown.forEach((c, i) => {
      const bandH = heights[i];
      const cNode: FlowNode = { id: `c:${s.id}:${c.id}`, kind: "closer", label: c.name, x: X.closer, y: cy + (bandH - NODE_H) / 2, w: W.closer, h: NODE_H, count: c.bookings, tone: toneOf(c), best: bestIds.has(`c:${s.id}:${c.id}`), parent: sNode.id, setterId: s.id, closerId: c.id, stats: c };
      nodes.push(cNode); addLink(sNode, cNode, c.bookings, cNode.tone);
      const leaves = LEAF_ORDER.filter((k) => c.outcomes[k] > 0);
      const gh = leaves.length * (LEAF_H + LEAF_GAP) - LEAF_GAP;
      leaves.forEach((k, j) => {
        const leaf: FlowNode = { id: `l:${s.id}:${c.id}:${k}`, kind: "leaf", label: OUTCOME_LABEL[k], ...(c.calendar ? { calendar: c.calendar } : {}), x: X.leaf, y: cy + (bandH - gh) / 2 + j * (LEAF_H + LEAF_GAP), w: W.leaf, h: LEAF_H, count: c.outcomes[k], tone: OUTCOME_TONE[k], best: false, parent: cNode.id, setterId: s.id, closerId: c.id, outcome: k };
        nodes.push(leaf); addLink(cNode, leaf, c.outcomes[k], leaf.tone);
      });
      cy += bandH + PAIR_GAP;
    });
    if (moreH) nodes.push({ id: `m:${s.id}`, kind: "more", label: `+${hidden} more`, x: X.closer, y: cy, w: W.closer, h: moreH, count: 0, tone: "grey", best: false, parent: sNode.id, setterId: s.id });
    y = top + spanH + SETTER_GAP;
  }
  const height = Math.max(NODE_H, y - SETTER_GAP);
  const root: FlowNode = { id: "root", kind: "root", label: "Booked", x: X.root, y: (height - 96) / 2, w: W.root, h: 96, count: tree.booked, tone: "cyan", best: false, parent: null };
  nodes.unshift(root);
  for (const s of setterNodes) addLink(root, s, s.count, s.tone);
  return { width, height, nodes, links, columns: [{ x: X.root, w: W.root, title: "Booked" }, { x: X.setter, w: W.setter, title: "Who booked" }, { x: X.closer, w: W.closer, title: "Who took it" }, { x: X.leaf, w: W.leaf, title: "What happened" }] };
}

export const setterOf = (tree: ApFlowTree, id: string): ApFlowSetter | undefined => tree.setters.find((s) => s.id === id);
