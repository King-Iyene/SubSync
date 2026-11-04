import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { classify, groupDuplicates, planFields, type FieldChoice, type Group, type Person } from "./dedupe";
import { loadConfigs, type AccountConfig } from "./cleanup-config";
import { learnWeights, pairKey, type Learned } from "./match-evidence";
import { byAccount, health, isObvious, rankValue, reasonCounts, type QueueItem } from "./dedupe-review";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type QueueGroup = Group & { locationId: string; locationName: string | null; plan: FieldChoice[] };

// Contacts inside one account that share an email or a phone number (so far as the cached data shows). A very large agency is read in one go but
// capped, so the page can never become slow; the groups with the most members come first and the screen says when the list was cut.
const CANDIDATE_LIMIT = 60_000;

type Candidate = Person & { locationId: string; locationName: string | null };

async function loadCandidates(installationId: string, allowed: string[] | null, nameLocs: string[], typoLocs: string[]): Promise<Candidate[]> {
  const db = sql();
  const rows = await db`
    with loc as (
      select location_id, name from locations where installation_id = ${installationId} and not ignored
        ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}),
    c as (
      select c.location_id, c.contact_id, c.full_name, c.email, c.phone, c.tags, c.date_added, c.last_activity_at, c.source, c.dnd, nullif(c.assigned_to, '') owner_id,
        nullif(lower(btrim(coalesce(c.email, ''))), '') em,
        case when length(c.phone_digits) >= 7 then right(c.phone_digits, 10) end ph,
        -- Only for accounts whose rules look at similar names or swapped digits: the first three letters of the last name, and the digits of the number in order.
        case when c.location_id = any(${nameLocs}::text[]) and btrim(coalesce(c.full_name, '')) like '% %'
          then nullif(left(lower(regexp_replace(regexp_replace(btrim(c.full_name), '^.* ', ''), '[^a-zA-Z]', '', 'g')), 3), '') end nk,
        case when c.location_id = any(${typoLocs}::text[]) and length(c.phone_digits) >= 7
          then (select string_agg(d, '' order by d) from regexp_split_to_table(right(c.phone_digits, 10), '') d) end pb
      from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId}),
    cand as (
      select c.*, greatest(
          case when em is not null then count(*) over (partition by location_id, em) else 0 end,
          case when ph is not null then count(*) over (partition by location_id, ph) else 0 end,
          case when nk is not null then count(*) over (partition by location_id, nk) else 0 end,
          case when pb is not null then count(*) over (partition by location_id, pb) else 0 end) size,
        greatest(
          case when em is not null then count(*) over (partition by location_id, em) else 0 end,
          case when ph is not null then count(*) over (partition by location_id, ph) else 0 end) exact_size
      from c)
    select cand.*, loc.name location_name,
      coalesce(d.open_deals, 0) open_deals, coalesce(d.won_deals, 0) won_deals,
      exists (select 1 from cached_conversations v where v.installation_id = ${installationId} and v.location_id = cand.location_id and v.contact_id = cand.contact_id) has_conv
    from cand join loc on loc.location_id = cand.location_id
    left join (
      select location_id, contact_id, count(*) filter (where status = 'open')::int open_deals, count(*) filter (where status = 'won')::int won_deals
      from cached_opportunities where installation_id = ${installationId} and contact_id is not null group by location_id, contact_id) d
      on d.location_id = cand.location_id and d.contact_id = cand.contact_id
    where cand.size > 1
    order by (cand.exact_size > 1) desc, cand.size desc, cand.location_id, cand.contact_id limit ${CANDIDATE_LIMIT}`;
  return rows.map((r) => ({
    contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name,
    name: (r.full_name as string | null)?.trim() || "Unnamed contact", email: r.email, phone: r.phone, tags: r.tags ?? [],
    createdAt: iso(r.date_added), lastActivityAt: iso(r.last_activity_at), source: r.source,
    openDeals: r.open_deals, wonDeals: r.won_deals, hasConversation: r.has_conv === true,
    dnd: r.dnd === true, ownerId: (r.owner_id as string | null) ?? null,
  }));
}

export async function reviewedKeys(installationId: string): Promise<Map<string, { decision: string; keepContactId: string | null; decidedAt: string | null }>> {
  const rows = await sql()`select location_id, group_key, decision, keep_contact_id, decided_at from duplicate_reviews where installation_id = ${installationId}`;
  return new Map(rows.map((r) => [`${r.location_id}:${r.group_key}`, { decision: r.decision as string, keepContactId: r.keep_contact_id as string | null, decidedAt: iso(r.decided_at) }]));
}

