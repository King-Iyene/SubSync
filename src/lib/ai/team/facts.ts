import { changeOf, fmtInt, fmtMinutes, fmtMoney, fmtPct, longDay, monthName, type PrPayload } from "../../analytics/proof-core";

// The input builders for the team and client AI jobs. Pure: no database, no network. Each builds the exact text sent to the model from figures our own queries already worked out, and lists in
// plain words which fields were sent (shown to the customer as "What was sent to your AI"). Every figure the model may quote is written here exactly as it should appear; the number guard
// (safety.ts) throws away any answer with a figure that is not in this text. Names, emails, phones and message text are never added except in the meeting job, and only after the opt-in.

export type Facts = { text: string; fields: string[]; includesNames: boolean };

export const TONES = ["plain", "warm", "formal"] as const;
export type Tone = (typeof TONES)[number];
export const isTone = (v: unknown): v is Tone => (TONES as readonly unknown[]).includes(v);
export const TONE_LABEL: Record<Tone, string> = { plain: "Plain and direct", warm: "Warm and friendly", formal: "Professional" };
const TONE_LINE: Record<Tone, string> = {
  plain: "Tone: plain and direct, short sentences.",
  warm: "Tone: warm and friendly, like a trusted partner, still brief.",
  formal: "Tone: professional and measured.",
};
export const toneLine = (t: Tone) => TONE_LINE[t];

// ---------------------------------------------------------------- 1. monthly client report

/** True when the month holds enough measured figures to write a fair summary. */
export function summaryReady(p: PrPayload): boolean {
  return (p.leads.current ?? 0) > 0 || (p.booked.current ?? 0) > 0 || (p.won.deals.current ?? 0) > 0 || (p.caught.found ?? 0) > 0;
}

export function reportFacts(p: PrPayload, tone: Tone): Facts {
  const pl = monthName(p.prevLabel);
  const m = (label: string, v: number | null, fmt: (n: number) => string, c: ReturnType<typeof changeOf>) => (v === null ? null : `- ${label}: ${fmt(v)}${c ? ` (${c.text})` : ""}`);
  const rows = [
    m("New leads", p.leads.current, fmtInt, changeOf("count", p.leads.current, p.leads.previous, pl)),
    p.replyMedian.current === null ? "- Reply times: not measured this month (too few new leads to be fair)" : m("Typical first reply from a person", p.replyMedian.current, fmtMinutes, changeOf("minutes", p.replyMedian.current, p.replyMedian.previous, pl, "down")),
    m(`New leads answered by a person within ${fmtMinutes(p.targetMinutes)}`, p.withinTarget.current, fmtPct, changeOf("pct", p.withinTarget.current, p.withinTarget.previous, pl)),
    m("New leads nobody answered", p.neverAnswered, fmtInt, null),
    m("Quiet leads won back after being flagged", p.recovered.current, fmtInt, changeOf("count", p.recovered.current, p.recovered.previous, pl)),
    m("Appointments booked", p.booked.current, fmtInt, changeOf("count", p.booked.current, p.booked.previous, pl)),
    m("Appointments attended", p.showed.current, fmtInt, changeOf("count", p.showed.current, p.showed.previous, pl)),
    m("No-show rate", p.noShowRate.current, fmtPct, changeOf("pct", p.noShowRate.current, p.noShowRate.previous, pl, "down")),
    m("Deals that moved forward", p.moved.deals.current, fmtInt, changeOf("count", p.moved.deals.current, p.moved.deals.previous, pl)),
    m("Recorded value of deals that moved forward", p.moved.value.current, fmtMoney, null),
    m("Deals won", p.won.deals.current, fmtInt, changeOf("count", p.won.deals.current, p.won.deals.previous, pl)),
    m("Recorded value of deals won", p.won.value.current, fmtMoney, changeOf("money", p.won.value.current, p.won.value.previous, pl)),
    p.caught.found === null ? null : `- Problems caught by our daily checks: ${fmtInt(p.caught.found)}; cleared: ${fmtInt(p.caught.fixed ?? 0)}; still open: ${fmtInt(p.caught.stillOpen ?? 0)}${p.caught.typicalFixMinutes ? `; typical time to clear: ${fmtMinutes(p.caught.typicalFixMinutes)}` : ""}`,
  ].filter((r): r is string => r !== null);
  const timeline = p.timeline.slice(0, 6).map((t) => `- ${t.text}`);
  const text = [
    toneLine(tone),
    `Period: ${p.label}${p.partial ? ` (part of the month, up to ${longDay(p.to)})` : ""}. Compared with ${p.prevLabel}.`,
    "Figures for the month:", ...rows,
    ...(timeline.length ? ["What was done for the client:", ...timeline] : []),
  ].join("\n");
  return { text, fields: ["the month's measured figures for this one client account and how they compare with the month before", "the problems caught and cleared", "a short timeline of what was done", "your tone choice"], includesNames: false };
}

