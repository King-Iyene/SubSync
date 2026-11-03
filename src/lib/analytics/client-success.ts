// The Clients module (stage C1): the pure rules behind Health, Onboarding, Details, Compare and Reviews. No database, no network, no React, so every rule
// here is a plain function with a test (src/lib/__tests__/client-success.test.ts). The screens and the API only call these.

import { industryKey, PLAYBOOKS, type PlaybookId } from "./playbooks.ts";
import { compareSetup, type Setup } from "./setup-intel.ts";
import { roi } from "./client-intel.ts";
import { attentionBand, type ScoreBand } from "../scoring.ts";
import { crmUrl, type DomainSource } from "../links.ts";
import { MIN_BASE, changeBetween, type Change } from "../design/range.ts";
import type { Deal } from "./pipeline-intel.ts";

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// ============================================================ Details: what only the user can enter (KF-7)

/** The honest label for every number that depends on something only the user types (KF-7). */
export const USER_ENTERED = "You enter this; SubSync does not read it from your CRM.";

/** The formula of the Value created column, in plain words with a worked example computed by the real formula. */
export function valueCreatedWords(): string {
  const r = roi({ monthlyFee: 2500, pipelineCreated30d: 18_000, wonValue30d: 0 });
  return `Value created is the value of the new deals that started in the last 30 days, divided by what the client pays you each month. A client paying $2,500 a month who got $18,000 of new deals shows ${r?.pipelineMultiple}x. It needs the monthly fee, which you type in (SubSync cannot read what a client pays you).`;
}

export type Help = { what: string; where: string; todo: string; entered: boolean };
/** A two-line explanation of every column and tile: what it is, where the number comes from, what to do about it. */
export const HELP: Record<string, Help> = {
  health: { what: "How alive the client's account looks, from 0 to 100, held down when customers wait too long for a reply.", where: "Worked out by SubSync from the activity it reads in the CRM.", todo: "Open a client to see where every point came from.", entered: false },
  leaveRisk: { what: "Whether the client may stop using you: steady, could leave, likely to leave.", where: "Worked out from how long the account has been quiet and how fast its health fell.", todo: "A warning sign, not a prediction. Call the clients marked likely to leave.", entered: false },
  fee: { what: "What this client pays you each month.", where: USER_ENTERED, todo: "Press Add fee on the row and type it. It feeds Monthly client revenue, Revenue at risk and Value created.", entered: true },
  renewal: { what: "The day this client's contract renews.", where: USER_ENTERED, todo: "Press Add date on the row. You get a list of renewals in the next 90 days.", entered: true },
  industry: { what: "The kind of business this client runs.", where: USER_ENTERED, todo: "Pick it from the list. It decides the reply target, call lists and onboarding steps that fit the client.", entered: true },
  valueCreated: { what: "How many times the client's monthly fee the new deals of the last 30 days are worth.", where: "The new deals come from the CRM; the monthly fee is what you type.", todo: "Add the fee to see it. Example: $18,000 of new deals for $2,500 a month is 7.2x.", entered: true },
  lastSpoken: { what: "When someone on your team last talked to this client.", where: USER_ENTERED, todo: "Press I spoke to them today after a call, or add a note to the log.", entered: true },
  setup: { what: "How much of the client's account is set up, out of 100.", where: "Worked out by SubSync from pipelines, calendars, contacts and email sending.", todo: "Open Onboarding to see what is missing and fix it.", entered: false },
  monthlyRevenue: { what: "What your clients pay you each month, added up.", where: USER_ENTERED, todo: "Add the fee to each client. Clients with no fee are left out and counted.", entered: true },
  revenueAtRisk: { what: "The monthly fees of clients who look at risk or have gone quiet.", where: "The fees are what you typed; who is at risk is worked out by SubSync.", todo: "Call these clients first.", entered: true },
  notSpoken: { what: "Clients nobody on your team has spoken to in 14 days or more.", where: USER_ENTERED, todo: "Press I spoke to them today after each call so this stays true.", entered: true },
  renewals: { what: "Contracts renewing in the next 90 days.", where: USER_ENTERED, todo: "Add each client's renewal date.", entered: true },
};

/** The two lines shown under a column or tile: what it is, then where it comes from and what to do. */
export const helpLines = (h: Help): [string, string] => [h.what, `${h.where} ${h.todo}`];

// ---- the industry picker (N58, N72): free text is fragile, so a client's industry is chosen from the kinds that have a playbook.
// The value stored is a short phrase that the playbook rules recognise (tested), so a client picked here always lands in its playbook.
export const INDUSTRY_PICKER: ReadonlyArray<{ id: PlaybookId; value: string }> = [
  { id: "medical", value: "Medical and dental" },
  { id: "real_estate", value: "Real estate" },
  { id: "retail_fashion", value: "Fashion and retail" },
  { id: "legal_finance", value: "Legal and finance" },
  { id: "home_services", value: "Home services (roofing, HVAC, cleaning)" },
  { id: "fitness_beauty", value: "Fitness and beauty" },
];
export const OTHER_INDUSTRY = "__other__";
export const INDUSTRY_MAX = 60;

/** What the picker shows for a stored industry: one of the listed values, or "Other" with the typed text. */
export function pickerChoice(industry: string | null | undefined): { choice: string; other: string } {
  const text = (industry ?? "").trim();
  if (!text) return { choice: "", other: "" };
  const hit = INDUSTRY_PICKER.find((p) => norm(p.value) === norm(text));
  return hit ? { choice: hit.value, other: "" } : { choice: OTHER_INDUSTRY, other: text };
}
export function industryFromPicker(choice: string, other: string): string | null {
  if (choice === OTHER_INDUSTRY) return other.trim().slice(0, INDUSTRY_MAX) || null;
  return INDUSTRY_PICKER.some((p) => p.value === choice) ? choice : null;
}
/** The playbook a client falls under, in words ("Real estate and property"), or why it has none. */
export function playbookLine(industry: string | null | undefined): string {
  const key = industryKey(industry);
  if (key === "unset") return "No industry yet, so the general reply target and checklist apply.";
  if (key === "other") return "No built-in playbook for this industry, so the general reply target and checklist apply.";
  return `Playbook: ${PLAYBOOKS.find((p) => p.id === key)?.label ?? key}.`;
}

