import { sql, type Sql } from "../db";
import { CONTACT_PREDICATE } from "../cleanup/cu-core";
import { protectedReason, type ProtectReason } from "../cleanup/cu-core";
import {
  badgeOf, MAX_SHARED, MAX_SHARED_NAME, NAME_TOKENS_SQL, NEVER_EMAIL, NEVER_PHONE, SRC_KEY_SQL, TIER_RANK, ZERO, components, decodeCur, encodeCur, intakeAlerts, pairId, qualityOf, zeroFill,
  type DayCount, type EdgeKind, type IntakeAlert, type Quality, type RawGroup, type SrcCounts, type Tier, BASELINE_DAYS, RECENT_DAYS,
} from "../dq/dq-core";
import { groupKey } from "./dedupe";
import { DIFFERENT_NAMES_WHY, effectiveTier, loweredGroups, namesConflict, withNameNote } from "../dq/dupe-tier";

// Clean-up v2 (stage DQ): every read and write of the duplicate groups, the lead-intake record, the quality score and the history. It reads the contact, appointment, message-event and deal copies
// SubSync already holds; nothing here talks to the CRM. Every query filters by the installation AND by the accounts the caller may see (`allowed`, null = all of that installation's).
// SQL text comes only from constants in dq-core.ts / cu-core.ts: nothing a person typed is put into SQL text. Duplicate detection uses BLOCKING KEYS (an exact email, the last ten phone digits,
// a name key), grouped in the database and joined in memory: never a comparison of every pair.

type Db = Sql;
export type Scope = { inst: string; allowed: string[] | null; location: string | null };
const scopeOf = (db: Db, alias: string, allowed: string[] | null) => (allowed ? db`and ${db.unsafe(alias)}.location_id = any(${allowed}::text[])` : db``);
const locOf = (db: Db, alias: string, location: string | null) => (location ? db`and ${db.unsafe(alias)}.location_id = ${location}` : db``);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);
const TODAY = "(now() at time zone 'UTC')::date";

// ------------------------------------------------------------------------------------------------ duplicate scan (blocking keys)
const EM = "lower(btrim(c.email))";
const GROUP_CAP = 20_000;

async function candidateGroups(inst: string, loc: string): Promise<RawGroup[]> {
  const db = sql();
  const run = async (kind: RawGroup["kind"], q: Promise<Array<Record<string, unknown>>>): Promise<RawGroup[]> => (await q).map((r) => ({ kind, ids: r.ids as string[] }));
  const base = db`from cached_contacts c where c.installation_id = ${inst} and c.location_id = ${loc}`;
  const [email, phone, namePhone, nameEmail, name] = await Promise.all([
    run("email", db`select array_agg(c.contact_id order by c.date_added nulls last, c.contact_id) ids ${base} and coalesce(c.email, '') <> '' and ${db.unsafe(EM)} !~ ${NEVER_EMAIL}
      group by ${db.unsafe(EM)} having count(*) between 2 and ${MAX_SHARED} limit ${GROUP_CAP}`),
    run("phone", db`select array_agg(c.contact_id order by c.date_added nulls last, c.contact_id) ids ${base} and length(c.phone_digits) >= 10 and right(c.phone_digits, 10) !~ ${NEVER_PHONE}
      group by right(c.phone_digits, 10) having count(*) between 2 and ${MAX_SHARED} limit ${GROUP_CAP}`),
    run("name_phone", db`select array_agg(c.contact_id order by c.date_added nulls last, c.contact_id) ids ${base} and length(btrim(c.full_name)) >= 5 and btrim(c.full_name) like '% %' and length(c.phone_digits) >= 7
      and right(c.phone_digits, 7) !~ ${NEVER_PHONE} group by lower(btrim(c.full_name)), right(c.phone_digits, 7) having count(*) between 2 and ${MAX_SHARED_NAME} limit ${GROUP_CAP}`),
    run("name_email", db`select array_agg(c.contact_id order by c.date_added nulls last, c.contact_id) ids ${base} and length(btrim(c.full_name)) >= 5 and btrim(c.full_name) like '% %' and coalesce(c.email, '') like '_%@%'
      and length(split_part(${db.unsafe(EM)}, '@', 1)) >= 4 and ${db.unsafe(EM)} !~ ${NEVER_EMAIL} group by lower(btrim(c.full_name)), split_part(${db.unsafe(EM)}, '@', 1) having count(*) between 2 and ${MAX_SHARED_NAME} limit ${GROUP_CAP}`),
    // Name only: the same words in any order, and the records do not disagree on email or phone (two different emails AND two different phones means two different people).
    run("name", db`select array_agg(c.contact_id order by c.date_added nulls last, c.contact_id) ids from (select c.*, ${db.unsafe(NAME_TOKENS_SQL)} nk from cached_contacts c where c.installation_id = ${inst} and c.location_id = ${loc} and length(btrim(coalesce(c.full_name, ''))) >= 8) c
      where c.nk is not null and c.nk like '% %' and length(c.nk) >= 8 and c.nk !~ '^(test|testing|demo|sample|fake|dummy|unknown)( |$)' group by c.nk having count(*) between 2 and ${MAX_SHARED_NAME}
        and count(distinct ${db.unsafe(EM)}) filter (where coalesce(c.email, '') <> '') <= 1 and count(distinct right(c.phone_digits, 10)) filter (where length(c.phone_digits) >= 10) <= 1 limit ${GROUP_CAP}`),
  ]);
  return [...email, ...phone, ...namePhone, ...nameEmail, ...name];
}

/** The pairs a person already said are NOT the same, and the keys of groups already decided, for one account. */
async function decided(inst: string, loc: string): Promise<{ rejected: Set<string>; keys: Set<string> }> {
  const rows = await sql()`select group_key, decision, snapshot from duplicate_reviews where installation_id = ${inst} and location_id = ${loc} order by decided_at desc limit 5000`.catch(() => []);
  const rejected = new Set<string>(), keys = new Set<string>();
  for (const r of rows) {
    keys.add(r.group_key as string);
    if (r.decision !== "not_duplicate") continue;
    const ids = ((r.snapshot as { contacts?: Array<{ contact_id?: unknown }> } | null)?.contacts ?? []).map((c) => String(c.contact_id)).slice(0, 12);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) rejected.add(pairId(ids[i], ids[j]));
  }
  return { rejected, keys };
}

