import { validZone } from "./lead-rules.ts";

export const ACK_ESCALATION_GRACE_MINUTES = 120;
export const ACK_ESCALATION_GRACE_MIN = 15;
export const ACK_ESCALATION_GRACE_MAX = 720;
export const OWNER_LOAD_ALERT_THRESHOLD = 10;
export const OWNERLESS_ALERT_MINUTES = 60;
export const BREACH_SPIKE_MIN_COUNT = 5;
export const BREACH_SPIKE_MULTIPLE = 2;
export const UNANSWERED_OUTCOMES = ["replied", "appointment_booked", "not_a_lead", "needs_follow_up"] as const;
export type UnansweredOutcome = (typeof UNANSWERED_OUTCOMES)[number];

export function isUnansweredOutcome(value: unknown): value is UnansweredOutcome {
  return typeof value === "string" && (UNANSWERED_OUTCOMES as readonly string[]).includes(value);
}

function zoneParts(at: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(at));
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), weekday: new Date(`${value("year")}-${String(value("month")).padStart(2, "0")}-${String(value("day")).padStart(2, "0")}T12:00:00Z`).getUTCDay() };
}

function zonedHour(year: number, month: number, day: number, hour: number, zone: string): number {
  const target = Date.UTC(year, month - 1, day, hour);
  const offset = (at: number) => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(at));
    const n = (type: string) => Number(p.find((x) => x.type === type)?.value);
    return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at / 1000) * 1000;
  };
  let at = target - offset(target);
  at = target - offset(at);
  return at;
}

/** Business-clock duration, Monday-Friday, in the account's local open/close hours. */
export function unansweredBusinessElapsedMs(start: number, end: number, zoneInput: string | null, openHour: number, closeHour: number): number {
  if (end <= start) return 0;
  if (!Number.isInteger(openHour) || !Number.isInteger(closeHour) || openHour < 0 || closeHour > 24 || closeHour <= openHour) {
    throw new RangeError("Business hours must be whole hours with closing after opening");
  }
  const zone = validZone(zoneInput);
  const first = zoneParts(start, zone);
  const last = zoneParts(end, zone);
  let day = Date.UTC(first.year, first.month - 1, first.day);
  const lastDay = Date.UTC(last.year, last.month - 1, last.day);
  let total = 0;
  while (day <= lastDay) {
    const date = new Date(day);
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      const opens = zonedHour(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), openHour, zone);
      const closes = zonedHour(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), closeHour, zone);
      total += Math.max(0, Math.min(end, closes) - Math.max(start, opens));
    }
    day += 86_400_000;
  }
  return total;
}

export function shouldEscalateUnacknowledged(i: { createdAt: number; now: number; readAt: number | null; resolvedAt: number | null; graceMinutes?: number }): boolean {
  return i.resolvedAt === null && i.readAt === null && i.now - i.createdAt >= (i.graceMinutes ?? ACK_ESCALATION_GRACE_MINUTES) * 60_000;
}

export function workloadWarnings(rows: readonly { ownerId: string | null }[], threshold = OWNER_LOAD_ALERT_THRESHOLD): Array<{ ownerId: string; waiting: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.ownerId) counts.set(row.ownerId, (counts.get(row.ownerId) ?? 0) + 1);
  return [...counts].filter(([, waiting]) => waiting >= threshold).map(([ownerId, waiting]) => ({ ownerId, waiting })).sort((a, b) => b.waiting - a.waiting || a.ownerId.localeCompare(b.ownerId));
}

export function patternCounts(rows: readonly { ownerId: string | null; source: string | null; localHour: number }[]): {
  byOwner: Array<{ key: string; count: number }>;
  bySource: Array<{ key: string; count: number }>;
  byHour: Array<{ key: number; count: number }>;
} {
  const owner = new Map<string, number>();
  const source = new Map<string, number>();
  const hour = new Map<number, number>();
  for (const row of rows) {
    if (row.ownerId) owner.set(row.ownerId, (owner.get(row.ownerId) ?? 0) + 1);
    if (row.source?.trim()) source.set(row.source.trim(), (source.get(row.source.trim()) ?? 0) + 1);
    hour.set(row.localHour, (hour.get(row.localHour) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) => [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    byOwner: sorted(owner), bySource: sorted(source),
    byHour: [...hour].map(([key, count]) => ({ key, count })).sort((a, b) => a.key - b.key),
  };
}

export function isBreachSpike(current: number, previousDailyCounts: readonly number[]): boolean {
  if (current < BREACH_SPIKE_MIN_COUNT || previousDailyCounts.length < 3) return false;
  const average = previousDailyCounts.reduce((sum, n) => sum + Math.max(0, n), 0) / previousDailyCounts.length;
  return average > 0 && current >= average * BREACH_SPIKE_MULTIPLE;
}

export function isHandoffWindow(now: number, zoneInput: string | null, closeHour: number): boolean {
  const zone = validZone(zoneInput);
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(now));
  const value = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekday = value("weekday");
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday ?? "") && hour === closeHour - 1 && minute >= 30;
}

export function ownerlessFor(now: number, inboundAt: number, ownerId: string | null): boolean {
  return ownerId === null && now - inboundAt >= OWNERLESS_ALERT_MINUTES * 60_000;
}

export function weeklyReceipt(i: { breached: number; recovered: number; unresolved: number; recoveryMinutes: readonly number[] }) {
  const sorted = [...i.recoveryMinutes].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const medianMinutes = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  return {
    breached: Math.max(0, i.breached), recovered: Math.max(0, i.recovered), unresolved: Math.max(0, i.unresolved), medianMinutes,
  };
}

export function hasRepeatUnread(unreadCount: number): boolean {
  return Number.isInteger(unreadCount) && unreadCount > 1;
}

export function slaTargetLabel(input: { minutes: number | null; industryPreset: boolean }): string {
  if (input.industryPreset) return "Industry reply target";
  if (input.minutes && input.minutes > 0) return "Account reply target";
  return "Default reply target";
}
