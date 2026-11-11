// The pure rules of the Unanswered "moat and proof" features (round 3, slice D and E): rescued-revenue estimate, speed-to-outcome curve, scorecard trend,
// peer benchmark suppression, the two wait clocks, channel mix, the tamper-evident page chain and the weekly proof wording.
// No database, no network. Definitions are written in docs/METRICS.md ("Unanswered, round 3: moat and proof"); this file is their only implementation.
import { createHash, createHmac } from "node:crypto";
import { unansweredBusinessElapsedMs } from "./unanswered-advanced.ts";

// ---------------------------------------------------------------- kinds of business (optional tag per client account)

export const VERTICALS = ["med_spa", "solar", "home_services", "real_estate", "legal", "coaching", "other"] as const;
export type Vertical = (typeof VERTICALS)[number];
export const VERTICAL_LABEL: Record<Vertical, string> = {
  med_spa: "Med spa", solar: "Solar", home_services: "Home services", real_estate: "Real estate", legal: "Legal", coaching: "Coaching", other: "Other",
};
export const isVertical = (v: unknown): v is Vertical => typeof v === "string" && (VERTICALS as readonly string[]).includes(v);

// ---------------------------------------------------------------- the raw record (D1)

export const MOAT_KINDS = [
  "lead_created", "first_human_touch", "first_auto_touch", "owner_changed", "alert_fired", "alert_outcome", "alert_feedback",
  "appointment_booked", "appointment_showed", "appointment_no_show", "deal_won", "deal_lost", "reply_target_set",
] as const;
export type MoatKind = (typeof MOAT_KINDS)[number];

/** One fact, one key: the same fact seen twice (a retry, a second sweep) writes one row. The key never holds a name or any message text. */
export function moatKey(kind: MoatKind, ...parts: Array<string | number | null | undefined>): string {
  return [kind, ...parts.map((p) => String(p ?? "-").replace(/[^A-Za-z0-9_.:-]/g, "_"))].join("|").slice(0, 200);
}

/** Appointment status words from the platform, folded to the three outcomes we keep. Anything else is not an outcome. */
export function appointmentOutcome(status: string | null | undefined): "showed" | "no_show" | null {
  const s = String(status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "showed" || s === "show" || s === "completed" || s === "attended") return "showed";
  if (s === "noshow") return "no_show";
  return null;
}

// ---------------------------------------------------------------- small statistics

export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = (p / 100) * (v.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  return v[lo] + (v[hi] - v[lo]) * (rank - lo);
}
export const median = (values: readonly number[]) => percentile(values, 50);

// ---------------------------------------------------------------- D2. Rescued revenue (an estimate)

/** Under this many leads, or this many closed deals, in the last 90 days, a dollar estimate is not shown. */
export const MIN_LEADS = 100;
export const MIN_CLOSED_DEALS = 30;
/** The share of expected value lost when a lead waits past the target. Conservative on purpose; replaced by the account's own curve later. */
export const SPEED_PENALTY = { low: 0.2, high: 0.3 } as const;

export type RateFacts = { leads: number; booked: number; won: number; lost: number; avgDealValue: number | null };
export type Estimate =
  | { ok: true; low: number; high: number; bookingRate: number; closeRate: number; avgDealValue: number }
  | { ok: false; reason: "few_leads" | "few_deals" | "no_value"; needLeads: number; needDeals: number };

/** Dollars for `leads` leads: leads x booking rate x close rate x average deal value x speed penalty, as a low-to-high range. "Not enough data" under the minimums. */
export function estimateDollars(count: number, f: RateFacts): Estimate {
  const closed = f.won + f.lost;
  if (f.leads < MIN_LEADS) return { ok: false, reason: "few_leads", needLeads: MIN_LEADS - f.leads, needDeals: Math.max(0, MIN_CLOSED_DEALS - closed) };
  if (closed < MIN_CLOSED_DEALS) return { ok: false, reason: "few_deals", needLeads: 0, needDeals: MIN_CLOSED_DEALS - closed };
  if (!f.avgDealValue || f.avgDealValue <= 0) return { ok: false, reason: "no_value", needLeads: 0, needDeals: 0 };
  const bookingRate = f.booked / f.leads;
  const closeRate = f.won / closed;
  const base = Math.max(0, count) * bookingRate * closeRate * f.avgDealValue;
  return { ok: true, low: Math.round(base * SPEED_PENALTY.low), high: Math.round(base * SPEED_PENALTY.high), bookingRate, closeRate, avgDealValue: f.avgDealValue };
}

