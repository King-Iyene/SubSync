// SAMPLE river: fictional deals, built by a small deterministic simulation (same output every time). It is only ever shown when the person asks, always labelled
// SAMPLE, and never mixed with real numbers. Every day's piles follow from the day before (a deal moves, is won or is lost), so the replay is internally consistent.
import type { PlDrain, PlMoneyFlow, PlReplayDay, PlReplayMove, PlStage } from "../analytics/pipeline3-types-interim";
import type { FlowPaths } from "./flow-paths";

const NAMES = ["New lead", "Contacted", "Appointment booked", "Proposal sent", "Negotiation", "Contract out"];
const AVG_CENTS = [3_200_00, 4_100_00, 5_800_00, 7_500_00, 9_200_00, 11_000_00];
const REASONS = ["Price too high", "Went quiet", "Chose a competitor", "Not ready yet"];

export const SAMPLE_DAYS = 30;

export function sampleRiver(): PlMoneyFlow {
  let seed = 20261113;
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  const open = [34, 22, 14, 9, 6, 3];
  const lostBy = NAMES.map(() => ({ n: 0, c: 0 }));
  const reasons = new Map<string, { n: number; c: number }>();
  let wonN = 0, wonC = 0;
  const days: PlReplayDay[] = [];
  const t0 = Date.UTC(2026, 9, 14);
  for (let d = 0; d < SAMPLE_DAYS; d++) {
    const moves: PlReplayMove[] = [];
    // New leads arrive.
    const arrive = 1 + rnd(3);
    open[0] += arrive; moves.push({ from: null, to: 0, status: null, count: arrive, valueCents: arrive * AVG_CENTS[0] });
    for (let i = open.length - 1; i >= 0; i--) {
      const go = Math.min(open[i], rnd(3)), lose = Math.min(open[i] - go, rnd(5) === 0 ? 1 : 0);
      if (go > 0) {
        open[i] -= go;
        if (i === open.length - 1) { wonN += go; wonC += go * AVG_CENTS[i]; moves.push({ from: i, to: null, status: "won", count: go, valueCents: go * AVG_CENTS[i] }); }
        else { open[i + 1] += go; moves.push({ from: i, to: i + 1, status: null, count: go, valueCents: go * AVG_CENTS[i] }); }
      }
      if (lose > 0) {
        open[i] -= lose; lostBy[i].n += lose; lostBy[i].c += lose * AVG_CENTS[i];
        const r = REASONS[rnd(REASONS.length)], x = reasons.get(r) ?? { n: 0, c: 0 };
        reasons.set(r, { n: x.n + lose, c: x.c + lose * AVG_CENTS[i] });
        moves.push({ from: i, to: null, status: "lost", count: lose, valueCents: lose * AVG_CENTS[i] });
      }
    }
    days.push({
      date: new Date(t0 + d * 86_400_000).toISOString().slice(0, 10), stageCounts: [...open], stageValueCents: open.map((n, i) => n * AVG_CENTS[i]), stageNoValue: open.map(() => 0),
      wonCents: moves.filter((m) => m.status === "won").reduce((t, m) => t + m.valueCents, 0), lostCents: moves.filter((m) => m.status === "lost").reduce((t, m) => t + m.valueCents, 0),
      wonCount: moves.filter((m) => m.status === "won").reduce((t, m) => t + m.count, 0), lostCount: moves.filter((m) => m.status === "lost").reduce((t, m) => t + m.count, 0), moves,
    });
  }
  const last = days[days.length - 1];
  const stages: PlStage[] = NAMES.map((name, i) => ({
    id: `sample-${i}`, name, order: i, count: last.stageCounts[i], valueCents: last.stageValueCents[i], noValueCount: 0, staleCount: i === 3 ? 2 : 0, staleValueCents: i === 3 ? 2 * AVG_CENTS[i] : 0,
    medianDwellDays: 2 + i, normalDwellDays: 2 + i, lostCount: lostBy[i].n, lostValueCents: lostBy[i].c,
  }));
  const drains: PlDrain[] = [...reasons.entries()].map(([reason, x]) => ({ reason, count: x.n, valueCents: x.c })).sort((a, b) => b.valueCents - a.valueCents);
  const worst = stages.reduce((a, s) => (s.lostValueCents > a.lostValueCents ? s : a), stages[0]);
  return {
    pipelineName: "Sample pipeline", periodLabel: "SAMPLE: made-up deals, not yours", stages, drains,
    won: { count: wonN, valueCents: wonC, previousValueCents: null },
    leak: { fromStage: worst.name, toStage: stages[Math.min(stages.length - 1, worst.order + 1)].name, lostCents: worst.lostValueCents },
    people: [], replay: days, minDeals: 1, excluded: { zeroValue: 0, noOwner: 0, test: 0 }, outlier: null,
  };
}

