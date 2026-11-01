"use client";

// The last error ID this person saw on screen, kept in memory only (never stored, never sent by itself). "Report a problem" reads it so the report carries the
// ID the error state showed, without the person copying it by hand (N87). The error state also asks for the report form through an event.
let last: string | null = null;
export const rememberErrorId = (id: string | null): void => { if (id) last = id; };
export const lastErrorId = (): string | null => last;

export const REPORT_EVENT = "subsync:report-problem";
export function openProblemReport(errorId: string | null): void {
  rememberErrorId(errorId);
  try { window.dispatchEvent(new CustomEvent(REPORT_EVENT, { detail: { errorId } })); } catch { /* an old browser: the footer link still works */ }
}
