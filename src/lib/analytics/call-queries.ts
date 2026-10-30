import { sql } from "../db";
import { callPriority, powerHourStats, type Filters, type Outcome } from "./call-intel";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const DAY = 86_400_000;

function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name from locations where installation_id = ${installationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

export type QueueRow = {
  contactId: string; locationId: string; locationName: string | null; name: string; phone: string | null; email: string | null;
  priority: number; reasons: string[]; idleDays: number | null; openValue: number; lastOutcome: string | null; followUpAt: string | null;
};

export async function callQueue(installationId: string, allowed: string[] | null, f: Filters, limit = 100) {
  const db = sql();

  // The preset decides who is in the list and how the database orders it before we score them.
  let cond = db`true`;
  let order = db`c.date_added desc nulls last`;
  const and = (frag: ReturnType<typeof db>) => { cond = db`${cond} and ${frag}`; };
  switch (f.preset) {
    case "hot_uncontacted":
      and(db`coalesce(d.open_count, 0) > 0 and coalesce(c.last_activity_at, c.date_added) < now() - interval '3 days'`);
      order = db`d.open_value desc`;
      break;
    case "new_unanswered":
      and(db`c.date_added > now() - interval '4 hours'
        and not exists (select 1 from cached_conversations v where v.installation_id = c.installation_id and v.location_id = c.location_id
          and v.contact_id = c.contact_id and v.last_message_direction = 'outbound')`);
      break;
    case "proposal_stale":
      and(db`coalesce(d.proposal_stale, false)`);
      order = db`d.open_value desc`;
      break;
    case "customers_followup":
      and(db`d.won_count > 0 and coalesce(c.last_activity_at, c.date_added) < now() - interval '60 days'`);
      order = db`d.won_value desc`;
      break;
    case "lead_recency":
      and(db`c.date_added > now() - interval '24 hours' and d.contact_id is null`);
      break;
    case "win_back":
      and(db`d.won_count > 0 and coalesce(d.open_count, 0) = 0 and d.last_won_at < now() - interval '180 days'`);
      order = db`d.won_value desc`;
      break;
    case "noshow_recovery":
      and(db`exists (select 1 from cached_appointments x where x.installation_id = c.installation_id and x.location_id = c.location_id and x.contact_id = c.contact_id
          and x.status = 'noshow' and x.start_at > now() - interval '14 days' and x.start_at <= now()
          and not exists (select 1 from cached_appointments y where y.installation_id = x.installation_id and y.location_id = x.location_id and y.contact_id = x.contact_id
            and y.status not in ('cancelled', 'invalid', 'noshow') and y.start_at > x.start_at))`);
      order = db`c.last_activity_at desc nulls last`;
      break;
    case "recent_customers":
      and(db`d.won_count > 0 and d.last_won_at > now() - interval '90 days'`);
      order = db`d.last_won_at desc`;
      break;
    case "follow_ups_due":
      and(db`lo.outcome = 'follow_up' and lo.follow_up_at is not null and lo.follow_up_at <= now()`);
      order = db`lo.follow_up_at asc`;
      break;
    case "custom":
      if (f.tag) and(db`c.tags @> ${[f.tag]}::text[]`);
      if (f.idleDays !== undefined) and(db`coalesce(c.last_activity_at, c.date_added) < now() - make_interval(days => ${f.idleDays}::int)`);
      if (f.deal === "open") and(db`coalesce(d.open_count, 0) > 0`);
      if (f.deal === "none") and(db`d.contact_id is null`);
      order = db`coalesce(c.last_activity_at, c.date_added) asc nulls first`;
      break;
  }
  if (f.location) and(db`c.location_id = ${f.location}`);
  const followUps = f.preset === "follow_ups_due";

  const rows = await db`
    with loc as (${visible(installationId, allowed)}),
    deals as (
      select o.location_id, o.contact_id,
        count(*) filter (where o.status = 'open')::int open_count,
        coalesce(sum(o.monetary_value) filter (where o.status = 'open'), 0)::float8 open_value,
        count(*) filter (where o.status = 'won')::int won_count,
        coalesce(sum(o.monetary_value) filter (where o.status = 'won'), 0)::float8 won_value,
        max(o.last_status_change_at) filter (where o.status = 'won') last_won_at,
        coalesce(bool_or(o.status = 'open' and coalesce(st.nm, '') ~* '(proposal|quote|negotiat|contract)'
          and coalesce(greatest(o.last_action_at, o.updated_remote_at, o.last_stage_change_at), o.created_remote_at, o.synced_at) < now() - interval '7 days'), false) proposal_stale
      from cached_opportunities o
      left join pipelines pl on pl.installation_id = o.installation_id and pl.location_id = o.location_id and pl.pipeline_id = o.pipeline_id
      left join lateral (select s->>'name' nm from jsonb_array_elements(coalesce(pl.stages, '[]'::jsonb)) s where s->>'id' = o.stage_id limit 1) st on true
      where o.installation_id = ${installationId} and o.contact_id is not null group by o.location_id, o.contact_id),
    lo as (
      select distinct on (location_id, contact_id) location_id, contact_id, outcome, created_at, follow_up_at
      from call_outcomes where installation_id = ${installationId} order by location_id, contact_id, created_at desc)
    select c.contact_id, c.location_id, loc.name location_name, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name,
      c.phone, c.email, c.date_added, c.last_activity_at,
      coalesce(d.open_count, 0) open_count, coalesce(d.open_value, 0) open_value, coalesce(d.won_value, 0) won_value,
      lo.outcome last_outcome, lo.follow_up_at
    from cached_contacts c join loc on loc.location_id = c.location_id
    left join deals d on d.location_id = c.location_id and d.contact_id = c.contact_id
    left join lo on lo.location_id = c.location_id and lo.contact_id = c.contact_id
    where c.installation_id = ${installationId} and ${cond} and not c.dnd
      and coalesce(lo.outcome, '') not in ('wrong_number', 'not_interested')
      and (lo.created_at is null or lo.created_at < now() - interval '12 hours' or ${followUps}::boolean)
    order by ${order}
    limit 400`;

  const now = Date.now();
  const scored: QueueRow[] = rows.map((r) => {
    const last = r.last_activity_at instanceof Date ? r.last_activity_at.getTime() : null;
    const added = r.date_added instanceof Date ? r.date_added.getTime() : null;
    const idle = last === null ? (added === null ? null : Math.floor((now - added) / DAY)) : Math.floor((now - last) / DAY);
    const p = callPriority({
      openValue: r.open_value, openCount: r.open_count, wonValue: r.won_value, idleDays: idle,
      dateAddedDays: added === null ? null : Math.floor((now - added) / DAY), hasEmail: !!r.email, hasPhone: !!r.phone,
    });
    return {
      contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: r.name, phone: r.phone, email: r.email,
      priority: p.score, reasons: p.reasons, idleDays: idle, openValue: r.open_value, lastOutcome: r.last_outcome, followUpAt: iso(r.follow_up_at),
    };
  });
  scored.sort((a, b) => (followUps ? 0 : b.priority - a.priority));
  return { total: rows.length, rows: scored.slice(0, limit) };
}

// Speed to lead (8.8): how many fresh leads are waiting right now.
export async function speedToLead(installationId: string, allowed: string[] | null) {
  const [r] = await sql()`
    with loc as (${visible(installationId, allowed)})
    select count(*) filter (where c.date_added > now() - interval '15 minutes')::int last15,
      count(*) filter (where c.date_added > now() - interval '60 minutes')::int last60
    from cached_contacts c join loc on loc.location_id = c.location_id
    where c.installation_id = ${installationId} and c.date_added > now() - interval '60 minutes'
      and not exists (select 1 from cached_conversations v where v.installation_id = c.installation_id and v.location_id = c.location_id
        and v.contact_id = c.contact_id and v.last_message_direction = 'outbound')`;
  return { last15: r?.last15 ?? 0, last60: r?.last60 ?? 0 };
}

// ---------------- saved lists (8.2) ----------------

export const MAX_LISTS = 20;

export async function listCallLists(installationId: string) {
  const rows = await sql()`select id, name, filters, created_at from call_lists where installation_id = ${installationId} order by created_at`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, filters: r.filters as Record<string, unknown>, createdAt: iso(r.created_at) }));
}

