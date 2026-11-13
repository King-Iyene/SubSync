import { after } from "next/server";

/** Run work that must not delay the answer (a log line, a background rebuild) AFTER the response is sent, and keep the function alive until it finishes (a bare un-awaited promise can be frozen when the response ends on a serverless host). Outside a request (scripts, tests) it simply runs. Never throws. */
export function runAfter(work: () => Promise<unknown>): void {
  const safe = () => work().catch(() => undefined);
  try { after(safe); } catch { void safe(); }
}
