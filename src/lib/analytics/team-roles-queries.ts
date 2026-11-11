import { sql } from "../db";
import { isRoleId, suggestRole, type Change, type RoleFilter, type RoleId, type RoleSuggestion } from "../people/roles";
import { decodeCursor, encodeCursor } from "./people3-intel";
import { cleanId, like, visibleMember, type Scope } from "./people3-queries";

// Reads and writes behind /api/app/people3/roles/<part>. SubSync's own record of each team member's role label (Setter, Closer, ...): nothing here touches the CRM.
// Every query filters by installation_id; who may be read comes from the verified session (`scope`), never from the request. A person id is used only after ownedPeople() has found
// that person among the people this caller may see. A missing table (migration not applied yet) reads as "no roles yet" and a write says it is not ready.

const isMissing = (e: unknown) => /relation .* does not exist|42P01|column .* does not exist|42703/i.test(String((e as Error)?.message ?? e));
const DAY = 86_400_000;

export type RolePerson = {
  userId: string; name: string; crmRole: string; role: RoleId | null; everywhere: RoleId | null; overrides: number; suggestion: RoleSuggestion | null; setBy: string | null; setAt: string | null;
};
export type RoleCounts = Record<RoleId | "none", number> & { total: number };

const emptyCounts = (): RoleCounts => ({ setter: 0, closer: 0, both: 0, support: 0, manager: 0, other: 0, none: 0, total: 0 });

/** The people this caller may see, with the role that applies in the chosen account (its own row, else the everywhere row). */
function peopleFrag(s: Scope, ids: string[], one: string | null) {
  const db = sql();
  return db`
    from team_members m
    left join team_names tn on tn.installation_id = m.installation_id and tn.user_id = m.user_id
    left join team_member_roles re on re.installation_id = m.installation_id and re.user_id = m.user_id and re.location_id = ''
    left join team_member_roles rl on rl.installation_id = m.installation_id and rl.user_id = m.user_id and rl.location_id = ${one ?? ""} and ${one ? db`true` : db`false`}
    where m.installation_id = ${s.inst} and not m.deleted and m.user_id not like '~%' and ${visibleMember(s, ids)}`;
}

export async function roleCounts(s: Scope, ids: string[], one: string | null): Promise<RoleCounts> {
  const out = emptyCounts();
  try {
    const db = sql();
    const rows = await db`select coalesce(rl.role, re.role) r, count(*)::int c ${peopleFrag(s, ids, one)} group by 1`;
    for (const r of rows) { const k = (r.r as string | null) ?? "none"; if (k === "none" || isRoleId(k)) { out[k] = Number(r.c); out.total += Number(r.c); } }
  } catch (e) { if (!isMissing(e)) throw e; }
  return out;
}

type ListOpts = { q: string | null; filter: RoleFilter; after: string | null; size: number };
/** One page of people with their role, searchable and filterable. Keyset paging by name then id, so 50 or 5,000 people read the same way. */
export async function listPeopleRoles(s: Scope, ids: string[], one: string | null, o: ListOpts, now = Date.now()): Promise<{ rows: RolePerson[]; total: number; next: string | null; ready: boolean }> {
  const db = sql();
  const cur = decodeCursor(o.after);
  const eff = db`coalesce(rl.role, re.role)`;
  const f = o.filter;
  const filt = f === "all" ? db`true` : f === "none" ? db`${eff} is null` : f === "setters" ? db`${eff} in ('setter', 'both')` : f === "closers" ? db`${eff} in ('closer', 'both')` : db`${eff} = ${f}`;
  const nm = db`lower(coalesce(nullif(tn.name, ''), nullif(m.name, ''), ''))`;
  const q = (o.q ?? "").trim().slice(0, 60);
  try {
    const size = Math.max(1, Math.min(100, o.size));
    const where = db`and ${filt} ${q ? db`and ${nm} like ${like(q.toLowerCase())}` : db``}`;
    const [{ total }] = await db`select count(*)::int total ${peopleFrag(s, ids, one)} ${where}`;
    const rows = await db`
      select m.user_id, coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') name, ${nm} nmk, m.role crm_role, ${eff} role, re.role everywhere, re.set_by, re.set_at,
        (select count(*)::int from team_member_roles o where o.installation_id = m.installation_id and o.user_id = m.user_id and o.location_id <> '') overrides
      ${peopleFrag(s, ids, one)} ${where}
      ${cur ? db`and (${nm}, m.user_id) > (${String(cur.v ?? "")}::text, ${cur.id}::text)` : db``}
      order by ${nm}, m.user_id limit ${size + 1}`;
    const page = rows.slice(0, size);
    const next = rows.length > size ? encodeCursor({ v: page[page.length - 1].nmk as string, id: page[page.length - 1].user_id as string }) : null;
    const evidence = await behaviour(s.inst, ids, page.filter((r) => !r.role).map((r) => r.user_id as string), now);
    return {
      ready: true, total: Number(total), next,
      rows: page.map((r) => {
        const id = r.user_id as string, ev = evidence.get(id);
        return {
          userId: id, name: (r.name as string) || "Not named yet", crmRole: (r.crm_role as string) ?? "unknown", role: isRoleId(r.role) ? r.role : null, everywhere: isRoleId(r.everywhere) ? r.everywhere : null,
          overrides: Number(r.overrides ?? 0), suggestion: !r.role && ev ? suggestRole({ ...ev, days: 90 }) : null, setBy: (r.set_by as string | null) ?? null, setAt: r.set_at ? new Date(r.set_at as string).toISOString() : null,
        };
      }),
    };
  } catch (e) {
    if (isMissing(e)) return { rows: [], total: 0, next: null, ready: false };
    throw e;
  }
}

