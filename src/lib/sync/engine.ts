import { refreshInsights } from "../analytics/service";
import { sql } from "../db";
import { getInstalledLocations, getLocationToken } from "../ghl/client";
import { getCompanyAccessToken, purgeLocationData } from "../ghl/installations";
import {
  fetchCalendarCount, fetchContactsPage, fetchConversationsPage, fetchLocationDetails, fetchOpportunitiesPage, fetchPipelines,
  type ContactCursor, type ConversationRow,
} from "./ghl-data";
import { listAllInstalledLocations } from "./installed-locations";

// Resumable sync. Work is a queue of jobs in `sync_jobs`; a cron route calls runSlice() which
// claims jobs one at a time (FOR UPDATE SKIP LOCKED, so parallel invocations never collide),
// works within a time budget, saves its cursor and hands the job back if it runs out of time.
// A full sync is: one `locations` job, which fans out to per-account jobs, then one `metrics`
// job that only runs once everything else has finished.

export type JobType = "locations" | "structure" | "contacts" | "opportunities" | "conversations" | "metrics";
const PER_LOCATION: JobType[] = ["structure", "contacts", "opportunities", "conversations"];

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

// Re-sync one area of one account (used by webhooks). Cheap to call repeatedly: it is a no-op
// while an identical job is already queued.
export async function enqueueAreaSync(installationId: string, locationId: string, area: "contacts" | "opportunities" | "conversations" | "structure"): Promise<number> {
  return enqueueJobs(installationId, [locationId], [area]);
}

// Start a daily refresh for installs that have not synced in the last ~20 hours.
export async function scheduleDailyRefresh(): Promise<number> {
  const rows = await sql()`
    select i.id from installations i
    where i.uninstalled_at is null and not i.is_demo and i.refresh_token_enc is not null
      and not exists (select 1 from sync_jobs j where j.installation_id = i.id and j.status in ('pending', 'running'))
      and coalesce((select max(j.finished_at) from sync_jobs j where j.installation_id = i.id and j.type = 'locations' and j.status = 'done'), 'epoch') < now() - interval '20 hours'`;
  let n = 0;
  for (const r of rows) n += await enqueueFullSync(r.id as string);
  return n;
}

// ---------------- location tokens ----------------

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function tokenForLocation(companyId: string, locationId: string): Promise<string> {
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
      }));
      await db`
        insert into cached_contacts ${db(rows as never)}
        on conflict (installation_id, location_id, contact_id) do update set
          first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, phone = excluded.phone,
          tags = excluded.tags, date_added = excluded.date_added, last_activity_at = excluded.last_activity_at,
          updated_remote_at = excluded.updated_remote_at, synced_at = excluded.synced_at`;
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

async function handleOpportunities(job: Job, deadline: number): Promise<Outcome> {
  const db = sql();
  const loc = job.locationId as string;
  const token = await tokenForLocation(job.companyId, loc);
  let pageNo = Number((job.cursor as { page?: number } | null)?.page ?? 1);
  for (let i = 0; i < PAGES_PER_SLICE; i++) {
    const { opportunities, nextPage } = await fetchOpportunitiesPage(token, loc, pageNo);
    const unique = [...new Map(opportunities.map((o) => [o.opportunityId, o])).values()];
    if (unique.length > 0) {
      const rows = unique.map((o) => ({
        installation_id: job.installationId, location_id: loc, opportunity_id: o.opportunityId, pipeline_id: o.pipelineId,
        stage_id: o.stageId, contact_id: o.contactId, contact_name: o.contactName, name: o.name, monetary_value: o.monetaryValue,
        status: o.status, last_stage_change_at: o.lastStageChangeAt, last_status_change_at: o.lastStatusChangeAt,
        last_action_at: o.lastActionAt, created_remote_at: o.createdAt, updated_remote_at: o.updatedAt, synced_at: new Date(),
      }));
      await db`
        insert into cached_opportunities ${db(rows as never)}
        on conflict (installation_id, location_id, opportunity_id) do update set
          pipeline_id = excluded.pipeline_id, stage_id = excluded.stage_id, contact_id = excluded.contact_id,
          contact_name = excluded.contact_name, name = excluded.name, monetary_value = excluded.monetary_value, status = excluded.status,
          last_stage_change_at = excluded.last_stage_change_at, last_status_change_at = excluded.last_status_change_at,
          last_action_at = excluded.last_action_at, created_remote_at = excluded.created_remote_at,
          updated_remote_at = excluded.updated_remote_at, synced_at = excluded.synced_at`;
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

async function runJob(job: Job, deadline: number): Promise<Outcome> {
  switch (job.type) {
    case "locations": return handleLocations(job);
    case "structure": return handleStructure(job);
    case "contacts": return handleContacts(job, deadline);
    case "opportunities": return handleOpportunities(job, deadline);
    case "conversations": return handleConversations(job);
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
      order by (j.type = 'metrics'), j.created_at, j.id
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
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 300);
}

export type SliceResult = { jobs: number; failed: number; moreWork: boolean };

export async function runSlice(budgetMs = 45_000): Promise<SliceResult> {
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

export async function syncStatus(installationId: string) {
  const db = sql();
  const [jobs, [last], failures] = await Promise.all([
    db`select status, count(*)::int n from sync_jobs where installation_id = ${installationId} group by status`,
    db`select max(finished_at) f from sync_jobs where installation_id = ${installationId} and status = 'done'`,
    db`select type, location_id, error from sync_jobs where installation_id = ${installationId} and status = 'failed' order by finished_at desc limit 5`,
  ]);
  return {
    pending: jobs.filter((j) => j.status === "pending" || j.status === "running").reduce((s, j) => s + j.n, 0),
    failed: jobs.filter((j) => j.status === "failed").reduce((s, j) => s + j.n, 0),
    lastFinishedAt: last?.f instanceof Date ? last.f.toISOString() : null,
    recentFailures: failures.map((f) => ({ type: f.type as string, locationId: f.location_id as string | null, error: f.error as string | null })),
  };
}