export type ScanGroups = { groups: number; extra: number; byTier: Record<Tier, number>; added: number };
/** Rebuilds one account's duplicate groups. The groups table holds ids and a tier only. New groups are written to the history (up to 200 per run, then one summary line). */
export async function scanGroups(inst: string, loc: string): Promise<ScanGroups> {
  const db = sql();
  const raw = await candidateGroups(inst, loc);
  const { rejected, keys } = await decided(inst, loc);
  const found = components(raw, { rejected }).filter((g) => !keys.has(groupKey(g.ids))).slice(0, GROUP_CAP);
  // A shared email or phone is only "certain" when the names agree: otherwise the group is "likely" (shared mailbox, household).
  const certainIds = [...new Set(found.filter((g) => g.tier === "certain").flatMap((g) => g.ids))];
  const nameOf = new Map<string, string | null>();
  for (let i = 0; i < certainIds.length; i += 2000) {
    const rs = await db`select contact_id, full_name from cached_contacts where installation_id = ${inst} and location_id = ${loc} and contact_id = any(${certainIds.slice(i, i + 2000)}::text[])`;
    for (const r of rs) nameOf.set(r.contact_id as string, (r.full_name as string | null) ?? null);
  }
  for (const g of found) if (g.tier === "certain") { const t = effectiveTier("certain", g.ids.map((id) => nameOf.get(id))); if (t !== "certain") g.tier = t; }
  const rows = found.map((g) => ({ installation_id: inst, location_id: loc, group_key: groupKey(g.ids), tier: g.tier, tier_rank: TIER_RANK[g.tier], kinds: g.kinds, contact_ids: g.ids, size: g.ids.length, trimmed: g.trimmed }));
  let added = 0;
  await db.begin(async (tx) => {
    const old = await tx`select group_key from dq_groups where installation_id = ${inst} and location_id = ${loc}`;
    const had = new Set(old.map((r) => r.group_key as string));
    const now = new Set(rows.map((r) => r.group_key));
    const gone = [...had].filter((k) => !now.has(k));
    for (let i = 0; i < gone.length; i += 1000) await tx`delete from dq_groups where installation_id = ${inst} and location_id = ${loc} and group_key = any(${gone.slice(i, i + 1000)}::text[])`;
    for (let i = 0; i < rows.length; i += 400) {
      await tx`insert into dq_groups ${tx(rows.slice(i, i + 400), "installation_id", "location_id", "group_key", "tier", "tier_rank", "kinds", "contact_ids", "size", "trimmed")}
        on conflict (installation_id, location_id, group_key) do update set tier = excluded.tier, tier_rank = excluded.tier_rank, kinds = excluded.kinds, contact_ids = excluded.contact_ids, size = excluded.size, trimmed = excluded.trimmed, seen_at = now()`;
    }
    const fresh = rows.filter((r) => !had.has(r.group_key));
    added = fresh.length;
    const ev = fresh.slice(0, 200).map((r) => ({ installation_id: inst, location_id: loc, kind: "dup_found", ref: r.group_key, detail: tx.json({ tier: r.tier, size: r.size, kinds: r.kinds } as never) }));
    for (let i = 0; i < ev.length; i += 200) await tx`insert into dq_events ${tx(ev.slice(i, i + 200), "installation_id", "location_id", "kind", "ref", "detail")}`;
    if (fresh.length > 200 || gone.length > 0) await tx`insert into dq_events (installation_id, location_id, kind, detail) values (${inst}, ${loc}, 'scan', ${tx.json({ added: fresh.length, resolved: gone.length, open: rows.length } as never)})`;
  });
  const byTier = { certain: 0, likely: 0, possible: 0 } as Record<Tier, number>;
  for (const g of found) byTier[g.tier]++;
  return { groups: found.length, extra: found.reduce((s, g) => s + g.ids.length - 1, 0), byTier, added };
}

// ------------------------------------------------------------------------------------------------ duplicate lists
const OPEN_SQL = (db: Db) => db`and not exists (select 1 from duplicate_reviews r where r.installation_id = g.installation_id and r.location_id = g.location_id and r.group_key = g.group_key)`;

export type TierCounts = Record<Tier, { groups: number; extra: number }>;

/** The read-time name rule, applied ONCE to the stored groups so the tab counts, each tab's rows, the headline split and the bulk merge all read the same stored tier (counts equal rows).
 *  A stored-"certain" open group whose names clearly differ (a shared mailbox) becomes "likely" now, instead of waiting for the nightly scan. Our own table only; the CRM is never touched.
 *  The database first keeps only groups with two or more different written names (cheap); the nickname-aware rule in dupe-tier.ts then decides. Capped per call; the next call continues. */
const HEAL_CAP = 2000;
const HEAL_EVERY_MS = 15_000; // one set-based pass per view and quarter minute: the stored tier is then read by every count and list
const healedAt = new Map<string, number>();
async function healTiers(s: Scope): Promise<void> {
  const k = `${s.inst}|${s.location ?? ""}|${(s.allowed ?? []).join(",")}`;
  const now = Date.now();
  if (now - (healedAt.get(k) ?? 0) < HEAL_EVERY_MS) return;
  if (healedAt.size > 500) healedAt.clear();
  healedAt.set(k, now);
  const db = sql();
  const rows = await db`select g.location_id, g.group_key, g.size, array_agg(c.full_name) names
    from dq_groups g join locations l on l.installation_id = g.installation_id and l.location_id = g.location_id and not l.ignored
      cross join lateral unnest(g.contact_ids) as u(cid)
      join cached_contacts c on c.installation_id = g.installation_id and c.location_id = g.location_id and c.contact_id = u.cid
    where g.installation_id = ${s.inst} and g.tier = 'certain' ${scopeOf(db, "g", s.allowed)} ${locOf(db, "g", s.location)} ${OPEN_SQL(db)}
    group by g.location_id, g.group_key, g.size
    having count(distinct lower(btrim(c.full_name))) filter (where btrim(coalesce(c.full_name, '')) <> '') > 1
    limit ${HEAL_CAP}`;
  const low = [...loweredGroups(rows.map((r) => ({ loc: r.location_id as string, key: r.group_key as string, size: r.size as number, names: (r.names as Array<string | null> | null) ?? [] }))).keys()].map((k) => k.split("\u0000"));
  if (low.length === 0) return;
  await db`update dq_groups g set tier = 'likely', tier_rank = ${TIER_RANK.likely}
    from unnest(${low.map((p) => p[0])}::text[], ${low.map((p) => p[1])}::text[]) w(l, k)
    where g.installation_id = ${s.inst} and g.tier = 'certain' and g.location_id = w.l and g.group_key = w.k`;
}

export async function tierCounts(s: Scope): Promise<TierCounts> {
  await healTiers(s);
  const db = sql();
  const rows = await db`select g.tier, count(*)::int groups, coalesce(sum(g.size - 1), 0)::int extra from dq_groups g join locations l on l.installation_id = g.installation_id and l.location_id = g.location_id and not l.ignored
    where g.installation_id = ${s.inst} ${scopeOf(db, "g", s.allowed)} ${locOf(db, "g", s.location)} ${OPEN_SQL(db)} group by g.tier`;
  const out: TierCounts = { certain: { groups: 0, extra: 0 }, likely: { groups: 0, extra: 0 }, possible: { groups: 0, extra: 0 } };
  for (const r of rows) out[r.tier as Tier] = { groups: r.groups as number, extra: r.extra as number };
  return out;
}

