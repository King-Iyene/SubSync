// Pipeline round 3: the pure part (no database, no network), unit tested. Definitions: docs/METRICS.md "Pipeline 3".
import { rateRange } from "./pipeline-intel.ts";
import type { Estimate, FlowStage, Pl3Overview, Pl3Row, Rate } from "./pipeline3-types.ts";

export const DAY = 86_400_000;
/** Minimums. Under them the screen says "not enough data", never a number. */
export const MIN_CLOSED = 15, MIN_STAGE_PASSED = 20, MIN_STAYS = 20, MIN_LOST_REASONS = 10, MIN_WIN_RATE = 15, MIN_PEOPLE = 5, MIN_OUTLIER_DEALS = 3, MIN_TRACK = 6;
export const OUTLIER_SHARE = 0.4;
export const STALE_FLOOR_DAYS = 3, STALE_CAP_DAYS = 60, DEFAULT_LIMIT_DAYS = 14;
export const SHRINK_K = 10;
export const MAX_WINDOW_DAYS = 366;
export const clampSize = (n: number): 20 | 50 | 100 => (n >= 100 ? 100 : n >= 50 ? 50 : 20);
export const rate = (n: number, of: number, min = MIN_WIN_RATE): Rate => ({ value: of >= min && of > 0 ? n / of : null, n, of, enough: of >= min });
export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const slug = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** The key a stage is merged under across accounts: pipeline name and stage name, lower case. */
export const stageKey = (pipelineName: string | null | undefined, stageName: string | null | undefined) => `${slug(pipelineName)}|${slug(stageName)}`;

export function parsePlWindow(from: string | null | undefined, to: string | null | undefined, now: number): { from: Date; to: Date; days: number; problem: string | null } {
  const t = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v.slice(0, 10)) : null);
  let f = t(from), e = t(to), problem: string | null = null;
  if (e !== null) e += DAY;
  if (f === null || e === null) { e = now + DAY - (now % DAY); f = e - 30 * DAY; if (from || to) problem = "That date range was not understood, so the last 30 days are shown."; }
  if (e <= f) { e = now + DAY - (now % DAY); f = e - 30 * DAY; problem = "The end date was before the start date, so the last 30 days are shown."; }
  if (e - f > MAX_WINDOW_DAYS * DAY) { f = e - MAX_WINDOW_DAYS * DAY; problem = "The range is capped at one year."; }
  return { from: new Date(f), to: new Date(e), days: Math.round((e - f) / DAY), problem };
}

export const est = (value: number | null, low: number | null, high: number | null, enough: boolean, formula: string, minNote: string | null): Estimate => ({ value, low, high, enough, estimate: true, formula, minNote });
export const NO_EST = (formula: string, minNote: string): Estimate => est(null, null, null, false, formula, minNote);

export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (xs: number[]) => percentile(xs, 0.5);

// ---------- stale, per stage ----------

/** The stale limit of one stage. Own 75th percentile of completed stays when there are at least 20 (floor 3, cap 60 days); else an ESTIMATE: twice the median won cycle divided by the stage count (same bounds); else 14. */
export function staleLimitFrom(i: { stays: number; p75: number | null; stageCount: number; wonN: number; wonCycleDays: number | null }): { days: number; estimate: boolean } {
  const clamp = (d: number) => Math.round(Math.min(STALE_CAP_DAYS, Math.max(STALE_FLOOR_DAYS, d)) * 10) / 10;
  if (i.stays >= MIN_STAYS && i.p75 !== null) return { days: clamp(i.p75), estimate: false };
  if (i.wonN >= 5 && i.wonCycleDays !== null && i.stageCount > 0) return { days: clamp((2 * i.wonCycleDays) / i.stageCount), estimate: true };
  return { days: DEFAULT_LIMIT_DAYS, estimate: true };
}

// ---------- probabilities and forecast ----------

/** Shrunk win probability of a stage: (wins + k x prior) / (n + k), with the Wilson 80% interval on the shrunk counts. Shown only from 20 deals that passed the stage; else `assumed`. */
export function stageProbability(wins: number, passed: number, prior: number | null): { p: number | null; low: number | null; high: number | null; enough: boolean; assumed: boolean } {
  const enough = passed >= MIN_STAGE_PASSED;
  if (prior === null) return { p: enough && passed > 0 ? wins / passed : null, low: null, high: null, enough, assumed: false };
  const nEff = passed + SHRINK_K, wEff = wins + SHRINK_K * prior;
  const r = rateRange(Math.round(wEff), Math.round(nEff));
  return { p: wEff / nEff, low: r?.low ?? null, high: r?.high ?? null, enough, assumed: !enough };
}

