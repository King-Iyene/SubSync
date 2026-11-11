import { sql } from "../db";
import { getCompanyAccessToken } from "../ghl/installations";
import { isBusinessKey } from "../access";
import { safeError } from "../safe-log";
import { fetchCompanyUsers, isPermissionError, type UserRow } from "../sync/ghl-data";
import { roleOf } from "./people3-intel";

// Who the people are: team_members (one row per CRM user id per installation) and team_member_access (which accounts each can reach). Keyed by id, never matched by name.
// Written from three places: the account sync (the account's users list, with roles), the company-wide users list in the hourly sweep (reaches agency staff who are in no account),
// and activity (a user id seen in touch_events that no list knows becomes a "new person" row). Deleted people keep their history. Metadata only.

let warned = false;

/** Called by the account sync with the account's users list. Never throws (a missing table must not break the sync). */
export async function saveLocationUsers(inst: string, locationId: string, users: readonly UserRow[]): Promise<void> {
  try {
    const db = sql();
    for (const u of users) {
      const role = roleOf(u.roleType, u.role);
      const allAccounts = role === "agency_admin";
      await db`
        insert into team_members (installation_id, user_id, name, email, role, user_type, photo_url, all_accounts, deleted, source, first_seen, last_seen)
        values (${inst}, ${u.id}, ${u.name}, ${u.email}, ${role}, ${u.roleType}, ${u.photoUrl}, ${allAccounts}, ${u.deleted}, 'users', now(), now())
        on conflict (installation_id, user_id) do update set name = coalesce(excluded.name, team_members.name), email = coalesce(excluded.email, team_members.email),
          role = case when excluded.role = 'unknown' then team_members.role else excluded.role end, user_type = coalesce(excluded.user_type, team_members.user_type),
          photo_url = coalesce(excluded.photo_url, team_members.photo_url), all_accounts = team_members.all_accounts or excluded.all_accounts, deleted = excluded.deleted, source = 'users', last_seen = now()`;
      await db`
        insert into team_member_access (installation_id, user_id, location_id, source, seen_at) values (${inst}, ${u.id}, ${locationId}, 'location_list', now())
        on conflict (installation_id, user_id, location_id) do update set source = 'location_list', seen_at = now()`;
    }
    // Someone no longer on this account's list loses that account (their history stays).
    await db`delete from team_member_access where installation_id = ${inst} and location_id = ${locationId} and source = 'location_list' and not (user_id = any(${users.map((u) => u.id)}::text[]))`;
  } catch (error) {
    if (!warned) { warned = true; console.error("Saving team members failed (logged once)", safeError(error)); }
  }
}

export type IdentityReport = { fromCompany: number; fromActivity: number; marked: number; companyState: "ok" | "needs_permission" | "skipped" | "error" };

/** The hourly sweep. Returns what it did. Safe to run twice. */
export async function refreshTeamIdentity(inst: string): Promise<IdentityReport> {
  const db = sql();
  const rep: IdentityReport = { fromCompany: 0, fromActivity: 0, marked: 0, companyState: "skipped" };
  // 1. The company-wide list: reaches people who are in no account, and says who really left. Business installs have no company list.
  try {
    const [inst0] = await db`select company_id from installations where id = ${inst}`;
    const key = inst0?.company_id as string | undefined;
    if (key && !isBusinessKey(key)) {
      try {
        const token = await getCompanyAccessToken(key);
        const users = await fetchCompanyUsers(token, key);
        for (const u of users) {
          const role = roleOf(u.roleType, u.role);
          await db`
            insert into team_members (installation_id, user_id, name, email, role, user_type, photo_url, all_accounts, deleted, source, first_seen, last_seen)
            values (${inst}, ${u.id}, ${u.name}, ${u.email}, ${role}, ${u.roleType}, ${u.photoUrl}, ${role === "agency_admin"}, ${u.deleted}, 'users', now(), now())
            on conflict (installation_id, user_id) do update set name = coalesce(excluded.name, team_members.name), email = coalesce(excluded.email, team_members.email),
              role = case when excluded.role = 'unknown' then team_members.role else excluded.role end, user_type = coalesce(excluded.user_type, team_members.user_type),
              photo_url = coalesce(excluded.photo_url, team_members.photo_url), all_accounts = team_members.all_accounts or excluded.all_accounts, deleted = excluded.deleted, source = 'users', last_seen = now()`;
          if (u.locationIds.length) {
            await db`
              insert into team_member_access (installation_id, user_id, location_id, source, seen_at)
              select ${inst}::uuid, ${u.id}, l.location_id, 'roles', now() from locations l where l.installation_id = ${inst} and l.location_id = any(${u.locationIds}::text[])
              on conflict (installation_id, user_id, location_id) do update set seen_at = now()`;
          }
          rep.fromCompany++;
        }
        // A person we knew from the users list who is on no list any more has left (history kept, shown greyed). The account sync refreshes last_seen for everyone it still lists, so only people unseen for 2 days are marked: a company list that holds only some kinds of user can never mark the rest as gone.
        if (users.length > 0) {
          const gone = await db`update team_members set deleted = true where installation_id = ${inst} and source = 'users' and not deleted and last_seen < now() - interval '2 days' and not (user_id = any(${users.map((u) => u.id)}::text[])) returning 1`;
          rep.marked = gone.length;
        }
        rep.companyState = "ok";
      } catch (error) {
        rep.companyState = isPermissionError(error) ? "needs_permission" : "error";
        if (rep.companyState === "error") console.error("Reading the company users list failed", safeError(error));
      }
    }
  } catch (error) {
    rep.companyState = "error";
    console.error("Team identity sweep failed", safeError(error));
  }
  // 2. Activity: a person seen sending messages who no list knows is a new person (name from the names we keep, else unnamed). First run looks back 120 days, later runs 3.
  try {
    const have = await db`select 1 from team_members where installation_id = ${inst} limit 1`;
    const days = have.length ? 3 : 120;
    const added = await db`
      insert into team_members (installation_id, user_id, name, source, first_seen, last_seen)
      select ${inst}::uuid, a.user_id, tn.name, 'activity', a.first_at, a.last_at
      from (select t.user_id, min(t.at) first_at, max(t.at) last_at from touch_events t where t.installation_id = ${inst} and t.user_id is not null and not t.automated and t.at > now() - ${`${days} days`}::interval group by 1) a
      left join team_names tn on tn.installation_id = ${inst} and tn.user_id = a.user_id
      on conflict (installation_id, user_id) do update set last_seen = greatest(team_members.last_seen, excluded.last_seen)
      returning 1`;
    rep.fromActivity = added.length;
    await db`
      insert into team_member_access (installation_id, user_id, location_id, source, seen_at)
      select ${inst}::uuid, t.user_id, t.location_id, 'activity', now() from touch_events t
      where t.installation_id = ${inst} and t.user_id is not null and not t.automated and t.at > now() - ${`${days} days`}::interval group by t.user_id, t.location_id
      on conflict (installation_id, user_id, location_id) do nothing`;
  } catch (error) {
    console.error("Team activity sweep failed", safeError(error));
  }
  return rep;
}
