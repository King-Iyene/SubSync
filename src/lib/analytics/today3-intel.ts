import { DAY, fmtMinutes, mondayOf } from "./clients3-intel";
import type { Td3Item, Td3Kind, Td3Module, Td3Today } from "./today3-types";

// Pure rules behind Today (no database, unit tested). Definitions: docs/METRICS.md "Today 3".
export { DAY, mondayOf };
export const MAX_ITEMS = 5; // the ranked list never grows past this
export const MIN_OUTCOMES = 20; // a show rate needs at least this many marked outcomes
export const MIN_REPLIES = 5; // a typical reply time needs at least this many answered leads
export const MIN_FIX_SAMPLES = 3; // a median fix time needs at least this many fixes

/** Plain words and the screen that holds the full working list for each kind. */
export const KIND_TEXT: Record<Td3Kind, { label: (n: number) => string; why: string; module: Td3Module; button: (n: number) => string; order: number }> = {
  needs_permission: { label: (n) => `${n} ${n === 1 ? "account needs" : "accounts need"} permission`, why: "Reconnect so we can read this part of the account. Until then its numbers may be missing.", module: "clients", button: (n) => `Reconnect ${n === 1 ? "the account" : `the ${n} accounts`}`, order: 1 },
  waiting_old: { label: (n) => `${n} ${n === 1 ? "person has" : "people have"} waited over a day for a reply`, why: "A customer wrote last and nobody has answered for more than 24 hours.", module: "speed", button: (n) => `Reply to ${n === 1 ? "the person" : `the ${n} people`}`, order: 2 },
  unmarked: { label: (n) => `${n} appointment${n === 1 ? "" : "s"} with no outcome`, why: "The time has passed and nobody marked it as came or no-show, so show rates are wrong.", module: "appointments", button: (n) => `Mark ${n === 1 ? "the appointment" : `the ${n} appointments`}`, order: 3 },
  noshows: { label: (n) => `${n} no-show${n === 1 ? "" : "s"} to follow up`, why: "People who booked and did not come in the last 7 days.", module: "appointments", button: (n) => `Follow up ${n === 1 ? "the no-show" : `the ${n} no-shows`}`, order: 4 },
  waiting: { label: (n) => `${n} ${n === 1 ? "person is" : "people are"} waiting for a reply`, why: "A customer wrote last and nobody has answered yet.", module: "speed", button: (n) => `Reply to ${n === 1 ? "the person" : `the ${n} people`}`, order: 5 },
  stale_deals: { label: (n) => `${n} deal${n === 1 ? "" : "s"} gone quiet`, why: "Open deals with no movement for 30 days.", module: "pipeline", button: (n) => `Wake up ${n === 1 ? "the deal" : `the ${n} deals`}`, order: 6 },
  leads_down: { label: () => "New leads are down", why: "Fewer enquiries came in than in the 7 days before.", module: "clients", button: () => "See where leads dropped", order: 7 },
  staff_quiet: { label: (n) => `${n} team member${n === 1 ? " has" : "s have"} gone quiet`, why: "They have sent no messages for 7 days.", module: "team", button: () => "See who is quiet", order: 8 },
  sync_old: { label: (n) => `${n === 1 ? "An account's" : `${n} accounts'`} data is out of date`, why: "We have not been able to refresh this account recently.", module: "clients", button: () => "Check data freshness", order: 9 },
  no_owner: { label: () => "Many contacts have no owner", why: "Nobody is responsible for these contacts.", module: "data-health", button: () => "Assign owners", order: 10 },
  no_phone: { label: () => "Many contacts have no phone number", why: "These contacts cannot be called or texted.", module: "data-health", button: () => "Fix missing phones", order: 11 },
};

/** Short noun for the "Done today" line. */
export const KIND_SHORT: Record<Td3Kind, string> = { needs_permission: "accounts reconnected", waiting_old: "waited over a day for a reply", waiting: "waiting for a reply", unmarked: "appointments with no outcome", noshows: "no-shows", stale_deals: "quiet deals", leads_down: "new leads back up", staff_quiet: "quiet team members", sync_old: "accounts refreshed", no_owner: "contacts given an owner", no_phone: "contacts given a phone number" };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const moneyText = money;

/** Hours as plain words: "3 hours", "2 days". */
export function hoursText(h: number): string {
  if (h < 1) return "under an hour";
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  return `${Math.round(h / 24)} days`;
}

type Raw = Omit<Td3Item, "rankWhy" | "module" | "label" | "why">;
/** Money first (an estimate of the open deals behind the item), then the longest wait, then a fixed order. Each item says why it is where it is. Pure. */
export function rankItems(raw: Raw[]): Td3Item[] {
  const sorted = [...raw].sort((a, b) => (b.money ?? 0) - (a.money ?? 0) || (b.oldestHours ?? 0) - (a.oldestHours ?? 0) || KIND_TEXT[a.kind].order - KIND_TEXT[b.kind].order || b.count - a.count);
  return sorted.map((r, i): Td3Item => {
    const t = KIND_TEXT[r.kind];
    const rankWhy = (r.money ?? 0) > 0 ? `${i === 0 ? "First" : "Next"} because about ${money(r.money as number)} in open deals sit behind it (estimate).`
      : r.oldestHours !== null && r.oldestHours > 0 ? `No dollar value is known, so it is ranked by wait: the longest has waited ${hoursText(r.oldestHours)}.`
      : "No dollar value or wait time is known, so it follows the usual order.";
    return { ...r, label: t.label(r.count), why: t.why, module: t.module, rankWhy };
  });
}

/** The one sentence at the top and the one button. */
export function headlineOf(items: readonly Td3Item[], accounts: number): { headline: string; button: Td3Today["button"] } {
  if (accounts === 0) return { headline: "No client accounts yet.", button: null };
  const first = items[0];
  if (!first) return { headline: "Nothing needs you right now.", button: null };
  const t = KIND_TEXT[first.kind];
  const second = items[1];
  const lead = first.label.charAt(0).toUpperCase() + first.label.slice(1);
  const headline = second ? `${lead}, and ${second.label}.` : `${lead}.`;
  const one = first.accounts === 1 ? first.top[0]?.locationId ?? null : null;
  return { headline, button: { label: t.button(first.count), kind: first.kind, count: first.count, module: t.module, locationId: one } };
}

// ---- time zones: "today" is the client account's day ----

export function validZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}
const parts = (ms: number, tz: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: validZone(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
};
/** The calendar day (YYYY-MM-DD) it is in that time zone at `ms`. */
export const localDay = (ms: number, tz: string): string => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}`; };
export const localHour = (ms: number, tz: string): number => Number(parts(ms, tz).hour) % 24;
/** Weekday 0 (Sunday) to 6 in that time zone. */
export const localWeekday = (ms: number, tz: string): number => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts(ms, tz).weekday);

// ---- the ledger: what a sweep writes for one account and kind ----

export type Ledger = {
  day: string; lastCount: number; peakCount: number; found: number; cleared: number; opened: number; baseline: boolean;
  openSince: number | null; lastClearedAt: number | null; resolvedAt: number | null; fixMinutes: number[];
};
export type Prev = { day: string; lastCount: number; openSince: number | null; found: number; cleared: number; opened: number; peakCount: number; baseline: boolean; lastClearedAt: number | null; resolvedAt: number | null; fixMinutes: number[] } | null;

/** One recording. The first ever row of a kind is a baseline (the count that was already there is not "found"). After that, a rise is found and a drop is cleared; recording the same count
 *  twice changes nothing (idempotent). When the count reaches zero after being above zero, the time it was open is kept as a fix time. Pure. */
export function planRecord(prev: Prev, cur: number, nowMs: number, day: string): Ledger {
  if (!prev) return { day, lastCount: cur, peakCount: cur, found: 0, cleared: 0, opened: 0, baseline: true, openSince: cur > 0 ? nowMs : null, lastClearedAt: null, resolvedAt: null, fixMinutes: [] };
  const sameDay = prev.day === day;
  const delta = cur - prev.lastCount;
  const base = sameDay ? prev : { ...prev, found: 0, cleared: 0, opened: 0, peakCount: prev.lastCount, baseline: false, fixMinutes: [] as number[], lastClearedAt: null, resolvedAt: null };
  let openSince = prev.openSince, fixMinutes = [...base.fixMinutes], resolvedAt = base.resolvedAt;
  if (prev.lastCount === 0 && cur > 0) openSince = nowMs;
  if (prev.lastCount > 0 && cur === 0) { if (openSince !== null) fixMinutes = [...fixMinutes, Math.max(0, Math.round((nowMs - openSince) / 60_000))]; openSince = null; resolvedAt = nowMs; }
  if (cur > 0 && prev.lastCount > 0 && openSince === null) openSince = nowMs;
  return {
    day, lastCount: cur, peakCount: Math.max(base.peakCount, cur), found: base.found + Math.max(0, delta), cleared: base.cleared + Math.max(0, -delta), opened: base.opened,
    baseline: sameDay ? base.baseline : false, openSince, lastClearedAt: delta < 0 ? nowMs : base.lastClearedAt, resolvedAt, fixMinutes,
  };
}

export function medianOf(v: readonly number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// ---- proof ----

export function proofLines(t: { found: number; cleared: number; stillOpen: number; medianFixMinutes: number | null; enough: boolean }, who: string | null, historyStarts: string | null): string[] {
  const subject = who ?? "your client accounts";
  if (!t.enough) return [historyStarts ? `We started keeping this record on ${historyStarts}, so there is not a full week to report yet.` : "We have not started keeping this record yet."];
  const out = [`This week we found ${t.found} ${t.found === 1 ? "problem" : "problems"} in ${subject}.`];
  out.push(`${t.cleared} ${t.cleared === 1 ? "was" : "were"} fixed${t.medianFixMinutes !== null ? `, usually within ${fmtMinutes(t.medianFixMinutes)}` : ""}.`);
  out.push(t.stillOpen > 0 ? `${t.stillOpen} ${t.stillOpen === 1 ? "is" : "are"} still open.` : "Nothing is left open.");
  return out;
}

/** The week list (Mondays), newest first. */
export function recentWeeks(nowMs: number, n: number): string[] {
  const m = mondayOf(nowMs);
  return [...Array(n)].map((_, i) => new Date(m - i * 7 * DAY).toISOString().slice(0, 10));
}

// ---- numbers ----

export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null);
export function showRate(showed: number, noshow: number): { value: string; enough: boolean; rate: number | null } {
  const of = showed + noshow;
  if (of < MIN_OUTCOMES) return { value: `Not enough data (${of} of ${MIN_OUTCOMES} outcomes marked)`, enough: false, rate: null };
  const r = Math.round((showed / of) * 100);
  return { value: `${r}%`, enough: true, rate: r };
}
export const changeText = (cur: number | null, prev: number | null, minBase: number): string | null => (cur === null || prev === null || prev < minBase ? null : `${cur - prev >= 0 ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%`);

// ---- the daily email ----

/** True when it is the chosen local hour, today is not a quiet weekday and this day has not been sent yet. Safe to call every hour or late within the same day. */
export function emailDue(nowMs: number, tz: string, hour: number, quietDays: readonly number[], lastKey: string | null): { due: boolean; key: string } {
  const key = localDay(nowMs, tz);
  const h = localHour(nowMs, tz);
  const due = h >= hour && h < hour + 3 && !quietDays.includes(localWeekday(nowMs, tz)) && lastKey !== key;
  return { due, key };
}

export function emailText(t: Pick<Td3Today, "headline" | "items" | "scope" | "allClear">, appUrl: string, unsubscribeUrl: string): { subject: string; text: string } {
  const lines = t.items.slice(0, MAX_ITEMS).map((i, n) => `${n + 1}. ${i.label}${i.money ? ` (about ${money(i.money)} in open deals, estimate)` : ""}`);
  const body = lines.length ? lines.join("\n") : t.allClear ? `Nothing needs you. ${t.allClear.fixedSinceYesterday} ${t.allClear.fixedSinceYesterday === 1 ? "thing was" : "things were"} fixed since yesterday.` : "Nothing needs you right now.";
  return {
    subject: t.items.length ? `Today: ${t.items[0].label}` : "Today: nothing needs you",
    text: `${t.scope}\n\n${t.headline}\n\n${body}\n\nOpen your list: ${appUrl}\n\nYou get this once a day. Nothing on this page changes your CRM or messages your leads.\nStop these emails: ${unsubscribeUrl}\n`,
  };
}

/** Overview is merged into Today > Numbers when both are on and the old page's own flag (ov_screen, default off) is not. Used by the menu and the redirect, so they cannot disagree. */
export const overviewMerged = (f: { td_module?: boolean; td_numbers?: boolean; ov_screen?: boolean }): boolean => f.td_module === true && f.td_numbers === true && f.ov_screen !== true;
/** The most tiles Numbers may show. */
export const MAX_TILES = 6;