export const FORMULA = "waiting leads past the target x booking rate x close rate x average deal value x 0.2 to 0.3 (a cautious share of value lost when a lead waits). It is an estimate from this account's own last 90 days, not a promise.";

export type ReceiptFacts = {
  alerts: number;       // alerts raised in the month
  saved: number;        // alerts that ended with a person's reply observed
  stillWaiting: number; // alerts still open
  replyMinutes: readonly number[]; // from alert to the person's reply, for the saved ones
  bookedAfter: number;  // saved leads that booked an appointment afterwards
  lateLeads: number;    // new leads in the month that waited past the account's reply target (or were never answered)
};
export type Receipt = {
  alerts: number; saved: number; stillWaiting: number; bookedAfter: number; medianReplyMinutes: number | null; lateLeads: number;
  rescued: Estimate; atRisk: Estimate;
};

export function buildReceipt(r: ReceiptFacts, rates: RateFacts): Receipt {
  return {
    alerts: r.alerts, saved: r.saved, stillWaiting: r.stillWaiting, bookedAfter: r.bookedAfter, lateLeads: r.lateLeads,
    medianReplyMinutes: (() => { const m = median(r.replyMinutes.filter((n) => n >= 0)); return m === null ? null : Math.round(m); })(),
    rescued: estimateDollars(r.saved, rates),
    atRisk: estimateDollars(r.lateLeads, rates),
  };
}

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export function rangeText(e: Estimate): string {
  if (!e.ok) return "Not enough data yet";
  return e.low === e.high ? money(e.low) : `${money(e.low)} to ${money(e.high)}`;
}
export function notEnough(e: Estimate): string | null {
  if (e.ok) return null;
  if (e.reason === "few_leads") return `Not enough data yet: ${e.needLeads} more lead${e.needLeads === 1 ? "" : "s"} needed`;
  if (e.reason === "few_deals") return `Not enough data yet: ${e.needDeals} more closed deal${e.needDeals === 1 ? "" : "s"} needed`;
  return "Not enough data yet: no deal values recorded";
}

/** One plain sentence for the receipt. Counts need no model; the dollars carry the word "estimated". */
export function receiptLine(r: Receipt): string {
  if (!r.alerts) return "No leads needed an alert this period.";
  const parts = [`${r.saved} of ${r.alerts} alerted lead${r.alerts === 1 ? "" : "s"} got a reply`];
  if (r.medianReplyMinutes !== null) parts.push(`typically ${durationText(r.medianReplyMinutes)} after the alert`);
  if (r.bookedAfter) parts.push(`${r.bookedAfter} booked afterwards`);
  const est = r.rescued.ok ? `; estimated ${rangeText(r.rescued)} kept` : "";
  return parts.join(", ") + est + ".";
}

export function durationText(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 48) return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

// ---------------------------------------------------------------- D3. Speed-to-outcome curve

/** Reply speed bands, in minutes from the lead arriving to a person's first reply. "never" is a lead nobody replied to. */
export const CURVE_BANDS = [
  { key: "m5", label: "Under 5 min", from: 0, to: 5 },
  { key: "m60", label: "5 to 60 min", from: 5, to: 60 },
  { key: "h24", label: "1 to 24 hours", from: 60, to: 1440 },
  { key: "late", label: "Over 24 hours", from: 1440, to: Infinity },
  { key: "never", label: "Never answered", from: -1, to: -1 },
] as const;
export type BandKey = (typeof CURVE_BANDS)[number]["key"];
export const MIN_BAND_LEADS = 20;

export function bandOf(replyMinutes: number | null): BandKey {
  if (replyMinutes === null) return "never";
  for (const b of CURVE_BANDS) if (b.key !== "never" && replyMinutes >= b.from && replyMinutes < b.to) return b.key;
  return "late";
}

