import { sql, type Sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { LIST_IDS, pageOf, personKey, QUEUE_PAGE, type ListCount, type ListId } from "../people/queue";
import { isMine, matchesPerson } from "../people/rows";
import type { PersonRowOut } from "../people/types";
import { selectWork } from "./appointment-work";
import { workBase } from "./appointment-work-queries";
import { staleDealList } from "./audit-queries";
import { callQueueAll } from "./call-queries";
import { timed } from "./people-list-queries";
import { speedList } from "./speed-v2-queries";
import { ageWords } from "./today-queue";

// The ready-made lists of People (stage PEOPLE). Every list is read through the function its own page already uses (Speed to lead, Appointments, the call lists, Today's
// stale deals), so a list here and the number on that page are one definition (docs/METRICS.md, "People, call lists"). This file only turns each list's rows into
// people (name, phone, owner, tags, do not disturb, why) with ONE batched read of the contacts, and pages, searches and filters "Mine" the same way for all five.
// Every read is bound to `allowed` (the accounts the router decided from the signed session): the batch read joins to those accounts too, so a row whose contact is
// outside them cannot be returned even if a list function let one through. The answer is kept 45 seconds per installation, accounts and list.

/** A row before the owner's name and the link are added. `ownerLabel` is the owner's name when the list itself knew it (a lead whose contact is not in SubSync's copy yet). */
export type ListRow = Omit<PersonRowOut, "ownerName" | "url"> & { ownerLabel?: string };

type Args = { installationId: string; allowed: string[] | null; meId: string | null; staleDays: number; targetMinutes: number; now: number };
type Cut = { rows: ListRow[]; total: number; capped: boolean; withoutContact: number };

const CACHE_MS = 45_000;
const cache = ttlCache<Cut>(CACHE_MS, 200);
/** Forget an installation's lists (a call was logged, so the list that hides people called in the last hours must move at once). */
export const forgetPeopleLists = (installationId: string) => cache.clear(installationId + "|");

const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const allowedKey = (allowed: string[] | null) => (allowed ? hash([...allowed].sort().join(",")) : "all");
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const dayWords = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");

// ---------------- one batched read of the contacts behind a list ----------------

type Wanted = { locationId: string; contactId: string };

/** The people for these (account, contact) pairs, in the caller's accounts only. A pair that is not found (or is outside `allowed`) is simply absent. */
export async function hydratePeople(installationId: string, allowed: string[] | null, wanted: readonly Wanted[], tx?: Sql): Promise<Map<string, ListRow>> {
  const out = new Map<string, ListRow>();
  const uniq = [...new Map(wanted.map((w) => [personKey(w.locationId, w.contactId), w])).values()];
  const run = async (db: Sql) => {
    for (let at = 0; at < uniq.length; at += 500) {
      const part = uniq.slice(at, at + 500);
      const rows = await db`
        select c.contact_id, c.location_id, loc.name location_name, loc.timezone, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.email, c.phone, c.tags,
          c.source, nullif(c.assigned_to, '') owner, c.dnd, c.date_added, c.last_activity_at, lc.last_call_at, coalesce(lc.calls, 0) calls, lc.last_result
        from unnest(${part.map((w) => w.locationId)}::text[], ${part.map((w) => w.contactId)}::text[]) as k(location_id, contact_id)
        join cached_contacts c on c.installation_id = ${installationId} and c.location_id = k.location_id and c.contact_id = k.contact_id
        join locations loc on loc.installation_id = c.installation_id and loc.location_id = c.location_id and not loc.ignored
          ${allowed ? db`and loc.location_id = any(${allowed}::text[])` : db``}
        left join lateral (
          select max(o.created_at) last_call_at, count(*)::int calls, (array_agg(o.outcome order by o.created_at desc))[1] last_result
          from call_outcomes o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id) lc on true`;
      for (const r of rows) {
        out.set(personKey(r.location_id as string, r.contact_id as string), {
          rowId: personKey(r.location_id as string, r.contact_id as string), contactId: r.contact_id as string, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? null,
          name: r.name as string, email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null, tags: (r.tags as string[] | null) ?? [], source: (r.source as string | null) || null,
          owner: (r.owner as string | null) ?? null, dnd: r.dnd === true, timeZone: (r.timezone as string | null) ?? null, dateAdded: iso(r.date_added), lastActivityAt: iso(r.last_activity_at),
          lastCallAt: iso(r.last_call_at), calls: Number(r.calls ?? 0), lastResult: (r.last_result as string | null) ?? null, why: "", at: null, value: null,
        });
      }
    }
  };
  if (uniq.length === 0) return out;
  if (tx) await run(tx); else await timed(async (db) => { await run(db); });
  return out;
}

/** What the list itself knew about a person, used when the contact is not in SubSync's copy yet (a lead is counted before its contact has been copied). */
type Known = { name: string; phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; locationName: string | null; ownerLabel: string | null; source: string | null };
type Cand = { locationId: string; contactId: string; why: string; at: string | null; value: number | null; assignee?: string | null; rowId?: string; known?: Known };

/**
 * Candidates become people. A candidate whose contact is outside the caller's accounts is dropped (the batch read joins to those accounts). One whose contact is simply not
 * in the copy yet is kept from what its own list knew, when the list knew its account: a number and its list must count the same people (Speed to lead shows such a lead
 * as "Unnamed contact", and so does this).
 */
async function toPeople(a: Args, cands: readonly Cand[]): Promise<ListRow[]> {
  const people = await hydratePeople(a.installationId, a.allowed, cands);
  const inScope = a.allowed ? new Set(a.allowed) : null;
  const out: ListRow[] = [];
  for (const c of cands) {
    const p = people.get(personKey(c.locationId, c.contactId));
    if (p) { out.push({ ...p, rowId: c.rowId ?? p.rowId, why: c.why, at: c.at, value: c.value, assignee: c.assignee ?? null }); continue; }
    if (!c.known || (inScope && !inScope.has(c.locationId))) continue;
    const k = c.known;
    out.push({
      rowId: c.rowId ?? personKey(c.locationId, c.contactId), contactId: c.contactId, locationId: c.locationId, locationName: k.locationName, name: k.name, email: k.email, phone: k.phone, tags: [], source: k.source,
      owner: k.ownerLabel ? "unknown" : null, ownerLabel: k.ownerLabel ?? undefined, dnd: k.dnd, timeZone: k.timeZone, dateAdded: null, lastActivityAt: null, lastCallAt: null, calls: 0, lastResult: null,
      why: c.why, at: c.at, value: c.value, assignee: null,
    });
  }
  return out;
}

// ---------------- the four lists that are cut from one short read ----------------

async function noshows(a: Args): Promise<Cut> {
  const b = await workBase(a.installationId, a.allowed);
  const items = selectWork(b.items.filter((i) => i.kind === "recover"), "recover", { q: "", sort: "important", location: null, user: null, calendar: null });
  const withContact = items.filter((i) => i.contactId);
  const seen = new Set<string>();
  const cands: Cand[] = [];
  for (const i of withContact) {
    const k = personKey(i.locationId, i.contactId as string);
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push({ locationId: i.locationId, contactId: i.contactId as string, why: i.reason, at: new Date(i.at).toISOString(), value: i.value > 0 ? i.value : null, assignee: i.assignedKey === "unassigned" ? null : i.assignedKey,
      known: { name: i.name, phone: i.phone, email: i.email, dnd: i.dnd, timeZone: i.timeZone, locationName: i.locationName, ownerLabel: null, source: i.source } });
  }
  const rows = await toPeople(a, cands);
  return { rows, total: rows.length, capped: false, withoutContact: items.length - withContact.length };
}

async function called(a: Args, preset: "hot_uncontacted" | "follow_ups_due"): Promise<Cut> {
  const q = await callQueueAll(a.installationId, a.allowed, { preset });
  const cands: Cand[] = q.rows.map((r) => ({
    locationId: r.locationId, contactId: r.contactId, at: r.followUpAt,
    why: preset === "follow_ups_due" ? `Follow-up due ${dayWords(r.followUpAt)}`.trim() : `${r.openValue > 0 ? `Open deal ${money(r.openValue)}` : "Open deal"}, quiet for ${r.idleDays ?? 0} ${r.idleDays === 1 ? "day" : "days"}`,
    value: r.openValue > 0 ? r.openValue : null,
  }));
  const rows = await toPeople(a, cands);
  // The call list holds at most 400 candidates; a full one says "or more".
  return { rows, total: rows.length, capped: q.total >= 400, withoutContact: 0 };
}

async function liveIds(a: Args): Promise<string[]> {
  if (a.allowed) return a.allowed;
  const rows = await sql()`select location_id from locations where installation_id = ${a.installationId} and not ignored`;
  return rows.map((r) => r.location_id as string);
}

async function stale(a: Args): Promise<Cut> {
  const list = await staleDealList(a.installationId, await liveIds(a), a.staleDays);
  const withContact = list.rows.filter((r) => r.contactId);
  const cands: Cand[] = withContact.map((r) => ({
    locationId: r.locationId, contactId: r.contactId, why: r.detail, at: r.at, value: r.value, rowId: `${personKey(r.locationId, r.contactId)}:${r.id}`,
    known: { name: r.name, phone: null, email: null, dnd: false, timeZone: null, locationName: r.locationName, ownerLabel: null, source: null },
  }));
  const rows = await toPeople(a, cands);
  // The count is Today's: deals, not people (a person with two stale deals has two rows).
  return { rows, total: list.total, capped: list.total > list.rows.length, withoutContact: list.rows.length - withContact.length };
}

async function cutOf(list: Exclude<ListId, "waiting">, a: Args): Promise<Cut> {
  const key = `${a.installationId}|${allowedKey(a.allowed)}|${list}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = list === "noshows" ? await noshows(a) : list === "stale" ? await stale(a) : await called(a, list === "hot" ? "hot_uncontacted" : "follow_ups_due");
  cache.set(key, out);
  return out;
}

// ---------------- waiting: Speed to lead's own list, paged on the server ----------------

async function waiting(a: Args, o: { mine: boolean; q: string; page: number; size: number }) {
  const r = await speedList({
    installationId: a.installationId, allowed: a.allowed, targetMinutes: a.targetMinutes, now: a.now, meId: a.meId, status: "waiting", win: null, person: null, account: null,
    owner: o.mine ? "me" : null, noSource: false, week: null, q: o.q, sort: "wait", page: Math.max(0, o.page - 1), size: o.size,
  });
  const cands: Cand[] = r.rows.map((x) => ({
    locationId: x.locationId, contactId: x.contactId, at: new Date(a.now - x.minutes * 60_000).toISOString(), value: null,
    why: `${x.neverAnswered ? "Never answered, waiting" : "Waiting"} ${ageWords(x.minutes)}${x.source && x.source !== "No source recorded" ? ` · ${x.source}` : ""}`,
    known: { name: x.name, phone: x.phone, email: x.email, dnd: x.dnd, timeZone: x.timeZone, locationName: x.locationName, ownerLabel: x.unassigned ? null : x.owner?.label ?? null, source: x.source && x.source !== "No source recorded" ? x.source : null },
  }));
  return { rows: await toPeople(a, cands), total: r.total, pages: r.pages, page: r.page + 1, mineAvailable: r.facets.mine };
}

// ---------------- what the page asks for ----------------

export type QueuePage = { list: ListId; total: number; mineTotal: number | null; page: number; pages: number; from: number; to: number; capped: boolean; withoutContact: number; rows: ListRow[] };

/** One page of one list. `mine` keeps the people assigned to the asker; `q` keeps those matching the words. */
export async function peopleQueue(a: Args, o: { list: ListId; mine: boolean; q: string; page: number; size?: number }): Promise<QueuePage> {
  const size = Math.min(50, Math.max(1, Math.floor(o.size ?? QUEUE_PAGE)));
  if (o.list === "waiting") {
    const w = await waiting(a, { mine: o.mine, q: o.q, page: Math.max(1, Math.floor(o.page) || 1), size });
    const from = w.total === 0 ? 0 : (w.page - 1) * size + 1;
    return { list: "waiting", total: w.total, mineTotal: a.meId ? w.mineAvailable : null, page: w.page, pages: w.pages, from, to: from === 0 ? 0 : from + w.rows.length - 1, capped: false, withoutContact: 0, rows: w.rows };
  }
  const cut = await cutOf(o.list, a);
  const mineAll = a.meId ? cut.rows.filter((p) => isMine(p, a.meId)) : [];
  let rows = o.mine ? mineAll : cut.rows;
  if (o.q.trim()) rows = rows.filter((p) => matchesPerson(p, o.q));
  const pg = pageOf(rows, o.page, size);
  return { list: o.list, total: pg.total, mineTotal: a.meId ? mineAll.length : null, page: pg.page, pages: pg.pages, from: pg.from, to: pg.to, capped: cut.capped, withoutContact: cut.withoutContact, rows: pg.rows };
}

/** The five counts for the chips (and for "Mine"). The same reads as the pages, so a chip and its list cannot disagree. */
export async function peopleCounts(a: Args): Promise<{ counts: ListCount[]; capped: Partial<Record<ListId, boolean>> }> {
  const caps: Partial<Record<ListId, boolean>> = {};
  const counts = await Promise.all(LIST_IDS.map(async (id): Promise<ListCount> => {
    if (id === "waiting") {
      const all = await speedList({ installationId: a.installationId, allowed: a.allowed, targetMinutes: a.targetMinutes, now: a.now, meId: a.meId, status: "waiting", win: null, person: null, account: null, owner: null, noSource: false, week: null, q: "", sort: "wait", page: 0, size: 1 });
      return { id, total: all.total, mine: a.meId ? all.facets.mine : null };
    }
    const cut = await cutOf(id, a);
    caps[id] = cut.capped;
    return { id, total: cut.total, mine: a.meId ? cut.rows.filter((p) => isMine(p, a.meId)).length : null };
  }));
  return { counts, capped: caps };
}
