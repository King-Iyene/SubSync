// Dollar trust rules for deals (CLAUDE.md 13A, docs/METRICS.md "Deal dollars you can trust"). Pure, no database: the SQL in stage-rules-sql.ts states the SAME rules
// (one pattern per rule, constants below are read by both), and the tests compare the two on fixtures.
// A deal that fails a rule is never deleted. It is left out of every dollar figure and said out loud ("Left out: ...") with a way to see it.

/** Whole words that make a deal look like a test (only these, as whole words: "Contested Will" and "Attestation" are real names). Postgres reads this with `~*`. A company can count such deals anyway (Settings, Targets). */
export const TEST_NAME_PATTERN = "(^|[^a-z0-9])(test|demo|dummy|sample|lorem)([^a-z0-9]|$)|^xtest-";
const TEST_RE = new RegExp(TEST_NAME_PATTERN, "i");
export const looksLikeTestName = (...names: Array<string | null | undefined>): boolean => names.some((n) => TEST_RE.test(n ?? ""));

/** The same amount on at least this many deals in one stage looks like a default value, not a quote. */
export const DEFAULT_VALUE_MIN_DEALS = 20;
/** ... or on at least this share of a stage's valued deals (needs at least DEFAULT_VALUE_MIN_SHARE_DEALS deals, so 2 of 3 is not a pattern). */
export const DEFAULT_VALUE_SHARE = 0.3;
export const DEFAULT_VALUE_MIN_SHARE_DEALS = 5;
/** A deal this many times the account's median valued deal is an outlier (needs OUTLIER_MIN_DEALS valued deals to know the median). */
export const OUTLIER_MULTIPLE = 100;
export const OUTLIER_MIN_DEALS = 5;
/** A round million or more (1,000,000, 2,000,000 ...) is left out as a likely test or placeholder. */
export const ROUND_AMOUNT = 1_000_000;
/** A pipeline of at least this many open valued deals, where one stage-and-amount holds at least OUTREACH_SHARE of them, is an outreach list, not a sales pipeline. */
export const OUTREACH_MIN_DEALS = 20;
export const OUTREACH_SHARE = 0.8;
/** A stage's usual time is judged only from at least this many finished stays; fewer and the deals there are "not judged". */
export const MIN_STAGE_STAYS = 10;
export const STAGE_LIMIT_FLOOR_DAYS = 3;
export const STAGE_LIMIT_CAP_DAYS = 60;

export type LeftOutReason = "outreach" | "default_value" | "outlier" | "test";
export const LEFT_OUT_REASONS: readonly LeftOutReason[] = ["outreach", "default_value", "outlier", "test"];

export type TrustDeal = {
  id: string; locationId: string; pipelineKey: string; stageKey: string; value: number; owner: string | null;
  name?: string | null; contactName?: string | null;
};
export type PipelineRule = "in_use" | "not_in_use" | null;

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Pipelines that look like an outreach list: >= 20 valued open deals and one stage-and-amount holds >= 80% of them. Keyed `location|pipeline`. */
export function detectOutreach(deals: TrustDeal[]): Set<string> {
  const per = new Map<string, { n: number; cells: Map<string, number> }>();
  for (const d of deals) {
    if (!(d.value > 0)) continue;
    const k = `${d.locationId}|${d.pipelineKey}`, c = per.get(k) ?? { n: 0, cells: new Map() };
    c.n++; const ck = `${d.stageKey}|${d.value}`; c.cells.set(ck, (c.cells.get(ck) ?? 0) + 1); per.set(k, c);
  }
  const out = new Set<string>();
  for (const [k, c] of per) if (c.n >= OUTREACH_MIN_DEALS && Math.max(...c.cells.values()) >= OUTREACH_SHARE * c.n) out.add(k);
  return out;
}

/**
 * Why each OPEN deal with a value and an owner is left out of the dollar figures (absent = counted). The owner's rule wins: a pipeline marked "in use" is never judged an outreach list
 * or a default value (the owner said these amounts are real); a pipeline marked "not in use" is not counted at all (that is stage-rules, not this file).
 */
export function leftOutReasons(deals: TrustDeal[], pipelineRule: (locationId: string, pipelineKey: string) => PipelineRule = () => null): Map<string, LeftOutReason> {
  const valued = deals.filter((d) => d.value > 0 && d.owner);
  const out = new Map<string, LeftOutReason>();
  const outreach = detectOutreach(valued);
  const stageN = new Map<string, number>(), cellN = new Map<string, number>(), byLoc = new Map<string, number[]>();
  for (const d of valued) {
    const sk = `${d.locationId}|${d.pipelineKey}|${d.stageKey}`, ck = `${sk}|${d.value}`;
    stageN.set(sk, (stageN.get(sk) ?? 0) + 1); cellN.set(ck, (cellN.get(ck) ?? 0) + 1);
    byLoc.set(d.locationId, [...(byLoc.get(d.locationId) ?? []), d.value]);
  }
  const med = new Map([...byLoc].map(([l, v]) => [l, v.length >= OUTLIER_MIN_DEALS ? median(v) : null]));
  for (const d of valued) {
    const rule = pipelineRule(d.locationId, d.pipelineKey), owned = rule === "in_use";
    const sk = `${d.locationId}|${d.pipelineKey}|${d.stageKey}`, same = cellN.get(`${sk}|${d.value}`) ?? 0, stage = stageN.get(sk) ?? 0, m = med.get(d.locationId) ?? null;
    let why: LeftOutReason | null = null;
    if (looksLikeTestName(d.name, d.contactName)) why = "test";
    else if (d.value >= ROUND_AMOUNT && d.value % ROUND_AMOUNT === 0) why = "outlier";
    else if (m !== null && d.value >= OUTLIER_MULTIPLE * m) why = "outlier";
    else if (!owned && rule !== "not_in_use" && outreach.has(`${d.locationId}|${d.pipelineKey}`)) why = "outreach";
    else if (!owned && (same >= DEFAULT_VALUE_MIN_DEALS || (same >= DEFAULT_VALUE_MIN_SHARE_DEALS && same >= DEFAULT_VALUE_SHARE * stage))) why = "default_value";
    if (why) out.set(d.id, why);
  }
  return out;
}