export type GroupPerson = { contactId: string; name: string; email: string | null; phone: string | null; owner: string | null; source: string | null; createdAt: string | null; dnd: boolean; protect: ProtectReason | null; openDeals: number };
export type GroupRow = { key: string; nameNote?: string | null; locationId: string; locationName: string | null; tier: Tier; badge: string; kinds: string[]; trimmed: boolean; shared: string | null; people: GroupPerson[]; protectedCount: number };

async function peopleOf(inst: string, pairs: Array<{ loc: string; id: string }>): Promise<Map<string, GroupPerson>> {
  const out = new Map<string, GroupPerson>();
  if (pairs.length === 0) return out;
  const db = sql();
  const rows = await db`
    select c.location_id, c.contact_id, c.full_name, c.email, c.phone, c.assigned_to, c.source, c.date_added, c.dnd,
      (select count(*)::int from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open') open_deals,
      exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and a.start_at > now()
        and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'noshow', 'no_show', 'invalid')) upcoming
    from cached_contacts c join unnest(${pairs.map((p) => p.loc)}::text[], ${pairs.map((p) => p.id)}::text[]) as w(l, i) on w.l = c.location_id and w.i = c.contact_id
    where c.installation_id = ${inst}`;
  for (const r of rows) {
    out.set(`${r.location_id}:${r.contact_id}`, {
      contactId: r.contact_id as string, name: ((r.full_name as string | null)?.trim() || (r.email as string | null) || "Unnamed contact"), email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null,
      owner: (r.assigned_to as string | null) || null, source: (r.source as string | null) || null, createdAt: iso(r.date_added), dnd: r.dnd === true, openDeals: r.open_deals as number,
      protect: protectedReason({ dnd: r.dnd === true, openDeals: r.open_deals as number, upcomingAppointments: r.upcoming === true ? 1 : 0 }),
    });
  }
  return out;
}

const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
function sharedValue(kinds: string[], people: GroupPerson[]): string | null {
  if (kinds.includes("phone")) { const m = new Map<string, number>(); for (const p of people) { const d = digits(p.phone).slice(-10); if (d.length >= 10) m.set(d, (m.get(d) ?? 0) + 1); } const top = [...m].sort((a, b) => b[1] - a[1])[0]; const hit = top && people.find((p) => digits(p.phone).slice(-10) === top[0]); if (hit?.phone) return hit.phone; }
  if (kinds.includes("email")) { const m = new Map<string, number>(); for (const p of people) { const e = (p.email ?? "").trim().toLowerCase(); if (e) m.set(e, (m.get(e) ?? 0) + 1); } const top = [...m].sort((a, b) => b[1] - a[1])[0]; if (top && top[1] > 1) return top[0]; }
  return people[0]?.name ?? null;
}

export type GroupPage = { rows: GroupRow[]; next: string | null };
/** One keyset page of open groups of one tier, with their people. The cursor is (account, key), never an offset. */
export async function listGroups(s: Scope, tier: Tier, after: Array<string | number> | null, limit = 25): Promise<GroupPage> {
  const db = sql();
  const lim = Math.min(Math.max(1, limit), 100);
  if (!after && tier !== "possible") await healTiers(s); // same read-time rule as the tab counts: a mixed-name group is listed under Likely, never under Certain
  const rows = await db`select g.location_id, g.group_key, g.tier, g.kinds, g.contact_ids, g.trimmed, l.name loc_name
    from dq_groups g join locations l on l.installation_id = g.installation_id and l.location_id = g.location_id and not l.ignored
    where g.installation_id = ${s.inst} and g.tier = ${tier} ${scopeOf(db, "g", s.allowed)} ${locOf(db, "g", s.location)} ${OPEN_SQL(db)}
      ${after ? db`and (g.location_id, g.group_key) > (${String(after[0])}, ${String(after[1])})` : db``}
    order by g.location_id, g.group_key limit ${lim + 1}`;
  const page = rows.slice(0, lim);
  const people = await peopleOf(s.inst, page.flatMap((r) => (r.contact_ids as string[]).map((id) => ({ loc: r.location_id as string, id }))));
  const out: GroupRow[] = [];
  for (const r of page) {
    const ps = (r.contact_ids as string[]).map((id) => people.get(`${r.location_id}:${id}`)).filter((p): p is GroupPerson => !!p);
    if (ps.length < 2) continue; // a contact was removed since the scan: the next scan drops the group
    const kinds = r.kinds as string[];
    const lowered = tier === "certain" && namesConflict(ps.map((p) => p.name)); // fallback only: the heal above already moved these (cap or a name edited a moment ago)
    out.push({ key: r.group_key as string, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, tier: lowered ? "likely" : tier, nameNote: lowered || (tier === "likely" && kinds.some((k) => k === "email" || k === "phone") && namesConflict(ps.map((p) => p.name))) ? DIFFERENT_NAMES_WHY : null, badge: lowered || (tier === "likely" && kinds.some((k) => k === "email" || k === "phone") && namesConflict(ps.map((p) => p.name))) ? withNameNote(badgeOf(kinds as EdgeKind[])) : badgeOf(kinds as EdgeKind[]), kinds, trimmed: r.trimmed === true, shared: sharedValue(kinds, ps), people: ps, protectedCount: ps.filter((p) => p.protect).length });
  }
  const last = page[page.length - 1];
  return { rows: out, next: rows.length > lim && last ? encodeCur([last.location_id as string, last.group_key as string]) : null };
}

/** The "certain" groups for the bulk merge preview. Capped. By default nobody protected is in them; with includeProtected every group comes back so the preview can say why it skipped it. */
export async function certainSafe(s: Scope, cap: number, includeProtected = false): Promise<GroupRow[]> {
  const out: GroupRow[] = [];
  let after: Array<string | number> | null = null;
  for (let n = 0; n < 12 && out.length < cap; n++) {
    const p = await listGroups(s, "certain", after, 50);
    const certain = p.rows.filter((r) => r.tier === "certain"); // a group lowered to "likely" for different names is never in the bulk merge
    out.push(...(includeProtected ? certain : certain.filter((r) => r.protectedCount === 0 && !r.trimmed)));
    after = p.next ? decodeCur(p.next, 2) : null;
    if (!after) break;
  }
  return out.slice(0, cap);
}

export async function logEvent(inst: string, loc: string | null, kind: string, ref: string | null, detail: Record<string, unknown>, actor: string | null): Promise<void> {
  const db = sql();
  await db`insert into dq_events (installation_id, location_id, kind, ref, detail, actor) values (${inst}, ${loc}, ${kind}, ${ref}, ${db.json(detail as never)}, ${actor})`;
}

