import { sql } from "../db";
import type { AccountRow, AccountSettings, AlertDraft } from "./derive";
import type { DomainReport } from "../dns/email-auth";

// Every query is scoped by installation_id. Counts are cast to int/float8 so the driver does
// not hand back strings.

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);

// Postgres array literal for a list of strings, passed as a text parameter and cast in SQL.
export const pgTextArray = (items: string[]): string =>
  `{${items.map((s) => `"${s.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

// ---------------- settings ----------------

export type Settings = AccountSettings & {
  slackWebhookUrl: string | null;
  appDomain: string;
  digestEnabled: boolean;
  customChecklist: string[];
  /** Local hour (0 to 23) the daily brief is sent, and the time zone it is judged in. Null means the defaults. */
  digestHour: number | null;
  digestTimezone: string | null;
  /** Name and colour shown at the top of printed client reports. */
  brandName: string | null;
  brandColor: string | null;
  /** Use each industry's own reply target in the daily brief instead of one number for everyone. */
  industryTargets: boolean;
  keepTranscripts: boolean;
};

export async function getSettings(installationId: string): Promise<Settings> {
  const db = sql();
  const read = () => db`
    select stale_deal_days, dormant_days, sla_hours, slack_webhook_url, ghl_app_domain, digest_enabled, custom_checklist, digest_hour, digest_timezone, brand_name, brand_color, industry_targets, keep_transcripts
    from settings where installation_id = ${installationId}`;
  let [r] = await read();
  if (!r) {
    // First read for this agency: create the default row (rare), then read it back.
    await db`insert into settings (installation_id) values (${installationId}) on conflict do nothing`;
    [r] = await read();
  }
  const days = Array.isArray(r.stale_deal_days) && r.stale_deal_days.length ? Number(r.stale_deal_days[0]) : 30;
  return {
    staleDays: days,
    dormantDays: r.dormant_days,
    slaHours: r.sla_hours,
    slackWebhookUrl: r.slack_webhook_url,
    appDomain: r.ghl_app_domain,
    digestEnabled: r.digest_enabled,
    customChecklist: Array.isArray(r.custom_checklist) ? r.custom_checklist.filter((x: unknown): x is string => typeof x === "string") : [],
    digestHour: (r.digest_hour as number | null) ?? null,
    digestTimezone: (r.digest_timezone as string | null) ?? null,
    brandName: (r.brand_name as string | null) ?? null,
    brandColor: (r.brand_color as string | null) ?? null,
    industryTargets: r.industry_targets === true,
    keepTranscripts: r.keep_transcripts === true,
  };
}

export async function updateSettings(installationId: string, p: Partial<Settings>): Promise<void> {
  const db = sql();
  await db`insert into settings (installation_id) values (${installationId}) on conflict do nothing`;
  await db`
    update settings set
      stale_deal_days = coalesce(${p.staleDays !== undefined ? [p.staleDays, p.staleDays * 2, p.staleDays * 3] : null}::int[], stale_deal_days),
      dormant_days = coalesce(${p.dormantDays ?? null}::int, dormant_days),
      sla_hours = coalesce(${p.slaHours ?? null}::int, sla_hours),
      slack_webhook_url = case when ${p.slackWebhookUrl !== undefined} then ${p.slackWebhookUrl ?? null} else slack_webhook_url end,
      ghl_app_domain = coalesce(${p.appDomain ?? null}, ghl_app_domain),
      digest_enabled = coalesce(${p.digestEnabled ?? null}::boolean, digest_enabled),
      digest_hour = case when ${p.digestHour !== undefined} then ${p.digestHour ?? null}::int else digest_hour end,
      digest_timezone = case when ${p.digestTimezone !== undefined} then ${p.digestTimezone ?? null} else digest_timezone end,
      industry_targets = coalesce(${p.industryTargets ?? null}::boolean, industry_targets),
      keep_transcripts = coalesce(${p.keepTranscripts ?? null}::boolean, keep_transcripts),
      brand_name = case when ${p.brandName !== undefined} then ${p.brandName ?? null} else brand_name end,
      brand_color = case when ${p.brandColor !== undefined} then ${p.brandColor ?? null} else brand_color end,
      custom_checklist = coalesce(${p.customChecklist !== undefined ? db.json(p.customChecklist) : null}::jsonb, custom_checklist)
    where installation_id = ${installationId}`;
}

