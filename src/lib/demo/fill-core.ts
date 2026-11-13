import { sql } from "../db";

// Demo fill, part 1: keeps the fictional demo company (company id "demo-agency") fresh and fully permitted, and gives it people, calendars and message history.
// Everything here writes ONLY rows of the demo installation (every statement is scoped by its installation id), never a real tenant and never a CRM. Every step is
// additive and idempotent: a second run changes nothing. See docs/DEMO_SCREENSHOTS.md.

export const DAY = 86_400_000;
export const TEAM = ["user-4a1c", "user-9b2e", "user-c3d7", "user-e5f0"];
export const TEAM_NAMES: Record<string, { name: string; email: string; role: "setter" | "closer" | "both" | "manager" | null }> = {
  "user-4a1c": { name: "Dana Brooks", email: "dana@brightpath-demo.example.com", role: "setter" },
  "user-9b2e": { name: "Marcus Lee", email: "marcus@brightpath-demo.example.com", role: "closer" },
  "user-c3d7": { name: "Priya Shah", email: "priya@brightpath-demo.example.com", role: "both" },
};

/** Runs one named step; a failing step is logged and never stops the others (the demo should still open). */
export async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  try { await fn(); if (process.env.DEMO_FILL_LOG === "1") console.log("[demo fill]", name, Date.now() - t0, "ms"); } catch (e) { console.error(`[demo fill] ${name} failed:`, e instanceof Error ? e.message : String(e)); }
}

type Col = { table: string; col: string; type: string; pk: boolean };

/**
 * The demo is "made now" when it is first seeded, so a week later its leads, appointments and payments would all be a week old. Once the stored rows are more than
 * SHIFT_AFTER_MS old, every date and time of the demo installation moves forward by the same amount (so "2 hours ago" is 2 hours ago again). Reports true when it moved.
 * One transaction with an advisory lock, so two processes never shift twice.
 */
const APPEND_ONLY = new Set(["moat_events", "appointment_history", "deal_history"]);
const SHIFT_AFTER_MS = 6 * 3_600_000;
export async function shiftIfStale(inst: string): Promise<boolean> {
  const db = sql();
  const [r] = await db`select max(last_synced_at) a from locations where installation_id = ${inst}`;
  const a = r?.a ? new Date(r.a as Date).getTime() : null;
  if (a === null || Date.now() - a < SHIFT_AFTER_MS) return false;
  // Every table of the demo installation, its date and time columns, and whether a column is part of a primary key or unique constraint (those tables are re-written, not updated in place).
  const cols = (await db`
    select c.table_name "table", c.column_name col, c.data_type "type",
      exists (select 1 from pg_index i join pg_attribute at on at.attrelid = i.indrelid and at.attnum = any(i.indkey)
              where i.indisunique and i.indrelid = format('public.%I', c.table_name)::regclass and at.attname = c.column_name) pk
    from information_schema.columns c
    where c.table_schema = 'public' and c.data_type in ('timestamp with time zone', 'date')
      and c.table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'installation_id')
      and c.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
      and c.table_name not in ('installations', 'sync_jobs')
      and c.is_generated = 'NEVER'`) as unknown as Col[];
  const byTable = new Map<string, Col[]>();
  for (const c of cols) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
  let moved = false;
  await db.begin(async (tx) => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(hashtext('subsync-demo-shift')) ok`;
    if (!lock?.ok) return;
    const [again] = await tx`select max(last_synced_at) a from locations where installation_id = ${inst}`;
    const b = again?.a ? new Date(again.a as Date).getTime() : null;
    if (b === null || Date.now() - b < SHIFT_AFTER_MS) return;
    const ms = Date.now() - b, days = Math.round(ms / DAY);
    const ivMs = `${Math.round(ms / 1000)} seconds`;
    // Three history tables refuse updates and deletes (append-only, for real tenants). This transaction only touches the demo installation's rows and switches those checks off for itself alone.
    let triggersOff = true;
    try { await tx.savepoint(async (sp) => { await sp`set local session_replication_role = replica`; }); } catch { triggersOff = false; }
    for (const [table, cs] of byTable) {
      if (!triggersOff && APPEND_ONLY.has(table)) continue;
      const shifted = (c: Col) => (c.type === "date" ? `"${c.col}" + ${days}` : `"${c.col}" + interval '${ivMs}'`);
      if (cs.some((c) => c.pk)) {
        // A date or time in a key: copy the rows aside, delete them and write them again, moved (a plain update could collide with a row it has not moved yet).
        const all = (await tx`select column_name n, data_type t from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER' and (is_identity = 'NO' or is_identity is null) order by ordinal_position`) as unknown as Array<{ n: string; t: string }>;
        const list = all.map((x) => `"${x.n}"`).join(", ");
        const sel = all.map((x) => { const c = cs.find((q) => q.col === x.n); return c ? shifted(c) : `"${x.n}"`; }).join(", ");
        await tx.unsafe(`create temp table demo_shift on commit drop as select * from public."${table}" where installation_id = $1`, [inst]);
        await tx.unsafe(`delete from public."${table}" where installation_id = $1`, [inst]);
        await tx.unsafe(`insert into public."${table}" (${list}) select ${sel} from demo_shift`);
        await tx.unsafe("drop table demo_shift");
      } else {
        const set = cs.map((c) => `"${c.col}" = ${shifted(c)}`).join(", ");
        await tx.unsafe(`update public."${table}" set ${set} where installation_id = $1`, [inst]);
      }
    }
    // Everything moved by the same amount; the marker now says "made just now".
    await tx`update locations set last_synced_at = now() where installation_id = ${inst}`;
    moved = true;
  });
  return moved;
}

