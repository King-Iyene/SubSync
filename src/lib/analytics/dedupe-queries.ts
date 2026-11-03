import { sql } from "../db";
import { classify, groupDuplicates, planFields, type FieldChoice, type Group, type Person } from "./dedupe";
import { needsRecheck } from "./dedupe-guide";

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type QueueGroup = Group & { locationId: string; locationName: string | null; plan: FieldChoice[] };

// Contacts inside one account that share an email or a phone number (so far as the cached data
// shows). We read at most this many rows so a very large account cannot make the page slow; the
// groups with the most members come first.
const CANDIDATE_LIMIT = 8000;

async function loadCandidates(installationId: string, allowed: string[] | null): Promise<Array<Person & { locationId: string; locationName: string | null }>> {
  const db = sql();
  const rows = await db`
    with loc as (
      select location_id, name from locations where installation_id = ${installationId} and not ignored
        ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}),
    c as (
      select c.location_id, c.contact_id, c.full_name, c.email, c.phone, c.tags, c.date_added, c.last_activity_at, c.source, c.dnd,
        nullif(lower(btrim(coalesce(c.email, ''))), '') em,
        case when length(c.phone_digits) >= 7 then right(c.phone_digits, 10) end ph
      from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId}),
    cand as (
      select c.*, greatest(
          case when em is not null then count(*) over (partition by location_id, em) else 0 end,
          case when ph is not null then count(*) over (partition by location_id, ph) else 0 end) size
      from c)
    select cand.*, loc.name location_name,
      coalesce(d.open_deals, 0) open_deals, coalesce(d.won_deals, 0) won_deals,
      (select count(*)::int from cached_appointments a where a.installation_id = ${installationId} and a.location_id = cand.location_id and a.contact_id = cand.contact_id and a.start_at > now() and coalesce(a.status, '') not in ('cancelled', 'canceled')) upcoming,
      exists (select 1 from cached_conversations v where v.installation_id = ${installationId} and v.location_id = cand.location_id and v.contact_id = cand.contact_id) has_conv
    from cand join loc on loc.location_id = cand.location_id
    left join (
      select location_id, contact_id, count(*) filter (where status = 'open')::int open_deals, count(*) filter (where status = 'won')::int won_deals
      from cached_opportunities where installation_id = ${installationId} and contact_id is not null group by location_id, contact_id) d
      on d.location_id = cand.location_id and d.contact_id = cand.contact_id
    where cand.size > 1
    order by cand.size desc, cand.location_id, cand.contact_id limit ${CANDIDATE_LIMIT}`;
  return rows.map((r) => ({
    contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name,
    name: (r.full_name as string | null)?.trim() || "Unnamed contact", email: r.email, phone: r.phone, tags: r.tags ?? [],
    createdAt: iso(r.date_added), lastActivityAt: iso(r.last_activity_at), source: r.source,
    openDeals: r.open_deals, wonDeals: r.won_deals, hasConversation: r.has_conv === true, dnd: r.dnd === true, upcomingAppointments: r.upcoming ?? 0,
  }));
}

export async function reviewedKeys(installationId: string): Promise<Map<string, { decision: string; keepContactId: string | null; decidedAt: string | null }>> {
  const rows = await sql()`select location_id, group_key, decision, keep_contact_id, decided_at from duplicate_reviews where installation_id = ${installationId}`;
  return new Map(rows.map((r) => [`${r.location_id}:${r.group_key}`, { decision: r.decision as string, keepContactId: r.keep_contact_id as string | null, decidedAt: iso(r.decided_at) }]));
}

export async function buildQueue(installationId: string, allowed: string[] | null) {
  const [people, reviews] = await Promise.all([loadCandidates(installationId, allowed), reviewedKeys(installationId)]);
  const byLocation = new Map<string, typeof people>();
  for (const p of people) (byLocation.get(p.locationId) ?? byLocation.set(p.locationId, []).get(p.locationId)!).push(p);
  const all: QueueGroup[] = [];
  for (const [locationId, list] of byLocation) {
    for (const g of groupDuplicates(list)) {
      all.push({ ...g, locationId, locationName: list[0].locationName, plan: planFields(g) });
    }
  }
  all.sort((a, b) => b.confidence - a.confidence || b.people.length - a.people.length);
  // A group someone said they merged in the CRM comes back if it is still here a day later (the merge did not happen, or did not sync).
  const now = Date.now();
  const open = all.filter((g) => {
    const r = reviews.get(`${g.locationId}:${g.key}`);
    return !r || needsRecheck(r, now);
  });
  return { all, open, reviews, truncated: people.length >= CANDIDATE_LIMIT };
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

// Record a decision about one group. The records are re-read from our copy and checked against
// the account the caller may see, so a caller cannot snapshot or decide about someone else's data.
export async function recordDecision(
  installationId: string, allowed: string[] | null, actor: string | null,
  input: { locationId: string; key: string; decision: "keep" | "not_duplicate" | "merged_in_platform"; keepContactId: string | null; contactIds: string[] },
): Promise<"ok" | "not_found" | "blocked"> {
  if (allowed && !allowed.includes(input.locationId)) return "not_found";
  const db = sql();
  const rows = await db`
    select contact_id, full_name, email, phone, tags, date_added, last_activity_at, source, dnd from cached_contacts
    where installation_id = ${installationId} and location_id = ${input.locationId} and contact_id = any(${input.contactIds}::text[])`;
  if (rows.length !== input.contactIds.length || rows.length < 2) return "not_found";
  if (input.keepContactId && !input.contactIds.includes(input.keepContactId)) return "not_found";
  // A group with a do-not-disturb contact only ever records "different people". Nothing else is offered for it.
  if (input.decision !== "not_duplicate" && rows.some((r) => r.dnd === true)) return "blocked";
  const snapshot = { takenAt: new Date().toISOString(), contacts: rows.map((r) => ({ contact_id: r.contact_id, full_name: r.full_name, email: r.email, phone: r.phone, tags: r.tags, date_added: r.date_added, last_activity_at: r.last_activity_at, source: r.source })) };
  await db.begin(async (tx) => {
    await tx`
      insert into duplicate_reviews (installation_id, location_id, group_key, decision, keep_contact_id, snapshot, decided_by)
      values (${installationId}, ${input.locationId}, ${input.key}, ${input.decision}, ${input.keepContactId}, ${tx.json(snapshot as never)}, ${actor})
      on conflict (installation_id, location_id, group_key) do update set
        decision = excluded.decision, keep_contact_id = excluded.keep_contact_id, snapshot = excluded.snapshot, decided_by = excluded.decided_by, decided_at = now()`;
    await tx`
      insert into audit_log (installation_id, actor, action, detail)
      values (${installationId}, ${actor}, ${"duplicates." + input.decision}, ${tx.json({ locationId: input.locationId, key: input.key, keep: input.keepContactId, contacts: input.contactIds.length } as never)})`;
  });
  return "ok";
}

export async function undoDecision(installationId: string, allowed: string[] | null, actor: string | null, locationId: string, key: string): Promise<boolean> {
  if (allowed && !allowed.includes(locationId)) return false;
  const db = sql();
  const gone = await db`delete from duplicate_reviews where installation_id = ${installationId} and location_id = ${locationId} and group_key = ${key} returning id`;
  if (gone.length === 0) return false;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'duplicates.undo', ${db.json({ locationId, key } as never)})`;
  return true;
}

// Apply one decision to many groups at once (after the user has seen the dry run).
export async function recordBulk(installationId: string, actor: string | null, decision: "not_duplicate" | "keep", groups: QueueGroup[]): Promise<number> {
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
  return groups.length;
}
