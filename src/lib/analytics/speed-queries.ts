import { sql } from "../db";
import { EXCLUSION_LABEL, type Exclusion } from "./lead-rules";
import { properCase, resolveUser, safePhotoUrl, type KnownUser, type UsersState } from "./people-labels";
import { accountsPart, membersPart, peoplePart, sourcePart, summaryPart, type LoadedRow, type Lookups } from "./speed-parts";
import { autoVsHuman, bySource, isNeverAnswered, judge, peopleProgress, summarise, unknownSource, weekMembers, weeklyTrend, type Judged, type TouchRow } from "./speed-intel";
import type { Part, Win } from "./speed-window";

// Everything the speed-to-lead screen shows, for the accounts the caller may see. Leads older than the
// window are left out: a lead from three weeks ago says nothing about how the team answers today.
export const SPEED_WINDOW_DAYS = 14;
/** How many leads are listed behind one week of the trend. The week says how many there really were. */
export const TREND_MEMBER_CAP = 60;
/** How many waiting or missed leads are listed. The heading says how many there really are. */
export const WAITING_LIST_CAP = 200;
const DAY = 86_400_000;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
type Db = ReturnType<typeof sql>;

// The name a lead goes by: the contact's name (proper case when it was typed all lower or upper case), else the email, else the phone.
const leadName = (full: unknown, email: unknown, phone: unknown): string => {
  const pick = [full, email, phone].find((v) => typeof v === "string" && v.trim() !== "") as string | undefined;
  return pick ? properCase(pick) : "Unnamed contact";
};

// Lead records for the accounts the caller may see, in a window of arrival times. This is the ONE query behind every figure and every list.
async function loadRows(db: Db, installationId: string, allowed: string[] | null, fromMs: number, toMs: number): Promise<LoadedRow[]> {
  const rows = await db`
    select t.location_id, t.contact_id, coalesce(t.clock_start, t.lead_at) lead_at, t.touch_at, t.touch_user_id, t.auto_touch_at, t.human_touch_at, t.read_version,
      c.source, c.tags, c.full_name, c.email, c.phone, nullif(c.assigned_to, '') assigned_to
    from lead_touches t
    left join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
    join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
    where t.installation_id = ${installationId} and t.excluded is null and t.lead_at > ${new Date(fromMs)} and t.lead_at < ${new Date(toMs)}
      ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``} limit 20000`;
  return rows.map((r) => ({
    locationId: r.location_id as string, contactId: r.contact_id as string, leadAt: ms(r.lead_at) ?? 0, touchAt: ms(r.touch_at), userId: r.touch_user_id as string | null,
    source: (r.source as string | null) ?? null, tags: (r.tags as string[] | null) ?? [], assigned: r.assigned_to !== null,
    autoAt: ms(r.auto_touch_at), humanAt: ms(r.human_touch_at), detailed: Number(r.read_version ?? 0) === 1,
    name: leadName(r.full_name, r.email, r.phone), assignedTo: (r.assigned_to as string | null) ?? null,
  }));
}

async function loadLookups(db: Db, installationId: string, allowed: string[] | null, targetMinutes: number, now: number) {
  const [locs, people] = await Promise.all([
    db`select location_id, name, speed_access, users_access from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by lower(coalesce(name, ''))`,
    db`select user_id, name, photo_url from team_names where installation_id = ${installationId}`,
  ]);
  const team = new Map<string, KnownUser>(people.map((p) => [p.user_id as string, { name: p.name as string, photoUrl: safePhotoUrl(p.photo_url) }]));
  const lk: Lookups = {
    now, targetMinutes, team,
    locationNames: new Map(locs.map((l) => [l.location_id as string, (l.name as string | null) ?? "Unnamed account"])),
    usersAccess: new Map(locs.map((l) => [l.location_id as string, ((l.users_access as string | null) ?? null) as UsersState])),
  };
  return { locs, lk };
}