/** The 30-day range: open dollars x the account's win-rate range x a timing factor (30 days over the median won cycle, at most 1). Null under 15 closed deals. */
export function dealForecastRange(openValue: number, won: number, closed: number, cycleDays: number | null = null): { low: number; mid: number; high: number } | null {
  if (closed < MIN_CLOSED || openValue <= 0) return null;
  const r = rateRange(won, closed);
  if (!r) return null;
  const f = cycleDays && cycleDays > 30 ? 30 / cycleDays : 1;
  return { low: Math.round(openValue * r.low * f), mid: Math.round(openValue * (won / closed) * f), high: Math.round(openValue * r.high * f) };
}
export const FORECAST_FORMULA = "Open dollars of counted deals (value above zero, an owner, in play, one deal capped at the 95th percentile) x your own win rate over the last year (as an 80% range) x a timing factor (30 days over your median won cycle, at most 1). An estimate, not a promise.";

export function forecastEstimate(openValue: number, won: number, closed: number, cycleDays: number | null): Estimate {
  const r = dealForecastRange(openValue, won, closed, cycleDays);
  if (!r) return NO_EST(FORECAST_FORMULA, closed < MIN_CLOSED ? `Not enough data: needs ${MIN_CLOSED} closed deals, has ${closed}.` : "No counted open deals.");
  return est(r.mid, r.low, r.high, true, FORECAST_FORMULA, null);
}

/** Weighted pipeline = sum(value x P(stage)). Stages without enough history use the account's overall rate (assumed). Returns null under the closed-deal minimum. */
export function weightedPipeline(stages: Array<{ value: number; p: ReturnType<typeof stageProbability> }>, prior: number | null, closed: number): Estimate {
  const formula = "Sum over open counted deals of value x the chance a deal in that stage is won, from your own history (shrunk toward your overall win rate, 80% range). Stages with fewer than 20 deals in history use your overall rate and are marked assumed.";
  if (closed < MIN_CLOSED || prior === null) return NO_EST(formula, `Not enough data: needs ${MIN_CLOSED} closed deals, has ${closed}.`);
  let mid = 0, low = 0, high = 0;
  for (const s of stages) {
    const p = s.p.enough && s.p.p !== null ? s.p : { p: prior, low: rateRange(Math.round(prior * 100), 100)?.low ?? prior, high: rateRange(Math.round(prior * 100), 100)?.high ?? prior };
    mid += s.value * (p.p ?? prior); low += s.value * (p.low ?? p.p ?? prior); high += s.value * (p.high ?? p.p ?? prior);
  }
  return est(Math.round(mid), Math.round(low), Math.round(high), true, formula, null);
}

/** Velocity (standard): open counted deals x win rate x average won value / median won cycle days, per day. */
export function velocityEstimate(openN: number, winRate: number | null, avgWon: number | null, cycleDays: number | null, closed: number): Estimate {
  const formula = "Open counted deals x win rate x average won deal / median days from creation to won. Dollars per day. An estimate.";
  if (closed < MIN_CLOSED || winRate === null || avgWon === null || !cycleDays || cycleDays <= 0) return NO_EST(formula, `Not enough data: needs ${MIN_CLOSED} closed deals and some won deals with dates.`);
  const v = (openN * winRate * avgWon) / cycleDays;
  return est(Math.round(v), null, null, true, formula, null);
}

/** Revenue at risk: weighted value of counted deals past their stage limit, as a range from the same probabilities. Never the same number as the stale total. */
export function atRiskEstimate(stale: Array<{ value: number; p: ReturnType<typeof stageProbability> }>, prior: number | null, closed: number): Estimate {
  const e = weightedPipeline(stale, prior, closed);
  return { ...e, formula: "Stale counted deals (past the limit for their stage), each valued at value x its chance of being won. This is the money likely to be lost if nobody acts, not the sticker value." };
}

/** The 95th percentile cap for forecast totals. Returns the cap (null when fewer than 20 values) and which values were capped. */
export function capOutliers(values: Array<{ id: string; value: number }>): { cap: number | null; capped: Array<{ id: string; value: number; cappedTo: number }> } {
  if (values.length < 20) return { cap: null, capped: [] };
  const cap = percentile(values.map((v) => v.value), 0.95);
  if (cap === null) return { cap: null, capped: [] };
  return { cap, capped: values.filter((v) => v.value > cap).map((v) => ({ id: v.id, value: v.value, cappedTo: cap })) };
}