export type EventRow = { id: number; at: string; location: string | null; kind: string; ref: string | null; detail: Record<string, unknown>; actor: string | null };
export async function listEvents(s: Scope, after: number | null, limit = 30): Promise<{ rows: EventRow[]; next: number | null }> {
  const db = sql();
  const rows = await db`select e.id, e.created_at, e.kind, e.ref, e.detail, e.actor, l.name loc_name from dq_events e left join locations l on l.installation_id = e.installation_id and l.location_id = e.location_id
    where e.installation_id = ${s.inst} ${s.allowed ? db`and e.location_id = any(${s.allowed}::text[])` : db``} ${locOf(db, "e", s.location)} ${after ? db`and e.id < ${after}` : db``}
      and e.kind <> 'dup_found' order by e.id desc limit ${limit + 1}`;
  const page = rows.slice(0, limit);
  return { rows: page.map((r) => ({ id: Number(r.id), at: iso(r.created_at) as string, location: (r.loc_name as string | null) ?? null, kind: r.kind as string, ref: (r.ref as string | null) ?? null, detail: (r.detail as Record<string, unknown>) ?? {}, actor: (r.actor as string | null) ?? null })), next: rows.length > limit ? Number(page[page.length - 1].id) : null };
}

// ------------------------------------------------------------------------------------------------ lead intake: the shared definitions
const T = (extra: string) => `t.installation_id = c.installation_id and t.location_id = c.location_id and t.contact_id = c.contact_id ${extra}`;
const NEWER_THAN = "(o.date_added < c.date_added or (o.date_added = c.date_added and o.contact_id < c.contact_id))";
export const LEAD_SQL = {
  /** An earlier contact in the same account has the same email or the same last ten phone digits. */
  // Two separate EXISTS (one per blocking key) so each is a probe of its own partial index, never a scan of the account.
  dup: `((coalesce(c.email, '') <> '' and lower(btrim(c.email)) !~ '${NEVER_EMAIL}' and exists (select 1 from cached_contacts o where o.installation_id = c.installation_id and o.location_id = c.location_id
      and coalesce(o.email, '') <> '' and lower(btrim(o.email)) = lower(btrim(c.email)) and o.contact_id <> c.contact_id and ${NEWER_THAN}))
    or (length(c.phone_digits) >= 10 and right(c.phone_digits, 10) !~ '${NEVER_PHONE}' and exists (select 1 from cached_contacts o where o.installation_id = c.installation_id and o.location_id = c.location_id
      and length(o.phone_digits) >= 10 and right(o.phone_digits, 10) = right(c.phone_digits, 10) and o.contact_id <> c.contact_id and ${NEWER_THAN})))`,
  junk: CONTACT_PREDICATE.junk,
  answered: `exists (select 1 from touch_events t where ${T("and t.direction = 'outbound' and not t.automated and t.at >= c.date_added")})`,
  booked: `exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and lower(coalesce(a.status, '')) <> 'invalid')`,
  showed: `exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and lower(coalesce(a.status, '')) = 'showed')`,
  won: `exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'won')`,
  wonValue: `coalesce((select sum(o.monetary_value) from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'won'), 0)`,
  touchSecs: `(select extract(epoch from min(t.at) - c.date_added) from touch_events t where ${T("and t.direction = 'outbound' and not t.automated and t.at >= c.date_added")})`,
} as const;
export type LeadFlag = "all" | "ok" | "dup" | "junk" | "clean" | "answered" | "waiting" | "booked" | "showed" | "won";
export const LEAD_FLAGS: readonly LeadFlag[] = ["all", "ok", "dup", "junk", "clean", "answered", "waiting", "booked", "showed", "won"];
export const isLeadFlag = (v: unknown): v is LeadFlag => typeof v === "string" && (LEAD_FLAGS as readonly string[]).includes(v);
const FLAG_WHERE: Record<LeadFlag, string> = {
  all: "true", ok: `(not ${LEAD_SQL.dup} and not ${LEAD_SQL.junk})`, dup: LEAD_SQL.dup, junk: `(${LEAD_SQL.junk} and not ${LEAD_SQL.dup})`, clean: `(not ${LEAD_SQL.dup} and not ${LEAD_SQL.junk} and ${LEAD_SQL.answered})`, answered: LEAD_SQL.answered,
  waiting: `(not ${LEAD_SQL.dup} and not ${LEAD_SQL.junk} and not ${LEAD_SQL.answered})`, booked: LEAD_SQL.booked, showed: LEAD_SQL.showed, won: LEAD_SQL.won,
};
export const FLAG_LABEL: Record<LeadFlag, string> = { all: "All leads", ok: "Clean leads", dup: "Duplicates", junk: "Junk", clean: "Good leads", answered: "Answered", waiting: "Waiting for a first touch", booked: "Booked", showed: "Showed up", won: "Won" };

/** Rebuilds the daily counts of one account for the last `days` days (by the UTC day a contact was created). Idempotent: the same window written twice gives the same rows. */
export async function recomputeSourceDaily(inst: string, loc: string, days: number): Promise<number> {
  const db = sql();
  const d = Math.min(120, Math.max(1, Math.floor(days)));
  const rows = await db`
    with w as (
      select (c.date_added at time zone 'UTC')::date as day, ${db.unsafe(SRC_KEY_SQL)} as src, left(btrim(coalesce(c.source, '')), 60) label,
        ${db.unsafe(LEAD_SQL.dup)} is_dup, ${db.unsafe(LEAD_SQL.junk)} is_junk, ${db.unsafe(LEAD_SQL.answered)} ans, ${db.unsafe(LEAD_SQL.booked)} bk, ${db.unsafe(LEAD_SQL.showed)} sh,
        ${db.unsafe(LEAD_SQL.won)} wn, ${db.unsafe(LEAD_SQL.wonValue)} wv, ${db.unsafe(LEAD_SQL.touchSecs)} ts
      from cached_contacts c where c.installation_id = ${inst} and c.location_id = ${loc} and c.date_added is not null and c.date_added >= (${db.unsafe(TODAY)} - ${d - 1}::int)::timestamp at time zone 'UTC')
    select day, src, coalesce(nullif(max(label), ''), 'No source') label, count(*)::int leads, count(*) filter (where is_dup)::int dups, count(*) filter (where is_junk and not is_dup)::int junk, count(*) filter (where ans)::int answered,
      count(*) filter (where not is_dup and not is_junk and ans)::int quality, count(*) filter (where bk)::int booked, count(*) filter (where sh)::int showed, count(*) filter (where wn)::int won,
      coalesce(sum(wv), 0)::float8 won_value, coalesce(sum(ts) filter (where ts is not null), 0)::bigint touch_secs, count(ts)::int touched
    from w group by day, src`;
  const out = rows.map((r) => ({ installation_id: inst, location_id: loc, day: r.day, src: r.src as string, label: r.label as string, leads: r.leads, dups: r.dups, junk: r.junk, answered: r.answered, quality: r.quality, booked: r.booked, showed: r.showed, won: r.won, won_value: r.won_value, touch_secs: Number(r.touch_secs), touched: r.touched }));
  await db.begin(async (tx) => {
    await tx`delete from dq_source_daily where installation_id = ${inst} and location_id = ${loc} and day >= ${db.unsafe(TODAY)} - ${d - 1}::int`;
    for (let i = 0; i < out.length; i += 300) await tx`insert into dq_source_daily ${tx(out.slice(i, i + 300), "installation_id", "location_id", "day", "src", "label", "leads", "dups", "junk", "answered", "quality", "booked", "showed", "won", "won_value", "touch_secs", "touched")}`;
  });
  return out.reduce((s, r) => s + r.leads, 0);
}