/** Every account answers every question the demo asks: nothing says "needs permission" (a real install can, the demo screenshots should not). */
export async function openPermissions(inst: string): Promise<void> {
  await sql()`
    update locations set appointments_access = 'ok', users_access = 'ok', speed_access = 'ok', calendars_access = 'ok', calendar_groups_access = 'ok',
      speed_synced_at = coalesce(speed_synced_at, now()), appointments_synced_at = coalesce(appointments_synced_at, now())
    where installation_id = ${inst} and (appointments_access is distinct from 'ok' or users_access is distinct from 'ok' or speed_access is distinct from 'ok'
      or calendars_access is distinct from 'ok' or calendar_groups_access is distinct from 'ok')`;
}

/** The agency's own settings: Lagos time for dates and the daily brief, a 5 minute reply target, an email for the brief. */
export async function agencySettings(inst: string): Promise<void> {
  await sql()`
    update settings set digest_timezone = coalesce(digest_timezone, 'Africa/Lagos'), digest_hour = coalesce(digest_hour, 7), digest_enabled = true,
      speed_target_minutes = coalesce(speed_target_minutes, 5), digest_email = coalesce(digest_email, 'owner@brightpath-demo.example.com'), brand_name = coalesce(brand_name, 'Brightpath Growth')
    where installation_id = ${inst}`;
  // The one account named like a test is an old closed account, not a "Test" account (screenshots read better).
  await sql()`update locations set name = 'Closed Account (Archive)' where installation_id = ${inst} and name = 'Template Account (Test)'`;
}

/** People: the team list, who is a setter or a closer, which accounts they work in, and the calendars each account has. */
export async function peopleAndCalendars(inst: string): Promise<void> {
  const db = sql();
  const live = (await db`select location_id, calendar_count from locations where installation_id = ${inst} and not ignored order by location_id`) as unknown as Array<{ location_id: string; calendar_count: number | null }>;
  for (const [id, p] of Object.entries(TEAM_NAMES)) {
    await db`insert into team_names (installation_id, user_id, name) values (${inst}, ${id}, ${p.name}) on conflict do nothing`;
    await db`insert into team_members (installation_id, user_id, name, email, role, user_type, all_accounts, deleted, source, first_seen, last_seen)
      values (${inst}, ${id}, ${p.name}, ${p.email}, 'agency_staff', 'user', false, false, 'users', now() - interval '80 days', now()) on conflict do nothing`;
    if (p.role) await db`insert into team_member_roles (installation_id, user_id, location_id, role, set_by, set_by_name) values (${inst}, ${id}, '', ${p.role}, 'demo', 'Demo Admin') on conflict do nothing`.catch(() => undefined);
  }
  // Jordan (user-e5f0) left the team: named nowhere on purpose, so "Former team member" shows where he owned work.
  await db`insert into team_members (installation_id, user_id, name, source, deleted, first_seen, last_seen) values (${inst}, ${TEAM[3]}, null, 'activity', true, now() - interval '80 days', now() - interval '20 days') on conflict do nothing`;
  // Set-based (a loop of single inserts is slow against a remote database).
  const ids = live.map((l) => l.location_id);
  const three = TEAM.slice(0, 3).map((id) => ({ id, name: TEAM_NAMES[id].name }));
  await db`insert into location_users (installation_id, location_id, user_id, name, seen_at, role)
    select ${inst}, l, u.id, u.name, now(), 'account_user' from unnest(${ids}::text[]) l cross join jsonb_to_recordset(${db.json(three as never)}) as u(id text, name text) on conflict do nothing`;
  await db`insert into team_member_access (installation_id, user_id, location_id, source, seen_at) select ${inst}, u, l, 'location_list', now() from unnest(${ids}::text[]) l cross join unnest(${TEAM.slice(0, 3)}::text[]) u on conflict do nothing`.catch(() => undefined);
  const cals = live.flatMap((l) => Array.from({ length: Math.max(0, Math.min(3, l.calendar_count ?? 0)) }, (_, k) => ({ loc: l.location_id, id: `${l.location_id}-cal${k}`, k })));
  if (cals.length) {
    await db`insert into cached_calendars (installation_id, location_id, calendar_id, name, is_active, calendar_type, round_robin, synced_at)
      select ${inst}, x.loc, x.id, (array['Free consultation', 'Estimate visit', 'Follow-up call'])[x.k + 1], true, case when x.k = 1 then 'round_robin' else 'event' end, x.k = 1, now()
      from jsonb_to_recordset(${db.json(cals as never)}) as x(loc text, id text, k int) on conflict do nothing`;
    const members = cals.flatMap((c) => TEAM.slice(0, c.k === 0 ? 2 : 3).map((u) => ({ loc: c.loc, id: c.id, u })));
    await db`insert into calendar_members (installation_id, location_id, calendar_id, user_id, synced_at)
      select ${inst}, x.loc, x.id, x.u, now() from jsonb_to_recordset(${db.json(members as never)}) as x(loc text, id text, u text) on conflict do nothing`;
  }
}

