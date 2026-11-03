// Pure helpers for lead sources, birthdays and team figures. No database imports, so they can be
// unit tested.
import { winRateOf } from "./metrics.ts";
import { resolveUser, type UsersState } from "./people-labels.ts";

// Days from `today` until the next birthday (0 = today). A 29 February birthday is celebrated on
// 28 February in years without one. Returns null for a value that is not a real date.
export function daysUntilBirthday(birthDate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const on = (year: number) => {
    const d = new Date(Date.UTC(year, month - 1, day));
    // 29 Feb in a non-leap year rolls into March; pull it back to 28 Feb.
    return d.getUTCMonth() === month - 1 ? d.getTime() : Date.UTC(year, month - 1, 28);
  };
  let next = on(today.getUTCFullYear());
  if (next < start) next = on(today.getUTCFullYear() + 1);
  return Math.round((next - start) / 86_400_000);
}

export type SourceRow = { source: string; contacts: number; new30: number; won: number; wonValue: number };

// Share of a source's contacts that became a won deal, or null when there are too few contacts to say.
export function sourceConversion(row: Pick<SourceRow, "contacts" | "won">, minContacts = 10): number | null {
  return row.contacts >= minContacts ? row.won / row.contacts : null;
}

export type TeamRow = {
  userId: string;
  name: string | null;
  openCount: number;
  openValue: number;
  staleCount: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  contacts: number;
  avgCycleDays: number | null;
};

// One minimum for every win rate in the product (metrics.ts): 20 closed deals, so a quiet month never reads as a 100% record.
export function teamWinRate(row: Pick<TeamRow, "wonCount" | "lostCount">): number | null {
  return winRateOf(row.wonCount, row.lostCount).rate;
}

// Pace figures over the last 30 days. A rate or a typical time built on a handful of cases is noise, so each needs a minimum.
export const MIN_REPLIES_FOR_PACE = 3;
export const MIN_OUTCOMES_FOR_SHOW_RATE = 5;
export type PaceRow = { replies: number; medianSeconds: number | null; held: number; noShow: number; lastReplyAt?: number | null };
// A person who has replied to leads in the last 30 days but not for this many hours is flagged as idle.
export const IDLE_HOURS = 24;
export const paceOf = (r: PaceRow, now = Date.now()) => ({
  lastReplyHoursAgo: r.lastReplyAt == null ? null : Math.max(0, Math.round((now - r.lastReplyAt) / 3_600_000)),
  idle: r.lastReplyAt != null && (now - r.lastReplyAt) / 3_600_000 >= IDLE_HOURS,
  replies: r.replies,
  medianReplySeconds: r.replies >= MIN_REPLIES_FOR_PACE ? r.medianSeconds : null,
  held: r.held,
  noShow: r.noShow,
  showRate: r.held + r.noShow >= MIN_OUTCOMES_FOR_SHOW_RATE ? r.held / (r.held + r.noShow) : null,
});

// What to call someone we only know by id (N21, S3-a): never the id and never a placeholder made from it. A name the app has is used as it is;
// without one the screen says why: the team list was read and the person is not in it ("Former team member"), or it could not be read
// ("Needs permission: reconnect").
export function teamLabel(userId: string, name: string | null, usersAccess?: UsersState): string {
  if (name) return name;
  return userId === "unassigned" ? "Unassigned" : resolveUser(userId, new Map(), usersAccess).label;
}
