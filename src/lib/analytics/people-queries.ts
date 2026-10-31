import { sql } from "../db";
import { daysUntilBirthday, type PaceRow, type SourceRow, type TeamRow } from "./people-intel";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

// Visible client accounts: not ignored, and within the caller's allowed list when there is one.
function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name from locations where installation_id = ${installationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

// ---------------- lead sources, do-not-disturb, birthdays ----------------

export async function leadSources(installationId: string, allowed: string[] | null): Promise<SourceRow[]> {
  const rows = await sql()`
    with loc as (${visible(installationId, allowed)}),
    won as (
      select location_id, contact_id, sum(monetary_value) v from cached_opportunities
      where installation_id = ${installationId} and status = 'won' and contact_id is not null group by location_id, contact_id)
    select coalesce(min(nullif(btrim(c.source), '')), 'Unknown') source,
      count(*)::int contacts,
      count(*) filter (where c.date_added > now() - interval '30 days')::int new30,
      count(w.contact_id)::int won,
      coalesce(sum(w.v), 0)::float8 won_value
    from cached_contacts c join loc on loc.location_id = c.location_id
    left join won w on w.location_id = c.location_id and w.contact_id = c.contact_id
    where c.installation_id = ${installationId}
    group by lower(coalesce(nullif(btrim(c.source), ''), 'unknown'))
    order by count(*) desc limit 25`;
  return rows.map((r) => ({ source: r.source, contacts: r.contacts, new30: r.new30, won: r.won, wonValue: r.won_value }));
}

export async function dndSummary(installationId: string, allowed: string[] | null) {
  const [row] = await sql()`
    with loc as (${visible(installationId, allowed)})
    select count(*)::int total, count(*) filter (where c.dnd)::int dnd,
      count(*) filter (where c.dnd and c.phone is not null and c.phone <> '')::int dnd_with_phone
    from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId}`;
  return { total: row?.total ?? 0, dnd: row?.dnd ?? 0, dndWithPhone: row?.dnd_with_phone ?? 0 };
}

export type Birthday = { contactId: string; locationId: string; locationName: string | null; name: string; days: number; birthDate: string; phone: string | null; email: string | null };

export async function upcomingBirthdays(installationId: string, allowed: string[] | null, withinDays = 30, today = new Date()): Promise<Birthday[]> {
  const rows = await sql()`
    with loc as (${visible(installationId, allowed)})
    select c.contact_id, c.location_id, loc.name location_name, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name,
      to_char(c.birth_date, 'YYYY-MM-DD') birth_date, c.phone, c.email
    from cached_contacts c join loc on loc.location_id = c.location_id
    where c.installation_id = ${installationId} and c.birth_date is not null and not c.dnd limit 20000`;
  return rows
    .flatMap((r) => {
      const days = daysUntilBirthday(r.birth_date, today);
      return days !== null && days <= withinDays
        ? [{ contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: r.name, days, birthDate: r.birth_date, phone: r.phone, email: r.email }]
        : [];
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, 50);
}

// ---------------- team ----------------

export async function teamStats(installationId: string, allowed: string[] | null, staleDays: number): Promise<TeamRow[]> {
  const rows = await sql()`
    with loc as (${visible(installationId, allowed)}),
    opp as (
      select coalesce(nullif(o.assigned_to, ''), 'unassigned') user_id,
        count(*) filter (where o.status = 'open')::int open_count,
        coalesce(sum(o.monetary_value) filter (where o.status = 'open'), 0)::float8 open_value,
        count(*) filter (where o.status = 'open' and coalesce(o.last_stage_change_at, o.created_remote_at) < now() - make_interval(days => ${staleDays}::int))::int stale_count,
        count(*) filter (where o.status = 'won')::int won_count,
        coalesce(sum(o.monetary_value) filter (where o.status = 'won'), 0)::float8 won_value,
        count(*) filter (where o.status = 'lost')::int lost_count,
        avg(extract(epoch from (o.last_status_change_at - o.created_remote_at)) / 86400) filter (where o.status = 'won' and o.last_status_change_at > o.created_remote_at)::float8 avg_cycle
      from cached_opportunities o join loc on loc.location_id = o.location_id
      where o.installation_id = ${installationId} group by 1),
    con as (
      select coalesce(nullif(c.assigned_to, ''), 'unassigned') user_id, count(*)::int contacts
      from cached_contacts c join loc on loc.location_id = c.location_id
      where c.installation_id = ${installationId} group by 1)
    select coalesce(opp.user_id, con.user_id) user_id, t.name,
      coalesce(opp.open_count, 0) open_count, coalesce(opp.open_value, 0) open_value, coalesce(opp.stale_count, 0) stale_count,
      coalesce(opp.won_count, 0) won_count, coalesce(opp.won_value, 0) won_value, coalesce(opp.lost_count, 0) lost_count,
      coalesce(con.contacts, 0) contacts, opp.avg_cycle
    from opp full join con on con.user_id = opp.user_id
    left join team_names t on t.installation_id = ${installationId} and t.user_id = coalesce(opp.user_id, con.user_id)
    order by coalesce(opp.won_value, 0) desc, coalesce(opp.open_value, 0) desc limit 100`;
  return rows.map((r) => ({
    userId: r.user_id, name: r.name ?? null, openCount: r.open_count, openValue: r.open_value, staleCount: r.stale_count,
    wonCount: r.won_count, wonValue: r.won_value, lostCount: r.lost_count, contacts: r.contacts,
    avgCycleDays: r.avg_cycle === null ? null : Math.round(r.avg_cycle * 10) / 10,
  }));
}

// First-reply speed and appointment outcomes per person, last 30 days, for the accounts the caller may see.
export async function teamPace(installationId: string, allowed: string[] | null): Promise<Map<string, PaceRow>> {
  const db = sql();
  const [replies, appts] = await Promise.all([
    db`select t.touch_user_id user_id, count(*)::int n, percentile_cont(0.5) within group (order by extract(epoch from t.touch_at - t.lead_at))::float8 med, max(t.touch_at) last_at
        from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
        where t.installation_id = ${installationId} and t.touch_at is not null and t.touch_user_id is not null and t.lead_at > now() - interval '30 days'
          ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``} group by 1`,
    db`select a.assigned_to user_id, count(*) filter (where a.status = 'showed')::int held, count(*) filter (where a.status = 'noshow')::int no_show
        from cached_appointments a join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
        where a.installation_id = ${installationId} and a.assigned_to is not null and a.assigned_to <> '' and a.start_at > now() - interval '30 days'
          ${allowed ? db`and a.location_id = any(${allowed}::text[])` : db``} group by 1`,
  ]);
  const out = new Map<string, PaceRow>();
  const row = (id: string) => out.get(id) ?? (out.set(id, { replies: 0, medianSeconds: null, held: 0, noShow: 0 }), out.get(id) as PaceRow);
  for (const r of replies) { const x = row(r.user_id as string); x.replies = r.n as number; x.medianSeconds = r.med === null ? null : Math.round(r.med as number); x.lastReplyAt = r.last_at instanceof Date ? r.last_at.getTime() : null; }
  for (const r of appts) { const x = row(r.user_id as string); x.held = r.held as number; x.noShow = r.no_show as number; }
  return out;
}

export async function setTeamName(installationId: string, userId: string, name: string | null): Promise<void> {
  if (name === null) {
    await sql()`delete from team_names where installation_id = ${installationId} and user_id = ${userId}`;
    return;
  }
  await sql()`
    insert into team_names (installation_id, user_id, name) values (${installationId}, ${userId}, ${name})
    on conflict (installation_id, user_id) do update set name = excluded.name`;
}

// ---------------- deal movement ----------------

export type DealMove = {
  at: string; kind: "created" | "stage" | "status"; dealName: string | null; contactName: string | null; value: number;
  locationId: string; locationName: string | null; fromLabel: string | null; toLabel: string | null; url?: string;
};

async function stageNames(installationId: string): Promise<Map<string, string>> {
  const rows = await sql()`select stages from pipelines where installation_id = ${installationId}`;
  const names = new Map<string, string>();
  for (const r of rows) for (const s of (r.stages as Array<{ id: string; name: string }> | null) ?? []) names.set(s.id, s.name);
  return names;
}

export async function recentDealMoves(installationId: string, allowed: string[] | null, limit = 60): Promise<DealMove[]> {
  const [names, rows] = await Promise.all([
    stageNames(installationId),
    sql()`
      with loc as (${visible(installationId, allowed)})
      select e.at, e.kind, e.from_value, e.to_value, e.value::float8 value, e.location_id, loc.name location_name, o.name deal_name, o.contact_name
      from deal_events e join loc on loc.location_id = e.location_id
      left join cached_opportunities o on o.installation_id = e.installation_id and o.location_id = e.location_id and o.opportunity_id = e.opportunity_id
      where e.installation_id = ${installationId} order by e.at desc limit ${limit}`,
  ]);
  const label = (kind: string, v: string | null) => (v === null ? null : kind === "status" ? v : names.get(v) ?? "another stage");
  return rows.map((r) => ({
    at: iso(r.at) as string, kind: r.kind, dealName: r.deal_name, contactName: r.contact_name, value: r.value ?? 0,
    locationId: r.location_id, locationName: r.location_name, fromLabel: label(r.kind, r.from_value), toLabel: label(r.kind, r.to_value),
  }));
}

// ---------------- one contact's timeline ----------------

export type TimelineItem = { at: string; kind: string; title: string; detail?: string };

export async function contactTimeline(installationId: string, allowed: string[] | null, locationId: string, contactId: string) {
  if (allowed && !allowed.includes(locationId)) return null;
  const db = sql();
  const [[c], deals, [convo], moves, names] = await Promise.all([
    db`select c.contact_id, c.location_id, l.name location_name, coalesce(nullif(c.full_name, ''), 'Unnamed contact') name, c.email, c.phone, c.tags,
        c.source, c.dnd, c.date_added, c.last_activity_at
       from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id
       where c.installation_id = ${installationId} and c.location_id = ${locationId} and c.contact_id = ${contactId}`,
    db`select opportunity_id, name, status, monetary_value::float8 value, stage_id, created_remote_at, last_stage_change_at, last_status_change_at
       from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId}
       order by created_remote_at desc nulls last limit 30`,
    db`select last_message_type, last_message_direction, last_message_at, unread_count from cached_conversations
       where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by last_message_at desc nulls last limit 1`,
    db`select e.at, e.kind, e.from_value, e.to_value, o.name deal_name from deal_events e
       left join cached_opportunities o on o.installation_id = e.installation_id and o.location_id = e.location_id and o.opportunity_id = e.opportunity_id
       where e.installation_id = ${installationId} and e.location_id = ${locationId}
         and e.opportunity_id in (select opportunity_id from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId})
       order by e.at desc limit 30`,
    stageNames(installationId),
  ]);
  if (!c) return null;
  const items: TimelineItem[] = [];
  if (c.date_added) items.push({ at: iso(c.date_added) as string, kind: "contact", title: "Added as a contact", detail: c.source ? `Source: ${c.source}` : undefined });
  for (const d of deals) {
    if (d.created_remote_at) items.push({ at: iso(d.created_remote_at) as string, kind: "deal", title: `Deal created: ${d.name ?? "Untitled"}`, detail: `$${Math.round(d.value ?? 0).toLocaleString("en-US")}` });
    if (d.status !== "open" && d.last_status_change_at) items.push({ at: iso(d.last_status_change_at) as string, kind: d.status, title: `Deal ${d.status}: ${d.name ?? "Untitled"}`, detail: `$${Math.round(d.value ?? 0).toLocaleString("en-US")}` });
  }
  for (const m of moves) {
    const to = m.kind === "status" ? m.to_value : m.to_value ? names.get(m.to_value) ?? "another stage" : null;
    items.push({ at: iso(m.at) as string, kind: "move", title: m.kind === "created" ? `New deal: ${m.deal_name ?? "Untitled"}` : `${m.deal_name ?? "A deal"} moved to ${to ?? "?"}` });
  }
  if (convo?.last_message_at) {
    items.push({ at: iso(convo.last_message_at) as string, kind: "message", title: `Last message was ${convo.last_message_direction === "inbound" ? "from them" : "from your team"}`, detail: convo.last_message_type ?? undefined });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return {
    contact: {
      contactId: c.contact_id as string, locationId: c.location_id as string, locationName: c.location_name as string | null, name: c.name as string,
      email: c.email as string | null, phone: c.phone as string | null, tags: (c.tags as string[]) ?? [], source: c.source as string | null, dnd: c.dnd === true,
      lastActivityAt: iso(c.last_activity_at),
    },
    deals: deals.map((d) => ({ id: d.opportunity_id as string, name: d.name as string | null, status: d.status as string, value: d.value as number, stage: d.stage_id ? names.get(d.stage_id as string) ?? null : null })),
    unread: convo?.unread_count ?? 0,
    timeline: items.slice(0, 40),
  };
}
