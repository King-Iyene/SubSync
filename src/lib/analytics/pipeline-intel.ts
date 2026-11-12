// Pipeline and deal intelligence (spec section 2). Pure functions over cached deal rows, so every
// number is explainable and unit tested. Nothing here talks to the database.
import { MIN_CLOSED_DEALS, winRate, winRateOf } from "./metrics.ts";
import { stageProbability, type StoredRule } from "./stage-rules.ts";

export type Deal = {
  opportunityId: string;
  locationId: string;
  locationName: string | null;
  pipelineId: string;
  pipelineName: string;
  /** Days this deal may sit in its step: the usual time from finished stays in this account. Null = too little history to judge. Undefined = not supplied (older rule). */
  stageLimitDays?: number | null;
  stageId: string | null;
  stageName: string;
  stageOrder: number; // 1-based position in its pipeline, 999 when unknown
  name: string | null;
  contactName: string | null;
  value: number;
  status: "open" | "won" | "lost" | string;
  createdAt: number | null; // epoch ms
  stageChangedAt: number | null;
  statusChangedAt: number | null;
  lastActivityAt: number | null;
  assignedTo?: string | null;
};

const DAY = 86_400_000;
const days = (ms: number) => Math.max(0, Math.floor(ms / DAY));
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const isOpen = (d: Deal) => d.status === "open";
const lastTouch = (d: Deal) => Math.max(d.lastActivityAt ?? 0, d.stageChangedAt ?? 0, d.createdAt ?? 0) || null;

// ---------------- velocity (2.2) and win/loss (2.5) ----------------

export function cycleDays(d: Deal): number | null {
  if (d.status !== "won" || d.createdAt === null || d.statusChangedAt === null) return null;
  const c = days(d.statusChangedAt - d.createdAt);
  return c >= 0 ? c : null;
}

export function avgCycleDays(deals: Deal[]): number | null {
  const cycles = deals.map(cycleDays).filter((c): c is number => c !== null);
  const m = mean(cycles);
  return m === null ? null : round(m, 1);
}

// One minimum and one definition for the whole product (metrics.ts): 20 closed deals before any win rate.
export { winRate };

export type MonthRow = { month: string; won: number; lost: number; winRate: number | null; wonValue: number; lostValue: number };

export function winLossByMonth(deals: Deal[], now: number, months = 6): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  const d0 = new Date(now);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    rows.set(key, { month: key, won: 0, lost: 0, winRate: null, wonValue: 0, lostValue: 0 });
  }
  for (const d of deals) {
    if ((d.status !== "won" && d.status !== "lost") || d.statusChangedAt === null) continue;
    const row = rows.get(new Date(d.statusChangedAt).toISOString().slice(0, 7));
    if (!row) continue;
    if (d.status === "won") { row.won++; row.wonValue += d.value; } else { row.lost++; row.lostValue += d.value; }
  }
  for (const r of rows.values()) r.winRate = r.won + r.lost > 0 ? r.won / (r.won + r.lost) : null;
  return [...rows.values()];
}

// ---------------- stage dwell (2.3) and funnel (2.1) ----------------

export type StageRow = {
  pipelineId: string; pipelineName: string; stageName: string; stageOrder: number;
  open: number; value: number; avgDwellDays: number | null; bottleneck: boolean; overdue: number;
  reached: number; conversionToNext: number | null;
};

