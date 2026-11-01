// The sync schedule, in one place and with no database or network, so it is unit tested with fake clocks.
// What runs and when (the same words are shown to the user in the Sync status panel, from `scheduleSentences`):
//   - The scheduler wakes up every CRON_EVERY_MINUTES (vercel.json, `/api/cron/sync`).
//   - Every REFRESH_EVERY_MINUTES it re-reads conversations, appointments and reply times for every account, then recomputes alerts.
//   - Once a day it re-reads the full contact and deal lists.
//   - A change in the CRM (a webhook) queues a refresh of that account's area at once; the next scheduler wake-up works it off.
//   - The daily brief and the Monday email are checked every hour and sent at the hour the person chose.

export const CRON_EVERY_MINUTES = 5;
export const REFRESH_EVERY_MINUTES = 15;
// A refresh cycle is due when the previous one STARTED at least this long ago. It is measured from the start (not the finish) and with a
// one minute allowance: measured from the finish with a plain 15, a cycle that ends a few seconds after one scheduler tick missed the
// tick 15 minutes later by seconds, and every second tick was skipped, so the real cadence was 20 minutes (seen in the live history).
export const REFRESH_DUE_AFTER_MINUTES = REFRESH_EVERY_MINUTES - 1;
// Older than this and the screen says refresh is delayed, and the internal alarm is raised.
export const STALE_AFTER_MINUTES = 30;
// A sync that has been queued or running this long is "long-running": only then does the screen mention a sync in progress.
export const LONG_RUNNING_MINUTES = 10;
// How many hours after the chosen hour a late scheduler run may still send that day's brief. Beyond it the day is skipped rather than
// sending a "morning" message in the evening.
export const SEND_CATCHUP_HOURS = 3;

const MIN = 60_000;

/** Is a new refresh cycle due? `lastCycleStartedAt` is when the previous cycle was queued (milliseconds), or null if there never was one. */
export function refreshDue(lastCycleStartedAt: number | null, now: number): boolean {
  return lastCycleStartedAt === null || now - lastCycleStartedAt >= REFRESH_DUE_AFTER_MINUTES * MIN;
}

/**
 * When the next cycle will start (milliseconds). A cycle is queued by a scheduler wake-up, which happens on a grid of CRON_EVERY_MINUTES.
 * While jobs are still queued or running the next cycle waits for them, which the caller says separately ("running now").
 */
export function nextRefreshAt(lastCycleStartedAt: number | null, now: number): number {
  const due = lastCycleStartedAt === null ? now : Math.max(now, lastCycleStartedAt + REFRESH_DUE_AFTER_MINUTES * MIN);
  const grid = CRON_EVERY_MINUTES * MIN;
  return Math.ceil(due / grid) * grid;
}

/** The send window for a chosen local hour: from that hour until SEND_CATCHUP_HOURS later, never past the end of the local day. */
export function inSendWindow(localHour: number, chosenHour: number): boolean {
  return localHour >= chosenHour && localHour < Math.min(24, chosenHour + SEND_CATCHUP_HOURS);
}

/** The plain sentences the Sync status panel prints, so the screen says exactly what runs and when. */
export function scheduleSentences(): string[] {
  return [
    `Every ${REFRESH_EVERY_MINUTES} minutes SubSync reads conversations, appointments and reply times for every account, then re-checks your alerts.`,
    "Once a day it reads the full contact and deal lists again.",
    "When something changes in your CRM, that account is queued for a refresh straight away and it is picked up within a few minutes.",
    "The daily brief and the Monday email are checked every hour and go out at the hour and in the time zone you chose in Settings.",
  ];
}
