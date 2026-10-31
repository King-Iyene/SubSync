import { isBusinessKey, locationOfBusinessKey } from "../access";
import { safeError } from "../safe-log";
import { maintenanceOn } from "../runtime-guards";
import { refreshInsights } from "../analytics/service";
import { sql } from "../db";
import { getInstalledLocations, getLocationToken } from "../ghl/client";
import { getCompanyAccessToken, purgeLocationData } from "../ghl/installations";
import {
  fetchAppointments, fetchCalendars, fetchConversationMessages, fetchUsers, isPermissionError, fetchCalendarCount, fetchContactsPage, fetchConversationsPage, fetchLocationDetails, fetchOpportunitiesPage, fetchPipelines,
  type ContactCursor, type ConversationRow, type OpportunityRow,
} from "./ghl-data";
import { leadFromMessages } from "../analytics/speed-intel";
import { diffAppointmentEvents } from "./appointment-events";
import { diffDealEvents } from "./deal-events";
import { listAllInstalledLocations } from "./installed-locations";

// Resumable sync. Work is a queue of jobs in `sync_jobs`; a cron route calls runSlice() which
// claims jobs one at a time (FOR UPDATE SKIP LOCKED, so parallel invocations never collide),
// works within a time budget, saves its cursor and hands the job back if it runs out of time.
// A full sync is: one `locations` job, which fans out to per-account jobs, then one `metrics`
// job that only runs once everything else has finished.

export type JobType = "locations" | "structure" | "contacts" | "opportunities" | "conversations" | "appointments" | "speed" | "metrics";
const PER_LOCATION: JobType[] = ["structure", "contacts", "opportunities", "conversations", "appointments", "speed"];

type Job = {
  id: string;
  installationId: string;
  companyId: string;
  locationId: string | null;
  type: JobType;
  cursor: Record<string, unknown> | null;
  startedAt: Date;
};

// ---------------- queueing ----------------

export async function enqueueJobs(installationId: string, locationIds: Array<string | null>, types: JobType[]): Promise<number> {
  if (maintenanceOn(process.env)) return 0; // kill switch: nothing is queued
  const db = sql();
  let created = 0;
  for (const type of types) {
    for (const loc of locationIds) {
      const rows = await db`
        insert into sync_jobs (installation_id, location_id, type, status)
        select ${installationId}, ${loc}, ${type}, 'pending'
        where not exists (
          select 1 from sync_jobs j
          where j.installation_id = ${installationId} and coalesce(j.location_id, '') = coalesce(${loc}::text, '')
            and j.type = ${type} and j.status in ('pending', 'running'))
        returning id`;
      created += rows.length;
    }
  }
  return created;
}

export async function enqueueFullSync(installationId: string): Promise<number> {
  return enqueueJobs(installationId, [null], ["locations"]);
}

// Re-sync everything for one account (the "Resync" button). No-op while jobs are already queued.
export async function enqueueLocationSync(installationId: string, locationId: string): Promise<number> {
  return enqueueJobs(installationId, [locationId], PER_LOCATION);
}

// Re-sync one area of one account (used by webhooks). Cheap to call repeatedly: it is a no-op
// while an identical job is already queued.
export async function enqueueAreaSync(installationId: string, locationId: string, area: "contacts" | "opportunities" | "conversations" | "structure"): Promise<number> {
  return enqueueJobs(installationId, [locationId], [area]);
}

// Start a daily refresh for installs that have not synced in the last ~20 hours. An install that
// still has no client accounts is retried every few minutes: the platform can take a moment to
// list a fresh install, so the first sync right after installing may find nothing.
export async function scheduleDailyRefresh(): Promise<number> {
  const rows = await sql()`
    select i.id from installations i
    where i.uninstalled_at is null and not i.is_demo and i.refresh_token_enc is not null
      and not exists (select 1 from sync_jobs j where j.installation_id = i.id and j.status in ('pending', 'running'))
      and (
        coalesce((select max(j.finished_at) from sync_jobs j where j.installation_id = i.id and j.type = 'locations' and j.status = 'done'), 'epoch') < now() - interval '20 hours'
        or (
          not exists (select 1 from locations l where l.installation_id = i.id)
          and coalesce((select max(j.finished_at) from sync_jobs j where j.installation_id = i.id and j.type = 'locations' and j.status = 'done'), 'epoch') < now() - interval '3 minutes'
        )
      )`;
  let n = 0;
  for (const r of rows) n += await enqueueFullSync(r.id as string);
  return n;
}

