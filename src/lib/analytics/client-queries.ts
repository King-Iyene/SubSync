import { sql } from "../db";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name, installed_at from locations where installation_id = ${installationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

export type ClientExtra = {
  locationId: string; installedAt: number | null; firstLeadAt: number | null; firstWonAt: number | null;
  pipelineCreated30d: number; wonValue30d: number; wonCount30d: number; newContacts30d: number;
  monthlyFee: number | null; renewalDate: string | null; industry: string | null; notes: string | null; lastContactedAt: number | null;
};

// What the agency told us (fee, renewal, notes) plus a few counts that are cheap to get per account.
export async function clientExtras(installationId: string, allowed: string[] | null): Promise<Map<string, ClientExtra>> {
  const db = sql();
  const rows = await db`
    with loc as (${visible(installationId, allowed)})
    select loc.location_id, loc.installed_at,
      ap.monthly_fee::float8 monthly_fee, ap.renewal_date::text renewal_date, ap.industry, ap.notes, ap.last_contacted_at,
      (select min(c.date_added) from cached_contacts c where c.installation_id = ${installationId} and c.location_id = loc.location_id) first_lead_at,
      (select count(*)::int from cached_contacts c where c.installation_id = ${installationId} and c.location_id = loc.location_id and c.date_added > now() - interval '30 days') new_30d,
      coalesce((select sum(o.monetary_value) from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = loc.location_id and o.created_remote_at > now() - interval '30 days'), 0)::float8 pipeline_created,
      coalesce((select sum(o.monetary_value) from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = loc.location_id and o.status = 'won' and o.last_status_change_at > now() - interval '30 days'), 0)::float8 won_value,
      (select count(*)::int from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = loc.location_id and o.status = 'won' and o.last_status_change_at > now() - interval '30 days') won_count,
      (select min(o.last_status_change_at) from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = loc.location_id and o.status = 'won') first_won_at
    from loc left join account_profiles ap on ap.installation_id = ${installationId} and ap.location_id = loc.location_id`;
  const map = new Map<string, ClientExtra>();
  for (const r of rows) {
    map.set(r.location_id as string, {
      locationId: r.location_id as string, installedAt: ms(r.installed_at), firstLeadAt: ms(r.first_lead_at), firstWonAt: ms(r.first_won_at),
      pipelineCreated30d: r.pipeline_created as number, wonValue30d: r.won_value as number, wonCount30d: r.won_count as number, newContacts30d: r.new_30d as number,
      monthlyFee: r.monthly_fee as number | null, renewalDate: r.renewal_date as string | null, industry: r.industry as string | null,
      notes: r.notes as string | null, lastContactedAt: ms(r.last_contacted_at),
    });
  }
  return map;
}

export type ProfilePatch = {
  monthlyFee?: number | null; renewalDate?: string | null; industry?: string | null; notes?: string | null; markContacted?: boolean;
};

export async function saveProfile(installationId: string, allowed: string[] | null, locationId: string, patch: ProfilePatch): Promise<boolean> {
  const db = sql();
  const known = await db`select 1 from locations where installation_id = ${installationId} and location_id = ${locationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
  if (known.length === 0) return false;
  const [cur] = await db`select monthly_fee::float8 monthly_fee, renewal_date::text renewal_date, industry, notes, last_contacted_at
    from account_profiles where installation_id = ${installationId} and location_id = ${locationId}`;
  const next = {
    fee: "monthlyFee" in patch ? patch.monthlyFee ?? null : cur?.monthly_fee ?? null,
    renewal: "renewalDate" in patch ? patch.renewalDate ?? null : cur?.renewal_date ?? null,
    industry: "industry" in patch ? patch.industry ?? null : cur?.industry ?? null,
    notes: "notes" in patch ? patch.notes ?? null : cur?.notes ?? null,
    contacted: patch.markContacted ? new Date() : cur?.last_contacted_at ?? null,
  };
  await db`
    insert into account_profiles (installation_id, location_id, monthly_fee, renewal_date, industry, notes, last_contacted_at)
    values (${installationId}, ${locationId}, ${next.fee}, ${next.renewal}::date, ${next.industry}, ${next.notes}, ${next.contacted})
    on conflict (installation_id, location_id) do update set monthly_fee = excluded.monthly_fee, renewal_date = excluded.renewal_date,
      industry = excluded.industry, notes = excluded.notes, last_contacted_at = excluded.last_contacted_at, updated_at = now()`;
  return true;
}

// ---------------- executive summary (7.12), goals (7.7), anomalies (7.10) ----------------

export async function periodFigures(installationId: string, allowed: string[] | null) {
  const db = sql();
  const [[contacts], [won], [pipeNow], [pipeThen], [monthly], series] = await Promise.all([
    db`with loc as (${visible(installationId, allowed)})
       select count(*) filter (where c.date_added > now() - interval '30 days')::int cur,
         count(*) filter (where c.date_added <= now() - interval '30 days' and c.date_added > now() - interval '60 days')::int prev
       from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId}`,
    db`with loc as (${visible(installationId, allowed)})
       select count(*) filter (where o.last_status_change_at > now() - interval '30 days')::int cur_n,
         coalesce(sum(o.monetary_value) filter (where o.last_status_change_at > now() - interval '30 days'), 0)::float8 cur_v,
         count(*) filter (where o.last_status_change_at <= now() - interval '30 days' and o.last_status_change_at > now() - interval '60 days')::int prev_n,
         coalesce(sum(o.monetary_value) filter (where o.last_status_change_at <= now() - interval '30 days' and o.last_status_change_at > now() - interval '60 days'), 0)::float8 prev_v
       from cached_opportunities o join loc on loc.location_id = o.location_id where o.installation_id = ${installationId} and o.status = 'won'`,
    db`with loc as (${visible(installationId, allowed)}),
       latest as (select distinct on (m.location_id) m.location_id, m.open_value, m.engagement_score from account_metrics_daily m join loc on loc.location_id = m.location_id
         where m.installation_id = ${installationId} order by m.location_id, m.day desc)
       select coalesce(sum(open_value), 0)::float8 value, coalesce(avg(engagement_score), 0)::float8 score from latest`,
    db`with loc as (${visible(installationId, allowed)}),
       then_ as (select distinct on (m.location_id) m.location_id, m.open_value, m.engagement_score from account_metrics_daily m join loc on loc.location_id = m.location_id
         where m.installation_id = ${installationId} and m.day <= current_date - 30 order by m.location_id, m.day desc)
       select coalesce(sum(open_value), 0)::float8 value, coalesce(avg(engagement_score), 0)::float8 score, count(*)::int n from then_`,
    db`with loc as (${visible(installationId, allowed)}),
       month as (select date_trunc('month', now()) start)
       select
         (select count(*)::int from cached_contacts c join loc on loc.location_id = c.location_id, month where c.installation_id = ${installationId} and c.date_added >= month.start) leads,
         (select count(*)::int from cached_opportunities o join loc on loc.location_id = o.location_id, month where o.installation_id = ${installationId} and o.status = 'won' and o.last_status_change_at >= month.start) deals,
         (select coalesce(sum(o.monetary_value), 0)::float8 from cached_opportunities o join loc on loc.location_id = o.location_id, month where o.installation_id = ${installationId} and o.status = 'won' and o.last_status_change_at >= month.start) revenue`,
    db`with loc as (${visible(installationId, allowed)})
       select m.day, sum(m.new_contacts_30d)::float8 new_contacts, sum(m.open_value)::float8 open_value, avg(m.engagement_score)::float8 score
       from account_metrics_daily m join loc on loc.location_id = m.location_id
       where m.installation_id = ${installationId} and m.day > current_date - 90 group by m.day order by m.day`,
  ]);
  return {
    contacts: { cur: contacts.cur as number, prev: contacts.prev as number },
    won: { curCount: won.cur_n as number, curValue: won.cur_v as number, prevCount: won.prev_n as number, prevValue: won.prev_v as number },
    pipeline: { now: pipeNow.value as number, then: pipeThen.n > 0 ? (pipeThen.value as number) : null },
    score: { now: Math.round(pipeNow.score as number), then: pipeThen.n > 0 ? Math.round(pipeThen.score as number) : null },
    month: { leads: monthly.leads as number, deals: monthly.deals as number, revenue: monthly.revenue as number },
    series: series.map((s) => ({ day: (iso(s.day) ?? String(s.day)).slice(0, 10), newContacts: s.new_contacts as number, openValue: s.open_value as number, score: s.score as number })),
  };
}

// 90 days of one account's numbers, for the QBR and the health timeline (6.6).
export async function accountHistory(installationId: string, locationId: string) {
  const rows = await sql()`
    select m.day, m.contacts, m.new_contacts_30d, m.open_value::float8 open_value, m.open_opportunities, m.engagement_score
    from account_metrics_daily m where m.installation_id = ${installationId} and m.location_id = ${locationId} and m.day > current_date - 90 order by m.day`;
  return rows.map((r) => ({
    day: (iso(r.day) ?? String(r.day)).slice(0, 10), contacts: r.contacts as number, newContacts30d: r.new_contacts_30d as number,
    openValue: r.open_value as number, openOpportunities: r.open_opportunities as number, score: r.engagement_score as number,
  }));
}
