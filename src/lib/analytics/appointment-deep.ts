// Deeper appointment analysis (encyclopedia section 1). Pure (no database or network imports) so it can be
// unit tested. Builds on appointment-intel.ts for the basic rates.
import { hasOutcome, isActive, rates, type Appt } from "./appointment-intel.ts";

const DAY = 86_400_000;
const validZone = (z: string) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return z; } catch { return "UTC"; } };

export type Lead = { id: string; locationId: string; createdAt: number | null; source: string | null };

// ---------- time of week in the account's own time zone ----------

export function localSlot(ms: number, timeZone: string): { weekday: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date(ms));
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN) % 24;
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd);
    return weekday < 0 || !Number.isFinite(hour) ? null : { weekday, hour };
  } catch {
    return null;
  }
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type Heat = { weekday: number; hour: number; booked: number; held: number; noShow: number; showRate: number | null };

// Bookings and show rate by day of week and hour (1.7). A cell needs 5 recorded outcomes to show a rate.
export function heatmap(appts: Appt[], tzOf: (locationId: string) => string, now: number, days = 90): Heat[] {
  const cells = new Map<string, Heat>();
  for (const a of appts) {
    if (!isActive(a) || a.startAt > now || a.startAt < now - days * DAY) continue;
    const slot = localSlot(a.startAt, tzOf(a.locationId));
    if (!slot) continue;
    const key = `${slot.weekday}:${slot.hour}`;
    const c = cells.get(key) ?? { weekday: slot.weekday, hour: slot.hour, booked: 0, held: 0, noShow: 0, showRate: null };
    c.booked++;
    if (a.status === "showed") c.held++;
    if (a.status === "noshow") c.noShow++;
    cells.set(key, c);
  }
  return [...cells.values()].map((c) => ({ ...c, showRate: c.held + c.noShow >= 5 ? c.held / (c.held + c.noShow) : null }));
}

// "Your leads are about 3x more likely to show on Tuesday at 10 than Friday at 4" (1.7). Returns null without enough data.
export function bestAndWorstSlot(cells: Heat[]): { best: Heat; worst: Heat; ratio: number | null } | null {
  const rated = cells.filter((c) => c.showRate !== null);
  if (rated.length < 2) return null;
  const sorted = [...rated].sort((a, b) => (b.showRate as number) - (a.showRate as number));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return { best, worst, ratio: (worst.showRate as number) > 0 ? (best.showRate as number) / (worst.showRate as number) : null };
}

// ---------- repeat no-shows (1.2) and recovery (1.3) ----------