// The accounts a plan may see (name order, ignored accounts excluded). Used to enforce the free
// plan's account limit without loading and scoring every account.
export async function visibleLocationIds(installationId: string, limit: number): Promise<string[]> {
  const rows = await sql()`
    select location_id from locations where installation_id = ${installationId} and not ignored
    order by lower(coalesce(name, '')), location_id limit ${limit}`;
  return rows.map((r) => r.location_id as string);
}

// ---------------- per-account stats ----------------

export async function accountRows(installationId: string, s: AccountSettings): Promise<AccountRow[]> {
  const rows = await sql()`
    with c as (
      select location_id,
        count(*)::int contacts,
        count(*) filter (where nullif(email, '') is not null)::int with_email,
        count(*) filter (where length(phone_digits) >= 7)::int with_phone,
        count(*) filter (where cardinality(tags) > 0)::int with_tags,
        count(*) filter (where date_added >= now() - interval '30 days')::int new_30d,
        count(*) filter (where coalesce(last_activity_at, date_added) >= now() - interval '90 days')::int active_90d,
        max(greatest(date_added, last_activity_at, updated_remote_at)) last_contact_at
      from cached_contacts where installation_id = ${installationId} group by location_id
    ), o as (
      select location_id,
        count(*) filter (where status = 'open')::int open_opps,
        coalesce(sum(monetary_value) filter (where status = 'open'), 0)::float8 open_value,
        count(*) filter (where status = 'open' and act < now() - make_interval(days => ${s.staleDays}::int))::int stale_opps,
        coalesce(sum(monetary_value) filter (where status = 'open' and act < now() - make_interval(days => ${s.staleDays}::int)), 0)::float8 stale_value,
        count(*) filter (where status = 'won')::int won_count,
        count(*) filter (where status = 'lost')::int lost_count,
        coalesce(sum(monetary_value) filter (where status = 'won'), 0)::float8 won_value,
        max(act) last_opp_at
      from (
        select location_id, status, monetary_value,
          coalesce(greatest(last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at), created_remote_at, synced_at) act
        from cached_opportunities where installation_id = ${installationId}
      ) x group by location_id
    ), v as (
      select location_id,
        count(*) filter (where unread_count > 0)::int unread,
        count(*) filter (where last_message_direction = 'inbound'
                           and last_message_at < now() - make_interval(hours => ${s.slaHours}::int)
                           and last_message_at > now() - interval '30 days')::int unanswered,
        max(last_message_at) last_msg_at
      from cached_conversations where installation_id = ${installationId} group by location_id
    )
    select l.location_id, l.name, l.email, l.phone, l.website, l.ignored, l.owner,
      l.calendar_count, l.pipeline_count, l.sync_error, l.contacts_synced_at,
      coalesce(c.contacts, 0)::int contacts, coalesce(c.with_email, 0)::int with_email,
      coalesce(c.with_phone, 0)::int with_phone, coalesce(c.with_tags, 0)::int with_tags,
      coalesce(c.new_30d, 0)::int new_30d, coalesce(c.active_90d, 0)::int active_90d,
      coalesce(o.open_opps, 0)::int open_opps, coalesce(o.open_value, 0)::float8 open_value,
      coalesce(o.stale_opps, 0)::int stale_opps, coalesce(o.stale_value, 0)::float8 stale_value,
      coalesce(o.won_count, 0)::int won_count, coalesce(o.lost_count, 0)::int lost_count,
      coalesce(o.won_value, 0)::float8 won_value,
      coalesce(v.unread, 0)::int unread, coalesce(v.unanswered, 0)::int unanswered,
      greatest(c.last_contact_at, o.last_opp_at, v.last_msg_at) last_activity_at
    from locations l
    left join c on c.location_id = l.location_id
    left join o on o.location_id = l.location_id
    left join v on v.location_id = l.location_id
    where l.installation_id = ${installationId}
    order by lower(coalesce(l.name, '')), l.location_id`;

  return rows.map((r) => ({
    locationId: r.location_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    website: r.website,
    ignored: r.ignored,
    owner: r.owner,
    contacts: r.contacts,
    withEmail: r.with_email,
    withPhone: r.with_phone,
    withTags: r.with_tags,
    new30d: r.new_30d,
    active90d: r.active_90d,
    openOpps: r.open_opps,
    openValue: r.open_value,
    staleOpps: r.stale_opps,
    staleValue: r.stale_value,
    wonCount: r.won_count,
    lostCount: r.lost_count,
    wonValue: r.won_value,
    unread: r.unread,
    unanswered: r.unanswered,
    calendars: r.calendar_count,
    pipelines: r.pipeline_count,
    lastActivityAt: toIso(r.last_activity_at),
    syncError: r.sync_error,
    contactsSyncedAt: toIso(r.contacts_synced_at),
  }));
}

