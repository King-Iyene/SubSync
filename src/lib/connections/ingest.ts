import type { Attendee, Meeting } from "../analytics/meeting-intel.ts";
import { buildComment, buildFieldUpdate, buildNote, type CrmRequest, type WriteResult } from "../ghl/crm-writes.ts";
import { isLive } from "../live-flags.ts";
import { planFieldWrites, type FieldItem, type FieldMapping, type FieldPlan } from "./contact-fields.ts";
import { composeDelivery, includesFor, type DeliveryInput, type Limits } from "./delivery.ts";
import { planMeeting, retentionDays, type Candidate, type InboxReason, type Plan, type PlanTarget } from "./meeting-plan.ts";
import type { Includes } from "./note-template.ts";
import { accessibleAccounts, type InstalledAccount, type Person } from "./person.ts";
import { DEFAULT_CHOICES, effectiveChoices, effectivePolicy, matrixFor, type Matrix, type PersonChoices, type PolicyFlags, type Preset } from "./policy.ts";
import { cleanPriority, decideSource, type SeenMeeting } from "./source-priority.ts";

// What happens when a meeting arrives through ONE person's connection (INTEGRATIONS_SPEC sections 3.2, 5.2, 7, 10). The framework for stage E2a:
// find where it belongs (planMeeting), keep it for the person (one row per person, provider and meeting, so a retry changes nothing), and write
// the note into the matched contact as that person, through the one CRM write client (which is a dry run while WRITE_GHL_LIVE is off).
// Everything it needs from the outside is passed in (`IngestStore`, `write`), so the whole path is tested without a database or a network.

export type PersonalConnection = {
  id: string; installationId: string; provider: "fathom" | "zoom" | "google_meet"; person: Person; accountEmail: string | null;
};

export type PersonSettings = {
  masterSwitch: boolean; unmatchedMode: "inbox" | "discard"; preset: Preset; custom: unknown; previewConfirmedAt: number | null;
  /** Stage E2b, all optional so older callers keep working: the person's own text layout, whether they ever picked a layout, and their tool order. */
  template?: string | null; presetChosen?: boolean; sourcePriority?: string[];
};

/** The person's own choices, ready for the account rules to sit over them. */
export const choicesOf = (s: PersonSettings): PersonChoices => ({
  preset: s.preset, presetChosen: s.presetChosen ?? false, custom: s.custom, template: s.template ?? null, unmatchedMode: s.unmatchedMode,
  sourcePriority: cleanPriority(s.sourcePriority ?? DEFAULT_CHOICES.sourcePriority),
});

export type MeetingRow = {
  installationId: string; ownerUserId: string; connectionId: string; provider: string; providerMeetingId: string; startedAt: string | null; title: string | null;
  attendeeEmails: string[]; summary: string | null; actionItems: string[]; recordingUrl: string | null; status: "needs_contact" | "skipped" | "dry_run" | "saved" | "failed" | "duplicate"; reason: string | null;
  expiresAt: number | null;
};

/** One item the write log can hold once: a part of a note or comment, or one field. */
export type PartRef = { installationId: string; meetingId: string; locationId: string; contactId: string; kind: "note" | "comment" | "field"; partNo: number; authoredBy: string };

