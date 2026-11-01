// Appointment analysis. Pure (no database or network imports) so it can be unit tested.
//
// Platform statuses: new, confirmed, cancelled, showed, noshow, invalid. A past appointment still
// marked new or confirmed has no outcome recorded, which hides the real show rate, so it is
// reported separately instead of being guessed at.

export type Appt = {
  id: string;
  locationId: string;
  calendarId: string | null;
  calendarName: string | null;
  contactId: string | null;
  status: string;
  startAt: number; // ms
  createdAt: number | null; // ms
  assignedTo: string | null;
};

const DAY = 86_400_000;
const GRACE_MS = 3 * 3_600_000; // an appointment is "over" a few hours after it starts

/** A recorded outcome count of at least this many gives a rate; a CHANGE in a rate or in bookings needs this many in the period it is compared with. */
export const MIN_OUTCOMES_FOR_RATE = 5;
export const MIN_BASELINE_FOR_CLAIM = 10;

export const isActive = (a: Appt) => a.status !== "cancelled" && a.status !== "invalid";
export const hasOutcome = (a: Appt) => a.status === "showed" || a.status === "noshow";
export const needsOutcome = (a: Appt, now: number) => isActive(a) && !hasOutcome(a) && a.startAt < now - GRACE_MS;

export type Rates = {
  held: number; noShow: number; cancelled: number; booked: number; unmarked: number;
  /** Appointments with a recorded outcome (showed or no-show): what a show rate is built on. */
  outcomes: number;
  /** showed / (showed + noshow), or null with fewer than 5 recorded outcomes. */
  showRate: number | null;
  noShowRate: number | null;
  /** cancelled / everything that was scheduled to start in the window */
  cancelRate: number | null;
};

// Appointments that were due to start inside [from, to). `booked` counts everything scheduled, not
// just what was held.
export function rates(appts: Appt[], from: number, to: number, now: number): Rates {
  // Invalid appointments (spam, test or mistaken bookings) were never real, so they are in no figure.
  const inWindow = appts.filter((a) => a.startAt >= from && a.startAt < to && a.status !== "invalid");
  const held = inWindow.filter((a) => a.status === "showed").length;
  const noShow = inWindow.filter((a) => a.status === "noshow").length;
  const cancelled = inWindow.filter((a) => a.status === "cancelled").length;
  const decided = held + noShow;
  return {
    held, noShow, cancelled, booked: inWindow.length, outcomes: decided, unmarked: inWindow.filter((a) => needsOutcome(a, now)).length,
    showRate: decided >= MIN_OUTCOMES_FOR_RATE ? held / decided : null,
    noShowRate: decided >= MIN_OUTCOMES_FOR_RATE ? noShow / decided : null,
    cancelRate: inWindow.length >= 5 ? cancelled / inWindow.length : null,
  };
}

export function overview(appts: Appt[], now: number) {
  const last30 = rates(appts, now - 30 * DAY, now, now);
  const prior30 = rates(appts, now - 60 * DAY, now - 30 * DAY, now);
  const next7 = appts.filter((a) => isActive(a) && a.startAt >= now && a.startAt < now + 7 * DAY);
  const next48 = next7.filter((a) => a.startAt < now + 2 * DAY);
  return {
    last30, prior30,
    upcoming7: next7.length,
    // Booked but never confirmed, starting in the next two days: worth a reminder.
    unconfirmed48: next48.filter((a) => a.status === "new"),
    unmarked: appts.filter((a) => needsOutcome(a, now) && a.startAt >= now - 30 * DAY),
  };
}

// No-shows in the last `days` days whose contact has not been booked again since.
export function noShowRecovery(appts: Appt[], now: number, days = 14): Appt[] {
  const latestBooked = new Map<string, number>();
  for (const a of appts) {
    if (!a.contactId || !isActive(a) || a.status === "noshow") continue;
    latestBooked.set(a.contactId, Math.max(latestBooked.get(a.contactId) ?? 0, a.startAt));
  }
  const seen = new Set<string>();
  return appts
    .filter((a) => a.status === "noshow" && a.contactId && a.startAt >= now - days * DAY && a.startAt <= now)
    .filter((a) => (latestBooked.get(a.contactId!) ?? 0) <= a.startAt)
    .sort((x, y) => y.startAt - x.startAt)
    .filter((a) => (seen.has(a.contactId!) ? false : (seen.add(a.contactId!), true)));
}

export type Breakdown = { key: string; label: string; locationId: string | null; booked: number; held: number; noShow: number; cancelled: number; showRate: number | null };

// Show rate per calendar or per person over the last 30 days.
export function breakdown(appts: Appt[], now: number, by: "calendar" | "person"): Breakdown[] {
  const groups = new Map<string, Appt[]>();
  for (const a of appts.filter((x) => x.startAt >= now - 30 * DAY && x.startAt < now)) {
    const key = by === "calendar" ? a.calendarId ?? "none" : a.assignedTo ?? "unassigned";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  return [...groups.entries()].map(([key, list]) => {
    const r = rates(list, 0, Number.MAX_SAFE_INTEGER, now);
    return { key, label: by === "calendar" ? list[0].calendarName ?? "Calendar" : key, locationId: list[0].locationId, booked: list.length, held: r.held, noShow: r.noShow, cancelled: r.cancelled, showRate: r.showRate };
  }).sort((a, b) => b.booked - a.booked);
}

// What changed, in words, so the page can lead with it.
export function headline(last: Rates, prior: Rates): string[] {
  const out: string[] = [];
  // A claim about change needs a real baseline in both periods: "down 100%" from three appointments is noise, not news.
  if (last.showRate !== null && prior.showRate !== null && last.outcomes >= MIN_BASELINE_FOR_CLAIM && prior.outcomes >= MIN_BASELINE_FOR_CLAIM) {
    const d = Math.round((last.showRate - prior.showRate) * 100);
    if (Math.abs(d) >= 5) out.push(`Show rate ${d > 0 ? "rose" : "fell"} ${Math.abs(d)} points to ${Math.round(last.showRate * 100)}%.`);
  }
  if (prior.booked >= MIN_BASELINE_FOR_CLAIM) {
    const d = Math.round(((last.booked - prior.booked) / prior.booked) * 100);
    if (Math.abs(d) >= 15) out.push(`Bookings are ${d > 0 ? "up" : "down"} ${Math.abs(d)}% on the 30 days before.`);
  }
  if (last.unmarked > 0) out.push(`${last.unmarked} past appointment${last.unmarked === 1 ? " has" : "s have"} no outcome recorded, so the real show rate is hidden.`);
  return out;
}