// Funnel is estimated from where deals are NOW: a deal "reached" a stage if it is open at or past
// it, or it was won. (Stage history is not kept, so lost deals are not counted as having passed.)
export function stageTable(deals: Deal[], now: number): StageRow[] {
  const byPipeline = new Map<string, Deal[]>();
  for (const d of deals) {
    const k = `${d.locationId}|${d.pipelineId}`;
    byPipeline.set(k, [...(byPipeline.get(k) ?? []), d]);
  }
  // Roll the same-named pipeline across accounts into one table so agency totals make sense.
  const merged = new Map<string, { pipelineId: string; pipelineName: string; stages: Map<string, { order: number; open: Deal[] }>; won: number; opensByOrder: Map<number, number> }>();
  for (const list of byPipeline.values()) {
    const name = list[0].pipelineName;
    const m = merged.get(name) ?? { pipelineId: name, pipelineName: name, stages: new Map(), won: 0, opensByOrder: new Map() };
    for (const d of list) {
      if (d.status === "won") m.won++;
      if (!isOpen(d)) continue;
      const s = m.stages.get(d.stageName) ?? { order: d.stageOrder, open: [] };
      s.open.push(d);
      s.order = Math.min(s.order, d.stageOrder);
      m.stages.set(d.stageName, s);
      m.opensByOrder.set(d.stageOrder, (m.opensByOrder.get(d.stageOrder) ?? 0) + 1);
    }
    merged.set(name, m);
  }
  const out: StageRow[] = [];
  for (const m of merged.values()) {
    const stages = [...m.stages.entries()].sort((a, b) => a[1].order - b[1].order);
    const dwell = stages.map(([, s]) => mean(s.open.map((d) => days(now - (d.stageChangedAt ?? d.createdAt ?? now)))));
    const dwellAll = mean(dwell.filter((x): x is number => x !== null));
    const reachedAt = (order: number) => m.won + sum([...m.opensByOrder.entries()].filter(([o]) => o >= order).map(([, n]) => n));
    stages.forEach(([name, s], i) => {
      const avg = dwell[i];
      const threshold = avg === null ? null : avg * 2;
      const next = stages[i + 1]?.[1].order;
      const reached = reachedAt(s.order);
      out.push({
        pipelineId: m.pipelineId, pipelineName: m.pipelineName, stageName: name, stageOrder: s.order,
        open: s.open.length, value: sum(s.open.map((d) => d.value)),
        avgDwellDays: avg === null ? null : round(avg, 1),
        bottleneck: avg !== null && dwellAll !== null && s.open.length >= 3 && avg >= dwellAll * 1.5 && avg >= 7,
        overdue: threshold === null ? 0 : s.open.filter((d) => days(now - (d.stageChangedAt ?? d.createdAt ?? now)) > threshold && threshold >= 7).length,
        reached,
        conversionToNext: next !== undefined && reached > 0 ? round(reachedAt(next) / reached, 3) : null,
      });
    });
  }
  return out;
}

// ---------------- risk (2.6) ----------------

export type Risk = { score: number; reasons: string[] };

// 0 to 100. Four plain parts: how long since anything happened, how long it has sat in this
// stage compared with its peers, how old it is compared with deals that were won, and no value.
export function riskScore(d: Deal, now: number, ctx: { stageAvgDays: number | null; avgWonCycle: number | null }): Risk {
  const reasons: string[] = [];
  let score = 0;
  const touch = lastTouch(d);
  const idle = touch === null ? null : days(now - touch);
  if (idle !== null && idle > 7) {
    const p = Math.min(50, Math.round(((idle - 7) / 53) * 50));
    score += p;
    reasons.push(`No activity for ${idle} days`);
  }
  const inStage = d.stageChangedAt ?? d.createdAt;
  if (inStage !== null && ctx.stageAvgDays && ctx.stageAvgDays > 0) {
    const ratio = days(now - inStage) / ctx.stageAvgDays;
    if (ratio > 1) {
      score += Math.min(25, Math.round((ratio - 1) * 25));
      // A ratio of 749x says nothing a person can use, so past 10x the days are given instead (N38).
      if (ratio > 10) reasons.push(`In this stage for ${days(now - inStage)} days; deals here usually stay about ${round(ctx.stageAvgDays, 0)}`);
      else if (ratio >= 1.5) reasons.push(`In this stage ${round(ratio, 1)}x longer than usual`);
    }
  }
  if (d.createdAt !== null && ctx.avgWonCycle && ctx.avgWonCycle > 0) {
    const ratio = days(now - d.createdAt) / ctx.avgWonCycle;
    if (ratio > 1) {
      score += Math.min(15, Math.round((ratio - 1) * 15));
      if (ratio > 10) reasons.push(`Open for ${days(now - (d.createdAt as number))} days; deals that were won took about ${round(ctx.avgWonCycle, 0)}`);
      else if (ratio >= 2) reasons.push(`Open ${round(ratio, 1)}x longer than deals that were won`);
    }
  }
  if (!d.value) {
    score += 10;
    reasons.push("No deal value set");
  }
  return { score: Math.min(100, score), reasons };
}

