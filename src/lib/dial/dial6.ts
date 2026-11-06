// Call mode v2 (stage SPEED6): the pure rules for redial cadence, lead-local call windows, best time to call, the heat score, custom dispositions, booking-link texts, power hours and the
// setter board. No database, no network, no model call: everything is unit tested (src/lib/__tests__/dial6.test.ts). SubSync still places no call; it orders, shows and records.
import { OUTCOMES, rankScore, type DialOutcome } from "./dial.ts";

const H = 3_600_000;

// ---------------------------------------------------------------- redial cadence ("touch 2 of 4")
export type Cadence = { maxAttempts: number; redialAfterHours: number; nextDay: boolean };
export const DEFAULT_CADENCE: Cadence = { maxAttempts: 4, redialAfterHours: 4, nextDay: false };
export const clampCadence = (c: Partial<Cadence>): Cadence => ({
  maxAttempts: Math.min(10, Math.max(1, Math.round(c.maxAttempts ?? DEFAULT_CADENCE.maxAttempts))),
  redialAfterHours: Math.min(72, Math.max(1, Math.round(c.redialAfterHours ?? DEFAULT_CADENCE.redialAfterHours))),
  nextDay: c.nextDay === true,
});
export type AttemptState = { attempts: number; lastAt: number | null; reached: boolean };
export type CadenceStep = { state: "fresh" | "due" | "waiting" | "text_fallback" | "done"; label: string; dueAt: number | null };
/** Where a lead stands in its redial plan. `attempts` is the number of calls already logged; a reached lead is done; past the maximum the plan hands over to a text task. */
export function cadenceStep(c: Cadence, s: AttemptState, now: number, tz: string | null = null): CadenceStep {
  if (s.reached) return { state: "done", label: "Reached", dueAt: null };
  if (s.attempts >= c.maxAttempts) return { state: "text_fallback", label: `${c.maxAttempts} tries, now text`, dueAt: null };
  const label = `touch ${s.attempts + 1} of ${c.maxAttempts}`;
  if (s.attempts === 0 || s.lastAt === null) return { state: "fresh", label, dueAt: null };
  const dueAt = c.nextDay ? nextLocalHour(s.lastAt, tz, 9, true) : s.lastAt + c.redialAfterHours * H;
  return { state: now >= dueAt ? "due" : "waiting", label, dueAt };
}

// ---------------------------------------------------------------- the lead's own clock
export function localParts(ms: number, tz: string | null): { hour: number; minute: number } | null {
  if (!tz) return null;
  try {
    const p = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hour12: false, timeZone: tz }).formatToParts(new Date(ms));
    const hour = Number(p.find((x) => x.type === "hour")?.value) % 24; const minute = Number(p.find((x) => x.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? { hour, minute } : null;
  } catch { return null; }
}
/** The next moment (in 15-minute steps) at which it is `hour`:00 in the zone. With `tomorrow`, never earlier than the next local day. */
export function nextLocalHour(from: number, tz: string | null, hour: number, tomorrow = false): number {
  if (!tz || !localParts(from, tz)) return from + (tomorrow ? 24 * H : 0);
  const startDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(from));
  for (let t = from + 15 * 60_000; t < from + 49 * H; t += 15 * 60_000) {
    const p = localParts(t, tz);
    if (p && p.hour === hour && p.minute === 0 && (!tomorrow || new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t)) !== startDay)) return t;
  }
  return from + 24 * H;
}
export type Window = { start: number; end: number };
export const DEFAULT_WINDOW: Window = { start: 9, end: 20 };
/** Is it inside calling hours where the lead is? An unknown zone is allowed but marked unknown (the older 8am to 9pm warning still applies in the card). */
export function callWindow(now: number, tz: string | null, w: Window = DEFAULT_WINDOW): { ok: boolean; unknown: boolean; nextAt: number | null; label: string | null } {
  const p = localParts(now, tz);
  if (!p) return { ok: true, unknown: true, nextAt: null, label: null };
  if (p.hour >= w.start && p.hour < w.end) return { ok: true, unknown: false, nextAt: null, label: null };
  return { ok: false, unknown: false, nextAt: nextLocalHour(now, tz, w.start), label: `call at ${w.start}:00 their time` };
}

// ---------------------------------------------------------------- best time to call (the account's own history)
export type CallTry = { at: number; reached: boolean };
/** The local hour in which this account's calls were reached most often. Needs 12 tries in all and 3 in the hour; otherwise null (never guessed). */
export function bestHour(tries: readonly CallTry[], tz: string | null): { hour: number; rate: number; tries: number } | null {
  if (tries.length < 12) return null;
  const by = new Map<number, { n: number; hit: number }>();
  for (const t of tries) { const p = localParts(t.at, tz ?? "UTC"); if (!p) continue; const b = by.get(p.hour) ?? { n: 0, hit: 0 }; b.n++; if (t.reached) b.hit++; by.set(p.hour, b); }
  let best: { hour: number; rate: number; tries: number } | null = null;
  for (const [hour, b] of by) if (b.n >= 3) { const rate = b.hit / b.n; if (!best || rate > best.rate || (rate === best.rate && b.n > best.tries)) best = { hour, rate, tries: b.n }; }
  return best && best.rate > 0 ? { ...best, rate: Math.round(best.rate * 100) } : null;
}
export const hourWord = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