export function repeatNoShows(appts: Appt[], minCount = 2): Array<{ contactId: string; locationId: string; count: number; lastAt: number }> {
  const by = new Map<string, { contactId: string; locationId: string; count: number; lastAt: number }>();
  for (const a of appts) {
    if (a.status !== "noshow" || !a.contactId) continue;
    const key = `${a.locationId}:${a.contactId}`;
    const cur = by.get(key) ?? { contactId: a.contactId, locationId: a.locationId, count: 0, lastAt: 0 };
    cur.count++;
    cur.lastAt = Math.max(cur.lastAt, a.startAt);
    by.set(key, cur);
  }
  return [...by.values()].filter((x) => x.count >= minCount).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

// Of the people who no-showed, how many booked again, how fast, and did they show the second time (1.3).
export function recovery(appts: Appt[], now: number, windowDays = 90) {
  const byContact = new Map<string, Appt[]>();
  for (const a of appts) if (a.contactId) (byContact.get(`${a.locationId}:${a.contactId}`) ?? byContact.set(`${a.locationId}:${a.contactId}`, []).get(`${a.locationId}:${a.contactId}`)!).push(a);
  let noShows = 0, rebooked = 0, showedAgain = 0;
  const gaps: number[] = [];
  for (const list of byContact.values()) {
    list.sort((x, y) => x.startAt - y.startAt);
    list.forEach((a, i) => {
      if (a.status !== "noshow" || a.startAt < now - windowDays * DAY || a.startAt > now - 3 * DAY) return; // give a few days to rebook
      noShows++;
      const next = list.slice(i + 1).find((b) => isActive(b) && b.status !== "noshow");
      if (!next) return;
      rebooked++;
      gaps.push((next.startAt - a.startAt) / DAY);
      if (next.status === "showed") showedAgain++;
    });
  }
  const avg = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
  return {
    noShows, rebooked, showedAgain,
    rebookRate: noShows >= 5 ? rebooked / noShows : null,
    showAgainRate: rebooked >= 5 ? showedAgain / rebooked : null,
    avgDaysToRebook: avg === null ? null : Math.round(avg * 10) / 10,
  };
}

// ---------- speed: booking velocity (1.5) and wait time (1.15) ----------

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

// Days from a lead being created to its first booking being made.
export function bookingVelocity(leads: Lead[], appts: Appt[]) {
  const first = new Map<string, number>();
  for (const a of appts) {
    if (!a.contactId || !isActive(a) || a.createdAt === null) continue;
    const key = `${a.locationId}:${a.contactId}`;
    first.set(key, Math.min(first.get(key) ?? Infinity, a.createdAt));
  }
  const days: Array<{ days: number; source: string | null; assignedTo?: string | null }> = [];
  for (const l of leads) {
    const at = first.get(`${l.locationId}:${l.id}`);
    if (at === undefined || l.createdAt === null || at < l.createdAt) continue;
    days.push({ days: (at - l.createdAt) / DAY, source: l.source });
  }
  const all = days.map((d) => d.days);
  const bySource = new Map<string, number[]>();
  for (const d of days) { const k = d.source ?? "Unknown"; (bySource.get(k) ?? bySource.set(k, []).get(k)!).push(d.days); }
  return {
    booked: days.length,
    medianDays: round1(median(all)),
    averageDays: round1(all.length ? all.reduce((s, x) => s + x, 0) / all.length : null),
    bySource: [...bySource.entries()].filter(([, v]) => v.length >= 3).map(([source, v]) => ({ source, count: v.length, medianDays: round1(median(v)) as number })).sort((a, b) => a.medianDays - b.medianDays),
  };
}

// ---------- show rate by lead source (1.4) ----------

export function showRateBySource(appts: Appt[], sourceOf: (locationId: string, contactId: string) => string | null, now: number, days = 90) {
  const groups = new Map<string, Appt[]>();
  for (const a of appts) {
    if (!a.contactId || a.status === "invalid" || a.startAt > now || a.startAt < now - days * DAY) continue;
    const s = sourceOf(a.locationId, a.contactId) ?? "Unknown";
    (groups.get(s) ?? groups.set(s, []).get(s)!).push(a);
  }
  return [...groups.entries()].map(([source, list]) => {
    const r = rates(list, 0, Number.MAX_SAFE_INTEGER, now);
    return { source, booked: list.length, held: r.held, noShow: r.noShow, showRate: r.showRate, ids: list.map((x) => x.id) };
  }).filter((x) => x.booked >= 3).sort((a, b) => b.booked - a.booked);
}

// ---------- confirmations (1.9), same-day (1.27), fairness (1.13), double bookings (1.14) ----------

export function confirmationSummary(appts: Appt[], now: number) {
  const upcoming = appts.filter((a) => isActive(a) && a.startAt >= now && a.startAt < now + 2 * DAY);
  const confirmed = upcoming.filter((a) => a.status === "confirmed" || a.status === "showed").length;
  const unconfirmed = upcoming.filter((a) => a.status === "new");
  return { next48: upcoming.length, confirmed, unconfirmed: unconfirmed.length, tomorrowAdvice: unconfirmed.length > 0 ? `${upcoming.length} appointments in the next 2 days, ${confirmed} confirmed, ${unconfirmed.length} not: send a reminder now.` : null };
}

export function sameDayPerformance(appts: Appt[], now: number) {
  const past = appts.filter((a) => a.createdAt !== null && a.startAt < now && a.startAt > now - 90 * DAY && isActive(a));
  const sameDay = past.filter((a) => (a.startAt - (a.createdAt as number)) < DAY);
  const later = past.filter((a) => (a.startAt - (a.createdAt as number)) >= DAY);
  const r = (list: Appt[]) => rates(list, 0, Number.MAX_SAFE_INTEGER, now);
  return { sameDay: { count: sameDay.length, showRate: r(sameDay).showRate }, later: { count: later.length, showRate: r(later).showRate } };
}

// Is bookings distribution across people even (1.13)? Flags a person with well over their fair share.
export function fairness(appts: Appt[], now: number, days = 30) {
  const counts = new Map<string, number>();
  for (const a of appts) {
    if (!isActive(a) || a.startAt < now - days * DAY || a.startAt > now + days * DAY) continue;
    const who = a.assignedTo ?? "unassigned";
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  const people = [...counts.entries()].filter(([k]) => k !== "unassigned");
  const total = people.reduce((s, [, n]) => s + n, 0);
  // `judged` is false when there is too little to say whether the split is even (fewer than two people or ten appointments): the health score then leaves it out.
  if (people.length < 2 || total < 10) return { rows: people.map(([key, count]) => ({ key, count, share: total ? count / total : 0, skew: 0 })), skewed: false, judged: false, note: null as string | null };
  const expected = total / people.length;
  const rows = people.map(([key, count]) => ({ key, count, share: count / total, skew: count / expected })).sort((a, b) => b.count - a.count);
  const skewed = rows[0].skew >= 1.4 || rows[rows.length - 1].skew <= 0.6;
  return { rows, skewed, judged: true, note: skewed ? `${rows[0].count} appointments went to one person and ${rows[rows.length - 1].count} to another, against an even share of about ${Math.round(expected)}.` : null };
}

// People or contacts booked twice at nearly the same time (1.14).
// A group event (the same person, the same calendar, the same start, several contacts) is one session, not a clash. "Same day" for the
// same contact is judged in the account's own time zone, so 23:30 and 00:30 are two days.
export function doubleBookings(appts: Appt[], now: number, windowMs = 30 * 60_000, tzOf: (locationId: string) => string = () => "UTC") {
  const live = appts.filter((a) => isActive(a) && a.startAt >= now - DAY && a.startAt < now + 14 * DAY).sort((a, b) => a.startAt - b.startAt);
  const out: Array<{ kind: "person" | "contact"; key: string; locationId: string; at: number; ids: string[] }> = [];
  const groupBy = (keyOf: (a: Appt) => string | null, kind: "person" | "contact") => {
    const by = new Map<string, Appt[]>();
    for (const a of live) { const k = keyOf(a); if (k) (by.get(k) ?? by.set(k, []).get(k)!).push(a); }
    for (const [k, list] of by) {
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].startAt - list[i - 1].startAt;
        if (kind === "person" && list[i].calendarId === list[i - 1].calendarId && gap === 0) continue; // group event
        const day = (x: Appt) => new Intl.DateTimeFormat("en-CA", { timeZone: validZone(tzOf(x.locationId)) }).format(new Date(x.startAt));
        const sameDay = kind === "contact" && Math.abs(gap) < DAY && day(list[i]) === day(list[i - 1]);
        if (gap < windowMs || sameDay) out.push({ kind, key: k, locationId: list[i].locationId, at: list[i].startAt, ids: [list[i - 1].id, list[i].id] });
      }
    }
  };
  groupBy((a) => (a.assignedTo ? `${a.locationId}:${a.assignedTo}` : null), "person");
  groupBy((a) => (a.contactId ? `${a.locationId}:${a.contactId}` : null), "contact");
  return out;
}

