import { isLive } from "../live-flags.ts";
import { deliverNotes, includesOf, planFor, settle, toolName, type IngestStore, type PersonalConnection, type Writer } from "./ingest.ts";
import { INBOX_MESSAGE, targetFor, type InboxReason } from "./meeting-plan.ts";
import { renderNote, SAMPLE_NOTE_INPUT, type NoteInput } from "./note-template.ts";
import { accessibleAccounts, type Person } from "./person.ts";
import { matrixFor } from "./policy.ts";

// The Meeting inbox (INTEGRATIONS_SPEC sections 5.2 and 12, notes N93 and roadmap E2a item 5): every call that nobody could be matched to with certainty,
// and the first calls that wait for the person's OK. PRIVATE to the person who recorded it: every function takes the signed-in person and finds only that
// person's own rows. The person picks the account AND the contact explicitly (Link); SubSync never picks one for them. Pure: the database is `InboxStore`.

export type StoredMeeting = {
  id: string; ownerUserId: string; connectionId: string | null; installationId: string; provider: "fathom" | "zoom" | "google_meet"; title: string | null; startedAt: string | null;
  attendeeEmails: string[]; summary: string | null; actionItems: string[]; recordingUrl: string | null; status: string; reason: string | null; expiresAt: number | null; createdAt: number;
};

export type ContactHit = { locationId: string; contactId: string; name: string | null; email: string | null; phone: string | null };

export type InboxStore = IngestStore & {
  /** One of THIS person's own meetings (owner and installation both checked in the query). */
  getMeeting: (installationId: string, userId: string, id: string) => Promise<StoredMeeting | null>;
  /** The person's meetings that wait in the inbox (needs_contact), oldest expiry first. */
  listWaiting: (installationId: string, userId: string) => Promise<StoredMeeting[]>;
  /** The contact, only if it is in this account of this installation. */
  contactIn: (installationId: string, locationId: string, contactId: string) => Promise<ContactHit | null>;
  /** A search by name, email or phone ONLY inside the given accounts. */
  searchContacts: (installationId: string, locationIds: string[], q: string) => Promise<ContactHit[]>;
  /** Removes the call's content and keeps only its identity (so a retry is still recognised). Only if it is this person's own waiting call. */
  scrub: (installationId: string, userId: string, id: string, reason: "dismissed" | "ignored") => Promise<boolean>;
  addIgnored: (installationId: string, userId: string, email: string) => Promise<void>;
  /** Takes a held call (waiting for the first-save OK) for release; false when somebody already took it. */
  claimHeld: (installationId: string, userId: string, id: string) => Promise<boolean>;
  confirmPreview: (installationId: string, person: Person) => Promise<void>;
  getConnection: (installationId: string, userId: string) => Promise<PersonalConnection | null>;
};

export type ReasonKind = "unmatched" | "held" | "permission";

/** The kind of waiting call a reason is: held calls wait for the person's OK, the rest wait for a person to pick a contact. */
export function kindOf(reason: string | null): ReasonKind {
  if (reason === "preview_needed") return "held";
  if (reason === "needs_permission") return "permission";
  return "unmatched";
}

export const messageFor = (reason: string | null, days?: number): string => {
  const base = reason && reason in INBOX_MESSAGE ? INBOX_MESSAGE[reason as InboxReason] : "SubSync could not decide where this call belongs, so it waits here.";
  return days !== undefined ? base.replace("14 days", `${days} days`) : base;
};

export const daysLeft = (expiresAt: number | null, now: number): number | null => (expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 86_400_000)));

/** The note input for a stored call. Names and duration were not kept, so the header lists email addresses. */
export function noteInputOf(m: StoredMeeting, repName: string | null): NoteInput {
  return {
    title: m.title, startedAt: m.startedAt, durationMinutes: null, attendeeNames: m.attendeeEmails, rep: repName, tool: toolName(m.provider),
    summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl,
  };
}

// ---------------- what a finished call says about itself ----------------

