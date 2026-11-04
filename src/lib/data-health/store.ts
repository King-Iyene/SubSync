import { sql } from "../db";
import { duplicateGroups } from "../analytics/queries";
import { isMissing } from "../workflows/store";
import { DEFAULTS, type DhContact, type RuleId, type Settings } from "./rules";
import { bucketOf, scoreAccount, type Component, type ScoreResult } from "./score";
import { findSpikes, type Spike } from "./firewall";

// The only place the Data health module touches its tables (migration 20261106100000_data_health.sql). A missing table (42P01) or column (42703) answers
// "nothing yet", never an error page. Everything is keyed by installation and client account; the caller passes only accounts the signed session may see.
export const NEEDS_UPDATE = "Needs the latest database update. Ask the person who manages SubSync to apply it, then try again.";
async function safe<T>(run: () => PromiseLike<T>, fallback: T): Promise<T> {
  try { return await run(); } catch (e) { if (isMissing(e)) return fallback; throw e; }
}
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function loadSettings(installationId: string, locationId: string): Promise<Settings & { optOut: boolean }> {
  return safe(async () => {
    const rows = await sql()`select location_id, junk_words, stale_days, phone_region, spike_min, benchmark_opt_out from dh_rules where installation_id = ${installationId} and location_id in (${locationId}, '*')`;
    const all = rows.find((r) => r.location_id === "*"), mine = rows.find((r) => r.location_id === locationId);
    const pick = <T,>(a: T | null | undefined, b: T | null | undefined, d: T) => (a ?? b ?? d);
    return {
      junkWords: [...new Set([...((all?.junk_words as string[]) ?? []), ...((mine?.junk_words as string[]) ?? [])])],
      staleDays: pick(mine?.stale_days as number | null, all?.stale_days as number | null, DEFAULTS.staleDays),
      phoneRegion: pick(mine?.phone_region as string | null, all?.phone_region as string | null, DEFAULTS.phoneRegion),
      spikeMin: pick(mine?.spike_min as number | null, all?.spike_min as number | null, DEFAULTS.spikeMin),
      optOut: Boolean(all?.benchmark_opt_out),
    };
  }, { ...DEFAULTS, optOut: false });
}
export async function loadRules(installationId: string, allowed: string[] | null) {
  return safe(async () => (await sql()`select location_id, junk_words, stale_days, phone_region, spike_min, benchmark_opt_out from dh_rules where installation_id = ${installationId} ${allowed === null ? sql()`` : sql()`and (location_id = '*' or location_id = any(${allowed}::text[]))`}`).map((r) => ({
    locationId: r.location_id as string, junkWords: (r.junk_words as string[]) ?? [], staleDays: r.stale_days as number | null, phoneRegion: r.phone_region as string | null, spikeMin: r.spike_min as number | null, optOut: Boolean(r.benchmark_opt_out),
  })), []);
}
export async function saveRules(installationId: string, locationId: string, p: { junkWords?: string[]; staleDays?: number | null; phoneRegion?: string | null; spikeMin?: number | null; optOut?: boolean }, by: string) {
  const db = sql();
  const [cur] = await safe(() => db`select junk_words, stale_days, phone_region, spike_min, benchmark_opt_out from dh_rules where installation_id = ${installationId} and location_id = ${locationId}`, [] as never);
  const next = {
    junk: p.junkWords ?? (cur?.junk_words as string[]) ?? [], stale: p.staleDays !== undefined ? p.staleDays : (cur?.stale_days as number | null) ?? null,
    region: p.phoneRegion !== undefined ? p.phoneRegion : (cur?.phone_region as string | null) ?? null, spike: p.spikeMin !== undefined ? p.spikeMin : (cur?.spike_min as number | null) ?? null,
    opt: p.optOut ?? Boolean(cur?.benchmark_opt_out),
  };
  await db`insert into dh_rules (installation_id, location_id, junk_words, stale_days, phone_region, spike_min, benchmark_opt_out, updated_by) values (${installationId}, ${locationId}, ${next.junk}, ${next.stale}, ${next.region}, ${next.spike}, ${next.opt}, ${by})
    on conflict (installation_id, location_id) do update set junk_words = excluded.junk_words, stale_days = excluded.stale_days, phone_region = excluded.phone_region, spike_min = excluded.spike_min, benchmark_opt_out = excluded.benchmark_opt_out, updated_by = excluded.updated_by, updated_at = now()`;
}

