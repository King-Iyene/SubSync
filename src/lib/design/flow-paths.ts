// FLOW PATHS: the numbers behind the river's ribbon labels and the funnel's bands. Pure and unit-tested; the same shape comes from the server (part=flow-paths) and from the SAMPLE.
// ONE idea, said once: a deal "got to" a step when it is open in that step or a later one, was lost from that step or a later one (in the chosen dates), or was won (in the dates).
// A ribbon "moved on" figure is "got to the next step" out of "got to this step". The server counts them with the SAME condition the list that opens behind a click uses
// (flowReachCond in pipeline3-queries.ts), so a label and the rows behind it cannot disagree.

export type PathSeg = { key: string; name: string; n: number; cents: number };
export type PathStage = {
  id: string; name: string; order: number;
  /** Open deals counted in money (have a value, an owner, not a test or a big outlier). */ open: number; openCents: number;
  /** Open deals with no value: real deals, counted only in deal-count mode. */ noValue: number;
  stuck: number; stuckCents: number;
  /** Lost from this step in the dates (every lost deal, with or without a value). */ lost: number; lostCents: number;
};
export type FlowPaths = {
  pipelineName: string;
  stages: PathStage[];
  won: { n: number; cents: number; medianDays: number | null; byOwner: PathSeg[]; bySource: PathSeg[] };
  /** Lost in the dates from a step that is no longer in this pipeline (still in the lost total). */
  lostElsewhere: number;
  minDeals: number;
  /** When SubSync started recording step moves, and whether that is on or before the first chosen day. When it is not, the funnel says so and shows where deals are now, with no flow claims. */
  history?: { since: string | null; covers: boolean };
};

export type Reach = { n: number[]; cents: number[] };
/** Deals (and money) that got to each step, then one more entry for Won. Length stages + 1. `dealsMode` also counts open deals with no value. */
export function reachOf(p: Pick<FlowPaths, "stages" | "won">, dealsMode: boolean): Reach {
  const k = p.stages.length, n: number[] = new Array(k + 1).fill(0), c: number[] = new Array(k + 1).fill(0);
  n[k] = Math.max(0, p.won.n); c[k] = Math.max(0, p.won.cents);
  for (let i = k - 1; i >= 0; i--) {
    const s = p.stages[i];
    n[i] = n[i + 1] + Math.max(0, s.open) + (dealsMode ? Math.max(0, s.noValue) : 0) + Math.max(0, s.lost);
    c[i] = c[i + 1] + Math.max(0, s.openCents) + Math.max(0, s.lostCents);
  }
  return { n, cents: c };
}

/** Whole percent for a share, never rounding a partial share up to 100 (3 of 4 is 75%; 199 of 200 is 99%, not 100%). */
export function pctText(part: number, whole: number): string | null {
  if (!(whole > 0)) return null;
  const raw = (part / whole) * 100;
  let r = Math.round(raw);
  if (part < whole && r >= 100) r = 99;
  if (part > 0 && r < 1) r = 1;
  return `${r}%`;
}

export type PathStep = {
  /** Position of the step the ribbon leaves (0-based); the ribbon goes to step index + 1, or Won for the last one. */
  index: number; fromId: string; fromName: string; toId: string | "won"; toName: string;
  fromN: number; toN: number; fromCents: number; toCents: number;
  stillHere: number; lostHere: number;
  pct: string | null;
  /** "53 of 57 moved on (93%)" */ label: string;
  /** Short two-line version for a small pill. */ short: [string, string];
};
const dealWord = (k: number) => (k === 1 ? "deal" : "deals");
const nf = (v: number) => v.toLocaleString("en-US");

/** One entry per ribbon: how many got to this step, how many got to the next, and the plain-words label. */
export function pathSteps(p: Pick<FlowPaths, "stages" | "won">, dealsMode: boolean): PathStep[] {
  const r = reachOf(p, dealsMode), k = p.stages.length;
  return p.stages.map((s, i) => {
    const toStage = i + 1 < k ? p.stages[i + 1] : null, fromN = r.n[i], toN = r.n[i + 1], pct = pctText(toN, fromN);
    const label = fromN > 0 ? `${nf(toN)} of ${nf(fromN)} moved on${pct ? ` (${pct})` : ""}` : "Nobody got here in these dates";
    return {
      index: i, fromId: s.id, fromName: s.name, toId: toStage ? toStage.id : "won", toName: toStage ? toStage.name : "Won",
      fromN, toN, fromCents: r.cents[i], toCents: r.cents[i + 1],
      stillHere: Math.max(0, s.open) + (dealsMode ? Math.max(0, s.noValue) : 0), lostHere: Math.max(0, s.lost),
      pct, label, short: [`${nf(toN)} of ${nf(fromN)}`, `moved on${pct ? ` ${pct}` : ""}`],
    };
  });
}

/** Segments for a stacked "who won" bar: the biggest `max`, in order, with the rest folded into one note (never a clickable segment). The segments plus the rest add up to the total. */
export function breakdown(segs: PathSeg[], max = 8, wonTotal?: { n: number; cents: number }): { shown: PathSeg[]; rest: { n: number; cents: number } | null; total: { n: number; cents: number } } {
  const sorted = [...segs].filter((s) => s.n > 0).sort((a, b) => b.n - a.n || b.cents - a.cents || a.name.localeCompare(b.name));
  const shown = sorted.slice(0, max);
  const sum = (xs: PathSeg[]) => xs.reduce((t, s) => ({ n: t.n + s.n, cents: t.cents + s.cents }), { n: 0, cents: 0 });
  const total = wonTotal ?? sum(sorted), s = sum(shown), restN = total.n - s.n;
  return { shown, rest: restN > 0 ? { n: restN, cents: Math.max(0, total.cents - s.cents) } : null, total };
}

export type LeakInfo = { index: number; name: string; lost: number; share: number | null };
/** The step that lost the most deals (needs at least `minDeals` closed deals, else null). Share = of the deals that got to that step. */
export function biggestLeak(p: Pick<FlowPaths, "stages" | "won" | "minDeals" | "lostElsewhere">, dealsMode: boolean): LeakInfo | null {
  const closed = closedDeals(p);
  if (closed < p.minDeals) return null;
  const r = reachOf(p, dealsMode);
  let best = -1, worst = 0;
  p.stages.forEach((s, i) => { if (s.lost > worst) { worst = s.lost; best = i; } });
  return best < 0 ? null : { index: best, name: p.stages[best].name, lost: worst, share: r.n[best] > 0 ? worst / r.n[best] : null };
}
/** Won plus lost in the dates: what the percentages are built on. */
export const closedDeals = (p: Pick<FlowPaths, "stages" | "won" | "lostElsewhere">): number => p.won.n + p.stages.reduce((t, s) => t + Math.max(0, s.lost), 0) + Math.max(0, p.lostElsewhere ?? 0);
export const lostTotal = (p: Pick<FlowPaths, "stages" | "lostElsewhere">): number => p.stages.reduce((t, s) => t + Math.max(0, s.lost), 0) + Math.max(0, p.lostElsewhere ?? 0);

/** Plain words for how long wins took. */
export function winTimeText(days: number | null): string | null {
  if (days === null || !Number.isFinite(days)) return null;
  const d = Math.round(days * 10) / 10;
  return d < 1 ? "Under a day" : `${d % 1 === 0 ? d : d.toFixed(1)} ${d === 1 ? "day" : "days"}`;
}

export const dealsText = (k: number) => `${nf(k)} ${dealWord(k)}`;