/** The same SAMPLE, as flow paths (ribbon labels, funnel). Made-up people and sources, marked as samples; shares add up to the won total. */
export function sampleFlowPaths(f: PlMoneyFlow = sampleRiver()): FlowPaths {
  const split = (total: number, names: string[]): Array<{ key: string; name: string; n: number; cents: number }> => {
    const w = [5, 3, 2].slice(0, names.length), sum = w.reduce((a, b) => a + b, 0);
    let left = total, leftC = f.won.valueCents;
    return names.map((name, i) => {
      const last = i === names.length - 1, n = last ? left : Math.floor((total * w[i]) / sum), c = last ? leftC : Math.floor((f.won.valueCents * w[i]) / sum);
      left -= n; leftC -= c;
      return { key: `sample-${i}`, name, n, cents: c };
    });
  };
  return {
    pipelineName: f.pipelineName,
    stages: f.stages.map((s) => ({ id: s.id, name: s.name, order: s.order, open: s.count, openCents: s.valueCents, noValue: 0, stuck: s.staleCount, stuckCents: s.staleValueCents, lost: s.lostCount, lostCents: s.lostValueCents })),
    won: { n: f.won.count, cents: f.won.valueCents, medianDays: 14, byOwner: split(f.won.count, ["Ada (sample)", "Tunde (sample)", "Chi (sample)"]), bySource: split(f.won.count, ["Ads (sample)", "Referral (sample)", "Website (sample)"]) },
    lostElsewhere: 0, minDeals: f.minDeals,
  };
}

/** The SAMPLE funnel: a rich, fixed, fictional pipeline made to show every effect (a clear leak, stuck deals, several winners). Only ever shown when asked, always labelled SAMPLE, never mixed with real numbers. */
let funnelCache: FlowPaths | null = null;
export function sampleFunnelPaths(): FlowPaths { return (funnelCache ??= buildFunnelSample()); }
function buildFunnelSample(): FlowPaths {
  // name, open, stuck, lost, average deal in dollars
  const rows: Array<[string, number, number, number, number]> = [
    ["New lead", 120, 38, 140, 3200], ["Contacted", 64, 21, 70, 4100], ["Appointment booked", 41, 9, 52, 5800],
    ["Proposal sent", 27, 11, 38, 7500], ["Negotiation", 14, 4, 21, 9200], ["Contract out", 6, 2, 9, 11000],
  ];
  const stages = rows.map(([name, open, stuck, lost, avg], i) => ({ id: `sample-${i}`, name, order: i, open, openCents: open * avg * 100, noValue: 0, stuck, stuckCents: stuck * avg * 100, lost, lostCents: lost * avg * 100 }));
  const won = 73, wonCents = won * 960_000;
  const split = (names: string[], parts: number[]) => names.map((name, i) => ({ key: `sample-${i}`, name, n: parts[i], cents: Math.round((wonCents * parts[i]) / won) }));
  return {
    pipelineName: "Sample sales pipeline", stages, minDeals: 15, lostElsewhere: 0,
    won: { n: won, cents: wonCents, medianDays: 21, byOwner: split(["Ada (sample)", "Tunde (sample)", "Chi (sample)", "Zainab (sample)"], [28, 21, 16, 8]), bySource: split(["Ads (sample)", "Referral (sample)", "Website (sample)"], [34, 25, 14]) },
  };
}