export async function createCallList(installationId: string, name: string, filters: Filters): Promise<{ id: string } | "too_many"> {
  const db = sql();
  const [{ n }] = await db`select count(*)::int n from call_lists where installation_id = ${installationId}`;
  if (n >= MAX_LISTS) return "too_many";
  const [row] = await db`insert into call_lists (installation_id, name, filters) values (${installationId}, ${name}, ${db.json(filters as never)}) returning id`;
  return { id: row.id as string };
}

export async function deleteCallList(installationId: string, id: string): Promise<boolean> {
  const rows = await sql()`delete from call_lists where installation_id = ${installationId} and id = ${id} returning id`;
  return rows.length > 0;
}

// ---------------- outcomes (8.4) ----------------

export async function logOutcome(
  installationId: string, allowed: string[] | null,
  v: { locationId: string; contactId: string; outcome: Outcome; note: string | null; followUpInDays: number | null },
): Promise<boolean> {
  const db = sql();
  const known = await db`
    select 1 from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where c.installation_id = ${installationId} and c.location_id = ${v.locationId} and c.contact_id = ${v.contactId}
      ${allowed ? db`and c.location_id = any(${allowed}::text[])` : db``}`;
  if (known.length === 0) return false;
  const followUp = v.followUpInDays === null ? null : new Date(Date.now() + v.followUpInDays * DAY);
  await db`
    insert into call_outcomes (installation_id, location_id, contact_id, outcome, note, follow_up_at)
    values (${installationId}, ${v.locationId}, ${v.contactId}, ${v.outcome}, ${v.note}, ${followUp})`;
  return true;
}

export async function outcomeSummary(installationId: string, since?: Date) {
  const db = sql();
  const [today, week, session] = await Promise.all([
    db`select outcome from call_outcomes where installation_id = ${installationId} and created_at > now() - interval '24 hours'`,
    db`select outcome from call_outcomes where installation_id = ${installationId} and created_at > now() - interval '7 days'`,
    since ? db`select outcome from call_outcomes where installation_id = ${installationId} and created_at >= ${since}` : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);
  const map = (rows: Array<Record<string, unknown>>) => rows.map((r) => ({ outcome: String(r.outcome) }));
  return { today: powerHourStats(map(today)), week: powerHourStats(map(week)), session: since ? powerHourStats(map(session)) : null };
}