export async function speedView(installationId: string, allowed: string[] | null, targetMinutes: number, now = Date.now()) {
  const db = sql();
  const [{ locs, lk }, rows, left] = await Promise.all([
    loadLookups(db, installationId, allowed, targetMinutes, now),
    loadRows(db, installationId, allowed, now - SPEED_WINDOW_DAYS * DAY, now + DAY),
    db`select t.excluded, count(*)::int n from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
       where t.installation_id = ${installationId} and t.excluded is not null and t.lead_at > ${new Date(now - SPEED_WINDOW_DAYS * DAY)}
         ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``} group by 1 order by 2 desc`.catch(() => []),
  ]);
  const touches: TouchRow[] = rows;
  const names = lk.locationNames;

  const perAccount = locs.map((l) => {
    const mine = touches.filter((t) => t.locationId === l.location_id);
    return { locationId: l.location_id as string, name: names.get(l.location_id as string) as string, access: (l.speed_access as string | null) ?? null, ...summarise(mine, targetMinutes, now) };
  }).filter((a) => a.leads > 0 || a.access === "needs_permission")
    .sort((a, b) => b.stillWaiting - a.stillWaiting || (a.hitRate ?? 2) - (b.hitRate ?? 2));

  // The trend is an extra: if this read ever fails, the rest of the screen must still load.
  const history = await db`
    select t.location_id, t.contact_id, coalesce(t.clock_start, t.lead_at) lead_at, t.touch_at, t.touch_user_id
    from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
    where t.installation_id = ${installationId} and t.excluded is null and t.lead_at > ${new Date(now - 56 * DAY)}
      ${allowed ? db`and t.location_id = any(${allowed}::text[])` : db``} limit 50000`.catch(() => []);
  // The same rows feed the bars and the lists behind them (KF-6): the trend and weekMembers both come from judgedInWeek.
  const historyRows: TouchRow[] = history.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, leadAt: ms(r.lead_at) ?? 0, touchAt: ms(r.touch_at), userId: r.touch_user_id as string | null }));
  const trendBase = weeklyTrend(historyRows, targetMinutes, now);
  const WEEKS = trendBase.length;
  const membersByWeek = trendBase.map((_, k) => weekMembers(historyRows, targetMinutes, now, WEEKS - 1 - k, TREND_MEMBER_CAP));
  const memberIds = [...new Set(membersByWeek.flat().map((m) => m.row.contactId))];
  const memberNames = memberIds.length === 0 ? [] : await db`
    select location_id, contact_id, full_name, email, phone from cached_contacts
    where installation_id = ${installationId} and contact_id = any(${memberIds}::text[])`.catch(() => []);
  const memberName = new Map(memberNames.map((c) => [`${c.location_id}:${c.contact_id}`, leadName(c.full_name, c.email, c.phone)]));
  const trend = trendBase.map((w, k) => ({ ...w, members: membersByWeek[k].map((m) => ({
    locationId: m.row.locationId, locationName: names.get(m.row.locationId) ?? "Account", contactId: m.row.contactId, name: memberName.get(`${m.row.locationId}:${m.row.contactId}`) ?? "Unnamed contact",
    status: m.status as Judged, minutes: Math.round(((m.row.touchAt ?? now) - m.row.leadAt) / 60_000),
  })) }));

  // Leads waiting or missed: the longest wait first. Each row says who owns the lead, where it came from and whether an automatic message went out.
  const waitingList = membersPart(rows, lk, (_r, s) => s === "waiting", WAITING_LIST_CAP);
  const people = peopleProgress(touches).slice(0, 12).map((p) => {
    const sample = rows.find((r) => r.userId === p.userId);
    return { userId: p.userId, ...resolveUser(p.userId, lk.team, sample ? lk.usersAccess.get(sample.locationId) : null), replies: p.replies, medianSeconds: p.medianSeconds, ranked: p.ranked };
  });

  return {
    targetMinutes, windowDays: SPEED_WINDOW_DAYS,
    // Contacts that were not counted as leads, and why (bulk imports, spam, test contacts, do not contact, duplicates).
    leftOut: left.map((r) => ({ reason: r.excluded as string, label: EXCLUSION_LABEL[r.excluded as Exclusion] ?? (r.excluded as string), n: r.n as number })),
    access: { ok: locs.filter((l) => l.speed_access === "ok").length, needsPermission: locs.filter((l) => l.speed_access === "needs_permission").map((l) => ({ locationId: l.location_id as string, name: names.get(l.location_id as string) as string })), total: locs.length },
    overall: summarise(touches, targetMinutes, now),
    bySource: bySource(touches, targetMinutes, now),
    unknownSource: unknownSource(touches.filter((t) => judge(t, targetMinutes, now) !== null)),
    autoVsHuman: autoVsHuman(touches, targetMinutes, now),
    trend,
    neverAnswered: touches.filter((t) => t.touchAt === null && isNeverAnswered((now - t.leadAt) / 60_000)).length,
    unassignedWaiting: touches.filter((t) => t.touchAt === null && !t.assigned && (now - t.leadAt) / 60_000 > targetMinutes).length,
    perAccount,
    people,
    waitingTotal: waitingList.count,
    waiting: waitingList.rows.map((w) => ({
      locationId: w.locationId, locationName: w.locationName, contactId: w.contactId, name: w.name, waitingMinutes: w.minutes, unassigned: w.unassigned, neverAnswered: w.neverAnswered,
      source: w.source, owner: w.owner, autoSeconds: w.autoSeconds, detailed: w.detailed,
    })),
  };
}