// Score history per account, oldest first, excluding today (used as the churn baseline).
export type AccountHistory = { scores: number[]; newContacts: number[] };

export async function scoreHistory(installationId: string, days = 30): Promise<Map<string, AccountHistory>> {
  const rows = await sql()`
    select location_id, array_agg(engagement_score order by day) scores, array_agg(new_contacts_30d order by day) new_contacts
    from account_metrics_daily
    where installation_id = ${installationId} and day >= current_date - ${days}::int and day < current_date
    group by location_id`;
  return new Map(rows.map((r) => [r.location_id as string, { scores: r.scores as number[], newContacts: r.new_contacts as number[] }]));
}

// Deal hygiene per account: open deals that are missing a value or a contact, or have sat for 90+ days.
export type HygieneRow = { locationId: string; locationName: string | null; open: number; noValue: number; noContact: number; ancient: number };

export async function dealHygiene(installationId: string): Promise<HygieneRow[]> {
  const rows = await sql()`
    select l.location_id, l.name,
      count(*) filter (where o.status = 'open')::int open_n,
      count(*) filter (where o.status = 'open' and coalesce(o.monetary_value, 0) = 0)::int no_value,
      count(*) filter (where o.status = 'open' and coalesce(o.contact_id, '') = '')::int no_contact,
      count(*) filter (where o.status = 'open' and o.act < now() - interval '90 days')::int ancient
    from locations l
    join (
      select *, coalesce(greatest(last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at), created_remote_at, synced_at) act
      from cached_opportunities where installation_id = ${installationId}
    ) o on o.installation_id = l.installation_id and o.location_id = l.location_id
    where l.installation_id = ${installationId} and not l.ignored
    group by l.location_id, l.name
    having count(*) filter (where o.status = 'open') > 0
    order by (count(*) filter (where o.status = 'open' and coalesce(o.monetary_value, 0) = 0)
            + count(*) filter (where o.status = 'open' and coalesce(o.contact_id, '') = '')
            + count(*) filter (where o.status = 'open' and o.act < now() - interval '90 days')) desc, l.name`;
  return rows.map((r) => ({ locationId: r.location_id, locationName: r.name, open: r.open_n, noValue: r.no_value, noContact: r.no_contact, ancient: r.ancient }));
}