/** The plain sentence a person reads for a call that is NOT waiting: what happened, and when nothing was saved, exactly why (KF-5). */
export function outcomeWords(status: string, reason: string | null, notes: number): string {
  if (status === "saved") return notes > 1 ? `Added to ${notes} contacts in your CRM.` : notes === 1 ? "Added to the contact in your CRM." : "Added to your CRM.";
  if (status === "dry_run") return "Test mode: SubSync worked out where this note goes and wrote nothing to your CRM yet.";
  if (status === "failed") return "Nothing was saved: your CRM did not accept the note. It will not be tried again by itself.";
  if (status === "skipped") {
    if (reason === "dismissed") return "You dismissed this call. Nothing was saved.";
    if (reason === "ignored") return "Nothing was saved: you asked SubSync to always ignore this person.";
    if (reason === "no_match" || reason === "no_external_attendee") return "Nothing was saved: nobody on this call matched a contact, and you chose not to keep such calls.";
    return "Nothing was saved.";
  }
  return "Waiting for you.";
}

// ---------------- the first-save preview ----------------

/** What the preview shows: the note as it will really look. A real waiting call when there is one, otherwise a clearly marked sample. */
export function previewFor(held: StoredMeeting | null, person: Person, matrixItems: ReturnType<typeof matrixFor>): { sample: boolean; text: string; shortened: boolean } {
  const input = held ? noteInputOf(held, person.name) : SAMPLE_NOTE_INPUT;
  const made = renderNote(input, includesOf(matrixItems));
  return { sample: held === null, text: made.text, shortened: made.shortened };
}

// ---------------- actions ----------------

export type LinkResult =
  | { ok: true; dryRun: boolean; notes: number }
  | { ok: false; code: "not_found" | "not_allowed" | "needs_permission" | "write_failed" | "confirm_first"; message: string };

export type LinkPick = { locationId: string; contactId: string };

/**
 * The person picked an account and a contact for a waiting call. The pick is checked again here: the account must be one the person can open, the contact
 * must be in that account, the call must be the person's own and still waiting. The note then goes through the same rules and the same dry-run client as an
 * automatic one (the account's policy, the daily limit, the permission).
 */
export async function linkMeeting(store: InboxStore, person: Person, installationId: string, meetingId: string, pick: LinkPick, write: Writer): Promise<LinkResult> {
  const row = await store.getMeeting(installationId, person.userId, meetingId);
  if (!row || row.status !== "needs_contact") return { ok: false, code: "not_found", message: "That call is not in your inbox any more." };
  if (kindOf(row.reason) === "held") return { ok: false, code: "confirm_first", message: "Check how the first note looks and confirm it first. Then this call is added by itself." };
  const installed = await store.installed(installationId);
  const proven = await store.provenAccess(installationId, person.userId);
  const accounts = accessibleAccounts(person, installed, proven);
  if (!accounts.includes(pick.locationId)) return { ok: false, code: "not_found", message: "That contact was not found in an account you can open." };
  const hit = await store.contactIn(installationId, pick.locationId, pick.contactId);
  if (!hit) return { ok: false, code: "not_found", message: "That contact was not found in an account you can open." };
  if (store.hasWriteScope && !(await store.hasWriteScope(installationId))) return { ok: false, code: "needs_permission", message: "Needs permission: reconnect. SubSync cannot add notes to contacts yet." };

  const conn = row.connectionId ? await store.getConnection(installationId, person.userId) : null;
  const connection: PersonalConnection = conn ?? { id: row.connectionId ?? "", installationId, provider: row.provider, person, accountEmail: null };
  const ctx = await planFor(connection, [], {}, store);
  const target = targetFor({ locationId: hit.locationId, contactId: hit.contactId, email: hit.email ?? "" }, {
    policies: ctx.policies, provider: row.provider, writesToday: ctx.today,
    settings: { masterSwitch: ctx.settings.masterSwitch, unmatchedMode: ctx.settings.unmatchedMode, matrix: matrixFor(ctx.settings.preset, ctx.settings.custom) },
  });
  if (!target.allowed) return { ok: false, code: "not_allowed", message: INBOX_MESSAGE[(target.blockedBecause ?? "writes_off") as InboxReason] };

  const live = isLive("WRITE_GHL_LIVE");
  const { done } = await deliverNotes({ conn: connection, meetingId: row.id, targets: [target], input: noteInputOf(row, person.name), store, write, sentToday: ctx.today.user, capFor: (loc) => ctx.policies[loc]?.dailyCapPerUser ?? 50 });
  const end = settle(done, live);
  if (end.holdInInbox || end.status === "failed") {
    return end.reason === "needs_permission"
      ? { ok: false, code: "needs_permission", message: "Needs permission: reconnect. SubSync cannot add notes to contacts yet." }
      : { ok: false, code: "write_failed", message: "Your CRM did not accept the note. Nothing was saved. Try again in a moment." };
  }
  await store.updateMeeting(row.id, end.status, end.reason, null);
  if (row.connectionId) await store.bump(row.connectionId, "saved");
  return { ok: true, dryRun: !live, notes: done.filter((d) => d.outcome === "written").length };
}