export async function loadContacts(installationId: string, locationId: string, now: number): Promise<DhContact[]> {
  const rows = await sql()`
    select c.contact_id, c.first_name, c.last_name, c.email, c.phone, c.source, c.dnd, c.assigned_to, c.date_added, c.last_activity_at,
      exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id) has_deal,
      exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open') has_open,
      exists (select 1 from cached_conversations v where v.installation_id = c.installation_id and v.location_id = c.location_id and v.contact_id = c.contact_id) has_conv,
      exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and a.start_at > ${new Date(now)} and coalesce(a.status, '') not in ('cancelled', 'canceled', 'noshow', 'no_show')) has_appt,
      ${await touched(installationId, locationId, now)}::text[] @> array[c.contact_id] touched
    from cached_contacts c where c.installation_id = ${installationId} and c.location_id = ${locationId} limit 60000`;
  return rows.map((r) => ({
    contactId: r.contact_id as string, locationId, firstName: r.first_name as string | null, lastName: r.last_name as string | null, email: r.email as string | null, phone: r.phone as string | null,
    source: r.source as string | null, dnd: Boolean(r.dnd), assignedTo: r.assigned_to as string | null, dateAdded: ms(r.date_added), lastActivityAt: ms(r.last_activity_at),
    hasDeal: Boolean(r.has_deal), hasOpenDeal: Boolean(r.has_open), hasConversation: Boolean(r.has_conv), hasUpcomingAppt: Boolean(r.has_appt), touchedBySubSync: Boolean(r.touched),
  }));
}
/** Contacts SubSync itself changed in the last 7 days: their activity date is ours, so "stale" is not judged on it (our own writes never change our own numbers). */
async function touched(installationId: string, locationId: string, now: number): Promise<string[]> {
  return safe(async () => (await sql()`select distinct contact_id from dh_changes where installation_id = ${installationId} and location_id = ${locationId} and created_at > ${new Date(now - 7 * 86_400_000)}`).map((r) => r.contact_id as string), []);
}
/** The extra copies of the same person, from the one duplicate finder the product already has (never a second implementation). */
export async function dupExtras(installationId: string, locationId: string): Promise<Set<string>> {
  const groups = await duplicateGroups(installationId, 20000, locationId);
  const out = new Set<string>();
  for (const g of groups) for (const id of g.contactIds.slice(1)) out.add(id);
  return out;
}
export async function loadMarks(installationId: string, allowed: string[] | null) {
  return safe(async () => (await sql()`select location_id, contact_id, state, owner, note, updated_by, updated_at from dh_marks where installation_id = ${installationId} ${allowed === null ? sql()`` : sql()`and location_id = any(${allowed}::text[])`}`).map((r) => ({
    locationId: r.location_id as string, contactId: r.contact_id as string, state: r.state as "todo" | "ignored" | "fixed", owner: r.owner as string | null, note: r.note as string | null, by: r.updated_by as string | null, at: ms(r.updated_at) ?? 0,
  })), []);
}
export async function saveMark(installationId: string, locationId: string, contactIds: string[], p: { state?: "todo" | "ignored" | "fixed" | "open"; owner?: string | null; note?: string | null }, by: string) {
  const db = sql();
  if (p.state === "open") { await db`delete from dh_marks where installation_id = ${installationId} and location_id = ${locationId} and contact_id = any(${contactIds}::text[])`; return; }
  for (const id of contactIds) {
    await db`insert into dh_marks (installation_id, location_id, contact_id, state, owner, note, updated_by) values (${installationId}, ${locationId}, ${id}, ${p.state ?? "todo"}, ${p.owner ?? null}, ${p.note ?? null}, ${by})
      on conflict (installation_id, location_id, contact_id) do update set state = coalesce(${p.state ?? null}, dh_marks.state), owner = case when ${p.owner !== undefined} then ${p.owner ?? null} else dh_marks.owner end, note = case when ${p.note !== undefined} then ${p.note ?? null} else dh_marks.note end, updated_by = excluded.updated_by, updated_at = now()`;
  }
}