// Every 15 minutes, re-read only what goes stale fastest: conversations, appointments and reply times, then recompute alerts.
// A slow-reply alert that arrives hours late is worthless, so this does not wait for the daily full sync (contacts and deals
// stay on the daily schedule, and webhooks cover changes in between).
export const FAST_REFRESH_MINUTES = 15;
export async function scheduleFastRefresh(): Promise<number> {
  const rows = await sql()`
    select i.id from installations i
    where i.uninstalled_at is null and not i.is_demo and i.refresh_token_enc is not null
      and exists (select 1 from locations l where l.installation_id = i.id and not l.ignored)
      and not exists (select 1 from sync_jobs j where j.installation_id = i.id and j.status in ('pending', 'running'))
      and coalesce((select max(j.finished_at) from sync_jobs j where j.installation_id = i.id and j.type = 'metrics' and j.status = 'done'), 'epoch') < now() - make_interval(mins => ${FAST_REFRESH_MINUTES}::int)`;
  let n = 0;
  for (const r of rows) {
    const locs = await sql()`select location_id from locations where installation_id = ${r.id} and not ignored`;
    n += await enqueueJobs(r.id as string, locs.map((l) => l.location_id as string), ["conversations", "appointments", "speed"]);
    n += await enqueueJobs(r.id as string, [null], ["metrics"]);
  }
  return n;
}

// ---------------- location tokens ----------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Used by the data cleanup tool, which needs a token for one account.
export const locationAccessToken = (companyKey: string, locationId: string) => tokenForLocation(companyKey, locationId);

