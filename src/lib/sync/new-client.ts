// A new client account appears for an install (NC item 2): tell the owner, seed its onboarding steps, and say when its first read is done.
// Every step is keyed by the account, so the same account seen twice (a repeated webhook, two syncs racing) makes one notice, one audit row, one seed.
// Everything is scoped by installation id: an account of one company can never produce a notice, a seed or a count in another.
import { sql } from "../db";
import { listTemplates } from "../analytics/client-success-queries";
import { templateFor } from "../analytics/client-success";

/** Days from the day an account is seen until its template steps are due. */
export const SEED_DUE_DAYS = 7;

export const newClientKey = (locationId: string) => `new-client:${locationId}`;
export const firstSyncKey = (locationId: string) => `first-sync:${locationId}`;

/** Which of the installed accounts are new. After the company's first read every account would look new, so nothing is announced until a read has finished before. */
export function newAccountIds(installedIds: readonly string[], knownIds: readonly string[], hadEarlierSync: boolean): string[] {
  if (!hadEarlierSync && knownIds.length === 0) return [];
  const known = new Set(knownIds);
  return [...new Set(installedIds)].filter((id) => !known.has(id));
}

export const newClientTitle = (name: string | null) => `New client account: ${name?.trim() || "a new account"}`;
export const firstSyncDoneTitle = (contacts: number, deals: number) => `First sync done: ${contacts.toLocaleString("en-US")} contacts, ${deals.toLocaleString("en-US")} deals`;

type Account = { locationId: string; name: string | null };

/** Record the notice, the audit row and the onboarding seed for each new account. Returns how many were new (a repeat returns 0). */
export async function announceNewClients(installationId: string, accounts: Account[]): Promise<number> {
  let announced = 0;
  for (const a of accounts) {
    const db = sql();
    // Location id null: a company-wide item, so only the company sees it (a client's own staff never do). The link opens that account.
    const rows = await db`
      insert into notifications (installation_id, location_id, type, severity, title, body, link, dedupe_key)
      values (${installationId}, null, 'new_client', 'info', ${newClientTitle(a.name)}, 'First sync is running.', ${db.json({ view: "clients", locationId: a.locationId } as never)}, ${newClientKey(a.locationId)})
      on conflict (installation_id, dedupe_key) where dedupe_key is not null do nothing
      returning id`;
    if (rows.length === 0) continue;
    announced++;
    await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, null, 'client_account_added', ${db.json({ locationId: a.locationId } as never)})`;
    await seedOnboarding(installationId, a.locationId).catch((e) => console.error("Seeding onboarding failed", e instanceof Error ? e.message : "error"));
  }
  return announced;
}

/** Give the account's template steps a due date. The automatic checks need nothing stored: they are worked out from the account each time. */
export async function seedOnboarding(installationId: string, locationId: string): Promise<number> {
  const db = sql();
  const tpl = templateFor(await listTemplates(installationId), null);
  if (!tpl) return 0;
  let n = 0;
  for (const s of tpl.steps) {
    const key = `tpl:${s.key}`;
    const rows = await db`
      insert into client_steps (installation_id, location_id, step_key, due_on)
      values (${installationId}, ${locationId}, ${key}, current_date + ${SEED_DUE_DAYS}::int)
      on conflict (installation_id, location_id, step_key) do nothing
      returning due_on::text due_on`;
    if (rows.length === 0) continue;
    n++;
    await db`insert into client_step_history (installation_id, location_id, step_key, step_label, event, detail, actor) values (${installationId}, ${locationId}, ${key}, ${s.label}, 'due', ${rows[0].due_on as string}, null)`;
  }
  return n;
}

/** Say "First sync done" for every announced account whose contacts and deals have both been read. Safe to call after any job: it does nothing twice. */
export async function finishFirstSyncNotices(installationId: string): Promise<number> {
  const db = sql();
  const ready = await db`
    select l.location_id, l.name,
      (select count(*)::int from cached_contacts c where c.installation_id = l.installation_id and c.location_id = l.location_id) contacts,
      (select count(*)::int from cached_opportunities o where o.installation_id = l.installation_id and o.location_id = l.location_id) deals
    from locations l
    join notifications n on n.installation_id = l.installation_id and n.dedupe_key = 'new-client:' || l.location_id
    where l.installation_id = ${installationId} and l.contacts_synced_at is not null and l.opportunities_synced_at is not null
      and not exists (select 1 from notifications d where d.installation_id = l.installation_id and d.dedupe_key = 'first-sync:' || l.location_id)`;
  let n = 0;
  for (const r of ready) {
    const added = await db`
      insert into notifications (installation_id, location_id, type, severity, title, body, link, dedupe_key)
      values (${installationId}, null, 'new_client', 'info', ${firstSyncDoneTitle(r.contacts as number, r.deals as number)}, ${(r.name as string | null) ?? null},
        ${db.json({ view: "clients", locationId: r.location_id as string } as never)}, ${firstSyncKey(r.location_id as string)})
      on conflict (installation_id, dedupe_key) where dedupe_key is not null do nothing
      returning id`;
    if (added.length > 0) n++;
  }
  return n;
}
