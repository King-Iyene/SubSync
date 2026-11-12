import { sql } from "../db";
import { covers, type StatusScope } from "./person";
import { COUNT_WINDOW_DAYS, LOG_WINDOW_HOURS, OUTCOME_WINDOW_DAYS, type CallGroup, type OutcomeDay, type PersonInfo } from "./meeting-logging";

// The database side of "calls held, not logged" and the outcome history. Every query names the installation. The call counts select NO column that holds content
// (no title, summary, attendee or transcript reference): only the person's id, the status, the reason, an age flag and a count. A person's own row is found by their
// user id; an administrator's rows are the people whose home account their status scope covers (src/lib/connections/person.ts `covers`).

const DAY = 86_400_000;

/** Grouped call rows of the last 30 days. `owner` limits to one person (a person's own numbers); otherwise every person in the installation, filtered later by scope. */
export async function callGroups(installationId: string, owner: string | null, now = Date.now()): Promise<CallGroup[]> {
  const db = sql();
  const since = new Date(now - COUNT_WINDOW_DAYS * DAY);
  const oldBefore = new Date(now - LOG_WINDOW_HOURS * 3_600_000);
  const rows = await db`
    select m.owner_ghl_user_id owner, m.status, m.reason, (coalesce(m.started_at, m.created_at) < ${oldBefore}) old, count(*)::int n
    from meetings m
    where m.installation_id = ${installationId} and m.created_at >= ${since} and m.status in ('saved', 'needs_contact', 'failed')
      ${owner ? db`and m.owner_ghl_user_id = ${owner}` : db``}
    group by 1, 2, 3, 4`;
  return rows.map((r) => ({ owner: r.owner as string, status: r.status as string, reason: (r.reason as string | null) ?? null, old: r.old === true, n: r.n as number }));
}

/** Names and home accounts of the people who have a connection (the latest row per person). A person with no connection row is a team member who left. */
export async function peopleOf(installationId: string, owners: string[]): Promise<PersonInfo[]> {
  if (owners.length === 0) return [];
  const rows = await sql()`
    select distinct on (ghl_user_id) ghl_user_id, person_name, home_location_id, status
    from user_connections where installation_id = ${installationId} and ghl_user_id = any(${owners}::text[])
    order by ghl_user_id, (status = 'connected') desc, updated_at desc`;
  return rows.map((r) => ({ owner: r.ghl_user_id as string, name: (r.person_name as string | null) ?? null, homeLocationId: (r.home_location_id as string | null) ?? null, connected: r.status === "connected" }));
}

/** Keeps only the people an administrator's scope covers. A person whose connection is gone (no home account known) is covered only by an "all" scope. */
export function inScope(scope: StatusScope, people: PersonInfo[], owners: string[]): Set<string> {
  const info = new Map(people.map((p) => [p.owner, p]));
  return new Set(owners.filter((o) => covers(scope, info.get(o)?.homeLocationId ?? null)));
}

export async function outcomeDays(installationId: string, locationIds: string[] | null): Promise<OutcomeDay[]> {
  if (locationIds !== null && locationIds.length === 0) return [];
  const db = sql();
  const rows = await db`
    select to_char(day, 'YYYY-MM-DD') day, sum(meetings_held)::int held, sum(logged_24h)::int logged, sum(next_step_set)::int next_step, sum(moved_or_booked_7d)::int moved
    from mn_outcomes where installation_id = ${installationId} ${locationIds ? db`and location_id = any(${locationIds}::text[])` : db``}
    group by day order by day`;
  return rows.map((r) => ({ day: r.day as string, meetingsHeld: r.held as number, logged24h: r.logged as number, nextStepSet: r.next_step as number, movedOrBooked7d: r.moved as number }));
}

/**
 * Records one calendar day (UTC) per client account, from calls that were saved into a contact. A call counts once per contact it was written to. "Logged within 24 hours"
 * means the first note was written no later than 24 hours after the call started; "next step set" means the call had action items that went into the note; "moved or booked"
 * means the same contact got a new booking or a deal stage change within the 7 days after the call. Idempotent: running the same day again rewrites the same rows.
 * Our own notes are never counted as activity elsewhere (crm_writes is the echo guard), and nothing here reads the text of a call. Returns the number of account rows written.
 */
export async function recordOutcomeDay(installationId: string, day: string): Promise<number> {
  const db = sql();
  const rows = await db`
    with held as (
      select m.id, coalesce(m.started_at, m.created_at) started, n.location_id, n.contact_id, min(n.created_at) first_note,
             (jsonb_array_length(m.action_items) > 0) has_items
      from meetings m
      join crm_writes n on n.meeting_id = m.id and n.kind = 'note' and n.undone_at is null
      where m.installation_id = ${installationId} and m.status = 'saved'
        and coalesce(m.started_at, m.created_at) >= ${day}::date and coalesce(m.started_at, m.created_at) < (${day}::date + 1)
      group by m.id, started, n.location_id, n.contact_id, m.action_items
    )
    insert into mn_outcomes (installation_id, location_id, day, meetings_held, logged_24h, next_step_set, moved_or_booked_7d)
    select ${installationId}, h.location_id, ${day}::date, count(*)::int,
      (count(*) filter (where h.first_note <= h.started + ${db.unsafe(`interval '${LOG_WINDOW_HOURS} hours'`)}))::int,
      (count(*) filter (where h.has_items))::int,
      (count(*) filter (where
        exists (select 1 from cached_appointments a where a.installation_id = ${installationId} and a.location_id = h.location_id and a.contact_id = h.contact_id
                  and a.created_remote_at > h.started and a.created_remote_at <= h.started + ${db.unsafe(`interval '${OUTCOME_WINDOW_DAYS} days'`)})
        or exists (select 1 from cached_opportunities o where o.installation_id = ${installationId} and o.location_id = h.location_id and o.contact_id = h.contact_id
                  and o.last_stage_change_at > h.started and o.last_stage_change_at <= h.started + ${db.unsafe(`interval '${OUTCOME_WINDOW_DAYS} days'`)})))::int
    from held h group by h.location_id
    on conflict (installation_id, location_id, day) do update set
      meetings_held = excluded.meetings_held, logged_24h = excluded.logged_24h, next_step_set = excluded.next_step_set, moved_or_booked_7d = excluded.moved_or_booked_7d
    returning 1`;
  return rows.length;
}

/** The daily job: record the day whose seven following days are complete, for every installation that has calls on that day. */
export async function recordOutcomesForAll(day: string): Promise<{ day: string; installations: number; rows: number }> {
  const db = sql();
  const insts = await db`
    select distinct m.installation_id from meetings m
    where m.status = 'saved' and coalesce(m.started_at, m.created_at) >= ${day}::date and coalesce(m.started_at, m.created_at) < (${day}::date + 1)`;
  let rows = 0;
  for (const i of insts) rows += await recordOutcomeDay(i.installation_id as string, day);
  return { day, installations: insts.length, rows };
}
