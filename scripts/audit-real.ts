// Read-only look at the real (non-demo) installation: what is synced, how fresh, and what the
// Duplicates view would flag. Prints counts only, never contact details.
//   node --env-file=.env.local --import tsx scripts/audit-real.ts
import { closeDb, sql } from "../src/lib/db";

async function main() {
  const db = sql();
  const installs = await db`select id, company_id, mode, plan, installed_at, uninstalled_at from installations where not is_demo`;
  console.log("installations:", installs.map((i) => ({ mode: i.mode, plan: i.plan, uninstalled: Boolean(i.uninstalled_at) })));
  for (const i of installs) {
    const id = i.id as string;
    const [locs, contacts, opps, convs, jobs] = await Promise.all([
      db`select location_id, name, contacts_synced_at, opportunities_synced_at, conversations_synced_at, structure_synced_at, sync_error, calendar_count, pipeline_count from locations where installation_id = ${id}`,
      db`select location_id, count(*)::int n, count(*) filter (where email is not null and email <> '')::int with_email, count(*) filter (where phone is not null and phone <> '')::int with_phone, count(*) filter (where dnd)::int dnd, count(*) filter (where source is not null)::int with_source, count(*) filter (where assigned_to is not null)::int assigned, count(*) filter (where birth_date is not null)::int birthdays from cached_contacts where installation_id = ${id} group by 1`,
      db`select location_id, count(*)::int n, count(*) filter (where status = 'open')::int open, count(*) filter (where status = 'won')::int won, count(*) filter (where status = 'lost')::int lost, count(*) filter (where assigned_to is not null)::int assigned from cached_opportunities where installation_id = ${id} group by 1`,
      db`select location_id, count(*)::int n from cached_conversations where installation_id = ${id} group by 1`,
      db`select type, status, count(*)::int n, max(finished_at) last_done from sync_jobs where installation_id = ${id} group by 1, 2 order by 1, 2`,
    ]);
    console.log("accounts:", locs.length);
    for (const l of locs) {
      const c = contacts.find((x) => x.location_id === l.location_id);
      const o = opps.find((x) => x.location_id === l.location_id);
      console.log(" -", l.name, {
        contacts: c?.n ?? 0, withEmail: c?.with_email, withPhone: c?.with_phone, dnd: c?.dnd, withSource: c?.with_source, assigned: c?.assigned, birthdays: c?.birthdays,
        opps: o?.n ?? 0, open: o?.open, won: o?.won, lost: o?.lost, oppAssigned: o?.assigned, conversations: convs.find((x) => x.location_id === l.location_id)?.n ?? 0,
        calendars: l.calendar_count, pipelines: l.pipeline_count, contactsSynced: l.contacts_synced_at, syncError: l.sync_error,
      });
    }
    console.log("sync jobs:", jobs.map((j) => `${j.type}/${j.status}=${j.n}`).join(", "));

    // What the Duplicates view flags, classified.
    const exactEmail = await db`select location_id, count(*)::int groups, sum(n)::int contacts from (select location_id, lower(email) k, count(*) n from cached_contacts where installation_id = ${id} and email is not null and email <> '' group by 1, 2 having count(*) > 1) x group by 1`;
    const exactPhone = await db`select location_id, count(*)::int groups, sum(n)::int contacts from (select location_id, phone_digits k, count(*) n from cached_contacts where installation_id = ${id} and length(phone_digits) >= 7 group by 1, 2 having count(*) > 1) x group by 1`;
    const nearPhone = await db`select location_id, count(*)::int groups from (select location_id, right(phone_digits, 10) k, count(distinct phone_digits) variants, count(*) n from cached_contacts where installation_id = ${id} and length(phone_digits) >= 10 group by 1, 2 having count(*) > 1 and count(distinct phone_digits) > 1) x group by 1`;
    const crossAccount = await db`select count(*)::int n from (select lower(email) k from cached_contacts where installation_id = ${id} and email is not null and email <> '' group by 1 having count(distinct location_id) > 1) x`;
    console.log("exact same email in one account:", exactEmail.map((r) => ({ account: locs.find((l) => l.location_id === r.location_id)?.name, groups: r.groups, contacts: r.contacts })));
    console.log("exact same phone in one account:", exactPhone.map((r) => ({ account: locs.find((l) => l.location_id === r.location_id)?.name, groups: r.groups, contacts: r.contacts })));
    console.log("near phone matches (different format, same last 10 digits):", nearPhone.map((r) => ({ account: locs.find((l) => l.location_id === r.location_id)?.name, groups: r.groups })));
    console.log("same email across different accounts:", crossAccount[0].n);
  }
  await closeDb();
}
void main();
