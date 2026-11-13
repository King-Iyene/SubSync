import { MIN_CLOSED } from "../analytics/pipeline3-intel";
import type { Pl3Forecast, Pl3Overview, Pl3Row, Pl3Sources, Pl3WonLost } from "../analytics/pipeline3-types";
import type { Facts } from "./brief";
import { bandOf, HEALTH_HOW, HEALTH_WORDS, type HealthBand } from "./deal-health-band";
import type { JobDef } from "./jobs";
import type { Schema } from "./safety";

// The four DEAL jobs of the AI platform (docs/AI_JOBS_SPEC.md, docs/AI_AGENTS_PLAN.md section 8). Pure: no database, no network, so the golden tests read every line the model is sent.
// Our code works out every number, the health badge, the stuck list and the forecast (the same functions the Pipeline screens use, so the AI can never disagree with them or ignore
// the deal-trust left-out rules). The model only writes words around them. Everything is suggest-only: nothing is sent to a lead and nothing is written to the CRM by a job. A task
// is created only when the person presses a button and confirms the preview, through the existing safe write gateway.

export const DEAL_JOB_IDS = ["deal_health", "deal_followup", "deal_winloss", "deal_forecast"] as const;
export type DealJobId = (typeof DEAL_JOB_IDS)[number];
export const isDealJobId = (v: unknown): v is DealJobId => (DEAL_JOB_IDS as readonly unknown[]).includes(v);
/** Each job has its own feature flag (default off) on top of the global ai_byo flag. */
export const DEAL_JOB_FLAG: Record<DealJobId, string> = { deal_health: "ai_deal_health", deal_followup: "ai_deal_followup", deal_winloss: "ai_deal_winloss", deal_forecast: "ai_deal_forecast" };
export const MIN_CLOSED_DEALS = MIN_CLOSED;
export const MAX_FOLLOWUP_DEALS = 10;

const RULES = [
  "Rules: plain words a busy business owner or setter understands, no jargon, no markdown, no emoji.",
  "Use ONLY the figures in the data. Copy each figure exactly as written. Never calculate, round, add up or invent a figure, and never write a date, a weekday or a time of day.",
  "Money is an estimate: say 'about' or 'an estimate' when you mention dollars. Never mention a dollar figure for a deal whose value is not given.",
  "Suggest, never claim. Never say anything was sent, fixed, moved or changed, and never promise a result.",
  "Never mention how you work or that you are an AI.",
].join(" ");

const str = (maxLength: number): Schema => ({ type: "string", maxLength });
const list = (maxLength: number, maxItems: number): Schema => ({ type: "array", items: str(maxLength), maxItems });

export const CHANNELS = ["call", "text", "email", "review"] as const;
export const TIMINGS = ["today", "tomorrow", "this_week"] as const;
export type Channel = (typeof CHANNELS)[number];
export type Timing = (typeof TIMINGS)[number];

