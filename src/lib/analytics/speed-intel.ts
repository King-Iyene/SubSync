// Speed to lead: how long a new lead waits for the first human reply. Pure (no database, no network), so
// it is unit tested. The definition lives in docs/METRICS.md and this file is its only implementation.
//
// A lead is a new contact that has a conversation. Its start is the earlier of the contact being created
// and its first inbound message. Its first touch is the first outbound message that a person sent from the
// app (an outbound message with a user and the source "app"). Messages from workflows, campaigns, bulk
// actions or the API are automation and do not count unless the account chose to count them.
//
// SubSync MEASURES replies; it never sends one. The automatic first message (a workflow's instant text) is recorded separately from the person's
// reply, because the gap between the two ("answered by a robot in 10 seconds, by a person after 3 hours") is the real finding (N78).

import { isInternalComment } from "./message-kinds.ts";

export type Msg = { at: number; direction: "inbound" | "outbound" | null; userId: string | null; source: string | null; type: string | null; id?: string | null; status?: string | null };

const str = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// One message from the platform's list, or null if it has no usable time.
export function mapMessage(raw: unknown): Msg | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = o.dateAdded ?? o.createdAt ?? o.date;
  const at = typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : typeof t === "string" ? Date.parse(t) : NaN;
  if (!Number.isFinite(at)) return null;
  const d = str(o.direction)?.toLowerCase();
  return { at, direction: d === "inbound" || d === "outbound" ? d : null, userId: str(o.userId), source: str(o.source)?.toLowerCase() ?? null, type: str(o.messageType ?? o.type), id: str(o.id, 80), status: str(o.status)?.toLowerCase() ?? null };
}

// A phone call a person placed from the platform is a touch too (the platform records calls as messages of type TYPE_CALL), whether or
// not it was picked up: the lead was reached for, which is what the clock measures. Calls with no person attached are automation.
export const isCall = (m: Pick<Msg, "type">) => /call/i.test(m.type ?? "");

export function isHumanTouch(m: Msg, countAutomated: boolean): boolean {
  // An internal comment is an outbound message that never reaches the customer (SubSync writes some itself). It is never a touch, whatever the setting.
  if (isInternalComment(m.type)) return false;
  if (m.direction !== "outbound") return false;
  if (countAutomated) return true;
  return m.userId !== null && (m.source === "app" || isCall(m));
}

export type Lead = { leadAt: number; touchAt: number | null; touchUserId: string | null };

// Null when there is nothing to measure (no contact time and no messages).
export function leadFromMessages(msgs: Msg[], contactCreatedAt: number | null, countAutomated = false): Lead | null {
  const sorted = [...msgs].sort((a, b) => a.at - b.at);
  const firstInbound = sorted.find((m) => m.direction === "inbound")?.at ?? null;
  const starts = [contactCreatedAt, firstInbound].filter((x): x is number => x !== null && Number.isFinite(x));
  if (starts.length === 0) return null;
  const leadAt = Math.min(...starts);
  const touch = sorted.find((m) => m.at >= leadAt && isHumanTouch(m, countAutomated));
  return { leadAt, touchAt: touch?.at ?? null, touchUserId: touch?.userId ?? null };
}

// The first automatic message and the first person's reply, kept apart whatever the account's setting says (N78). Automatic means an outbound
// message that is not a person's (a workflow, a campaign, a bulk action, the API, or a call with nobody attached).
export type FirstTouches = { autoAt: number | null; humanAt: number | null; humanUserId: string | null };
export function firstTouches(msgs: Msg[], leadAt: number): FirstTouches {
  const sorted = [...msgs].sort((a, b) => a.at - b.at);
  const after = sorted.filter((m) => m.at >= leadAt && m.direction === "outbound");
  const human = after.find((m) => isHumanTouch(m, false));
  const auto = after.find((m) => !isHumanTouch(m, false));
  return { autoAt: auto?.at ?? null, humanAt: human?.at ?? null, humanUserId: human?.userId ?? null };
}