// ------------------------------------------------------------------------------------------------ lead intake: reading
export type SourceAgg = { key: string; label: string } & SrcCounts;
const sumCols = (db: Db) => db`sum(d.leads)::int leads, sum(d.dups)::int dups, sum(d.junk)::int junk, sum(d.answered)::int answered, sum(d.quality)::int quality, sum(d.booked)::int booked, sum(d.showed)::int showed, sum(d.won)::int won, sum(d.won_value)::float8 won_value, sum(d.touch_secs)::bigint touch_secs, sum(d.touched)::int touched`;
const countsOf = (r: Record<string, unknown>): SrcCounts => ({ ...ZERO, leads: Number(r.leads), dups: Number(r.dups), junk: Number(r.junk), answered: Number(r.answered), quality: Number(r.quality), booked: Number(r.booked), showed: Number(r.showed), won: Number(r.won), wonValue: Number(r.won_value), touchSecs: Number(r.touch_secs), touched: Number(r.touched) });
const dayFilter = (db: Db, days: number) => db`d.day >= ${db.unsafe(TODAY)} - ${Math.max(1, days) - 1}::int`;

/** Every source's totals over the window, biggest first, added across the accounts in scope. */
export async function sourcesRollup(s: Scope, days: number, limit = 200): Promise<SourceAgg[]> {
  const db = sql();
  const rows = await db`select d.src, (array_agg(d.label order by d.day desc, d.leads desc))[1] label, ${sumCols(db)}
    from dq_source_daily d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id and not l.ignored
    where d.installation_id = ${s.inst} and ${dayFilter(db, days)} ${scopeOf(db, "d", s.allowed)} ${locOf(db, "d", s.location)} group by d.src order by sum(d.leads) desc, d.src limit ${limit}`;
  return rows.map((r) => ({ key: r.src as string, label: r.label as string, ...countsOf(r) }));
}
export async function sourceDays(s: Scope, days: number, key: string | null): Promise<DayCount[]> {
  const db = sql();
  const rows = await db`select d.day, sum(d.leads)::int leads, sum(d.dups)::int dups, sum(d.junk)::int junk from dq_source_daily d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id and not l.ignored
    where d.installation_id = ${s.inst} and ${dayFilter(db, days)} ${key ? db`and d.src = ${key}` : db``} ${scopeOf(db, "d", s.allowed)} ${locOf(db, "d", s.location)} group by d.day order by d.day`;
  return rows.map((r) => ({ day: new Date(r.day as string).toISOString().slice(0, 10), leads: r.leads as number, dups: r.dups as number, junk: r.junk as number }));
}
export async function sourceByAccount(s: Scope, days: number, key: string, limit = 12): Promise<Array<{ locationId: string; name: string | null } & SrcCounts>> {
  const db = sql();
  const rows = await db`select d.location_id, l.name, ${sumCols(db)} from dq_source_daily d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id and not l.ignored
    where d.installation_id = ${s.inst} and d.src = ${key} and ${dayFilter(db, days)} ${scopeOf(db, "d", s.allowed)} ${locOf(db, "d", s.location)} group by d.location_id, l.name order by sum(d.leads) desc limit ${limit}`;
  return rows.map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? null, ...countsOf(r) }));
}
/** When the intake record was last rebuilt for the accounts in scope. */
export async function intakeAsOf(s: Scope): Promise<string | null> {
  const db = sql();
  const [r] = await db`select max(d.taken_at) at from dq_source_daily d where d.installation_id = ${s.inst} ${scopeOf(db, "d", s.allowed)} ${locOf(db, "d", s.location)}`;
  return iso(r?.at);
}

export type LeadRow = { contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; owner: string | null; source: string | null; createdAt: string | null; dnd: boolean; flags: Array<"duplicate" | "junk" | "answered" | "booked" | "won"> };
type LeadFilter = { src: string | null; flag: LeadFlag; days: number; form?: { kind: "form" | "survey"; id: string } | null };
/** The one WHERE of every lead list and count: the same window, source, form and definition, so a number and its rows are the same set. */
const leadWhere = (db: Db, s: Scope, f: LeadFilter) => db`c.installation_id = ${s.inst} ${scopeOf(db, "c", s.allowed)} ${locOf(db, "c", s.location)} and c.date_added is not null
  ${f.form ? db`and exists (select 1 from dq_submissions x where x.installation_id = c.installation_id and x.location_id = c.location_id and x.kind = ${f.form.kind} and x.ext_id = ${f.form.id} and x.contact_id = c.contact_id and x.submitted_at >= now() - ${Math.max(1, f.days)}::int * interval '1 day')` : db`and c.date_added >= (${db.unsafe(TODAY)} - ${Math.max(1, f.days) - 1}::int)::timestamp at time zone 'UTC'`}
  ${f.src ? db`and ${db.unsafe(SRC_KEY_SQL)} = ${f.src}` : db``} and ${db.unsafe(FLAG_WHERE[f.flag])}`;
/** One keyset page of the leads behind a number: the same window, source and definition as the rollup, so a count opens exactly its rows. */
export async function listLeads(s: Scope, f: LeadFilter, after: Array<string | number> | null, limit = 25): Promise<{ rows: LeadRow[]; next: string | null }> {
  const db = sql();
  const lim = Math.min(100, Math.max(1, limit));
  const rows = await db`select c.location_id, c.contact_id, c.full_name, c.email, c.phone, c.assigned_to, c.source, c.date_added, c.dnd, l.name loc_name,
      ${db.unsafe(LEAD_SQL.dup)} is_dup, ${db.unsafe(LEAD_SQL.junk)} is_junk, ${db.unsafe(LEAD_SQL.answered)} ans, ${db.unsafe(LEAD_SQL.booked)} bk, ${db.unsafe(LEAD_SQL.won)} wn
    from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where ${leadWhere(db, s, f)}
      ${after ? db`and (c.date_added, c.location_id, c.contact_id) < (${String(after[0])}::timestamptz, ${String(after[1])}, ${String(after[2])})` : db``}
    order by c.date_added desc, c.location_id desc, c.contact_id desc limit ${lim + 1}`;
  const page = rows.slice(0, lim);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({ contactId: r.contact_id as string, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, name: ((r.full_name as string | null)?.trim() || (r.email as string | null) || "Unnamed contact"), email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null,
      owner: (r.assigned_to as string | null) || null, source: (r.source as string | null) || null, createdAt: iso(r.date_added), dnd: r.dnd === true,
      flags: ([r.is_dup === true && "duplicate", r.is_junk === true && "junk", r.ans === true && "answered", r.bk === true && "booked", r.wn === true && "won"].filter(Boolean)) as LeadRow["flags"] })),
    next: rows.length > lim && last ? encodeCur([iso(last.date_added) as string, last.location_id as string, last.contact_id as string]) : null,
  };
}
export async function countLeads(s: Scope, f: LeadFilter, cap = 10_000): Promise<{ n: number; capped: boolean }> {
  const db = sql();
  const [r] = await db`select count(*)::int n from (select 1 from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where ${leadWhere(db, s, f)} limit ${cap + 1}) x`;
  const n = (r?.n as number) ?? 0;
  return { n: Math.min(n, cap), capped: n > cap };
}