export type Computed = ScoreResult & { locationId: string; bucket: string; spikes: Spike[]; day: string };
/** Reads one account, scores it and writes today's snapshot and the flag history. Idempotent for the same day. */
export async function snapshotAccount(installationId: string, locationId: string, now: number): Promise<Computed> {
  const [settings, contacts, extras] = await Promise.all([loadSettings(installationId, locationId), loadContacts(installationId, locationId, now), dupExtras(installationId, locationId)]);
  const ignored = new Set((await loadMarks(installationId, [locationId])).filter((m) => m.state === "ignored").map((m) => m.contactId));
  const res = scoreAccount(contacts, extras, ignored, settings, now);
  const [prof] = await safe(() => sql()`select industry from account_profiles where installation_id = ${installationId} and location_id = ${locationId}`, [] as never);
  const bucket = bucketOf(res.total, (prof?.industry as string | null) ?? null);
  const day = dayOf(now);
  const spikes = findSpikes(contacts.filter((c) => !ignored.has(c.contactId)), extras, settings, now);
  await persist(installationId, locationId, day, res, bucket);
  return { ...res, locationId, bucket, spikes, day };
}

async function persist(installationId: string, locationId: string, day: string, r: ScoreResult, bucket: string) {
  const db = sql();
  await safe(async () => {
    await db.begin(async (tx) => {
      await tx`insert into dh_snapshots (installation_id, location_id, day, score, total, components, bucket) values (${installationId}, ${locationId}, ${day}, ${r.score}, ${r.total}, ${tx.json(r.components.map((c) => ({ id: c.id, count: c.count, penalty: c.penalty })) as never)}, ${bucket})
        on conflict (installation_id, location_id, day) do update set score = excluded.score, total = excluded.total, components = excluded.components, bucket = excluded.bucket, taken_at = now()`;
      const ids = r.flags.map((f) => f.contactId), rules = r.flags.map((f) => f.rule);
      for (let i = 0; i < ids.length; i += 5000) {
        await tx`insert into dh_flags (installation_id, location_id, contact_id, rule, first_seen_day, last_seen_day)
          select ${installationId}, ${locationId}, x.c, x.r, ${day}::date, ${day}::date from unnest(${ids.slice(i, i + 5000)}::text[], ${rules.slice(i, i + 5000)}::text[]) as x(c, r)
          on conflict (installation_id, location_id, contact_id, rule) do update set last_seen_day = excluded.last_seen_day, fixed_at = null`;
      }
      // Flags that were open and are no longer flagged today were fixed (or the record is gone). Recorded once, with the time we noticed.
      const keys = r.flags.map((f) => `${f.contactId}|${f.rule}`);
      await tx`update dh_flags set fixed_at = now() where installation_id = ${installationId} and location_id = ${locationId} and fixed_at is null and last_seen_day < ${day}::date and not ((contact_id || '|' || rule) = any(${keys}::text[]))`;
    });
  }, undefined);
}

export type SnapRow = { locationId: string; day: string; score: number | null; total: number; components: Array<{ id: RuleId; count: number; penalty: number }>; bucket: string | null };
export async function loadSnapshots(installationId: string, allowed: string[] | null, sinceDay: string): Promise<SnapRow[]> {
  return safe(async () => (await sql()`select location_id, to_char(day, 'YYYY-MM-DD') d, score, total, components, bucket from dh_snapshots where installation_id = ${installationId} and day >= ${sinceDay}::date ${allowed === null ? sql()`` : sql()`and location_id = any(${allowed}::text[])`} order by day`).map((r) => ({
    locationId: r.location_id as string, day: r.d as string, score: r.score as number | null, total: Number(r.total), components: r.components as SnapRow["components"], bucket: r.bucket as string | null,
  })), []);
}
export async function flagTotals(installationId: string, allowed: string[] | null) {
  const [r] = await safe(() => sql()`select count(*)::int found, count(*) filter (where fixed_at is not null)::int fixed from dh_flags where installation_id = ${installationId} ${allowed === null ? sql()`` : sql()`and location_id = any(${allowed}::text[])`}`, [{ found: 0, fixed: 0 }] as never);
  return { found: Number(r?.found ?? 0), fixed: Number(r?.fixed ?? 0) };
}