export async function metricsTrend(installationId: string, locationId: string, days = 60) {
  const rows = await sql()`
    select day, contacts, new_contacts_30d, open_opportunities, open_value::float8 open_value,
      stale_opportunities, unread_conversations, completeness_pct, engagement_score
    from account_metrics_daily
    where installation_id = ${installationId} and location_id = ${locationId} and day >= current_date - ${days}::int
    order by day`;
  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    contacts: r.contacts,
    newContacts30d: r.new_contacts_30d,
    openOpportunities: r.open_opportunities,
    openValue: r.open_value,
    staleOpportunities: r.stale_opportunities,
    unreadConversations: r.unread_conversations,
    completenessPct: r.completeness_pct,
    engagementScore: r.engagement_score,
  }));
}

// ---------------- contact search ----------------

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export type ContactHit = {
  contactId: string;
  locationId: string;
  locationName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  dateAdded: string | null;
  lastActivityAt: string | null;
};

export async function searchContacts(installationId: string, query: string, limit = 50, locationId?: string): Promise<ContactHit[]> {
  const db = sql();
  const term = query.trim().slice(0, 100);
  if (term.length < 2) return [];
  const like = `%${escapeLike(term)}%`;
  const digits = term.replace(/\D/g, "");
  const phoneClause = digits.length >= 3 ? db`or c.phone_digits like ${`%${digits}%`}` : db``;
  const scope = locationId ? db`and c.location_id = ${locationId}` : db``;
  const rows = await db`
    select c.contact_id, c.location_id, l.name location_name,
      coalesce(nullif(c.full_name, ''), '(no name)') name, c.email, c.phone, c.tags, c.date_added, c.last_activity_at
    from cached_contacts c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where c.installation_id = ${installationId} ${scope}
      and (c.full_name ilike ${like} or lower(c.email) like ${like.toLowerCase()} ${phoneClause})
    order by (lower(c.email) = ${term.toLowerCase()}) desc,
             (c.full_name ilike ${escapeLike(term) + "%"}) desc,
             c.last_activity_at desc nulls last, c.date_added desc nulls last
    limit ${limit}`;
  return rows.map((r) => ({
    contactId: r.contact_id,
    locationId: r.location_id,
    locationName: r.location_name,
    name: r.name,
    email: r.email,
    phone: r.phone,
    tags: r.tags ?? [],
    dateAdded: toIso(r.date_added),
    lastActivityAt: toIso(r.last_activity_at),
  }));
}

// ---------------- deals ----------------

export type DealRow = {
  opportunityId: string;
  locationId: string;
  locationName: string | null;
  name: string | null;
  contactName: string | null;
  value: number;
  pipelineName: string | null;
  stageName: string | null;
  lastActivityAt: string | null;
  daysStale: number;
};

export async function staleDeals(installationId: string, days: number, limit = 200, locationId?: string): Promise<DealRow[]> {
  const db = sql();
  const scope = locationId ? db`and o.location_id = ${locationId}` : db``;
  const rows = await db`
    select o.opportunity_id, o.location_id, l.name location_name, o.name, o.contact_name, o.monetary_value::float8 value,
      pl.name pipeline_name, st.nm stage_name, o.act,
      floor(extract(epoch from (now() - o.act)) / 86400)::int days_stale
    from (
      select *, coalesce(greatest(last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at), created_remote_at, synced_at) act
      from cached_opportunities where installation_id = ${installationId} and status = 'open'
    ) o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    left join pipelines pl on pl.installation_id = o.installation_id and pl.location_id = o.location_id and pl.pipeline_id = o.pipeline_id
    left join lateral (
      select s->>'name' nm from jsonb_array_elements(coalesce(pl.stages, '[]'::jsonb)) s where s->>'id' = o.stage_id limit 1
    ) st on true
    where o.act < now() - make_interval(days => ${days}::int) ${scope}
    order by o.monetary_value desc, o.act asc
    limit ${limit}`;
  return rows.map((r) => ({
    opportunityId: r.opportunity_id,
    locationId: r.location_id,
    locationName: r.location_name,
    name: r.name,
    contactName: r.contact_name,
    value: r.value,
    pipelineName: r.pipeline_name,
    stageName: r.stage_name,
    lastActivityAt: toIso(r.act),
    daysStale: r.days_stale,
  }));
}

