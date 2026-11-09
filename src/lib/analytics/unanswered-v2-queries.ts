import { waitingMoney } from "./waiting-money-queries";
import { waitingMoneyLine } from "./waiting-money";
import { sql } from "../db";
import { conversationCoverage } from "./queries";
import { properCase, resolveUser, type PersonLabel } from "./people-labels";
import { loadLookups, loadRows, loadTargets } from "./speed-queries";
import { accountFacts } from "./speed-v2-queries";
import { selectLeads } from "./speed-v2";
import { CONVERSATIONS_READ_PER_ACCOUNT, readLimitNote, WAITING_WINDOW_DAYS } from "./waiting";
import type { Lookups } from "./speed-parts";
import type { WaitingLead } from "./today-queue";
import {
  DAY, estimateFor, facetsOf, HOUR, isBucket, leadKey, markNewLeads, meaningLine, nextBestAction, pageOf, peopleOf, rankAccounts, rankOwners, selectPeople, SORTS,
  todayAgreement, visibleBuckets, waitingConversations, homeOf, breachLine, type BucketKey, type PeopleSort, type Person, type WaitConv,
} from "./unanswered-v2";

// The data behind the rebuilt Unanswered messages screen. Read only: nothing here writes to SubSync's tables or to the CRM, and no message text is ever read (SubSync keeps only
// who wrote, when and through which channel). Every query is bound to `allowed`, the accounts the router decided the caller may read from the verified session; an account id in
// the address only NARROWS inside them. Which conversations are waiting is `waitingState` (waiting.ts), the one rule; the people, the buckets, the lists and the figures come from
// unanswered-v2.ts, so a number and the list behind it are one thing.

/** The most waiting conversations read at once (the oldest first, so the longest waits are never the ones left out). The screen says so when it is reached. */
export const WAITING_READ_CAP = 20_000;

/** Load waiting conversations with exact total count using SQL window function (Item 2: SQL Aggregates).
 * Applies per-account SLA filter in the database query. Returns exact total matching the filtered results. */
export async function loadWaitingAgg(db: Db, installationId: string, allowed: string[] | null, now: number, globalSlaHours: number): Promise<{ rows: WaitConv[]; total: number; truncated: boolean }> {
  if (allowed && allowed.length === 0) return { rows: [], total: 0, truncated: false };
  const accountSla = await loadAccountSlaHours(db, installationId);

  // Build the SLA filter: we need to join locations to get speed_target_minutes per account
  // and compute the per-account SLA threshold in SQL
  const slaCase = accountSla.size > 0
    ? db`case when l.speed_target_minutes is not null and l.speed_target_minutes > 0
        then (l.speed_target_minutes + 59) / 60  -- ceiling minutes to hours
        else ${globalSlaHours} end`
    : db`${globalSlaHours}`;

  // Single query with window function for exact total and SLA filter in WHERE
  const rows = await db`
    select c.conversation_id, c.location_id, c.contact_id, c.last_message_type, c.last_message_at, c.unread_count,
      coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), '')) name,
      nullif(ct.assigned_to, '') assigned_to, nullif(ct.phone, '') phone, nullif(ct.email, '') email, coalesce(ct.dnd, false) dnd, l.timezone,
      count(*) over() as total
    from cached_conversations c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    where c.installation_id = ${installationId}
      and c.last_message_direction = 'inbound'
      and c.last_message_at > ${new Date(now - WAITING_WINDOW_DAYS * DAY)}
      and c.last_message_at < ${new Date(now)} - ${slaCase} * interval '1 hour'
      ${allowed ? db`and c.location_id = any(${allowed}::text[])` : db``}
    order by c.last_message_at asc
    limit ${WAITING_READ_CAP}`;

  if (rows.length === 0) return { rows: [], total: 0, truncated: false };

  const total = Number(rows[0].total);
  const out: WaitConv[] = rows.map((r) => ({
    conversationId: r.conversation_id as string, locationId: r.location_id as string, contactId: (r.contact_id as string | null) ?? null,
    name: r.name ? properCase(r.name as string) : null, lastType: (r.last_message_type as string | null) ?? null, lastAt: (r.last_message_at as Date).getTime(),
    assignedTo: (r.assigned_to as string | null) ?? null, unreadCount: Number(r.unread_count ?? 0), phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, dnd: r.dnd === true,
    timeZone: (r.timezone as string | null) || null,
  }));
  return { rows: out, total, truncated: out.length >= WAITING_READ_CAP };
}

