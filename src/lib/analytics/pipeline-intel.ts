// Pipeline and deal intelligence (spec section 2). Pure functions over cached deal rows, so every
// number is explainable and unit tested. Nothing here talks to the database.
import { MIN_CLOSED_DEALS, winRate } from "./metrics.ts";

export type Deal = {
  opportunityId: string;
  locationId: string;
  locationName: string | null;
  pipelineId: string;
  pipelineName: string;
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
      if (ratio >= 1.5) reasons.push(`In this stage ${round(ratio, 1)}x longer than usual`);
    }
  }
  if (d.createdAt !== null && ctx.avgWonCycle && ctx.avgWonCycle > 0) {
    const ratio = days(now - d.createdAt) / ctx.avgWonCycle;
    if (ratio > 1) {
      score += Math.min(15, Math.round((ratio - 1) * 15));
      if (ratio >= 2) reasons.push(`Open ${round(ratio, 1)}x longer than deals that were won`);
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

// ---------------- forecast (2.4) and coverage (2.20) ----------------

export type Forecast = {
  openValue: number;
  likely: number;
  best: number;
  worst: number;
  winRate: number | null;
  basis: string;
  horizons: Array<{ days: 30 | 60 | 90; likely: number }> | null;
};

// Likely = open value times the win rate. Best and worst widen it. The 30/60/90 view counts a deal
// as "due" once it is as old as the average won deal (overdue deals count in the first window).
export function forecast(deals: Deal[], now: number, fallbackWinRate: number | null = null): Forecast {
  const opens = deals.filter(isOpen);
  const openValue = sum(opens.map((d) => d.value));
  const rate = winRate(deals) ?? fallbackWinRate;
  if (rate === null) {
    return { openValue, likely: 0, best: 0, worst: 0, winRate: null, basis: `Not enough closed deals yet (needs at least ${MIN_CLOSED_DEALS}) to estimate a win rate.`, horizons: null };
  }
  const cycle = avgCycleDays(deals);
  const likely = openValue * rate;
  const horizons = cycle === null ? null : ([30, 60, 90] as const).map((h) => ({
    days: h,
    likely: round(sum(opens.filter((d) => d.createdAt !== null && days(now - d.createdAt) + h >= cycle).map((d) => d.value)) * rate),
  }));
  return {
    openValue, likely: round(likely), best: round(openValue * Math.min(1, rate * 1.5)), worst: round(openValue * rate * 0.5),
    winRate: round(rate, 3), basis: `Open value times a ${Math.round(rate * 100)}% win rate. An estimate, not a promise.`, horizons,
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
