// F2 read-only look at the real data (selects only, no writes). It answers the CHECK items of the Speed to lead stage with counts and
// field names, never with a customer's name, email or phone:
//   1. which contact source values exist and how much of the recent leads has none (N47);
//   2. whether call-type conversations exist and what the stored fields say about them (missed calls, N5);
//   3. whether the same person is counted in more than one client account or installation (N18, N30);
//   4. how many people who replied have a name, and how many have not (N21).
//   node --env-file=.env.local --import tsx scripts/check-f2-live.ts
import { closeDb, sql } from "../src/lib/db";

async function main() {
  const db = sql();
  const real = await db`select id from installations where is_demo is not true and uninstalled_at is null`;
  console.log(`Real installations: ${real.length}`);

  const leads = await db`
    select count(*)::int n, count(*) filter (where c.source is null or btrim(c.source) = '')::int no_source
    from lead_touches t join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
    join installations i on i.id = t.installation_id where i.is_demo is not true and t.excluded is null`;
  console.log("Leads counted, and how many have no source:", leads[0]);

  const sources = await db`
    select lower(btrim(c.source)) source, count(*)::int n
    from lead_touches t join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
    join installations i on i.id = t.installation_id where i.is_demo is not true and t.excluded is null and nullif(btrim(c.source), '') is not null
    group by 1 order by 2 desc limit 15`;
  console.log("Source values on counted leads (value, count):", sources.map((s) => `${s.source}: ${s.n}`).join(" | ") || "(none)");

  const allContacts = await db`
    select count(*)::int n, count(*) filter (where nullif(btrim(source), '') is null)::int no_source
    from cached_contacts c join installations i on i.id = c.installation_id where i.is_demo is not true`;
  console.log("All contacts, and how many have no source:", allContacts[0]);

  const calls = await db`
    select v.last_message_type t, v.last_message_direction d, count(*)::int n
    from cached_conversations v join installations i on i.id = v.installation_id
    where i.is_demo is not true and v.last_message_type ilike '%call%' group by 1, 2 order by 3 desc`;
  console.log("Conversations whose last message is a call (type, direction, count):", calls.map((c) => `${c.t}/${c.d}: ${c.n}`).join(" | ") || "(none)");
  const cols = await db`select column_name from information_schema.columns where table_name = 'cached_conversations' order by ordinal_position`;
  console.log("Stored conversation columns:", cols.map((c) => c.column_name).join(", "), "(no call result is stored, so missed calls cannot be counted from stored data)");

  const touchCols = await db`select column_name from information_schema.columns where table_name = 'lead_touches' order by ordinal_position`;
  console.log("lead_touches columns:", touchCols.map((c) => c.column_name).join(", "));

  // The same email or phone in more than one client account of one installation, among counted leads.
  const crossAccount = await db`
    with l as (
      select t.installation_id, t.location_id, t.contact_id, lower(nullif(c.email, '')) email, nullif(c.phone_digits, '') phone, lower(nullif(btrim(c.full_name), '')) nm
      from lead_touches t join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
      join installations i on i.id = t.installation_id where i.is_demo is not true and t.excluded is null
    )
    select 'email' k, count(*)::int people, coalesce(sum(n), 0)::int rows from (select email, count(distinct location_id) n from l where email is not null group by installation_id, email having count(distinct location_id) > 1) x
    union all
    select 'phone', count(*)::int, coalesce(sum(n), 0)::int from (select phone, count(distinct location_id) n from l where phone is not null and length(phone) >= 7 group by installation_id, phone having count(distinct location_id) > 1) x
    union all
    select 'name', count(*)::int, coalesce(sum(n), 0)::int from (select nm, count(distinct location_id) n from l where nm is not null group by installation_id, nm having count(distinct location_id) > 1) x`;
  console.log("Same email, phone or name counted in more than one client account (people, rows):", crossAccount.map((r) => `${r.k}: ${r.people} people, ${r.rows} rows`).join(" | "));

  // The same client account held by two installations (each installation is its own tenant).
  const twice = await db`
    select count(*)::int accounts from (select l.location_id from locations l join installations i on i.id = l.installation_id
      where i.is_demo is not true and i.uninstalled_at is null and not l.ignored group by l.location_id having count(distinct l.installation_id) > 1) x`;
  console.log("Client accounts held by more than one live installation:", twice[0].accounts);

  const names = await db`
    select count(distinct t.touch_user_id)::int repliers,
      count(distinct t.touch_user_id) filter (where n.user_id is null)::int without_name
    from lead_touches t join installations i on i.id = t.installation_id left join team_names n on n.installation_id = t.installation_id and n.user_id = t.touch_user_id
    where i.is_demo is not true and t.touch_user_id is not null`;
  console.log("People who sent a first reply, and how many have no name yet:", names[0]);
  const access = await db`select users_access, count(*)::int n from locations l join installations i on i.id = l.installation_id where i.is_demo is not true and not l.ignored group by 1`;
  console.log("Team-names read state per account:", access.map((a) => `${a.users_access ?? "never read"}: ${a.n}`).join(" | "));
  await closeDb();
}
void main();
