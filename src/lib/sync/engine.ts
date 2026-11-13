import { APPOINTMENT_PAST_DAYS } from "./appointment-window";
import { isBusinessKey, locationOfBusinessKey } from "../access";
import { isOurTag, tagPrefix } from "../people/writeback";
import { safeError } from "../safe-log";
import { maintenanceOn } from "../runtime-guards";
import { eventsOfMessages, recordTouchEvents } from "../analytics/touch-events-db";
import { rebuildSpeedDaily } from "../analytics/touch-events-db";
import { refreshInsights } from "../analytics/service";
import { sql } from "../db";
import { getInstalledLocations, getLocationToken } from "../ghl/client";
import { getCompanyAccessToken, purgeLocationData } from "../ghl/installations";
import {
  fetchContactsUpdatedPage, fetchAppointments, fetchCalendarGroups, fetchCalendars, type CalendarRow, fetchConversationMessages, fetchUsers, isPermissionError, fetchCalendarCount, fetchContactsPage, fetchConversationsPage, fetchLocationDetails, fetchOpportunitiesPage, fetchPipelines,
  type ContactCursor, type ContactRow, type ConversationRow, type OpportunityRow,
} from "./ghl-data";
import { firstTouches, leadFromMessages } from "../analytics/speed-intel";
import { CONVERSATIONS_READ_PER_ACCOUNT, CONVERSATION_PAGE_SIZE } from "../analytics/waiting";
import { diffAppointmentEvents } from "./appointment-events";
import { applyLeadRules } from "./lead-rules-apply";
import { diffDealEvents } from "./deal-events";
import { recordDealsFromSync } from "../analytics/pipeline3-record";
import { refreshRollup } from "../analytics/pipeline3-rollup";
import { saveLocationUsers } from "../analytics/people3-identity";
import { diffTagEvents } from "./tag-events";
import { listAllInstalledLocations } from "./installed-locations";
import { REFRESH_DUE_AFTER_MINUTES, REFRESH_EVERY_MINUTES } from "./schedule";
import { OUR_WRITE_LEAD_MS, OUR_WRITE_WINDOW_MS } from "../connections/echo";
import { chooseMode, isSortedNewestFirst, nextWatermark, takeFresh, type Kind, type Mode } from "./incremental";
import { markDataChanged } from "./data-version";

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

