import type { Deal } from "./pipeline-intel.ts";

// The Pipeline board's numbers (stage MOAT), money first. Pure: the route loads the deals and the contact facts, this file counts.
//
//   Counted once: every open deal appears in exactly one stage of one pipeline and is added to the headline exactly once (a deal id seen twice is counted once).
//   Stuck, judged per stage: a deal is stuck when it has sat in its CURRENT stage longer than that stage's own limit AND nothing has happened on it for 7 days (or nothing is known).
//     A stage's limit is twice the median time open deals have sat in that stage, kept between 5 and 30 days; a stage with fewer than 5 deals uses the account's stale-days setting.
//   No next step: an open deal with no upcoming appointment for its contact AND no activity in the last 7 days.
//   Money columns only count what loadDeals already counts (a value above zero, an owner, a pipeline in use, not a closed-out stage); the route says how many were left out.

export const DAY = 86_400_000;
export const MIN_STAGE_DEALS = 5;
export const STAGE_LIMIT = { min: 5, max: 30 } as const;
export const QUIET_DAYS = 7;
export const CARDS_PER_STAGE = 6;

export type BoardInput = { deals: readonly Deal[]; now: number; fallbackStaleDays: number; /** opportunity id -> facts from the contact (id, upcoming appointment) */ contacts: ReadonlyMap<string, { contactId: string | null; upcoming: boolean }> };

export type Card = { id: string; contactId: string | null; locationId: string; locationName: string | null; name: string; value: number; daysInStage: number | null; quietDays: number | null; stuck: boolean; noNextStep: boolean };
export type StageCol = { id: string; name: string; order: number; count: number; value: number; stuck: number; limitDays: number; cards: Card[]; more: number };
export type PipelineCol = { key: string; locationId: string; locationName: string | null; name: string; openCount: number; openValue: number; stuckCount: number; stuckValue: number; stages: StageCol[] };
export type Board = {
  headline: { openCount: number; openValue: number; stuckCount: number; stuckValue: number; noNextStepCount: number };
  pipelines: PipelineCol[];
  byClient: Array<{ locationId: string; name: string | null; stuckCount: number; stuckValue: number }>;
  /** All stuck deal ids with their contact, for the one "Move the stuck deals" walk-through. */
  stuckQueue: Array<{ id: string; contactId: string | null; locationId: string }>;
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stageKey = (d: Deal) => `${d.locationId}|${d.pipelineId}|${d.stageId ?? d.stageName}`;
const since = (at: number | null, now: number) => (at === null ? null : Math.max(0, Math.floor((now - at) / DAY)));
const inStageSince = (d: Deal) => d.stageChangedAt ?? d.createdAt;

/** Each stage's own limit in days. */
export function stageLimits(deals: readonly Deal[], now: number, fallbackStaleDays: number): Map<string, number> {
  const ages = new Map<string, number[]>();
  for (const d of deals) {
    const a = since(inStageSince(d), now);
    if (a === null) continue;
    (ages.get(stageKey(d)) ?? ages.set(stageKey(d), []).get(stageKey(d))!).push(a);
  }
  const out = new Map<string, number>();
  for (const [k, xs] of ages) out.set(k, xs.length >= MIN_STAGE_DEALS ? Math.min(STAGE_LIMIT.max, Math.max(STAGE_LIMIT.min, Math.round(2 * median(xs)))) : fallbackStaleDays);
  return out;
}

export function boardOf(input: BoardInput): Board {
  const { now } = input;
  // counted once
  const seen = new Map<string, Deal>();
  for (const d of input.deals) if (d.status === "open" && d.value > 0 && !seen.has(d.opportunityId)) seen.set(d.opportunityId, d);
  const open = [...seen.values()];
  const limits = stageLimits(open, now, input.fallbackStaleDays);

  const pipes = new Map<string, PipelineCol>();
  const byClient = new Map<string, { locationId: string; name: string | null; stuckCount: number; stuckValue: number }>();
  const stuckQueue: Board["stuckQueue"] = [];
  const stageCards = new Map<string, Card[]>();
  const stageMeta = new Map<string, StageCol>();
  let noNext = 0;

  for (const d of open) {
    const days = since(inStageSince(d), now);
    const quiet = since(d.lastActivityAt, now);
    const limit = limits.get(stageKey(d)) ?? input.fallbackStaleDays;
    const stuck = days !== null && days > limit && (quiet === null || quiet > QUIET_DAYS);
    const facts = input.contacts.get(d.opportunityId);
    const noNextStep = !facts?.upcoming && (quiet === null || quiet > QUIET_DAYS);
    if (noNextStep) noNext++;
    const pk = `${d.locationId}|${d.pipelineId}`;
    const pipe = pipes.get(pk) ?? { key: pk, locationId: d.locationId, locationName: d.locationName, name: d.pipelineName, openCount: 0, openValue: 0, stuckCount: 0, stuckValue: 0, stages: [] };
    pipes.set(pk, pipe);
    pipe.openCount++; pipe.openValue += d.value;
    if (stuck) {
      pipe.stuckCount++; pipe.stuckValue += d.value;
      const c = byClient.get(d.locationId) ?? { locationId: d.locationId, name: d.locationName, stuckCount: 0, stuckValue: 0 };
      c.stuckCount++; c.stuckValue += d.value; byClient.set(d.locationId, c);
      stuckQueue.push({ id: d.opportunityId, contactId: facts?.contactId ?? null, locationId: d.locationId });
    }
    const sk = stageKey(d);
    let col = stageMeta.get(sk);
    if (!col) { col = { id: d.stageId ?? d.stageName, name: d.stageName, order: d.stageOrder, count: 0, value: 0, stuck: 0, limitDays: limit, cards: [], more: 0 }; stageMeta.set(sk, col); pipe.stages.push(col); }
    col.count++; col.value += d.value; if (stuck) col.stuck++;
    (stageCards.get(sk) ?? stageCards.set(sk, []).get(sk)!).push({ id: d.opportunityId, contactId: facts?.contactId ?? null, locationId: d.locationId, locationName: d.locationName, name: d.name ?? d.contactName ?? "Untitled deal", value: d.value, daysInStage: days, quietDays: quiet, stuck, noNextStep });
  }
  for (const [sk, col] of stageMeta) {
    // stuck first, then the biggest: what to act on is on top
    const cards = (stageCards.get(sk) ?? []).sort((a, b) => Number(b.stuck) - Number(a.stuck) || b.value - a.value);
    col.cards = cards.slice(0, CARDS_PER_STAGE); col.more = Math.max(0, cards.length - CARDS_PER_STAGE);
  }
  const pipelines = [...pipes.values()].map((p) => ({ ...p, stages: p.stages.sort((a, b) => a.order - b.order) })).sort((a, b) => b.openValue - a.openValue);
  return {
    headline: { openCount: open.length, openValue: open.reduce((s, d) => s + d.value, 0), stuckCount: stuckQueue.length, stuckValue: [...byClient.values()].reduce((s, c) => s + c.stuckValue, 0), noNextStepCount: noNext },
    pipelines,
    byClient: [...byClient.values()].sort((a, b) => b.stuckValue - a.stuckValue),
    stuckQueue,
  };
}

/** The open-pipeline line is drawn only with at least 14 days AND a clear change (10% of its high). */
export function trendWorthDrawing(points: ReadonlyArray<{ openValue: number }>): boolean {
  if (points.length < 14) return false;
  const v = points.map((p) => p.openValue); const hi = Math.max(...v), lo = Math.min(...v);
  return hi > 0 && (hi - lo) / hi >= 0.1;
}