export type SummaryJson = { whatHappened: string; caughtAndFixed: string; wins: string[]; nextMonth: string[] };
export const SUMMARY_MAX = 2500;

/** The saved, editable text of a summary: short headed paragraphs. Plain text, so the agency edits, copies and prints exactly what it sees. */
export function summaryText(j: SummaryJson): string {
  const out = [`What happened\n${j.whatHappened.trim()}`];
  if (j.caughtAndFixed.trim()) out.push(`What we caught and fixed\n${j.caughtAndFixed.trim()}`);
  if (j.wins.length) out.push(`Wins\n${j.wins.map((w) => `- ${w.trim()}`).join("\n")}`);
  if (j.nextMonth.length) out.push(`Next month\n${j.nextMonth.map((w) => `- ${w.trim()}`).join("\n")}`);
  return out.join("\n\n").slice(0, SUMMARY_MAX);
}

// ---------------------------------------------------------------- 2. lead stories

export type Journey = {
  contactId: string; name: string | null; arrivedAt: number; arrivedOn: string; source: string | null;
  firstReplyMinutes: number | null; replyBy: "person" | "automatic" | null; inTarget: boolean | null;
  bookings: number; apptStatus: string | null; deal: "won" | "lost" | "open" | null;
};

/** "Tue 4 Nov" in the account's own time zone (UTC when it has none or the zone is not known). */
export function dayLabel(ms: number, tz: string | null): string {
  const fmt = (zone: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(new Date(ms)).replace(",", "");
  try { return fmt(tz ?? "UTC"); } catch { return fmt("UTC"); }
}

const apptWords = (j: Journey): string => {
  if (j.bookings <= 0) return "no appointment booked";
  const n = `${j.bookings} appointment${j.bookings === 1 ? "" : "s"} booked`;
  const s = (j.apptStatus ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "showed" || s === "completed") return `${n}, they came`;
  if (s === "noshow") return `${n}, they did not come`;
  if (s === "cancelled" || s === "canceled") return `${n}, it was cancelled`;
  return `${n}, still to happen or no outcome recorded`;
};
/** The recorded facts of one lead as short plain clauses. Used for the model's input and for the sentence shown when there is no AI. */
export function journeyParts(j: Journey, targetMinutes: number): string[] {
  const reply = j.firstReplyMinutes === null ? "no reply recorded"
    : `first reply by ${j.replyBy === "automatic" ? "an automatic message" : "a person"} after ${fmtMinutes(j.firstReplyMinutes)}${j.inTarget === null ? "" : j.inTarget ? ` (inside the ${fmtMinutes(targetMinutes)} target)` : ` (slower than the ${fmtMinutes(targetMinutes)} target)`}`;
  return [`arrived ${j.arrivedOn}${j.source ? ` from ${j.source}` : ""}`, reply, apptWords(j), ...(j.deal === "won" ? ["a deal was won"] : j.deal === "lost" ? ["the deal was lost"] : j.deal === "open" ? ["a deal is open"] : [])];
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The plain sentence made by code. Shown when AI is off or its answer was not used, so the page always works. */
export const fallbackLine = (j: Journey, targetMinutes: number) => `${cap(journeyParts(j, targetMinutes).join("; "))}.`;
export const aliasOf = (i: number) => `L${i + 1}`;
export const MAX_STORIES = 25;

export function leadFacts(js: readonly Journey[], targetMinutes: number, tone: Tone): Facts {
  const rows = js.slice(0, MAX_STORIES).map((j, i) => `${aliasOf(i)}: ${journeyParts(j, targetMinutes).join("; ")}`);
  return { text: [toneLine(tone), `Reply target: ${fmtMinutes(targetMinutes)}`, "Leads:", ...rows].join("\n"), fields: ["for each lead: the day it arrived, its source, how fast a person replied, bookings and outcome (leads are labelled L1, L2 and so on; no names, emails or phone numbers are sent)", "your tone choice"], includesNames: false };
}

// ---------------------------------------------------------------- 3. coaching notes

export const COACH_DAYS = 30;
export const MIN_FIRST_REPLIES = 10;
export const MIN_PEERS = 3;
export type PersonNums = { firstReplies: number; replyMinutes: number | null; inTimePct: number | null; showPct: number | null; apptsSet: number; outcomesMarked: number; touches: number; days: number };
export type TeamMiddle = { people: number; replyMinutes: number | null; inTimePct: number | null; showPct: number | null; apptsSet: number | null; touches: number | null };

export const coachReady = (n: PersonNums) => n.firstReplies >= MIN_FIRST_REPLIES;

export function coachFacts(n: PersonNums, team: TeamMiddle | null, targetMinutes: number, tone: Tone): Facts {
  const t = team && team.people >= MIN_PEERS ? team : null;
  const row = (label: string, v: number | null, mid: number | null | undefined, fmt: (x: number) => string) => (v === null ? null : `- ${label}: ${fmt(v)}${t && mid !== null && mid !== undefined ? ` (the middle figure of their own team: ${fmt(mid)})` : ""}`);
  const rows = [
    `- First replies by this person: ${fmtInt(n.firstReplies)}`,
    row("Typical first reply", n.replyMinutes, t?.replyMinutes, fmtMinutes),
    row(`First replies inside ${fmtMinutes(targetMinutes)}`, n.inTimePct, t?.inTimePct, fmtPct),
    row("Share of their appointments that were attended", n.showPct, t?.showPct, fmtPct),
    row("Appointments set", n.apptsSet, t?.apptsSet, fmtInt),
    `- Appointments with an outcome marked: ${fmtInt(n.outcomesMarked)}`,
    row("Messages and calls sent", n.touches, t?.touches, fmtInt),
  ].filter((r): r is string => r !== null);
  const text = [toneLine(tone), `Period: the last ${n.days} days`, t ? `Team comparison: the middle figure of the ${t.people} people on their own team with enough data` : "Team comparison: not available (too few people with enough data), so do not compare", "Figures:", ...rows].join("\n");
  return { text, fields: ["this one person's counts and rates for the last 30 days, with the middle figure of their own team (no name, no ranking, no one else's figures)", "your tone choice"], includesNames: false };
}

const SHAME = /\b(worst|lazy|laziest|bottom|ranked|ranking|failing|failure|underperform\w*|poor performer|slacking|behind everyone|better than|worse than)\b/i;
/** Coaching wording must never rank or shame. Returns the reason an answer is refused, or null. */
export const shameProblem = (text: string): string | null => (SHAME.test(text) ? "The note ranked or judged the person, so it was not shown." : null);

// ---------------------------------------------------------------- 4. anomalies

export type AnomalyKey = "leads" | "reply" | "in_time" | "show";
export type Anomaly = { key: AnomalyKey; label: string; direction: "above" | "below"; current: number; usual: number; unit: "count" | "minutes" | "pct"; relativePct: number };
const fmtUnit = (v: number, u: Anomaly["unit"]) => (u === "minutes" ? fmtMinutes(v) : u === "pct" ? fmtPct(v) : fmtInt(v));
export const anomalyValues = (a: Anomaly) => ({ now: fmtUnit(a.current, a.unit), usual: fmtUnit(a.usual, a.unit) });

export function anomalyFacts(a: Anomaly, context: readonly string[], tone: Tone): Facts {
  const v = anomalyValues(a);
  const text = [toneLine(tone), `What moved: ${a.label}`, `Last seven days: ${v.now}`, `Usual (the average of the four weeks before): ${v.usual}`, `Direction: ${a.direction === "above" ? "higher" : "lower"} than usual`, "Context facts:", ...context.map((c) => `- ${c}`)].join("\n");
  return { text, fields: ["which number moved, its value now and its usual value", "a few context counts for this one client account (leads by source, people replying, missed calls, no-shows)", "your tone choice"], includesNames: false };
}

// ---------------------------------------------------------------- 5. meeting

export function meetingFacts(m: { summary: string | null; actionItems: readonly string[] }, tone: Tone): Facts {
  const items = m.actionItems.slice(0, 8).map((x) => `- ${x.slice(0, 200)}`);
  const text = [toneLine(tone), "Call summary written by the meeting tool:", (m.summary ?? "").slice(0, 2500) || "(none)", ...(items.length ? ["Action items:", ...items] : [])].join("\n");
  return { text, fields: ["the summary text your meeting tool wrote for this call (may contain names)", "its action items", "your tone choice"], includesNames: true };
}

// ---------------------------------------------------------------- 6. one thing to fix

export type CandidateKey = "stale_deals" | "never_answered" | "no_shows" | "unmarked";
export type Candidate = { key: CandidateKey; count: number; dollars: number | null; text: string };
const URGENCY: Record<CandidateKey, number> = { never_answered: 4, no_shows: 3, stale_deals: 2, unmarked: 1 };
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** The plain sentence for one item, with its count. Built here so the model never has to count. */
export function candidateText(key: CandidateKey, count: number): string {
  switch (key) {
    case "never_answered": return `${plural(count, "new lead has", "new leads have")} never had a reply from a person`;
    case "no_shows": return `${plural(count, "no-show is", "no-shows are")} still waiting to be won back`;
    case "stale_deals": return `${plural(count, "open deal has", "open deals have")} not moved for longer than usual for its step`;
    case "unmarked": return `${plural(count, "past appointment has", "past appointments have")} no outcome recorded, so the show rate is understated`;
  }
}
/** Money first (the recorded dollar value behind an item), then the fixed urgency order. Returns null when there is nothing to fix. */
export function pickOneThing(cands: readonly Candidate[]): { top: Candidate; others: Candidate[] } | null {
  const live = cands.filter((c) => c.count > 0).sort((a, b) => (b.dollars ?? 0) - (a.dollars ?? 0) || URGENCY[b.key] - URGENCY[a.key]);
  return live.length ? { top: live[0], others: live.slice(1, 4) } : null;
}
export function oneThingFacts(top: Candidate, others: readonly Candidate[], tone: Tone): Facts {
  const text = [toneLine(tone), `Top item: ${top.text}`, ...(top.dollars !== null && top.dollars > 0 ? [`Recorded value of those deals: ${fmtMoney(top.dollars)}`] : []), ...(others.length ? ["Other items for context only:", ...others.map((o) => `- ${o.text}`)] : [])].join("\n");
  return { text, fields: ["the top item for this one client account with its count and any dollar value", "up to three other items", "your tone choice"], includesNames: false };
}
