// Scale seeder: a synthetic agency (3 client accounts) plus a second, smaller agency, in a THROWAWAY local/CI Postgres.
// Usage: node --env-file=scripts/scale.env --env-file=.env.local --import tsx scripts/seed-scale.mts --size 120|5000|100000
// "size" = leads in the first agency, split 50/30/20 over its 3 accounts. The second agency gets size/10 (min 60, max 3000) in 1 account.
// Everything is built with generate_series and hash-based spreads (deterministic: same size, same data), so a brute-force SQL on the raw
// rows is an independent check of every screen. Refuses any database that is not on localhost. Never touches Supabase.
import postgres from "postgres";
import { assertThrowawayDb, SCALE } from "./scale-guard.ts";
import { encryptSecret } from "../src/lib/crypto.ts";

const url = assertThrowawayDb();
const size = Number(process.argv[process.argv.indexOf("--size") + 1] || 5000);
if (!Number.isFinite(size) || size < 30) throw new Error("--size must be a number of at least 30");
const db = postgres(url, { max: 4, ssl: false, onnotice: () => {} });

const shares = [0.5, 0.3, 0.2];

async function wipe() {
  const ids = (await db`select id from installations where company_id in (${SCALE.companyA}, ${SCALE.companyB})`).map((r) => r.id as string);
  if (!ids.length) return;
  const tables = await db`select table_name t from information_schema.columns where table_schema = 'public' and column_name = 'installation_id' and table_name <> 'installations'`;
  for (const { t } of tables) await db.unsafe(`delete from "${t}" where installation_id = any($1::uuid[])`, [ids]).catch(() => undefined);
  await db`delete from installations where id = any(${ids}::uuid[])`;
}

async function install(company: string, name: string): Promise<string> {
  const [r] = await db`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at, scope, user_type, is_bulk_installation)
    values (${company}, ${name}, 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour', 'contacts.write contacts.readonly conversations.readonly calendars.readonly opportunities.readonly users.readonly', 'Company', true) returning id`;
  return r.id as string;
}

