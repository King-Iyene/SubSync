// Possible matches for a call that waits in the person's private Meeting inbox (CLAUDE.md principles 12 and 13). Pure.
// The matcher (meeting-plan.ts) only ever acts on CERTAIN: one exact email, one contact. Everything here is a SUGGESTION: it shows evidence and the person confirms
// with one click. A suggestion is never written by itself:
//   - the same email on several contacts (one account or several): "same email" suggestions, one per contact, with the account and the last activity;
//   - the same mailbox with a plus tag ("ada+crm@x.com" and "ada@x.com"): "plus tag" suggestion;
//   - the same full name as an outside invitee: "same name" suggestion.

export const MAX_SUGGESTIONS = 8;

/** One address, written the one way we compare it: trimmed, lower case, without a mailto: prefix or angle brackets. */
export function normEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (e: string): boolean => EMAIL.test(e);

/** The address without its "+tag" ("ada+crm@x.com" gives "ada@x.com"), or null when it has no tag. Used ONLY to suggest, never to decide. */
export function plusBase(email: string): string | null {
  const e = normEmail(email);
  const at = e.lastIndexOf("@");
  if (at < 1) return null;
  const local = e.slice(0, at);
  const plus = local.indexOf("+");
  if (plus < 1) return null;
  return `${local.slice(0, plus)}${e.slice(at)}`;
}

/** The pieces a database search needs to find "same mailbox, different tag" in both directions. */
export function plusSearch(emails: string[]): { bases: string[]; patterns: string[] } {
  const bases = new Set<string>();
  const patterns = new Set<string>();
  for (const raw of emails) {
    const e = normEmail(raw);
    if (!isEmail(e)) continue;
    const base = plusBase(e);
    if (base) bases.add(base);
    const at = e.lastIndexOf("@");
    const local = (base ?? e).slice(0, (base ?? e).lastIndexOf("@"));
    // a contact saved WITH a tag while the call has the plain address: ada+anything@domain
    patterns.add(`${local.replace(/[\\%_]/g, (c) => `\\${c}`)}+%${e.slice(at).replace(/[\\%_]/g, (c) => `\\${c}`)}`);
  }
  return { bases: [...bases], patterns: [...patterns] };
}

/** A full name worth looking for: at least two words and five letters (a first name alone matches far too many people). */
export function usableNames(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const s = n.replace(/\s+/g, " ").trim();
    if (s.length >= 5 && s.length <= 80 && s.includes(" ") && !s.includes("@") && !/[%_\\]/.test(s)) out.add(s);
  }
  return [...out].slice(0, 6);
}

export type Hit = { locationId: string; contactId: string; email: string | null; name: string | null; lastActivityAt: string | null; via: "exact" | "plus" | "name" };
export type SuggestionKind = "same_email" | "plus_tag" | "same_name";
export type Suggestion = { kind: SuggestionKind; locationId: string; contactId: string; name: string | null; email: string | null; lastActivityAt: string | null; evidence: string };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Turns what the database found into suggestions. `emails` are the call's outside addresses (already normalised), `names` the outside invitees' names,
 * `reachable` the accounts this person can open (a hit anywhere else is dropped here as a last line of defence), `skip` contacts that are already certain.
 * The same-email suggestions appear only when an address belongs to more than one contact (a lone contact is the matcher's business, not a suggestion).
 */
export function suggest(input: { emails: string[]; names: string[]; hits: Hit[]; reachable: string[]; skip?: Array<{ locationId: string; contactId: string }> }): Suggestion[] {
  const reachable = new Set(input.reachable);
  const skip = new Set((input.skip ?? []).map((s) => `${s.locationId}:${s.contactId}`));
  const emails = new Set(input.emails.map(normEmail));
  const bases = new Set(input.emails.map((e) => plusBase(e)).filter((b): b is string => !!b));
  const names = new Set(input.names.map(clean));
  const hits = input.hits.filter((h) => reachable.has(h.locationId));

  const exactCount = new Map<string, number>();
  for (const h of hits) if (h.via === "exact" && h.email) exactCount.set(normEmail(h.email), (exactCount.get(normEmail(h.email)) ?? 0) + 1);

  const out = new Map<string, Suggestion>();
  const put = (h: Hit, kind: SuggestionKind, evidence: string) => {
    const key = `${h.locationId}:${h.contactId}`;
    if (skip.has(key) || out.has(key)) return;
    out.set(key, { kind, locationId: h.locationId, contactId: h.contactId, name: h.name, email: h.email, lastActivityAt: h.lastActivityAt, evidence });
  };
  for (const h of hits) {
    const e = h.email ? normEmail(h.email) : "";
    if (h.via === "exact" && e && emails.has(e) && (exactCount.get(e) ?? 0) > 1) put(h, "same_email", "Same email as an attendee. Another contact has it too, so SubSync did not choose.");
  }
  for (const h of hits) {
    const e = h.email ? normEmail(h.email) : "";
    if (h.via !== "plus" || !e) continue;
    const mine = plusBase(e) ?? e;
    if (emails.has(e)) continue; // an exact address is not a plus-tag suggestion
    if (bases.has(mine) || emails.has(mine)) put(h, "plus_tag", "Same mailbox as an attendee, written with a different tag after a plus sign.");
  }
  for (const h of hits) {
    if (h.via === "name" && names.has(clean(h.name))) put(h, "same_name", "Same full name as an attendee. Names can be shared by different people, so please check.");
  }
  return [...out.values()].slice(0, MAX_SUGGESTIONS);
}

/** The plain reason a call is still waiting, for the inbox line under it. `attendees` counts the outside email addresses we hold for it. */
export function plainReason(reason: string | null, attendees: number, suggestions: number): string {
  if (suggestions > 0 && (reason === "no_match" || reason === "no_attendee_emails" || reason === "no_external_attendee")) return "No contact has an attendee's exact email, but SubSync found people who may be them. Check below.";
  switch (reason) {
    case "no_attendee_emails": return "Fathom did not send anyone's email for this call (for example a call that was not on a calendar invite), so SubSync cannot tell who it was with. Search for the lead below.";
    case "no_external_attendee": return attendees === 0
      ? "Fathom did not send anyone's email for this call (for example a call that was not on a calendar invite), so SubSync cannot tell who it was with. Search for the lead below."
      : "Everyone on this call works with you, so there is no contact to add it to. If a client was on it, search for the lead below.";
    case "no_match": return attendees === 1 ? "The attendee's email is not in your CRM yet." : "None of the attendees' emails is in your CRM yet.";
    default: return "";
  }
}
