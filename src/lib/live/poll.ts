// When the open lead panel asks the CRM again. Pure, so the schedule is unit tested. Normal pace 5 s; paused while the tab is hidden; stopped after 10 minutes without
// the person touching anything; a failure (or a 429) doubles the wait up to a minute, and a good answer resets it. Every 6th poll is a "full" read (notes, tasks, deals, appointments).
export const POLL_MS = 5_000;
export const MAX_BACKOFF_MS = 60_000;
export const IDLE_STOP_MS = 10 * 60_000;
export const FULL_EVERY = 6;

export type PollState = { failures: number; hidden: boolean; idleMs: number; polls: number };
export type PollPlan = { action: "poll" | "pause" | "stop"; delayMs: number; full: boolean };

export function pollPlan(s: PollState): PollPlan {
  if (s.idleMs >= IDLE_STOP_MS) return { action: "stop", delayMs: 0, full: false };
  if (s.hidden) return { action: "pause", delayMs: POLL_MS, full: false };
  const delayMs = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(s.failures, 6));
  return { action: "poll", delayMs, full: s.polls > 0 && s.polls % FULL_EVERY === 0 };
}