// ------------------------------------------------------------------------------------------------ forms, surveys and funnels
export type FormAgg = { kind: "form" | "survey"; id: string; name: string; locationId: string; locationName: string | null; submissions: number; people: number; repeat: number; dups: number; junk: number; answered: number; booked: number; won: number; wonValue: number; lastAt: string | null; first: string | null };
export async function formsRollup(s: Scope, days: number, limit = 100): Promise<FormAgg[]> {
  const db = sql();
  // One row per person per form first (a person who submits twice is one person), then the counts, so a number and the list behind it are the same set.
  const rows = await db`
    with sub as (
      select x.location_id, x.kind, x.ext_id, x.contact_id, count(*)::int subs, max(x.submitted_at) last_at, min(x.submitted_at) first_at
      from dq_submissions x where x.installation_id = ${s.inst} ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)} and x.submitted_at >= now() - ${Math.max(1, days)}::int * interval '1 day' group by 1, 2, 3, 4)
    select f.kind, f.ext_id, f.name, f.location_id, l.name loc_name, sum(sub.subs)::int subs, count(c.contact_id)::int people,
      count(c.contact_id) filter (where c.date_added < sub.first_at - interval '1 day')::int repeat, count(c.contact_id) filter (where ${db.unsafe(LEAD_SQL.dup)})::int dups,
      count(c.contact_id) filter (where ${db.unsafe(LEAD_SQL.junk)} and not ${db.unsafe(LEAD_SQL.dup)})::int junk, count(c.contact_id) filter (where ${db.unsafe(LEAD_SQL.answered)})::int answered,
      count(c.contact_id) filter (where ${db.unsafe(LEAD_SQL.booked)})::int booked, count(c.contact_id) filter (where ${db.unsafe(LEAD_SQL.won)})::int won,
      coalesce(sum(${db.unsafe(LEAD_SQL.wonValue)}), 0)::float8 won_value, max(sub.last_at) last_at, min(sub.first_at) first_at
    from dq_forms f join sub on sub.location_id = f.location_id and sub.kind = f.kind and sub.ext_id = f.ext_id
    join locations l on l.installation_id = f.installation_id and l.location_id = f.location_id and not l.ignored
    left join cached_contacts c on c.installation_id = f.installation_id and c.location_id = sub.location_id and c.contact_id = sub.contact_id
    where f.installation_id = ${s.inst} and f.kind in ('form', 'survey')
    group by f.kind, f.ext_id, f.name, f.location_id, l.name order by sum(sub.subs) desc limit ${limit}`;
  return rows.map((r) => ({ kind: r.kind as "form" | "survey", id: r.ext_id as string, name: r.name as string, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, submissions: r.subs as number, people: r.people as number, repeat: r.repeat as number,
    dups: r.dups as number, junk: r.junk as number, answered: r.answered as number, booked: r.booked as number, won: r.won as number, wonValue: Number(r.won_value), lastAt: iso(r.last_at), first: iso(r.first_at) }));
}
export async function formDays(s: Scope, kind: "form" | "survey", id: string, location: string, days: number): Promise<DayCount[]> {
  const db = sql();
  const rows = await db`select (x.submitted_at at time zone 'UTC')::date as day, count(*)::int leads from dq_submissions x join locations l on l.installation_id = x.installation_id and l.location_id = x.location_id and not l.ignored
    where x.installation_id = ${s.inst} ${scopeOf(db, "x", s.allowed)} and x.location_id = ${location} and x.kind = ${kind} and x.ext_id = ${id} and x.submitted_at >= now() - ${Math.max(1, days)}::int * interval '1 day' group by 1 order by 1`;
  return rows.map((r) => ({ day: new Date(r.day as string).toISOString().slice(0, 10), leads: r.leads as number, dups: 0, junk: 0 }));
}
export async function funnelsList(s: Scope, limit = 60): Promise<Array<{ id: string; name: string; steps: number | null; locationId: string; locationName: string | null; leads: number }>> {
  const db = sql();
  const rows = await db`select f.ext_id, f.name, f.steps, f.location_id, l.name loc_name,
      (select count(*)::int from cached_contacts c where c.installation_id = f.installation_id and c.location_id = f.location_id and ${db.unsafe(SRC_KEY_SQL)} = left(lower(btrim(f.name)), 80) and c.date_added > now() - interval '90 days') leads
    from dq_forms f join locations l on l.installation_id = f.installation_id and l.location_id = f.location_id and not l.ignored
    where f.installation_id = ${s.inst} and f.kind = 'funnel' ${scopeOf(db, "f", s.allowed)} ${locOf(db, "f", s.location)} order by f.name limit ${limit}`;
  return rows.map((r) => ({ id: r.ext_id as string, name: r.name as string, steps: (r.steps as number | null) ?? null, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, leads: r.leads as number }));
}
export async function pollStatus(s: Scope): Promise<{ forms: "ok" | "needs_permission" | "never"; at: string | null }> {
  const db = sql();
  const rows = await db`select p.status, p.last_at from dq_poll p where p.installation_id = ${s.inst} and p.area = 'forms' ${scopeOf(db, "p", s.allowed)} ${locOf(db, "p", s.location)}`;
  if (rows.length === 0) return { forms: "never", at: null };
  const ok = rows.some((r) => r.status === "ok");
  return { forms: ok ? "ok" : "needs_permission", at: iso(rows.map((r) => r.last_at as Date).sort((a, b) => +b - +a)[0]) };
}

