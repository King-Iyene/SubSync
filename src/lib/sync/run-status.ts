// The "Sync now" button: the throttle (one sync per account per 30 seconds) and the words of the status popup. Pure, so it is unit-tested.
export const SYNC_THROTTLE_MS = 30_000;

/** Whether a sync may start now. `lastStartedAt` is when the latest sync of this account (or of the whole company) was queued. */
export function throttle(lastStartedAt: number | null, now: number, windowMs = SYNC_THROTTLE_MS): { ok: true } | { ok: false; retryAfterSec: number } {
  if (lastStartedAt === null || now - lastStartedAt >= windowMs) return { ok: true };
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - lastStartedAt)) / 1000)) };
}

export type AccountProgress = { locationId: string; name: string | null; pending: number; done: number; failed: number };
export type RunState = "idle" | "syncing" | "done" | "error";
export type RunStatus = {
  state: RunState; startedAt: string | null; lastFinishedAt: string | null; accounts: AccountProgress[]; progress: { done: number; total: number };
  changed: { contacts: number; conversations: number; appointments: number };
  /** What changed, per account, biggest first (at most 10): "Bright Smile Dental: 12 contacts, 3 conversations". */
  changes: Array<{ locationId: string; name: string | null; contacts: number; conversations: number; appointments: number }>;
  errors: Array<{ locationId: string | null; error: string }>;
};

/** Syncing while anything is queued or running; error when something failed and nothing is left; done otherwise. */
export function runState(a: { pending: number; failed: number; done: number }): RunState {
  if (a.pending > 0) return "syncing";
  if (a.failed > 0) return "error";
  return a.done > 0 ? "done" : "idle";
}

const n = (v: number, one: string, many: string) => `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;
/** "Synced just now: 12 contacts, 3 conversations, 1 appointment updated". */
export function changedLine(c: { contacts: number; conversations: number; appointments: number }): string {
  const parts = [n(c.contacts, "contact", "contacts"), n(c.conversations, "conversation", "conversations"), n(c.appointments, "appointment", "appointments")];
  return `${parts.join(", ")} updated`;
}

export function progressWords(p: { done: number; total: number }): string {
  return p.total <= 0 ? "Starting..." : `${p.done.toLocaleString("en-US")} of ${p.total.toLocaleString("en-US")} steps done`;
}
