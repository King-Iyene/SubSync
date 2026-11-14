import { sql } from "../db";
import { indexRoles, isRoleId, matchesRole, resolveRole, type RoleFilter, type RoleIndex } from "../people/roles";
import { roleSetValues } from "../people/team-empty";
import type { Frag } from "./people3-rollup";

// "Show only the people I labelled Setter / Closer / ..." for the Team screens. The labels are SubSync's own (table team_member_roles); nothing here writes anything.
// A person's label in one account is that account's own row, else the "everywhere" row (the same rule as resolveRole). A missing table reads as "nobody has a label".


const isMissing = (e: unknown) => /relation .* does not exist|42P01|column .* does not exist|42703/i.test(String((e as Error)?.message ?? e));


/** An SQL condition on `userCol` (for example p.user_id): the person's label in the chosen account (or everywhere) is in the filter. */
export function roleSetCond(inst: string, one: string | null, filter: RoleFilter | null, userCol: Frag): Frag {
  const db = sql();
  if (!filter || filter === "all") return db`true`;
  const everywhere = db`(select r.role from team_member_roles r where r.installation_id = ${inst} and r.user_id = ${userCol} and r.location_id = '')`;
  const eff = one ? db`coalesce((select r.role from team_member_roles r where r.installation_id = ${inst} and r.user_id = ${userCol} and r.location_id = ${one}), ${everywhere})` : everywhere;
  const v = roleSetValues(filter);
  return v.orNone && v.roles.length === 0 ? db`${eff} is null` : db`${eff} = any(${v.roles}::text[])`;
}

/** The stored labels of some people (all their accounts), to filter a list in memory. */
export async function roleIndexFor(inst: string, users: readonly string[]): Promise<RoleIndex> {
  if (!users.length) return indexRoles([]);
  try {
    const rows = await sql()`select user_id, location_id, role from team_member_roles where installation_id = ${inst} and user_id = any(${[...users]}::text[]) limit 5000`;
    return indexRoles(rows.flatMap((r) => (isRoleId(r.role) ? [{ userId: r.user_id as string, locationId: r.location_id as string, role: r.role }] : [])));
  } catch (e) { if (isMissing(e)) return indexRoles([]); throw e; }
}

export const inRoleSet = (index: RoleIndex, userId: string, locationId: string, f: RoleFilter | null): boolean => !f || matchesRole(resolveRole(index, userId, locationId), f);