export type RiskyDeal = Deal & Risk;

export function riskyDeals(deals: Deal[], now: number, limit = 25): RiskyDeal[] {
  const opens = deals.filter(isOpen);
  const avgWonCycle = avgCycleDays(deals);
  const stageAvg = new Map<string, number | null>();
  for (const row of stageTable(deals, now)) stageAvg.set(`${row.pipelineName}|${row.stageName}`, row.avgDwellDays);
  return opens
    .map((d) => ({ ...d, ...riskScore(d, now, { stageAvgDays: stageAvg.get(`${d.pipelineName}|${d.stageName}`) ?? null, avgWonCycle }) }))
    .sort((a, b) => b.score - a.score || b.value - a.value)
    .slice(0, limit);
}

// ---------------- aging (2.11), distribution (2.8) ----------------

export type Bucket = { label: string; count: number; value: number };

export function agingBuckets(deals: Deal[], now: number): { buckets: Bucket[]; valueOlderThan60Pct: number | null } {
  const defs = [
    { label: "0 to 30 days", max: 30 }, { label: "31 to 60 days", max: 60 }, { label: "61 to 90 days", max: 90 }, { label: "Over 90 days", max: Infinity },
  ];
  const buckets: Bucket[] = defs.map((b) => ({ label: b.label, count: 0, value: 0 }));
  for (const d of deals.filter(isOpen)) {
    const age = d.createdAt === null ? null : days(now - d.createdAt);
    if (age === null) continue;
    const i = defs.findIndex((b) => age <= b.max);
    buckets[i].count++;
    buckets[i].value += d.value;
  }
  const total = sum(buckets.map((b) => b.value));
  const old = buckets[2].value + buckets[3].value;
  return { buckets, valueOlderThan60Pct: total > 0 ? Math.round((old / total) * 100) : null };
}

export function valueDistribution(deals: Deal[]) {
  const vals = deals.filter(isOpen).map((d) => d.value).filter((v) => v > 0);
  const edges = [1_000, 5_000, 10_000, 25_000];
  const labels = ["Under $1K", "$1K to $5K", "$5K to $10K", "$10K to $25K", "$25K and over"];
  const buckets: Bucket[] = labels.map((label) => ({ label, count: 0, value: 0 }));
  for (const v of vals) {
    const i = edges.findIndex((e) => v < e);
    const b = buckets[i === -1 ? 4 : i];
    b.count++;
    b.value += v;
  }
  const largest = deals.filter(isOpen).sort((a, b) => b.value - a.value).slice(0, 5);
  return { buckets, average: vals.length ? round(sum(vals) / vals.length) : null, median: vals.length ? round(median(vals) as number) : null, largest };
}

// ---------------- forecast (2.4, N37) and coverage (2.20) ----------------

/** The share of the range the forecast claims to cover: "about 80% sure". */
export const FORECAST_CONFIDENCE = 0.8;
const Z80 = 1.2816;
/** A timing estimate needs this many won deals with dates in the pipeline it describes. */
export const MIN_CYCLES_FOR_TIMING = 10;
/** The owner's own stage probabilities are shown with a sensitivity band of this many points either way (they carry no statistical range). */
export const OWNER_BAND_POINTS = 10;

export type ForecastRange = { low: number; likely: number; high: number };

