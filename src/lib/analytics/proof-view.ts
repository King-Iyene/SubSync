import type { Proof } from "./today-queue.ts";

// The Proof tab in plain words. "Problems found" is what the app calls a raised alert, "Fixed" a cleared one and "Still to fix" an open one. Pure, unit tested.

export const PROOF_WORDS = {
  found: { label: "Problems found", info: "Times SubSync spotted something wrong, like a lead nobody answered." },
  fixed: { label: "Fixed", info: "The problem is gone from your CRM data. We cannot tell if a person fixed it or it went away on its own." },
  open: { label: "Still to fix", info: "Problems that are still there right now." },
} as const;

/** The same proof for one client only (the numbers are recounted from the alerts, never scaled). */
export function filterProof(p: Proof, locationId: string | null): Proof {
  if (!locationId) return p;
  const days = p.days.map((d) => ({ ...d, raised: d.raised.filter((a) => a.locationId === locationId), cleared: d.cleared.filter((a) => a.locationId === locationId) }));
  const openAlerts = p.openAlerts.filter((a) => a.locationId === locationId);
  return { raised: days.reduce((s, d) => s + d.raised.length, 0), cleared: days.reduce((s, d) => s + d.cleared.length, 0), open: openAlerts.length, days, openAlerts };
}

const n = (k: number, one: string, more: string) => `${k.toLocaleString("en-US")} ${k === 1 ? one : more}`;
/** "This week SubSync found 8 problems. 3 are fixed. 5 still need you." */
export function proofHeadline(p: Proof): string {
  if (p.raised === 0 && p.open === 0) return "This week SubSync found no problems.";
  return `This week SubSync found ${n(p.raised, "problem", "problems")}. ${p.cleared} ${p.cleared === 1 ? "is" : "are"} fixed. ${p.open} still ${p.open === 1 ? "needs" : "need"} you.`;
}

/** Text to paste to a client. Only counts, never the names of other clients. */
export function proofSummary(p: Proof, who: string): string {
  return `${who}: ${proofHeadline(p)} (Last 7 days. "Fixed" means the problem is no longer showing in your CRM data.)`;
}