// ---------------------------------------------------------------- the heat score that re-ranks the queue
export type HeatIn = { openValue: number; ageHours: number | null; priority: number; attempts: number; callbackDue: boolean; windowOk: boolean; waitingForRedial: boolean };
/** 0 to 100. Money and freshness (the Call mode rank), a callback that is due jumps the queue, every failed try cools a lead, a closed calling window or a redial still waiting sinks it. */
export function heatScore(i: HeatIn): { score: number; tier: "hot" | "warm" | "cool" } {
  let s = rankScore({ openValue: i.openValue, ageHours: i.ageHours, priority: i.priority }) * 1.1;
  if (i.callbackDue) s += 30;
  s -= Math.min(5, i.attempts) * 5;
  if (!i.windowOk) s -= 45;
  if (i.waitingForRedial) s -= 30;
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, tier: score >= 60 ? "hot" : score >= 35 ? "warm" : "cool" };
}
export function reorderByHeat<T extends HeatIn & { key: string }>(items: readonly T[]): T[] {
  return items.map((x) => ({ x, h: heatScore(x).score })).sort((a, b) => b.h - a.h || a.x.key.localeCompare(b.x.key)).map((v) => v.x);
}

// ---------------------------------------------------------------- dispositions with next steps
export type NextStep = "next" | "redial" | "callback" | "stop";
export type Disposition = { key: string; label: string; base: DialOutcome; next: NextStep; tag: string | null; doNotCall: boolean };
/** The standard seven outcomes, with the two next steps King asked for: booked sets a tag, wrong number marks the lead do-not-call (a tag plus a local skip: the CRM's own flag is not settable through the gateway). */
export const DEFAULT_DISPOSITIONS: Disposition[] = OUTCOMES.map((o) => ({
  key: o.key, label: o.label, base: o.key,
  next: o.key === "no_answer" || o.key === "voicemail" ? "redial" : o.key === "call_back" ? "callback" : o.key === "booked" || o.key === "spoke" ? "next" : "stop",
  tag: o.key === "booked" ? "subsync-booked" : o.key === "wrong_number" ? "wrong-number" : o.key === "dnc" ? "do-not-call" : null,
  doNotCall: o.key === "wrong_number" || o.key === "dnc",
}));
/** What a disposition writes. Tag names are cleaned (lower case, letters, digits, dashes) and capped, as the gateway expects. */
export const cleanTag = (t: string) => t.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export function dispositionWrites(d: Disposition): Array<{ kind: "tag_add"; tag: string }> {
  const t = d.tag ? cleanTag(d.tag) : "";
  return t ? [{ kind: "tag_add", tag: t }] : [];
}
/** A saved custom set is validated: unique keys, a base outcome that exists, at most 12 entries. Anything else falls back to the defaults. */
export function sanitizeDispositions(raw: unknown): Disposition[] {
  if (!Array.isArray(raw)) return DEFAULT_DISPOSITIONS;
  const seen = new Set<string>(); const out: Disposition[] = [];
  for (const r of raw.slice(0, 12)) {
    const o = r as Partial<Disposition>;
    if (!o || typeof o.key !== "string" || typeof o.label !== "string" || !OUTCOMES.some((x) => x.key === o.base) || seen.has(o.key)) continue;
    seen.add(o.key);
    out.push({ key: o.key.slice(0, 30), label: o.label.trim().slice(0, 40) || o.key, base: o.base as DialOutcome, next: (["next", "redial", "callback", "stop"] as const).includes(o.next as NextStep) ? (o.next as NextStep) : "next", tag: typeof o.tag === "string" && cleanTag(o.tag) ? cleanTag(o.tag) : null, doNotCall: o.doNotCall === true });
  }
  return out.length ? out : DEFAULT_DISPOSITIONS;
}

