// Pipeline and deals module, round 3: the response types of GET /api/app/pipeline3?part=... (types only: no imports, safe for the browser).
// Money fields are ESTIMATES unless named "won"; every estimate carries `estimate: true` and the formula in `formula`. Anything under its
// minimum sample is { enough: false } and the screen says "not enough data", never a made-up number. Definitions: docs/METRICS.md "Pipeline 3".

export const PL3_PARTS = [
  "overview", "money-flow", "attention", "won-lost", "forecast", "people", "sources", "stage-history", "health", "receipt", "list", "detail", "replay", "pipelines",
] as const;
export type Pl3Part = (typeof PL3_PARTS)[number];

/** Shared query parameters (all optional): from, to (ISO dates), location, pipeline, stage, owner, source, page (0-based), size (20|50|100), sort, dir, q, bucket, reason, week (Monday YYYY-MM-DD for the receipt), days (replay window 30 to 90), deal (opportunity id for detail). */
export type Pl3Query = {
  part: Pl3Part; from?: string; to?: string; location?: string; pipeline?: string; stage?: string; owner?: string; source?: string;
  page?: number; size?: 20 | 50 | 100; sort?: string; dir?: "asc" | "desc"; q?: string; bucket?: Pl3Bucket; reason?: string; week?: string; days?: number; deal?: string;
};

/** Our own groups of deals. `stale` = past its stage's stale limit. `outlier` = single deal over 40% of the total. `no_owner`, `no_value`, `test` feed the health tile, never the dollar tiles. */
export type Pl3Bucket =
  | "open" | "won" | "lost" | "abandoned" | "stale" | "healthy" | "outlier" | "no_owner" | "no_value" | "test" | "no_reason" | "booked_appt" | "no_appt";

export type Estimate = { value: number | null; low: number | null; high: number | null; enough: boolean; estimate: true; formula: string; minNote: string | null };
export type Rate = { value: number | null; n: number; of: number; enough: boolean };
export type Money = { value: number; n: number };
export type Page<T> = { rows: T[]; total: number; page: number; size: number; pages: number; truncated: boolean };

export type Pl3Row = {
  opportunityId: string; locationId: string; accountName: string | null;
  contactId: string | null; contactName: string; name: string | null; url: string | null;
  pipelineId: string | null; pipelineName: string | null; stageId: string | null; stageName: string | null;
  status: "open" | "won" | "lost" | "abandoned"; value: number | null; bucket: Pl3Bucket;
  ownerId: string | null; ownerName: string | null; source: string | null; lostReason: string | null;
  createdAt: string | null; lastStageChangeAt: string | null; daysInStage: number | null; staleLimitDays: number | null; stale: boolean;
  health: number | null; healthWhy: string | null;
  /** Latest booked appointment for this contact (join by contact), null when none. */
  appointment: null | { appointmentId: string; startAt: string; status: string };
  /** In plain words, why it is on this list (for example "In Proposal 21 days, the usual limit is 12"). */
  why: string | null;
  dnd: boolean; outlier: boolean; isTest: boolean;
};

export type Pl3Overview = {
  headline: string; button: { label: string; part: Pl3Part; bucket: Pl3Bucket | null; count: number } | null;
  openCount: number; openValue: Money; weighted: Estimate; atRisk: Estimate;
  stale: { count: number; value: number };
  wonLast30: Money; lostLast30: Money; winRate: Rate; velocity: Estimate; medianWonCycleDays: number | null;
  health: { score: number | null; noOwner: number; noValue: number; test: number; outliers: number };
  /** The six tiles at most. Each count equals its list. */
  cards: Array<{ key: string; title: string; value: number | string; sub: string | null; part: Pl3Part; bucket: Pl3Bucket | null }>;
  trend: Array<{ day: string; openValue: number; openCount: number; won: number; lost: number }>;
  windowDays: number; accounts: number; historySince: string | null;
};

