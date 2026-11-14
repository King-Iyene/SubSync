import { sql } from "../db";
import { safeError } from "../safe-log";
import type { Role } from "../identity";
import { pgInboxStore } from "./inbox-store";
import { crmWriter } from "./ingest-store";
import type { PersonalConnection } from "./ingest";
import { rematchWaiting } from "./rematch";

// The scheduled side of rematch.ts. Two callers: the sync job (every few minutes, `onlyIfSynced`: only calls that were last looked at BEFORE the account's contacts last synced, so
// a contact created or corrected in the CRM is picked up soon after it is synced) and the nightly clean-up (every waiting call, whatever happened). Counts only in the answer, never content.

const ROLES: readonly Role[] = ["agency_owner", "agency_admin", "agency_staff", "account_admin", "account_user"];
const roleOf = (v: unknown): Role => ROLES.find((r) => r === v) ?? "account_user";
const PER_PERSON = 50;

export type RematchRun = { people: number; checked: number; added: number; matchedWaiting: number };

export async function runRematch(o: { onlyIfSynced: boolean; maxPeople?: number }): Promise<RematchRun> {
  const db = sql();
  let people: Array<Record<string, unknown>>;
  try {
    people = await db`
      select distinct u.id, u.installation_id, u.company_key, u.ghl_user_id, u.person_name, u.home_location_id, u.person_role, u.provider_account_email
      from user_connections u
      join installations i on i.id = u.installation_id and i.uninstalled_at is null and not i.is_demo
      join meetings m on m.installation_id = u.installation_id and m.owner_ghl_user_id = u.ghl_user_id and m.status = 'needs_contact'
      where u.provider = 'fathom' and u.status = 'connected'
        ${o.onlyIfSynced ? db`and coalesce(m.rematched_at, m.created_at) < (select max(l.contacts_synced_at) from locations l where l.installation_id = u.installation_id)` : db``}
      limit ${o.maxPeople ?? 100}`;
  } catch (error) {
    // Until the update that adds `rematched_at` is applied there is nothing to look at again; that is not a failure of the job that called us.
    console.error("Rematch could not list calls", safeError(error));
    return { people: 0, checked: 0, added: 0, matchedWaiting: 0 };
  }
  const run: RematchRun = { people: 0, checked: 0, added: 0, matchedWaiting: 0 };
  const store = pgInboxStore();
  for (const r of people) {
    try {
      const home = (r.home_location_id as string | null) ?? null;
      const installationId = r.installation_id as string;
      const userId = r.ghl_user_id as string;
      const conn: PersonalConnection = {
        id: r.id as string, installationId, provider: "fathom", accountEmail: (r.provider_account_email as string | null) ?? null,
        person: { companyKey: r.company_key as string, userId, name: (r.person_name as string | null) ?? null, role: roleOf(r.person_role), kind: home ? "client" : "agency", homeLocationId: home },
      };
      const out = await rematchWaiting(store, conn, crmWriter(conn.person.companyKey), { limit: PER_PERSON });
      run.people++; run.checked += out.checked; run.added += out.added; run.matchedWaiting += out.matchedWaiting;
      // Looked at: not looked at again until the next contact sync (or the night). Only when every waiting call fit in this pass.
      if (out.checked < PER_PERSON) await db`update meetings set rematched_at = now() where installation_id = ${installationId} and owner_ghl_user_id = ${userId} and status = 'needs_contact'`.catch(() => undefined);
    } catch (error) {
      console.error("Rematch failed for one person", safeError(error));
    }
  }
  return run;
}

/** One person asking "check again now" from the Meeting inbox: only their own connection and their own calls. */
export async function rematchMine(installationId: string, conn: PersonalConnection): Promise<RematchRun> {
  const out = await rematchWaiting(pgInboxStore(), conn, crmWriter(conn.person.companyKey), { limit: PER_PERSON });
  await sql()`update meetings set rematched_at = now() where installation_id = ${installationId} and owner_ghl_user_id = ${conn.person.userId} and status = 'needs_contact'`.catch(() => undefined);
  return { people: 1, checked: out.checked, added: out.added, matchedWaiting: out.matchedWaiting };
}
