import { FIELD_FOR_ITEM, type FieldMapping } from "./contact-fields.ts";
import { accessibleAccounts, type InstalledAccount, type Person } from "./person.ts";
import { clipChoices, DEFAULT_POLICY, effectiveChoices, ITEMS, matrixFor, type Clip, type Matrix, type PersonChoices, type PolicyFlags } from "./policy.ts";

// Where a meeting goes (INTEGRATIONS_SPEC sections 3.2 and 7, CLAUDE.md principle 13). Pure and deterministic: given who the person is, the contacts
// that match the attendees, and the rules of each account, it says either "write to these contacts, under these accounts' rules" or "put it in the
// person's private Meeting inbox, for this reason". It never guesses:
//   - only EXTERNAL attendees are matched (the account's own users and internal domains are ignored);
//   - only among accounts this person can access (a contact in any other account is not even looked at);
//   - an email that two records have (duplicates in one account, or the same email in two client accounts) decides nothing: inbox;
//   - names and phone numbers never match, only exact email;
//   - no more than 5 contacts per meeting.

export const MAX_CONTACTS_PER_MEETING = 5;

export type Candidate = { locationId: string; contactId: string; email: string };

export type InboxReason = "no_external_attendee" | "no_match" | "duplicate_contact" | "cross_account" | "writes_off" | "provider_not_allowed" | "over_daily_cap" | "needs_permission" | "preview_needed";

/** The plain sentence for each reason, as the Meeting inbox shows it. */
export const INBOX_MESSAGE: Record<InboxReason, string> = {
  no_external_attendee: "Everyone in this meeting works with you, so there is no contact to add it to.",
  no_match: "Nobody in this meeting is in your contacts. It is in your Meeting inbox for 14 days.",
  duplicate_contact: "Two contact records have the same email, so SubSync did not guess. Pick the right one.",
  cross_account: "The same email is a contact in more than one client account, so SubSync did not guess. Pick the right one.",
  writes_off: "Saving to the CRM is switched off for you or for this account, so it waits here.",
  provider_not_allowed: "This account does not allow notes from this tool, so it waits here.",
  over_daily_cap: "The daily limit for notes was reached, so it waits here.",
  needs_permission: "Needs permission: reconnect. SubSync cannot add notes to contacts yet, so this call waits here.",
  preview_needed: "This call matched a contact. SubSync is waiting for your OK on how the first note looks, so nothing was added yet.",
};

export type PlanInput = {
  person: Person;
  provider: string;
  installed: InstalledAccount[];
  /** The accounts the Users list proves a company staff member can open. Null when it could not be proven. */
  provenAccess: string[] | null;
  attendeeEmails: string[];
  /** Emails of the account's own users, and domains that are internal (the company's own), never matched. */
  internalEmails: string[];
  internalDomains: string[];
  /** Contacts found by email. Rows from accounts the person cannot access are ignored here as well. */
  candidates: Candidate[];
  /** The effective policy (company default and account rule, most restrictive) of each client account. */
  policies: Record<string, PolicyFlags>;
  /** `choices` (stage E2b) is the person's own choices; with it, each account's setup (default layout, locks) is applied per account and `matrix` is only the fallback. */
  settings: { masterSwitch: boolean; unmatchedMode: "inbox" | "discard"; matrix: Matrix; choices?: PersonChoices };
  writesToday: { user: number; byAccount: Record<string, number> };
  /** The contact fields each account's admin mapped (stage E2b). Left out: no field is available anywhere. */
  mappings?: Record<string, FieldMapping[]>;
  /** Does the install hold the permission to add conversation comments? Left out: not checked. */
  canComment?: boolean;
};

export type PlanTarget = {
  locationId: string;
  contactId: string;
  email: string;
  /** False when the account's rule or a limit stops the write; the meeting stays with the person. */
  allowed: boolean;
  blockedBecause: InboxReason | null;
  /** Each item's real destination after the account's rules clipped the person's choice. */
  items: Matrix;
  clips: Clip[];
  /** The person's own text layout under this account's rules (null: the default layout). */
  template: string | null;
  /** The contact fields this account's admin mapped, on or off (the preview and the log say why one was left out). */
  mappings: FieldMapping[];
};

export type Plan =
  | { kind: "write"; targets: PlanTarget[]; leftOut: number }
  | { kind: "inbox"; reason: InboxReason; message: string; retentionDays: number }
  | { kind: "discard"; reason: "no_match" | "no_external_attendee" };

const clean = (e: string) => e.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The days a meeting nobody could be matched to waits: the shortest retention among the accounts the person can reach (default 14). */
export function retentionDays(policies: Record<string, PolicyFlags>, accessible: string[]): number {
  const days = accessible.map((id) => (policies[id] ?? DEFAULT_POLICY).inboxRetentionDays);
  return days.length ? Math.min(...days) : DEFAULT_POLICY.inboxRetentionDays;
}