// ---------- the funnel (1.28) and what appointments are worth (1.12, 1.20) ----------

export function funnel(leads: Lead[], appts: Appt[], wonContacts: Set<string>, now: number, days = 90) {
  const inPeriod = leads.filter((l) => l.createdAt !== null && l.createdAt >= now - days * DAY);
  const key = (loc: string, id: string) => `${loc}:${id}`;
  const per = new Map<string, Appt[]>();
  for (const a of appts) if (a.contactId) (per.get(key(a.locationId, a.contactId)) ?? per.set(key(a.locationId, a.contactId), []).get(key(a.locationId, a.contactId))!).push(a);
  const keys: Record<"leads" | "booked" | "confirmed" | "showed" | "won", string[]> = { leads: [], booked: [], confirmed: [], showed: [], won: [] };
  for (const l of inPeriod) {
    const k = key(l.locationId, l.id);
    keys.leads.push(k);
    const list = (per.get(k) ?? []).filter(isActive);
    if (list.length === 0) continue;
    keys.booked.push(k);
    if (list.some((a) => a.status === "confirmed" || a.status === "showed")) keys.confirmed.push(k);
    if (list.some((a) => a.status === "showed")) keys.showed.push(k);
    if (wonContacts.has(k)) keys.won.push(k);
  }
  // "Customer" means a lead with at least one WON deal. It is the last step, so it only says something once outcomes are recorded.
  const steps = [
    { step: "Leads", count: keys.leads.length, members: keys.leads },
    { step: "Booked", count: keys.booked.length, members: keys.booked },
    { step: "Confirmed or showed", count: keys.confirmed.length, members: keys.confirmed },
    { step: "Showed", count: keys.showed.length, members: keys.showed },
    { step: "Became customers (won a deal)", count: keys.won.length, members: keys.won },
  ];
  const withDrop = steps.map((s, i) => ({ ...s, members: s.members.slice(0, FUNNEL_MEMBER_CAP), kept: i === 0 ? null : steps[i - 1].count ? s.count / steps[i - 1].count : null, before: i === 0 ? null : steps[i - 1].count }));
  // A "biggest leak" is only named when the step before it had at least FUNNEL_MIN_BASE leads: "100% lost" from 3 leads is noise, not news.
  const worst = withDrop.slice(1).filter((s) => s.kept !== null && (s.before as number) >= FUNNEL_MIN_BASE).sort((a, b) => (a.kept as number) - (b.kept as number))[0] ?? null;
  const lost = worst ? (worst.before as number) - worst.count : 0;
  return { steps: withDrop, biggestLeak: worst && lost > 0 ? (worst.count === 0 ? `None of the ${worst.before} leads before it reached "${worst.step}".` : `${Math.round((1 - (worst.kept as number)) * 100)}% (${lost} of ${worst.before}) are lost before "${worst.step}".`) : null };
}