export const responseSeconds = (l: Pick<Lead, "leadAt" | "touchAt">): number | null => (l.touchAt === null ? null : Math.max(0, Math.round((l.touchAt - l.leadAt) / 1000)));

export type TouchRow = {
  locationId: string; contactId: string; leadAt: number; touchAt: number | null; userId: string | null; source?: string | null; assigned?: boolean;
  /** Tags on the contact (used only to recognise a Facebook or Instagram lead form when the source field is empty). */
  tags?: string[];
  /** When the first automatic message went out, and when the first person replied, kept apart from touchAt. `detailed` is false for rows read before this was recorded. */
  autoAt?: number | null; humanAt?: number | null; detailed?: boolean;
  /** This account's own reply target when it set one. Every figure and list judges the lead against it; without one the default target passed in is used. */
  targetMinutes?: number | null;
};

// Where a lead came from decides how fast it must be answered. Portal and phone leads go cold in minutes, web forms a little
// slower, social messages slower still. The windows are common practice in real estate and are shown as targets, not facts.
// Week by week: how many leads, and what share was answered inside the target. Facts only: it shows whether the team is getting
// faster, and says nothing about why. A week with fewer than 5 judged leads shows no percentage rather than a noisy one.
export type TrendWeek = { weekStart: number; leads: number; withinTarget: number; hitRate: number | null };
const WEEK_MS = 7 * 86_400_000;
// The leads that came in during week `i` (0 is the latest) and were judged: answered inside the target, answered late, or still waiting past it. This is
// the ONE place a week's leads are chosen, used by the bar (weeklyTrend) and by the list behind the bar (weekMembers), so the count on the chart is the
// number of rows in the list by construction (KF-6), and a test checks it.
export type Judged = "within" | "late" | "waiting";

// The one place a single lead is judged against a target: answered inside it, answered after it, still waiting past it, or not judged yet (still inside
// its window, so it counts neither way). Every figure and every list behind a figure uses this.
export function judge(r: Pick<TouchRow, "leadAt" | "touchAt" | "targetMinutes">, targetMinutes: number, now: number): Judged | null {
  const s = responseSeconds(r);
  const target = (r.targetMinutes ?? targetMinutes) * 60;
  if (s !== null) return s <= target ? "within" : "late";
  return (now - r.leadAt) / 1000 > target ? "waiting" : null;
}

export function judgedInWeek(rows: TouchRow[], targetMinutes: number, now: number, i: number): Array<{ row: TouchRow; status: Judged }> {
  const end = now - i * WEEK_MS, start = end - WEEK_MS;
  const out: Array<{ row: TouchRow; status: Judged }> = [];
  for (const r of rows) {
    if (!(r.leadAt > start && r.leadAt <= end)) continue;
    const status = judge(r, targetMinutes, now);
    if (status) out.push({ row: r, status });
  }
  return out;
}

export function weeklyTrend(rows: TouchRow[], targetMinutes: number, now: number, weeks = 8): TrendWeek[] {
  const out: TrendWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const judged = judgedInWeek(rows, targetMinutes, now, i);
    const within = judged.filter((j) => j.status === "within").length;
    out.push({ weekStart: now - (i + 1) * WEEK_MS, leads: judged.length, withinTarget: within, hitRate: judged.length >= 5 ? within / judged.length : null });
  }
  return out;
}

// The leads behind a week's bar, the ones that need attention first (waiting, then late, then in time), newest first inside each. Capped; the caller
// says how many were left out.
const ORDER: Record<Judged, number> = { waiting: 0, late: 1, within: 2 };
export function weekMembers(rows: TouchRow[], targetMinutes: number, now: number, i: number, cap = 60): Array<{ row: TouchRow; status: Judged }> {
  return judgedInWeek(rows, targetMinutes, now, i).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.row.leadAt - a.row.leadAt).slice(0, cap);
}

