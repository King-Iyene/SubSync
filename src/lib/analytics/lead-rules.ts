// Which contacts count as leads for speed to lead, and when the reply clock starts. Pure (no database, no network).
// The definitions live in docs/METRICS.md ("Speed to lead"); this file is their only implementation.
import { isTestName } from "./test-data.ts";

export type Exclusion = "import" | "spam" | "test" | "dnd" | "duplicate";

export type LeadContact = {
  fullName: string | null;
  email: string | null;
  tags: string[];
  source: string | null;
  /** The contact has asked not to be contacted on any channel. */
  dnd: boolean;
};

export type LeadContext = {
  /** Contacts in the same account created in the same minute as this one (itself included). */
  createdTogether: number;
  /** An earlier contact in the same account has the same email or the same phone number. */
  earlierDuplicate: boolean;
};

/** This many contacts created in one minute is a bulk import, not people arriving. */
export const BULK_IMPORT_MINUTE = 20;

const IMPORT = /\b(import|imported|csv|upload|uploaded|bulk|migrat\w*|spreadsheet)\b/i;
const SPAM = /\b(spam|junk|bot|fake)\b/i;
// example.com is not listed: it is the placeholder address in sample data (including this app's demo), so on its own it says nothing.
const TEST_EMAIL = /@(test\.com|mailinator\.com|guerrillamail\.com|yopmail\.com)$/i;

// The first matching reason, or null when the contact counts as a lead. The order is the order of the reasons on screen.
export function excludeReason(c: LeadContact, ctx: LeadContext): Exclusion | null {
  const tags = c.tags.join(" ");
  if (IMPORT.test(c.source ?? "") || IMPORT.test(tags) || ctx.createdTogether >= BULK_IMPORT_MINUTE) return "import";
  if (SPAM.test(c.source ?? "") || SPAM.test(tags)) return "spam";
  if (isTestName(c.fullName) || c.tags.some((t) => isTestName(t)) || TEST_EMAIL.test(c.email ?? "")) return "test";
  if (c.dnd) return "dnd";
  if (ctx.earlierDuplicate) return "duplicate";
  return null;
}

export const EXCLUSION_LABEL: Record<Exclusion, string> = {
  import: "bulk imports", spam: "spam", test: "test contacts", dnd: "do not contact", duplicate: "duplicates",
};

// ---- business hours -------------------------------------------------------------------------------------------
// With business hours on, a lead that arrives when the team is closed starts its clock at the next opening time in the
// account's own time zone: Monday to Friday, from `open` to `close` (whole hours, 0 to 24). A lead that arrives during
// opening hours starts at its own time. Known limit: a lead that arrives in hours and is still unanswered at closing
// keeps counting through the night (it shows as waiting rather than being hidden).

export type Hours = { open: number; close: number };

// UTC offset (ms) of a time zone at an instant. Local time minus UTC time.
function offsetMs(utcMs: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(utcMs / 1000) * 1000;
}

// The UTC instant at which the wall clock in `timeZone` reads y-m-d h:00.
function zonedHour(y: number, m: number, d: number, h: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone); // second pass settles the daylight-saving edge
  return t;
}

function localDay(utcMs: number, timeZone: string): { y: number; m: number; d: number; dow: number; hour: number } {
  const local = new Date(utcMs + offsetMs(utcMs, timeZone));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), dow: local.getUTCDay(), hour: local.getUTCHours() + local.getUTCMinutes() / 60 };
}

export function validZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { return "UTC"; }
}

/** When the clock starts for a lead that arrived at `leadAt` (epoch ms). */
export function clockStart(leadAt: number, timeZone: string | null | undefined, hours: Hours | null): number {
  if (!hours || hours.close <= hours.open) return leadAt;
  const tz = validZone(timeZone);
  const here = localDay(leadAt, tz);
  const weekday = here.dow >= 1 && here.dow <= 5;
  if (weekday && here.hour >= hours.open && here.hour < hours.close) return leadAt;
  // Before opening on a weekday: today's opening. Otherwise: the next weekday's opening.
  let dayShift = weekday && here.hour < hours.open ? 0 : 1;
  for (let i = 0; i < 8; i++) {
    const t = new Date(Date.UTC(here.y, here.m - 1, here.d + dayShift));
    const dow = t.getUTCDay();
    if (dow >= 1 && dow <= 5) return zonedHour(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), hours.open, tz);
    dayShift += 1;
  }
  return leadAt;
}