// ---------------- the built queue (cached for a short time; one build serves every page of the review) ----------------

export type Built = {
  /** The effective choices per client account (matching strictness, which value wins, the merge workflow). */
  configs: Map<string, AccountConfig>;
  /** Every group, with its rank. Never sent to the browser whole: the API sends one page and one group in detail. */
  all: Array<QueueItem & { obvious: boolean }>;
  /** Contacts per client account in scope (the list the share is measured against). */
  listSizes: Map<string, number>;
  truncated: boolean;
};

const built = ttlCache<Built>(45_000, 40);
const building = new Map<string, Promise<Built>>();

const hash = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

/** What the person decided before, as pairs: the pairs they said are NOT the same person (never asked again) and, per account, the weights learned from their yes and no answers. */
async function learnFrom(installationId: string, allowed: string[] | null): Promise<{ rejected: Set<string>; learned: Map<string, Learned> }> {
  const rows = await sql()`select location_id, decision, snapshot from duplicate_reviews where installation_id = ${installationId} ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``} order by decided_at desc limit 1500`;
  const rejected = new Set<string>();
  const acc = new Map<string, { accepted: Array<[Person, Person]>; rejected: Array<[Person, Person]> }>();
  for (const r of rows) {
    const list = ((r.snapshot as { contacts?: Array<Record<string, unknown>> } | null)?.contacts ?? []).slice(0, 6).map((c): Person => ({
      contactId: String(c.contact_id), name: String(c.full_name ?? "").trim() || "Unnamed contact", email: (c.email as string | null) ?? null, phone: (c.phone as string | null) ?? null,
      tags: (c.tags as string[] | null) ?? [], createdAt: c.date_added ? new Date(c.date_added as string).toISOString() : null, lastActivityAt: null, source: (c.source as string | null) ?? null, openDeals: 0, wonDeals: 0, hasConversation: false,
    }));
    const no = r.decision === "not_duplicate";
    const slot = acc.get(r.location_id as string) ?? acc.set(r.location_id as string, { accepted: [], rejected: [] }).get(r.location_id as string)!;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (no) { rejected.add(pairKey(list[i].contactId, list[j].contactId)); slot.rejected.push([list[i], list[j]]); } else slot.accepted.push([list[i], list[j]]);
    }
  }
  return { rejected, learned: new Map([...acc].map(([loc, d]) => [loc, learnWeights(d)])) };
}

async function build(installationId: string, allowed: string[] | null): Promise<Built> {
  const now = Date.now();
  const [configs, learn] = await Promise.all([loadConfigs(installationId, allowed), learnFrom(installationId, allowed).catch(() => ({ rejected: new Set<string>(), learned: new Map<string, Learned>() }))]);
  const nameLocs = [...configs].filter(([, c]) => c.match.nameAlone && c.match.name !== "off").map(([id]) => id);
  const typoLocs = [...configs].filter(([, c]) => c.match.phone === "typo").map(([id]) => id);
  const [people, sizes] = await Promise.all([
    loadCandidates(installationId, allowed, nameLocs, typoLocs),
    sql()`select location_id, count(*)::int n from cached_contacts where installation_id = ${installationId} ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``} group by location_id`,
  ]);
  const byLocation = new Map<string, Candidate[]>();
  for (const p of people) (byLocation.get(p.locationId) ?? byLocation.set(p.locationId, []).get(p.locationId)!).push(p);
  const all: Built["all"] = [];
  for (const [locationId, list] of byLocation) {
    const rules = (configs.get(locationId) ?? { match: undefined }).match;
    for (const g of groupDuplicates(list, rules?.threshold ?? 50, 40, rules, { rejected: learn.rejected, weights: learn.learned.get(locationId)?.weights })) {
      const item: QueueItem = { ...g, locationId, locationName: list[0].locationName };
      all.push({ ...item, rank: rankValue(item, now), obvious: isObvious(item) });
    }
  }
  return { configs, all, listSizes: new Map(sizes.map((r) => [r.location_id as string, r.n as number])), truncated: people.length >= CANDIDATE_LIMIT };
}

/** The groups for the caller's accounts. Cached 45 seconds per installation and account set; two people opening the page share one read. */
export async function builtQueue(installationId: string, allowed: string[] | null): Promise<Built> {
  const key = `${installationId}|${allowed ? hash([...allowed].sort().join(",")) : "all"}`;
  const hit = built.get(key);
  if (hit) return hit;
  const running = building.get(key);
  if (running) return running;
  const p = build(installationId, allowed).then((b) => { built.set(key, b); return b; }).finally(() => building.delete(key));
  building.set(key, p);
  return p;
}