export type Forecast = {
  /** history = built from the closed deals (a win rate); owner = built from the stage probabilities the owner set; none = neither exists yet. */
  method: "history" | "owner" | "none";
  /** Counted open value the forecast is about (deals with a value and an owner, not in a closed-out stage or an unused pipeline). */
  openValue: number;
  openDeals: number;
  winRate: number | null;
  /** The range of the win rate at FORECAST_CONFIDENCE, from how many deals it was measured on. */
  winRateRange: { low: number; high: number } | null;
  closedDeals: number;
  closedNeeded: number;
  /** The one forecast, as a range, or null when there is no basis for one. */
  range: ForecastRange | null;
  /** The same open value forecast from the owner's stage probabilities, when the owner set any (shown next to the history figure). */
  ownerRange: ForecastRange | null;
  /** Deals left out of the owner-assumption figure because their stage has no probability. */
  ownerUnsetDeals: number;
  /** How much of the range is expected to close within 30, 60 and 90 days, from the real sales cycle. Null when there are too few won deals. */
  horizons: Array<{ days: 30 | 60 | 90; low: number; likely: number; high: number }> | null;
  /** Open deals that could not be placed in time (older than any deal that was won, or in a pipeline with too few won deals). */
  untimedDeals: number;
  cycleSample: number;
  basis: string;
  /** What to show under "How this is calculated". */
  explain: { formula: string; inputs: Array<{ label: string; value: string }>; included: string; excluded: string[]; caveats: string[] };
  stages: Array<{ pipeline: string; stage: string; deals: number; value: number; probability: number | null }>;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The range a rate measured on n cases most likely lies in (Wilson score interval at about 80%). */
export function rateRange(wins: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = wins / n;
  const z2 = Z80 * Z80;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z80 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Of the won deals in this pipeline, how often did a deal that is already `age` days old close within `h` more days? Null when no won deal was ever that old. */
export function closesWithin(cycles: number[], age: number, h: number): number | null {
  const older = cycles.filter((c) => c > age);
  if (older.length === 0) return null;
  return older.filter((c) => c <= age + h).length / older.length;
}

/**
 * The forecast, with its method on show (N37). It is shown only when there is a real basis:
 *  1. history: a win rate from at least 20 closed deals (one minimum for the whole product), as a range with its confidence;
 *  2. the owner's own win probability per stage, labelled as an assumption, with a band either way and no confidence claimed.
 * Timing comes from the real sales cycle of each pipeline (the won deals' created-to-won days), never a flat repeat. Deals with no value, no
 * owner, or sitting in a closed-out stage or an unused pipeline are not in `deals` at all (loadDeals leaves them out), so they are never forecast.
 */
export function forecast(deals: Deal[], now: number, rules: StoredRule[] = []): Forecast {
  const opens = deals.filter(isOpen);
  const openValue = sum(opens.map((d) => d.value));
  const won = deals.filter((d) => d.status === "won").length;
  const lost = deals.filter((d) => d.status === "lost").length;
  const wr = winRateOf(won, lost);
  const rate = wr.rate;
  const rateCi = rate === null ? null : rateRange(won, won + lost);

  // The stage table the forecast rests on, with the owner's probability beside each stage.
  const byStage = new Map<string, { pipeline: string; stage: string; deals: number; value: number; probability: number | null }>();
  for (const d of opens) {
    const k = `${d.pipelineName}\u0000${d.stageName}`;
    const row = byStage.get(k) ?? { pipeline: d.pipelineName, stage: d.stageName, deals: 0, value: 0, probability: stageProbability(d.pipelineName, d.stageName, rules) };
    row.deals++;
    row.value += d.value;
    byStage.set(k, row);
  }
  const stages = [...byStage.values()].sort((a, b) => a.pipeline.localeCompare(b.pipeline) || b.value - a.value);

  // The owner's assumptions.
  const withP = opens.filter((d) => stageProbability(d.pipelineName, d.stageName, rules) !== null);
  const ownerUnsetDeals = opens.length - withP.length;
  const ownerAt = (shift: number) => sum(withP.map((d) => d.value * Math.min(1, Math.max(0, (stageProbability(d.pipelineName, d.stageName, rules) as number) + shift))));
  const ownerRange: ForecastRange | null = withP.length > 0 ? { low: round(ownerAt(-OWNER_BAND_POINTS / 100)), likely: round(ownerAt(0)), high: round(ownerAt(OWNER_BAND_POINTS / 100)) } : null;

  const method: Forecast["method"] = rate !== null ? "history" : ownerRange ? "owner" : "none";
  const range: ForecastRange | null =
    method === "history" && rateCi ? { low: round(openValue * rateCi.low), likely: round(openValue * (rate as number)), high: round(openValue * rateCi.high) }
    : method === "owner" ? ownerRange
    : null;

  // Timing from each pipeline's own won deals.
  const cyclesBy = new Map<string, number[]>();
  for (const d of deals) {
    const c = cycleDays(d);
    if (c !== null) cyclesBy.set(d.pipelineName, [...(cyclesBy.get(d.pipelineName) ?? []), c]);
  }
  let horizons: Forecast["horizons"] = null;
  let untimed = 0;
  let cycleSample = 0;
  if (range) {
    const share = (d: Deal, h: number): number | null => {
      const cycles = cyclesBy.get(d.pipelineName) ?? [];
      if (cycles.length < MIN_CYCLES_FOR_TIMING || d.createdAt === null) return null;
      return closesWithin(cycles, days(now - d.createdAt), h);
    };
    cycleSample = sum([...cyclesBy.values()].filter((c) => c.length >= MIN_CYCLES_FOR_TIMING).map((c) => c.length));
    const eligible = opens.filter((d) => share(d, 90) !== null);
    untimed = opens.length - eligible.length;
    if (eligible.length > 0) {
      // Each deal's chance of closing in the window, on top of the chance it is won at all (the forecast's own low, likely and high).
      const scale = openValue > 0 ? { low: range.low / openValue, likely: range.likely / openValue, high: range.high / openValue } : { low: 0, likely: 0, high: 0 };
      horizons = ([30, 60, 90] as const).map((h) => {
        const timed = sum(eligible.map((d) => d.value * (share(d, h) as number)));
        return { days: h, low: round(timed * scale.low), likely: round(timed * scale.likely), high: round(timed * scale.high) };
      });
    }
  }

  const rangeText = range ? `${money(range.low)} to ${money(range.high)} (most likely ${money(range.likely)})` : "";
  const basis =
    method === "history" && rateCi && range
      ? `About ${Math.round(FORECAST_CONFIDENCE * 100)}% sure the open value converts to between ${money(range.low)} and ${money(range.high)}. That uses a ${Math.round((rate as number) * 100)}% win rate measured on ${won + lost} closed deals, which is really somewhere between ${Math.round(rateCi.low * 100)}% and ${Math.round(rateCi.high * 100)}%. An estimate, not a promise.`
    : method === "owner"
      ? `Your own assumptions: each stage's win probability as you set it, with a band of ${OWNER_BAND_POINTS} points either way. ${rangeText}. These are your assumptions, not measured results, so there is no confidence figure.`
      : `No forecast yet. It needs ${MIN_CLOSED_DEALS} closed deals (there are ${won + lost}, so ${wr.needed} more), or a win probability that you set for each stage.`;

  return {
    method, openValue, openDeals: opens.length, winRate: rate === null ? null : round(rate, 3),
    winRateRange: rateCi ? { low: round(rateCi.low, 3), high: round(rateCi.high, 3) } : null,
    closedDeals: won + lost, closedNeeded: wr.needed, range, ownerRange, ownerUnsetDeals, horizons, untimedDeals: untimed, cycleSample, basis, stages,
    explain: {
      formula: method === "history"
        ? "Open value x the share of closed deals that were won. The range comes from how many deals that share was measured on: fewer deals, wider range."
        : method === "owner" ? "For each open deal: its value x the win probability you set for its stage. Added up."
        : "A forecast needs either a win rate from closed deals or a win probability set for each stage.",
      inputs: [
        { label: "Open deals counted", value: String(opens.length) },
        { label: "Open value counted", value: money(openValue) },
        { label: "Closed deals (won plus lost)", value: `${won + lost} (minimum ${MIN_CLOSED_DEALS})` },
        ...(rate !== null ? [{ label: "Win rate", value: `${Math.round(rate * 100)}%` }] : []),
        ...(cycleSample > 0 ? [{ label: "Won deals used for timing", value: String(cycleSample) }] : []),
      ],
      included: "Open deals that have a value above zero and an owner, and that are not in a closed-out stage or in a pipeline marked not in use.",
      excluded: [
        "Open deals with no value or no owner (the screen says how many were left out).",
        "Deals in a stage that is closed out or ignored, and in a pipeline that is not in use (you can change that under Stages and pipelines).",
        "Open deals in a stage with no probability are left out of the figure built from your own assumptions.",
      ],
      caveats: [
        "Amounts are as entered in each account; different currencies are not converted.",
        "It assumes open deals behave like the deals that were closed before. A new offer or a new team can break that.",
        horizons
          ? `Timing: how often a won deal of the same age in the same pipeline closed within 30, 60 or 90 more days (${cycleSample} won deals). ${untimed} open ${untimed === 1 ? "deal is" : "deals are"} not placed in time, because ${untimed === 1 ? "it is" : "they are"} older than any won deal or in a pipeline with too few won deals.`
          : `Timing needs at least ${MIN_CYCLES_FOR_TIMING} won deals with dates in the same pipeline, so none is shown.`,
      ],
    },
  };
}

export function coverage(openValue: number, monthlyTarget: number | null) {
  if (!monthlyTarget || monthlyTarget <= 0) return null;
  const needed = monthlyTarget * 3;
  return { target: monthlyTarget, needed, openValue, gap: Math.max(0, needed - openValue), ratio: round(openValue / monthlyTarget, 2), healthy: openValue >= needed };
}

// ---------------- abandoned deals (2.16) and dead pipeline (2.21) ----------------

export function abandonedDeals(deals: Deal[], now: number, withinDays = 90, limit = 50) {
  const rows = deals
    .filter((d) => d.status === "lost" && d.statusChangedAt !== null && now - d.statusChangedAt <= withinDays * DAY && d.value > 0)
    .sort((a, b) => b.value - a.value);
  return { total: rows.length, value: sum(rows.map((d) => d.value)), deals: rows.slice(0, limit) };
}

export function deadPipeline(deals: Deal[], now: number, limit = 50) {
  const rows = deals.filter(isOpen).flatMap((d) => {
    const why: string[] = [];
    const t = lastTouch(d);
    if (t === null || now - t > 90 * DAY) why.push("No activity for 90+ days");
    if (!d.value) why.push("No value");
    if (!d.contactName) why.push("No contact linked");
    return why.length >= 2 || (t !== null && now - t > 90 * DAY) ? [{ deal: d, reasons: why }] : [];
  });
  return { total: rows.length, rows: rows.slice(0, limit) };
}

// ---------------- per account and per pipeline summaries (2.15, 2.22) ----------------

export type AccountDealSummary = {
  locationId: string; locationName: string | null; openCount: number; openValue: number; winRate: number | null;
  avgCycleDays: number | null; staleShare: number | null; avgRisk: number | null;
};

export function accountSummaries(deals: Deal[], now: number): AccountDealSummary[] {
  const by = new Map<string, Deal[]>();
  for (const d of deals) by.set(d.locationId, [...(by.get(d.locationId) ?? []), d]);
  return [...by.entries()].map(([locationId, list]) => {
    const opens = list.filter(isOpen);
    const stale = opens.filter((d) => { const t = lastTouch(d); return t !== null && now - t > 30 * DAY; }).length;
    const risks = riskyDeals(list, now, 100000).map((d) => d.score);
    return {
      locationId, locationName: list[0].locationName, openCount: opens.length, openValue: sum(opens.map((d) => d.value)),
      winRate: winRate(list), avgCycleDays: avgCycleDays(list), staleShare: opens.length ? round(stale / opens.length, 3) : null,
      avgRisk: risks.length ? round(mean(risks) as number) : null,
    };
  }).sort((a, b) => b.openValue - a.openValue);
}

export function pipelineSummaries(deals: Deal[]) {
  const by = new Map<string, Deal[]>();
  for (const d of deals) by.set(`${d.locationId}|${d.pipelineId}`, [...(by.get(`${d.locationId}|${d.pipelineId}`) ?? []), d]);
  return [...by.values()].map((list) => ({
    locationId: list[0].locationId, locationName: list[0].locationName, pipelineName: list[0].pipelineName,
    openCount: list.filter(isOpen).length, openValue: sum(list.filter(isOpen).map((d) => d.value)),
    winRate: winRate(list), avgCycleDays: avgCycleDays(list),
  })).sort((a, b) => b.openValue - a.openValue);
}