/** A leak is named only when the step before it had at least this many leads. */
export const FUNNEL_MIN_BASE = 10;
const FUNNEL_MEMBER_CAP = 60;

// What a held appointment is worth: revenue won from contacts who showed, divided by showed appointments (1.20).
export function appointmentValue(appts: Appt[], wonValueByContact: Map<string, number>, now: number) {
  const showed = appts.filter((a) => a.status === "showed" && a.contactId && a.startAt > now - 180 * DAY && a.startAt < now);
  const contacts = new Set(showed.map((a) => `${a.locationId}:${a.contactId}`));
  let revenue = 0;
  for (const c of contacts) revenue += wonValueByContact.get(c) ?? 0;
  const perAppointment = showed.length >= 10 ? revenue / showed.length : null;
  return { showed: showed.length, revenue, perAppointment: perAppointment === null ? null : Math.round(perAppointment), upcoming: appts.filter((a) => isActive(a) && a.startAt >= now).length };
}

// ---------- forecast (1.17) ----------

export function volumeForecast(appts: Appt[], now: number) {
  const weeks: number[] = [];
  for (let w = 1; w <= 8; w++) {
    const to = now - (w - 1) * 7 * DAY;
    weeks.push(appts.filter((a) => isActive(a) && a.startAt >= to - 7 * DAY && a.startAt < to).length);
  }
  const nonzero = weeks.filter((n) => n > 0).length;
  if (nonzero < 4) return null;
  const mean = weeks.reduce((s, n) => s + n, 0) / weeks.length;
  const sd = Math.sqrt(weeks.reduce((s, n) => s + (n - mean) ** 2, 0) / weeks.length);
  return { low: Math.max(0, Math.round(mean - sd)), high: Math.round(mean + sd), expected: Math.round(mean), basedOnWeeks: weeks.length };
}