/** A single deal over 40% of a total (needs at least 3 deals) is an outlier: shown apart with a note. */
export const isOutlier = (value: number, total: number, n: number) => n >= MIN_OUTLIER_DEALS && total > 0 && value > OUTLIER_SHARE * total;

// ---------- deal health (0 to 100) ----------

/** Health of one deal, with the plain reason. Deterministic from the row. Never invented: a closed deal has none. */
export function dealHealth(d: { status: string; value: number; ownerId: string | null; isTest: boolean; daysInStage: number | null; staleLimitDays: number | null; daysSinceActivity: number | null; hasAppointment: boolean; dnd: boolean }): { score: number | null; why: string | null } {
  if (d.status !== "open") return { score: null, why: null };
  let s = 100; const why: string[] = [];
  if (d.isTest) { s -= 60; why.push("looks like a test deal"); }
  if (!d.ownerId) { s -= 20; why.push("nobody owns it"); }
  if (!(d.value > 0)) { s -= 15; why.push("no value set"); }
  if (d.daysInStage !== null && d.staleLimitDays !== null && d.daysInStage > d.staleLimitDays) {
    const over = Math.min(2, d.daysInStage / d.staleLimitDays - 1);
    s -= Math.round(20 + 10 * over);
    why.push(`${Math.floor(d.daysInStage)} days in this stage, the usual limit is ${Math.round(d.staleLimitDays)}`);
  }
  if (d.daysSinceActivity !== null && d.daysSinceActivity > 14) { s -= 10; why.push(`no activity for ${Math.floor(d.daysSinceActivity)} days`); }
  if (d.hasAppointment) s += 5;
  if (d.dnd) { s -= 5; why.push("do not disturb is on"); }
  return { score: Math.max(0, Math.min(100, s)), why: why.length ? why.join("; ") : null };
}

// ---------- leak finder ----------

export type StageLoss = { stageId: string; stageName: string; nextStageId: string | null; reachedValue: number; reachedCount: number; lostValue: number; lostCount: number };
/** The biggest money drop: the stage where the most dollars are lost, in plain words, with its share of what reached it. Null when there is no loss to report. */
export function findLeak(stages: StageLoss[]): { text: string; fromStageId: string; toStageId: string | null; lostValue: number; lostCount: number } | null {
  const worst = [...stages].filter((s) => s.lostValue > 0 && s.lostCount >= 2).sort((a, b) => b.lostValue - a.lostValue)[0];
  if (!worst) return null;
  const share = worst.reachedValue > 0 ? Math.round((worst.lostValue / worst.reachedValue) * 100) : null;
  return {
    text: `Most money is lost at ${worst.stageName}: ${money(worst.lostValue)} across ${worst.lostCount} deal${worst.lostCount === 1 ? "" : "s"}${share !== null && share <= 100 ? ` (${share}% of the money that reached it)` : ""}.`,
    fromStageId: worst.stageId, toStageId: worst.nextStageId, lostValue: worst.lostValue, lostCount: worst.lostCount,
  };
}

// ---------- overview helpers ----------