export type BandCount = { key: BandKey; leads: number; booked: number };
export type CurveBand = { key: BandKey; label: string; leads: number; booked: number; bookRate: number | null; enough: boolean };
export type Curve = { ok: boolean; total: number; bands: CurveBand[]; headline: string | null; needMore: number };

export function buildCurve(counts: readonly BandCount[]): Curve {
  const byKey = new Map(counts.map((c) => [c.key, c]));
  const bands: CurveBand[] = CURVE_BANDS.map((b) => {
    const c = byKey.get(b.key);
    const leads = c?.leads ?? 0, booked = Math.min(c?.booked ?? 0, leads);
    const enough = leads >= MIN_BAND_LEADS;
    return { key: b.key, label: b.label, leads, booked, bookRate: enough ? booked / leads : null, enough };
  });
  const total = bands.reduce((s, b) => s + b.leads, 0);
  const ok = total >= MIN_LEADS;
  const fast = bands.find((b) => b.key === "m5"), slow = bands.filter((b) => b.key === "h24" || b.key === "late");
  const slowLeads = slow.reduce((s, b) => s + b.leads, 0), slowBooked = slow.reduce((s, b) => s + b.booked, 0);
  let headline: string | null = null;
  if (ok && fast?.enough && slowLeads >= MIN_BAND_LEADS) {
    headline = `Answered under 5 minutes: ${pct(fast.bookRate)} booked. Answered after more than an hour: ${pct(slowBooked / slowLeads)} booked.`;
  }
  return { ok, total, bands, headline, needMore: ok ? 0 : MIN_LEADS - total };
}
const pct = (r: number | null) => (r === null ? "n/a" : `${Math.round(r * 100)}%`);

// ---------------------------------------------------------------- D4. Scorecards

export type Trend = { dir: "faster" | "slower" | "same" | "new"; changePct: number | null };
/** Week on week change of a median reply time. Needs at least 5 replies in each week, otherwise "new" (no claim). */
export function weekTrend(thisWeek: { median: number | null; n: number }, lastWeek: { median: number | null; n: number }): Trend {
  if (thisWeek.median === null || lastWeek.median === null || thisWeek.n < 5 || lastWeek.n < 5 || lastWeek.median <= 0) return { dir: "new", changePct: null };
  const change = (thisWeek.median - lastWeek.median) / lastWeek.median;
  if (Math.abs(change) < 0.1) return { dir: "same", changePct: Math.round(change * 100) };
  return { dir: change < 0 ? "faster" : "slower", changePct: Math.round(change * 100) };
}

export type Scorecard = {
  userId: string; name: string; replies: number; medianMinutes: number | null; p90Minutes: number | null;
  owned: number; unanswered: number; unansweredShare: number | null; afterHoursLeads: number; afterHoursCovered: number; afterHoursCoverage: number | null;
  trend: Trend; enough: boolean;
};
/** A person's card needs at least 5 replies to show speeds; below that the numbers are hidden and the card says so. */
export const MIN_REPLIES_SCORECARD = 5;
export const share = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ---------------------------------------------------------------- D5. Peer benchmark suppression

export const BENCH_MIN_ACCOUNTS = 10;
export const BENCH_MIN_AGENCIES = 5;
export const BENCH_MAX_AGENCY_SHARE = 0.4;
export type CellFacts = { accounts: number; agencies: number; topAgencyShare: number };
export type CellDecision = { show: true } | { show: false; reason: "few_accounts" | "few_agencies" | "one_agency_dominates"; message: string };
export function benchmarkDecision(c: CellFacts): CellDecision {
  if (c.accounts < BENCH_MIN_ACCOUNTS) return { show: false, reason: "few_accounts", message: "Not enough accounts yet" };
  if (c.agencies < BENCH_MIN_AGENCIES) return { show: false, reason: "few_agencies", message: "Not enough accounts yet" };
  if (c.topAgencyShare > BENCH_MAX_AGENCY_SHARE) return { show: false, reason: "one_agency_dominates", message: "Not enough accounts yet" };
  return { show: true };
}