// ---------- the calendar health score (1.24) ----------

/** The score needs at least this many of its four checks to have something to judge; otherwise it is n/a. */
export const HEALTH_MIN_CHECKS = 3;

// A check whose input is missing (null) earns no points and is left out of the score: it says "n/a" and why, so missing data never helps or hurts.
// The score is the points earned out of the points the available checks could have given, as a number out of 100.
export function calendarHealth(input: { showRate: number | null; confirmedShare: number | null; unmarkedShare: number | null; fairnessSkewed: boolean | null; unmarked?: number; past?: number }) {
  const parts: Array<{ label: string; points: number | null; max: number; note: string }> = [
    { label: "Show rate", points: input.showRate === null ? null : Math.round(input.showRate * 40), max: 40, note: input.showRate === null ? "n/a: needs 5 recorded outcomes" : `${Math.round(input.showRate * 100)}% show` },
    { label: "Confirmations", points: input.confirmedShare === null ? null : Math.round(input.confirmedShare * 25), max: 25, note: input.confirmedShare === null ? "n/a: needs 3 appointments in the next 2 days" : `${Math.round(input.confirmedShare * 100)}% of the next 2 days confirmed` },
    {
      label: "Outcomes recorded", points: input.unmarkedShare === null ? null : Math.round((1 - Math.min(1, input.unmarkedShare)) * 20), max: 20,
      note: input.unmarkedShare === null ? "n/a: no past appointments in the last 30 days" : input.unmarkedShare === 0 ? "every past appointment has an outcome" : input.unmarked !== undefined && input.past !== undefined ? `${input.unmarked} of ${input.past} past appointments have no outcome recorded` : `${Math.round(input.unmarkedShare * 100)}% of past appointments have no outcome recorded`,
    },
    { label: "Fair distribution", points: input.fairnessSkewed === null ? null : input.fairnessSkewed ? 5 : 15, max: 15, note: input.fairnessSkewed === null ? "n/a: needs 2 people and 10 appointments" : input.fairnessSkewed ? "uneven across people" : "even" },
  ];
  const used = parts.filter((p) => p.points !== null);
  const earned = used.reduce((s, p) => s + (p.points as number), 0);
  const possible = used.reduce((s, p) => s + p.max, 0);
  const score = used.length >= HEALTH_MIN_CHECKS && possible > 0 ? Math.round((earned / possible) * 100) : null;
  return { score, parts, used: used.length, of: parts.length, band: score === null ? null : score >= 75 ? "healthy" : score >= 50 ? "watch" : "needs work" };
}

// ---------- the best-times grid: only above its minimum ----------

/** The grid needs this many recorded outcomes in all, and at least HEATMAP_MIN_CELLS cells that each have 5 outcomes, or it says nothing. */
export const HEATMAP_MIN_OUTCOMES = 30;
export const HEATMAP_MIN_CELLS = 3;
export function heatmapReadiness(cells: Heat[]) {
  const outcomes = cells.reduce((s, c) => s + c.held + c.noShow, 0);
  const rated = cells.filter((c) => c.showRate !== null).length;
  return { ready: outcomes >= HEATMAP_MIN_OUTCOMES && rated >= HEATMAP_MIN_CELLS, outcomes, ratedCells: rated, needOutcomes: HEATMAP_MIN_OUTCOMES };
}

// ---------- sources: a contact's source and the calendar it booked through are different things ----------

/**
 * Some platforms record the calendar page a person booked through as the contact's "source". That is a calendar, not a place the lead came from,
 * so those rows are folded into one line instead of being listed next to real sources like "Facebook". `calendarNames` are the account's own
 * calendar names; the match ignores capitals and spacing. This is an inference from names, so the line says what it is.
 */