export type OwnerOut = { id: string; label: string; state: PersonLabel["state"] };
export type PersonOut = {
  key: string; locationId: string; locationName: string; contactId: string | null; conversationId: string; name: string; channel: string; call: boolean;
  hours: number; conversations: number; unreadMessages: number; owner: OwnerOut | null; unassigned: boolean; phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; newLead: boolean;
};

type Db = ReturnType<typeof sql>;

/** Per-account reply targets in hours, from locations.speed_target_minutes (minutes -> hours, ceiling). Null means use global SLA. */
async function loadAccountSlaHours(db: Db, installationId: string): Promise<Map<string, number>> {
  try {
    const rows = await db`select location_id, speed_target_minutes from locations where installation_id = ${installationId} and speed_target_minutes is not null`;
    const map = new Map<string, number>();
    for (const r of rows) {
      const minutes = Number(r.speed_target_minutes);
      if (Number.isFinite(minutes) && minutes > 0) map.set(r.location_id as string, Math.ceil(minutes / 60));
    }
    return map;
  } catch {
    return new Map();
  }
}

/** The conversations whose last message is the customer's, inside the window and past the reply target, for the accounts allowed. */
export async function loadWaiting(db: Db, installationId: string, allowed: string[] | null, now: number, globalSlaHours: number): Promise<{ rows: WaitConv[]; truncated: boolean }> {
  if (allowed && allowed.length === 0) return { rows: [], truncated: false };
  const accountSla = await loadAccountSlaHours(db, installationId);
  const rows = await db`
    select c.conversation_id, c.location_id, c.contact_id, c.last_message_type, c.last_message_at, c.unread_count,
      coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), '')) name,
      nullif(ct.assigned_to, '') assigned_to, nullif(ct.phone, '') phone, nullif(ct.email, '') email, coalesce(ct.dnd, false) dnd, l.timezone
    from cached_conversations c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    where c.installation_id = ${installationId} and c.last_message_direction = 'inbound'
      and c.last_message_at > ${new Date(now - WAITING_WINDOW_DAYS * DAY)}
      ${allowed ? db`and c.location_id = any(${allowed}::text[])` : db``}
    order by c.last_message_at asc limit ${WAITING_READ_CAP}`;
  const out: WaitConv[] = rows.map((r) => ({
    conversationId: r.conversation_id as string, locationId: r.location_id as string, contactId: (r.contact_id as string | null) ?? null,
    name: r.name ? properCase(r.name as string) : null, lastType: (r.last_message_type as string | null) ?? null, lastAt: (r.last_message_at as Date).getTime(),
    assignedTo: (r.assigned_to as string | null) ?? null, unreadCount: Number(r.unread_count ?? 0), phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, dnd: r.dnd === true,
    timeZone: (r.timezone as string | null) || null,
  }));
  return { rows: out, truncated: out.length >= WAITING_READ_CAP };
}

/** Filter conversations by per-account SLA (falls back to global). Keeps only those where waitingState === "waiting". */
export function filterWaitingBySla(rows: WaitConv[], now: number, globalSlaHours: number, accountSla: Map<string, number>): WaitConv[] {
  return rows.filter((c) => {
    const sla = accountSla.get(c.locationId) ?? globalSlaHours;
    return c.lastAt < now - sla * HOUR && c.lastAt > now - WAITING_WINDOW_DAYS * DAY;
  });
}

const ownerLabel = (id: string, lk: Lookups, locationId: string | null): PersonLabel => resolveUser(id, lk.team, locationId ? lk.usersAccess.get(locationId) : undefined);

function personOut(p: Person, lk: Lookups): PersonOut {
  const o = p.assignedTo ? ownerLabel(p.assignedTo, lk, p.locationId) : null;
  return {
    key: p.key, locationId: p.locationId, locationName: lk.locationNames.get(p.locationId) ?? "Client account", contactId: p.contactId, conversationId: p.conversationId, name: p.name,
    channel: p.channel, call: p.call, hours: p.hours, conversations: p.conversations, unreadMessages: p.unreadMessages, owner: o ? { id: p.assignedTo as string, label: o.label, state: o.state } : null, unassigned: p.assignedTo === null,
    phone: p.phone, email: p.email, dnd: p.dnd, timeZone: p.timeZone, newLead: p.newLead,
  };
}