// ---------------------------------------------------------------- E1. Two wait clocks

export type ClockSetting = { businessHours: boolean; openHour: number; closeHour: number; zone: string | null };
export type WaitClock = { realMinutes: number; workingMinutes: number | null; used: "working" | "real"; usedMinutes: number; usedLabel: string };
/** The real wait (wall clock) and the working-hours wait (Monday to Friday, the account's opening hours). `used` is the one the alerts and targets use, and the screen says which. */
export function waitClock(startMs: number, endMs: number, c: ClockSetting): WaitClock {
  const realMinutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
  let workingMinutes: number | null = null;
  try {
    workingMinutes = Math.round(unansweredBusinessElapsedMs(startMs, endMs, c.zone, c.openHour, c.closeHour) / 60_000);
  } catch { workingMinutes = null; }
  const useWorking = c.businessHours && workingMinutes !== null;
  return {
    realMinutes, workingMinutes, used: useWorking ? "working" : "real",
    usedMinutes: useWorking ? (workingMinutes as number) : realMinutes,
    usedLabel: useWorking ? "Counting working hours only" : "Counting every hour",
  };
}

// ---------------------------------------------------------------- E4. Channel mix

export const CHANNELS = ["sms", "email", "whatsapp", "chat", "social", "call", "other"] as const;
export type ChannelKey = (typeof CHANNELS)[number];
export type ChannelRow = { channel: string; leads: number; replied: number; medianMinutes: number | null };
export type ChannelMix = { rows: Array<{ channel: ChannelKey; leads: number; sharePct: number; replied: number; medianMinutes: number | null }>; fastest: ChannelKey | null; total: number };
export const channelOf = (raw: string | null | undefined): ChannelKey => {
  const c = String(raw ?? "").toLowerCase();
  if (c === "sms" || c === "email" || c === "whatsapp" || c === "chat" || c === "call") return c;
  if (/facebook|instagram|messenger|social|gmb|google|tiktok/.test(c)) return "social";
  return "other";
};
/** Share of leads per channel, and the fastest channel: lowest median reply among channels with at least 10 replied leads. */
export function buildChannelMix(rows: readonly ChannelRow[]): ChannelMix {
  const merged = new Map<ChannelKey, { leads: number; replied: number; medians: Array<[number, number]> }>();
  for (const r of rows) {
    const k = channelOf(r.channel);
    const m = merged.get(k) ?? { leads: 0, replied: 0, medians: [] };
    m.leads += r.leads; m.replied += r.replied;
    if (r.medianMinutes !== null && r.replied > 0) m.medians.push([r.medianMinutes, r.replied]);
    merged.set(k, m);
  }
  const total = [...merged.values()].reduce((s, m) => s + m.leads, 0);
  const out = [...merged].map(([channel, m]) => {
    const w = m.medians.reduce((s, [, n]) => s + n, 0);
    const med = w ? Math.round(m.medians.reduce((s, [v, n]) => s + v * n, 0) / w) : null;
    return { channel, leads: m.leads, sharePct: total ? Math.round((m.leads / total) * 100) : 0, replied: m.replied, medianMinutes: med };
  }).sort((a, b) => b.leads - a.leads || a.channel.localeCompare(b.channel));
  const eligible = out.filter((r) => r.replied >= 10 && r.medianMinutes !== null).sort((a, b) => (a.medianMinutes as number) - (b.medianMinutes as number));
  return { rows: out, fastest: eligible.length >= 2 ? eligible[0].channel : null, total };
}

// ---------------------------------------------------------------- D6. Tamper-evident reply-time page

/** JSON with sorted keys, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const GENESIS_HASH = "0".repeat(64);
export const payloadHash = (payload: unknown) => sha256(canonicalJson(payload));
/** Links this page to the one before it: change either page afterwards and the chain no longer matches. */
export const chainHash = (prevHash: string, pHash: string, createdAtIso: string) => sha256(`${prevHash}|${pHash}|${createdAtIso}`);
export const signHash = (hash: string, secret: string) => createHmac("sha256", secret).update(hash).digest("hex");