/**
 * Message history behind the Speed to lead screens: the first reply of each lead (a person, by text, call, email or WhatsApp), the automatic text in the first minute, a few missed calls with a
 * text back, and a failed send. Built from the demo's own lead records (the same leads, the same times), so every screen agrees. Added once (the marker is a "demo:" key).
 */
export async function messageHistory(inst: string): Promise<void> {
  const db = sql();
  const [have] = await db`select count(*)::int n from touch_events where installation_id = ${inst} and event_key like 'demo:%'`;
  if (Number(have?.n) > 0) return;
  const chan = `(array['sms','call','sms','email','sms','whatsapp','call'])[1 + (id % 7)]`;
  // A person's first reply
  await db.unsafe(`
    insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
    select installation_id, location_id, contact_id, conversation_id, 'demo:h:' || id, 'outbound', ${chan}, case when ${chan} = 'call' then 'call' else 'message' end, touch_at, touch_user_id, false, 'app', 'delivered'
    from lead_touches where installation_id = $1 and touch_at is not null and touch_user_id is not null on conflict do nothing`, [inst]);
  // The automatic first text
  await db.unsafe(`
    insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
    select installation_id, location_id, contact_id, conversation_id, 'demo:a:' || id, 'outbound', 'sms', 'message', auto_touch_at, null, true, 'workflow', 'delivered'
    from lead_touches where installation_id = $1 and auto_touch_at is not null on conflict do nothing`, [inst]);
  // The customer's own message that started the conversation
  await db.unsafe(`
    insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
    select installation_id, location_id, contact_id, conversation_id, 'demo:i:' || id, 'inbound', case when id % 4 = 0 then 'call' else 'sms' end, case when id % 9 = 0 then 'missed_call' else 'message' end, lead_at, null, false, null, null
    from lead_touches where installation_id = $1 and id % 3 <> 1 on conflict do nothing`, [inst]);
  // Missed calls that got a text back, and a few failed sends
  await db.unsafe(`
    insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
    select installation_id, location_id, contact_id, conversation_id, 'demo:t:' || id, 'outbound', 'sms', 'message', lead_at + interval '40 seconds', null, true, 'workflow', 'delivered'
    from lead_touches where installation_id = $1 and id % 9 = 0 and id % 2 = 0 on conflict do nothing`, [inst]);
  await db.unsafe(`
    insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
    select installation_id, location_id, contact_id, conversation_id, 'demo:f:' || id, 'outbound', 'sms', 'failed', lead_at + interval '2 minutes', null, true, 'workflow', 'failed'
    from lead_touches where installation_id = $1 and id % 47 = 0 on conflict do nothing`, [inst]);
  // Lead life events: created, first touch
  await db.unsafe(`
    insert into lead_events (installation_id, location_id, contact_id, kind, event_key, to_value, user_id, at)
    select installation_id, location_id, contact_id, 'created', 'demo:c:' || id, null, null, lead_at from lead_touches where installation_id = $1 on conflict do nothing`, [inst]);
  await db.unsafe(`
    insert into lead_events (installation_id, location_id, contact_id, kind, event_key, to_value, user_id, at)
    select installation_id, location_id, contact_id, 'first_touch', 'demo:ft:' || id, null, touch_user_id, touch_at from lead_touches where installation_id = $1 and touch_at is not null on conflict do nothing`, [inst]);
}