/** Appointments booked and appointments taken per person over the last 90 days (from the daily rollup), for the suggestions only. */
async function behaviour(inst: string, ids: string[], users: string[], now: number): Promise<Map<string, { booked: number; attended: number }>> {
  const out = new Map<string, { booked: number; attended: number }>();
  if (!users.length || !ids.length) return out;
  try {
    const since = new Date(now - 90 * DAY).toISOString().slice(0, 10);
    const rows = await sql()`select user_id, coalesce(sum(appts_set), 0)::int booked, coalesce(sum(held + no_show), 0)::int attended from user_daily
      where installation_id = ${inst} and location_id = any(${ids}::text[]) and user_id = any(${users}::text[]) and day >= ${since}::date group by user_id`;
    for (const r of rows) out.set(r.user_id as string, { booked: Number(r.booked), attended: Number(r.attended) });
  } catch (e) { if (!isMissing(e)) throw e; }
  return out;
}

/** Every stored role for the people this caller may see, for chips in the other modules: everywhere rows, plus the rows of accounts the caller may read. Capped. */
export async function roleMap(s: Scope, ids: string[]): Promise<{ roles: Record<string, { role: RoleId | null; byAccount: Record<string, RoleId> }>; any: boolean }> {
  const out: Record<string, { role: RoleId | null; byAccount: Record<string, RoleId> }> = {};
  let any = false;
  try {
    const db = sql();
    const rows = await db`select r.user_id, r.location_id, r.role from team_member_roles r join team_members m on m.installation_id = r.installation_id and m.user_id = r.user_id
      where r.installation_id = ${s.inst} and (r.location_id = '' or r.location_id = any(${ids}::text[])) and not m.deleted and ${visibleMember(s, ids)} limit 5000`;
    for (const r of rows) {
      if (!isRoleId(r.role)) continue;
      const e = (out[r.user_id as string] ??= { role: null, byAccount: {} });
      if ((r.location_id as string) === "") e.role = r.role; else e.byAccount[r.location_id as string] = r.role;
      if (r.role === "setter" || r.role === "closer" || r.role === "both") any = true;
    }
  } catch (e) { if (!isMissing(e)) throw e; }
  return { roles: out, any };
}

/** Of these ids, the ones that are people this caller may see. A foreign or unknown id is simply missing from the answer. */
export async function ownedPeople(s: Scope, ids: string[], users: readonly unknown[]): Promise<string[]> {
  const asked = [...new Set(users.map(cleanId).filter((x): x is string => x !== null))];
  if (!asked.length) return [];
  try {
    const rows = await sql()`select m.user_id from team_members m where m.installation_id = ${s.inst} and not m.deleted and m.user_id = any(${asked}::text[]) and ${visibleMember(s, ids)}`;
    return rows.map((r) => r.user_id as string);
  } catch (e) { if (isMissing(e)) return []; throw e; }
}

/** The stored role of each person for ONE scope ('' = everywhere, or one account). */
export async function storedRoles(inst: string, users: readonly string[], locationId: string): Promise<Map<string, RoleId | null>> {
  const out = new Map<string, RoleId | null>();
  if (!users.length) return out;
  try {
    const rows = await sql()`select user_id, role from team_member_roles where installation_id = ${inst} and location_id = ${locationId} and user_id = any(${[...users]}::text[])`;
    for (const r of rows) if (isRoleId(r.role)) out.set(r.user_id as string, r.role);
  } catch (e) { if (!isMissing(e)) throw e; }
  return out;
}