export type PipelineCell = {
  locationId: string;
  locationName: string | null;
  pipelineId: string;
  pipelineName: string;
  stageName: string;
  stageOrder: number;
  status: string;
  count: number;
  value: number;
};

export async function pipelineCells(installationId: string): Promise<PipelineCell[]> {
  const rows = await sql()`
    select o.location_id, l.name location_name, coalesce(o.pipeline_id, '') pipeline_id,
      coalesce(pl.name, 'Pipeline') pipeline_name, coalesce(st.nm, 'Unknown stage') stage_name, coalesce(st.ord, 999)::int stage_order,
      o.status, count(*)::int n, coalesce(sum(o.monetary_value), 0)::float8 value
    from cached_opportunities o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    left join pipelines pl on pl.installation_id = o.installation_id and pl.location_id = o.location_id and pl.pipeline_id = o.pipeline_id
    left join lateral (
      select s->>'name' nm, t.ord from jsonb_array_elements(coalesce(pl.stages, '[]'::jsonb)) with ordinality t(s, ord)
      where s->>'id' = o.stage_id limit 1
    ) st on true
    where o.installation_id = ${installationId}
    group by o.location_id, l.name, o.pipeline_id, pl.name, st.nm, st.ord, o.status`;
  return rows.map((r) => ({
    locationId: r.location_id, locationName: r.location_name, pipelineId: r.pipeline_id, pipelineName: r.pipeline_name,
    stageName: r.stage_name, stageOrder: r.stage_order, status: r.status, count: r.n, value: r.value,
  }));
}

// ---------------- inbox ----------------

export type InboxRow = {
  conversationId: string;
  locationId: string;
  locationName: string | null;
  contactName: string | null;
  lastMessageType: string | null;
  lastMessageDirection: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  overSla: boolean;
  waitingHours: number | null;
};

export async function inbox(installationId: string, slaHours: number, limit = 200, locationId?: string): Promise<InboxRow[]> {
  const rows = await sql()`
    select * from (
      select c.conversation_id, c.location_id, l.name location_name, c.contact_name, c.last_message_type,
        c.last_message_direction, c.last_message_at, c.unread_count,
        (c.last_message_direction = 'inbound' and c.last_message_at < now() - make_interval(hours => ${slaHours}::int)
           and c.last_message_at > now() - interval '30 days') over_sla,
        case when c.last_message_direction = 'inbound' and c.last_message_at is not null
          then floor(extract(epoch from (now() - c.last_message_at)) / 3600)::int end waiting_hours
      from cached_conversations c
      join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
      where c.installation_id = ${installationId} and (${locationId ?? null}::text is null or c.location_id = ${locationId ?? null})
        and (c.unread_count > 0 or (c.last_message_direction = 'inbound' and c.last_message_at > now() - interval '30 days'))
    ) x
    order by over_sla desc, case when over_sla then last_message_at end asc, last_message_at desc nulls last
    limit ${limit}`;
  return rows.map((r) => ({
    conversationId: r.conversation_id, locationId: r.location_id, locationName: r.location_name, contactName: r.contact_name,
    lastMessageType: r.last_message_type, lastMessageDirection: r.last_message_direction, lastMessageAt: toIso(r.last_message_at),
    unreadCount: r.unread_count, overSla: Boolean(r.over_sla), waitingHours: r.waiting_hours,
  }));
}

// ---------------- duplicates (within one account only) ----------------

export type DuplicateGroup = {
  locationId: string;
  locationName: string | null;
  kind: "email" | "phone";
  key: string;
  count: number;
  contactIds: string[];
  names: string[];
};