// ---------------------------------------------------------------- plain templates (no model call)
export const BOOKING_TEXT = "Hi {name}, it is {me} from {business}. Sorry we missed you. You can pick a time that suits you here: {link}";
export function bookingText(t: string, v: { name: string; me?: string | null; business?: string | null; link: string }): string {
  const first = (v.name || "there").split(/\s+/)[0] || "there";
  return t.replaceAll("{name}", first).replaceAll("{me}", v.me?.trim() || "your team").replaceAll("{business}", v.business?.trim() || "our business").replaceAll("{link}", v.link);
}
/** A call note filled from the outcome and context. A template: no words of the call are known, so none are invented. */
export function noteDraft(i: { disposition: string; name: string; attempt: number; max: number; source?: string | null; callbackAt?: string | null; heat?: string | null }): string {
  const bits = [`Call ${i.attempt} of ${i.max} to ${i.name}: ${i.disposition.toLowerCase()}.`];
  if (i.source) bits.push(`Lead source: ${i.source}.`);
  if (i.callbackAt && !Number.isNaN(Date.parse(i.callbackAt))) bits.push(`Call back around ${new Date(i.callbackAt).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  return bits.join(" ");
}
/** A script per lead source: the most specific line wins (an exact source, else the account script). Keys are compared lower case. */
export function scriptFor(scripts: Readonly<Record<string, string>>, source: string | null | undefined, fallback: string): string {
  const k = (source ?? "").toLowerCase().trim();
  return (k && scripts[k]) || fallback;
}

// ---------------------------------------------------------------- power hour and the board
export type Goals = { calls: number; reached: number; booked: number };
export const DEFAULT_GOALS: Goals = { calls: 30, reached: 10, booked: 3 };
export type HourLog = { outcome: DialOutcome; at: number };
export function powerHour(i: { startedAt: number; now: number; minutes: number; goals: Goals; logged: readonly HourLog[] }) {
  const end = i.startedAt + i.minutes * 60_000;
  const mine = i.logged.filter((l) => l.at >= i.startedAt && l.at <= end);
  const reached = mine.filter((l) => OUTCOMES.find((o) => o.key === l.outcome)?.reached).length;
  const booked = mine.filter((l) => l.outcome === "booked").length;
  const ring = (n: number, goal: number) => Math.min(100, goal > 0 ? Math.round((n / goal) * 100) : 0);
  return { msLeft: Math.max(0, end - i.now), over: i.now >= end, calls: mine.length, reached, booked, rings: { calls: ring(mine.length, i.goals.calls), reached: ring(reached, i.goals.reached), booked: ring(booked, i.goals.booked) } };
}
export type BoardIn = { id: string; name: string; calls: number; reached: number; booked: number; medianAnswerSeconds?: number | null };
export type BoardRow = BoardIn & { rank: number; tier: "Orbit" | "Surge" | "Spark"; score: number; fastest: boolean };
/** Booked counts most, then reached, then calls. Luminous tiers (not metals): rank 1 Orbit, ranks 2 and 3 Surge, the rest Spark. The fastest median is marked once. */
export function leaderboard(rows: readonly BoardIn[]): BoardRow[] {
  const scored = rows.map((r) => ({ ...r, score: r.booked * 10 + r.reached * 3 + r.calls })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const speeds = scored.filter((r) => r.medianAnswerSeconds != null && r.calls >= 3).map((r) => r.medianAnswerSeconds as number);
  const best = speeds.length ? Math.min(...speeds) : null;
  return scored.map((r, i) => ({ ...r, rank: i + 1, tier: i === 0 ? "Orbit" : i < 3 ? "Surge" : "Spark", fastest: best !== null && r.medianAnswerSeconds === best && r.calls >= 3 }));
}

// ---------------------------------------------------------------- which attempt books
export type CallRec = { contactId: string; at: number; outcome: string };
/** For attempt 1, 2, 3...: how many leads got that many calls, and how many of them booked ON that call. A rate needs 10 leads at that attempt number. */
export function conversionByAttempt(calls: readonly CallRec[], maxAttempt = 6): Array<{ attempt: number; leads: number; booked: number; rate: number | null }> {
  const by = new Map<string, CallRec[]>();
  for (const c of calls) by.set(c.contactId, [...(by.get(c.contactId) ?? []), c]);
  const out = Array.from({ length: maxAttempt }, (_, i) => ({ attempt: i + 1, leads: 0, booked: 0, rate: null as number | null }));
  for (const list of by.values()) {
    list.sort((a, b) => a.at - b.at);
    list.slice(0, maxAttempt).forEach((c, i) => { out[i].leads++; if (c.outcome === "booked") out[i].booked++; });
  }
  return out.filter((r) => r.leads > 0).map((r) => ({ ...r, rate: r.leads >= 10 ? Math.round((r.booked / r.leads) * 100) : null }));
}
/** Attempts so far per lead, from the call records, for the queue: calls made, when the last was, and whether the lead was ever reached. */
export function attemptStates(calls: readonly CallRec[]): Map<string, AttemptState> {
  const out = new Map<string, AttemptState>();
  for (const c of calls) {
    const s = out.get(c.contactId) ?? { attempts: 0, lastAt: null, reached: false };
    s.attempts++; s.lastAt = Math.max(s.lastAt ?? 0, c.at);
    if (OUTCOMES.find((o) => o.key === c.outcome)?.reached) s.reached = true;
    out.set(c.contactId, s);
  }
  return out;
}
/** Today's callbacks: those promised for the given local day, soonest first. */
export type Callback = { key: string; name: string; at: number; locationName?: string | null };
export function todaysCallbacks(list: readonly Callback[], now: number, tz: string | null): Callback[] {
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(new Date(ms));
  const today = day(now);
  return list.filter((c) => day(c.at) === today).sort((a, b) => a.at - b.at);
}