/** Money Flow graph. A node is a stage (a pipe segment with a valve). A flow is the money that moved from one stage to the next in the window. */
export type FlowStage = {
  id: string; pipelineId: string; name: string; order: number;
  openCount: number; openValue: number;
  /** Pressure: median days in this stage now (open deals) against the account's own normal. null under the minimum. */
  dwell: { medianDays: number | null; normalDays: number | null; pressure: number | null; enough: boolean };
  /** Clog: stale deals that slow this segment. */
  clog: { count: number; value: number };
  /** Coins per second hint for the UI: relative speed, 0 to 1 (1 = fastest segment). */
  velocity: number | null;
};
export type FlowEdge = { from: string; to: string; count: number; value: number; medianDays: number | null };
export type FlowDrain = { stageId: string; reason: string; count: number; value: number; noReason: boolean };
export type FlowPerson = { ownerId: string | null; name: string; open: Money; won: Money; lost: Money; staleCount: number; stages: Array<{ stageId: string; count: number; value: number }> };
export type Pl3MoneyFlow = {
  stages: FlowStage[]; edges: FlowEdge[];
  /** Lost money leaves a stage as a drip into the drain, labelled with the reason. */
  drain: FlowDrain[]; drainTotal: Money;
  /** Won money drops into the vault. */
  vault: { won: Money; wonLast7: Money; target: number | null };
  people: FlowPerson[];
  leak: null | { text: string; fromStageId: string; toStageId: string | null; lostValue: number; lostCount: number };
  /** Single deals over 40% of a total, shown apart so one big deal never rules the picture. */
  outliers: Array<{ opportunityId: string; name: string | null; value: number; sharePct: number; stageId: string | null }>;
  period: { from: string; to: string }; pipelineId: string | null; pipelines: Array<{ id: string; name: string; locationId: string }>;
  historyDays: number; enoughHistory: boolean;
};

/** Time-lapse replay frames (30 to 90 days), one per day, from our own stage history. */
export type Pl3Replay = {
  days: number; frames: Array<{ day: string; stages: Array<{ stageId: string; count: number; value: number }>; wonValue: number; lostValue: number; moved: Array<{ from: string | null; to: string; count: number; value: number }> }>;
  enough: boolean; historySince: string | null;
};

export type Pl3Attention = Page<Pl3Row> & {
  byStage: Array<{ stageId: string; stageName: string; pipelineName: string | null; stale: number; value: number; limitDays: number; limitIsEstimate: boolean }>;
  totalValue: number; oldestDays: number | null;
};

export type Pl3WonLost = {
  won: Money; lost: Money; winRate: Rate; avgWon: { value: number | null; n: number; enough: boolean }; medianCycleDays: number | null;
  lostReasons: Array<{ reason: string; count: number; value: number; noReason: boolean }>; lostReasonsEnough: boolean; noReasonShare: number | null;
  bookedToWon: { booked: number; won: number; rate: Rate };
  byMonth: Array<{ month: string; won: number; lost: number; wonValue: number; lostValue: number }>;
  list: Page<Pl3Row>;
};

export type Pl3Forecast = {
  next30: Estimate; weightedOpen: Estimate; velocity: Estimate;
  stageProb: Array<{ stageId: string; stageName: string; p: Estimate; passed: number; assumed: boolean }>;
  /** Capped (95th percentile) deals, listed apart. */
  capped: Array<{ opportunityId: string; name: string | null; value: number; cappedTo: number }>;
  track: { enough: boolean; coverage: Rate; bias: number | null; months: Array<{ month: string; forecast: number; actual: number }> };
  minClosed: number; closedDeals: number;
};

export type Pl3Person = {
  ownerId: string | null; name: string; open: Money; won: Money; lost: Money; staleCount: number; staleValue: number;
  winRate: Rate; avgWon: number | null; medianCycleDays: number | null; burned: number;
  /** A deal is "burned" when it was lost after 3 or more days with no stage move. */
  coaching: string | null; trend: Array<{ week: string; won: number; lost: number }>;
};
export type Pl3People = Page<Pl3Person> & { unowned: Money };

