import type { Attendee, Meeting } from "../analytics/meeting-intel.ts";
import { buildNote, type CrmRequest, type WriteResult } from "../ghl/crm-writes.ts";
import { isLive } from "../live-flags.ts";
import { planMeeting, retentionDays, type Candidate, type InboxReason, type Plan, type PlanTarget } from "./meeting-plan.ts";
import { renderNote, type Includes, type NoteInput } from "./note-template.ts";
import { accessibleAccounts, type InstalledAccount, type Person } from "./person.ts";
import { effectivePolicy, matrixFor, type Matrix, type PolicyFlags, type Preset } from "./policy.ts";

// What happens when a meeting arrives through ONE person's connection (INTEGRATIONS_SPEC sections 3.2, 5.2, 7, 10). The framework for stage E2a:
// find where it belongs (planMeeting), keep it for the person (one row per person, provider and meeting, so a retry changes nothing), and write
// the note into the matched contact as that person, through the one CRM write client (which is a dry run while WRITE_GHL_LIVE is off).
// Everything it needs from the outside is passed in (`IngestStore`, `write`), so the whole path is tested without a database or a network.

export type PersonalConnection = {
  id: string; installationId: string; provider: "fathom" | "zoom" | "google_meet"; person: Person; accountEmail: string | null;
};

export type PersonSettings = { masterSwitch: boolean; unmatchedMode: "inbox" | "discard"; preset: Preset; custom: unknown; previewConfirmedAt: number | null };

export type MeetingRow = {
  installationId: string; ownerUserId: string; connectionId: string; provider: string; providerMeetingId: string; startedAt: string | null; title: string | null;
  attendeeEmails: string[]; summary: string | null; actionItems: string[]; recordingUrl: string | null; status: "needs_contact" | "skipped" | "dry_run" | "saved" | "failed"; reason: string | null;
  expiresAt: number | null;
};

export type IngestStore = {
  installed: (installationId: string) => Promise<InstalledAccount[]>;
  /** The Users list's proof of which accounts a company staff member can open. Null when it cannot be proven (the default). */
  provenAccess: (installationId: string, userId: string) => Promise<string[] | null>;
  /** Contacts whose email is one of `emails`, in the given accounts ONLY. */
  candidates: (installationId: string, locationIds: string[], emails: string[]) => Promise<Candidate[]>;
  policies: (installationId: string, locationIds: string[]) => Promise<{ agency: unknown; accounts: Record<string, unknown> }>;
  settings: (installationId: string, userId: string) => Promise<PersonSettings>;
  writesToday: (installationId: string, userId: string, locationIds: string[]) => Promise<{ user: number; byAccount: Record<string, number> }>;
  /** Inserts the meeting for this person. Returns its id, or null when this person already has this meeting (a retry or a second delivery). */
  insertMeeting: (row: MeetingRow) => Promise<string | null>;
  updateMeeting: (id: string, status: MeetingRow["status"], reason: string | null, expiresAt?: number | null) => Promise<void>;
  recordWrite: (r: { installationId: string; meetingId: string; locationId: string; contactId: string; kind: "note"; ghlId: string | null; authoredBy: string }) => Promise<boolean>;
  bump: (connectionId: string, field: "saved" | "skipped") => Promise<void>;
  now: () => number;
  /** Emails this person told SubSync to always ignore ("Always ignore"). Optional: a store without it ignores nothing. */
  ignoredEmails?: (installationId: string, userId: string) => Promise<string[]>;
  /** Does this installation hold the permission to add notes to contacts? Optional: a store without it assumes yes. */
  hasWriteScope?: (installationId: string) => Promise<boolean>;
};

export type Writer = (a: { installationId: string; locationId: string; contactId: string; meetingId: string; request: CrmRequest }) => Promise<WriteResult>;

/** What the delivery adds to the meeting, for the note's header (all optional: a source that has none leaves the line out). */
export type DeliveryExtras = { internalEmails?: string[]; rep?: string | null; withNames?: string[]; durationMinutes?: number | null };

export type IngestResult =
  | { kind: "duplicate" }
  | { kind: "inbox"; meetingId: string; reason: string }
  | { kind: "discarded"; meetingId: string }
  | { kind: "ignored"; meetingId: string }
  | { kind: "written"; meetingId: string; targets: Array<{ locationId: string; contactId: string; outcome: Outcome }>; clips: number }
  | { kind: "kept"; meetingId: string; reason: "preview_needed" };

export type Outcome = WriteResult["outcome"] | "over_cap";

