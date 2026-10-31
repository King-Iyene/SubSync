import { sql } from "../db";
import { bySource, isNeverAnswered, rankPeople, summarise, type Summary, type TouchRow } from "./speed-intel";

// Everything the speed-to-lead screen shows, for the accounts the caller may see. Leads older than the
// window are left out: a lead from three weeks ago says nothing about how the team answers today.
export const SPEED_WINDOW_DAYS = 14;
const DAY = 86_400_000;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

export async function speedView(installationId: string, allowed: string[] | null, targetMinutes: number, now = Date.now()) {
  const db = sql();
  const [locs, rows, people] = await Promise.all([
    db`select location_id, name, speed_access from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by lower(coalesce(name, ''))`,
    db`
      select t.location_id, t.contact_id, t.lead_at, t.touch_at, t.touch_user_id, c.source, (nullif(c.assigned_to, '') is not null) assigned
      from lead_touches t
      left join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
      join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
      where t.installation_id = ${installationId} and t.lead_at > ${new Date(now - SPEED_WINDOW_DAYS * DAY)}
        ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``} limit 20000`,
    db`select user_id, name from team_names where installation_id = ${installationId}`,
  ]);
  const touches: TouchRow[] = rows.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, leadAt: ms(r.lead_at) ?? 0, touchAt: ms(r.touch_at), userId: r.touch_user_id as string | null, source: (r.source as string | null) ?? null, assigned: r.assigned === true }));
  const names = new Map(locs.map((l) => [l.location_id as string, (l.name as string | null) ?? "Unnamed account"]));
  const who = new Map(people.map((p) => [p.user_id as string, p.name as string]));

  const perAccount = locs.map((l) => {
    const mine = touches.filter((t) => t.locationId === l.location_id);
    const s: Summary = summarise(mine, targetMinutes, now);
    return { locationId: l.location_id as string, name: names.get(l.location_id as string) as string, access: (l.speed_access as string | null) ?? null, ...s };
  }).filter((a) => a.leads > 0 || a.access === "needs_permission")
    .sort((a, b) => b.stillWaiting - a.stillWaiting || (a.hitRate ?? 2) - (b.hitRate ?? 2));

  const waitingRows = touches.filter((t) => t.touchAt === null && (now - t.leadAt) / 60_000 > targetMinutes).sort((a, b) => a.leadAt - b.leadAt).slice(0, 30);
  const contactNames = waitingRows.length === 0 ? [] : await db`
    select location_id, contact_id, coalesce(nullif(full_name, ''), email, 'Unnamed contact') name from cached_contacts
    where installation_id = ${installationId} and contact_id = any(${waitingRows.map((w) => w.contactId)}::text[])`;
  const cname = new Map(contactNames.map((c) => [`${c.location_id}:${c.contact_id}`, c.name as string]));

  return {
    targetMinutes, windowDays: SPEED_WINDOW_DAYS,
    access: { ok: locs.filter((l) => l.speed_access === "ok").length, needsPermission: locs.filter((l) => l.speed_access === "needs_permission").map((l) => ({ locationId: l.location_id as string, name: names.get(l.location_id as string) as string })), total: locs.length },
    overall: summarise(touches, targetMinutes, now),
    bySource: bySource(touches, targetMinutes, now),
    neverAnswered: touches.filter((t) => t.touchAt === null && isNeverAnswered((now - t.leadAt) / 60_000)).length,
    unassignedWaiting: touches.filter((t) => t.touchAt === null && !t.assigned && (now - t.leadAt) / 60_000 > targetMinutes).length,
    perAccount,
    people: rankPeople(touches).slice(0, 12).map((p) => ({ ...p, label: who.get(p.userId) ?? "Team member " + p.userId.slice(-4) })),
    waiting: waitingRows.map((w) => ({ locationId: w.locationId, locationName: names.get(w.locationId) ?? "Account", contactId: w.contactId, name: cname.get(`${w.locationId}:${w.contactId}`) ?? "Contact", waitingMinutes: Math.round((now - w.leadAt) / 60_000), unassigned: !w.assigned, neverAnswered: isNeverAnswered(Math.round((now - w.leadAt) / 60_000)) })),
  };
}
