// Round 6 speed: pure rules for the stored finished answers of the heavy screens (table read_answers, migration 20261229090000). The database part is read-answers-db.ts.

/** Reads whose finished answer is stored: the first segment of the address. The live race and anything that changes data are never stored. */
// Perf round: every module's first-screen reads are stored (the first open of a module was 5 to 30 statements per read), not only Today, Speed to lead, Appointments and Clients.
// Left out on purpose: reads that are live by nature or hold a person's own working state (settings, people lists and marks, call queue, meeting notes, connections, roadmap votes, notifications, sync status, the dial status).
export const STORED_READS = new Set([
  "today", "speed", "appointments", "clients", "cleanup", "accounts", "overview",
  "today3", "exec-summary", "pipeline-intel", "finance", "payments", "cash", "wg", "br", "clients2", "clients3", "proof", "people3", "team", "pipeline3", "audit", "dq", "cu", "workflows", "appointment-insights", "contact-intel",
]);
/** Parts that are a file download or a live view: never stored. */
const NEVER_STORED_PARTS = new Set(["race", "export"]);
/** ANSWER_STORE=off turns the stored answers off for a process (the perf script uses it so a measurement never writes to the database; also a kill switch). */
export const answerStoreOn = (env: Record<string, string | undefined> = process.env): boolean => env.ANSWER_STORE !== "off";
export const ANSWER_FRESH_MS = 5 * 60_000;
export const ANSWER_STALE_MS = 30 * 60_000;

export function storable(method: string, segments: string[], search: URLSearchParams): boolean {
  if (method !== "GET" || !STORED_READS.has(segments[0] ?? "")) return false;
  if (segments[0] === "speed" && (search.get("part") === "race" || segments[1] === "race")) return false;
  if (NEVER_STORED_PARTS.has(search.get("part") ?? "") || segments[1] === "export") return false;
  // The audit's share links and the audit read for a share token are settings-like writes elsewhere; only the plain reads are stored.
  if (segments[0] === "audit" && segments[1] === "shares") return false;
  if (segments[0] === "workflows" && segments.length > 1) return false;
  return true;
}

/** The key: who is asking and the exact address without the "Try again" marker, so one person's answer is never handed to another and a retry stores under the normal key. */
export function answerStoreKey(who: string, pathname: string, search: URLSearchParams): string {
  const q = new URLSearchParams(search); q.delete("_r"); q.sort();
  return `${who}|${pathname}?${q.toString()}`;
}

export type StoredAnswer = { body: string; ageMs: number; dirty: boolean; /** When it was made (epoch ms), for the comparison with the data-changed signal. */ computedAtMs?: number };
export type AnswerVerdict = "fresh" | "stale" | "unusable";
/** `dataVersionMs` is the newest "rows changed" time of the installation (src/lib/sync/data-version.ts): an answer made before it is shown at once but rebuilt in the background ("stale"), never called fresh. */
export function judgeAnswer(a: StoredAnswer | null, dataVersionMs?: number): AnswerVerdict {
  if (!a || a.dirty) return "unusable";
  if (a.ageMs > ANSWER_STALE_MS) return "unusable";
  if (a.ageMs > ANSWER_FRESH_MS) return "stale";
  if (dataVersionMs !== undefined && a.computedAtMs !== undefined && a.computedAtMs < dataVersionMs) return "stale";
  return "fresh";
}