/** A decision changes what is open, so the installation's builds are forgotten. */
export const forgetQueue = (installationId: string) => built.clear(installationId + "|");

export async function buildQueue(installationId: string, allowed: string[] | null) {
  const [b, reviews] = await Promise.all([builtQueue(installationId, allowed), reviewedKeys(installationId)]);
  const all: QueueGroup[] = b.all.map((g) => ({ ...g, plan: planFields(g) }));
  const open = all.filter((g) => !reviews.has(`${g.locationId}:${g.key}`));
  return { all, open, reviews, truncated: b.truncated };
}

export type QueueSummary = ReturnType<typeof classify> & { reviewed: number; accounts: Array<{ locationId: string; name: string | null; groups: number; contacts: number; allowDuplicates: boolean | null }> };

export async function summarise(installationId: string, allowed: string[] | null, open: QueueGroup[], reviewedCount: number): Promise<QueueSummary> {
  const db = sql();
  const locs = await db`select location_id, name, allow_duplicate_contact from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name`;
  const accounts = locs.map((l) => {
    const mine = open.filter((g) => g.locationId === l.location_id);
    return { locationId: l.location_id as string, name: l.name as string | null, groups: mine.length, contacts: mine.reduce((s, g) => s + g.people.length, 0), allowDuplicates: (l.allow_duplicate_contact as boolean | null) ?? null };
  });
  return { ...classify(open), reviewed: reviewedCount, accounts };
}

/** Decisions the person made (any kind) and groups set aside until a later day. Small tables read fresh on every request. */
export async function decisionSets(installationId: string): Promise<{ decided: Set<string>; later: Map<string, string>; reviews: Map<string, { decision: string; keepContactId: string | null; decidedAt: string | null }> }> {
  const [reviews, snoozes] = await Promise.all([
    reviewedKeys(installationId),
    sql()`select location_id, group_key, until from duplicate_snoozes where installation_id = ${installationId} and until > now()`,
  ]);
  return {
    decided: new Set(reviews.keys()),
    later: new Map(snoozes.map((r) => [`${r.location_id}:${r.group_key}`, iso(r.until) as string])),
    reviews,
  };
}

/** The review screen's numbers, from the same open list the stepper walks (one counting rule). */
export function overview(open: ReadonlyArray<QueueItem & { obvious?: boolean }>, listSize: number) {
  return { health: health(open, listSize), byReason: reasonCounts(open), accounts: byAccount(open), obvious: open.filter((g) => g.obvious).length };
}

// ---------------- one group in detail (the group on screen) ----------------

/**
 * The records of one group with everything the review shows: owner name, open deal value, appointments, the day each tag was first seen. The ids are
 * checked against the account the caller may see, so a caller can never read another account's contacts. Null when anything does not match.
 */
export async function loadPeople(installationId: string, allowed: string[] | null, locationId: string, contactIds: string[]): Promise<{ locationName: string | null; people: Person[]; watchingSince: string | null } | null> {
  if (allowed && !allowed.includes(locationId)) return null;
  if (contactIds.length < 2 || contactIds.length > 40) return null;
  const db = sql();
  const [rows, tags, loc, watch] = await Promise.all([
    db`
      select c.contact_id, c.full_name, c.email, c.phone, c.tags, c.date_added, c.last_activity_at, c.source, c.dnd, nullif(c.assigned_to, '') owner_id, t.name owner_name,
        coalesce(d.open_deals, 0) open_deals, coalesce(d.won_deals, 0) won_deals, coalesce(d.open_value, 0) open_value,
        exists (select 1 from cached_conversations v where v.installation_id = c.installation_id and v.location_id = c.location_id and v.contact_id = c.contact_id) has_conv,
        (select count(*)::int from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id) appts
      from cached_contacts c
      left join team_names t on t.installation_id = c.installation_id and t.user_id = c.assigned_to
      left join (
        select contact_id, count(*) filter (where status = 'open')::int open_deals, count(*) filter (where status = 'won')::int won_deals,
          coalesce(sum(monetary_value) filter (where status = 'open'), 0)::float8 open_value
        from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and contact_id = any(${contactIds}::text[]) group by contact_id) d on d.contact_id = c.contact_id
      where c.installation_id = ${installationId} and c.location_id = ${locationId} and c.contact_id = any(${contactIds}::text[])`,
    db`select contact_id, tag, max(at) at from contact_tag_events where installation_id = ${installationId} and location_id = ${locationId} and contact_id = any(${contactIds}::text[]) and kind = 'added' group by 1, 2`,
    db`select name from locations where installation_id = ${installationId} and location_id = ${locationId} and not ignored`,
    db`select min(at) at from contact_tag_events where installation_id = ${installationId} and location_id = ${locationId}`,
  ]);
  if (rows.length !== contactIds.length || loc.length === 0) return null;
  const dates = new Map<string, Record<string, string>>();
  for (const t of tags) (dates.get(t.contact_id as string) ?? dates.set(t.contact_id as string, {}).get(t.contact_id as string)!)[t.tag as string] = iso(t.at) as string;
  const people: Person[] = contactIds.map((id) => {
    const r = rows.find((x) => x.contact_id === id)!;
    return {
      contactId: id, name: (r.full_name as string | null)?.trim() || "Unnamed contact", email: r.email, phone: r.phone, tags: r.tags ?? [],
      createdAt: iso(r.date_added), lastActivityAt: iso(r.last_activity_at), source: r.source, openDeals: r.open_deals, wonDeals: r.won_deals, hasConversation: r.has_conv === true,
      dnd: r.dnd === true, ownerId: (r.owner_id as string | null) ?? null, ownerName: (r.owner_name as string | null) ?? null, openValue: Number(r.open_value) || 0,
      appointments: r.appts as number, tagDates: dates.get(id) ?? {},
    };
  });
  return { locationName: (loc[0].name as string | null) ?? null, people, watchingSince: iso(watch[0]?.at) };
}