export async function dismissMeeting(store: InboxStore, person: Person, installationId: string, meetingId: string): Promise<boolean> {
  return store.scrub(installationId, person.userId, meetingId, "dismissed");
}

/** "Always ignore this email": the address must be one of this call's own attendees. The call is dismissed too. */
export async function alwaysIgnore(store: InboxStore, person: Person, installationId: string, meetingId: string, email: string): Promise<boolean> {
  const row = await store.getMeeting(installationId, person.userId, meetingId);
  const wanted = email.trim().toLowerCase();
  if (!row || row.status !== "needs_contact" || !row.attendeeEmails.some((e) => e.toLowerCase() === wanted)) return false;
  await store.addIgnored(installationId, person.userId, wanted);
  return store.scrub(installationId, person.userId, meetingId, "ignored");
}

/** A search for a contact, only inside the accounts this person can open (and, if they chose one, only that one). */
export async function findContacts(store: InboxStore, person: Person, installationId: string, q: string, locationId: string | null): Promise<ContactHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const installed = await store.installed(installationId);
  const proven = await store.provenAccess(installationId, person.userId);
  const accounts = accessibleAccounts(person, installed, proven);
  const within = locationId ? accounts.filter((a) => a === locationId) : accounts;
  if (within.length === 0) return [];
  return store.searchContacts(installationId, within, term.slice(0, 80));
}

/**
 * The person confirmed the first note. From now on notes are added by themselves, and the calls that were held for this OK are released now: each is planned
 * again under today's rules, so a held call is only ever written under the same checks as a new one.
 */
export async function confirmAndRelease(store: InboxStore, person: Person, installationId: string, write: Writer): Promise<{ released: number; stillWaiting: number }> {
  await store.confirmPreview(installationId, person);
  const held = (await store.listWaiting(installationId, person.userId)).filter((m) => kindOf(m.reason) === "held").slice(0, 50);
  const conn = await store.getConnection(installationId, person.userId);
  let released = 0;
  let stillWaiting = 0;
  if (!conn) return { released, stillWaiting: held.length };
  const live = isLive("WRITE_GHL_LIVE");
  for (const m of held) {
    if (!(await store.claimHeld(installationId, person.userId, m.id))) continue;
    const ctx = await planFor(conn, m.attendeeEmails, {}, store);
    const day = 86_400_000;
    if (ctx.plan.kind === "write" && ctx.canWrite) {
      const { done } = await deliverNotes({ conn, meetingId: m.id, targets: ctx.plan.targets, input: noteInputOf(m, person.name), store, write, sentToday: ctx.today.user + released, capFor: (loc) => ctx.policies[loc]?.dailyCapPerUser ?? 50 });
      const end = settle(done, live);
      await store.updateMeeting(m.id, end.status, end.reason, end.holdInInbox ? store.now() + ctx.waitDays * day : null);
      if (end.holdInInbox || end.status === "failed") stillWaiting++; else { released++; await store.bump(conn.id, "saved"); }
    } else {
      const reason: InboxReason = ctx.plan.kind === "inbox" ? ctx.plan.reason : !ctx.canWrite ? "needs_permission" : "no_match";
      await store.updateMeeting(m.id, "needs_contact", reason, store.now() + ctx.waitDays * day);
      stillWaiting++;
    }
  }
  return { released, stillWaiting };
}
