import { sql } from "../db";
import { DAY, TEAM } from "./fill-core";

// Demo fill, part 3: deals and appointments. Owners on (almost) every deal, each deal's journey through the stages (so the stage history, time in each stage and the money moving between stages
// have real data), reasons for lost deals, won deals tied to the appointment that started them (so sales show per person), and a few saved call lists. Demo installation only, all inserts
// keyed so a second run changes nothing.

const STAGE_NAMES = "array['New Lead','Contacted','Appointment Set','Proposal Sent','Negotiation']";
const LOST_REASONS = ["Price too high", "Went with a competitor", "No reply after the quote", "Bad timing", "Not a good fit"];

export async function fillDeals(inst: string): Promise<void> {
  const db = sql();

  // Owners: about nine deals in ten have one (the rest are the "no owner" warning's sample), spread over the team; Jordan left, so a few still carry his name.
  await db.unsafe(`
    update cached_opportunities set assigned_to = (array['${TEAM[0]}','${TEAM[1]}','${TEAM[2]}','${TEAM[0]}','${TEAM[1]}','${TEAM[2]}','${TEAM[3]}'])[1 + (abs(hashtext(opportunity_id)) % 7)]
    where installation_id = $1 and assigned_to is null and abs(hashtext(opportunity_id)) % 11 <> 0 and opportunity_id !~ 'dm'`, [inst]);

  // Won deals start from an appointment that showed (same contact, in the 25 days before the win), and the person who held it owns the deal.
  const [linked] = await db`select count(*)::int n from deal_facts where installation_id = ${inst} and booked_from_appointment is not null`;
  if (Number(linked?.n) === 0) {
    await db.unsafe(`
      with pick as (
        select distinct on (o.location_id, o.opportunity_id) o.location_id, o.opportunity_id, ap.appointment_id, ap.contact_id, ap.assigned_to
        from cached_opportunities o join cached_appointments ap on ap.installation_id = o.installation_id and ap.location_id = o.location_id and ap.status = 'showed'
          and ap.start_at between o.last_status_change_at - interval '25 days' and o.last_status_change_at - interval '1 day'
        where o.installation_id = $1 and o.status = 'won' and o.pipeline_id like 'pipe-%'
        order by o.location_id, o.opportunity_id, ap.start_at desc
      ), upd as (
        update cached_opportunities o set contact_id = p.contact_id, assigned_to = coalesce(p.assigned_to, o.assigned_to),
          contact_name = coalesce((select nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') from cached_contacts c where c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = p.contact_id), o.contact_name)
        from pick p where o.installation_id = $1 and o.location_id = p.location_id and o.opportunity_id = p.opportunity_id returning o.location_id, o.opportunity_id, p.appointment_id
      )
      insert into deal_facts (installation_id, location_id, opportunity_id, booked_from_appointment) select $1::uuid, location_id, opportunity_id, appointment_id from upd on conflict (installation_id, location_id, opportunity_id) do update set booked_from_appointment = excluded.booked_from_appointment`, [inst]);
  }
  // Why deals were lost.
  const [lost] = await db`select count(*)::int n from deal_facts where installation_id = ${inst} and lost_reason is not null`;
  if (Number(lost?.n) === 0) {
    await db.unsafe(`
      insert into deal_facts (installation_id, location_id, opportunity_id, lost_reason_id, lost_reason)
      select installation_id, location_id, opportunity_id, 'lr' || (abs(hashtext(opportunity_id)) % 5), (array[${LOST_REASONS.map((r) => `'${r}'`).join(",")}])[1 + (abs(hashtext(opportunity_id)) % 5)]
      from cached_opportunities where installation_id = $1 and status = 'lost'
      on conflict (installation_id, location_id, opportunity_id) do update set lost_reason_id = excluded.lost_reason_id, lost_reason = excluded.lost_reason`, [inst]);
  }

  // Each deal's journey: created, then one step per stage until the stage it is in now, then won or lost. Keys of the last step match the hourly sweep's keys, so it never writes them twice.
  const [hist] = await db`select count(*)::int n from deal_history where installation_id = ${inst} and event_key like 'demo|st|%'`;
  if (Number(hist?.n) === 0) {
    await db.unsafe(`
      with d as (
        select o.*, coalesce(array_position(array['s1','s2','s3','s4','s5'], o.stage_id), 1) k,
          coalesce(o.created_remote_at, o.last_stage_change_at - interval '30 days') c0,
          greatest(o.last_stage_change_at, coalesce(o.created_remote_at, o.last_stage_change_at - interval '30 days') + interval '2 days') e
        from cached_opportunities o where o.installation_id = $1 and o.pipeline_id like 'pipe-%' and o.last_stage_change_at is not null
      ), ev as (
        select location_id, opportunity_id, contact_id, pipeline_id, 'created' kind, 'created|' || opportunity_id ekey, null::text fv, 's1' tv, null::text fnm, 'New Lead' tnm, monetary_value val, c0 at, 0 ord, assigned_to who from d
        union all
        select d.location_id, d.opportunity_id, d.contact_id, d.pipeline_id, 'stage',
          case when j = d.k - 1 then 'stage|' || d.opportunity_id || '|' || d.stage_id || '|' || (extract(epoch from d.last_stage_change_at) * 1000)::bigint else 'demo|st|' || d.opportunity_id || '|' || j end,
          's' || j, 's' || (j + 1), (${STAGE_NAMES})[j], (${STAGE_NAMES})[j + 1], d.monetary_value,
          case when j = d.k - 1 then d.last_stage_change_at else d.c0 + (d.e - d.c0) * j / greatest(d.k - 1, 1) end, j, d.assigned_to
        from d cross join generate_series(1, 4) j where j <= d.k - 1
        union all
        select location_id, opportunity_id, contact_id, pipeline_id, 'status', 'status|' || opportunity_id || '|' || lower(status) || '|' || (extract(epoch from last_status_change_at) * 1000)::bigint,
          'open', lower(status), null, null, monetary_value, last_status_change_at, 9, assigned_to
        from d where status in ('won', 'lost') and last_status_change_at is not null
      )
      insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, from_value, to_value, from_name, to_name, value, dwell_seconds, actor_id, actor_kind, at)
      select $1::uuid, location_id, opportunity_id, contact_id, pipeline_id, kind, ekey, fv, tv, fnm, tnm, val,
        greatest(0, extract(epoch from (at - lag(at) over (partition by location_id, opportunity_id order by at, ord)))::int), who, case when kind = 'created' then 'system' else 'person' end, at
      from ev on conflict (installation_id, location_id, event_key) do nothing`, [inst]);
  }

  // Saved call lists a team would keep (Call mode, "Your lists").
  const [cl] = await db`select count(*)::int n from call_lists where installation_id = ${inst}`;
  if (Number(cl?.n) === 0) {
    for (const [name, filters] of [
      ["Warm leads to call today", { tags: ["follow-up"], minAgeDays: 0, maxAgeDays: 14 }], ["Quotes sent, no answer", { tags: ["lead"], maxAgeDays: 30 }], ["VIP customers to thank", { tags: ["vip"] }],
    ] as const) await db`insert into call_lists (installation_id, name, filters) values (${inst}, ${name}, ${db.json(filters as never)})`;
  }
  void DAY;
}