// ---------------- decisions ----------------

// Record a decision about one group. The records are re-read from our copy and checked against
// the account the caller may see, so a caller cannot snapshot or decide about someone else's data.
export async function recordDecision(
  installationId: string, allowed: string[] | null, actor: string | null,
  input: { locationId: string; key: string; decision: "keep" | "not_duplicate" | "merged_in_platform"; keepContactId: string | null; contactIds: string[] },
): Promise<"ok" | "not_found"> {
  if (allowed && !allowed.includes(input.locationId)) return "not_found";
  const db = sql();
  const rows = await db`
    select contact_id, full_name, email, phone, tags, date_added, last_activity_at, source from cached_contacts
    where installation_id = ${installationId} and location_id = ${input.locationId} and contact_id = any(${input.contactIds}::text[])`;
  if (rows.length !== input.contactIds.length || rows.length < 2) return "not_found";
  if (input.keepContactId && !input.contactIds.includes(input.keepContactId)) return "not_found";
  const snapshot = { takenAt: new Date().toISOString(), contacts: rows };
  await db.begin(async (tx) => {
    await tx`
      insert into duplicate_reviews (installation_id, location_id, group_key, decision, keep_contact_id, snapshot, decided_by)
      values (${installationId}, ${input.locationId}, ${input.key}, ${input.decision}, ${input.keepContactId}, ${tx.json(snapshot as never)}, ${actor})
      on conflict (installation_id, location_id, group_key) do update set
        decision = excluded.decision, keep_contact_id = excluded.keep_contact_id, snapshot = excluded.snapshot, decided_by = excluded.decided_by, decided_at = now()`;
    await tx`delete from duplicate_snoozes where installation_id = ${installationId} and location_id = ${input.locationId} and group_key = ${input.key}`;
    await tx`
      insert into audit_log (installation_id, actor, action, detail)
      values (${installationId}, ${actor}, ${"duplicates." + input.decision}, ${tx.json({ locationId: input.locationId, key: input.key, keep: input.keepContactId, contacts: input.contactIds.length } as never)})`;
  });
  forgetQueue(installationId);
  return "ok";
}

export async function undoDecision(installationId: string, allowed: string[] | null, actor: string | null, locationId: string, key: string): Promise<boolean> {
  if (allowed && !allowed.includes(locationId)) return false;
  const db = sql();
  const gone = await db`delete from duplicate_reviews where installation_id = ${installationId} and location_id = ${locationId} and group_key = ${key} returning id`;
  if (gone.length === 0) return false;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'duplicates.undo', ${db.json({ locationId, key } as never)})`;
  forgetQueue(installationId);
  return true;
}

export const SNOOZE_DAYS = 7;

/** "Not now": the group leaves the open list for a week, then comes back. Undoable. The contacts are checked against the caller's accounts first. */
export async function snoozeGroup(installationId: string, allowed: string[] | null, actor: string | null, input: { locationId: string; key: string; contactIds: string[] }): Promise<"ok" | "not_found"> {
  if (allowed && !allowed.includes(input.locationId)) return "not_found";
  const db = sql();
  const rows = await db`select contact_id from cached_contacts where installation_id = ${installationId} and location_id = ${input.locationId} and contact_id = any(${input.contactIds}::text[])`;
  if (rows.length !== input.contactIds.length || rows.length < 2) return "not_found";
  await db.begin(async (tx) => {
    await tx`
      insert into duplicate_snoozes (installation_id, location_id, group_key, until, decided_by)
      values (${installationId}, ${input.locationId}, ${input.key}, now() + ${SNOOZE_DAYS + " days"}::interval, ${actor})
      on conflict (installation_id, location_id, group_key) do update set until = excluded.until, decided_by = excluded.decided_by, created_at = now()`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'duplicates.snooze', ${tx.json({ locationId: input.locationId, key: input.key, contacts: input.contactIds.length } as never)})`;
  });
  return "ok";
}