export const DEAL_JOB_DEFS: Record<DealJobId, JobDef> = {
  deal_health: {
    id: "deal_health", title: "Deal health explanations", status: "live", approval: "suggest", privacy: "names_optin", costClass: "small",
    output: { kind: "json", maxChars: 1200, schema: { type: "object", props: { summary: str(300), stuck: str(240), missing: str(240), likelyReason: str(240) } } },
    tools: [], maxTokens: 450, maxToolRounds: 0,
    system: `You explain, for a business owner or setter, why ONE open deal needs attention. You are given the deal's facts and a health score already worked out by rules; do not argue with the score. Reply with one JSON object only: {"summary": one or two sentences, "stuck": what is stuck (empty text if nothing), "missing": what is missing such as an owner, a value, a booked appointment or recent activity (empty text if nothing), "likelyReason": your best guess at why, starting with "Probably" or "Possibly"}. ${RULES}`,
  },
  deal_followup: {
    id: "deal_followup", title: "Follow-up plan for stuck deals", status: "live", approval: "suggest", privacy: "names_optin", costClass: "small",
    output: { kind: "json", maxChars: 6000, schema: { type: "object", props: { plans: { type: "array", maxItems: MAX_FOLLOWUP_DEALS, items: { type: "object", props: { ref: str(8), channel: { type: "string", enum: CHANNELS }, timing: { type: "string", enum: TIMINGS }, say: str(200), why: str(160) } } } } } },
    tools: [], maxTokens: 1400, maxToolRounds: 0,
    system: `You suggest ONE next touch for each stuck deal in the list. Reply with one JSON object only: {"plans": [{"ref": the deal's label such as D1, "channel": "call" or "text" or "email" or "review" (use review when the person cannot be reached by phone or email), "timing": "today" or "tomorrow" or "this_week", "say": one short line of what to say, as a guide for the person (never a full message), "why": one short reason}]}. Use only a channel the data says is available. Only labels from the list. Never write a date or a time. ${RULES}`,
  },
  deal_winloss: {
    id: "deal_winloss", title: "Win and loss review", status: "live", approval: "suggest", privacy: "aggregate", costClass: "large",
    output: { kind: "json", maxChars: 2000, schema: { type: "object", props: { summary: str(320), wins: list(180, 3), losses: list(180, 3), tryNext: list(180, 3) } } },
    tools: [], maxTokens: 800, maxToolRounds: 0,
    system: `You review the deals that were won and lost in the dates given and describe the patterns in plain English. Reply with one JSON object only: {"summary": two sentences, "wins": up to 3 patterns among the wins, "losses": up to 3 patterns among the losses (lost reasons first), "tryNext": up to 3 things to try}. Only describe a pattern the figures show. If a group is small, say it is a small group. ${RULES}`,
  },
  deal_forecast: {
    id: "deal_forecast", title: "Forecast in words", status: "live", approval: "suggest", privacy: "aggregate", costClass: "large",
    output: { kind: "json", maxChars: 2000, schema: { type: "object", props: { summary: str(320), couldMoveUp: list(180, 3), couldMoveDown: list(180, 3), doNext: list(180, 3) } } },
    tools: [], maxTokens: 800, maxToolRounds: 0,
    system: `You explain a sales forecast that our code already worked out. Never change it, never give a different figure. Reply with one JSON object only: {"summary": two sentences that say it is an estimate and what it rests on, "couldMoveUp": up to 3 things that could raise it, "couldMoveDown": up to 3 things that could lower it, "doNext": up to 3 things to do to protect it}. ${RULES}`,
  },
};

// ---------------- money and the left-out rules ----------------

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const whole = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.max(0, Math.floor(n)));

/** One deal as the Pipeline screens read it, plus four facts they do not carry. */
export type DealJobRow = Pl3Row & { daysSinceActivity: number | null; stageNormalDays: number | null; hasPhone: boolean; hasEmail: boolean };

/**
 * The deal-trust rule in one place: a deal's dollars are counted (and so may be shown to the AI) only when it is open, valued, owned, not a test, not left out as an outreach list,
 * default value or placeholder. The Pipeline bucket already says so: "healthy" and "stale" are the counted ones; "open" is open but NOT counted.
 */
export const dollarCounted = (r: Pick<Pl3Row, "status" | "bucket" | "isTest" | "outlier">): boolean => r.status === "open" && !r.isTest && !r.outlier && (r.bucket === "healthy" || r.bucket === "stale");

const LEFT_OUT_WORD: Record<string, string> = { outreach: "part of an outreach list", default_value: "looks like a default value", outlier: "looks like a test or placeholder amount", test: "looks like a test deal" };
/** What the AI is told about a deal's money: a figure only when the deal counts; otherwise why it is left out (never the amount). */
export function valueText(r: Pick<Pl3Row, "status" | "bucket" | "isTest" | "outlier" | "value" | "leftOutReason" | "ownerId">): string {
  if (dollarCounted(r)) return money(r.value ?? 0);
  if (!(r.value && r.value > 0)) return "no value set";
  if (r.isTest) return "not counted (looks like a test deal)";
  if (r.leftOutReason) return `not counted (${LEFT_OUT_WORD[r.leftOutReason] ?? "left out of the money figures"})`;
  if (!r.ownerId) return "not counted (nobody owns the deal)";
  return "not counted in the money figures";
}

