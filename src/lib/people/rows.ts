// The words on one person's row (stage PEOPLE). Pure, so they are unit tested. A row is one line with the name and one line of reason: why the person is on a call list, or
// (in a plain search) how to reach them. Nothing here is a number the page counts; it only says what the row already holds.

export type RowFacts = {
  name: string; why?: string | null; locationName?: string | null; phone?: string | null; email?: string | null; ownerName?: string | null; owner?: string | null;
  lastActivityAt?: string | null; dateAdded?: string | null; dnd?: boolean;
};

const DAY = 86_400_000;

/** "active today", "active 3 days ago", "added 2 days ago", or "no activity recorded". */
export function activityWords(p: Pick<RowFacts, "lastActivityAt" | "dateAdded">, nowMs: number): string {
  const t = p.lastActivityAt ? Date.parse(p.lastActivityAt) : NaN;
  const a = p.dateAdded ? Date.parse(p.dateAdded) : NaN;
  const use = Number.isFinite(t) ? { ms: t, word: "active" } : Number.isFinite(a) ? { ms: a, word: "added" } : null;
  if (!use) return "no activity recorded";
  const days = Math.max(0, Math.floor((nowMs - use.ms) / DAY));
  return days === 0 ? `${use.word} today` : days === 1 ? `${use.word} yesterday` : `${use.word} ${days} days ago`;
}

/**
 * The second line of a row. On a call list (`why` is set): why, then the client account (only when several are shown), then the owner. In a plain search: the phone, the email, the
 * client account, and when they were last active. Parts that are not known are left out, never replaced by a placeholder.
 */
export function rowLine(p: RowFacts, o: { showAccount: boolean; nowMs: number }): string {
  const bits: string[] = [];
  if (p.why) {
    bits.push(p.why);
    if (o.showAccount && p.locationName) bits.push(p.locationName);
    bits.push(p.owner ? `Owner ${p.ownerName ?? ""}`.trim() : "No owner");
  } else {
    if (p.phone) bits.push(p.phone);
    if (p.email) bits.push(p.email);
    if (o.showAccount && p.locationName) bits.push(p.locationName);
    bits.push(activityWords(p, o.nowMs));
  }
  return bits.join(" · ");
}

/** The details of one row as a line of text for the clipboard. */
export function rowText(p: RowFacts, showAccount: boolean): string {
  return [p.name, showAccount ? p.locationName ?? "" : "", p.phone ?? "", p.email ?? "", p.why ?? ""].filter(Boolean).join(", ");
}

/** The list as plain text, one person a line (name, phone, email, account, reason), for a message or a spreadsheet. Tab separated. */
export function listText(rows: readonly RowFacts[], showAccount: boolean): string {
  return rows.map((p) => [p.name, p.phone ?? "", p.email ?? "", showAccount ? p.locationName ?? "" : "", p.why ?? ""].join("\t")).join("\n");
}

// ---------------- searching and "Mine" inside a list that was already read ----------------

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const digitsOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

import { searchTerm } from "./queue.ts";

/** A person matches the typed words by name, email, phone digits (three or more) or client account: the same things a person would look at. Accents and case are ignored. */
export function matchesPerson(p: { name: string; email: string | null; phone: string | null; locationName: string | null }, q: string): boolean {
  const t = norm(q.trim());
  if (!t) return true;
  if (norm(`${p.name} ${p.email ?? ""} ${p.locationName ?? ""}`).includes(t)) return true;
  // Only something that looks like a phone number is also looked for in the phone numbers (an email that holds digits is not).
  const term = searchTerm(q);
  const d = digitsOf(q);
  return term.ok && term.kind === "phone" && d.length >= 3 && digitsOf(p.phone).includes(d);
}

/** "Mine": the person is assigned to the one asking (for a no-show, the booking is). Nobody is "mine" when the asker's id is unknown. */
export const isMine = (p: { owner: string | null; assignee?: string | null }, meId: string | null): boolean => meId !== null && (p.owner === meId || (p.assignee ?? null) === meId);