export function headlineOf(o: { openCount: number; staleCount: number; staleValue: number; winRate: Rate; won30: number; noOwner: number }): string {
  if (!o.openCount && !o.won30) return "No deals in play yet.";
  const parts: string[] = [];
  if (o.staleCount > 0) parts.push(`${o.staleCount} deal${o.staleCount === 1 ? " is" : "s are"} stuck (${money(o.staleValue)})`);
  if (o.winRate.enough && o.winRate.value !== null) parts.push(`win rate ${Math.round(o.winRate.value * 100)}%`);
  else parts.push("not enough closed deals for a win rate");
  if (o.noOwner > 0) parts.push(`${o.noOwner} deal${o.noOwner === 1 ? "" : "s"} with no owner`);
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

/** The one button on the overview: the biggest money problem first. */
export function pickButton(o: { staleCount: number; staleValue: number; noOwner: number; noReason: number }): Pl3Overview["button"] {
  if (o.staleCount > 0) return { label: `Unclog ${o.staleCount} deal${o.staleCount === 1 ? "" : "s"} (${money(o.staleValue)})`, part: "attention", bucket: "stale", count: o.staleCount };
  if (o.noOwner > 0) return { label: `Give ${o.noOwner} deal${o.noOwner === 1 ? "" : "s"} an owner`, part: "health", bucket: "no_owner", count: o.noOwner };
  if (o.noReason > 0) return { label: `Add a reason to ${o.noReason} lost deal${o.noReason === 1 ? "" : "s"}`, part: "won-lost", bucket: "no_reason", count: o.noReason };
  return null;
}

/** Data-health score 0 to 100 for an account: the share of open deals with no flag (stale, no owner, no value, test, outlier). Null under 5 open deals. */
export function healthScore(open: number, flagged: number): number | null {
  return open >= 5 ? Math.round(100 * (1 - Math.min(flagged, open) / open)) : null;
}

/** Coaching line for a person, from their own numbers only (never a benchmark). Null when nothing stands out or the sample is small. */
export function coachingLine(p: { winRate: Rate; burned: number; lost: number; staleCount: number; open: number; teamWinRate: number | null }): string | null {
  if (p.staleCount >= 5 && p.open > 0 && p.staleCount / p.open >= 0.4) return `${p.staleCount} of ${p.open} open deals are stuck. Start with the oldest.`;
  if (p.lost >= MIN_PEOPLE && p.burned / p.lost >= 0.5) return `${p.burned} of ${p.lost} lost deals sat untouched for days before they were lost. Earlier follow-up could save some.`;
  if (p.winRate.enough && p.winRate.value !== null && p.teamWinRate !== null && p.winRate.value + 0.1 < p.teamWinRate) return `Win rate is ${Math.round(p.winRate.value * 100)}%, below the team's ${Math.round(p.teamWinRate * 100)}%.`;
  return null;
}

// ---------- the money flow: merge per-account stage rows into one set of pipes ----------

export type StageMeta = { key: string; name: string; order: number; pipelineName: string };
export type StageAgg = { key: string; openCount: number; openValue: number; staleCount: number; staleValue: number; medianDays: number | null; normalDays: number | null; staysN: number };

/** Pressure = how long deals sit now against the account's own normal (1 = normal, 2 = twice as long). Null under 20 completed stays. */
export function pressureOf(medianDays: number | null, normalDays: number | null, stays: number): number | null {
  if (medianDays === null || normalDays === null || normalDays <= 0 || stays < MIN_STAYS) return null;
  return Math.round((medianDays / normalDays) * 100) / 100;
}

/** Merge rows into FlowStage nodes. Velocity is relative: the shortest median is 1, the longest approaches 0. */
export function buildStages(meta: StageMeta[], aggs: StageAgg[], pipelineId: string): FlowStage[] {
  const by = new Map(aggs.map((a) => [a.key, a]));
  const stages = meta.map((m) => {
    const a = by.get(m.key);
    return { m, a };
  });
  const meds = stages.map((s) => s.a?.medianDays).filter((x): x is number => x !== null && x !== undefined && x > 0);
  const lo = meds.length ? Math.min(...meds) : null, hi = meds.length ? Math.max(...meds) : null;
  return stages.map(({ m, a }) => ({
    id: m.key, pipelineId, name: m.name, order: m.order, openCount: a?.openCount ?? 0, openValue: Math.round(a?.openValue ?? 0),
    dwell: { medianDays: a?.medianDays ?? null, normalDays: a?.normalDays ?? null, pressure: a ? pressureOf(a.medianDays, a.normalDays, a.staysN) : null, enough: !!a && a.staysN >= MIN_STAYS },
    clog: { count: a?.staleCount ?? 0, value: Math.round(a?.staleValue ?? 0) },
    velocity: a?.medianDays && lo !== null && hi !== null ? (hi === lo ? 1 : Math.round((1 - (a.medianDays - lo) / (hi - lo) * 0.85) * 100) / 100) : null,
  })).sort((x, y) => x.order - y.order);
}

/** Replay: rewind the current stock of each stage through the daily moves so each frame holds the stock at the end of that day. */
export type DayMove = { day: string; from: string | null; to: string | null; status: "won" | "lost" | null; count: number; value: number };
export function buildReplay(days: string[], current: Array<{ stageId: string; count: number; value: number }>, moves: DayMove[]) {
  const stock = new Map(current.map((c) => [c.stageId, { count: c.count, value: c.value }]));
  const frames: Array<{ day: string; stages: Array<{ stageId: string; count: number; value: number }>; wonValue: number; lostValue: number; moved: Array<{ from: string | null; to: string; count: number; value: number }> }> = [];
  const byDay = new Map<string, DayMove[]>();
  for (const m of moves) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i], ms = byDay.get(day) ?? [];
    frames.push({
      day, stages: [...stock.entries()].map(([stageId, v]) => ({ stageId, count: Math.max(0, v.count), value: Math.max(0, Math.round(v.value)) })),
      wonValue: Math.round(ms.filter((m) => m.status === "won").reduce((t, m) => t + m.value, 0)), lostValue: Math.round(ms.filter((m) => m.status === "lost").reduce((t, m) => t + m.value, 0)),
      moved: ms.filter((m) => m.to && !m.status).map((m) => ({ from: m.from, to: m.to as string, count: m.count, value: Math.round(m.value) })),
    });
    // Going back one day: undo that day's moves (a deal that entered a stage was not there before; one that left was).
    for (const m of ms) {
      if (m.to && !m.status) { const t = stock.get(m.to) ?? { count: 0, value: 0 }; stock.set(m.to, { count: t.count - m.count, value: t.value - m.value }); }
      const leave = m.from;
      if (leave) { const f = stock.get(leave) ?? { count: 0, value: 0 }; stock.set(leave, { count: f.count + m.count, value: f.value + m.value }); }
    }
  }
  return frames.reverse();
}