// The leads behind ANY figure on the screen (KF-6): the judged leads that pass `keep`, the ones that need attention first, longest wait first inside
// "waiting", newest first elsewhere. `count` is the true number; `rows` is capped, and the screen says how many were left out. The figures
// (summarise) and these lists both start from judge(), so a count and its list cannot disagree.
export function membersOf(rows: TouchRow[], targetMinutes: number, now: number, keep: (r: TouchRow, status: Judged) => boolean, cap = 100): { count: number; rows: Array<{ row: TouchRow; status: Judged }> } {
  const all: Array<{ row: TouchRow; status: Judged }> = [];
  for (const r of rows) {
    const status = judge(r, targetMinutes, now);
    if (status && keep(r, status)) all.push({ row: r, status });
  }
  all.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === "waiting" ? a.row.leadAt - b.row.leadAt : b.row.leadAt - a.row.leadAt));
  return { count: all.length, rows: all.slice(0, cap) };
}

// A lead nobody has answered for this long is not "waiting" any more: it was missed. Showing it as waiting makes the screen
// look broken, and hides the real message ("these were never answered").
export const NEVER_ANSWERED_MINUTES = 3 * 24 * 60;
export const isNeverAnswered = (waitingMinutes: number) => waitingMinutes > NEVER_ANSWERED_MINUTES;

// "meta" is a lead who filled in a Facebook or Instagram lead form: they asked for contact, so they are timed like a web form but
// tighter, because the form is one tap. "social" is a person who messaged first (direct message, Messenger, WhatsApp).
export type SourceClass = "portal" | "meta" | "form" | "social" | "other";
export const SOURCE_TARGET_MINUTES: Record<Exclude<SourceClass, "other">, number> = { portal: 5, meta: 10, form: 15, social: 60 };

// A Facebook or Instagram lead form leaves no single mark in the CRM: the source field may say "Facebook", "Facebook Lead Form" or "Instagram", and a
// workflow often adds a tag such as "fb lead". When the source field says nothing useful, a tag of that kind is read the same way. A tag alone never
// overrides a source that names something else (a "Zillow" lead tagged "facebook" stays a portal lead).
const META_TAG = /\b(facebook|instagram|fb|ig|meta)\b.*\b(lead|form|ad|ads|instant)\b|\b(lead|form|ad|ads|instant)\b.*\b(facebook|instagram|fb|ig|meta)\b/i;
export function classifySource(source: string | null | undefined, tags?: readonly string[] | null): SourceClass {
  const s = (source ?? "").toLowerCase();
  if (/zillow|realtor|trulia|redfin|homes\.com|rightmove|zoopla|portal|open house|call|phone|sign/.test(s)) return "portal";
  // Order matters: a message to a page ("Instagram DM") is social, a Facebook or Instagram form is meta, and only then is a plain
  // form a web form ("Facebook Lead Form" must not be filed as a web form).
  if (/\b(dm|dms|messenger|whatsapp|tiktok|linkedin|direct message|social)\b/.test(s)) return "social";
  if (/facebook|instagram|\bfb\b|\big\b|\bmeta\b|lead ad/.test(s)) return "meta";
  if (/form|website|web|landing|funnel|ppc|google|chat|widget|email/.test(s)) return "form";
  if (s.trim() === "" && (tags ?? []).some((t) => META_TAG.test(t))) return "meta";
  return "other";
}

export const SOURCE_CLASS_LABEL: Record<SourceClass, string> = { portal: "Portals and phone", meta: "Facebook and Instagram lead forms", form: "Web forms and chat", social: "Social messages", other: "Other sources" };