export async function duplicateGroups(installationId: string, limit = 200, locationId?: string): Promise<DuplicateGroup[]> {
  const rows = await sql()`
    select d.*, l.name location_name from (
      select location_id, 'email' kind, lower(email) k, count(*)::int n,
        array_agg(contact_id order by date_added) ids, array_agg(coalesce(nullif(full_name, ''), '(no name)') order by date_added) names
      from cached_contacts where installation_id = ${installationId} and (${locationId ?? null}::text is null or location_id = ${locationId ?? null}) and email is not null and email <> ''
      group by location_id, lower(email) having count(*) > 1
      union all
      select location_id, 'phone', phone_digits, count(*)::int,
        array_agg(contact_id order by date_added), array_agg(coalesce(nullif(full_name, ''), '(no name)') order by date_added)
      from cached_contacts where installation_id = ${installationId} and (${locationId ?? null}::text is null or location_id = ${locationId ?? null}) and length(phone_digits) >= 7
      group by location_id, phone_digits having count(*) > 1
    ) d
    join locations l on l.installation_id = ${installationId} and l.location_id = d.location_id and not l.ignored
    order by d.n desc, l.name limit ${limit}`;
  return rows.map((r) => ({
    locationId: r.location_id, locationName: r.location_name, kind: r.kind, key: r.k, count: r.n, contactIds: r.ids, names: r.names,
  }));
}

// ---------------- alerts ----------------

export type AlertRow = {
  id: string;
  locationId: string | null;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
};

// Add new alerts, resolve ones whose condition has cleared, and return the newly created ones
// (those are the ones worth notifying about).
export async function syncAlerts(installationId: string, drafts: AlertDraft[]): Promise<AlertRow[]> {
  const db = sql();
  return db.begin(async (tx) => {
    const created: AlertRow[] = [];
    for (const d of drafts) {
      const rows = await tx`
        insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key)
        values (${installationId}, ${d.locationId}, ${d.kind}, ${d.severity}, ${d.title}, ${tx.json(d.detail as never)}, ${d.dedupeKey})
        on conflict (installation_id, dedupe_key) where resolved_at is null do update set severity = excluded.severity, title = excluded.title, detail = excluded.detail
        returning id, location_id, kind, severity, title, detail, created_at, resolved_at, (xmax = 0) as inserted`;
      const r = rows[0];
      if (r.inserted) created.push(mapAlert(r as unknown as AlertDbRow));
    }
    const keys = drafts.map((d) => d.dedupeKey);
    await tx`
      update alerts set resolved_at = now()
      where installation_id = ${installationId} and resolved_at is null and not (dedupe_key = any(${pgTextArray(keys)}::text[]))`;
    return created;
  });
}

type AlertDbRow = {
  id: string;
  location_id: string | null;
  kind: string;
  severity: AlertRow["severity"];
  title: string;
  detail: unknown;
  created_at: unknown;
  resolved_at: unknown;
};

function mapAlert(r: AlertDbRow): AlertRow {
  return {
    id: r.id, locationId: r.location_id, kind: r.kind, severity: r.severity, title: r.title,
    detail: (r.detail ?? {}) as Record<string, unknown>, createdAt: toIso(r.created_at) ?? "", resolvedAt: toIso(r.resolved_at),
  };
}

export async function listAlerts(installationId: string, includeResolved = false, limit = 200, locationId?: string): Promise<AlertRow[]> {
  const rows = await sql()`
    select id, location_id, kind, severity, title, detail, created_at, resolved_at from alerts
    where installation_id = ${installationId} and (${includeResolved} or resolved_at is null)
      and (${locationId ?? null}::text is null or location_id = ${locationId ?? null})
    order by (resolved_at is null) desc,
      case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc
    limit ${limit}`;
  return rows.map((r) => mapAlert(r as unknown as AlertDbRow));
}

export async function dismissAlert(installationId: string, alertId: string): Promise<void> {
  await sql()`update alerts set resolved_at = now() where id = ${alertId} and installation_id = ${installationId} and resolved_at is null`;
}