export async function unsnoozeGroup(installationId: string, allowed: string[] | null, actor: string | null, locationId: string, key: string): Promise<boolean> {
  if (allowed && !allowed.includes(locationId)) return false;
  const db = sql();
  const gone = await db`delete from duplicate_snoozes where installation_id = ${installationId} and location_id = ${locationId} and group_key = ${key} returning id`;
  if (gone.length === 0) return false;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'duplicates.unsnooze', ${db.json({ locationId, key } as never)})`;
  return true;
}

// Apply one decision to many groups at once (after the user has seen the dry run).
export async function recordBulk(installationId: string, actor: string | null, decision: "not_duplicate" | "keep", groups: Array<Pick<QueueGroup, "locationId" | "key" | "survivorId" | "people">>): Promise<number> {
  const db = sql();
  await db.begin(async (tx) => {
    for (const g of groups) {
      const snapshot = { takenAt: new Date().toISOString(), contacts: g.people };
      await tx`
        insert into duplicate_reviews (installation_id, location_id, group_key, decision, keep_contact_id, snapshot, decided_by)
        values (${installationId}, ${g.locationId}, ${g.key}, ${decision}, ${decision === "keep" ? g.survivorId : null}, ${tx.json(snapshot as never)}, ${actor})
        on conflict (installation_id, location_id, group_key) do update set
          decision = excluded.decision, keep_contact_id = excluded.keep_contact_id, snapshot = excluded.snapshot, decided_by = excluded.decided_by, decided_at = now()`;
    }
    await tx`
      insert into audit_log (installation_id, actor, action, detail)
      values (${installationId}, ${actor}, ${"duplicates.bulk_" + decision}, ${tx.json({ groups: groups.length, keys: groups.map((g) => g.key).slice(0, 500) } as never)})`;
  });
  forgetQueue(installationId);
  return groups.length;
}

// ---------------- other contacts that share the pair's email or phone ----------------

/** How many OTHER contacts of the account share an email or phone number with the given contacts. The merge workflow in the CRM would take those too. */
export async function othersSharing(installationId: string, locationId: string, contactIds: string[]): Promise<number> {
  const db = sql();
  const [r] = await db`
    with mine as (
      select nullif(lower(btrim(coalesce(email, ''))), '') em, case when length(phone_digits) >= 7 then right(phone_digits, 10) end ph
      from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = any(${contactIds}::text[]))
    select count(*)::int n from cached_contacts c
    where c.installation_id = ${installationId} and c.location_id = ${locationId} and not (c.contact_id = any(${contactIds}::text[]))
      and (lower(btrim(coalesce(c.email, ''))) = any(select em from mine where em is not null)
        or (length(c.phone_digits) >= 7 and right(c.phone_digits, 10) = any(select ph from mine where ph is not null)))`;
  return (r?.n as number) ?? 0;
}

// ---------------- "what would this setting find?" ----------------

/** The open groups one client account would have under the given rules, without saving anything. Not cached: it is only asked for while a person is choosing. */
export async function previewCounts(installationId: string, locationId: string, rules: import("./cleanup-rules").MatchRules): Promise<{ groups: number; extra: number }> {
  const people = await loadCandidates(installationId, [locationId], rules.nameAlone && rules.name !== "off" ? [locationId] : [], rules.phone === "typo" ? [locationId] : []);
  const sets = await decisionSets(installationId);
  const open = groupDuplicates(people, rules.threshold, 40, rules).filter((g) => !sets.decided.has(`${locationId}:${g.key}`) && !sets.later.has(`${locationId}:${g.key}`));
  return { groups: open.length, extra: open.reduce((s, g) => s + g.people.length - 1, 0) };
}