// ---------------- 1. deal health ----------------

export { bandOf, HEALTH_HOW, HEALTH_WORDS };
export type { HealthBand };

export type Issue = { id: "no_owner" | "no_value" | "no_appointment" | "stuck" | "quiet" | "test" | "dnd"; text: string };
/** What is stuck or missing on an open deal, each worked out by a rule from the deal's own fields and the step's own normal. */
export function dealIssues(r: DealJobRow, now: number): Issue[] {
  if (r.status !== "open") return [];
  const out: Issue[] = [];
  if (r.isTest) out.push({ id: "test", text: "Looks like a test deal" });
  if (!r.ownerId) out.push({ id: "no_owner", text: "Nobody owns this deal" });
  if (!(r.value && r.value > 0)) out.push({ id: "no_value", text: "No value is set" });
  const d = whole(r.daysInStage), lim = whole(r.staleLimitDays);
  if (r.stale && d !== null && lim !== null) out.push({ id: "stuck", text: `${d} days in ${r.stageName ?? "this step"}; the usual limit for this step is ${lim}` });
  const a = whole(r.daysSinceActivity), norm = whole(r.stageNormalDays);
  if (a !== null && a >= 7 && a > Math.max(7, 2 * (norm ?? 7))) out.push({ id: "quiet", text: `No activity for ${a} days${norm !== null && norm > 0 ? `; deals in this step usually move on within ${norm}` : ""}` });
  const upcoming = r.appointment && Date.parse(r.appointment.startAt) > now && r.appointment.status !== "cancelled";
  if (!upcoming) out.push({ id: "no_appointment", text: "No upcoming appointment is booked, so there is no next step on the calendar" });
  if (r.dnd) out.push({ id: "dnd", text: "The person asked not to be contacted" });
  return out;
}

const yn = (b: boolean) => (b ? "yes" : "no");

/** The exact text sent to the model for one deal. Pure. Names only after the account's own opt-in. */
export function dealHealthFacts(r: DealJobRow, now: number, shareNames: boolean): Facts {
  const band = bandOf(r.health), issues = dealIssues(r, now), d = whole(r.daysInStage), lim = whole(r.staleLimitDays), a = whole(r.daysSinceActivity), norm = whole(r.stageNormalDays);
  const lines = [
    "Deal facts (worked out by our rules; do not change them)",
    `Health: ${r.health !== null && band ? `${r.health} out of 100, ${HEALTH_WORDS[band]}` : "not judged"}`,
    `Step: ${r.stageName ?? "unknown"}${r.pipelineName ? ` in the ${r.pipelineName} pipeline` : ""}`,
    `Days in this step: ${d ?? "unknown"}`,
    `Usual limit for this step in this account: ${lim === null ? "not enough history to judge" : `${lim} days`}`,
    `Days since any activity: ${a ?? "unknown"}`,
    `Deals in this step usually move on within: ${norm === null ? "not enough history" : `${norm} days`}`,
    `Owner: ${r.ownerId ? "has an owner" : "nobody"}`,
    `Value: ${valueText(r)}`,
    `Upcoming appointment booked: ${yn(Boolean(r.appointment && Date.parse(r.appointment.startAt) > now && r.appointment.status !== "cancelled"))}`,
    `Do not disturb: ${yn(r.dnd)}`,
    `Reachable by phone: ${yn(r.hasPhone)}; by email: ${yn(r.hasEmail)}`,
    `What the rules found: ${issues.length ? issues.map((i) => i.text).join("; ") : "nothing wrong"}`,
    ...(shareNames ? [`Deal name: ${r.name ?? "none"}`, `Contact: ${r.contactName}`] : []),
  ];
  const fields = ["health score and badge", "step name, days in step, the step's own usual limit and normal", "days since activity", "whether the deal has an owner, a value, a booked appointment, phone, email, do-not-disturb", "the rule findings"];
  if (shareNames) fields.push("the deal name and the contact name");
  return { text: lines.join("\n"), fields, includesNames: shareNames };
}

