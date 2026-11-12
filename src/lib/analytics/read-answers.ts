// Round 6 speed: pure rules for the stored finished answers of the heavy screens (table read_answers, migration 20261229090000). The database part is read-answers-db.ts.

/** Reads whose finished answer is stored: the first segment of the address. The live race and anything that changes data are never stored. */
export const STORED_READS = new Set(["today", "speed", "appointments", "clients", "cleanup", "accounts", "overview"]);
export const ANSWER_FRESH_MS = 5 * 60_000;
export const ANSWER_STALE_MS = 30 * 60_000;

export function storable(method: string, segments: string[], search: URLSearchParams): boolean {
  if (method !== "GET" || !STORED_READS.has(segments[0] ?? "")) return false;
  if (segments[0] === "speed" && (search.get("part") === "race" || segments[1] === "race")) return false;
  return true;
}

/** The key: who is asking and the exact address without the "Try again" marker, so one person's answer is never handed to another and a retry stores under the normal key. */
export function answerStoreKey(who: string, pathname: string, search: URLSearchParams): string {
  const q = new URLSearchParams(search); q.delete("_r"); q.sort();
  return `${who}|${pathname}?${q.toString()}`;
}

export type StoredAnswer = { body: string; ageMs: number; dirty: boolean };
export type AnswerVerdict = "fresh" | "stale" | "unusable";
export function judgeAnswer(a: StoredAnswer | null): AnswerVerdict {
  if (!a || a.dirty) return "unusable";
  return a.ageMs <= ANSWER_FRESH_MS ? "fresh" : a.ageMs <= ANSWER_STALE_MS ? "stale" : "unusable";
}