export type FlagRow = { contactId: string; rule: RuleId; firstSeen: string; fixedAt: number | null; name: string; email: string | null; phone: string | null; source: string | null; gone: boolean };
/** The records behind one number on one day. `day` null means now (open flags). A past day: first seen on or before it and not yet fixed that day. */
export async function flagRecords(installationId: string, locationId: string, rule: string | null, day: string | null, limit: number): Promise<{ rows: FlagRow[]; total: number }> {
  const cond = day === null
    ? sql()`f.fixed_at is null`
    : sql()`f.first_seen_day <= ${day}::date and (f.fixed_at is null or f.fixed_at::date > ${day}::date)`;
  const [t] = await safe(() => sql()`select count(*)::int n from dh_flags f where f.installation_id = ${installationId} and f.location_id = ${locationId} and (${rule}::text is null or f.rule = ${rule}) and ${cond}
    and not exists (select 1 from dh_marks m where m.installation_id = f.installation_id and m.location_id = f.location_id and m.contact_id = f.contact_id and m.state = 'ignored')`, [{ n: 0 }] as never);
  const rows = await safe(() => sql()`select f.contact_id, f.rule, to_char(f.first_seen_day, 'YYYY-MM-DD') fs, f.fixed_at, c.contact_id present, btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) nm, c.email, c.phone, c.source
    from dh_flags f left join cached_contacts c on c.installation_id = f.installation_id and c.location_id = f.location_id and c.contact_id = f.contact_id
    where f.installation_id = ${installationId} and f.location_id = ${locationId} and (${rule}::text is null or f.rule = ${rule}) and ${cond}
    and not exists (select 1 from dh_marks m where m.installation_id = f.installation_id and m.location_id = f.location_id and m.contact_id = f.contact_id and m.state = 'ignored')
    order by f.first_seen_day desc, f.contact_id limit ${limit}`, [] as never);
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({ contactId: r.contact_id as string, rule: r.rule as RuleId, firstSeen: r.fs as string, fixedAt: ms(r.fixed_at), name: (r.nm as string) || "(no name)", email: r.email as string | null, phone: r.phone as string | null, source: r.source as string | null, gone: !r.present })),
  };
}
/** Bad records by where they came from: the import guard view. */
export async function badBySource(installationId: string, locationId: string, since: string) {
  return safe(async () => (await sql()`select coalesce(nullif(btrim(c.source), ''), 'Unknown source') src, count(distinct f.contact_id)::int n, count(distinct f.contact_id) filter (where f.first_seen_day >= ${since}::date)::int recent, array_agg(distinct f.rule) rules
    from dh_flags f join cached_contacts c on c.installation_id = f.installation_id and c.location_id = f.location_id and c.contact_id = f.contact_id
    where f.installation_id = ${installationId} and f.location_id = ${locationId} and f.fixed_at is null and f.rule in ('duplicate', 'junk', 'bad_phone', 'bad_email') group by 1 order by 2 desc limit 50`).map((r) => ({ source: r.src as string, count: Number(r.n), recent: Number(r.recent), rules: r.rules as string[] })), []);
}

export async function benchmark(installationId: string, bucket: string | null) {
  if (!bucket) return null;
  return safe(async () => {
    const [mine] = await sql()`select benchmark_opt_out o from dh_rules where installation_id = ${installationId} and location_id = '*'`;
    if (mine?.o) return null;
    const [r] = await sql()`
      with latest as (select distinct on (s.installation_id, s.location_id) s.installation_id, s.score from dh_snapshots s
        where s.bucket = ${bucket} and s.score is not null and s.day >= current_date - 14
        and not exists (select 1 from dh_rules r where r.installation_id = s.installation_id and r.location_id = '*' and r.benchmark_opt_out)
        order by s.installation_id, s.location_id, s.day desc)
      select count(*)::int n, count(distinct installation_id)::int companies, percentile_cont(0.25) within group (order by score) p25, percentile_cont(0.5) within group (order by score) median, percentile_cont(0.75) within group (order by score) p75 from latest`;
    return r && Number(r.n) > 0 ? { n: Number(r.n), companies: Number(r.companies), p25: Number(r.p25), median: Number(r.median), p75: Number(r.p75) } : null;
  }, null);
}