export async function markNotified(alertIds: string[]): Promise<void> {
  if (alertIds.length === 0) return;
  await sql()`update alerts set notified_at = now() where id = any(${pgTextArray(alertIds)}::uuid[])`;
}

// ---------------- domains ----------------

export type DomainCheckRow = {
  domain: string;
  locationId: string | null;
  status: "ok" | "warning" | "critical" | "error";
  checkedAt: string;
  report: DomainReport | null;
};

export async function listDomainChecks(installationId: string): Promise<DomainCheckRow[]> {
  const rows = await sql()`
    select domain, location_id, status, checked_at, result from domain_checks
    where installation_id = ${installationId} order by checked_at desc`;
  return rows.map((r) => ({
    domain: r.domain, locationId: r.location_id, status: r.status, checkedAt: toIso(r.checked_at) ?? "",
    report: (r.result && Object.keys(r.result).length ? r.result : null) as DomainReport | null,
  }));
}

export async function saveDomainCheck(installationId: string, locationId: string | null, domain: string, status: DomainCheckRow["status"], report: DomainReport | null): Promise<void> {
  const db = sql();
  await db`
    insert into domain_checks (installation_id, location_id, domain, status, result, checked_at)
    values (${installationId}, ${locationId}, ${domain}, ${status}, ${db.json((report ?? {}) as never)}, now())
    on conflict (installation_id, domain) do update set
      location_id = coalesce(excluded.location_id, domain_checks.location_id),
      status = excluded.status, result = excluded.result, checked_at = now()`;
}

export type DomainCandidate = { domain: string; locationId: string; locationName: string | null; source: "email" | "website" };

// Domains worth checking: each account's profile email domain and website domain.
export async function domainCandidates(installationId: string): Promise<Array<{ locationId: string; locationName: string | null; email: string | null; website: string | null }>> {
  const rows = await sql()`
    select location_id, name, email, website from locations where installation_id = ${installationId} and not ignored`;
  return rows.map((r) => ({ locationId: r.location_id, locationName: r.name, email: r.email, website: r.website }));
}

// ---------------- account controls and onboarding tasks ----------------

export async function setLocationFlags(installationId: string, locationId: string, flags: { ignored?: boolean; owner?: string | null; clientView?: boolean }): Promise<boolean> {
  const rows = await sql()`
    update locations set
      ignored = coalesce(${flags.ignored ?? null}::boolean, ignored),
      client_view = coalesce(${flags.clientView ?? null}::boolean, client_view),
      owner = case when ${flags.owner !== undefined} then ${flags.owner ?? null} else owner end
    where installation_id = ${installationId} and location_id = ${locationId} returning id`;
  return rows.length === 1;
}

export async function manualTasks(installationId: string, locationId: string): Promise<Record<string, boolean>> {
  const rows = await sql()`
    select task, done from onboarding_tasks where installation_id = ${installationId} and location_id = ${locationId}`;
  return Object.fromEntries(rows.map((r) => [r.task as string, r.done as boolean]));
}

export async function setManualTask(installationId: string, locationId: string, task: string, done: boolean): Promise<void> {
  await sql()`
    insert into onboarding_tasks (installation_id, location_id, task, done, done_at)
    values (${installationId}, ${locationId}, ${task}, ${done}, now())
    on conflict (installation_id, location_id, task) do update set done = excluded.done, done_at = now()`;
}

export async function allManualTasks(installationId: string): Promise<Map<string, Record<string, boolean>>> {
  const rows = await sql()`select location_id, task, done from onboarding_tasks where installation_id = ${installationId}`;
  const out = new Map<string, Record<string, boolean>>();
  for (const r of rows) {
    const m = out.get(r.location_id) ?? {};
    m[r.task] = r.done;
    out.set(r.location_id, m);
  }
  return out;
}