export type Actor = { userId: string | null; name: string | null };
/** Writes the changes and one history row each, together or not at all. Returns false when the tables are not there yet. */
export async function applyRoleChanges(inst: string, changes: readonly Change[], actor: Actor, batchId: string, reason: "set" | "clear" | "bulk" | "undo"): Promise<boolean> {
  if (!changes.length) return true;
  try {
    await sql().begin(async (tx) => {
      for (const c of changes) {
        if (c.to === null) await tx`delete from team_member_roles where installation_id = ${inst} and user_id = ${c.userId} and location_id = ${c.locationId}`;
        else await tx`insert into team_member_roles (installation_id, user_id, location_id, role, set_by, set_by_name) values (${inst}, ${c.userId}, ${c.locationId}, ${c.to}, ${actor.userId}, ${actor.name})
          on conflict (installation_id, user_id, location_id) do update set role = excluded.role, set_by = excluded.set_by, set_by_name = excluded.set_by_name, set_at = now()`;
        await tx`insert into team_member_role_history (installation_id, batch_id, user_id, location_id, old_role, new_role, reason, set_by, set_by_name)
          values (${inst}, ${batchId}, ${c.userId}, ${c.locationId}, ${c.from}, ${c.to}, ${reason}, ${actor.userId}, ${actor.name})`;
      }
    });
    return true;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}

export type RoleLogRow = { batchId: string; at: string; by: string | null; reason: string; count: number; to: RoleId | null; sample: string[]; locationId: string };
/** The recent changes, one line per batch, newest first. The first three names are a sample. */
export async function recentRoleChanges(s: Scope, ids: string[] | null, limit = 30): Promise<RoleLogRow[]> {
  try {
    const db = sql();
    const rows = await db`
      select h.batch_id, min(h.set_at) at, max(h.set_by_name) by_name, max(h.reason) reason, count(*)::int n, max(h.new_role) to_role, max(h.location_id) loc,
        (array_agg(coalesce(nullif(tn.name, ''), nullif(m.name, ''), 'Someone') order by h.set_at))[1:3] sample
      from team_member_role_history h left join team_members m on m.installation_id = h.installation_id and m.user_id = h.user_id
        left join team_names tn on tn.installation_id = h.installation_id and tn.user_id = h.user_id
      where h.installation_id = ${s.inst} ${ids ? db`and (h.location_id = '' or h.location_id = any(${ids}::text[]))` : db``} and ${s.level === "all" ? db`true` : db`h.location_id <> ''`}
      group by h.batch_id order by min(h.set_at) desc limit ${Math.min(limit, 100)}`;
    return rows.map((r) => ({
      batchId: r.batch_id as string, at: new Date(r.at as string).toISOString(), by: (r.by_name as string | null) ?? null, reason: r.reason as string, count: Number(r.n), to: isRoleId(r.to_role) ? r.to_role : null,
      sample: (r.sample as string[] | null) ?? [], locationId: r.loc as string,
    }));
  } catch (e) { if (isMissing(e)) return []; throw e; }
}

/** The rows of one earlier batch, so it can be put back. Only changes whose result still stands are returned (a person changed again since is left alone). */
export async function undoPlan(s: Scope, ids: string[], batchId: string): Promise<{ changes: Change[]; skipped: number } | null> {
  try {
    const db = sql();
    const rows = await db`select h.user_id, h.location_id, h.old_role, h.new_role from team_member_role_history h
      where h.installation_id = ${s.inst} and h.batch_id = ${batchId} and h.reason <> 'undo' limit 1000`;
    if (!rows.length) return null;
    const scoped = rows.filter((r) => (r.location_id as string) === "" ? s.level === "all" : ids.includes(r.location_id as string));
    const visible = new Set(await ownedPeople(s, ids, scoped.map((r) => r.user_id)));
    const changes: Change[] = [];
    let skipped = rows.length - scoped.length;
    for (const loc of new Set(scoped.map((r) => r.location_id as string))) {
      const part = scoped.filter((r) => (r.location_id as string) === loc && visible.has(r.user_id as string));
      const now = await storedRoles(s.inst, part.map((r) => r.user_id as string), loc);
      for (const r of part) {
        const cur = now.get(r.user_id as string) ?? null;
        if (cur !== ((r.new_role as RoleId | null) ?? null)) { skipped++; continue; }
        changes.push({ userId: r.user_id as string, locationId: loc, from: cur, to: (r.old_role as RoleId | null) ?? null });
      }
    }
    skipped += scoped.length - scoped.filter((r) => visible.has(r.user_id as string)).length;
    return { changes, skipped };
  } catch (e) { if (isMissing(e)) return null; throw e; }
}

/** Display names for a few people (previews and the log). Only ever called with ids that already passed ownedPeople(). */
export async function namesFor(inst: string, users: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!users.length) return out;
  try {
    const rows = await sql()`select m.user_id, coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') name from team_members m left join team_names tn on tn.installation_id = m.installation_id and tn.user_id = m.user_id
      where m.installation_id = ${inst} and m.user_id = any(${[...users]}::text[])`;
    for (const r of rows) out.set(r.user_id as string, (r.name as string) || "Not named yet");
  } catch (e) { if (!isMissing(e)) throw e; }
  return out;
}
