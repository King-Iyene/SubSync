// When a message may go out: the chosen hour in the chosen time zone, quiet hours, once-a-day batching, and the rule that a critical alert is never held
// back. Pure, no database or network, so every rule is tested with fake clocks across time zones and daylight-saving changes (the platform's own clock
// rules via Intl: a spring-forward day has no 02:00 hour and a fall-back day has 01:00 twice; the "once per local date" check copes with both).

import { localClock } from "../analytics/digest-intel.ts";
import { inSendWindow, SEND_CATCHUP_HOURS } from "../sync/schedule.ts";
import type { Frequency, Severity } from "./catalog.ts";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_NAMES: Record<Weekday, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

export type Timing = {
  frequency: Frequency;
  /** Local hour 0 to 23 for a daily or weekly message. */
  hour: number;
  weekday: Weekday;
  /** An IANA zone such as "Africa/Lagos". Null means: the zone of the first client account, else UTC. */
  timezone: string | null;
  quietOn: boolean;
  quietStart: number;
  quietEnd: number;
  /** A critical alert is sent at once even in quiet hours and even for a "once a day" kind. */
  criticalBypass: boolean;
};

export const DEFAULT_QUIET = { start: 21, end: 7 } as const;

export const isHour = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
export const isWeekday = (v: unknown): v is Weekday => typeof v === "string" && (WEEKDAYS as readonly string[]).includes(v);

/** True when the zone name is one the platform knows. */
export const validZone = (z: unknown): z is string => typeof z === "string" && z.length > 0 && z.length <= 64 && localClock(new Date(0), z) !== null;

/** The zone to judge a message in: the chosen one if valid, else the fallback (first client account), else UTC. */
export function zoneOf(timing: Pick<Timing, "timezone">, fallback: string | null): string {
  if (validZone(timing.timezone)) return timing.timezone;
  if (validZone(fallback)) return fallback;
  return "UTC";
}

/** Is this local hour inside quiet hours? The window may wrap past midnight (21 to 7). Equal start and end means there is no quiet window. */
export function inQuiet(localHour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? localHour >= start && localHour < end : localHour >= start || localHour < end;
}

export type Decision = { action: "send" } | { action: "hold"; reason: "quiet_hours" | "daily_batch" | "weekly_batch" };

export type DecideInput = {
  timing: Timing;
  severity: Severity;
  now: Date;
  zone: string;
  /** The local date (YYYY-MM-DD in `zone`) of the last once-a-day batch already sent for this kind and place, or null. */
  lastBatchDate: string | null;
};

/**
 * May an EVENT message (something happened) go out now?
 *   - Immediate: yes, except in quiet hours, where it waits for the morning. A critical alert is never held when criticalBypass is on.
 *   - Once a day (or a week): it waits for the chosen hour, then everything waiting goes in ONE message; a second batch the same local date is not sent.
 *     A critical alert still goes at once when criticalBypass is on.
 */
export function decide({ timing, severity, now, zone, lastBatchDate }: DecideInput): Decision {
  const local = localClock(now, zone);
  if (!local) return { action: "send" }; // an unreadable clock must never lose an alert
  if (severity === "critical" && timing.criticalBypass) return { action: "send" };
  if (timing.frequency === "immediate") {
    return timing.quietOn && inQuiet(local.hour, timing.quietStart, timing.quietEnd) ? { action: "hold", reason: "quiet_hours" } : { action: "send" };
  }
  if (timing.frequency === "weekly") {
    return local.weekday === timing.weekday && inSendWindow(local.hour, timing.hour) && lastBatchDate !== local.date ? { action: "send" } : { action: "hold", reason: "weekly_batch" };
  }
  return inSendWindow(local.hour, timing.hour) && lastBatchDate !== local.date ? { action: "send" } : { action: "hold", reason: "daily_batch" };
}

/**
 * Is a SCHEDULED message (the daily brief, the weekly summary) due now? From the chosen hour until SEND_CATCHUP_HOURS later, once per local date
 * (a weekly one only on its weekday). Quiet hours do not apply: the person chose this time. Returns the local date to dedupe on.
 */
export function scheduledDue(timing: Timing, now: Date, zone: string, lastSentDate: string | null): { due: boolean; date: string | null } {
  const local = localClock(now, zone);
  if (!local) return { due: false, date: null };
  const dayOk = timing.frequency === "weekly" ? local.weekday === timing.weekday : true;
  return { due: dayOk && inSendWindow(local.hour, timing.hour) && lastSentDate !== local.date, date: local.date };
}

/** The local date in a zone, for the once-a-day checks. */
export const localDate = (now: Date, zone: string): string | null => localClock(now, zone)?.date ?? null;

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** The words Settings shows for when a scheduled message goes out: "8:00 your time", "Monday 8:00 your time". */
export function whenText(timing: Timing): string {
  if (timing.frequency === "weekly") return `${WEEKDAY_NAMES[timing.weekday]} ${timing.hour}:00 your time`;
  if (timing.frequency === "daily") return `${timing.hour}:00 your time`;
  return "as it happens";
}

/** Quiet hours in one plain sentence, for the screen. */
export function quietText(timing: Timing): string {
  if (!timing.quietOn || timing.quietStart === timing.quietEnd) return "No quiet hours: alerts are sent as they happen, at any hour.";
  const tail = timing.criticalBypass ? " Critical alerts are still sent at once." : " Critical alerts wait too.";
  return `Between ${hh(timing.quietStart)} and ${hh(timing.quietEnd)} in your time zone, warnings wait until ${hh(timing.quietEnd)}.${tail}`;
}

/** How long a batch or a late run can be, in words, for the screen. */
export const CATCHUP_TEXT = `If a check is late it still goes out within ${SEND_CATCHUP_HOURS} hours of the chosen time; after that the day is skipped instead of sending a morning message in the evening.`;