async function tokenForLocation(companyId: string, locationId: string): Promise<string> {
  // A client account that installed the app for itself holds its own location token.
  if (isBusinessKey(companyId)) return getCompanyAccessToken(companyId);
  const key = `${companyId}:${locationId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return hit.token;
  const agencyToken = await getCompanyAccessToken(companyId);
  const response = await getLocationToken(agencyToken, companyId, locationId);
  tokenCache.set(key, { token: response.access_token, expiresAt: Date.now() + response.expires_in * 1000 });
  return response.access_token;
}

// ---------------- job handlers ----------------

type Outcome = { done: true } | { done: false; cursor: Record<string, unknown> };
const DONE: Outcome = { done: true };

async function handleLocations(job: Job): Promise<Outcome> {
  const db = sql();
  // A business install has exactly one account: itself.
  if (isBusinessKey(job.companyId)) {
    const only = locationOfBusinessKey(job.companyId);
    await db`
      insert into locations (installation_id, location_id) values (${job.installationId}, ${only})
      on conflict (installation_id, location_id) do nothing`;
    await enqueueJobs(job.installationId, [only], PER_LOCATION);
    await enqueueJobs(job.installationId, [null], ["metrics"]);
    return DONE;
  }
  const agencyToken = await getCompanyAccessToken(job.companyId);
  const appId = process.env.GHL_APP_ID;
  if (!appId) throw new Error("Missing environment variable GHL_APP_ID");

  const installed = await listAllInstalledLocations((page) => getInstalledLocations(agencyToken, job.companyId, appId, page));
  const ids = installed.map((l) => l._id);

  for (const l of installed) {
    await db`
      insert into locations (installation_id, location_id, name, address, installed_at)
      values (${job.installationId}, ${l._id}, ${l.name ?? null}, ${l.address ?? null}, ${l.installedAt ? new Date(l.installedAt) : null})
      on conflict (installation_id, location_id) do update set
        name = coalesce(excluded.name, locations.name), address = coalesce(excluded.address, locations.address),
        installed_at = coalesce(excluded.installed_at, locations.installed_at)`;
  }

  // Accounts that uninstalled the app: remove them and everything we hold for them.
  const known = await db`select location_id from locations where installation_id = ${job.installationId}`;
  const gone = known.map((r) => r.location_id as string).filter((id) => !ids.includes(id));
  if (installed.length > 0 || known.length === 0) {
    for (const id of gone) await purgeLocationData(job.installationId, id);
  }

  await enqueueJobs(job.installationId, ids, PER_LOCATION);
  await enqueueJobs(job.installationId, [null], ["metrics"]);
  return DONE;
}

async function handleStructure(job: Job): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const token = await tokenForLocation(job.companyId, loc);
  const [details, pipelines, calendars] = await Promise.all([
    fetchLocationDetails(token, loc), fetchPipelines(token, loc), fetchCalendarCount(token, loc),
  ]);
  await db.begin(async (tx) => {
    await tx`
      update locations set
        name = coalesce(${details.name}, name), email = coalesce(${details.email}, email), phone = coalesce(${details.phone}, phone),
        website = coalesce(${details.website}, website), timezone = coalesce(${details.timezone}, timezone),
        address = coalesce(${details.address}, address), calendar_count = ${calendars}, pipeline_count = ${pipelines.length},
        allow_duplicate_contact = coalesce(${details.allowDuplicateContact}::boolean, allow_duplicate_contact),
        structure_synced_at = now(), sync_error = null
      where installation_id = ${job.installationId} and location_id = ${loc}`;
    await tx`delete from pipelines where installation_id = ${job.installationId} and location_id = ${loc}`;
    for (const p of pipelines) {
      await tx`
        insert into pipelines (installation_id, location_id, pipeline_id, name, stages)
        values (${job.installationId}, ${loc}, ${p.pipelineId}, ${p.name}, ${tx.json(p.stages as never)})`;
    }
  });
  return DONE;
}

const PAGES_PER_SLICE = 25;

async function handleContacts(job: Job, deadline: number): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const token = await tokenForLocation(job.companyId, loc);
  let cursor = (job.cursor ?? null) as ContactCursor;
  for (let page = 0; page < PAGES_PER_SLICE; page++) {
    const { contacts, next } = await fetchContactsPage(token, loc, cursor);
    const unique = [...new Map(contacts.map((c) => [c.contactId, c])).values()];
    if (unique.length > 0) {
      const rows = unique.map((c) => ({
        installation_id: job.installationId, location_id: loc, contact_id: c.contactId, first_name: c.firstName, last_name: c.lastName,
        email: c.email, phone: c.phone, tags: c.tags, date_added: c.dateAdded, last_activity_at: c.lastActivityAt,
        updated_remote_at: c.updatedAt, synced_at: new Date(),
        source: c.source, dnd: c.dnd, birth_date: c.birthDate, assigned_to: c.assignedTo,
      }));
      await db`
        insert into cached_contacts ${db(rows as never)}
        on conflict (installation_id, location_id, contact_id) do update set
          first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, phone = excluded.phone,
          tags = excluded.tags, date_added = excluded.date_added, last_activity_at = excluded.last_activity_at,
          updated_remote_at = excluded.updated_remote_at, synced_at = excluded.synced_at,
          source = excluded.source, dnd = excluded.dnd, birth_date = excluded.birth_date, assigned_to = excluded.assigned_to`;
    }
    if (!next) {
      // Finished a full pass: anything not seen during it was deleted upstream.
      await db`delete from cached_contacts where installation_id = ${job.installationId} and location_id = ${loc} and synced_at < ${job.startedAt}`;
      await db`update locations set contacts_synced_at = now(), last_synced_at = now(), sync_error = null where installation_id = ${job.installationId} and location_id = ${loc}`;
      return DONE;
    }
    cursor = next;
    if (Date.now() > deadline) break;
  }
  return { done: false, cursor: (cursor ?? {}) as Record<string, unknown> };
}

// Compare this page of deals with what we hold and keep a log of what changed (a stage move, a
// won or lost). The first sync of an account only records changes, never a flood of "created".
async function recordDealEvents(installationId: string, loc: string, incoming: OpportunityRow[]): Promise<void> {
  const db = sql();
  const ids = incoming.map((o) => o.opportunityId);
  const [before, [prior]] = await Promise.all([
    db`select opportunity_id, stage_id, status from cached_opportunities where installation_id = ${installationId} and location_id = ${loc} and opportunity_id = any(${ids})`,
    db`select opportunities_synced_at from locations where installation_id = ${installationId} and location_id = ${loc}`,
  ]);
  const known = new Map(before.map((r) => [r.opportunity_id as string, r]));
  const firstSyncDone = prior?.opportunities_synced_at != null;
  const events = diffDealEvents(
    incoming.map((o) => ({ id: o.opportunityId, stageId: o.stageId, status: o.status, value: o.monetaryValue })),
    new Map([...known].map(([id, r]) => [id, { stageId: r.stage_id as string | null, status: r.status as string | null }])),
    firstSyncDone,
  );
  if (events.length === 0) return;
  const rows = events.map((e) => ({ installation_id: installationId, location_id: loc, opportunity_id: e.id, kind: e.kind, from_value: e.from, to_value: e.to, value: e.value }));
  await db`insert into deal_events ${db(rows as never)}`;
}

async function handleOpportunities(job: Job, deadline: number): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const token = await tokenForLocation(job.companyId, loc);
  let pageNo = Number((job.cursor as { page?: number } | null)?.page ?? 1);
  for (let i = 0; i < PAGES_PER_SLICE; i++) {
    const { opportunities, nextPage } = await fetchOpportunitiesPage(token, loc, pageNo);
    const unique = [...new Map(opportunities.map((o) => [o.opportunityId, o])).values()];
    if (unique.length > 0) {
      await recordDealEvents(job.installationId, loc, unique);
      const rows = unique.map((o) => ({
        installation_id: job.installationId, location_id: loc, opportunity_id: o.opportunityId, pipeline_id: o.pipelineId,
        stage_id: o.stageId, contact_id: o.contactId, contact_name: o.contactName, name: o.name, monetary_value: o.monetaryValue,
        status: o.status, last_stage_change_at: o.lastStageChangeAt, last_status_change_at: o.lastStatusChangeAt,
        last_action_at: o.lastActionAt, created_remote_at: o.createdAt, updated_remote_at: o.updatedAt, synced_at: new Date(),
        assigned_to: o.assignedTo, source: o.source,
      }));
      await db`
        insert into cached_opportunities ${db(rows as never)}
        on conflict (installation_id, location_id, opportunity_id) do update set
          pipeline_id = excluded.pipeline_id, stage_id = excluded.stage_id, contact_id = excluded.contact_id,
          contact_name = excluded.contact_name, name = excluded.name, monetary_value = excluded.monetary_value, status = excluded.status,
          last_stage_change_at = excluded.last_stage_change_at, last_status_change_at = excluded.last_status_change_at,
          last_action_at = excluded.last_action_at, created_remote_at = excluded.created_remote_at,
          updated_remote_at = excluded.updated_remote_at, synced_at = excluded.synced_at,
          assigned_to = excluded.assigned_to, source = excluded.source`;
    }
    if (nextPage === null) {
      await db`delete from cached_opportunities where installation_id = ${job.installationId} and location_id = ${loc} and synced_at < ${job.startedAt}`;
      await db`update locations set opportunities_synced_at = now(), last_synced_at = now() where installation_id = ${job.installationId} and location_id = ${loc}`;
      return DONE;
    }
    pageNo = nextPage;
    if (Date.now() > deadline) break;
  }
  return { done: false, cursor: { page: pageNo } };
}

const CONVERSATION_PAGES = 5;

async function handleConversations(job: Job): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const token = await tokenForLocation(job.companyId, loc);
  const all: ConversationRow[] = [];
  let cursor: { startAfterDate?: number } | null = null;
  for (let page = 0; page < CONVERSATION_PAGES; page++) {
    const result: Awaited<ReturnType<typeof fetchConversationsPage>> = await fetchConversationsPage(token, loc, cursor);
    all.push(...result.conversations);
    if (!result.next) break;
    cursor = result.next;
  }
  const unique = [...new Map(all.map((c) => [c.conversationId, c])).values()];
  await db.begin(async (tx) => {
    await tx`delete from cached_conversations where installation_id = ${job.installationId} and location_id = ${loc}`;
    if (unique.length > 0) {
      const rows = unique.map((c) => ({
        installation_id: job.installationId, location_id: loc, conversation_id: c.conversationId, contact_id: c.contactId,
        contact_name: c.contactName, last_message_type: c.lastMessageType, last_message_direction: c.lastMessageDirection,
        last_message_at: c.lastMessageAt, unread_count: c.unreadCount, synced_at: new Date(),
      }));
      await tx`insert into cached_conversations ${tx(rows as never)}`;
    }
    await tx`update locations set conversations_synced_at = now(), last_synced_at = now() where installation_id = ${job.installationId} and location_id = ${loc}`;
  });
  return DONE;
}

const APPOINTMENT_PAST_DAYS = 90;
const APPOINTMENT_FUTURE_DAYS = 60;
const MAX_CALENDARS = 80;

// Appointments and the account's team names. Both depend on permissions an existing install may not
// have approved yet; in that case we record "needs permission" for the account and carry on.
// A time as the sync holds it (an ISO string from the platform, a Date from the database) in milliseconds.
const asMs = (v: unknown): number | null => {
  const ms = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(ms) ? ms : null;
};

async function handleAppointments(job: Job): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const token = await tokenForLocation(job.companyId, loc);

  // Nothing here may mark the whole account as failing: core data (contacts, deals, conversations) is
  // separate. An unexpected error is recorded as "error" and logged, a missing permission as "needs_permission".
  let usersAccess: "ok" | "needs_permission" | "error" = "ok";
  try {
    const users = await fetchUsers(token, loc);
    for (const u of users) {
      if (!u.name) continue;
      // A name someone typed is never overwritten by the platform's.
      await db`
        insert into team_names (installation_id, user_id, name, source) values (${job.installationId}, ${u.id}, ${u.name}, 'platform')
        on conflict (installation_id, user_id) do update set name = excluded.name where team_names.source = 'platform'`;
    }
  } catch (error) {
    usersAccess = isPermissionError(error) ? "needs_permission" : "error";
    if (usersAccess === "error") console.error("Reading team names failed", safeError(error));
  }

  const now = Date.now();
  const fromMs = now - APPOINTMENT_PAST_DAYS * 86_400_000;
  const toMs = now + APPOINTMENT_FUTURE_DAYS * 86_400_000;
  let access: "ok" | "needs_permission" | "error" = "ok";
  const rows: Array<Record<string, unknown>> = [];
  try {
    const calendars = (await fetchCalendars(token, loc)).slice(0, MAX_CALENDARS);
    for (const cal of calendars) {
      const events = await fetchAppointments(token, loc, cal.id, fromMs, toMs);
      for (const a of events) {
        rows.push({
          installation_id: job.installationId, location_id: loc, appointment_id: a.appointmentId, calendar_id: a.calendarId ?? cal.id, calendar_name: cal.name,
          contact_id: a.contactId, title: a.title, status: a.status, start_at: a.startAt, end_at: a.endAt, assigned_to: a.assignedTo, created_remote_at: a.createdAt,
          synced_at: new Date(),
        });
      }
    }
  } catch (error) {
    access = isPermissionError(error) ? "needs_permission" : "error";
    if (access === "error") console.error("Reading appointments failed", safeError(error));
  }

  if (access === "ok") {
    const unique = [...new Map(rows.map((r) => [r.appointment_id as string, r])).values()];
    // Keep our own history: what each appointment looked like before this read, compared with now.
    const [seen] = await db`select appointments_synced_at from locations where installation_id = ${job.installationId} and location_id = ${loc}`;
    const known = new Map<string, { status: string | null; startAt: number | null }>();
    for (let i = 0; i < unique.length; i += 500) {
      const ids = unique.slice(i, i + 500).map((r) => r.appointment_id as string);
      const before = await db`select appointment_id, status, start_at from cached_appointments where installation_id = ${job.installationId} and location_id = ${loc} and appointment_id = any(${ids}::text[])`;
      for (const b of before) known.set(b.appointment_id as string, { status: b.status as string | null, startAt: asMs(b.start_at) });
    }
    const events = diffAppointmentEvents(unique.map((r) => ({ id: r.appointment_id as string, status: (r.status as string | null) ?? null, startAt: asMs(r.start_at) })), known, seen?.appointments_synced_at != null);
    for (let i = 0; i < events.length; i += 500) {
      const batch = events.slice(i, i + 500).map((e) => ({ installation_id: job.installationId, location_id: loc, appointment_id: e.id, kind: e.kind, from_value: e.from, to_value: e.to, start_at: e.startAt === null ? null : new Date(e.startAt) }));
      await db`insert into appointment_events ${db(batch as never)}`;
    }
    for (let i = 0; i < unique.length; i += 500) {
      await db`
        insert into cached_appointments ${db(unique.slice(i, i + 500) as never)}
        on conflict (installation_id, location_id, appointment_id) do update set
          calendar_id = excluded.calendar_id, calendar_name = excluded.calendar_name, contact_id = excluded.contact_id, title = excluded.title,
          status = excluded.status, start_at = excluded.start_at, end_at = excluded.end_at, assigned_to = excluded.assigned_to,
          created_remote_at = excluded.created_remote_at, synced_at = excluded.synced_at`;
    }
    // Anything in the window that we did not see this time was cancelled and removed, or moved out of it.
    await db`
      delete from cached_appointments where installation_id = ${job.installationId} and location_id = ${loc}
        and synced_at < ${job.startedAt} and start_at between ${new Date(fromMs)} and ${new Date(toMs)}`;
  }
  await db`
    update locations set appointments_access = ${access}, users_access = ${usersAccess},
      appointments_synced_at = case when ${access} = 'ok' then now() else appointments_synced_at end
    where installation_id = ${job.installationId} and location_id = ${loc}`;
  return DONE;
}

// Speed to lead: for each recent lead (a new contact with a conversation) read the messages once and keep
// when it started and when a person first replied. Leads already answered are not read again. Nothing here
// may fail the account: a missing permission is recorded as such and the rest of the sync carries on.
const SPEED_WINDOW_DAYS = 14;
const SPEED_PER_RUN = 100;

async function handleSpeed(job: Job): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const [s] = await db`select count_automated_touches from settings where installation_id = ${job.installationId}`;
  const countAutomated = s?.count_automated_touches === true;
  const candidates = await db`
    select c.contact_id, c.date_added, v.conversation_id
    from cached_contacts c
    join cached_conversations v on v.installation_id = c.installation_id and v.location_id = c.location_id and v.contact_id = c.contact_id
    left join lead_touches t on t.installation_id = c.installation_id and t.location_id = c.location_id and t.conversation_id = v.conversation_id
    where c.installation_id = ${job.installationId} and c.location_id = ${loc} and c.date_added >= ${new Date(Date.now() - SPEED_WINDOW_DAYS * 86_400_000)}
      and (t.id is null or t.touch_at is null)
    order by (t.id is null) desc, c.date_added desc limit ${SPEED_PER_RUN}`;
  if (candidates.length === 0) return DONE;

  const token = await tokenForLocation(job.companyId, loc);
  let access: "ok" | "needs_permission" = "ok";
  for (const c of candidates) {
    try {
      const msgs = await fetchConversationMessages(token, loc, c.conversation_id as string);
      const lead = leadFromMessages(msgs, c.date_added instanceof Date ? c.date_added.getTime() : null, countAutomated);
      if (!lead) continue;
      await db`
        insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id)
        values (${job.installationId}, ${loc}, ${c.contact_id}, ${c.conversation_id}, ${new Date(lead.leadAt)}, ${lead.touchAt === null ? null : new Date(lead.touchAt)}, ${lead.touchUserId})
        on conflict (installation_id, location_id, conversation_id) do update set lead_at = excluded.lead_at, touch_at = excluded.touch_at, touch_user_id = excluded.touch_user_id, checked_at = now()`;
    } catch (error) {
      if (isPermissionError(error)) { access = "needs_permission"; break; }
      console.error("Reading a conversation failed", safeError(error));
    }
  }
  await db`
    update locations set speed_access = ${access}, speed_synced_at = case when ${access} = 'ok' then now() else speed_synced_at end
    where installation_id = ${job.installationId} and location_id = ${loc}`;
  return DONE;
}

async function runJob(job: Job, deadline: number): Promise<Outcome> {
  switch (job.type) {
    case "locations": return handleLocations(job);
    case "structure": return handleStructure(job);
    case "contacts": return handleContacts(job, deadline);
    case "opportunities": return handleOpportunities(job, deadline);
    case "conversations": return handleConversations(job);
    case "appointments": return handleAppointments(job);
    case "speed": return handleSpeed(job);
    case "metrics":
      await refreshInsights(job.installationId);
      return DONE;
  }
}

// ---------------- the worker loop ----------------

async function claimJob(): Promise<Job | null> {
  const rows = await sql()`
    update sync_jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select j.id from sync_jobs j
      where (j.status = 'pending' or (j.status = 'running' and j.updated_at < now() - interval '10 minutes'))
        and (j.type <> 'metrics' or not exists (
          select 1 from sync_jobs o
          where o.installation_id = j.installation_id and o.id <> j.id and o.type <> 'metrics' and o.status in ('pending', 'running')))
      order by (j.type = 'metrics'),
        -- Small jobs first, so a new permission shows results in minutes instead of waiting behind the big reads.
        -- Speed only jumps the queue where that account's conversations are already cached.
        case when j.type = 'appointments' then 0
             when j.type = 'speed' and exists (select 1 from cached_conversations v where v.installation_id = j.installation_id and v.location_id = j.location_id) then 1
             else 2 end,
        j.created_at, j.id
      limit 1 for update skip locked)
    returning id, installation_id, location_id, type, cursor, started_at`;
  if (rows.length === 0) return null;
  const r = rows[0];
  const [inst] = await sql()`select company_id from installations where id = ${r.installation_id} and uninstalled_at is null`;
  if (!inst) {
    await sql()`update sync_jobs set status = 'failed', error = 'Installation no longer exists', finished_at = now() where id = ${r.id}`;
    return claimJob();
  }
  return {
    id: r.id, installationId: r.installation_id, companyId: inst.company_id, locationId: r.location_id, type: r.type as JobType,
    cursor: (r.cursor ?? null) as Record<string, unknown> | null, startedAt: r.started_at as Date,
  };
}

function safeMessage(error: unknown): string {
  return safeError(error);
}

export type SliceResult = { jobs: number; failed: number; moreWork: boolean };

export async function runSlice(budgetMs = 45_000): Promise<SliceResult> {
  if (maintenanceOn(process.env)) return { jobs: 0, failed: 0, moreWork: false }; // kill switch: nothing runs
  const db = sql();
  const deadline = Date.now() + budgetMs;
  let jobs = 0;
  let failed = 0;
  while (Date.now() < deadline) {
    const job = await claimJob();
    if (!job) break;
    jobs++;
    try {
      const outcome = await runJob(job, deadline);
      if (outcome.done) {
        await db`update sync_jobs set status = 'done', cursor = null, error = null, finished_at = now(), updated_at = now() where id = ${job.id}`;
      } else {
        await db`update sync_jobs set status = 'pending', cursor = ${db.json(outcome.cursor as never)}, updated_at = now() where id = ${job.id}`;
      }
    } catch (error) {
      failed++;
      const message = safeMessage(error);
      console.error("Sync job failed", { type: job.type, message });
      await db`update sync_jobs set status = 'failed', error = ${message}, finished_at = now(), updated_at = now() where id = ${job.id}`;
      if (job.locationId) {
        await db`update locations set sync_error = ${message} where installation_id = ${job.installationId} and location_id = ${job.locationId}`;
      }
    }
  }
  const [pending] = await db`select count(*)::int n from sync_jobs where status in ('pending', 'running')`;
  return { jobs, failed, moreWork: pending.n > 0 };
}

// `onlyLocation` limits the report to one account (a business or client view), keeping other accounts' jobs out of it.
export async function syncStatus(installationId: string, onlyLocation?: string | null) {
  const db = sql();
  const loc = onlyLocation ?? null;
  const [jobs, [last], failures] = await Promise.all([
    db`select status, count(*)::int n from sync_jobs where installation_id = ${installationId} and (${loc}::text is null or location_id = ${loc} or location_id is null) group by status`,
    db`select max(finished_at) f from sync_jobs where installation_id = ${installationId} and status = 'done' and (${loc}::text is null or location_id = ${loc} or location_id is null)`,
    db`select type, location_id, error from sync_jobs where installation_id = ${installationId} and status = 'failed' and (${loc}::text is null or location_id = ${loc}) order by finished_at desc limit 5`,
  ]);
  return {
    pending: jobs.filter((j) => j.status === "pending" || j.status === "running").reduce((s, j) => s + j.n, 0),
    failed: jobs.filter((j) => j.status === "failed").reduce((s, j) => s + j.n, 0),
    lastFinishedAt: last?.f instanceof Date ? last.f.toISOString() : null,
    recentFailures: failures.map((f) => ({ type: f.type as string, locationId: f.location_id as string | null, error: f.error as string | null })),
  };
}