const emailsOf = (attendees: Attendee[]) => [...new Set(attendees.map((a) => a.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
const DAY = 86_400_000;

/** Which parts of the note an account's rules (already applied to `items`) allow in a contact note. */
export const includesOf = (items: Matrix): Includes => ({
  summary: items.summary === "note", actionItems: items.action_items === "note", recordingLink: items.recording_link === "note", attendeesAndDate: items.attendees_and_date === "note",
});

export const wantsNote = (i: Includes) => i.summary || i.actionItems || i.recordingLink || i.attendeesAndDate;

/**
 * Writes the note to each target that is allowed, as the person, one note per contact. Stops when the person's daily limit is reached. Returns what
 * happened to each target. Used for a meeting that just arrived, for a held meeting that was released, and for a meeting the person linked by hand.
 */
export async function deliverNotes(a: {
  conn: PersonalConnection; meetingId: string; targets: PlanTarget[]; input: NoteInput; store: IngestStore; write: Writer; sentToday: number; capFor: (locationId: string) => number;
}): Promise<{ done: Array<{ locationId: string; contactId: string; outcome: Outcome }>; clips: number }> {
  const { conn, store } = a;
  const done: Array<{ locationId: string; contactId: string; outcome: Outcome }> = [];
  let clips = 0;
  let count = a.sentToday;
  for (const t of a.targets) {
    clips += t.clips.length;
    if (!t.allowed) continue;
    // Only the contact note destination is built here; the comment and contact-field destinations arrive with stage E2b.
    const includes = includesOf(t.items);
    if (!wantsNote(includes)) continue;
    if (count >= a.capFor(t.locationId)) { done.push({ locationId: t.locationId, contactId: t.contactId, outcome: "over_cap" }); continue; }
    const body = renderNote(a.input, includes).text;
    const result = await a.write({ installationId: conn.installationId, locationId: t.locationId, contactId: t.contactId, meetingId: a.meetingId, request: buildNote({ contactId: t.contactId, body, userId: conn.person.userId }) });
    done.push({ locationId: t.locationId, contactId: t.contactId, outcome: result.outcome });
    count++;
    if (result.outcome === "written") await store.recordWrite({ installationId: conn.installationId, meetingId: a.meetingId, locationId: t.locationId, contactId: t.contactId, kind: "note", ghlId: result.id, authoredBy: conn.person.userId });
  }
  return { done, clips };
}

/** The meeting's final state after its notes were attempted. */
export function settle(done: Array<{ outcome: Outcome }>, live: boolean): { status: MeetingRow["status"]; reason: string | null; holdInInbox: boolean } {
  if (!live) return { status: "dry_run", reason: "WOULD WRITE", holdInInbox: false };
  if (done.some((d) => d.outcome === "written")) return { status: "saved", reason: done.some((d) => d.outcome !== "written") ? "partly_saved" : null, holdInInbox: false };
  if (done.length > 0 && done.every((d) => d.outcome === "needs_permission")) return { status: "needs_contact", reason: "needs_permission", holdInInbox: true };
  if (done.length > 0 && done.every((d) => d.outcome === "over_cap")) return { status: "needs_contact", reason: "over_daily_cap", holdInInbox: true };
  return { status: "failed", reason: "write_failed", holdInInbox: false };
}

/** Everything decided about a meeting before anything is stored or written: who may be matched, the rules of each account, the plan. */
export type Planned = {
  plan: Plan; policies: Record<string, PolicyFlags>; accounts: string[]; settings: PersonSettings; today: { user: number; byAccount: Record<string, number> };
  ignored: Set<string>; canWrite: boolean; waitDays: number;
};

export async function planFor(conn: PersonalConnection, emails: string[], extras: DeliveryExtras, store: IngestStore): Promise<Planned> {
  const { person, installationId } = conn;
  const installed = await store.installed(installationId);
  const proven = await store.provenAccess(installationId, person.userId);
  // Only accounts this person can reach are ever searched: a contact elsewhere is never even read.
  const accounts = accessibleAccounts(person, installed, proven);
  const [candidates, rules, settings, today, ignoredList, canWrite] = await Promise.all([
    accounts.length ? store.candidates(installationId, accounts, emails) : Promise.resolve([] as Candidate[]),
    store.policies(installationId, accounts),
    store.settings(installationId, person.userId),
    store.writesToday(installationId, person.userId, accounts),
    store.ignoredEmails ? store.ignoredEmails(installationId, person.userId) : Promise.resolve([] as string[]),
    store.hasWriteScope ? store.hasWriteScope(installationId) : Promise.resolve(true),
  ]);
  const policies: Record<string, PolicyFlags> = {};
  for (const id of accounts) policies[id] = effectivePolicy(rules.agency, rules.accounts[id]);
  const internalDomains = [...new Set(Object.values(policies).flatMap((p) => p.internalDomains))];
  const matrix: Matrix = matrixFor(settings.preset, settings.custom);
  const ignored = new Set(ignoredList.map((e) => e.trim().toLowerCase()));
  const plan: Plan = planMeeting({
    person, provider: conn.provider, installed, provenAccess: proven, attendeeEmails: emails,
    // The person's own account email, whatever the tool said was on their side, and the addresses they asked SubSync to always ignore are never matched.
    internalEmails: [...(conn.accountEmail ? [conn.accountEmail] : []), ...(extras.internalEmails ?? []), ...ignored],
    internalDomains, candidates, policies, settings: { masterSwitch: settings.masterSwitch, unmatchedMode: settings.unmatchedMode, matrix }, writesToday: today,
  });
  return { plan, policies, accounts, settings, today, ignored, canWrite, waitDays: retentionDays(policies, accounts) };
}

export async function ingestPersonalMeeting(
  conn: PersonalConnection, m: Meeting, providerMeetingId: string, store: IngestStore, write: Writer, extras: DeliveryExtras = {},
): Promise<IngestResult> {
  const { person, installationId } = conn;
  const emails = emailsOf(m.attendees);
  const { plan, policies, settings, today, ignored: ignoredSet, canWrite, waitDays } = await planFor(conn, emails, extras, store);

  const base: Omit<MeetingRow, "status" | "reason" | "expiresAt"> = {
    installationId, ownerUserId: person.userId, connectionId: conn.id, provider: conn.provider, providerMeetingId, startedAt: m.startedAt, title: m.title,
    attendeeEmails: emails, summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl,
  };
  // A row that keeps nothing but its identity, so a retry is still recognised.
  const bare = { ...base, title: null, attendeeEmails: [] as string[], summary: null, actionItems: [] as string[], recordingUrl: null, startedAt: null };

  if (plan.kind === "inbox" && plan.reason === "no_external_attendee" && emails.some((e) => ignoredSet.has(e))) {
    // The only outsiders were addresses the person said to always ignore: nothing is kept and nothing waits.
    const id = await store.insertMeeting({ ...bare, status: "skipped", reason: "ignored", expiresAt: null });
    if (id === null) return { kind: "duplicate" };
    await store.bump(conn.id, "skipped");
    return { kind: "ignored", meetingId: id };
  }
  if (plan.kind === "discard") {
    // "Do not keep it": only counted. The row holds no content, so a retry is still recognised.
    const id = await store.insertMeeting({ ...bare, status: "skipped", reason: plan.reason, expiresAt: null });
    if (id === null) return { kind: "duplicate" };
    await store.bump(conn.id, "skipped");
    return { kind: "discarded", meetingId: id };
  }
  const waits = async (reason: InboxReason): Promise<IngestResult> => {
    const id = await store.insertMeeting({ ...base, status: "needs_contact", reason, expiresAt: store.now() + (plan.kind === "inbox" ? plan.retentionDays : waitDays) * DAY });
    if (id === null) return { kind: "duplicate" };
    await store.bump(conn.id, "skipped");
    return { kind: "inbox", meetingId: id, reason };
  };
  if (plan.kind === "inbox") return waits(plan.reason);

  // A plan to write. Without the permission to add notes nothing is attempted, in a dry run too (a "WOULD WRITE" that could never succeed would mislead).
  if (!canWrite) return waits("needs_permission");
  // The first automatic write needs the person's confirmed preview (spec 5.2 D): until then the meeting waits in their inbox, and nothing is written.
  const live = isLive("WRITE_GHL_LIVE");
  if (settings.previewConfirmedAt === null) {
    const id = await store.insertMeeting({ ...base, status: "needs_contact", reason: "preview_needed", expiresAt: store.now() + waitDays * DAY });
    if (id === null) return { kind: "duplicate" };
    return { kind: "kept", meetingId: id, reason: "preview_needed" };
  }

  const id = await store.insertMeeting({ ...base, status: live ? "saved" : "dry_run", reason: live ? null : "WOULD WRITE", expiresAt: null });
  if (id === null) return { kind: "duplicate" };
  const input: NoteInput = {
    title: m.title, startedAt: m.startedAt, durationMinutes: extras.durationMinutes ?? null,
    attendeeNames: extras.withNames ?? m.attendees.map((a) => a.name ?? a.email ?? "").filter(Boolean), rep: extras.rep ?? person.name, tool: toolName(conn.provider),
    summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl,
  };
  const { done, clips } = await deliverNotes({
    conn, meetingId: id, targets: plan.targets, input, store, write, sentToday: today.user, capFor: (loc) => (policies[loc]?.dailyCapPerUser ?? 50),
  });
  const end = settle(done, live);
  if (end.status !== (live ? "saved" : "dry_run") || end.reason !== (live ? null : "WOULD WRITE")) {
    await store.updateMeeting(id, end.status, end.reason, end.holdInInbox ? store.now() + waitDays * DAY : null);
  }
  await store.bump(conn.id, end.holdInInbox ? "skipped" : "saved");
  return { kind: "written", meetingId: id, targets: done, clips };
}

/** The tool's name as the note says it. Only Fathom is built (stage E2a); the other tools name themselves when they are built. */
export const toolName = (provider: string) => (provider === "fathom" ? "Fathom" : "your meeting tool");
