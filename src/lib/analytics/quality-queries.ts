import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { schemaReady } from "./cleanup-config";
import { builtQueue, decisionSets } from "./dedupe-queries";
import {
  CAP_PER_FINDING, fixFor, scanContacts, scoreOf, trendOf, worstFirst, type FindingId, type Fix, type QRow, type Scan, type Score, type Snap, type Trend,
} from "./quality";

// The data-quality scan of one client account, its stored daily snapshots, and the lists behind every number (stage CLEANUP). Read only: SubSync reads its own copy of the
// contacts and writes only its own snapshot table. The same scan produces the counts, the score, the rows and the CSV, so a number always equals the rows behind it.

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

type Row = QRow & { name: string };
export type Scanned = { scan: Scan; rows: Map<string, Row>; score: Score | null; dup: { groups: number; extra: number; newGroups: number }; at: number };

const scans = ttlCache<Scanned>(60_000, 6);
const running = new Map<string, Promise<Scanned>>();

async function loadRows(installationId: string, locationId: string): Promise<Row[]> {
  const rows = await sql()`
    select contact_id, first_name, last_name, full_name, email, phone, tags, source from cached_contacts
    where installation_id = ${installationId} and location_id = ${locationId} limit 120000`;
  return rows.map((r) => ({
    id: r.contact_id as string, firstName: r.first_name as string | null, lastName: r.last_name as string | null, email: r.email as string | null, phone: r.phone as string | null,
    tags: (r.tags as string[]) ?? [], source: r.source as string | null,
    name: ((r.full_name as string | null) ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`).trim() || "Unnamed contact",
  }));
}

/** The open duplicate groups of ONE account, counted exactly as the Duplicates tab counts them (one list, one rule). */
export async function dupeNumbers(installationId: string, locationId: string, sinceMs: number | null, scope?: string[] | null): Promise<{ groups: number; extra: number; newGroups: number }> {
  // `scope` is the caller's whole set of accounts, so a portfolio read builds the queue once (it is cached) instead of once per account.
  const [b, sets] = await Promise.all([builtQueue(installationId, scope === undefined ? [locationId] : scope), decisionSets(installationId)]);
  const open = b.all.filter((g) => g.locationId === locationId && !sets.decided.has(`${g.locationId}:${g.key}`) && !sets.later.has(`${g.locationId}:${g.key}`));
  const newest = (g: (typeof open)[number]) => Math.max(0, ...g.people.map((p) => (p.createdAt ? Date.parse(p.createdAt) : 0)));
  return {
    groups: open.length, extra: open.reduce((s, g) => s + g.people.length - 1, 0),
    newGroups: sinceMs === null ? 0 : open.filter((g) => newest(g) > sinceMs).length,
  };
}

async function previousSnapshot(installationId: string, locationId: string): Promise<{ at: number } | null> {
  if (!(await schemaReady()).snapshots) return null;
  const [r] = await sql()`select created_at from cleanup_quality_snapshots where installation_id = ${installationId} and location_id = ${locationId} and day < current_date order by day desc limit 1`;
  return r ? { at: (r.created_at as Date).getTime() } : null;
}

async function saveSnapshot(installationId: string, locationId: string, s: Scanned): Promise<void> {
  if (!(await schemaReady()).snapshots) return;
  const db = sql();
  await db`
    insert into cleanup_quality_snapshots (installation_id, location_id, day, contacts, score, parts, counts, duplicate_groups, duplicate_extra, new_groups)
    values (${installationId}, ${locationId}, current_date, ${s.scan.total}, ${s.score?.score ?? null}, ${db.json((s.score?.parts ?? {}) as never)}, ${db.json(s.scan.counts as never)},
      ${s.dup.groups}, ${s.dup.extra}, ${s.dup.newGroups})
    on conflict (installation_id, location_id, day) do update set contacts = excluded.contacts, score = excluded.score, parts = excluded.parts, counts = excluded.counts,
      duplicate_groups = excluded.duplicate_groups, duplicate_extra = excluded.duplicate_extra, new_groups = excluded.new_groups, created_at = now()`;
}

/** Scans one account (cached a minute; two people opening it share one read) and stores today's snapshot. The caller has already checked the account is theirs. */
export async function scanAccount(installationId: string, locationId: string, countryCode: string | null = null, queueScope?: string[] | null): Promise<Scanned> {
  const key = `${installationId}|${locationId}|${countryCode ?? ""}`;
  const hit = scans.get(key);
  if (hit) return hit;
  const go = running.get(key);
  if (go) return go;
  const p = (async () => {
    const rows = await loadRows(installationId, locationId);
    const scan = scanContacts(rows, { countryCode });
    const prev = await previousSnapshot(installationId, locationId);
    const dup = await dupeNumbers(installationId, locationId, prev?.at ?? null, queueScope);
    const score = scoreOf(scan, dup.extra);
    const out: Scanned = { scan, rows: new Map(rows.map((r) => [r.id, r])), score, dup, at: Date.now() };
    scans.set(key, out);
    await saveSnapshot(installationId, locationId, out).catch(() => undefined);
    return out;
  })().finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

export const forgetScans = (installationId: string) => scans.clear(installationId + "|");

// ---------------- the portfolio ----------------

export type AccountScore = { locationId: string; name: string | null; score: number | null; contacts: number; day: string | null; duplicateGroups: number; counts: Partial<Record<FindingId, number>>; parts: Record<string, number> | null };

async function latestSnapshots(installationId: string, ids: string[]): Promise<Map<string, AccountScore>> {
  const out = new Map<string, AccountScore>();
  if (!(await schemaReady()).snapshots || ids.length === 0) return out;
  const rows = await sql()`
    select distinct on (location_id) location_id, day, contacts, score, parts, counts, duplicate_groups from cleanup_quality_snapshots
    where installation_id = ${installationId} and location_id = any(${ids}::text[]) order by location_id, day desc`;
  for (const r of rows) out.set(r.location_id as string, { locationId: r.location_id as string, name: null, score: r.score as number | null, contacts: r.contacts as number, day: dayOf(r.day as Date), duplicateGroups: r.duplicate_groups as number, counts: (r.counts ?? {}) as AccountScore["counts"], parts: (r.parts ?? null) as AccountScore["parts"] });
  return out;
}

/**
 * Every client account the caller may see with its score. Accounts with no snapshot from today are scanned now, one after another, until the time budget is spent;
 * the rest keep their last stored score, or "not scanned yet" (the overnight job scans them). A tiny account gets no score at all (not enough contacts).
 */
export async function portfolio(installationId: string, allowed: string[] | null, budgetMs = 6000): Promise<{ rows: AccountScore[]; scannedNow: number; pending: number }> {
  const db = sql();
  const locs = await db`select location_id, name from locations where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name`;
  const ids = locs.map((l) => l.location_id as string);
  const stored = await latestSnapshots(installationId, ids);
  const today = dayOf(new Date());
  const deadline = Date.now() + budgetMs;
  // Accounts without a snapshot from today are scanned four at a time until the budget is spent.
  const fresh = new Map<string, AccountScore>();
  const need = locs.filter((l) => stored.get(l.location_id as string)?.day !== today).map((l) => l.location_id as string);
  for (let i = 0; i < need.length && Date.now() < deadline && fresh.size < 40; i += 4) {
    await Promise.all(need.slice(i, i + 4).map(async (id) => {
      try {
        const s = await scanAccount(installationId, id, null, allowed);
        fresh.set(id, { locationId: id, name: null, score: s.score?.score ?? null, contacts: s.scan.total, day: today, duplicateGroups: s.dup.groups, counts: s.scan.counts, parts: s.score?.parts ?? null });
      } catch { /* keep the stored one */ }
    }));
  }
  const rows: AccountScore[] = locs.map((l) => {
    const id = l.location_id as string;
    const name = (l.name as string | null) ?? null;
    const got = fresh.get(id) ?? stored.get(id);
    return got ? { ...got, name } : { locationId: id, name, score: null, contacts: 0, day: null, duplicateGroups: 0, counts: {}, parts: null };
  });
  return { rows, scannedNow: fresh.size, pending: rows.filter((r) => r.day === null).length };
}

/** The whole portfolio in one number: the average score weighted by contacts, over the accounts that have one. */
export function portfolioScore(rows: readonly AccountScore[]): { score: number | null; accounts: number; scored: number } {
  const scored = rows.filter((r) => r.score !== null && r.contacts > 0);
  const weight = scored.reduce((s, r) => s + r.contacts, 0);
  return { score: weight === 0 ? null : Math.round(scored.reduce((s, r) => s + (r.score as number) * r.contacts, 0) / weight), accounts: rows.length, scored: scored.length };
}

export function ranked(rows: readonly AccountScore[]): AccountScore[] { return worstFirst(rows); }

/** Daily scores for one account (`locationId`) or for the whole portfolio (null: contact-weighted average per day). Stored snapshots only. */
export async function trendFor(installationId: string, allowed: string[] | null, locationId: string | null, days = 90): Promise<Trend> {
  if (!(await schemaReady()).snapshots) return trendOf([]);
  const db = sql();
  const rows = locationId
    ? await db`select day, score, contacts from cleanup_quality_snapshots where installation_id = ${installationId} and location_id = ${locationId} and score is not null and day > current_date - ${days}::int order by day`
    : await db`select day, score, contacts from cleanup_quality_snapshots where installation_id = ${installationId} and score is not null ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} and day > current_date - ${days}::int order by day`;
  const by = new Map<string, { w: number; s: number }>();
  for (const r of rows) {
    const k = dayOf(r.day as Date);
    const cur = by.get(k) ?? { w: 0, s: 0 };
    cur.w += r.contacts as number; cur.s += (r.score as number) * (r.contacts as number);
    by.set(k, cur);
  }
  const snaps: Snap[] = [...by].map(([day, v]) => ({ day, score: v.w ? Math.round(v.s / v.w) : 0 }));
  return trendOf(snaps);
}

// ---------------- the lists behind the numbers ----------------

export type FindingRow = { id: string; name: string; email: string | null; phone: string | null; fix: Fix[] | null };

export async function findingRows(installationId: string, locationId: string, id: FindingId, countryCode: string | null, limit = 500): Promise<{ count: number; rows: FindingRow[]; cut: boolean }> {
  const s = await scanAccount(installationId, locationId, countryCode);
  const ids = s.scan.ids[id];
  const rows = ids.slice(0, limit).map((cid) => {
    const r = s.rows.get(cid)!;
    return { id: cid, name: r.name, email: r.email, phone: r.phone, fix: fixFor(r, id, { countryCode }) };
  });
  const count = s.scan.counts[id];
  return { count, rows, cut: count > rows.length };
}

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** The fixes as CSV text: contact id, name, the problem, the field, what it is now and what it should be. Only SubSync's copy is read. */
export async function findingCsv(installationId: string, locationId: string, id: FindingId, countryCode: string | null, label: string): Promise<string> {
  const s = await scanAccount(installationId, locationId, countryCode);
  const lines = ["Contact id,Name,Problem,Field,Now,Should be"];
  for (const cid of s.scan.ids[id].slice(0, CAP_PER_FINDING)) {
    const r = s.rows.get(cid)!;
    const fix = fixFor(r, id, { countryCode });
    if (fix) for (const f of fix) lines.push([cid, r.name, label, f.field, f.before, f.after].map(csvCell).join(","));
    else lines.push([cid, r.name, label, "", "", ""].map(csvCell).join(","));
  }
  return lines.join("\n");
}