/** What a contact field was last filled by, read and written while the contact's field lock is held (so two calls cannot race). */
export type FieldState = {
  previous: (items: readonly FieldItem[]) => Promise<Partial<Record<FieldItem, number>>>;
  /** Records that this meeting filled this field: the field's state (when the meeting was dated) and the write log, in the same step as the lock. */
  record: (r: { item: FieldItem; meetingStartedAt: number | null; meetingId: string; partNo: number; authoredBy: string }) => Promise<void>;
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
  recordWrite: (r: { installationId: string; meetingId: string; locationId: string; contactId: string; kind: "note" | "comment" | "field"; partNo?: number; ghlId: string | null; authoredBy: string }) => Promise<boolean>;
  bump: (connectionId: string, field: "saved" | "skipped") => Promise<void>;
  now: () => number;
  /** Emails this person told SubSync to always ignore ("Always ignore"). Optional: a store without it ignores nothing. */
  ignoredEmails?: (installationId: string, userId: string) => Promise<string[]>;
  /** Does this installation hold the permission to add notes to contacts? Optional: a store without it assumes yes. */
  hasWriteScope?: (installationId: string) => Promise<boolean>;
  /** Does this installation hold the named permission (for example the one for conversation comments)? Optional: a store without it assumes yes. */
  hasScope?: (installationId: string, scope: string) => Promise<boolean>;
  /** The contact fields each account's admin mapped (stage E2b). Optional: a store without it has no fields. */
  fieldMappings?: (installationId: string, locationIds: string[]) => Promise<Record<string, FieldMapping[]>>;
  /** Runs `fn` while holding the lock for one contact's fields, with the state of what filled them. Optional: a store without it writes no fields. */
  fieldLock?: <T>(installationId: string, locationId: string, contactId: string, fn: (state: FieldState) => Promise<T>) => Promise<T>;
  /** This person's other meetings that started near `aroundIso`, for the same-meeting rule. Optional: a store without it never finds a duplicate. */
  recentMeetings?: (installationId: string, userId: string, aroundIso: string) => Promise<SeenMeeting[]>;
  /** Turns waiting copies of a meeting into duplicates (their content is removed). Optional. */
  markDuplicates?: (installationId: string, userId: string, ids: string[], reason: string) => Promise<void>;
  /**
   * Idempotency for each part, in the database: takes the right to write one part of one note or comment. False when it was already taken (a second run, or a
   * simultaneous one), so the same part is never written twice. Released when the write fails. Optional: a store without it relies on `recordWrite` after the write.
   */
  claimPart?: (r: PartRef) => Promise<boolean>;
  finishPart?: (r: PartRef, ghlId: string | null) => Promise<void>;
  releasePart?: (r: PartRef) => Promise<void>;
  /** Writes what happened to each contact field into the audit log (ids, item names and plain reasons: never a value). Optional. */
  logDelivery?: (installationId: string, userId: string, meetingId: string, fields: FieldReport[]) => Promise<void>;
};

export type Writer = (a: { installationId: string; locationId: string; contactId: string; meetingId: string; request: CrmRequest }) => Promise<WriteResult>;

/**
 * What the delivery adds to the meeting, for the note's header (all optional: a source that has none leaves the line out). `transcript` is the call's
 * full text and exists only in memory for this one delivery (SubSync never stores a transcript); `callUrl` is the call's page in the meeting tool.
 */
export type DeliveryExtras = { internalEmails?: string[]; rep?: string | null; withNames?: string[]; durationMinutes?: number | null; transcript?: string | null; callUrl?: string | null };

export type IngestResult =
  | { kind: "duplicate" }
  | { kind: "inbox"; meetingId: string; reason: string }
  | { kind: "discarded"; meetingId: string }
  | { kind: "ignored"; meetingId: string }
  | { kind: "written"; meetingId: string; targets: Array<{ locationId: string; contactId: string; outcome: Outcome }>; clips: number }
  | { kind: "kept"; meetingId: string; reason: "preview_needed" }
  | { kind: "same_meeting"; meetingId: string; reason: "preferred_tool_has_it" | "already_in_crm" };

export type Outcome = WriteResult["outcome"] | "over_cap" | "already_written";