/** Speed to lead for the account the old demo left without any lead records (it used to be a deliberate "needs permission" account). */
export async function speedForAllAccounts(inst: string): Promise<void> {
  const db = sql();
  const missing = (await db`
    select l.location_id from locations l where l.installation_id = ${inst} and not l.ignored
      and not exists (select 1 from lead_touches t where t.installation_id = l.installation_id and t.location_id = l.location_id)
    order by l.location_id`) as unknown as Array<{ location_id: string }>;
  const now = Date.now();
  for (const [i, l] of missing.entries()) {
    const base = [4, 18, 75][i % 3];
    const rows: Record<string, unknown>[] = [];
    for (let k = 0; k < 30; k++) {
      const leadAt = now - (25 + k * 660 + i * 37) * 60_000, never = k % (6 + (i % 3)) === 0, reply = (base + ((k * 5) % 23)) * 60_000;
      rows.push({
        installation_id: inst, location_id: l.location_id, contact_id: `${l.location_id}-c${1 + k}`, conversation_id: `${l.location_id}-sp${k}`,
        lead_at: new Date(leadAt), touch_at: never ? null : new Date(leadAt + reply), touch_user_id: never ? null : TEAM[(k + i) % 3], read_version: 1,
        human_touch_at: never ? null : new Date(leadAt + reply), auto_touch_at: k % 3 !== 0 ? new Date(leadAt + (5 + k) * 1000) : null,
      });
    }
    await db`insert into lead_touches ${db(rows as never)}`;
  }
}

/**
 * Removes every row of the demo company (and the company itself) so it can be made again from nothing. Some history tables have no link to the installation, so a plain delete of the
 * installation would leave their rows behind; this deletes by installation id in every table that has one. Only an installation that is flagged as the demo is ever touched.
 */
export async function wipeDemo(companyId: string): Promise<void> {
  const db = sql();
  const ids = (await db`select id from installations where company_id = ${companyId} and is_demo`).map((r) => r.id as string);
  if (!ids.length) return;
  const tables = await db`
    select c.table_name t from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'installation_id' and x.table_type = 'BASE TABLE' and c.table_name <> 'installations'`;
  for (const { t } of tables) await db.unsafe(`delete from public."${t as string}" where installation_id = any($1::uuid[])`, [ids]).catch((e) => console.error("[demo wipe]", t, e instanceof Error ? e.message : String(e)));
  await db`delete from installations where id = any(${ids}::uuid[]) and is_demo`;
}

/** The one account the older demo left without appointments (it used to be a deliberate "needs permission" account) gets the same kind of history as the others. */
export async function appointmentsForAllAccounts(inst: string): Promise<void> {
  const db = sql();
  const missing = (await db`
    select l.location_id, (select count(*)::int from cached_contacts c where c.installation_id = l.installation_id and c.location_id = l.location_id) contacts
    from locations l where l.installation_id = ${inst} and not l.ignored and not exists (select 1 from cached_appointments a where a.installation_id = l.installation_id and a.location_id = l.location_id)
    order by l.location_id`) as unknown as Array<{ location_id: string; contacts: number }>;
  const now = Date.now();
  for (const [i, l] of missing.entries()) {
    const total = Math.min(60, Math.max(4, Math.round(l.contacts / 14))), bias = ((i + 5) * 3) % 5;
    const rows: Record<string, unknown>[] = [];
    for (let k = 0; k < total; k++) {
      const startMs = now - (82 - Math.floor((k * 100) / total)) * DAY + (k % 8) * 3_600_000, past = startMs < now - 3 * 3_600_000;
      let status: string;
      if (past) { const m = (k * 7 + i + 5) % 20; status = m < 11 - bias ? "showed" : m < 16 - Math.floor(bias / 2) ? "noshow" : m < 18 ? "cancelled" : "confirmed"; }
      else status = k % 3 === 0 ? "new" : k % 7 === 0 ? "cancelled" : "confirmed";
      rows.push({
        installation_id: inst, location_id: l.location_id, appointment_id: `${l.location_id}-ap${k}`, calendar_id: `${l.location_id}-cal${k % 3}`, calendar_name: ["Free consultation", "Estimate visit", "Follow-up call"][k % 3],
        contact_id: `${l.location_id}-c${1 + ((k * 11) % Math.max(1, l.contacts))}`, title: "Appointment", status, start_at: new Date(startMs), end_at: new Date(startMs + 1_800_000), assigned_to: TEAM[k % 4],
        created_remote_at: new Date(startMs - 3 * DAY), booked_by_user: k % 5 === 0 ? null : TEAM[(k + 1) % 3], booking_channel: k % 5 === 0 ? null : k % 2 ? "calendar page" : "team member",
      });
    }
    await db`insert into cached_appointments ${db(rows as never)} on conflict do nothing`;
  }
}
