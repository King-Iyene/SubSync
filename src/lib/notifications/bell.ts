// The in-app notification centre (the bell): what is shown, what counts as unread, dismiss and snooze. Pure, no database or network, so the rules are
// tested with fake clocks. Per person: one person dismissing or snoozing an item does not change it for anyone else.

import { localClock } from "../analytics/digest-intel.ts";
import type { Severity } from "./catalog.ts";
import type { Link } from "./compose.ts";

export type BellItem = {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  body: string | null;
  link: Link;
  locationId: string | null;
  createdAt: number;
  readAt: number | null;
  dismissedAt: number | null;
  snoozedUntil: number | null;
  /** True once the alert behind the item was fixed. A fixed problem leaves the bell by itself. */
  resolved: boolean;
};

/** Items older than this are not shown any more. */
export const BELL_DAYS = 14;
export const BELL_LIMIT = 50;

const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** What the bell lists now: not dismissed, not snoozed (until its time), not fixed, not older than BELL_DAYS. Most severe first, then newest. */
export function visibleItems(items: BellItem[], now: number): BellItem[] {
  const oldest = now - BELL_DAYS * 86_400_000;
  return items
    .filter((i) => !i.dismissedAt && !i.resolved && i.createdAt >= oldest && !(i.snoozedUntil !== null && i.snoozedUntil > now))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.createdAt - a.createdAt)
    .slice(0, BELL_LIMIT);
}

/** The number on the bell: visible items not yet read. */
export const unreadCount = (items: BellItem[], now: number): number => visibleItems(items, now).filter((i) => !i.readAt).length;

export type SnoozeChoice = "1h" | "4h" | "tomorrow";
export const SNOOZE_CHOICES: Array<{ id: SnoozeChoice; label: string }> = [{ id: "1h", label: "1 hour" }, { id: "4h", label: "4 hours" }, { id: "tomorrow", label: "Until tomorrow morning" }];
export const isSnoozeChoice = (v: unknown): v is SnoozeChoice => v === "1h" || v === "4h" || v === "tomorrow";
/** The hour "tomorrow morning" means. */
export const MORNING_HOUR = 8;

/** When a snoozed item comes back. "Tomorrow morning" is the next 08:00 in the person's time zone (a zone that cannot be read counts as UTC). */
export function snoozeUntil(choice: SnoozeChoice, now: number, zone: string): number {
  if (choice === "1h") return now + 3_600_000;
  if (choice === "4h") return now + 4 * 3_600_000;
  const here = localClock(new Date(now), zone) ?? localClock(new Date(now), "UTC");
  const z = localClock(new Date(now), zone) ? zone : "UTC";
  // Step a quarter hour at a time to the first moment the local clock reads 08 on a LATER local date. Works across daylight-saving changes, which move the UTC time but not the local one.
  for (let t = now + 15 * 60_000; t <= now + 48 * 3_600_000; t += 15 * 60_000) {
    const c = localClock(new Date(t), z);
    if (c && c.hour === MORNING_HOUR && c.date !== here?.date) return t - (t % (15 * 60_000));
  }
  return now + 24 * 3_600_000;
}

/** The short phrase for how old an item is, for the list. */
export function ageText(createdAt: number, now: number): string {
  const m = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
