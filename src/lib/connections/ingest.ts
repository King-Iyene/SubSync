import type { Attendee, Meeting } from "../analytics/meeting-intel.ts";
import { crmNoteBody } from "../analytics/meeting-intel.ts";
import { buildNote, type CrmRequest, type WriteResult } from "../ghl/crm-writes.ts";
import { isLive } from "../live-flags.ts";
import { planMeeting, type Candidate, type Plan, type PlanTarget } from "./meeting-plan.ts";
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
  updateMeeting: (id: string, status: MeetingRow["status"], reason: string | null) => Promise<void>;
  recordWrite: (r: { installationId: string; meetingId: string; locationId: string; contactId: string; kind: "note"; ghlId: string | null; authoredBy: string }) => Promise<boolean>;
  bump: (connectionId: string, field: "saved" | "skipped") => Promise<void>;
  now: () => number;
};

export type Writer = (a: { installationId: string; locationId: string; contactId: string; meetingId: string; request: CrmRequest }) => Promise<WriteResult>;

export type IngestResult =
  | { kind: "duplicate" }
  | { kind: "inbox"; meetingId: string; reason: string }
  | { kind: "discarded"; meetingId: string }
  | { kind: "written"; meetingId: string; targets: Array<{ locationId: string; contactId: string; outcome: WriteResult["outcome"] }>; clips: number }
  | { kind: "kept"; meetingId: string; reason: "preview_needed" };

const emailsOf = (attendees: Attendee[]) => [...new Set(attendees.map((a) => a.email?.trim().toLowerCase()).filter((e): e is string => !!e))];

export async function ingestPersonalMeeting(conn: PersonalConnection, m: Meeting, providerMeetingId: string, store: IngestStore, write: Writer): Promise<IngestResult> {
  const { person, installationId } = conn;
  const installed = await store.installed(installationId);
  const proven = await store.provenAccess(installationId, person.userId);
  const emails = emailsOf(m.attendees);
  // Only accounts this person can reach are ever searched: a contact elsewhere is never even read.
  const accounts = accessibleAccounts(person, installed, proven);

  const [candidates, rules, settings, today] = await Promise.all([
    accounts.length ? store.candidates(installationId, accounts, emails) : Promise.resolve([] as Candidate[]),
    store.policies(installationId, accounts),
    store.settings(installationId, person.userId),
    store.writesToday(installationId, person.userId, accounts),
  ]);
  const policies: Record<string, PolicyFlags> = {};
  for (const id of accounts) policies[id] = effectivePolicy(rules.agency, rules.accounts[id]);
  const internalDomains = [...new Set(Object.values(policies).flatMap((p) => p.internalDomains))];
  const matrix: Matrix = matrixFor(settings.preset, settings.custom);

  const plan: Plan = planMeeting({
    person, provider: conn.provider, installed, provenAccess: proven, attendeeEmails: emails, internalEmails: conn.accountEmail ? [conn.accountEmail] : [], internalDomains,
    candidates, policies, settings: { masterSwitch: settings.masterSwitch, unmatchedMode: settings.unmatchedMode, matrix }, writesToday: today,
  });

  const base: Omit<MeetingRow, "status" | "reason" | "expiresAt"> = {
    installationId, ownerUserId: person.userId, connectionId: conn.id, provider: conn.provider, providerMeetingId, startedAt: m.startedAt, title: m.title,
    attendeeEmails: emails, summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl,
  };
  const day = 86_400_000;

  if (plan.kind === "discard") {
    // "Do not keep it": only counted. The row holds no content, so a retry is still recognised.
    const id = await store.insertMeeting({ ...base, title: null, attendeeEmails: [], summary: null, actionItems: [], recordingUrl: null, startedAt: null, status: "skipped", reason: plan.reason, expiresAt: null });
    if (id === null) return { kind: "duplicate" };
    await store.bump(conn.id, "skipped");
    return { kind: "discarded", meetingId: id };
  }
  if (plan.kind === "inbox") {
    const id = await store.insertMeeting({ ...base, status: "needs_contact", reason: plan.reason, expiresAt: store.now() + plan.retentionDays * day });
    if (id === null) return { kind: "duplicate" };
    await store.bump(conn.id, "skipped");
    return { kind: "inbox", meetingId: id, reason: plan.reason };
  }

  // A plan to write. The first automatic write needs the person's confirmed preview (spec 5.2 D): until then the meeting waits, and nothing is written.
  const live = isLive("WRITE_GHL_LIVE");
  const confirmed = settings.previewConfirmedAt !== null;
  const status: MeetingRow["status"] = !confirmed ? "skipped" : live ? "saved" : "dry_run";
  const id = await store.insertMeeting({ ...base, status, reason: !confirmed ? "preview_needed" : live ? null : "WOULD WRITE", expiresAt: null });
  if (id === null) return { kind: "duplicate" };
  if (!confirmed) return { kind: "kept", meetingId: id, reason: "preview_needed" };

  const body = crmNoteBody({ title: m.title, startedAt: m.startedAt, attendees: m.attendees, summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl });
  const done: Array<{ locationId: string; contactId: string; outcome: WriteResult["outcome"] }> = [];
  let clips = 0;
  for (const t of plan.targets as PlanTarget[]) {
    clips += t.clips.length;
    if (!t.allowed) continue;
    // Only the contact note destination is built here; the comment and contact-field destinations arrive with stage E2b.
    if (!Object.values(t.items).some((d) => d === "note")) continue;
    const result = await write({ installationId, locationId: t.locationId, contactId: t.contactId, meetingId: id, request: buildNote({ contactId: t.contactId, body, userId: person.userId }) });
    done.push({ locationId: t.locationId, contactId: t.contactId, outcome: result.outcome });
    if (result.outcome === "written") await store.recordWrite({ installationId, meetingId: id, locationId: t.locationId, contactId: t.contactId, kind: "note", ghlId: result.id, authoredBy: person.userId });
  }
  const anyWritten = done.some((d) => d.outcome === "written");
  if (!live) await store.updateMeeting(id, "dry_run", "WOULD WRITE");
  else if (!anyWritten) await store.updateMeeting(id, "failed", "write_failed");
  await store.bump(conn.id, "saved");
  return { kind: "written", meetingId: id, targets: done, clips };
}