/** The days a deal may sit in a step before it is "stale": the 75th percentile of finished stays (floor 3, cap 60). Null = not judged (fewer than MIN_STAGE_STAYS stays). */
export function stageLimitDays(stays: number | null | undefined, p75Days: number | null | undefined): number | null {
  if (stays === null || stays === undefined || stays < MIN_STAGE_STAYS || p75Days === null || p75Days === undefined || !Number.isFinite(p75Days)) return null;
  return Math.max(STAGE_LIMIT_FLOOR_DAYS, Math.min(STAGE_LIMIT_CAP_DAYS, p75Days));
}
export type StaleVerdict = "stale" | "ok" | "not_judged";
export function staleVerdict(daysInStage: number, limit: number | null): StaleVerdict { return limit === null ? "not_judged" : daysInStage > limit ? "stale" : "ok"; }

export type LeftOutPart = { reason: LeftOutReason; deals: number; dollars: number; detail: string | null };
export type LeftOutSummary = {
  parts: LeftOutPart[];
  deals: number; dollars: number;
  /** Counted open deals in steps with too little history to judge. They are in the open total but never called stale. */
  notJudged: number;
  pipelinesCounted: number; pipelinesTotal: number;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

const PART_TEXT: Record<LeftOutReason, (p: LeftOutPart) => string> = {
  outreach: (p) => `${plural(p.deals, "deal")} worth ${money(p.dollars)} ${p.detail ?? "in outreach lists"}: not sales deals`,
  default_value: (p) => `${plural(p.deals, "deal")} worth ${money(p.dollars)}${p.detail ? ` (${p.detail}: looks like a default value)` : ": look like a default value"}`,
  outlier: (p) => `${plural(p.deals, "deal")} worth ${money(p.dollars)} ${p.deals === 1 ? "looks" : "look"} like ${p.deals === 1 ? "a test or placeholder" : "tests or placeholders"}${p.detail ? ` (${p.detail})` : ""}`,
  test: (p) => `${plural(p.deals, "deal")} worth ${money(p.dollars)} with a test name`,
};

/** "Left out: ...": the muted line under every headline dollar figure. Null when nothing was left out. */
export function leftOutLine(s: LeftOutSummary): string | null {
  const parts = s.parts.filter((p) => p.deals > 0);
  if (!parts.length) return null;
  return `Left out: ${plural(s.deals, "deal")} worth ${money(s.dollars)} (${parts.map((p) => PART_TEXT[p.reason](p)).join("; ")}).`;
}
export const countingLine = (counted: number, s: Pick<LeftOutSummary, "pipelinesCounted" | "pipelinesTotal">): string =>
  `Estimate. Counting ${plural(counted, "deal")} in ${s.pipelinesCounted === s.pipelinesTotal ? plural(s.pipelinesCounted, "pipeline") : `${s.pipelinesCounted} of ${plural(s.pipelinesTotal, "pipeline")}`}.`;

/** One short reason per deal, for the chip on a row and the left-out list. */
export const LEFT_OUT_CHIP: Record<LeftOutReason, string> = {
  outreach: "Outreach list, not a sales deal",
  default_value: "Looks like a default value",
  outlier: "Looks like a test amount",
  test: "Looks like a test deal",
};

export const HOW_STALE_WORKED_OUT =
  "A deal is stale when it has sat in its step longer than that step usually takes in this account (the 75th percentile of finished stays, at least 3 and at most 60 days, from at least 10 finished stays). Steps with fewer stays are not judged, so their deals are never called stale. Only open deals with a value above $0 and an owner count.";
export const HOW_LEFT_OUT =
  "Left out of every dollar figure, never deleted: a pipeline that is a bulk outreach list (one step and one amount hold 80% or more of at least 20 deals), the same amount on 20 or more deals in a step (or 30% of a step with at least 5), an amount of 100 times the account's typical deal or a round $1,000,000, and deals with a test name. Mark a pipeline In use to count it anyway.";
export const DAYS_STALE_HEADER_TIP = "Days since the deal last changed step (or, if it never moved, since it was created). It is not the last activity.";