// What a person reads for one raw source value: the text as typed, in proper case when it was all lower case, or "No source recorded" when it is blank.
export const NO_SOURCE = "No source recorded";
export function sourceLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (t === "") return NO_SOURCE;
  return /[a-z]/.test(t) && !/[A-Z]/.test(t) ? t.split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ") : t;
}
export const hasNoSource = (r: Pick<TouchRow, "source">) => sourceLabel(r.source) === NO_SOURCE;

// How many leads have no source at all. Past a third, the by-source table says little, so the screen turns it into an action (N47: "99% Unknown").
export const UNKNOWN_SOURCE_ACTION_SHARE = 0.34;
export function unknownSource(rows: TouchRow[]): { n: number; total: number; share: number | null; actionable: boolean } {
  const total = rows.length;
  const n = rows.filter(hasNoSource).length;
  const share = total === 0 ? null : n / total;
  return { n, total, share, actionable: share !== null && total >= 5 && share >= UNKNOWN_SOURCE_ACTION_SHARE };
}

// The most common raw source values inside one class, so "Other sources" says what they are ("Referral 3, Walk-in 2") and not just "other".
export function topSourceNames(rows: TouchRow[], limit = 3): Array<{ label: string; n: number }> {
  const by = new Map<string, number>();
  for (const r of rows) { const k = sourceLabel(r.source); by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, limit);
}

// Reply speed per source class, each judged against its own target (other leads use the account target).
export function bySource(rows: TouchRow[], accountTarget: number, now: number): Array<{ cls: SourceClass; targetMinutes: number; names: Array<{ label: string; n: number }> } & Summary> {
  const out: Array<{ cls: SourceClass; targetMinutes: number; names: Array<{ label: string; n: number }> } & Summary> = [];
  for (const cls of ["portal", "meta", "form", "social", "other"] as SourceClass[]) {
    // A source is judged against its own target, so an account's own reply target must not override it here.
    const mine = rows.filter((r) => classifySource(r.source, r.tags) === cls).map((r) => (cls === "other" ? r : { ...r, targetMinutes: null }));
    if (mine.length === 0) continue;
    const targetMinutes = cls === "other" ? accountTarget : SOURCE_TARGET_MINUTES[cls];
    out.push({ cls, targetMinutes, names: topSourceNames(mine), ...summarise(mine, targetMinutes, now) });
  }
  return out;
}

export const MIN_FOR_MEDIAN = 5;
export const MIN_PER_PERSON = 3;

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

export type Summary = {
  leads: number; answered: number; withinTarget: number; answeredLate: number; stillWaiting: number;
  /** Share of leads that got a reply inside the target, counting those still waiting past it as misses. */
  hitRate: number | null; medianSeconds: number | null; p90Seconds: number | null;
};

// Leads that are still inside their target window are not counted either way yet.
export function summarise(rows: TouchRow[], targetMinutes: number, now: number): Summary {
  let withinTarget = 0, answeredLate = 0, stillWaiting = 0, pending = 0;
  const times: number[] = [];
  for (const r of rows) {
    const s = responseSeconds(r);
    if (s !== null) times.push(s);
    const j = judge(r, targetMinutes, now);
    if (j === "within") withinTarget += 1; else if (j === "late") answeredLate += 1; else if (j === "waiting") stillWaiting += 1; else pending += 1;
  }
  const judged = withinTarget + answeredLate + stillWaiting;
  times.sort((a, b) => a - b);
  return {
    leads: rows.length - pending, answered: times.length, withinTarget, answeredLate, stillWaiting,
    hitRate: judged >= MIN_FOR_MEDIAN ? withinTarget / judged : null,
    medianSeconds: times.length >= MIN_FOR_MEDIAN ? percentile(times, 0.5) : null,
    p90Seconds: times.length >= MIN_FOR_MEDIAN ? percentile(times, 0.9) : null,
  };
}