export type StoredPage = { payload: unknown; payloadHash: string; prevHash: string; chainHash: string; createdAtIso: string; signature: string | null };
export type Verification = { ok: boolean; contentUnchanged: boolean; linkIntact: boolean; signed: boolean };
/** Checks one stored page. `previousChainHash` is the chain hash of the page before it (null for the first page). */
export function verifyPage(p: StoredPage, previousChainHash: string | null, secret: string | null): Verification {
  const contentUnchanged = payloadHash(p.payload) === p.payloadHash && chainHash(p.prevHash, p.payloadHash, p.createdAtIso) === p.chainHash;
  const linkIntact = previousChainHash === null ? p.prevHash === GENESIS_HASH : p.prevHash === previousChainHash;
  const signed = Boolean(p.signature && secret && signHash(p.chainHash, secret) === p.signature);
  return { ok: contentUnchanged && linkIntact, contentUnchanged, linkIntact, signed };
}

export type ProofPayload = {
  kind: "reply_time_proof";
  brand: { name: string; color: string | null; logoUrl: string | null };
  account: string;
  periodFrom: string; periodTo: string;
  leads: number; answered: number; neverAnswered: number;
  medianMinutes: number | null; p90Minutes: number | null; withinTargetPct: number | null; targetMinutes: number;
  clock: "working hours" | "every hour";
  measuredAt: string;
  method: string;
};
export const PROOF_METHOD = "Measured from the account's own conversation records: the time from a new lead arriving to the first reply from a person. Not typed in by anyone. Automatic replies are not counted.";
export const PROOF_NOTE = "This page reports what was measured in the period shown. It is not a promise about future reply times.";
export const MIN_PROOF_LEADS = 20;

const VENDOR = /gohighlevel|go high level|highlevel|\bghl\b|sub-?account|leadconnector/i;
const PROMISE = /guarantee|warrant|assure|promise to/i;
/** A page's text must have no vendor word and no promise. The test and the page builder both call this. */
export function proofTextProblems(text: string): string[] {
  const out: string[] = [];
  if (VENDOR.test(text)) out.push("vendor word");
  if (PROMISE.test(text.replace(PROOF_NOTE, ""))) out.push("promise wording");
  return out;
}

// ---------------------------------------------------------------- E3. Weekly proof receipt and the morning line

export function weeklyProofText(account: string, r: Receipt): string {
  const base = `${account}: ${receiptLine(r)}`;
  const risk = r.atRisk.ok && r.lateLeads ? ` ${r.lateLeads} lead${r.lateLeads === 1 ? "" : "s"} waited past the target; estimated ${rangeText(r.atRisk)} at risk.` : "";
  return base + risk;
}
export function morningProofLine(r: Pick<Receipt, "alerts" | "saved" | "medianReplyMinutes">): string | null {
  if (!r.alerts) return null;
  return `Last week: ${r.saved} of ${r.alerts} alerted lead${r.alerts === 1 ? "" : "s"} got a reply${r.medianReplyMinutes !== null ? `, typically within ${durationText(r.medianReplyMinutes)}` : ""}.`;
}

// ---------------------------------------------------------------- calendar helpers shared by the cron and the routes

/** The Monday (UTC) of the week containing `now`, as YYYY-MM-DD: the dedupe week of the weekly proof. */
export function mondayOf(now: number): string {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}
/** The weekly proof is written on Monday between 08:00 and 09:59 UTC; the hourly run plus the dedupe key make it once. */
export const weeklyDue = (now: number) => { const d = new Date(now); return d.getUTCDay() === 1 && d.getUTCHours() >= 8 && d.getUTCHours() < 10; };

/** A month as [from, to) in UTC: `YYYY-MM`, default the last full month. Null for a bad or future month. */
export function monthWindow(raw: string | null, now = Date.now()): { from: Date; to: Date } | null {
  if (raw === null || raw === "") {
    const d = new Date(now);
    return { from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), to: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) };
  }
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (!m) return null;
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  if (from.getTime() > now) return null;
  return { from, to: new Date(Date.UTC(Number(m[1]), Number(m[2]), 1)) };
}