// ------------------------------------------------------------------------------------------------ alerts (intake rules against each source's own history)
export type AlertRow = IntakeAlert & { locationId: string; locationName: string | null; muted: boolean };
export async function intakeAlertList(s: Scope, deadDays = 3): Promise<AlertRow[]> {
  const db = sql();
  const rows = await db`select d.location_id, l.name loc_name, d.src, (array_agg(d.label order by d.day desc))[1] label, d.day, sum(d.leads)::int leads, sum(d.dups)::int dups, sum(d.junk)::int junk
    from dq_source_daily d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id and not l.ignored
    where d.installation_id = ${s.inst} and d.day >= ${db.unsafe(TODAY)} - 40 ${scopeOf(db, "d", s.allowed)} ${locOf(db, "d", s.location)} group by d.location_id, l.name, d.src, d.day`;
  const mutes = await db`select location_id, src from dq_mutes where installation_id = ${s.inst} and (until is null or until >= ${db.unsafe(TODAY)})`.catch(() => []);
  const muted = new Set(mutes.map((m) => `${m.location_id}|${m.src}`));
  const by = new Map<string, { loc: string; name: string | null; src: string; label: string; days: DayCount[] }>();
  for (const r of rows) {
    const k = `${r.location_id}|${r.src}`;
    const e = by.get(k) ?? by.set(k, { loc: r.location_id as string, name: (r.loc_name as string | null) ?? null, src: r.src as string, label: r.label as string, days: [] }).get(k)!;
    e.days.push({ day: new Date(r.day as string).toISOString().slice(0, 10), leads: r.leads as number, dups: r.dups as number, junk: r.junk as number });
  }
  const today = new Date().toISOString().slice(0, 10);
  const out: AlertRow[] = [];
  for (const e of by.values()) {
    if (e.src === "(none)") continue;
    for (const a of intakeAlerts(e.src, e.label, zeroFill(e.days, today, BASELINE_DAYS + RECENT_DAYS + 7), { deadDays })) out.push({ ...a, locationId: e.loc, locationName: e.name, muted: muted.has(`${e.loc}|${e.src}`) || muted.has(`${e.loc}|*`) });
  }
  const rank = { dead: 0, low_rate: 1, dup_heavy: 2, junk_heavy: 3 } as const;
  return out.sort((a, b) => Number(a.muted) - Number(b.muted) || rank[a.kind] - rank[b.kind] || (a.locationName ?? "").localeCompare(b.locationName ?? "")).slice(0, 200);
}
export async function setMute(inst: string, allowed: string[] | null, loc: string, src: string, on: boolean, days: number | null, actor: string | null): Promise<boolean> {
  if (allowed && !allowed.includes(loc)) return false;
  const db = sql();
  if (!on) { await db`delete from dq_mutes where installation_id = ${inst} and location_id = ${loc} and src = ${src}`; return true; }
  await db`insert into dq_mutes (installation_id, location_id, src, until, muted_by) values (${inst}, ${loc}, ${src}, ${days ? db.unsafe(`${TODAY} + ${Math.floor(days)}`) : null}, ${actor})
    on conflict (installation_id, location_id, src) do update set until = excluded.until, muted_by = excluded.muted_by`;
  return true;
}
export async function listMutes(s: Scope): Promise<Array<{ locationId: string; src: string; until: string | null }>> {
  const db = sql();
  const rows = await db`select location_id, src, until from dq_mutes where installation_id = ${s.inst} ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``} and (until is null or until >= ${db.unsafe(TODAY)})`.catch(() => []);
  return rows.map((r) => ({ locationId: r.location_id as string, src: r.src as string, until: r.until ? new Date(r.until as string).toISOString().slice(0, 10) : null }));
}

// ------------------------------------------------------------------------------------------------ score, overview, sweep
export type ScoreRow = { locationId: string; name: string | null; day: string; score: number | null; word: string | null; why: string; contacts: number; parts: Quality["parts"] };
type Counts = { contacts: number; dupExtra: number; junk: number; badPhone: number; badEmail: number; noPhone: number; noEmail: number; noOwner: number; noSource: number };

async function recentIntake(inst: string, loc: string | null, allowed: string[] | null): Promise<{ leads: number; dups: number; junk: number; noSource: number }> {
  const db = sql();
  const [r] = await db`select coalesce(sum(d.leads), 0)::int leads, coalesce(sum(d.dups), 0)::int dups, coalesce(sum(d.junk), 0)::int junk, coalesce(sum(d.leads) filter (where d.src = '(none)'), 0)::int no_source
    from dq_source_daily d where d.installation_id = ${inst} and d.day >= ${db.unsafe(TODAY)} - 29 ${loc ? db`and d.location_id = ${loc}` : db``} ${scopeOf(db, "d", allowed)}`;
  return { leads: Number(r?.leads ?? 0), dups: Number(r?.dups ?? 0), junk: Number(r?.junk ?? 0), noSource: Number(r?.no_source ?? 0) };
}
async function cuCounts(inst: string, loc: string): Promise<Counts | null> {
  const db = sql();
  const [r] = await db`select contacts, dup_extra, junk, bad_phone, bad_email, no_phone, no_email, no_owner, no_source from cu_scans where installation_id = ${inst} and location_id = ${loc} and day >= ${db.unsafe(TODAY)} - 2 order by day desc limit 1`.catch(() => []);
  if (!r) return null;
  return { contacts: r.contacts as number, dupExtra: r.dup_extra as number, junk: r.junk as number, badPhone: r.bad_phone as number, badEmail: r.bad_email as number, noPhone: r.no_phone as number, noEmail: r.no_email as number, noOwner: r.no_owner as number, noSource: r.no_source as number };
}

/** The whole daily pass for ONE account: duplicate groups, the intake record (35 days), and today's quality score. Writes ids and counts only. */
export async function dqScanAccount(inst: string, loc: string, backfill: boolean): Promise<{ score: number | null }> {
  const g = await scanGroups(inst, loc);
  await recomputeSourceDaily(inst, loc, backfill ? 90 : 35);
  let c = await cuCounts(inst, loc);
  if (!c) {
    const { scanAccount } = await import("./cu-queries");
    const s = await scanAccount(inst, loc);
    c = { contacts: s.contacts, dupExtra: s.dupExtra, junk: s.junk, badPhone: s.bad_phone, badEmail: s.bad_email, noPhone: s.no_phone, noEmail: s.no_email, noOwner: s.no_owner, noSource: s.no_source };
  }
  const q = qualityOf({ ...c, dupExtra: Math.max(c.dupExtra, g.extra), recent: await recentIntake(inst, loc, null) });
  const db = sql();
  const share = (p: string) => q.parts.find((x) => x.id === p)?.share ?? 0;
  await db`insert into dq_scores (installation_id, location_id, day, score, dup_rate, completeness, validity, intake, parts, rules_version)
    values (${inst}, ${loc}, ${db.unsafe(TODAY)}, ${q.score}, ${share("duplicates")}, ${share("completeness")}, ${share("validity")}, ${q.parts.some((p) => p.id === "intake") ? share("intake") : null}, ${db.json({ ...Object.fromEntries(q.parts.map((p) => [p.id, { share: p.share, lost: p.lost }])), groups: g.groups, byTier: g.byTier } as never)}, ${q.version})
    on conflict (installation_id, location_id, day) do update set score = excluded.score, dup_rate = excluded.dup_rate, completeness = excluded.completeness, validity = excluded.validity, intake = excluded.intake, parts = excluded.parts, rules_version = excluded.rules_version, taken_at = now()`;
  return { score: q.score };
}