/** One contact and the rules of its account: what may be written there, and whether a limit stops it today. */
export function targetFor(c: Candidate, i: Pick<PlanInput, "policies" | "settings" | "provider" | "writesToday" | "mappings" | "canComment">): PlanTarget {
  const policy = i.policies[c.locationId] ?? DEFAULT_POLICY;
  // The account's setup sits over the person's choices: its default layout for someone who never chose, and its locks.
  const eff = i.settings.choices ? effectiveChoices(i.settings.choices, policy) : null;
  const matrix = eff ? matrixFor(eff.choices.preset, eff.choices.custom) : i.settings.matrix;
  const mappings = i.mappings?.[c.locationId] ?? [];
  const mapped = new Set(mappings.filter((m) => m.enabled).map((m) => m.item));
  const fieldItems = i.mappings ? ITEMS.filter((item) => FIELD_FOR_ITEM[item].some((f) => mapped.has(f))) : undefined;
  const { items, clips, writesAllowed } = clipChoices(matrix, policy, i.settings.masterSwitch, fieldItems !== undefined || i.canComment !== undefined ? { fieldItems, canComment: i.canComment } : undefined);
  const wantsCrm = Object.values(items).some((d) => d === "note" || d === "comment" || d === "field");
  let blocked: InboxReason | null = null;
  if (!policy.providers.includes(i.provider)) blocked = "provider_not_allowed";
  else if (!writesAllowed || !wantsCrm) blocked = "writes_off";
  else if (i.writesToday.user >= policy.dailyCapPerUser || (i.writesToday.byAccount[c.locationId] ?? 0) >= policy.dailyCapPerAccount) blocked = "over_daily_cap";
  return { locationId: c.locationId, contactId: c.contactId, email: c.email, allowed: blocked === null, blockedBecause: blocked, items, clips, template: eff?.choices.template ?? null, mappings };
}

export function planMeeting(i: PlanInput): Plan {
  const accessible = accessibleAccounts(i.person, i.installed, i.provenAccess);
  const days = retentionDays(i.policies, accessible);
  const unmatched = (reason: "no_match" | "no_external_attendee"): Plan =>
    i.settings.unmatchedMode === "discard" ? { kind: "discard", reason } : { kind: "inbox", reason, message: INBOX_MESSAGE[reason].replace("14 days", `${days} days`), retentionDays: days };

  const internalEmails = new Set(i.internalEmails.map(clean));
  const internalDomains = new Set(i.internalDomains.map((d) => clean(d).replace(/^@/, "")));
  const external = [...new Set(i.attendeeEmails.map(clean))].filter((e) => EMAIL.test(e) && !internalEmails.has(e) && !internalDomains.has(e.split("@")[1]));
  if (external.length === 0) return unmatched("no_external_attendee");

  const reachable = new Set(accessible);
  const byEmail = new Map<string, Candidate[]>();
  for (const c of i.candidates) {
    const email = clean(c.email);
    if (!reachable.has(c.locationId) || !external.includes(email)) continue;
    const list = byEmail.get(email) ?? [];
    if (!list.some((x) => x.locationId === c.locationId && x.contactId === c.contactId)) list.push({ ...c, email });
    byEmail.set(email, list);
  }

  // One email, one record: certain. One email, several records: nothing is chosen, and the whole meeting waits for a person.
  let ambiguous: InboxReason | null = null;
  const certain: Candidate[] = [];
  for (const email of external) {
    const records = byEmail.get(email) ?? [];
    if (records.length === 1) certain.push(records[0]);
    else if (records.length > 1) {
      const crossAccount = new Set(records.map((r) => r.locationId)).size > 1;
      ambiguous = crossAccount ? "cross_account" : ambiguous ?? "duplicate_contact";
    }
  }
  if (ambiguous) return { kind: "inbox", reason: ambiguous, message: INBOX_MESSAGE[ambiguous], retentionDays: days };

  const unique = [...new Map(certain.map((c) => [`${c.locationId}:${c.contactId}`, c])).values()];
  if (unique.length === 0) return unmatched("no_match");
  const chosen = unique.slice(0, MAX_CONTACTS_PER_MEETING);

  const targets: PlanTarget[] = chosen.map((c) => targetFor(c, i));

  if (targets.every((t) => !t.allowed)) {
    const reason = targets[0].blockedBecause as InboxReason;
    return { kind: "inbox", reason, message: INBOX_MESSAGE[reason], retentionDays: days };
  }
  return { kind: "write", targets, leftOut: unique.length - chosen.length };
}