// ---- notes: the log of conversations (N58)
export const NOTE_KINDS = ["conversation", "note", "decision"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABEL: Record<NoteKind, string> = { conversation: "Conversation", note: "Note", decision: "Decision" };
export const NOTE_MAX = 2000;
export type NoteInput = { kind: NoteKind; body: string; occurredOn: string | null };
export function validateNote(raw: unknown, today: string): { ok: true; note: NoteInput } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = (r.kind ?? "note") as NoteKind;
  if (!NOTE_KINDS.includes(kind)) return { ok: false, error: "Pick conversation, note or decision" };
  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (!body) return { ok: false, error: "Write what was said or decided" };
  if (body.length > NOTE_MAX) return { ok: false, error: `Notes can be at most ${NOTE_MAX} characters` };
  let occurredOn: string | null = null;
  if (r.occurredOn !== undefined && r.occurredOn !== null && r.occurredOn !== "") {
    if (typeof r.occurredOn !== "string" || !ISO.test(r.occurredOn) || toIso(toMs(r.occurredOn)) !== r.occurredOn) return { ok: false, error: "Use a date like 2026-10-31" };
    if (r.occurredOn > today) return { ok: false, error: "A conversation cannot be in the future" };
    occurredOn = r.occurredOn;
  }
  return { ok: true, note: { kind, body, occurredOn } };
}

/** "Last spoken" now comes from the log too: the newest logged conversation or the "I spoke to them today" press, whichever is later. */
export function lastSpokenMs(profileLastContactedMs: number | null, conversationDates: ReadonlyArray<string>): number | null {
  const logged = conversationDates.filter((d) => ISO.test(d)).map((d) => toMs(d) + 12 * 3_600_000);
  const all = [...(profileLastContactedMs === null ? [] : [profileLastContactedMs]), ...logged];
  return all.length ? Math.max(...all) : null;
}

// ============================================================ Health: labels that never contradict each other (N16)

export type HealthRow = { name: string | null; score: number; band: ScoreBand; unanswered: number; dormant: boolean; churn: string; bandNote: string | null };
const attentionLabel: Record<ScoreBand, string> = { thriving: "Watch", healthy: "Watch", watch: "Watch", at_risk: "At risk" };
/** The clients to look at first, worst first, each with the label shown INSIDE the list. A client on this list is never called Healthy or Thriving there. */
export function needsAttention<T extends HealthRow>(rows: readonly T[], limit = 6): Array<T & { label: string; reasons: string[] }> {
  const reasonsOf = (r: HealthRow) => {
    const out: string[] = [];
    if (r.unanswered > 0) out.push(`${r.unanswered} customer${r.unanswered === 1 ? " is" : "s are"} waiting for a reply`);
    if (r.dormant) out.push("no activity for a long time");
    if (r.churn === "high") out.push("likely to leave");
    else if (r.churn === "medium") out.push("could leave");
    if (r.band === "at_risk" && out.length === 0) out.push("low health score");
    if (r.bandNote) out.push(r.bandNote.replace(/\.$/, ""));
    return out;
  };
  const sick = (r: HealthRow) => attentionBand(r.band) === "at_risk" || r.churn === "high" || r.dormant || r.unanswered > 0 || r.churn === "medium";
  return rows.filter(sick)
    .map((r) => ({ ...r, label: r.dormant || r.churn === "high" ? "At risk" : attentionLabel[attentionBand(r.band)], reasons: reasonsOf(r) }))
    .sort((a, b) => (a.label === "At risk" ? 0 : 1) - (b.label === "At risk" ? 0 : 1) || a.score - b.score)
    .slice(0, limit);
}

/** How many clients are in each health label, in the order shown, with the names behind each (so a click opens the list that makes the number). */
export const BAND_ORDER: ScoreBand[] = ["at_risk", "watch", "healthy", "thriving"];
export const BAND_WORDS: Record<ScoreBand, string> = { at_risk: "At risk", watch: "Watch", healthy: "Healthy", thriving: "Thriving" };
export function bandGroups<T extends { band: ScoreBand }>(rows: readonly T[]): Array<{ band: ScoreBand; label: string; rows: T[] }> {
  return BAND_ORDER.map((band) => ({ band, label: BAND_WORDS[band], rows: rows.filter((r) => r.band === band) }));
}

/** The bars of the Clients by health chart: one per label, the count on each bar being exactly the clients in the list behind it (the same groups, never a second count). */
export function healthBars<T extends { band: ScoreBand; name: string | null }>(groups: ReadonlyArray<{ band: ScoreBand; label: string; rows: T[] }>): Array<{ label: string; value: number; count: number; tone: "bad" | "warn" | "good"; detail: string }> {
  const tone = { at_risk: "bad", watch: "warn", healthy: "good", thriving: "good" } as const;
  return groups.map((g) => ({ label: g.label, value: g.rows.length, count: g.rows.length, tone: tone[g.band], detail: g.rows.slice(0, 3).map((r) => r.name ?? "Unnamed").join(", ") + (g.rows.length > 3 ? " and more" : "") }));
}

// ============================================================ quarters (Reviews)