/** The scheduled pass: every account without a score for today, within a time budget. Never throws. */
export async function dqSweep(inst: string, budgetMs = 15_000, only: string[] | null = null, force = false): Promise<{ scanned: number; pending: number }> {
  const db = sql();
  const rows = await db`select l.location_id, exists (select 1 from dq_source_daily d where d.installation_id = l.installation_id and d.location_id = l.location_id) has_hist from locations l
    where l.installation_id = ${inst} and not l.ignored ${only ? db`and l.location_id = any(${only}::text[])` : db``} ${force ? db`` : db`and not exists (select 1 from dq_scores s where s.installation_id = l.installation_id and s.location_id = l.location_id and s.day = ${db.unsafe(TODAY)})`} order by l.name`;
  const deadline = Date.now() + budgetMs;
  let scanned = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) break;
    try { await dqScanAccount(inst, r.location_id as string, r.has_hist !== true); scanned++; } catch (e) { if ((e as { code?: string })?.code === "42P01") break; /* the next run tries again */ }
  }
  return { scanned, pending: rows.length - scanned };
}

/** The newest score per account (last 7 days), worst first. Paged by offset on a small list (one row per account). */
export async function scoresLatest(s: Scope, search: string | null, limit: number, offset: number): Promise<{ rows: ScoreRow[]; total: number }> {
  const db = sql();
  const q = search ? `%${search.replace(/[\\%_]/g, "\\$&").toLowerCase()}%` : null;
  const base = db`from (select distinct on (x.location_id) x.* from dq_scores x where x.installation_id = ${s.inst} and x.day >= ${db.unsafe(TODAY)} - 7 ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)} order by x.location_id, x.day desc) c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored ${q ? db`where lower(l.name) like ${q}` : db``}`;
  const [t] = await db`select count(*)::int n ${base}`;
  const rows = await db`select c.*, l.name loc_name, (select contacts from cu_scans u where u.installation_id = c.installation_id and u.location_id = c.location_id order by day desc limit 1) contacts ${base} order by c.score asc nulls last, l.name limit ${limit} offset ${offset}`;
  return { total: t.n as number, rows: rows.map((r) => ({ locationId: r.location_id as string, name: (r.loc_name as string | null) ?? null, day: new Date(r.day as string).toISOString().slice(0, 10), score: (r.score as number | null) ?? null, word: null, why: "", contacts: Number(r.contacts ?? 0), parts: [] })) };
}
/** One account's latest parts, rebuilt from its counts, for the "why" line. */
export async function scoreDetail(inst: string, loc: string): Promise<Quality | null> {
  const c = await cuCounts(inst, loc);
  if (!c) return null;
  return qualityOf({ ...c, recent: await recentIntake(inst, loc, null) });
}
export async function scoreMap(inst: string, allowed: string[] | null): Promise<Map<string, number | null>> {
  const db = sql();
  const rows = await db`select distinct on (x.location_id) x.location_id, x.score from dq_scores x where x.installation_id = ${inst} and x.day >= ${db.unsafe(TODAY)} - 7 ${scopeOf(db, "x", allowed)} order by x.location_id, x.day desc`.catch(() => []);
  return new Map(rows.map((r) => [r.location_id as string, (r.score as number | null) ?? null]));
}
export async function scoreTrend(s: Scope, days = 90): Promise<Array<{ day: string; score: number | null }>> {
  const db = sql();
  const rows = await db`select x.day, round(avg(x.score))::int score from dq_scores x join locations l on l.installation_id = x.installation_id and l.location_id = x.location_id and not l.ignored
    where x.installation_id = ${s.inst} and x.day >= ${db.unsafe(TODAY)} - ${Math.min(365, days)}::int ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)} group by x.day order by x.day`.catch(() => []);
  return rows.map((r) => ({ day: new Date(r.day as string).toISOString().slice(0, 10), score: (r.score as number | null) ?? null }));
}
/** The portfolio quality score from the summed counts, with the 30-day intake of the accounts in scope. */
export async function portfolioQuality(s: Scope): Promise<{ q: Quality; counts: Counts & { groups: number }; accounts: number } | null> {
  const db = sql();
  const [r] = await db`select count(*)::int accounts, coalesce(sum(contacts), 0)::int contacts, coalesce(sum(dup_extra), 0)::int dup_extra, coalesce(sum(junk), 0)::int junk, coalesce(sum(bad_phone), 0)::int bad_phone, coalesce(sum(bad_email), 0)::int bad_email,
      coalesce(sum(no_phone), 0)::int no_phone, coalesce(sum(no_email), 0)::int no_email, coalesce(sum(no_owner), 0)::int no_owner, coalesce(sum(no_source), 0)::int no_source
    from (select distinct on (x.location_id) x.* from cu_scans x join locations l on l.installation_id = x.installation_id and l.location_id = x.location_id and not l.ignored
      where x.installation_id = ${s.inst} and x.day >= ${db.unsafe(TODAY)} - 7 ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)} order by x.location_id, x.day desc) c`.catch(() => [null]);
  if (!r || (r.accounts as number) === 0) return null;
  const tc = await tierCounts(s).catch(() => null);
  const groups = tc ? tc.certain.groups + tc.likely.groups + tc.possible.groups : 0;
  const extra = tc ? tc.certain.extra + tc.likely.extra + tc.possible.extra : 0;
  const counts = { contacts: r.contacts as number, dupExtra: Math.max(r.dup_extra as number, extra), junk: r.junk as number, badPhone: r.bad_phone as number, badEmail: r.bad_email as number, noPhone: r.no_phone as number, noEmail: r.no_email as number, noOwner: r.no_owner as number, noSource: r.no_source as number };
  return { q: qualityOf({ ...counts, recent: await recentIntake(s.inst, s.location, s.allowed) }), counts: { ...counts, groups }, accounts: r.accounts as number };
}

/** In-app alert drafts for the existing alert engine (bell, Today, digest, email only through the existing live switches): one per source whose rule fired and that is not muted. */
export async function dqAlertDrafts(inst: string): Promise<Array<{ dedupeKey: string; kind: string; severity: "info" | "warning" | "critical"; locationId: string | null; title: string; detail: Record<string, unknown> }>> {
  const list = await intakeAlertList({ inst, allowed: null, location: null }).catch(() => []);
  return list.filter((a) => !a.muted && a.kind !== "junk_heavy").slice(0, 60).map((a) => ({
    dedupeKey: `dq:${a.kind}:${a.locationId}:${a.key}`.slice(0, 190), kind: "quality", severity: a.severity, locationId: a.locationId, title: `${a.locationName ?? "A client account"}: ${a.title}`, detail: { dq: a.kind, source: a.label, ...a.numbers },
  }));
}