const emailsOf = (attendees: Attendee[]) => [...new Set(attendees.map((a) => a.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
const DAY = 86_400_000;

/** Which parts of the note an account's rules (already applied to `items`) allow in a contact note. */
export const includesOf = (items: Matrix): Includes => includesFor(items, "note");

export const wantsNote = (i: Includes) => i.summary || i.actionItems || i.recordingLink || i.attendeesAndDate;

export type FieldReport = { locationId: string; contactId: string; written: FieldItem[]; skipped: FieldPlan["skipped"]; cut: Array<{ item: FieldItem; kept: number; of: number }> };
export type DeliveredTo = { locationId: string; contactId: string; outcome: Outcome };

/**
 * Writes what one meeting puts into each allowed contact, as the person: the contact notes and conversation comments (each split into "Part i of N" when
 * long), then the contact fields. Stops a note or comment series at the first part that fails (so Part 3 never lands after a missing Part 2). Stops when
 * the person's daily limit is reached. Every part is written once: in live mode the right to write it is taken in the database first. Returns what happened
 * to each part and field. Used for a meeting that just arrived, for a held meeting that was released, and for a meeting the person linked by hand.
 */
export async function deliverNotes(a: {
  conn: PersonalConnection; meetingId: string; targets: PlanTarget[]; input: DeliveryInput; store: IngestStore; write: Writer; sentToday: number; capFor: (locationId: string) => number; limits?: Limits;
}): Promise<{ done: DeliveredTo[]; clips: number; fields: FieldReport[]; remarks: string[] }> {
  const { conn, store } = a;
  const done: DeliveredTo[] = [];
  const fields: FieldReport[] = [];
  const remarks: string[] = [];
  let clips = 0;
  let count = a.sentToday;
  const live = isLive("WRITE_GHL_LIVE");
  const as = conn.person.userId;

  // One part of a note or comment. In live mode its slot in the write log is taken BEFORE the write, so a second run or a simultaneous one writes nothing.
  const sendPart = async (t: PlanTarget, kind: "note" | "comment", partNo: number, request: CrmRequest): Promise<Outcome> => {
    const ref: PartRef = { installationId: conn.installationId, meetingId: a.meetingId, locationId: t.locationId, contactId: t.contactId, kind, partNo, authoredBy: as };
    const claimed = live && store.claimPart ? await store.claimPart(ref) : null;
    if (claimed === false) return "already_written";
    let result: WriteResult;
    try {
      result = await a.write({ installationId: conn.installationId, locationId: t.locationId, contactId: t.contactId, meetingId: a.meetingId, request });
    } catch {
      result = { outcome: "failed", status: 0 };
    }
    if (result.outcome === "written") {
      if (claimed && store.finishPart) await store.finishPart(ref, result.id);
      else await store.recordWrite({ installationId: conn.installationId, meetingId: a.meetingId, locationId: t.locationId, contactId: t.contactId, kind, ...(partNo > 1 ? { partNo } : {}), ghlId: result.id, authoredBy: as });
    } else if (claimed && store.releasePart) await store.releasePart(ref);
    return result.outcome;
  };

  for (const t of a.targets) {
    clips += t.clips.length;
    if (!t.allowed) continue;
    const composed = composeDelivery({ input: a.input, items: t.items, template: t.template, limits: a.limits });
    remarks.push(...composed.remarks);
    if (composed.messages.length === 0 && composed.fieldItems.length === 0) continue;
    if (count >= a.capFor(t.locationId)) { done.push({ locationId: t.locationId, contactId: t.contactId, outcome: "over_cap" }); continue; }
    count++;
    const stopAt: Partial<Record<"note" | "comment", boolean>> = {};
    for (const m of composed.messages) {
      if (stopAt[m.kind]) continue;
      const request = m.kind === "note" ? buildNote({ contactId: t.contactId, body: m.text, userId: as }) : buildComment({ contactId: t.contactId, message: m.text, userId: as });
      const outcome = await sendPart(t, m.kind, m.partNo, request);
      done.push({ locationId: t.locationId, contactId: t.contactId, outcome });
      if (outcome === "failed" || outcome === "needs_permission") stopAt[m.kind] = true;
    }
    if (composed.fieldItems.length > 0) {
      const report = await deliverFields({ conn, meetingId: a.meetingId, target: t, requested: composed.fieldItems, input: a.input, store, write: a.write, live });
      fields.push(report.report);
      if (report.outcome) done.push({ locationId: t.locationId, contactId: t.contactId, outcome: report.outcome });
    }
  }
  return { done, clips, fields, remarks };
}

/**
 * The contact fields for one contact (spec 8.1). The contact's field lock is held from the moment the previous values are read until the new ones are
 * recorded, so two calls for the same contact are handled one after the other and an older call can never replace a newer one. In test mode the plan
 * is made and logged, nothing is written and nothing is recorded.
 */
async function deliverFields(a: {
  conn: PersonalConnection; meetingId: string; target: PlanTarget; requested: FieldItem[]; input: DeliveryInput; store: IngestStore; write: Writer; live: boolean;
}): Promise<{ report: FieldReport; outcome: Outcome | null }> {
  const { conn, store, target: t } = a;
  const base: FieldReport = { locationId: t.locationId, contactId: t.contactId, written: [], skipped: [], cut: [] };
  if (!store.fieldLock) {
    return { report: { ...base, skipped: a.requested.map((item) => ({ item, code: "not_mapped" as const, message: "Contact fields are not available here, so nothing was written." })) }, outcome: null };
  }
  const startedAt = a.input.startedAt && !Number.isNaN(Date.parse(a.input.startedAt)) ? Date.parse(a.input.startedAt) : null;
  return store.fieldLock(conn.installationId, t.locationId, t.contactId, async (state) => {
    const previous = await state.previous(a.requested);
    const plan = planFieldWrites({
      requested: a.requested, mappings: t.mappings, previous,
      source: { startedAt: a.input.startedAt, summary: a.input.summary, actionItems: a.input.actionItems, recordingUrl: a.input.recordingUrl, rep: a.input.rep },
    });
    const report: FieldReport = { ...base, skipped: plan.skipped, cut: plan.writes.filter((w) => w.cut).map((w) => ({ item: w.item, ...w.cut! })) };
    if (plan.writes.length === 0) return { report, outcome: null };
    let result: WriteResult;
    try {
      result = await a.write({ installationId: conn.installationId, locationId: t.locationId, contactId: t.contactId, meetingId: a.meetingId, request: buildFieldUpdate({ contactId: t.contactId, fields: plan.writes.map((w) => ({ id: w.fieldId, value: w.value })) }) });
    } catch {
      result = { outcome: "failed", status: 0 };
    }
    if (result.outcome === "written") {
      report.written = plan.writes.map((w) => w.item);
      for (const w of plan.writes) await state.record({ item: w.item, meetingStartedAt: startedAt, meetingId: a.meetingId, partNo: FIELD_PART[w.item], authoredBy: conn.person.userId });
    }
    return { report, outcome: result.outcome };
  });
}

/** The slot of each field in the write log (one row per meeting, contact, kind and part, so a field is logged once per meeting). */
const FIELD_PART: Record<FieldItem, number> = { last_meeting_date: 1, last_meeting_summary: 2, next_steps: 3, recording_url: 4, rep: 5 };

/** The meeting's final state after its notes were attempted. Parts that were already written by an earlier run count as nothing here. */
export function settle(all: Array<{ outcome: Outcome }>, live: boolean): { status: MeetingRow["status"]; reason: string | null; holdInInbox: boolean } {
  if (!live) return { status: "dry_run", reason: "WOULD WRITE", holdInInbox: false };
  const done = all.filter((d) => d.outcome !== "already_written");
  if (done.some((d) => d.outcome === "written")) return { status: "saved", reason: done.some((d) => d.outcome !== "written") ? "partly_saved" : null, holdInInbox: false };
  if (done.length > 0 && done.every((d) => d.outcome === "needs_permission")) return { status: "needs_contact", reason: "needs_permission", holdInInbox: true };
  if (done.length > 0 && done.every((d) => d.outcome === "over_cap")) return { status: "needs_contact", reason: "over_daily_cap", holdInInbox: true };
  // Nothing was attempted (every field was left out for a plain reason, or everything was already written): nothing failed.
  if (all.length === 0 || done.length === 0) return { status: "skipped", reason: "nothing_to_write", holdInInbox: false };
  return { status: "failed", reason: "write_failed", holdInInbox: false };
}

/** Everything decided about a meeting before anything is stored or written: who may be matched, the rules of each account, the plan. */
export type Planned = {
  plan: Plan; policies: Record<string, PolicyFlags>; accounts: string[]; settings: PersonSettings; today: { user: number; byAccount: Record<string, number> };
  ignored: Set<string>; canWrite: boolean; waitDays: number;
  /** The tool order that applies (the person's own, or an account's locked one), for the same-meeting rule. */
  sourcePriority: string[];
  /** The accounts' mapped contact fields and the comment permission, as read for this plan (so a manual link follows the same rules). */
  mappings?: Record<string, FieldMapping[]>; canComment?: boolean;
};

/** The comment permission: comments are internal, but the platform gives them the same permission name as a message. Without it a comment row waits. */
export const COMMENT_SCOPE = "conversations/message.write";

export async function planFor(conn: PersonalConnection, emails: string[], extras: DeliveryExtras, store: IngestStore): Promise<Planned> {
  const { person, installationId } = conn;
  const installed = await store.installed(installationId);
  const proven = await store.provenAccess(installationId, person.userId);
  // Only accounts this person can reach are ever searched: a contact elsewhere is never even read.
  const accounts = accessibleAccounts(person, installed, proven);
  const [candidates, rules, settings, today, ignoredList, canWrite, mappings, canComment] = await Promise.all([
    accounts.length ? store.candidates(installationId, accounts, emails) : Promise.resolve([] as Candidate[]),
    store.policies(installationId, accounts),
    store.settings(installationId, person.userId),
    store.writesToday(installationId, person.userId, accounts),
    store.ignoredEmails ? store.ignoredEmails(installationId, person.userId) : Promise.resolve([] as string[]),
    store.hasWriteScope ? store.hasWriteScope(installationId) : Promise.resolve(true),
    store.fieldMappings && accounts.length ? store.fieldMappings(installationId, accounts) : Promise.resolve(undefined),
    store.hasScope ? store.hasScope(installationId, COMMENT_SCOPE) : Promise.resolve(undefined),
  ]);
  const policies: Record<string, PolicyFlags> = {};
  for (const id of accounts) policies[id] = effectivePolicy(rules.agency, rules.accounts[id]);
  const internalDomains = [...new Set(Object.values(policies).flatMap((p) => p.internalDomains))];
  const choices = choicesOf(settings);
  const matrix: Matrix = matrixFor(settings.preset, settings.custom);
  // A call nobody matches belongs to no account, so a locked rule is read from every account the person can reach: "do not keep it" wins over "keep it" (the more private one).
  const locked = accounts.map((id) => effectiveChoices(choices, policies[id]!)).filter((e) => e.locked.unmatchedMode).map((e) => e.choices.unmatchedMode);
  const unmatchedMode: "inbox" | "discard" = locked.includes("discard") ? "discard" : locked.length ? "inbox" : settings.unmatchedMode;
  const lockedOrder = accounts.map((id) => effectiveChoices(choices, policies[id]!)).find((e) => e.locked.sourcePriority);
  const sourcePriority = cleanPriority(lockedOrder ? lockedOrder.choices.sourcePriority : choices.sourcePriority);
  const ignored = new Set(ignoredList.map((e) => e.trim().toLowerCase()));
  const plan: Plan = planMeeting({
    person, provider: conn.provider, installed, provenAccess: proven, attendeeEmails: emails,
    // The person's own account email, whatever the tool said was on their side, and the addresses they asked SubSync to always ignore are never matched.
    internalEmails: [...(conn.accountEmail ? [conn.accountEmail] : []), ...(extras.internalEmails ?? []), ...ignored],
    internalDomains, candidates, policies, settings: { masterSwitch: settings.masterSwitch, unmatchedMode, matrix, choices }, writesToday: today,
    ...(mappings ? { mappings } : {}), ...(canComment === undefined ? {} : { canComment }),
  });
  return { plan, policies, accounts, settings, today, ignored, canWrite, waitDays: retentionDays(policies, accounts), sourcePriority, ...(mappings ? { mappings } : {}), ...(canComment === undefined ? {} : { canComment }) };
}

export async function ingestPersonalMeeting(
  conn: PersonalConnection, m: Meeting, providerMeetingId: string, store: IngestStore, write: Writer, extras: DeliveryExtras = {},
): Promise<IngestResult> {
  const { person, installationId } = conn;
  const emails = emailsOf(m.attendees);
  const planned = await planFor(conn, emails, extras, store);
  const { plan, policies, settings, today, ignored: ignoredSet, canWrite, waitDays } = planned;

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

  // Two tools may have recorded the same meeting (spec 5.2 C): never two notes. The person's preferred tool wins while that is still possible.
  let supersedes: string[] = [];
  if (store.recentMeetings && m.startedAt) {
    const seen = await store.recentMeetings(installationId, person.userId, m.startedAt);
    const decision = decideSource({ provider: conn.provider, startedAt: m.startedAt, attendeeEmails: emails, title: m.title }, seen, planned.sourcePriority, [conn.accountEmail ?? "", ...(extras.internalEmails ?? [])].filter(Boolean));
    if (decision.action === "duplicate") {
      const id = await store.insertMeeting({ ...bare, status: "duplicate", reason: decision.reason, expiresAt: null });
      if (id === null) return { kind: "duplicate" };
      await store.bump(conn.id, "skipped");
      return { kind: "same_meeting", meetingId: id, reason: decision.reason };
    }
    supersedes = decision.supersedes;
  }
  const supersede = async () => { if (supersedes.length && store.markDuplicates) await store.markDuplicates(installationId, person.userId, supersedes, "preferred_tool_has_it"); };

  const waits = async (reason: InboxReason): Promise<IngestResult> => {
    const id = await store.insertMeeting({ ...base, status: "needs_contact", reason, expiresAt: store.now() + (plan.kind === "inbox" ? plan.retentionDays : waitDays) * DAY });
    if (id === null) return { kind: "duplicate" };
    await supersede();
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
    await supersede();
    return { kind: "kept", meetingId: id, reason: "preview_needed" };
  }

  const id = await store.insertMeeting({ ...base, status: live ? "saved" : "dry_run", reason: live ? null : "WOULD WRITE", expiresAt: null });
  if (id === null) return { kind: "duplicate" };
  await supersede();
  const input: DeliveryInput = {
    title: m.title, startedAt: m.startedAt, durationMinutes: extras.durationMinutes ?? null,
    attendeeNames: extras.withNames ?? m.attendees.map((a) => a.name ?? a.email ?? "").filter(Boolean), rep: extras.rep ?? person.name, tool: toolName(conn.provider),
    summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl,
    // The transcript exists only in memory for this delivery. It is written only where the table, the account rules and the person's own switch all allow it.
    transcript: extras.transcript ?? null, transcriptUrl: extras.callUrl ?? null,
  };
  const { done, clips, fields } = await deliverNotes({
    conn, meetingId: id, targets: plan.targets, input, store, write, sentToday: today.user, capFor: (loc) => (policies[loc]?.dailyCapPerUser ?? 50),
  });
  await store.logDelivery?.(installationId, person.userId, id, fields);
  const end = settle(done, live);
  if (end.status !== (live ? "saved" : "dry_run") || end.reason !== (live ? null : "WOULD WRITE")) {
    await store.updateMeeting(id, end.status, end.reason, end.holdInInbox ? store.now() + waitDays * DAY : null);
  }
  await store.bump(conn.id, end.holdInInbox || end.status === "skipped" ? "skipped" : "saved");
  return { kind: "written", meetingId: id, targets: done, clips };
}

/** The tool's name as the note says it. Only Fathom is built (stage E2a); the other tools name themselves when they are built. */
export const toolName = (provider: string) => (provider === "fathom" ? "Fathom" : "your meeting tool");