// "1 of 5 so far": how far a figure is from its minimum, in words that say what to wait for (N22). `have` of `need` and the noun that is being counted.
export type Progress = { have: number; need: number; met: boolean; text: string };
export function progressToward(have: number, need: number, noun: string): Progress {
  const met = have >= need;
  return { have, need, met, text: met ? `${have} ${noun}` : `${have} of ${need} ${noun} so far. Shows once there are ${need}.` };
}

export type Person = { userId: string; replies: number; medianSeconds: number | null; ranked: boolean };

// Everyone who sent a first reply, with how many: people with enough replies are ranked by their typical reply time fastest first, the rest are listed
// after them with their count so the screen can say "2 of 3 replies so far" instead of an empty box.
export function peopleProgress(rows: TouchRow[]): Person[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const s = responseSeconds(r);
    if (s === null || !r.userId) continue;
    by.set(r.userId, [...(by.get(r.userId) ?? []), s]);
  }
  const all = [...by.entries()].map(([userId, t]) => {
    const ranked = t.length >= MIN_PER_PERSON;
    return { userId, replies: t.length, medianSeconds: ranked ? percentile([...t].sort((a, b) => a - b), 0.5) : null, ranked };
  });
  return all.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (a.medianSeconds ?? 0) - (b.medianSeconds ?? 0) || b.replies - a.replies);
}

// Who answers fastest. Only people with enough replies are ranked, so one lucky reply is not a ranking.
export function rankPeople(rows: TouchRow[]): Array<{ userId: string; replies: number; medianSeconds: number }> {
  return peopleProgress(rows).filter((p) => p.ranked).map((p) => ({ userId: p.userId, replies: p.replies, medianSeconds: p.medianSeconds as number }));
}

// The automatic first message against the person's reply (N78). Only leads read since this was recorded are used (`detailed`); the others are counted as
// "not read yet" so nothing is guessed. A lead that only an automatic message has answered, and that is past its target, is the real finding: it looks
// answered in the CRM, and no person has replied.
export type AutoVsHuman = {
  read: number; notRead: number;
  /** Leads that got an automatic message. */
  autoSent: number;
  /** Of those, how many a person also replied to, and how many still only have the automatic message past the target. */
  alsoPerson: number; onlyAutoPastTarget: number;
  /** Leads a person replied to with no automatic message first. */
  personOnly: number;
  autoMedianSeconds: number | null; personMedianSeconds: number | null;
};
export function autoVsHuman(rows: TouchRow[], targetMinutes: number, now: number): AutoVsHuman {
  const read = rows.filter((r) => r.detailed === true);
  const auto = read.filter((r) => r.autoAt != null);
  const gap = (r: TouchRow, at: number | null | undefined) => (at == null ? null : Math.max(0, Math.round((at - r.leadAt) / 1000)));
  const autoTimes = auto.map((r) => gap(r, r.autoAt) as number).sort((a, b) => a - b);
  const personTimes = read.map((r) => gap(r, r.humanAt)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return {
    read: read.length, notRead: rows.length - read.length,
    autoSent: auto.length,
    alsoPerson: auto.filter((r) => r.humanAt != null).length,
    onlyAutoPastTarget: auto.filter((r) => r.humanAt == null && (now - r.leadAt) / 60_000 > (r.targetMinutes ?? targetMinutes)).length,
    personOnly: read.filter((r) => r.autoAt == null && r.humanAt != null).length,
    autoMedianSeconds: autoTimes.length >= MIN_FOR_MEDIAN ? percentile(autoTimes, 0.5) : null,
    personMedianSeconds: personTimes.length >= MIN_FOR_MEDIAN ? percentile(personTimes, 0.5) : null,
  };
}

// A time in the words a person would say: "45 sec", "5 min", "1 h 10 min", "13 days", "1 day 3 h". Null reads "n/a" (not "none": nothing is missing, there is nothing to show yet).
export function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "n/a";
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  const day = `${d} ${d === 1 ? "day" : "days"}`;
  return h % 24 === 0 ? day : `${day} ${h % 24} h`;
}
