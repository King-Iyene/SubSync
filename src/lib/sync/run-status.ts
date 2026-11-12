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
  /** Every step of this run with its own state and time (at most 60). */
  steps?: StepRow[];
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

// ---- each step shows its own state and time; a slow or stuck sync says so (never an endless "Syncing...") ----

export type StepState = "waiting" | "running" | "done" | "failed";
export type StepRow = { type: string; label: string; locationId: string; name: string | null; state: StepState; ms: number | null; error: string | null };

const STEP_LABELS: Record<string, string> = {
  locations: "Client list", structure: "Account details", contacts: "People", opportunities: "Deals", conversations: "Conversations", appointments: "Appointments", speed: "Reply times", metrics: "Numbers",
};
export const stepLabel = (type: string): string => STEP_LABELS[type] ?? "Data";

/** Rows of sync_jobs (any order) as the steps shown in the popup: waiting (not started), running (with the time so far), done or failed (with the time it took). */
export function stepRows(
  rows: Array<{ type: string; location_id: string; status: string; started_at: Date | string | null; finished_at: Date | string | null; error: string | null }>,
  names: Map<string, string | null>, now: number,
): StepRow[] {
  const at = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v));
  return rows.map((r) => {
    const s = at(r.started_at), f = at(r.finished_at);
    const state: StepState = r.status === "done" ? "done" : r.status === "failed" ? "failed" : s !== null && r.status === "running" ? "running" : "waiting";
    const ms = s === null ? null : Math.max(0, (state === "running" || state === "waiting" ? now : f ?? now) - s);
    return { type: r.type, label: stepLabel(r.type), locationId: r.location_id, name: names.get(r.location_id) ?? null, state, ms, error: r.error ? String(r.error).slice(0, 160) : null };
  });
}

/** "4 s", "1 min 20 s". */
export function stepTime(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export const SLOW_AFTER_MS = 45_000;
export const STUCK_AFTER_MS = 120_000;
export type Verdict = "working" | "slow" | "stuck";
/** How the popup talks while something is still open: after 45 s "taking longer than usual", after 2 minutes it stops waiting and says which step is holding it up. */
export function verdict(elapsedMs: number, steps: StepRow[]): { kind: Verdict; text: string } {
  const open = steps.filter((x) => x.state === "running" || x.state === "waiting");
  const holder = [...open].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))[0];
  const who = holder ? `${holder.label}${holder.name ? ` for ${holder.name}` : ""}` : "one step";
  if (elapsedMs >= STUCK_AFTER_MS) return { kind: "stuck", text: `This is taking too long. ${who} has not finished. It keeps going in the background and is tried again automatically; you can leave this open or press Sync again.` };
  if (elapsedMs >= SLOW_AFTER_MS) return { kind: "slow", text: `Taking longer than usual. Waiting for: ${who}.` };
  return { kind: "working", text: "" };
}