export type HealthOut = { summary: string; stuck: string; missing: string; likelyReason: string };
export const asHealthOut = (j: unknown): HealthOut | null => {
  const o = j as Record<string, unknown> | null;
  return o && ["summary", "stuck", "missing", "likelyReason"].every((k) => typeof o[k] === "string") ? { summary: o.summary as string, stuck: o.stuck as string, missing: o.missing as string, likelyReason: o.likelyReason as string } : null;
};

// ---------------- 2. follow-up plan ----------------

export type FollowUpPick = { facts: Facts; refs: Map<string, DealJobRow>; asked: number; skippedDnd: number; skippedClosed: number };

/** The stuck deals handed to the model, at most 10, each with a short label. Do-not-disturb people are never included (nothing is suggested for them). */
export function followUpFacts(rows: readonly DealJobRow[], now: number, shareNames: boolean): FollowUpPick {
  const open = rows.filter((r) => r.status === "open");
  const reachable = open.filter((r) => !r.dnd);
  const picked = reachable.slice(0, MAX_FOLLOWUP_DEALS), refs = new Map<string, DealJobRow>();
  const lines = ["Stuck deals (picked and ranked by our rules). Suggest one next touch for each label."];
  picked.forEach((r, i) => {
    const ref = `D${i + 1}`; refs.set(ref, r);
    const ways = [r.hasPhone ? "phone" : null, r.hasEmail ? "email" : null].filter(Boolean).join(" and ") || "neither phone nor email";
    const d = whole(r.daysInStage), lim = whole(r.staleLimitDays), a = whole(r.daysSinceActivity);
    lines.push(`${ref}: step ${r.stageName ?? "unknown"}; ${d ?? "unknown"} days in this step${lim !== null ? ` (usual limit ${lim})` : ""}; days since any activity ${a ?? "unknown"}; value ${valueText(r)}; owner ${r.ownerId ? "yes" : "no"}; upcoming appointment ${yn(Boolean(r.appointment && Date.parse(r.appointment.startAt) > now && r.appointment.status !== "cancelled"))}; can be reached by ${ways}${shareNames ? `; contact ${r.contactName}; deal ${r.name ?? "none"}` : ""}`);
  });
  const fields = ["a short label per deal", "step, days in step and the step's usual limit", "days since activity", "owner, booked appointment and how the person can be reached (never the phone number or email)", "deal value only when it counts in the money figures"];
  if (shareNames) fields.push("the contact name and deal name");
  return { facts: { text: lines.join("\n"), fields, includesNames: shareNames }, refs, asked: picked.length, skippedDnd: open.length - reachable.length, skippedClosed: rows.length - open.length };
}

export type PlanItem = { ref: string; opportunityId: string; locationId: string; dealName: string; stage: string | null; channel: Channel; timing: Timing; say: string; why: string; task: { title: string; dueDate: string } | null };
const CHANNEL_WORD: Record<Channel, string> = { call: "call", text: "text", email: "email", review: "review" };
export const dueFor = (timing: Timing, now: number): string => new Date(now + (timing === "today" ? 3 : timing === "tomorrow" ? 24 : 72) * 3_600_000).toISOString();