/** Track record of past forecasts: coverage = how often the won dollars landed inside the logged range; bias = forecast mid / actual. Needs 6 forecasts 30 or more days old. */
export function trackRecord(rows: Array<{ day: string; low: number; mid: number; high: number; actual: number }>): { enough: boolean; coverage: Rate; bias: number | null; months: Array<{ month: string; forecast: number; actual: number }> } {
  const enough = rows.length >= MIN_TRACK;
  const inside = rows.filter((r) => r.actual >= r.low && r.actual <= r.high).length;
  const months = new Map<string, { forecast: number; actual: number; n: number }>();
  for (const r of rows) { const k = r.day.slice(0, 7), m = months.get(k) ?? { forecast: 0, actual: 0, n: 0 }; months.set(k, { forecast: m.forecast + r.mid, actual: m.actual + r.actual, n: m.n + 1 }); }
  const tf = rows.reduce((t, r) => t + r.mid, 0), ta = rows.reduce((t, r) => t + r.actual, 0);
  return {
    enough, coverage: { value: enough ? inside / rows.length : null, n: inside, of: rows.length, enough },
    bias: enough && ta > 0 ? Math.round((tf / ta) * 100) / 100 : null,
    months: [...months.entries()].sort().map(([month, m]) => ({ month, forecast: Math.round(m.forecast / m.n), actual: Math.round(m.actual / m.n) })),
  };
}

export const bucketOf = (r: { status: string; stale: boolean; outlier: boolean; isTest: boolean; ownerId: string | null; value: number; counted: boolean }): Pl3Row["bucket"] =>
  r.status === "won" ? "won" : r.status === "lost" ? "lost" : r.status === "abandoned" ? "abandoned" : r.isTest ? "test" : r.outlier ? "outlier" : !r.ownerId ? "no_owner" : !(r.value > 0) ? "no_value" : r.stale ? "stale" : r.counted ? "healthy" : "open";

/** One line of the deal timeline, in plain words (names are resolved by the caller). */
export function eventText(kind: string, from: string | null, to: string | null): string {
  const m = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? money(Number(v)) : v ?? "none");
  switch (kind) {
    case "created": return to ? `Deal created in ${to}` : "Deal created";
    case "stage": return from ? `Moved from ${from} to ${to ?? "another stage"}` : `Entered ${to ?? "a stage"}`;
    case "status": return to === "won" ? "Marked won" : to === "lost" ? "Marked lost" : to === "open" ? "Reopened" : `Status changed to ${to ?? "unknown"}`;
    case "value": return `Value changed from ${m(from)} to ${m(to)}`;
    case "owner": return from ? `Owner changed from ${from} to ${to ?? "nobody"}` : to ? `Assigned to ${to}` : "Owner removed";
    case "lost_reason": return "Lost reason recorded";
    case "source": return to ? `Source set to ${to}` : "Source cleared";
    case "appointment_linked": return "Linked to an appointment";
    case "deleted": return "Removed in the CRM";
    default: return "Note added";
  }
}

/** Keyset cursor of the default order (value high to low, then deal id): "value|id". Anything else is no cursor. */
export function parseDealCursor(c: string | null | undefined): { v: number; id: string } | null {
  const m = /^(\d{1,15}(?:\.\d{1,6})?)\|([A-Za-z0-9_-]{1,64})$/.exec(c ?? "");
  return m ? { v: Number(m[1]), id: m[2] } : null;
}

/** The cursor is "value|account|pipeline", checked on the way in (a bad one is the first page). */
export function parseCursor(c: string | null | undefined): { v: number; loc: string; pid: string } | null {
  const m = /^(\d{1,15}(?:\.\d{1,2})?)\|([A-Za-z0-9_-]{1,64})\|([A-Za-z0-9_-]{1,64})$/.exec(c ?? "");
  return m ? { v: Number(m[1]), loc: m[2], pid: m[3] } : null;
}