export async function appendFixChange(c: { installationId: string; locationId: string; contactId: string; field: string; before: string; after: string; outcome: string; actorKey: string; actorName: string | null; opKey: string; undoes?: number }): Promise<number | null> {
  return safe(async () => {
    const [r] = await sql()`insert into dh_changes (installation_id, location_id, contact_id, field, before_value, after_value, outcome, actor_key, actor_name, op_key, undoes) values (${c.installationId}, ${c.locationId}, ${c.contactId}, ${c.field}, ${c.before}, ${c.after}, ${c.outcome}, ${c.actorKey}, ${c.actorName}, ${c.opKey}, ${c.undoes ?? null})
      on conflict (installation_id, op_key) do nothing returning id`;
    return r ? Number(r.id) : null;
  }, null);
}
export async function fixesToday(installationId: string, locationId: string, now: number): Promise<number> {
  const [r] = await safe(() => sql()`select count(*)::int n from dh_changes where installation_id = ${installationId} and location_id = ${locationId} and undoes is null and outcome in ('done', 'dry_run') and created_at > ${new Date(now - 86_400_000)}`, [{ n: 0 }] as never);
  return Number(r?.n ?? 0);
}
export async function loadFixChanges(installationId: string, locationId: string, limit = 200) {
  return safe(async () => (await sql()`select id, contact_id, field, before_value, after_value, outcome, actor_name, created_at, undoes, undone_at from dh_changes where installation_id = ${installationId} and location_id = ${locationId} order by id desc limit ${limit}`).map((r) => ({
    id: Number(r.id), contactId: r.contact_id as string, field: r.field as string, before: (r.before_value as string) ?? "", after: (r.after_value as string) ?? "", outcome: r.outcome as string, who: (r.actor_name as string | null) ?? "Someone", at: ms(r.created_at) ?? 0, undoes: r.undoes ? Number(r.undoes) : null, undone: Boolean(r.undone_at),
  })), []);
}
export async function markUndone(installationId: string, id: number) { await sql()`update dh_changes set undone_at = now() where installation_id = ${installationId} and id = ${id} and undone_at is null`; }

// ---- the proof loop: what was raised, when it ended and how
export async function openOutcome(installationId: string, locationId: string | null, dedupeKey: string, title: string) {
  await safe(() => sql()`insert into dh_outcomes (installation_id, location_id, dedupe_key, title) values (${installationId}, ${locationId}, ${dedupeKey}, ${title}) on conflict (installation_id, dedupe_key) do nothing`, [] as never);
}
export async function closeOutcomes(installationId: string, keepKeys: string[], by: string, how: string) {
  await safe(() => sql()`update dh_outcomes set resolved_at = now(), resolved_by = ${by}, how = ${how} where installation_id = ${installationId} and resolved_at is null and not (dedupe_key = any(${keepKeys}::text[]))`, [] as never);
}
export async function outcomeStats(installationId: string, allowed: string[] | null, sinceMs: number) {
  const [r] = await safe(() => sql()`select count(*)::int raised, count(resolved_at)::int fixed, round((avg(extract(epoch from (resolved_at - raised_at)) / 3600) filter (where resolved_at is not null))::numeric, 1) hours
    from dh_outcomes where installation_id = ${installationId} and raised_at >= ${new Date(sinceMs)} ${allowed === null ? sql()`` : sql()`and location_id = any(${allowed}::text[])`}`, [{ raised: 0, fixed: 0, hours: null }] as never);
  return { raised: Number(r?.raised ?? 0), fixed: Number(r?.fixed ?? 0), avgHoursToFix: r?.hours === null || r?.hours === undefined ? null : Number(r.hours) };
}
export async function benchmarkOptOut(installationId: string): Promise<boolean> { return (await loadSettings(installationId, "*")).optOut; }
export type { Component };