/** Turns the model's plans into items: unknown labels and repeats are dropped, a channel the person cannot be reached on becomes "review", and the task (title and due time) is built by our code. */
export function mapPlans(json: unknown, refs: Map<string, DealJobRow>, now: number): { items: PlanItem[]; dropped: number } {
  const plans = (json as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(plans)) return { items: [], dropped: 0 };
  const seen = new Set<string>(), items: PlanItem[] = [];
  let dropped = 0;
  for (const p of plans as Array<Record<string, unknown>>) {
    const r = typeof p.ref === "string" ? refs.get(p.ref) : undefined;
    if (!r || seen.has(p.ref as string)) { dropped++; continue; }
    seen.add(p.ref as string);
    let channel = (CHANNELS as readonly unknown[]).includes(p.channel) ? (p.channel as Channel) : "review";
    if ((channel === "call" || channel === "text") && !r.hasPhone) channel = r.hasEmail ? "email" : "review";
    if (channel === "email" && !r.hasEmail) channel = r.hasPhone ? "call" : "review";
    const timing = (TIMINGS as readonly unknown[]).includes(p.timing) ? (p.timing as Timing) : "this_week";
    const say = String(p.say ?? "").trim(), why = String(p.why ?? "").trim();
    const dealName = (r.name ?? "").trim() || r.contactName;
    items.push({
      ref: p.ref as string, opportunityId: r.opportunityId, locationId: r.locationId, dealName, stage: r.stageName, channel, timing, say, why,
      task: r.contactId ? { title: `Follow up (${CHANNEL_WORD[channel]}): ${dealName}. ${say}`.slice(0, 200), dueDate: dueFor(timing, now) } : null,
    });
  }
  return { items, dropped };
}

// ---------------- 3. win and loss review ----------------

export type Gate = { ok: true } | { ok: false; closed: number; needed: number; message: string };
export const notEnoughClosed = (closed: number): string => `Not enough closed deals yet (${closed} of ${MIN_CLOSED_DEALS} needed)`;
/** No provider call and no spend below the minimum: the answer is the plain sentence. */
export function winLossGate(wl: Pick<Pl3WonLost, "won" | "lost">): Gate {
  const closed = wl.won.n + wl.lost.n;
  return closed >= MIN_CLOSED_DEALS ? { ok: true } : { ok: false, closed, needed: MIN_CLOSED_DEALS, message: notEnoughClosed(closed) };
}
const pct = (n: number, of: number) => `${Math.round((100 * n) / Math.max(1, of))}%`;

export function winLossFacts(wl: Pl3WonLost, src: Pl3Sources | null, periodWords: string): Facts {
  const closed = wl.won.n + wl.lost.n;
  const lines = [
    `Period: ${periodWords}`,
    `Closed deals: ${closed} (won ${wl.won.n}, lost ${wl.lost.n}); at least ${MIN_CLOSED_DEALS} are needed for a review`,
    `Win rate: ${wl.winRate.enough && wl.winRate.value !== null ? `${pct(wl.won.n, closed)} (${wl.won.n} of ${closed})` : "not enough data"}`,
    `Money won: ${money(wl.won.value)}; money lost: ${money(wl.lost.value)} (estimates from the deal values)`,
    `Average won deal: ${wl.avgWon.enough && wl.avgWon.value !== null ? money(wl.avgWon.value) : "not enough data"}`,
    `Typical days from created to won: ${wl.medianCycleDays === null ? "not enough data" : String(Math.floor(wl.medianCycleDays))}`,
    `Booked appointment first, then won: ${wl.bookedToWon.booked > 0 ? `${wl.bookedToWon.won} of ${wl.bookedToWon.booked}` : "not enough data"}`,
  ];
  if (wl.lostReasonsEnough && wl.lostReasons.length) lines.push("Lost reasons: " + wl.lostReasons.slice(0, 6).map((x) => `${x.reason} ${x.count}`).join("; "));
  else lines.push("Lost reasons: too few lost deals have a reason recorded to say");
  if (wl.noReasonShare !== null && wl.noReasonShare > 0) lines.push(`Lost deals with no reason recorded: ${Math.round(wl.noReasonShare * 100)}%`);
  if (wl.byMonth.length) lines.push("By month: " + wl.byMonth.slice(-4).map((m) => `${m.month} won ${m.won} lost ${m.lost}`).join("; "));
  const rows = (src?.bySource ?? []).filter((s) => s.winRate.enough && s.winRate.value !== null).sort((a, b) => b.won + b.open - (a.won + a.open)).slice(0, 5);
  if (rows.length) lines.push("By source (only sources with enough closed deals): " + rows.map((s) => `${s.source} won ${s.won} of ${s.winRate.of} closed (${pct(s.won, s.winRate.of)})`).join("; "));
  return { text: lines.join("\n"), fields: ["won and lost counts and money for the dates on the date bar", "win rate, average won deal, typical days to win", "lost reasons with counts", "month by month counts", "win rate by source where there are enough deals"], includesNames: false };
}