export type Quarter = { key: string; year: number; q: 1 | 2 | 3 | 4; label: string; from: string; to: string };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function makeQuarter(year: number, q: 1 | 2 | 3 | 4): Quarter {
  const m0 = (q - 1) * 3;
  const from = toIso(Date.UTC(year, m0, 1));
  const to = toIso(Date.UTC(year, m0 + 3, 0));
  return { key: `${year}-Q${q}`, year, q, label: `Q${q} ${year} (${MONTHS[m0]} to ${MONTHS[m0 + 2]})`, from, to };
}
export const quarterOf = (ms: number): Quarter => { const d = new Date(ms); return makeQuarter(d.getUTCFullYear(), (Math.floor(d.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4); };
export function parseQuarter(key: unknown): Quarter | null {
  const m = typeof key === "string" ? /^(20\d{2})-Q([1-4])$/.exec(key) : null;
  return m ? makeQuarter(Number(m[1]), Number(m[2]) as 1 | 2 | 3 | 4) : null;
}
export const previousQuarter = (q: Quarter): Quarter => (q.q === 1 ? makeQuarter(q.year - 1, 4) : makeQuarter(q.year, (q.q - 1) as 1 | 2 | 3));
/** The quarter now and the `n - 1` before it, newest first. */
export function recentQuarters(nowMs: number, n = 6): Quarter[] {
  const out: Quarter[] = [quarterOf(nowMs)];
  while (out.length < n) out.push(previousQuarter(out[out.length - 1]));
  return out;
}
/** How much of a quarter has happened: a quarter still running is said to be so ("so far"), never presented as complete. */
export function quarterProgress(q: Quarter, nowMs: number): { complete: boolean; days: number; total: number } {
  const total = Math.round((toMs(q.to) - toMs(q.from)) / DAY) + 1;
  if (nowMs >= toMs(q.to) + DAY) return { complete: true, days: total, total };
  return { complete: false, days: Math.max(0, Math.floor((nowMs - toMs(q.from)) / DAY) + 1), total };
}

// ============================================================ trends (Health, Compare, Reviews)

export type DayPoint = { day: string; healthScore: number | null; openValue: number | null; contacts: number | null; newContacts30d: number | null; completenessPct: number | null };
export const pointsIn = <T extends { day: string }>(points: readonly T[], from: string, to: string): T[] => points.filter((p) => p.day >= from && p.day <= to);

/** Move a series by whole days (the comparison period is drawn on the same dates as the current one, so the two lines can be read against each other). */
export function shiftDays<T extends { day: string }>(points: readonly T[], days: number): T[] {
  return points.map((p) => ({ ...p, day: toIso(toMs(p.day) + days * DAY) }));
}
export const daysBetween = (fromIso: string, toIsoDay: string) => Math.round((toMs(toIsoDay) - toMs(fromIso)) / DAY);

/** The average of several clients' series, day by day, over the days where at least two of them have a value. */
export function averageSeries(list: ReadonlyArray<ReadonlyArray<{ day: string; value: number | null }>>): Array<{ day: string; value: number }> {
  const by = new Map<string, number[]>();
  for (const s of list) for (const p of s) if (p.value !== null && Number.isFinite(p.value)) by.set(p.day, [...(by.get(p.day) ?? []), p.value]);
  return [...by.entries()].filter(([, v]) => v.length >= 2).sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, value: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 }));
}

/** First and last value in a window, and how much history is there: the honest base for "health rose from 58 to 84". */
export function endpoints(values: ReadonlyArray<number | null>): { start: number | null; end: number | null; n: number } {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return { start: v.length ? v[0] : null, end: v.length ? v[v.length - 1] : null, n: v.length };
}

// ============================================================ Compare: two or more clients, against the average

export type MetricFormat = "int" | "money" | "pct" | "days" | "score";
export type MetricDef = { key: string; label: string; better: "higher" | "lower"; format: MetricFormat };
export const COMPARE_METRICS: MetricDef[] = [
  { key: "score", label: "Health score", better: "higher", format: "score" },
  { key: "new30d", label: "New contacts, 30 days", better: "higher", format: "int" },
  { key: "openValue", label: "Open pipeline", better: "higher", format: "money" },
  { key: "winRate", label: "Win rate", better: "higher", format: "pct" },
  { key: "avgCycleDays", label: "Days to win", better: "lower", format: "days" },
  { key: "unanswered", label: "Waiting past reply target", better: "lower", format: "int" },
  { key: "completenessPct", label: "Contact data complete", better: "higher", format: "pct" },
];
export const MAX_COMPARE = 6;
export type CompareInput = { locationId: string; name: string; values: Record<string, number | null> };
export type CompareCell = { locationId: string; value: number | null; vsAverage: string | null; flag: "best" | "worst" | null };
export type CompareRow = { metric: MetricDef; average: number | null; spread: boolean; cells: CompareCell[] };

/** A row is "different" (and its best and worst highlighted) when the clients are at least a fifth apart. Under two figures there is nothing to compare. */
export const DIFFERENT_SHARE = 0.2;

/** A figure as the Compare table writes it: dollars, a percentage (a win rate is stored as 0 to 1), days, or a plain number. */
export const formatMetric = (m: MetricDef, v: number): string =>
  m.format === "money" ? `$${Math.round(v).toLocaleString("en-US")}` : m.format === "pct" ? `${m.key === "winRate" ? Math.round(v * 100) : Math.round(v)}%` : m.format === "days" ? `${Math.round(v)} days` : String(Math.round(v * 10) / 10);