export const CALENDAR_SOURCE_LABEL = "Booked through a calendar page";
export function splitSources<T extends { source: string; booked: number; held: number; noShow: number; ids?: string[] }>(rows: T[], calendarNames: Set<string>): Array<T & { showRate: number | null; outcomes: number; isCalendar: boolean }> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const names = new Set([...calendarNames].map(norm));
  const out: Array<T & { showRate: number | null; outcomes: number; isCalendar: boolean }> = [];
  const merged = { source: CALENDAR_SOURCE_LABEL, booked: 0, held: 0, noShow: 0, ids: [] as string[] } as unknown as T;
  let hasCalendar = false;
  for (const r of rows) {
    if (names.has(norm(r.source))) {
      hasCalendar = true;
      merged.booked += r.booked; merged.held += r.held; merged.noShow += r.noShow;
      (merged.ids as string[]).push(...(r.ids ?? []));
      continue;
    }
    const outcomes = r.held + r.noShow;
    out.push({ ...r, outcomes, showRate: outcomes >= 5 ? r.held / outcomes : null, isCalendar: false });
  }
  if (hasCalendar) {
    const outcomes = merged.held + merged.noShow;
    out.push({ ...merged, outcomes, showRate: outcomes >= 5 ? merged.held / outcomes : null, isCalendar: true });
  }
  return out.sort((a, b) => b.booked - a.booked);
}

// ---------- after the appointment: follow-up gaps (1.22) ----------

export function followUpGaps(appts: Appt[], lastOutbound: Map<string, number>, now: number) {
  const held = appts.filter((a) => a.status === "showed" && a.contactId && a.startAt > now - 14 * DAY && a.startAt < now - 2 * DAY);
  const gaps = held.filter((a) => (lastOutbound.get(`${a.locationId}:${a.contactId}`) ?? 0) < a.startAt + 3_600_000);
  return { held: held.length, withoutFollowUp: gaps.length, gapRate: held.length >= 5 ? gaps.length / held.length : null, contacts: gaps.slice(0, 15).map((a) => ({ contactId: a.contactId as string, locationId: a.locationId, at: a.startAt })) };
}

// ---------- the prep brief (1.8): plain sentences from what we know, no guessing ----------

export function prepBrief(f: { name: string; at: number; calendar: string | null; source: string | null; leadAddedAt: number | null; openDeals: number; openValue: number; wonBefore: number; previousAppointments: number; lastReplyHours: number | null; tags: string[] }, now = Date.now()): string {
  const bits: string[] = [];
  const when = new Date(f.at).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
  bits.push(`You are meeting ${f.name} on ${when}${f.calendar ? ` (${f.calendar})` : ""}.`);
  if (f.previousAppointments === 0) bits.push("This is their first appointment.");
  else bits.push(`They have had ${f.previousAppointments} appointment${f.previousAppointments === 1 ? "" : "s"} before.`);
  if (f.source) bits.push(`They came from ${f.source}${f.leadAddedAt ? `, ${Math.max(0, Math.round((now - f.leadAddedAt) / DAY))} days ago` : ""}.`);
  if (f.wonBefore > 0) bits.push(`They have bought from you ${f.wonBefore} time${f.wonBefore === 1 ? "" : "s"} before.`);
  if (f.openDeals > 0) bits.push(`${f.openDeals} open deal${f.openDeals === 1 ? "" : "s"} worth $${Math.round(f.openValue).toLocaleString("en-US")}.`);
  if (f.lastReplyHours !== null) bits.push(f.lastReplyHours < 24 ? "They messaged you in the last day." : `Their last message was ${Math.round(f.lastReplyHours / 24)} days ago.`);
  if (f.tags.length) bits.push(`Tags: ${f.tags.slice(0, 5).join(", ")}.`);
  return bits.join(" ");
}

export { hasOutcome };
