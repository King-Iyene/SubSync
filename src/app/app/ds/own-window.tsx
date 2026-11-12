"use client";

/** One line under the bar on a page that shows what is true right now (an audit, a clean-up list, a roster): it says the bar's dates do not narrow it, and why, so nothing looks filtered that is not. */
const WHY: Record<string, string> = {
  audit: "the audit checks every account as it is today.",
  cleanup: "it lists records that need fixing today, whenever they were created.",
  duplicates: "it lists duplicate records that exist today.",
  people: "it searches everyone in your accounts, however old the record, and lead intake lists what arrived and is still unsorted.",
  search: "it searches everyone in your accounts, however old the record.",
  calls: "call lists are built from today's records.",
  inbox: "it lists who is waiting for a reply now, however long ago they wrote.",
  onboarding: "setup checklists show progress as of today.",
  email: "sender health is as of today.",
};
export function RightNowNote({ view, label }: { view: string; label: string }) {
  const why = WHY[view];
  if (!why) return null;
  return <p className="mt-1.5 text-sm text-muted-foreground" data-testid="own-window-note">This page is about right now: {why} The dates in the bar ({label || "..."}) do not change it.</p>;
}