export function compareTable(clients: readonly CompareInput[]): { rows: CompareRow[]; notes: string[] } {
  const rows: CompareRow[] = COMPARE_METRICS.map((metric) => {
    const have = clients.map((c) => ({ id: c.locationId, v: c.values[metric.key] ?? null })).filter((x): x is { id: string; v: number } => x.v !== null && Number.isFinite(x.v));
    const average = have.length >= 2 ? have.reduce((s, x) => s + x.v, 0) / have.length : null;
    const hi = have.length ? Math.max(...have.map((x) => x.v)) : 0;
    const lo = have.length ? Math.min(...have.map((x) => x.v)) : 0;
    const spread = have.length >= 2 && hi !== lo && (hi - lo) / Math.max(Math.abs(hi), 1) >= DIFFERENT_SHARE;
    const bestV = metric.better === "higher" ? hi : lo;
    const worstV = metric.better === "higher" ? lo : hi;
    return {
      metric, average, spread,
      cells: clients.map((c) => {
        const value = c.values[metric.key] ?? null;
        let vs: string | null = null;
        if (value !== null && average !== null) {
          const ch: Change = changeBetween(Math.round(value * 10) / 10, Math.round(average * 10) / 10, "", MIN_BASE);
          vs = ch.kind === "same" ? "the same as the average" : ch.kind === "percent" ? `${(ch.percent ?? 0) > 0 ? "+" : ""}${ch.percent}% against the average` : ch.kind === "difference" ? `${value >= average ? "+" : "-"}${Math.round(Math.abs(value - average) * 10) / 10} against the average` : null;
        }
        return { locationId: c.locationId, value, vsAverage: vs, flag: spread && value !== null ? (value === bestV ? "best" : value === worstV ? "worst" : null) : null } as CompareCell;
      }),
    };
  });
  const notes: string[] = [];
  for (const r of rows) {
    if (!r.spread) continue;
    const best = r.cells.find((c) => c.flag === "best"), worst = r.cells.find((c) => c.flag === "worst");
    if (!best || !worst || best.value === null || worst.value === null) continue;
    const name = (id: string) => clients.find((c) => c.locationId === id)?.name ?? "A client";
    notes.push(`${r.metric.label}: ${name(best.locationId)} is best (${formatMetric(r.metric, best.value)}) and ${name(worst.locationId)} is furthest behind (${formatMetric(r.metric, worst.value)}).`);
  }
  if (clients.length >= 2 && notes.length === 0) notes.push("These clients look alike on every measure SubSync tracks.");
  return { rows, notes };
}

/** Parse ids=a,b,c (or the older a and b) into a list of well-formed, distinct ids, in order, capped. */
export function parseCompareIds(ids: string | null, a: string | null, b: string | null, valid: (s: string) => boolean): string[] {
  const raw = ids ? ids.split(",") : [a ?? "", b ?? ""];
  const out: string[] = [];
  for (const x of raw.map((s) => s.trim())) if (x && valid(x) && !out.includes(x)) out.push(x);
  return out.slice(0, MAX_COMPARE);
}

// ============================================================ Compare setups: only for accounts that share a baseline (N72)

/** How much of the baseline an account has: the share of the baseline's pipelines it also has (by name), counting a pipeline half when most of its stages differ. 0 to 1. */
export function baselineShare(base: Setup, other: Setup): number {
  if (base.pipelines.length === 0) return 0;
  const otherBy = new Map(other.pipelines.map((p) => [norm(p.name), p]));
  let score = 0;
  for (const bp of base.pipelines) {
    const op = otherBy.get(norm(bp.name));
    if (!op) continue;
    const bs = new Set(bp.stages.map(norm));
    const common = op.stages.filter((s) => bs.has(norm(s))).length;
    const union = new Set([...bs, ...op.stages.map(norm)]).size || 1;
    score += common / union >= 0.5 ? 1 : 0.5;
  }
  return Math.round((score / base.pipelines.length) * 100) / 100;
}
/** An account is compared with the baseline only when it clearly started from the same template: it has at least half of the baseline's pipelines. */
export const SHARED_BASELINE = 0.5;
export const sharesBaseline = (base: Setup, other: Setup) => baselineShare(base, other) >= SHARED_BASELINE;

