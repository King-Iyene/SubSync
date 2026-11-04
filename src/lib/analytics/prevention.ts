import { sql } from "../db";
import { schemaReady } from "./cleanup-config";
import type { Person } from "./dedupe";
import { scoreEvidence, TIER_AT, type Evidence } from "./match-evidence";

// Real-time prevention, the honest version (stage CLEANUP, round 2). The platform tells SubSync about a new contact with its contact-created webhook, within seconds, and the event
// carries the contact's name, email and phone. SubSync cannot stop the CRM creating the record (an app has no hook before creation), but it can compare the newcomer with the
// account's existing contacts while the webhook is being answered and say "possible duplicate of X" at once: an alert, a card in the Duplicates tab and, only if the account
// allowed it, a tag in the CRM through the write gateway. Nothing here writes to the CRM.

export type Incoming = { contactId: string; name: string; email: string | null; phone: string | null; tags: string[]; source: string | null; createdAt: string | null };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Reads the contact out of a contact-created webhook body, defensively (the platform nests it differently across event versions). Null when there is no usable contact. */
export function incomingFrom(body: unknown): Incoming | null {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const c = (o.contact && typeof o.contact === "object" ? o.contact : o) as Record<string, unknown>;
  const id = text(c.id) ?? text(c.contactId);
  if (!id) return null;
  const name = text(c.name) ?? text(c.fullName) ?? [text(c.firstName), text(c.lastName)].filter(Boolean).join(" ");
  const tags = Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string") : [];
  const when = text(c.dateAdded) ?? text(c.createdAt);
  return { contactId: id, name: name || "Unnamed contact", email: text(c.email), phone: text(c.phone), tags, source: text(c.source), createdAt: when && Number.isFinite(Date.parse(when)) ? new Date(when).toISOString() : new Date().toISOString() };
}

const asPerson = (i: Incoming): Person => ({ contactId: i.contactId, name: i.name, email: i.email, phone: i.phone, tags: i.tags, createdAt: i.createdAt, lastActivityAt: null, source: i.source, openDeals: 0, wonDeals: 0, hasConversation: false });

export type Found = { otherId: string; otherName: string; score: number; tier: Evidence["tier"]; reasons: string[] };

/** The best earlier match for a newcomer among the account's contacts (candidates by email, phone and last name, at most 80), or null below the "maybe" line. Read only. */
export async function bestMatch(installationId: string, locationId: string, inc: Incoming): Promise<Found | null> {
  const db = sql();
  const em = inc.email ? inc.email.trim().toLowerCase() : null;
  const ph = inc.phone ? inc.phone.replace(/\D/g, "").slice(-10) : "";
  const parts = inc.name.toLowerCase().split(/\s+/).filter(Boolean);
  const lastName = parts.length >= 2 ? parts[parts.length - 1].replace(/[^a-z]/g, "") : "";
  const rows = await db`
    select contact_id, full_name, email, phone, tags, date_added, source from cached_contacts
    where installation_id = ${installationId} and location_id = ${locationId} and contact_id <> ${inc.contactId}
      and ((${em}::text is not null and lower(btrim(coalesce(email, ''))) = ${em}) or (${ph.length >= 7} and length(phone_digits) >= 7 and right(phone_digits, 7) = ${ph.slice(-7)})
        or (${lastName.length >= 3} and lower(full_name) like ${"% " + lastName}))
    limit 80`;
  const me = asPerson(inc);
  let best: Found | null = null;
  for (const r of rows) {
    const other: Person = {
      contactId: r.contact_id as string, name: ((r.full_name as string | null) ?? "").trim() || "Unnamed contact", email: r.email as string | null, phone: r.phone as string | null,
      tags: (r.tags as string[] | null) ?? [], createdAt: r.date_added instanceof Date ? r.date_added.toISOString() : null, lastActivityAt: null, source: r.source as string | null,
      openDeals: 0, wonDeals: 0, hasConversation: false,
    };
    const e = scoreEvidence(me, other);
    if (e.score >= TIER_AT.maybe && (!best || e.score > best.score)) best = { otherId: other.contactId, otherName: other.name, score: e.score, tier: e.tier, reasons: e.reasons };
  }
  return best;
}

/** Remembers the arrival so the alert and the card can show it. A table that is not there yet (the update is not applied) means nothing is remembered and nothing fails. */
export async function recordArrival(installationId: string, locationId: string, contactId: string, f: Found): Promise<boolean> {
  if (!(await schemaReady()).possible) return false;
  const db = sql();
  await db`
    insert into possible_duplicates (installation_id, location_id, contact_id, other_contact_id, score, tier, reasons)
    values (${installationId}, ${locationId}, ${contactId}, ${f.otherId}, ${f.score}, ${f.tier}, ${db.json(f.reasons as never)})
    on conflict (installation_id, location_id, contact_id, other_contact_id) do update set score = excluded.score, tier = excluded.tier, reasons = excluded.reasons`;
  return true;
}

/** The whole check for one contact-created event, bounded in time so the webhook answer stays quick. Returns what was found; never throws. */
export async function checkArrival(installationId: string, locationId: string, body: unknown, budgetMs = 2500): Promise<Found | null> {
  try {
    const inc = incomingFrom(body);
    if (!inc) return null;
    const work = (async () => { const f = await bestMatch(installationId, locationId, inc); if (f) await recordArrival(installationId, locationId, inc.contactId, f); return f; })();
    return await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), budgetMs))]);
  } catch {
    return null;
  }
}

export type Arrival = { id: string; locationId: string; locationName: string | null; contactId: string; otherId: string; otherName: string | null; newName: string | null; score: number; tier: string; reasons: string[]; at: string };

/** The newest arrivals that may already exist (not dismissed), for the caller's accounts. */
export async function listArrivals(installationId: string, allowed: string[] | null, limit = 5): Promise<Arrival[]> {
  if (!(await schemaReady()).possible) return [];
  const db = sql();
  const rows = await db`
    select d.id, d.location_id, l.name location_name, d.contact_id, d.other_contact_id, d.score, d.tier, d.reasons, d.created_at, n.full_name new_name, o.full_name other_name
    from possible_duplicates d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id and not l.ignored
    left join cached_contacts n on n.installation_id = d.installation_id and n.location_id = d.location_id and n.contact_id = d.contact_id
    left join cached_contacts o on o.installation_id = d.installation_id and o.location_id = d.location_id and o.contact_id = d.other_contact_id
    where d.installation_id = ${installationId} and d.status = 'new' and d.created_at > now() - interval '14 days' ${allowed ? db`and d.location_id = any(${allowed}::text[])` : db``}
    order by d.score desc, d.created_at desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id as string, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? null, contactId: r.contact_id as string, otherId: r.other_contact_id as string, otherName: (r.other_name as string | null) ?? null, newName: (r.new_name as string | null) ?? null, score: r.score as number, tier: r.tier as string, reasons: (r.reasons ?? []) as string[], at: (r.created_at as Date).toISOString() }));
}

export async function dismissArrival(installationId: string, allowed: string[] | null, id: string): Promise<boolean> {
  if (!(await schemaReady()).possible) return false;
  const db = sql();
  const done = await db`update possible_duplicates set status = 'dismissed' where id = ${id}::uuid and installation_id = ${installationId} ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} returning id`;
  return done.length > 0;
}