export type WinLossOut = { summary: string; wins: string[]; losses: string[]; tryNext: string[] };
export type ForecastOut = { summary: string; couldMoveUp: string[]; couldMoveDown: string[]; doNext: string[] };
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export const asWinLossOut = (j: unknown): WinLossOut | null => { const o = j as Record<string, unknown> | null; return o && typeof o.summary === "string" ? { summary: o.summary, wins: strs(o.wins), losses: strs(o.losses), tryNext: strs(o.tryNext) } : null; };
export const asForecastOut = (j: unknown): ForecastOut | null => { const o = j as Record<string, unknown> | null; return o && typeof o.summary === "string" ? { summary: o.summary, couldMoveUp: strs(o.couldMoveUp), couldMoveDown: strs(o.couldMoveDown), doNext: strs(o.doNext) } : null; };

// ---------------- 4. forecast in words ----------------

/** The forecast comes from our own code only; below the minimum (or with nothing to forecast) the answer is a plain sentence and no AI runs. */
export function forecastGate(fc: Pick<Pl3Forecast, "next30" | "closedDeals">): Gate {
  if (fc.next30.enough && fc.next30.value !== null && fc.next30.low !== null && fc.next30.high !== null) return { ok: true };
  if (fc.closedDeals < MIN_CLOSED_DEALS) return { ok: false, closed: fc.closedDeals, needed: MIN_CLOSED_DEALS, message: notEnoughClosed(fc.closedDeals) };
  return { ok: false, closed: fc.closedDeals, needed: MIN_CLOSED_DEALS, message: "There are no counted open deals to forecast from yet." };
}

export function forecastFacts(fc: Pl3Forecast, ov: Pl3Overview | null): Facts {
  const e = fc.next30;
  const lines = [
    "Forecast for the next 30 days (worked out by our code; an estimate, not a promise)",
    `Expected to close: about ${money(e.value ?? 0)}, in a range of ${money(e.low ?? 0)} to ${money(e.high ?? 0)}`,
    `It rests on ${fc.closedDeals} deals closed in the last year (at least ${fc.minClosed} are needed)`,
  ];
  if (ov) {
    lines.push(`Open deals counted: ${ov.openCount}, worth ${money(ov.openValue.value)}`);
    lines.push(`Stuck open deals: ${ov.stale.count}, worth ${money(ov.stale.value)}`);
    if (ov.winRate.enough && ov.winRate.value !== null) lines.push(`Win rate: ${Math.round(ov.winRate.value * 100)}% (${ov.winRate.n} of ${ov.winRate.of})`);
    if (ov.medianWonCycleDays !== null) lines.push(`Typical days from created to won: ${Math.floor(ov.medianWonCycleDays)}`);
    if (ov.trust && ov.trust.leftOutDeals > 0) lines.push(`Left out of every money figure (never deleted): ${ov.trust.leftOutDeals} deals that look like tests, outreach lists, default values or placeholders`);
    if (ov.health.noOwner > 0) lines.push(`Open deals with nobody owning them: ${ov.health.noOwner}`);
  }
  if (fc.capped.length) lines.push(`One very large deal is capped so it cannot swamp the forecast: ${fc.capped.length === 1 ? "1 deal" : `${fc.capped.length} deals`}`);
  if (fc.track.enough && fc.track.bias !== null) lines.push("Past forecasts have been checked against what really closed");
  return { text: lines.join("\n"), fields: ["the forecast range and what it rests on", "open and stuck deal counts and money (counted deals only)", "win rate and typical days to win", "how many deals are left out of the money figures"], includesNames: false };
}