/** One account: n leads and everything hanging off them. h(i, k) is a stable pseudo-random 0..9999 from the lead number and a salt. */
async function seedLocation(inst: string, loc: string, name: string, n: number) {
  await db`insert into locations (installation_id, location_id, name, timezone, speed_access, speed_synced_at, appointments_access, appointments_synced_at, contacts_synced_at, opportunities_synced_at, conversations_synced_at, structure_synced_at, last_synced_at, users_access, calendars_access)
    values (${inst}, ${loc}, ${name}, 'America/New_York', 'ok', now(), 'ok', now(), now(), now(), now(), now(), now(), 'ok', 'ok')`;
  for (let u = 0; u < 4; u++) {
    await db`insert into location_users (installation_id, location_id, user_id, name, seen_at, role) values (${inst}, ${loc}, ${"user-" + u}, ${"Setter " + u}, now(), 'account_user') on conflict do nothing`;
    await db`insert into team_names (installation_id, user_id, name) values (${inst}, ${"user-" + u}, ${"Setter " + u}) on conflict do nothing`;
  }
  await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages, synced_at) values
    (${inst}, ${loc}, 'p1', 'Sales', ${db.json([{ id: "s1", name: "New" }, { id: "s2", name: "Contacted" }, { id: "s3", name: "Booked" }, { id: "s4", name: "Proposal" }, { id: "s5", name: "Closing" }] as never)}, now()),
    (${inst}, ${loc}, 'p2', 'Renewals', ${db.json([{ id: "r1", name: "Due" }, { id: "r2", name: "Quoted" }, { id: "r3", name: "Signed" }] as never)}, now())`;
  await db`insert into client_billing (installation_id, location_id, state, plan_name, subscription_status, fetched_at, wallet_balance, wallet_state, wallet_at) values (${inst}, ${loc}, 'ok', 'Pro', 'active', now(), 42.5, 'ok', now()) on conflict do nothing`.catch(() => undefined);

  // Contacts. i = 1..n.  Notes on the spread: ~5% no phone, 3% invalid phone, 2% duplicate phone, 3% duplicate email, 4% DND, 10% no owner, 2% test contacts, 8% no email.
  await db.unsafe(`
    insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, date_added, last_activity_at, synced_at, source, dnd, assigned_to, first_seen_at)
    select $1::uuid, $2, $2 || '-c' || i,
      case when t then 'Test' else 'Lead' end, case when t then 'Lead' else i::text end,
      case when i % 25 = 3 then null when i % 33 = 0 then 'lead' || (i - 1) || '@' || $2 || '.scale.test' else 'lead' || i || '@' || $2 || '.scale.test' end,
      case when i % 20 = 1 then null when i % 33 = 5 then '12ab' when i % 50 = 2 then '+1555' || lpad(((i - 1) % 10000000)::text, 7, '0') else '+1555' || lpad((i % 10000000)::text, 7, '0') end,
      array_remove(array[
        case when t then 'test-lead' end,
        case when a1 < 600 then 'call-now' end, case when a1 between 9900 and 9999 then 'Call-Now' end,
        case when a2 < 800 then 'hot' end, case when a2 between 9900 and 9999 then 'HOT' end, case when a2 between 9800 and 9899 then 'Hot' end,
        case when a3 < 1000 then 'cold' end,
        case when a4 < 700 then 'booked' end,
        case when a5 < 500 then 'no-show' end,
        case when a6 < 3000 then 'lead-new' end,
        case when dnd then 'dnd' end,
        case when a7 < 300 then 'A very long tag name that goes on and on to test truncation in lists and chips and filters ' || (a7 % 7) end,
        case when a7 between 300 and 599 then 'Ünïcode ✓ tag, with comma & "quotes"' end
      ], null),
      date_trunc('second', now()) - make_interval(mins => (a8 % 86400)), now() - make_interval(mins => (a8 % 86400) / 2), now(),
      (array['Facebook Lead Form', 'Google Ads', 'Website form', 'Referral', 'Instagram'])[1 + a9 % 5],
      dnd, case when a10 % 10 = 0 then null else 'user-' || (a10 % 4) end, date_trunc('second', now()) - make_interval(mins => (a8 % 86400))
    from (select i, (abs(hashtext(i::text || '-t' || $2)) % 100) < 2 t, (abs(hashtext(i::text || '-d' || $2)) % 100) < 4 dnd,
        abs(hashtext(i::text || '-1' || $2)) % 10000 a1, abs(hashtext(i::text || '-2' || $2)) % 10000 a2, abs(hashtext(i::text || '-3' || $2)) % 10000 a3,
        abs(hashtext(i::text || '-4' || $2)) % 10000 a4, abs(hashtext(i::text || '-5' || $2)) % 10000 a5, abs(hashtext(i::text || '-6' || $2)) % 10000 a6,
        abs(hashtext(i::text || '-7' || $2)) % 10000 a7, abs(hashtext(i::text || '-8' || $2)) % 86400 a8, abs(hashtext(i::text || '-9' || $2)) % 10000 a9,
        abs(hashtext(i::text || '-10' || $2)) % 10000 a10 from generate_series(1, $3::int) i) s`, [inst, loc, n]);
  // Conversations: 85% of leads have one; 35% of those wait on us (customer wrote last), aged across the 1h / 4h / 24h / 48h+ buckets.
  await db.unsafe(`
    insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count, synced_at, assigned_to)
    select $1::uuid, $2, $2 || '-sp' || i, $2 || '-c' || i, 'Lead ' || i, 'TYPE_SMS', case when w then 'inbound' else 'outbound' end,
      now() - case when w then (array[interval '30 minutes', interval '2 hours', interval '10 hours', interval '36 hours', interval '5 days'])[1 + b % 5] else make_interval(mins => 60 + b) end,
      case when w then 1 else 0 end, now(), case when o % 10 = 0 then null else 'user-' || (o % 4) end
    from (select i, (abs(hashtext(i::text || '-w' || $2)) % 100) < 35 w, abs(hashtext(i::text || '-b' || $2)) % 5000 b, abs(hashtext(i::text || '-10' || $2)) % 10000 o
      from generate_series(1, $3::int) i where abs(hashtext(i::text || '-cv' || $2)) % 100 < 85) s`, [inst, loc, n]);
  await db.unsafe("analyze cached_contacts");
  await db.unsafe("analyze cached_conversations"); // a fresh table has no statistics, and the planner then picks a nested loop that takes minutes at 100k
  // lead_touches: lead_at = date added; 65% touched by a human (delay exponential-ish, 1..~300 min), 10% only an automatic text, 25% never touched.
  await db.unsafe(`
    insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id, checked_at, read_version, human_touch_at, auto_touch_at, clock_start)
    select $1::uuid, $2, c.contact_id, $2 || '-sp' || substring(c.contact_id from '[0-9]+$'), c.date_added,
      case when k < 65 and c.date_added + make_interval(secs => 60 + floor(18000 * power((d % 100000) / 100000.0, 3))::int) < now() then c.date_added + make_interval(secs => 60 + floor(18000 * power((d % 100000) / 100000.0, 3))::int) end,
      case when k < 65 then 'user-' || (d % 4) end, now(), 1,
      case when k < 65 and c.date_added + make_interval(secs => 60 + floor(18000 * power((d % 100000) / 100000.0, 3))::int) < now() then c.date_added + make_interval(secs => 60 + floor(18000 * power((d % 100000) / 100000.0, 3))::int) end,
      case when k < 75 then c.date_added + make_interval(secs => 5 + (d % 40)) end, c.date_added
    from (select contact_id, date_added, abs(hashtext(contact_id || '-k')) % 100 k, abs(hashtext(contact_id || '-dl')) % 100000 d from cached_contacts where installation_id = $1::uuid and location_id = $2 and date_added > now() - interval '60 days') c
    where c.contact_id in (select v.contact_id from cached_conversations v where v.installation_id = $1::uuid and v.location_id = $2)`, [inst, loc]);
  await db.unsafe("analyze lead_touches");
  // touch_events: the first inbound message, the human reply, the automatic text, and missed calls for ~5% of leads.
  await db.unsafe(`
    insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
    select $1::uuid, $2, t.contact_id, t.conversation_id, e.k || ':' || t.contact_id, e.dir, e.ch, e.kind, e.at, e.u, e.auto, e.src, e.oc
    from lead_touches t cross join lateral (values
      ('in', 'inbound', 'sms', 'message', t.lead_at, null, false, null, null),
      ('hum', 'outbound', 'sms', 'message', t.touch_at, t.touch_user_id, false, 'app', 'delivered'),
      ('aut', 'outbound', 'sms', 'message', t.auto_touch_at, null, true, 'workflow', 'delivered'),
      ('mis', 'inbound', 'call', 'missed_call', case when abs(hashtext(t.contact_id || '-mc')) % 100 < 5 then t.lead_at + interval '1 minute' end, null, false, null, 'no-answer')
    ) as e(k, dir, ch, kind, at, u, auto, src, oc)
    where t.installation_id = $1::uuid and t.location_id = $2 and e.at is not null`, [inst, loc]);
  // Appointments: 40% of leads. Past ones: 35% showed, 20% no-show, 25% no outcome yet, 15% cancelled; 25% are in the future. Every 40th shares owner and start with the one before (double booking).
  await db.unsafe(`
    insert into cached_appointments (installation_id, location_id, appointment_id, calendar_id, calendar_name, contact_id, title, status, start_at, end_at, assigned_to, created_remote_at, synced_at, booking_channel)
    select $1::uuid, $2, $2 || '-a' || i, 'cal' || (i % 2), 'Calendar ' || (i % 2), $2 || '-c' || i, 'Consultation',
      case when fut then 'confirmed' when s < 35 then 'showed' when s < 55 then 'noshow' when s < 80 then 'confirmed' else 'cancelled' end,
      case when i % 40 = 0 then now() - make_interval(mins => 600 + ((i - 1) % 400) * 90) else
        case when fut then now() + make_interval(mins => 60 + (g % 14400)) else now() - make_interval(mins => 120 + (g % 40000)) end end,
      now() + interval '30 minutes', case when i % 40 = 0 or i % 40 = 39 then 'user-1' else 'user-' || (g % 4) end, now() - interval '70 days', now(), 'online'
    from (select i, abs(hashtext(i::text || '-ap' || $2)) % 100 s, (abs(hashtext(i::text || '-fu' || $2)) % 100) < 25 fut, abs(hashtext(i::text || '-g' || $2)) % 100000 g
      from generate_series(1, $3::int) i where abs(hashtext(i::text || '-has' || $2)) % 100 < 40) q`, [inst, loc, n]);
  await db.unsafe(`update cached_appointments set end_at = start_at + interval '30 minutes' where installation_id = $1::uuid and location_id = $2`, [inst, loc]);
  // Double bookings on purpose: every 20th appointment takes the same person and start time as the one before it.
  await db.unsafe(`
    with r as (select appointment_id, row_number() over (order by appointment_id) rn, start_at, assigned_to from cached_appointments where installation_id = $1::uuid and location_id = $2)
    update cached_appointments a set start_at = p.start_at, end_at = p.start_at + interval '30 minutes', assigned_to = p.assigned_to
    from r cur join r p on p.rn = cur.rn - 1 where a.installation_id = $1::uuid and a.location_id = $2 and a.appointment_id = cur.appointment_id and cur.rn % 20 = 0`, [inst, loc]);
  // Opportunities: 50% of leads (+ a second deal for every 10th). 20% are $0 junk, some have no owner; 70% open, 15% won, 15% lost; two pipelines.
  await db.unsafe(`
    insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, pipeline_name, stage_id, stage_name, contact_id, contact_name, name, monetary_value, status, last_stage_change_at, last_status_change_at, synced_at, last_action_at, created_remote_at, updated_remote_at, assigned_to, source)
    select $1::uuid, $2, $2 || '-o' || i || dup, case when p2 then 'p2' else 'p1' end, case when p2 then 'Renewals' else 'Sales' end,
      case when p2 then 'r' || (1 + st % 3) else 's' || (1 + st % 5) end,
      case when p2 then (array['Due', 'Quoted', 'Signed'])[1 + st % 3] else (array['New', 'Contacted', 'Booked', 'Proposal', 'Closing'])[1 + st % 5] end,
      $2 || '-c' || i, 'Lead ' || i, 'Deal ' || i || dup,
      case when z < 20 then 0 when z < 25 then null else 500 + (v % 20000) end,
      case when us < 70 then 'open' when us < 85 then 'won' else 'lost' end,
      now() - make_interval(mins => 30 + (g % 100000)), now() - make_interval(mins => 30 + (g % 100000)), now(), now() - make_interval(mins => 30 + (g % 100000)), now() - make_interval(mins => 30 + (g % 130000)), now(),
      case when ow % 8 = 0 then null else 'user-' || (ow % 4) end, 'Website form'
    from (select i, dup, abs(hashtext(i::text || dup || '-z' || $2)) % 100 z, abs(hashtext(i::text || dup || '-v' || $2)) % 100000 v, abs(hashtext(i::text || dup || '-us' || $2)) % 100 us,
        abs(hashtext(i::text || dup || '-st' || $2)) % 100 st, (abs(hashtext(i::text || dup || '-p2' || $2)) % 100) < 25 p2, abs(hashtext(i::text || dup || '-g' || $2)) % 100000 g, abs(hashtext(i::text || dup || '-ow' || $2)) % 1000 ow
      from generate_series(1, $3::int) i cross join (values (''), ('b')) d(dup)
      where abs(hashtext(i::text || '-op' || $2)) % 100 < 50 and (dup = '' or i % 10 = 0)) q`, [inst, loc, n]);
  // Stage-change events: every deal moved at least once; the open ones a few times.
  await db.unsafe(`
    insert into deal_events (installation_id, location_id, opportunity_id, kind, from_value, to_value, value, at)
    select installation_id, $2, opportunity_id, 'stage', 's1', stage_id, monetary_value, last_stage_change_at from cached_opportunities where installation_id = $1::uuid and location_id = $2
    union all select installation_id, $2, opportunity_id, 'status', 'open', status, monetary_value, last_status_change_at from cached_opportunities where installation_id = $1::uuid and location_id = $2 and status <> 'open'`, [inst, loc]);
  // Tag history for the going-cold and tag-change views: each lead's first tag was added when the lead arrived.
  await db.unsafe(`
    insert into contact_tag_events (installation_id, location_id, contact_id, tag, kind, at, exact)
    select installation_id, location_id, contact_id, lower(tags[1]), 'added', date_added, false from cached_contacts where installation_id = $1::uuid and location_id = $2 and cardinality(tags) > 0`, [inst, loc]);
  // Call outcomes for a slice of call-now leads.
  await db.unsafe(`
    insert into call_outcomes (installation_id, location_id, contact_id, outcome, created_at)
    select installation_id, location_id, contact_id, (array['no_answer', 'booked', 'voicemail'])[1 + abs(hashtext(contact_id)) % 3], now() - interval '2 days' from cached_contacts
    where installation_id = $1::uuid and location_id = $2 and 'call-now' = any(tags) and abs(hashtext(contact_id || '-co')) % 100 < 30`, [inst, loc]).catch((e) => console.log("call_outcomes skipped:", (e as Error).message.slice(0, 60)));
}

async function main() {
  const t0 = Date.now();
  await wipe();
  const a = await install(SCALE.companyA, "Scale Agency A");
  for (const [k, loc] of SCALE.locsA.entries()) await seedLocation(a, loc, `Scale Client A${k + 1}`, Math.max(10, Math.round(size * shares[k])));
  const b = await install(SCALE.companyB, "Scale Agency B");
  await seedLocation(b, SCALE.locB, "Scale Client B1", Math.min(3000, Math.max(60, Math.round(size / 10))));
  // The sync decides which leads count (test, spam, do-not-contact, duplicates); run the same rules the sync runs.
  const { applyLeadRules } = await import("../src/lib/sync/lead-rules-apply.ts");
  const { closeDb } = await import("../src/lib/db.ts");
  for (const loc of [...SCALE.locsA]) await applyLeadRules(a, loc);
  await applyLeadRules(b, SCALE.locB);
  await closeDb();
  await db`analyze`;
  const [c] = await db`select (select count(*) from cached_contacts where installation_id = ${a})::int contacts, (select count(*) from cached_conversations where installation_id = ${a})::int convs, (select count(*) from touch_events where installation_id = ${a})::int touches, (select count(*) from cached_appointments where installation_id = ${a})::int appts, (select count(*) from cached_opportunities where installation_id = ${a})::int opps`;
  console.log(`seeded size ${size} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(c));
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