export type Drift = { kind: "missing_pipeline" | "extra_pipeline" | "missing_stage" | "extra_stage" | "order" | "calendars"; pipeline: string | null; what: string; severity: "high" | "medium" | "low"; fix: string };
/** The difference from the baseline as rows, each with how serious it is and what to do about it (a structured diff instead of a wall of text). */
export function driftRows(base: Setup, other: Setup): Drift[] {
  const d = compareSetup(base, other);
  const out: Drift[] = [];
  for (const p of d.missingPipelines) out.push({ kind: "missing_pipeline", pipeline: p, what: `Missing pipeline "${p}"`, severity: "high", fix: `Add the pipeline "${p}" in this account (Settings, Pipelines), with the same stages as the baseline.` });
  for (const s of d.stageDiffs) {
    for (const m of s.missing) out.push({ kind: "missing_stage", pipeline: s.pipeline, what: `"${s.pipeline}" is missing the stage "${m}"`, severity: "high", fix: `Add the stage "${m}" to "${s.pipeline}" (Settings, Pipelines).` });
    for (const e of s.extra) out.push({ kind: "extra_stage", pipeline: s.pipeline, what: `"${s.pipeline}" has an extra stage "${e}"`, severity: "low", fix: `Keep it if the client needs it, or remove "${e}" so the account matches the baseline.` });
    if (s.orderDiffers && s.missing.length === 0 && s.extra.length === 0) out.push({ kind: "order", pipeline: s.pipeline, what: `"${s.pipeline}" has its stages in a different order`, severity: "medium", fix: `Drag the stages of "${s.pipeline}" into the baseline's order.` });
  }
  for (const p of d.extraPipelines) out.push({ kind: "extra_pipeline", pipeline: p, what: `Extra pipeline "${p}"`, severity: "low", fix: `Keep it if the client needs it, or remove "${p}".` });
  if (d.calendarDelta !== null && d.calendarDelta !== 0) out.push({ kind: "calendars", pipeline: null, what: `${Math.abs(d.calendarDelta)} ${d.calendarDelta > 0 ? "more" : "fewer"} calendar${Math.abs(d.calendarDelta) === 1 ? "" : "s"} than the baseline`, severity: "low", fix: d.calendarDelta < 0 ? "Add the calendars the baseline has (Settings, Calendars)." : "Check the extra calendars are intended." });
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ============================================================ Onboarding (N63)

export type StepKind = "auto" | "manual" | "template" | "custom";
/** Why an automatic check cannot say yes or no, in the three causes N64 separates, so the screen never says "unavailable" for all of them. */
export type UnknownReason = "not_checked" | "permission" | "unavailable";
export type Fix = { label: string; url: string | null; view: string | null };
export type StepState = { stepKey: string; isCustom: boolean; label: string | null; assignee: string | null; dueOn: string | null; doneAt: string | null; doneBy: string | null };
export type OnboardingItem = {
  key: string; label: string; kind: StepKind; status: "done" | "todo" | "unknown"; detail: string | null; reason: UnknownReason | null;
  fix: Fix | null; where: string | null; howto: string | null;
  assignee: string | null; dueOn: string | null; due: "overdue" | "soon" | "later" | null; doneAt: string | null; doneBy: string | null; canTick: boolean;
};

/** Where to go and what to do for each check. `crm` is a page under the client account in the CRM, built through the white-label link helper;
 *  `view` is a page inside SubSync. The CRM page names are the platform's usual settings addresses and are NOT verified against a live account
 *  (written up as UNSURE in docs/features/C1.md): every item also says in words where to click, so a link that lands on the account's home still works. */
export const FIX: Record<string, { crm?: string; view?: string; where: string; howto: string }> = {
  profile: { crm: "settings/company", where: "Settings, then Business Profile", howto: "Fill in the business name, email address and phone number. They appear on invoices, emails and the booking page." },
  website: { crm: "settings/company", where: "Settings, then Business Profile", howto: "Add the business website to the profile so emails and reviews link to it." },
  timezone: { crm: "settings/company", where: "Settings, then Business Profile", howto: "Set the time zone. Reminders, quiet hours and booking times all follow it." },
  address: { crm: "settings/company", where: "Settings, then Business Profile", howto: "Add the business address. It is needed for compliant emails and for maps on the booking page." },
  pipeline: { crm: "settings/pipelines", where: "Settings, then Pipelines", howto: "Create a pipeline with the stages the client's sales process really has (new lead, contacted, appointment, proposal, won)." },
  contacts: { crm: "contacts", where: "Contacts, then Import", howto: "Import the client's existing contacts from a spreadsheet so there is history to work with from day one." },
  opportunities: { crm: "opportunities/list", where: "Opportunities", howto: "Add the first deals, or set a workflow to create a deal when a lead books." },
  calendar: { crm: "settings/calendars", where: "Settings, then Calendars", howto: "Create the booking calendar and connect the client's own calendar, so appointments land where they look." },
  appointment: { crm: "calendars/view", where: "Calendars", howto: "Book one real appointment, or send the booking link to a test lead, to prove the whole path works." },
  activity: { crm: "conversations/conversations", where: "Conversations", howto: "Send the first messages or run the first campaign. An account with no activity in 14 days is marked quiet." },
  email_auth: { view: "email", where: "SubSync, Email sender health", howto: "Check the client's sending domain here. If SPF, DKIM or DMARC fail, add the records at the domain's DNS host and check again." },
  workflows: { crm: "automation/workflows", where: "Automation, then Workflows", howto: "Open the automations to see what is built. SubSync cannot read this list for every account, so confirm it by eye." },
  "manual:kickoff": { where: "On a call", howto: "Hold the kickoff call, agree goals and who does what, then tick this off." },
  "manual:domain": { crm: "settings/domain", where: "Settings, then Domains", howto: "Connect the client's own domain so pages and emails carry their name. SubSync cannot see which domain is connected, so tick this off yourself when it is." },
  "manual:phone": { crm: "settings/phone-number", where: "Settings, then Phone Numbers", howto: "Buy or port a number and finish its registration. SubSync cannot see registration status, so tick this off yourself." },
  "manual:training": { where: "On a call", howto: "Walk the client's staff through the inbox, the calendar and the pipeline, then tick this off." },
};

/** The address of a page under a client account in the CRM, through the white-label link helper (never a hard-coded domain). */
export function crmAccountPage(source: DomainSource, locationId: string, page: string): string {
  return crmUrl(source, `/v2/location/${encodeURIComponent(locationId)}/${page.replace(/^\/+/, "")}`);
}

export const DUE_SOON_DAYS = 3;
export function dueState(dueOn: string | null, nowMs: number): "overdue" | "soon" | "later" | null {
  if (!dueOn || !ISO.test(dueOn)) return null;
  const days = Math.floor((toMs(dueOn) - (Math.floor(nowMs / DAY) * DAY)) / DAY);
  return days < 0 ? "overdue" : days <= DUE_SOON_DAYS ? "soon" : "later";
}

export type BaseItem = { key: string; label: string; status: "done" | "todo" | "unknown"; auto: boolean; detail?: string };
export type AccountFacts = {
  website: string | null; timezone: string | null; address: string | null; appointments: number; appointmentsAccess: string | null;
};
export type TemplateStep = { key: string; label: string; howto?: string };

/** The checks SubSync adds on top of the original six: more auto-detection wherever the account data already holds the answer. */
export function extraAutoItems(facts: AccountFacts): BaseItem[] {
  const filled = (v: string | null) => Boolean(v && v.trim());
  const items: BaseItem[] = [
    { key: "website", label: "Website added to the business profile", status: filled(facts.website) ? "done" : "todo", auto: true },
    { key: "timezone", label: "Time zone set", status: filled(facts.timezone) ? "done" : "todo", auto: true },
    { key: "address", label: "Business address added", status: filled(facts.address) ? "done" : "todo", auto: true },
  ];
  if (facts.appointmentsAccess === "needs_permission") items.push({ key: "appointment", label: "A first appointment has been booked", status: "unknown", auto: true, detail: "Needs permission: reconnect SubSync to let it read appointments" });
  else items.push({ key: "appointment", label: "A first appointment has been booked", status: facts.appointments > 0 ? "done" : "todo", auto: true });
  return items;
}

const REASON_OF: Record<string, UnknownReason> = { email_auth: "not_checked", workflows: "unavailable" };
export const REASON_WORDS: Record<UnknownReason, string> = {
  not_checked: "Not checked yet.",
  permission: "Needs permission: reconnect to turn this on.",
  unavailable: "Not available from your CRM yet.",
};

export type BuildArgs = {
  base: ReadonlyArray<BaseItem>;
  facts: AccountFacts;
  templateSteps: ReadonlyArray<TemplateStep>;
  states: ReadonlyArray<StepState>;
  /** onboarding_tasks rows (manual:* and custom:* keys): the done flag the older checklist already stores. */
  manualDone: Readonly<Record<string, boolean>>;
  locationId: string;
  links: DomainSource;
  nowMs: number;
};

/** One list of everything for one client: the automatic checks (original and new), the manual ones, the steps of the client's template and the steps added
 *  for this client alone, each with its "Fix it" link, its how-to, who is on it and when it is due. */
export function buildOnboardingItems(a: BuildArgs): { items: OnboardingItem[]; completionPct: number } {
  const stateOf = new Map(a.states.map((s) => [s.stepKey, s]));
  const items: OnboardingItem[] = [];
  const present = new Set<string>();
  const push = (b: BaseItem, kind: StepKind, howtoOverride: string | null = null) => {
    if (present.has(b.key)) return;
    present.add(b.key);
    const st = stateOf.get(b.key);
    const f = FIX[b.key];
    // Where the done flag lives: automatic checks are worked out each time; manual and global custom steps keep the flag the older checklist stores;
    // template steps and steps added to one client keep it in their own row.
    const status: "done" | "todo" | "unknown" = kind === "auto" ? b.status : b.key.startsWith("manual:") || b.key.startsWith("custom:") ? (a.manualDone[b.key] ? "done" : "todo") : st?.doneAt ? "done" : "todo";
    items.push({
      key: b.key, label: b.label, kind, status, detail: b.detail ?? null,
      reason: status === "unknown" ? (b.detail?.startsWith("Needs permission") ? "permission" : REASON_OF[b.key] ?? "unavailable") : null,
      // A finished step needs no fix. An unfinished one with a known page gets the link.
      fix: status !== "done" && f ? { label: "Fix it", url: f.crm ? crmAccountPage(a.links, a.locationId, f.crm) : null, view: f.view ?? null } : null,
      where: f?.where ?? null, howto: howtoOverride ?? f?.howto ?? null,
      assignee: st?.assignee ?? null, dueOn: st?.dueOn ?? null, due: status === "done" ? null : dueState(st?.dueOn ?? null, a.nowMs),
      doneAt: status === "done" ? st?.doneAt ?? null : null, doneBy: status === "done" ? st?.doneBy ?? null : null,
      canTick: kind !== "auto",
    });
  };
  for (const b of a.base) push(b, b.auto ? "auto" : b.key.startsWith("manual:") ? "manual" : "custom");
  for (const b of extraAutoItems(a.facts)) push(b, "auto");
  for (const t of a.templateSteps) push({ key: `tpl:${t.key}`, label: t.label, status: "todo", auto: false }, "template", t.howto ?? null);
  for (const s of a.states) if (s.isCustom && s.label) push({ key: s.stepKey, label: s.label, status: "todo", auto: false }, "custom");
  const known = items.filter((i) => i.status !== "unknown");
  const done = known.filter((i) => i.status === "done").length;
  return { items, completionPct: known.length ? Math.round((done / known.length) * 100) : 0 };
}

export type StuckInput = { daysIn: number | null; completionPct: number };
export const STUCK_CHOICES = [7, 14, 30, 60] as const;
export const DEFAULT_STUCK_DAYS = 14;
/** A client is stuck when it is still not fully onboarded more than `days` days after it was added. */
export const isStuck = (c: StuckInput, days: number) => c.completionPct < 100 && c.daysIn !== null && c.daysIn > days;
export function parseStuckDays(v: string | null): number {
  const n = Number(v);
  return (STUCK_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_STUCK_DAYS;
}

// ---- templates
export const MAX_TEMPLATE_STEPS = 20;
export const STEP_LABEL_MAX = 120;
export const HOWTO_MAX = 300;
export const TEMPLATE_NAME_MAX = 60;
/** Check the steps of a template that came from the browser: how many, how long, no duplicates. Each kept step has a stable key (made by `makeKey` when new). */
export function cleanSteps(raw: unknown, makeKey: () => string): { ok: true; steps: TemplateStep[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Send the steps as a list" };
  if (raw.length > MAX_TEMPLATE_STEPS) return { ok: false, error: `A template can have at most ${MAX_TEMPLATE_STEPS} steps` };
  const steps: TemplateStep[] = [];
  const seen = new Set<string>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const label = typeof r?.label === "string" ? r.label.trim() : "";
    if (!label) continue;
    if (label.length > STEP_LABEL_MAX) return { ok: false, error: `A step name can be at most ${STEP_LABEL_MAX} characters` };
    if (seen.has(norm(label))) return { ok: false, error: `"${label}" is in the list twice` };
    seen.add(norm(label));
    const howto = typeof r.howto === "string" ? r.howto.trim() : "";
    if (howto.length > HOWTO_MAX) return { ok: false, error: `A how-to can be at most ${HOWTO_MAX} characters` };
    const key = typeof r.key === "string" && /^[a-z0-9]{4,12}$/.test(r.key) ? r.key : makeKey();
    steps.push(howto ? { key, label, howto } : { key, label });
  }
  return { ok: true, steps };
}
export function validTemplateIndustry(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return undefined;
  return v === "other" || PLAYBOOKS.some((p) => p.id === v) ? v : undefined;
}
/** The template that applies to a client: the one for its industry kind, else the one for everyone. */
export function templateFor<T extends { industryKey: string | null }>(templates: readonly T[], clientIndustry: string | null | undefined): T | null {
  const key = industryKey(clientIndustry);
  return templates.find((t) => t.industryKey !== null && t.industryKey === key) ?? templates.find((t) => t.industryKey === null) ?? null;
}
/** A starter template from an industry playbook's checklist (the steps the playbook already suggests). */
export function starterFromPlaybook(id: string, makeKey: () => string): { name: string; industryKey: string; steps: TemplateStep[] } | null {
  const p = PLAYBOOKS.find((x) => x.id === id);
  if (!p) return null;
  return { name: p.label, industryKey: p.id, steps: p.checklist.map((label) => ({ key: makeKey(), label })) };
}

export const STEP_EVENTS = ["done", "reopened", "assigned", "due", "added", "removed"] as const;
export type StepEvent = (typeof STEP_EVENTS)[number];
export function historyLine(e: { event: StepEvent; stepLabel: string | null; detail: string | null; actor: string | null }): string {
  const who = e.actor ?? "Someone";
  const step = e.stepLabel ?? "a step";
  switch (e.event) {
    case "done": return `${who} finished "${step}"`;
    case "reopened": return `${who} reopened "${step}"`;
    case "assigned": return e.detail ? `${who} gave "${step}" to ${e.detail}` : `${who} took the name off "${step}"`;
    case "due": return e.detail ? `${who} set "${step}" due ${e.detail}` : `${who} cleared the due date of "${step}"`;
    case "added": return `${who} added "${step}"`;
    case "removed": return `${who} removed "${step}"`;
  }
}
/** A change to one step, checked: assignee (up to 60 characters), a real due date, a done flag. Only the fields present are changed. */
export type StepPatch = { done?: boolean; assignee?: string | null; dueOn?: string | null };
export function validateStepPatch(raw: unknown): { ok: true; patch: StepPatch } | { ok: false; error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const patch: StepPatch = {};
  if ("done" in r) patch.done = r.done === true;
  if ("assignee" in r) {
    if (r.assignee === null || r.assignee === "") patch.assignee = null;
    else if (typeof r.assignee === "string" && r.assignee.trim().length <= 60) patch.assignee = r.assignee.trim();
    else return { ok: false, error: "A name can be at most 60 characters" };
  }
  if ("dueOn" in r) {
    if (r.dueOn === null || r.dueOn === "") patch.dueOn = null;
    else if (typeof r.dueOn === "string" && ISO.test(r.dueOn) && toIso(toMs(r.dueOn)) === r.dueOn) patch.dueOn = r.dueOn;
    else return { ok: false, error: "Use a date like 2026-11-15" };
  }
  return Object.keys(patch).length ? { ok: true, patch } : { ok: false, error: "Nothing to change" };
}
export const STEP_KEY = /^(manual:[a-z_]{2,20}|custom:.{1,80}|tpl:[a-z0-9]{4,12}|step:[a-z0-9]{6,12}|[a-z_]{2,20})$/;

// ============================================================ Reviews (QBR)

/** The money figures of a window from the same counted deals every other screen uses: a deal counts when it has a value and an owner (metrics.ts). */
export function dealFigures(deals: ReadonlyArray<Pick<Deal, "locationId" | "status" | "value" | "assignedTo" | "createdAt" | "statusChangedAt">>, fromMs: number, toMs: number): Map<string, { pipelineCreated: number; wonValue: number; wonCount: number }> {
  const out = new Map<string, { pipelineCreated: number; wonValue: number; wonCount: number }>();
  for (const d of deals) {
    if (!(d.value > 0) || !d.assignedTo) continue;
    const cell = out.get(d.locationId) ?? { pipelineCreated: 0, wonValue: 0, wonCount: 0 };
    if (d.createdAt !== null && d.createdAt >= fromMs && d.createdAt < toMs) cell.pipelineCreated += d.value;
    if (d.status === "won" && d.statusChangedAt !== null && d.statusChangedAt >= fromMs && d.statusChangedAt < toMs) { cell.wonValue += d.value; cell.wonCount += 1; }
    out.set(d.locationId, cell);
  }
  return out;
}


export type QuarterFacts = {
  contactsAdded: number; healthStart: number | null; healthEnd: number | null; healthDays: number;
  pipelineCreated: number; wonCount: number; wonValue: number; openValueEnd: number | null;
  apptWithOutcome: number; apptShowed: number; alertsRaised: number; alertsResolved: number;
};
export type NowFacts = { dormant: boolean; unanswered: number; staleOpps: number; completenessPct: number; openAlerts: number; monthlyFee: number | null; replyHitRate: number | null; replyLeads: number };
export type Finding = { text: string };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** Wins and issues for a review, from the quarter and the one before it. Every sentence rests on a real count; small bases give plain differences, not percentages. */
export function qbrFindings(cur: QuarterFacts, prev: QuarterFacts | null, now: NowFacts): { wins: Finding[]; issues: Finding[]; steps: Finding[] } {
  const wins: Finding[] = [];
  const issues: Finding[] = [];
  if (cur.contactsAdded > 0) {
    const c = prev ? changeBetween(cur.contactsAdded, prev.contactsAdded, "contacts") : null;
    wins.push({ text: `${cur.contactsAdded} new contact${cur.contactsAdded === 1 ? "" : "s"} came in${c && c.kind !== "none" && (cur.contactsAdded >= prev!.contactsAdded) && c.kind !== "same" ? ` (${c.text.toLowerCase()})` : ""}.` });
  }
  if (cur.wonCount > 0) wins.push({ text: `${cur.wonCount} deal${cur.wonCount === 1 ? "" : "s"} won, worth ${money(cur.wonValue)}.` });
  if (cur.pipelineCreated > 0) wins.push({ text: `${money(cur.pipelineCreated)} of new deals started${now.monthlyFee ? `, ${Math.round((cur.pipelineCreated / (now.monthlyFee * 3)) * 10) / 10}x what the client paid for the quarter` : ""}.` });
  if (cur.healthDays >= 14 && cur.healthStart !== null && cur.healthEnd !== null) {
    const d = cur.healthEnd - cur.healthStart;
    if (d >= 5) wins.push({ text: `The health score rose from ${cur.healthStart} to ${cur.healthEnd}.` });
    else if (d <= -5) issues.push({ text: `The health score fell from ${cur.healthStart} to ${cur.healthEnd}.` });
  }
  if (cur.apptWithOutcome >= MIN_BASE) {
    const rate = Math.round((cur.apptShowed / cur.apptWithOutcome) * 100);
    (rate >= 70 ? wins : rate < 50 ? issues : []).push({ text: `${rate}% of ${cur.apptWithOutcome} appointments with a recorded outcome were attended.` });
  }
  if (now.replyHitRate !== null && now.replyLeads >= MIN_BASE) {
    const r = Math.round(now.replyHitRate * 100);
    (r >= 80 ? wins : r < 50 ? issues : []).push({ text: `${r}% of the last ${now.replyLeads} new leads got a first reply inside the target.` });
  }
  if (cur.alertsResolved > 0) wins.push({ text: `${cur.alertsResolved} problem${cur.alertsResolved === 1 ? "" : "s"} SubSync flagged ${cur.alertsResolved === 1 ? "has" : "have"} cleared (fixed, dismissed or no longer showing).` });
  if (now.dormant) issues.push({ text: "The account has gone quiet: nothing has happened in it for a long time." });
  if (now.unanswered > 0) issues.push({ text: `${now.unanswered} customer message${now.unanswered === 1 ? " is" : "s are"} waiting past the reply target.` });
  if (now.staleOpps > 0) issues.push({ text: `${now.staleOpps} open deal${now.staleOpps === 1 ? " has" : "s have"} not moved for a long time.` });
  if (now.completenessPct > 0 && now.completenessPct < 60) issues.push({ text: `Contact data is only ${now.completenessPct}% complete (email, phone and tags).` });
  if (now.openAlerts > 0) issues.push({ text: `${now.openAlerts} alert${now.openAlerts === 1 ? " is" : "s are"} still open.` });
  if (wins.length === 0) wins.push({ text: "No clear wins show up in the numbers SubSync holds for this period yet." });
  // What to do next follows from the issues, so the review ends with an agreed action and not just a list of problems.
  const steps: Finding[] = [];
  if (now.unanswered > 0) steps.push({ text: `Reply to the ${now.unanswered} waiting customer message${now.unanswered === 1 ? "" : "s"} first, then agree who answers new ones.` });
  if (now.replyHitRate !== null && now.replyLeads >= MIN_BASE && now.replyHitRate < 0.5) steps.push({ text: "Agree who answers every new lead and how fast, then check the reply speed again in two weeks." });
  if (now.dormant) steps.push({ text: "Book a call to find out why the account went quiet, and agree one campaign to restart it." });
  if (now.staleOpps > 0) steps.push({ text: `Go through the ${now.staleOpps} deal${now.staleOpps === 1 ? "" : "s"} that stopped moving: win it, move it or close it.` });
  if (now.completenessPct > 0 && now.completenessPct < 60) steps.push({ text: "Fill in the missing emails, phone numbers and tags so campaigns reach more people." });
  if (now.openAlerts > 0) steps.push({ text: `Work through the ${now.openAlerts} open alert${now.openAlerts === 1 ? "" : "s"} and clear each one.` });
  steps.push({ text: "Agree one goal for next quarter and book the next review." });
  return { wins, issues, steps };
}

/** The review as plain text a person can paste into an email or a message to the client: nothing to retype. Only what the review itself shows. */
export function reviewText(r: { client: string; quarter: string; wins: ReadonlyArray<Finding>; issues: ReadonlyArray<Finding>; steps: ReadonlyArray<Finding>; proof: { total: number; resolved: number }; /** The sender's own name: a review sent to a client never carries the product's name. */ brand?: string | null }): string {
  const list = (items: ReadonlyArray<Finding>) => items.map((i) => `- ${i.text}`).join("\n");
  return [
    `Quarterly review: ${r.client}, ${r.quarter}`, "",
    "What went well", list(r.wins), "",
    ...(r.issues.length ? ["What needs attention", list(r.issues), ""] : []),
    r.proof.total > 0 ? `What SubSync caught: ${r.proof.total} problem${r.proof.total === 1 ? "" : "s"} flagged, ${r.proof.resolved} cleared (fixed, dismissed or no longer showing).` : "",
    ...(r.proof.total > 0 ? [""] : []),
    "Next steps", list(r.steps),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim().split("SubSync").join(r.brand?.trim() || "SubSync");
}

export const ALERT_WORDS: Record<string, string> = {
  dormant: "The account went quiet", churn: "The client looked likely to leave", leadflow: "New contacts dropped sharply", quality: "Contact data problems", sla: "Customer messages were left waiting",
  speed: "New leads were left unanswered", stale: "Deals stopped moving", email: "An email sender problem", appointments: "Appointments were left without an outcome",
};
export type ProofAlert = { kind: string; title: string; createdAt: string; resolvedAt: string | null };
/** "What SubSync caught": the alerts raised in the quarter, grouped by what they were about, with how many have cleared. Sync problems are not a result for the client and are left out. */
export function proofSummary(alerts: ReadonlyArray<ProofAlert>, q: Pick<Quarter, "from" | "to">): { total: number; resolved: number; groups: Array<{ kind: string; label: string; raised: number; resolved: number; example: string }> } {
  const inQ = alerts.filter((a) => a.kind !== "sync" && a.createdAt.slice(0, 10) >= q.from && a.createdAt.slice(0, 10) <= q.to);
  const by = new Map<string, ProofAlert[]>();
  for (const a of inQ) by.set(a.kind, [...(by.get(a.kind) ?? []), a]);
  const groups = [...by.entries()].map(([kind, list]) => ({ kind, label: ALERT_WORDS[kind] ?? kind, raised: list.length, resolved: list.filter((x) => x.resolvedAt).length, example: list[0].title })).sort((a, b) => b.raised - a.raised);
  return { total: inQ.length, resolved: inQ.filter((a) => a.resolvedAt).length, groups };
}