export type Pl3Sources = {
  bySource: Array<{ source: string; created: number; open: number; won: number; lost: number; winRate: Rate; wonValue: number; avgCycleDays: number | null }>;
  byValueBand: Array<{ band: string; won: number; lost: number; winRate: Rate }>;
  sourceBlank: number;
};

/** One row of the append-only deal history. */
export type Pl3HistoryEvent = { at: string; kind: "created" | "stage" | "status" | "value" | "owner" | "lost_reason" | "source" | "appointment_linked" | "deleted" | "note"; from: string | null; to: string | null; actorName: string | null; actorKind: "person" | "subsync" | "automation" | "system" | "unknown"; text: string };
export type Pl3StageHistory = {
  dwell: Array<{ stageId: string; stageName: string; pipelineName: string | null; stays: number; medianDays: number | null; p75Days: number | null; p90Days: number | null; enough: boolean; staleLimitDays: number; limitIsEstimate: boolean }>;
  recent: Page<{ opportunityId: string; locationId: string; accountName: string | null; dealName: string | null; event: Pl3HistoryEvent; value: number | null }>;
  backward: number; skipped: number; historySince: string | null; eventsRecorded: number;
};

export type Pl3Health = Page<{
  locationId: string; accountName: string | null; open: number; score: number | null; noOwner: number; noValue: number; test: number; duplicates: number; stale: number; outliers: number; worstReason: string | null;
}> & { overall: number | null };

export type Pl3Receipt = {
  weekStart: string; weekEnd: string; locationId: string | null; accountName: string | null;
  moved: number; won: Money; lost: Money; newDeals: number; unclogged: number; stillStale: number; leakText: string | null; pipelineChange: number | null;
  headline: string; verifyHash: string | null;
};

/** One deal with its full history for the right-side panel. */
export type Pl3Detail = {
  row: Pl3Row; timeline: Pl3HistoryEvent[]; dwell: Array<{ stageId: string; stageName: string; days: number; current: boolean }>;
  appointments: Array<{ appointmentId: string; startAt: string; status: string }>;
  blockers: Array<"dnd" | "active_payment" | "open_deal" | "upcoming">; staleLimitDays: number | null;
};

/** Every response is { ok: true, ...part } or { error }; `flags` lists which pl_* features are on so the UI can hide the rest. */
export type Pl3Envelope<T> = T & { generatedAt: string; cached: boolean; canSeeAccounts: boolean; flags: Record<string, boolean> };

export const PL3_FLAGS = [
  "pl_overview", "pl_money_flow", "pl_attention", "pl_won_lost", "pl_forecast", "pl_people", "pl_sources", "pl_stage_history", "pl_health", "pl_proof", "pl_actions", "pl_history", "pl_record",
] as const;
export type Pl3Flag = (typeof PL3_FLAGS)[number];

/** part=pipelines: ranked cards, one per (account, pipeline). Only stage-independent measures, so stages of different pipelines are never mixed. Keyset paged: pass `after` = the previous `next`. */
export type PipeCard = {
  locationId: string; pipelineId: string; accountName: string; name: string;
  openCount: number; openValue: number; wonCount: number; wonValue: number; lostCount: number; lostValue: number;
  staleCount: number; noOwnerCount: number; zeroValueCount: number; empty: boolean;
  mini: Array<{ name: string; value: number }>; // open money per stage in the pipeline's own order; a stage it no longer has is "Other stage"
};
export type Pl3Cards = {
  cards: PipeCard[]; next: string | null;
  totals: { pipelines: number; emptyHidden: number; openValue: number; wonValue: number; lostValue: number; openCount: number; wonCount: number; lostCount: number; staleCount: number; noOwnerCount: number };
};