/** The new leads past their reply target with no person's reply (Speed to lead's waiting list, the same selection Today counts), as Today's own lists carry them. */
async function waitingLeads(db: Db, i: { installationId: string; allowed: string[] | null; targetMinutes: number; now: number }, accounts: ReadonlyMap<string, string>): Promise<WaitingLead[]> {
  const rows = await loadRows(db, i.installationId, i.allowed, i.now - WAITING_WINDOW_DAYS * DAY, i.now + DAY);
  const recent = rows.filter((r) => r.leadAt > i.now - 14 * DAY);
  return selectLeads(recent, { targetMinutes: i.targetMinutes, now: i.now, accounts }, { status: "waiting" }).map((x) => ({
    locationId: x.row.locationId, accountName: accounts.get(x.row.locationId) ?? "Client account", contactId: x.row.contactId, name: x.row.name, at: x.row.leadAt, never: false, url: "", owner: null, source: null, detail: "",
  }));
}

export type HomeInput = { installationId: string; allowed: string[] | null; slaHours: number; targetMinutes: number; now: number; seePeople: boolean; meId: string | null };

/** The first screen, bounded: five rows, the buckets, five clients (or five owners), one line about the money. The long lists come from unansweredList and unansweredRanks. */
export async function unansweredHome(i: HomeInput) {
  const db = sql();
  const [{ lk, locs }, waited, facts, coverage] = await Promise.all([
    loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now),
    loadWaitingAgg(db, i.installationId, i.allowed, i.now, i.slaHours),
    accountFacts(i.installationId, i.allowed),
    conversationCoverage(i.installationId).catch(() => []),
  ]);
  const waiting = waitingConversations(waited.rows, { now: i.now, slaHours: i.slaHours });
  // The agreement with Today needs the new leads; if that read fails the rest of the screen still loads and says nothing about it.
  let agree: ReturnType<typeof todayAgreement> | null = null;
  let leadKeys = new Set<string>();
  try {
    const leads = await waitingLeads(db, i, lk.locationNames);
    leadKeys = new Set(leads.map((l) => leadKey(l.locationId, l.contactId)));
    agree = todayAgreement(waiting, leads);
  } catch { /* the agreement is an extra */ }
  const people = markNewLeads(peopleOf(waiting, { now: i.now }), leadKeys);
  const me = i.meId && people.some((p) => p.assignedTo === i.meId) ? i.meId : null;
  const labelOf = (id: string) => { const l = ownerLabel(id, lk, locs.length === 1 ? (locs[0].location_id as string) : null); return { label: l.label, state: l.state as string }; };
  const home = homeOf(people, { slaHours: i.slaHours, accounts: lk.locationNames, seePeople: i.seePeople, me, labelOf });
  const breach = breachLine(home.facts);
  const cost = estimateFor(people, facts ?? []);
  const money = await waitingMoney(i.installationId, people.map((p) => p.key));
  const clientCounts = new Map<string, number>();
  for (const p of people) clientCounts.set(p.locationId, (clientCounts.get(p.locationId) ?? 0) + 1);
  const clients = [...clientCounts].map(([locationId, count]) => ({ locationId, name: lk.locationNames.get(locationId) ?? "Client account", count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const seen = coverage.filter((c) => !i.allowed || i.allowed.includes(c.locationId));
  const countAccounts = lk.locationNames.size;
  return {
    now: i.now, slaHours: i.slaHours, windowDays: WAITING_WINDOW_DAYS, multi: countAccounts > 1, accountCount: countAccounts, seePeople: i.seePeople,
    waiting: { ...home.facts, headline: home.headline, breach: breach ? breach.text : null, meaning: meaningLine(i.slaHours, WAITING_WINDOW_DAYS), rows: home.rows.map((p) => personOut(p, lk)), clients, money: { line: waitingMoneyLine(money, "Next best step: reply to the person who has waited longest."), dollars: money?.dollars ?? 0, peopleWithDeals: money?.peopleWithDeals ?? 0, deals: money?.deals ?? 0 }, cost: { line: cost.line, formula: cost.formula, amount: cost.amount, leftOutAccounts: cost.leftOutAccounts } },
    buckets: home.buckets, channels: home.channels,
    accounts: home.accounts.total > 1 ? { total: home.accounts.total, rows: home.accounts.rows } : null,
    owners: home.owners ? { total: home.owners.total, rows: home.owners.rows } : null,
    mine: me ? people.filter((p) => p.assignedTo === me).length : 0,
    today: agree ? { count: agree.today, people: agree.people, newLeadsOnly: agree.newLeadsOnly, newLeadsAmongThem: agree.newLeadsAmongThem, partial: agree.partial } : null,
    next: nextBestAction({ people: home.facts.people, newLeadsOnly: agree?.newLeadsOnly ?? 0 }),
    readLimit: readLimitNote(seen.filter((c) => c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, seen.length),
    truncated: waited.truncated, conversationsRead: seen.reduce((n, c) => n + c.stored, 0),
  };
}

// ---------- one list, searched, sorted, filtered and paged on the server ----------

export type ListInput = {
  installationId: string; allowed: string[] | null; slaHours: number; targetMinutes: number; now: number; meId: string | null; seePeople: boolean;
  bucket: string | null; channel: string | null; account: string | null; owner: string | null; q: string; sort: string; page: number; size: number;
};

/** The people behind a number. The count in the heading is the server's total for exactly these people: it is the number that was pressed (KF-6). */
export async function unansweredList(i: ListInput) {
  const db = sql();
  const [{ lk }, waited] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadWaitingAgg(db, i.installationId, i.allowed, i.now, i.slaHours)]);
  const people = peopleOf(waitingConversations(waited.rows, { now: i.now, slaHours: i.slaHours }), { now: i.now });
  const me = i.meId && people.some((p) => p.assignedTo === i.meId) ? i.meId : null;
  // A client's staff cannot look at a colleague's customers by person id: only "mine" and "no owner" narrow for them.
  const owner = i.owner === "me" || i.owner === "none" ? i.owner : i.owner && i.seePeople ? i.owner : null;
  const q = {
    bucket: isBucket(i.bucket) ? (i.bucket as BucketKey) : ("all" as const), channel: i.channel || null, account: i.account || null, owner, q: i.q.trim() || null,
    sort: (SORTS as readonly string[]).includes(i.sort) ? (i.sort as PeopleSort) : ("wait" as const),
  };
  const ctx = { me, accounts: lk.locationNames };
  const chosen = selectPeople(people, q, ctx);
  const pg = pageOf(chosen, i.page, i.size);
  const f = facetsOf(people, q, ctx);
  return {
    total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows.map((p) => personOut(p, lk)),
    facets: { buckets: f.buckets, owner: f.owner, channels: f.channels, visibleBuckets: visibleBuckets(i.slaHours).map((b) => ({ key: b.key, label: b.label })) },
    truncated: waited.truncated,
  };
}

// ---------- the rankings (clients, owners), searched and paged ----------

export type RanksInput = { installationId: string; allowed: string[] | null; slaHours: number; targetMinutes: number; now: number; by: "account" | "owner"; q: string; page: number; size: number; seePeople: boolean };

export async function unansweredRanks(i: RanksInput) {
  const db = sql();
  const [{ lk, locs }, waited] = await Promise.all([loadLookups(db, i.installationId, i.allowed, i.targetMinutes, i.now), loadWaitingAgg(db, i.installationId, i.allowed, i.now, i.slaHours)]);
  const people = peopleOf(waitingConversations(waited.rows, { now: i.now, slaHours: i.slaHours }), { now: i.now });
  const needle = i.q.trim().toLowerCase();
  if (i.by === "owner") {
    // A client's staff never get a ranking of their colleagues.
    if (!i.seePeople) return { by: "owner" as const, total: 0, page: 0, pages: 1, from: 0, to: 0, rows: [] as unknown[] };
    const only = locs.length === 1 ? (locs[0].location_id as string) : null;
    const rows = rankOwners(people, (id) => { const l = ownerLabel(id, lk, only); return { label: l.label, state: l.state as string }; }).filter((r) => !needle || r.label.toLowerCase().includes(needle));
    const pg = pageOf(rows, i.page, i.size);
    return { by: "owner" as const, total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows };
  }
  const rows = rankAccounts(people, lk.locationNames).filter((r) => !needle || r.name.toLowerCase().includes(needle));
  const pg = pageOf(rows, i.page, i.size);
  return { by: "account" as const, total: pg.total, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, rows: pg.rows };
}