// One card of the screen over a window the card chose itself (KF-4): the same rows, the same judging, and the lists behind every figure.
export async function speedPart(installationId: string, allowed: string[] | null, targetMinutes: number, part: Part, win: Win, cmp: Win | null, now = Date.now()) {
  const db = sql();
  const { locs, lk } = await loadLookups(db, installationId, allowed, targetMinutes, now);
  const rows = await loadRows(db, installationId, allowed, win.fromMs, Math.min(win.toMs, now + DAY));
  const window = { from: win.from, to: win.to };
  const base = { part, window, targetMinutes, leads: rows.length };
  if (part === "summary") {
    const cmpRows = cmp ? await loadRows(db, installationId, allowed, cmp.fromMs, cmp.toMs) : null;
    const s = summaryPart(rows, lk);
    return { ...base, ...s, compare: cmpRows ? { window: { from: cmp!.from, to: cmp!.to }, summary: summarise(cmpRows, targetMinutes, now) } : null };
  }
  if (part === "source") return { ...base, ...sourcePart(rows, lk) };
  if (part === "accounts") {
    const accounts = locs.map((l) => ({ locationId: l.location_id as string, name: lk.locationNames.get(l.location_id as string) as string, access: (l.speed_access as string | null) ?? null }));
    return { ...base, rows: accountsPart(rows, lk, accounts) };
  }
  return { ...base, rows: peoplePart(rows, lk) };
}

// The lead arrivals and first replies of the last 14 days for the accounts the caller may see, nothing else: what Today's "reply speed against your usual" and the
// answered-in-time streak are worked out from (src/lib/analytics/today-queue.ts). The same rows, the same exclusions, the same window as the Speed to lead screen.
export async function replyRows(installationId: string, allowed: string[] | null, now = Date.now()): Promise<Array<{ locationId: string; leadAt: number; touchAt: number | null }>> {
  const rows = await loadRows(sql(), installationId, allowed, now - SPEED_WINDOW_DAYS * DAY, now + DAY);
  return rows.map((r) => ({ locationId: r.locationId, leadAt: r.leadAt, touchAt: r.touchAt }));
}

/**
 * The lead ledger Today reads: every lead of the last 14 days for the accounts the caller may see (the same rows, window and exclusions as Speed to lead), with the
 * names a person reads (account, lead, owner, who replied, source) and the account's own time zone. Today's insights, coverage strip, speed by source, workload and
 * "accounts compared" are all worked out from these rows, and the lists behind them list these rows, so a number and its list cannot disagree. Nothing is written.
 * `url` is left empty: the router fills it with the white-label link.
 */
export async function leadLedger(installationId: string, allowed: string[] | null, now = Date.now()): Promise<Array<LeadLedgerRow>> {
  const db = sql();
  const [{ lk }, rows, zones] = await Promise.all([
    loadLookups(db, installationId, allowed, 0, now),
    loadRows(db, installationId, allowed, now - SPEED_WINDOW_DAYS * DAY, now + DAY),
    db`select location_id, timezone from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`,
  ]);
  const zone = new Map(zones.map((z) => [z.location_id as string, (z.timezone as string | null) || "UTC"]));
  const who = (id: string | null, locationId: string) => (id ? resolveUser(id, lk.team, lk.usersAccess.get(locationId)).label : null);
  return rows.map((r) => ({
    id: `lead:${r.locationId}:${r.contactId}:${r.leadAt}`, locationId: r.locationId, accountName: lk.locationNames.get(r.locationId) ?? "Client account", contactId: r.contactId, name: r.name,
    source: r.source && r.source.trim() !== "" ? r.source.trim() : null, ownerName: who(r.assignedTo, r.locationId), touchBy: r.touchAt !== null ? who(r.userId, r.locationId) : null,
    leadAt: r.leadAt, touchAt: r.touchAt, url: "", zone: zone.get(r.locationId) ?? "UTC",
  }));
}
export type LeadLedgerRow = {
  id: string; locationId: string; accountName: string; contactId: string; name: string; source: string | null; ownerName: string | null; touchBy: string | null;
  leadAt: number; touchAt: number | null; url: string; zone: string;
};