export async function enqueueJobs(installationId: string, locationIds: Array<string | null>, types: JobType[], startCursor: Record<string, unknown> | null = null): Promise<number> {
  if (maintenanceOn(process.env)) return 0; // kill switch: nothing is queued
  const db = sql();
  let created = 0;
  for (const type of types) {
    for (const loc of locationIds) {
      const rows = await db`
        insert into sync_jobs (installation_id, location_id, type, status, cursor)
        select ${installationId}, ${loc}, ${type}, 'pending', ${startCursor && (type === "contacts" || type === "opportunities") ? JSON.stringify(startCursor) : null}::jsonb
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
  return enqueueJobs(installationId, [locationId], PER_LOCATION, { mode: "full" });
}

// The normal "Sync now" and the automatic check: only what changed since the last good read (contacts and deals), plus the cheap kinds. Never walks a whole big account.
export async function enqueueQuickSync(installationId: string, locationIds: string[], kinds: JobType[] = ["contacts", "opportunities", "conversations", "appointments", "speed"]): Promise<number> {
  return enqueueJobs(installationId, locationIds, kinds);
}

// The hard sync: re-read everything for these accounts (the only pass that notices deletions the live events missed). Runs in the background.
export async function enqueueHardSync(installationId: string, locationIds: string[]): Promise<number> {
  return enqueueJobs(installationId, locationIds, PER_LOCATION, { mode: "full" });
}

// ---------------- watermarks ----------------

export async function readWatermark(installationId: string, loc: string, kind: Kind): Promise<{ watermarkMs: number | null; lastFullMs: number | null }> {
  const [r] = await sql()`select watermark, last_full_at from sync_watermarks where installation_id = ${installationId} and location_id = ${loc} and kind = ${kind}`;
  return { watermarkMs: r?.watermark instanceof Date ? r.watermark.getTime() : null, lastFullMs: r?.last_full_at instanceof Date ? r.last_full_at.getTime() : null };
}

// A finished read stores where it got to. `changed` stamps the data version (the open screens then re-read) only when rows really changed.
async function finishRead(job: Job, loc: string, kind: Kind, mode: Mode, changed: boolean): Promise<void> {
  const wm = new Date(nextWatermark(job.startedAt.getTime()));
  const full = mode === "full";
  await sql()`
    insert into sync_watermarks (installation_id, location_id, kind, watermark, last_full_at, last_checked_at)
    values (${job.installationId}, ${loc}, ${kind}, ${wm}, ${full ? new Date() : null}, now())
    on conflict (installation_id, location_id, kind) do update set watermark = excluded.watermark,
      last_full_at = case when ${full} then now() else sync_watermarks.last_full_at end, last_checked_at = now()`;
  if (changed) await markDataChanged(job.installationId, loc, kind).catch((e) => console.error("data version not stamped", safeError(e)));
}
const ms = (v: string | null): number | null => { const n = v ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };
const hasKeys = (o: Record<string, unknown>) => Object.keys(o).length > 0;

// Re-sync one area of one account (used by webhooks). Cheap to call repeatedly: it is a no-op
// while an identical job is already queued.
// A change in conversations also re-reads the reply times (a lead is "answered" by an outbound message), and an appointment change has its own read.
export type SyncArea = "contacts" | "opportunities" | "conversations" | "structure" | "appointments";
export const JOBS_FOR_AREA: Record<SyncArea, JobType[]> = {
  contacts: ["contacts"], opportunities: ["opportunities"], conversations: ["conversations", "speed"], structure: ["structure"], appointments: ["appointments"],
};
export async function enqueueAreaSync(installationId: string, locationId: string, area: SyncArea): Promise<number> {
  return enqueueJobs(installationId, [locationId], JOBS_FOR_AREA[area]);
}

// Start a daily refresh for installs that have not synced in the last ~20 hours. An install that
// still has no client accounts is retried every few minutes: the platform can take a moment to
// list a fresh install, so the first sync right after installing may find nothing.
export async function scheduleDailyRefresh(): Promise<number> {
  const rows = await sql()`
    select i.id from installations i
    where i.uninstalled_at is null and not i.is_demo and i.refresh_token_enc is not null
      and not exists (select 1 from sync_jobs j where j.installation_id = i.id and j.status in ('pending', 'running'))
      -- An install whose account list could not be read (for example a token that no longer decrypts) is tried again after half an hour, not on every five-minute tick for ever.
      and not exists (select 1 from sync_jobs j where j.installation_id = i.id and j.type = 'locations' and j.status = 'failed' and j.finished_at > now() - interval '30 minutes')
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

// Every REFRESH_EVERY_MINUTES, re-read only what goes stale fastest: conversations, appointments and reply times, then recompute alerts.
// A slow-reply alert that arrives hours late is worthless, so this does not wait for the daily full sync (contacts and deals
// stay on the daily schedule, and webhooks cover changes in between).
// A cycle is due when the previous one was QUEUED (not finished) REFRESH_DUE_AFTER_MINUTES ago: measured from the finish with a plain 15 the
// real cadence was 20 minutes, because the scheduler ticks every 5 (see src/lib/sync/schedule.ts and docs/features/S0.4.md).
export const FAST_REFRESH_MINUTES = REFRESH_EVERY_MINUTES;
// `only` and `requireToken: false` exist for tests on a fixture installation (a fixture has no refresh token, so the production scheduler leaves it alone).
export async function scheduleFastRefresh(opts: { only?: string; requireToken?: boolean } = {}): Promise<number> {
  const requireToken = opts.requireToken ?? true;
  const rows = await sql()`
    select i.id from installations i
    where i.uninstalled_at is null and not i.is_demo and (${!requireToken} or i.refresh_token_enc is not null)
      and (${opts.only ?? null}::uuid is null or i.id = ${opts.only ?? null}::uuid)
      and exists (select 1 from locations l where l.installation_id = i.id and not l.ignored)
      and not exists (select 1 from sync_jobs j where j.installation_id = i.id and j.status in ('pending', 'running'))
      and coalesce((select max(j.created_at) from sync_jobs j where j.installation_id = i.id and j.type = 'metrics'), 'epoch') < now() - make_interval(mins => ${REFRESH_DUE_AFTER_MINUTES}::int)`;
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
  const { mode: cm, page: cp, ...rest } = (job.cursor ?? {}) as { mode?: Mode; page?: number } & Record<string, unknown>;
  const wmRow = await readWatermark(job.installationId, loc, "contacts");
  // A fresh job decides its own pass; a resumed one keeps what it started as. A hard sync starts with mode "full".
  let mode: Mode = cm ?? (hasKeys(rest) ? "full" : chooseMode({ ...wmRow, nowMs: Date.now() }));
  let cursor = (hasKeys(rest) ? rest : null) as ContactCursor;
  let incPage = cp ?? 1, rowsSeen = 0;
  for (let page = 0; page < PAGES_PER_SLICE; page++) {
    let contacts: ContactRow[], next: ContactCursor = null, incNext: number | null = null;
    if (mode === "incremental" && wmRow.watermarkMs !== null) {
      try {
        const r = await fetchContactsUpdatedPage(token, loc, incPage);
        if (!isSortedNewestFirst(r.contacts.map((c) => ms(c.updatedAt)))) throw new Error("the contact list did not come newest-change-first");
        const t = takeFresh(r.contacts, (c) => ms(c.updatedAt), wmRow.watermarkMs);
        contacts = t.fresh; incNext = r.more && !t.reachedOld ? incPage + 1 : null;
      } catch (error) {
        if (isPermissionError(error)) throw error;
        // The incremental read is not available or not trustworthy here: read everything this once (safe, never misses a change).
        console.error("incremental contacts fell back to a full read", { message: safeError(error) });
        mode = "full"; cursor = null; continue;
      }
    } else {
      mode = "full";
      ({ contacts, next } = await fetchContactsPage(token, loc, cursor));
    }
    rowsSeen += contacts.length;
    const unique = [...new Map(contacts.map((c) => [c.contactId, c])).values()];
    if (unique.length > 0) {
      await recordTagEvents(job.installationId, loc, unique);
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
          tags = excluded.tags, date_added = excluded.date_added,
          -- A note or field SubSync wrote can move the contact activity date. Within the window after one of our writes the older date is kept (spec 10).
          last_activity_at = case when exists (
            select 1 from crm_writes w where w.installation_id = excluded.installation_id and w.location_id = excluded.location_id and w.contact_id = excluded.contact_id
              and w.undone_at is null and excluded.last_activity_at >= w.created_at - make_interval(secs => ${OUR_WRITE_LEAD_MS / 1000}) and excluded.last_activity_at <= w.created_at + make_interval(secs => ${OUR_WRITE_WINDOW_MS / 1000}))
            then cached_contacts.last_activity_at else excluded.last_activity_at end,
          updated_remote_at = excluded.updated_remote_at, synced_at = excluded.synced_at,
          source = excluded.source, dnd = excluded.dnd, birth_date = excluded.birth_date, assigned_to = excluded.assigned_to`;
    }
    if (mode === "incremental" ? incNext === null : !next) {
      // Finished a full pass: anything not seen during it was deleted upstream. An incremental pass never deletes (a full pass and the delete events do).
      if (mode === "full") await db`delete from cached_contacts where installation_id = ${job.installationId} and location_id = ${loc} and synced_at < ${job.startedAt}`;
      await db`update locations set contacts_synced_at = now(), last_synced_at = now(), sync_error = null where installation_id = ${job.installationId} and location_id = ${loc}`;
      await finishRead(job, loc, "contacts", mode, mode === "full" || rowsSeen > 0);
      return DONE;
    }
    if (mode === "incremental") incPage = incNext as number; else cursor = next;
    if (Date.now() > deadline) break;
  }
  return { done: false, cursor: (mode === "incremental" ? { mode, page: incPage } : { mode, ...(cursor ?? {}) }) as Record<string, unknown> };
}

// Compare this page of contacts' tags with what we hold and keep a log of every tag seen added or removed (stage F10). The platform does not say when a tag was
// added, so the day is the day SubSync noticed. The first read of an account records nothing (every tag would look new). A failure here never stops the sync.
async function recordTagEvents(installationId: string, loc: string, incoming: ContactRow[]): Promise<void> {
  try {
    const db = sql();
    const ids = incoming.map((c) => c.contactId);
    const [before, [prior]] = await Promise.all([
      db`select contact_id, tags from cached_contacts where installation_id = ${installationId} and location_id = ${loc} and contact_id = any(${ids})`,
      db`select contacts_synced_at from locations where installation_id = ${installationId} and location_id = ${loc}`,
    ]);
    const events = diffTagEvents(
      incoming.map((c) => ({ contactId: c.contactId, tags: c.tags })),
      new Map(before.map((r) => [r.contact_id as string, r.tags as string[] | null])),
      prior?.contacts_synced_at != null,
    );
    // A tag SubSync itself added (the call-outcome tags) is not a change the customer made: it is kept out of tag history (principle 14).
    const prefix = tagPrefix();
    const theirs = events.filter((e) => !isOurTag(e.tag, prefix));
    if (theirs.length === 0) return;
    const rows = theirs.map((e) => ({ installation_id: installationId, location_id: loc, contact_id: e.contactId, tag: e.tag, kind: e.kind }));
    await db`insert into contact_tag_events ${db(rows as never)}`;
  } catch (error) {
    console.error("tag history not recorded", { message: safeError(error) });
  }
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
  const oc = (job.cursor ?? {}) as { mode?: Mode; page?: number };
  const wmRow = await readWatermark(job.installationId, loc, "opportunities");
  let mode: Mode = oc.mode ?? (oc.page ? "full" : chooseMode({ ...wmRow, nowMs: Date.now() }));
  let pageNo = Number(oc.page ?? 1), rowsSeen = 0;
  for (let i = 0; i < PAGES_PER_SLICE; i++) {
    let opportunities: OpportunityRow[], nextPage: number | null;
    if (mode === "incremental" && wmRow.watermarkMs !== null) {
      try {
        const r = await fetchOpportunitiesPage(token, loc, pageNo, 100, true);
        if (!isSortedNewestFirst(r.opportunities.map((o) => ms(o.updatedAt)))) throw new Error("the deal list did not come newest-change-first");
        const t = takeFresh(r.opportunities, (o) => ms(o.updatedAt), wmRow.watermarkMs);
        opportunities = t.fresh; nextPage = t.reachedOld ? null : r.nextPage;
      } catch (error) {
        if (isPermissionError(error)) throw error;
        console.error("incremental deals fell back to a full read", { message: safeError(error) });
        mode = "full"; pageNo = 1; continue;
      }
    } else {
      mode = "full";
      ({ opportunities, nextPage } = await fetchOpportunitiesPage(token, loc, pageNo));
    }
    rowsSeen += opportunities.length;
    const unique = [...new Map(opportunities.map((o) => [o.opportunityId, o])).values()];
    if (unique.length > 0) {
      await recordDealEvents(job.installationId, loc, unique);
      // The deal history (flag pl_record, never throws): diffed against the stored rows, so it runs BEFORE the cache is written below.
      await recordDealsFromSync(job.installationId, loc, unique);
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
      if (mode === "full") await db`delete from cached_opportunities where installation_id = ${job.installationId} and location_id = ${loc} and synced_at < ${job.startedAt}`;
      await db`update locations set opportunities_synced_at = now(), last_synced_at = now() where installation_id = ${job.installationId} and location_id = ${loc}`;
      await finishRead(job, loc, "opportunities", mode, mode === "full" || rowsSeen > 0);
      void refreshRollup(job.installationId, { locations: [loc] }).catch(() => undefined); // stored deal totals; the hourly sweep rebuilds them too
      return DONE;
    }
    pageNo = nextPage;
    if (Date.now() > deadline) break;
  }
  return { done: false, cursor: { mode, page: pageNo } };
}

// Up to 500 conversations per account (the newest first). The limit is stated on every screen that counts conversations (waiting.ts).
const CONVERSATION_PAGES = CONVERSATIONS_READ_PER_ACCOUNT / CONVERSATION_PAGE_SIZE;

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
        last_message_at: c.lastMessageAt, unread_count: c.unreadCount, assigned_to: c.assignedTo, synced_at: new Date(),
      }));
      await tx`insert into cached_conversations ${tx(rows as never)}`;
    }
    await tx`update locations set conversations_synced_at = now(), last_synced_at = now() where installation_id = ${job.installationId} and location_id = ${loc}`;
  });
  return DONE;
}

const APPOINTMENT_FUTURE_DAYS = 60;
const MAX_CALENDARS = 500; // a very large account is read up to this many calendars; anything past it is counted and shown as "not fully read"

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
      // The picture comes with the name from the same read (no extra permission). It is refreshed every time; the name only when it was not typed.
      await db`
        insert into team_names (installation_id, user_id, name, source, photo_url, seen_at) values (${job.installationId}, ${u.id}, ${u.name}, 'platform', ${u.photoUrl}, now())
        on conflict (installation_id, user_id) do update set
          name = case when team_names.source = 'platform' then excluded.name else team_names.name end,
          photo_url = excluded.photo_url, seen_at = now()`;
    }
    // Who belongs to THIS account (feeds the Owner picker). A missing table never breaks the rest of the sync.
    try {
      const named = users.filter((u) => u.name);
      for (const u of named) {
        await db`insert into location_users (installation_id, location_id, user_id, name, seen_at) values (${job.installationId}, ${loc}, ${u.id}, ${u.name}, now())
          on conflict (installation_id, location_id, user_id) do update set name = excluded.name, seen_at = now()`;
      }
      await db`delete from location_users where installation_id = ${job.installationId} and location_id = ${loc} and not (user_id = any(${named.map((u) => u.id)}))`;
    } catch (error) { console.error("Saving account members failed", safeError(error)); }
    // Team module: who they are and which accounts they reach (never throws; a missing table is logged once and skipped).
    await saveLocationUsers(job.installationId, loc, users);
  } catch (error) {
    usersAccess = isPermissionError(error) ? "needs_permission" : "error";
    if (usersAccess === "error") console.error("Reading team names failed", safeError(error));
  }

  const now = Date.now();
  const fromMs = now - APPOINTMENT_PAST_DAYS * 86_400_000;
  const toMs = now + APPOINTMENT_FUTURE_DAYS * 86_400_000;
  let access: "ok" | "needs_permission" | "error" = "ok";
  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;
  try {
    const all = await fetchCalendars(token, loc);
    await saveCalendars(job.installationId, loc, all, token);
    const calendars = all.slice(0, MAX_CALENDARS);
    skipped = all.length - calendars.length;
    for (const cal of calendars) {
      const events = await fetchAppointments(token, loc, cal.id, fromMs, toMs);
      for (const a of events) {
        rows.push({
          installation_id: job.installationId, location_id: loc, appointment_id: a.appointmentId, calendar_id: a.calendarId ?? cal.id, calendar_name: cal.name,
          contact_id: a.contactId, title: a.title, status: a.status, start_at: a.startAt, end_at: a.endAt, assigned_to: a.assignedTo, created_remote_at: a.createdAt, booked_by_user: a.bookedByUser, booking_channel: a.bookingChannel,
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
          created_remote_at = excluded.created_remote_at, booked_by_user = excluded.booked_by_user, booking_channel = excluded.booking_channel, synced_at = excluded.synced_at`;
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
  try { await db`update locations set calendars_skipped = ${skipped} where installation_id = ${job.installationId} and location_id = ${loc}`; } catch { /* the column arrives with the migration */ }
  return DONE;
}

/** Keeps the account's FULL calendar list (every calendar, active or not, with its group and the team members on it), so a calendar with no bookings still shows.
 *  Never fails the sync: a missing permission is recorded as such. A calendar that disappeared from the platform is marked inactive, not removed, so its history stays readable. */
async function saveCalendars(inst: string, loc: string, cals: CalendarRow[], token: string): Promise<void> {
  const db = sql();
  let calAccess: "ok" | "needs_permission" | "error" = "ok", grpAccess: "ok" | "needs_permission" | "error" = "ok";
  try {
    for (let i = 0; i < cals.length; i += 200) {
      const batch = cals.slice(i, i + 200).map((c) => ({ installation_id: inst, location_id: loc, calendar_id: c.id, name: c.name, group_id: c.groupId, is_active: c.isActive, calendar_type: c.calendarType, round_robin: c.roundRobin, synced_at: new Date() }));
      await db`insert into cached_calendars ${db(batch as never)} on conflict (installation_id, location_id, calendar_id) do update set name = excluded.name, group_id = excluded.group_id, is_active = excluded.is_active, calendar_type = excluded.calendar_type, round_robin = excluded.round_robin, synced_at = excluded.synced_at`;
    }
    await db`update cached_calendars set is_active = false where installation_id = ${inst} and location_id = ${loc} and not (calendar_id = any(${cals.map((c) => c.id)}::text[]))`;
    const members = cals.flatMap((c) => c.memberIds.map((u) => ({ installation_id: inst, location_id: loc, calendar_id: c.id, user_id: u, synced_at: new Date() })));
    for (let i = 0; i < members.length; i += 500) await db`insert into calendar_members ${db(members.slice(i, i + 500) as never)} on conflict do nothing`;
    await db`delete from calendar_members where installation_id = ${inst} and location_id = ${loc} and not (calendar_id || ':' || user_id = any(${members.map((m) => m.calendar_id + ":" + m.user_id)}::text[]))`;
  } catch (error) { calAccess = isPermissionError(error) ? "needs_permission" : "error"; if (calAccess === "error") console.error("Saving calendars failed", safeError(error)); }
  try {
    const groups = await fetchCalendarGroups(token, loc);
    for (let i = 0; i < groups.length; i += 200) {
      const batch = groups.slice(i, i + 200).map((g) => ({ installation_id: inst, location_id: loc, group_id: g.id, name: g.name, is_active: g.isActive, synced_at: new Date() }));
      await db`insert into calendar_groups ${db(batch as never)} on conflict (installation_id, location_id, group_id) do update set name = excluded.name, is_active = excluded.is_active, synced_at = excluded.synced_at`;
    }
  } catch (error) { grpAccess = isPermissionError(error) ? "needs_permission" : "error"; if (grpAccess === "error") console.error("Reading calendar groups failed", safeError(error)); }
  try { await db`update locations set calendars_access = ${calAccess}, calendar_groups_access = ${grpAccess} where installation_id = ${inst} and location_id = ${loc}`; } catch { /* the columns arrive with the migration */ }
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
      and (t.id is null or t.touch_at is null or t.read_version < 1)
    order by (t.id is null) desc, c.date_added desc limit ${SPEED_PER_RUN}`;
  const rules = () => applyLeadRules(job.installationId, loc).catch((e) => console.error("Applying the lead rules failed", safeError(e)));
  if (candidates.length === 0) { await rules(); return DONE; }

  const token = await tokenForLocation(job.companyId, loc);
  let access: "ok" | "needs_permission" = "ok";
  for (const c of candidates) {
    try {
      const all = await fetchConversationMessages(token, loc, c.conversation_id as string);
      // Principle 14: a message SubSync itself sent (the composer) is never a first reply, so it never changes the speed numbers.
      const ours = new Set((await db`select ghl_id from crm_writes where installation_id = ${job.installationId} and contact_id = ${c.contact_id} and kind = 'message' and ghl_id is not null and undone_at is null`).map((r) => r.ghl_id as string));
      const msgs = ours.size ? all.filter((m) => !(m.id && ours.has(m.id))) : all;
      // Touch events (stage SPEED4): one metadata row per message or call, never the text. Idempotent, so a re-read adds nothing.
      await recordTouchEvents(job.installationId, eventsOfMessages(all, { locationId: loc, contactId: c.contact_id as string, conversationId: c.conversation_id as string }));
      const lead = leadFromMessages(msgs, c.date_added instanceof Date ? c.date_added.getTime() : null, countAutomated);
      if (!lead) continue;
      // The automatic first message and the person's first reply, kept apart whatever the setting counts (N78).
      const ft = firstTouches(msgs, lead.leadAt);
      const at = (ms: number | null) => (ms === null ? null : new Date(ms));
      // A conversation longer than one page (100 messages) was read from its newest end only, so its first messages were not seen: 2 means "read, not complete",
      // and the screen does not use those leads for the automatic-versus-person view. 1 means read in full.
      const version = msgs.length >= 100 ? 2 : 1;
      // A reply already recorded is never taken back by a later read that saw fewer messages (touch_at and its user are kept once set).
      await db`
        insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id, auto_touch_at, human_touch_at, read_version)
        values (${job.installationId}, ${loc}, ${c.contact_id}, ${c.conversation_id}, ${new Date(lead.leadAt)}, ${at(lead.touchAt)}, ${lead.touchUserId}, ${at(ft.autoAt)}, ${at(ft.humanAt)}, ${version})
        on conflict (installation_id, location_id, conversation_id) do update set lead_at = excluded.lead_at,
          touch_at = coalesce(lead_touches.touch_at, excluded.touch_at),
          touch_user_id = case when lead_touches.touch_at is not null then lead_touches.touch_user_id else excluded.touch_user_id end,
          auto_touch_at = excluded.auto_touch_at, human_touch_at = excluded.human_touch_at, read_version = excluded.read_version, checked_at = now()`;
    } catch (error) {
      if (isPermissionError(error)) { access = "needs_permission"; break; }
      console.error("Reading a conversation failed", safeError(error));
    }
  }
  await db`
    update locations set speed_access = ${access}, speed_synced_at = case when ${access} = 'ok' then now() else speed_synced_at end
    where installation_id = ${job.installationId} and location_id = ${loc}`;
  await rules();
  return DONE;
}

// SPEED4 backfill: the last 30 days of message and call history, a few conversations per run, newest first. Metadata only; idempotent, so a repeat adds nothing. Never fails the account.
async function backfillTouchEvents(job: Job): Promise<void> {
  const db = sql();
  const loc = job.locationId as string;
  const todo = await db`
    select v.conversation_id, v.contact_id from cached_conversations v
    where v.installation_id = ${job.installationId} and v.location_id = ${loc} and v.contact_id is not null and v.last_message_at >= ${new Date(Date.now() - 30 * 86_400_000)}
      and not exists (select 1 from touch_events e where e.installation_id = v.installation_id and e.location_id = v.location_id and e.conversation_id = v.conversation_id)
    order by v.last_message_at desc limit 25`;
  if (todo.length === 0) return;
  const token = await tokenForLocation(job.companyId, loc);
  for (const c of todo) {
    try {
      const msgs = await fetchConversationMessages(token, loc, c.conversation_id as string);
      const ev = eventsOfMessages(msgs, { locationId: loc, contactId: c.contact_id as string, conversationId: c.conversation_id as string });
      // A conversation with nothing to keep still gets one marker row-less pass next run only if it has messages; an empty one is simply skipped.
      await recordTouchEvents(job.installationId, ev);
    } catch (error) { if (isPermissionError(error)) return; console.error("Backfilling a conversation failed", safeError(error)); }
  }
}

async function runJob(job: Job, deadline: number): Promise<Outcome> {
  switch (job.type) {
    case "locations": return handleLocations(job);
    case "structure": return handleStructure(job);
    case "contacts": return handleContacts(job, deadline);
    case "opportunities": return handleOpportunities(job, deadline);
    case "conversations": return handleConversations(job);
    case "appointments": return handleAppointments(job);
    case "speed": { const r = await handleSpeed(job); await backfillTouchEvents(job).catch((e) => console.error("Backfill failed", safeError(e))); return r; }
    case "metrics":
      await refreshInsights(job.installationId);
      // Lead intake (stage DQ): forms, surveys and funnels, read only, at most every 30 minutes per account. Never stops the nightly work.
      await (await import("./dq-sync")).pollIntake(job.installationId, (l) => tokenForLocation(job.companyId, l), 15_000).catch(() => undefined);
      // The nightly reconcile of the speed history: rebuild the daily rollup for the last 35 days and drop events past retention.
      { const [st] = await sql()`select speed_target_minutes from settings where installation_id = ${job.installationId}`; await rebuildSpeedDaily(job.installationId, Number(st?.speed_target_minutes ?? 15)); }
      return DONE;
  }
}

// ---------------- the worker loop ----------------

// `focusLocationId`: the account the person is looking at. Its jobs are claimed first, so its numbers land before the big accounts' reads even start.
export type SliceScope = { installationId?: string | null; locationId?: string | null; focusLocationId?: string | null };

async function claimJob(scope: SliceScope = {}): Promise<Job | null> {
  const scopeInst = scope.installationId ?? null, scopeLoc = scope.locationId ?? null, focus = scope.focusLocationId ?? null;
  const rows = await sql()`
    update sync_jobs set status = 'running', started_at = coalesce(started_at, now()), updated_at = now()
    where id = (
      select j.id from sync_jobs j
      where (j.status = 'pending' or (j.status = 'running' and j.updated_at < now() - interval '10 minutes'))
        and (${scopeInst}::uuid is null or j.installation_id = ${scopeInst}::uuid)
        and (${scopeLoc}::text is null or j.location_id = ${scopeLoc}::text or j.location_id is null)
        and (j.type <> 'metrics' or not exists (
          select 1 from sync_jobs o
          where o.installation_id = j.installation_id and o.id <> j.id and o.type <> 'metrics' and o.status in ('pending', 'running')))
      order by (j.type = 'metrics'),
        (j.location_id is distinct from ${focus}::text),
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
    return claimJob(scope);
  }
  return {
    id: r.id, installationId: r.installation_id, companyId: inst.company_id, locationId: r.location_id, type: r.type as JobType,
    cursor: (r.cursor ?? null) as Record<string, unknown> | null, startedAt: r.started_at as Date,
  };
}

function safeMessage(error: unknown): string {
  return safeError(error);
}

// A location's `sync_error` is the last failure of any of its jobs. It used to be cleared only by the daily structure and contacts reads, so one
// failed 15-minute read left "Sync issue" on screen for up to 20 hours after the next read had succeeded. Clear it once the latest job of every
// type for that account is no longer a failure.
export async function clearResolvedError(installationId: string, locationId: string): Promise<void> {
  await sql()`
    update locations set sync_error = null
    where installation_id = ${installationId} and location_id = ${locationId} and sync_error is not null
      and not exists (
        select 1 from (select distinct on (type) type, status from sync_jobs where installation_id = ${installationId} and location_id = ${locationId} and status in ('done', 'failed') order by type, created_at desc) t
        where t.status = 'failed')`;
}

export type SliceResult = { jobs: number; failed: number; moreWork: boolean };

// A step that has not answered in this long is given up on and marked failed ("took too long"), so a hung CRM call or database statement shows as a clear failed step
// instead of an endless "Syncing..." (the next cycle retries it). Resumable steps (contacts, deals) hand back their cursor well before this.
export const JOB_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function withJobTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`Took longer than ${Math.round(ms / 1000)} seconds and was stopped. It is tried again on the next sync.`)), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

// Several workers claim jobs at once (FOR UPDATE SKIP LOCKED keeps them apart), so the six steps of a small account run side by side instead of one after another.
// `scope` limits the slice to one install (and one account): a person who pressed "Sync now" is never queued behind other companies' jobs. A worker that finds nothing
// claimable while other steps are still running waits a moment (the metrics step is released only when everything else is done) until the time budget ends.
export async function runSlice(budgetMs = 45_000, opts: SliceScope & { concurrency?: number } = {}): Promise<SliceResult> {
  if (maintenanceOn(process.env)) return { jobs: 0, failed: 0, moreWork: false }; // kill switch: nothing runs
  const db = sql();
  const deadline = Date.now() + budgetMs;
  const scope: SliceScope = { installationId: opts.installationId ?? null, locationId: opts.locationId ?? null, focusLocationId: opts.focusLocationId ?? null };
  const counts = { jobs: 0, failed: 0 };
  const inScope = async () => {
    const [r] = await db`select count(*)::int n from sync_jobs where status in ('pending', 'running')
      and (${scope.installationId ?? null}::uuid is null or installation_id = ${scope.installationId ?? null}::uuid)
      and (${scope.locationId ?? null}::text is null or location_id = ${scope.locationId ?? null}::text or location_id is null)`;
    return r.n as number;
  };
  const worker = async () => {
    while (Date.now() < deadline) {
      const job = await claimJob(scope);
      if (!job) {
        if (!opts.installationId || (await inScope()) === 0) break;
        await sleep(500);
        continue;
      }
      counts.jobs++;
      try {
        const outcome = await withJobTimeout(runJob(job, deadline), JOB_TIMEOUT_MS);
        if (outcome.done) {
          await db`update sync_jobs set status = 'done', cursor = null, error = null, finished_at = now(), updated_at = now() where id = ${job.id}`;
          // The cheap kinds replace their rows wholesale, so a finished one is a possible change: the open screens re-read (contacts and deals stamp themselves, only when rows changed).
          if (job.locationId && (job.type === "conversations" || job.type === "appointments" || job.type === "speed" || job.type === "structure")) await markDataChanged(job.installationId, job.locationId, job.type).catch(() => undefined);
          if (job.locationId) await clearResolvedError(job.installationId, job.locationId).catch((e) => console.error("Clearing a resolved sync error failed", safeError(e)));
        } else {
          await db`update sync_jobs set status = 'pending', cursor = ${db.json(outcome.cursor as never)}, updated_at = now() where id = ${job.id}`;
        }
      } catch (error) {
        counts.failed++;
        const message = safeMessage(error);
        console.error("Sync job failed", { type: job.type, message });
        await db`update sync_jobs set status = 'failed', error = ${message}, finished_at = now(), updated_at = now() where id = ${job.id}`;
        if (job.locationId) {
          await db`update locations set sync_error = ${message} where installation_id = ${job.installationId} and location_id = ${job.locationId}`;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 1, 6)) }, () => worker()));
  const [pending] = await db`select count(*)::int n from sync_jobs where status in ('pending', 'running')`;
  return { jobs: counts.jobs, failed: counts.failed, moreWork: pending.n > 0 };
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
