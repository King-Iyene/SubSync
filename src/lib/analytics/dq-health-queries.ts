import { sql, type Sql } from "../db";
import {
  clampBaseline, clampDrop, DEFAULT_DROP_PCT, DEFAULT_MIN_BASELINE, emptyTarget, fromBuckets, HEALTH_VERSION, judgeWeek, NO_VIEWS, titleOf, type Health,
} from "../dq/health-core";

// Lead intake health (Lead intake tab): the low application measure per form and survey, the funnel pages, the redirects and trigger links. It reads the copies SubSync already holds
// (dq_forms, dq_submissions, dq_funnel_pages, dq_links); nothing here talks to the CRM and nothing here reads an answer. Every query filters by the installation AND the accounts the caller may see.

type Db = Sql;
export type HScope = { inst: string; allowed: string[] | null; location: string | null };
const scopeOf = (db: Db, alias: string, allowed: string[] | null) => (allowed ? db`and ${db.unsafe(alias)}.location_id = any(${allowed}::text[])` : db``);
const locOf = (db: Db, alias: string, location: string | null) => (location ? db`and ${db.unsafe(alias)}.location_id = ${location}` : db``);
const missing = (e: unknown) => (e as { code?: string })?.code === "42P01" || (e as { code?: string })?.code === "42703"; // the table or column is not there yet (before the migration)

export type HealthSettings = { dropPct: number; minBaseline: number };
export async function healthSettings(inst: string): Promise<HealthSettings> {
  const [r] = await sql()`select drop_pct, min_baseline from dq_health_settings where installation_id = ${inst}`.catch(() => []);
  return { dropPct: r ? clampDrop(r.drop_pct) : DEFAULT_DROP_PCT, minBaseline: r ? clampBaseline(r.min_baseline) : DEFAULT_MIN_BASELINE };
}
export async function setHealthSettings(inst: string, dropPct: number, minBaseline: number, actor: string | null): Promise<HealthSettings> {
  const d = clampDrop(dropPct), b = clampBaseline(minBaseline);
  await sql()`insert into dq_health_settings (installation_id, drop_pct, min_baseline, updated_by) values (${inst}, ${d}, ${b}, ${actor})
    on conflict (installation_id) do update set drop_pct = excluded.drop_pct, min_baseline = excluded.min_baseline, updated_by = excluded.updated_by, updated_at = now()`;
  return { dropPct: d, minBaseline: b };
}

export type FormHealth = { kind: "form" | "survey"; id: string; name: string; locationId: string; locationName: string | null; health: Health; weeks: number[] };

/** Every form and survey in scope, with the 5 week counts the rule uses (last 7 days, then the 4 weeks before) and the first submission SubSync holds. Newest activity first. */
export async function formHealth(s: HScope, st: HealthSettings, limit = 300): Promise<FormHealth[]> {
  const db = sql();
  const rows = await db`
    select f.kind, f.ext_id, f.name, f.location_id, l.name loc_name, w.b0, w.b1, w.b2, w.b3, w.b4, fi.first_at
    from dq_forms f join locations l on l.installation_id = f.installation_id and l.location_id = f.location_id and not l.ignored
    left join lateral (select
        count(*) filter (where x.submitted_at >= now() - interval '7 days')::int b0,
        count(*) filter (where x.submitted_at < now() - interval '7 days' and x.submitted_at >= now() - interval '14 days')::int b1,
        count(*) filter (where x.submitted_at < now() - interval '14 days' and x.submitted_at >= now() - interval '21 days')::int b2,
        count(*) filter (where x.submitted_at < now() - interval '21 days' and x.submitted_at >= now() - interval '28 days')::int b3,
        count(*) filter (where x.submitted_at < now() - interval '28 days' and x.submitted_at >= now() - interval '35 days')::int b4
      from dq_submissions x where x.installation_id = f.installation_id and x.location_id = f.location_id and x.kind = f.kind and x.ext_id = f.ext_id and x.submitted_at >= now() - interval '35 days') w on true
    left join lateral (select x.submitted_at first_at from dq_submissions x where x.installation_id = f.installation_id and x.location_id = f.location_id and x.kind = f.kind and x.ext_id = f.ext_id order by x.submitted_at asc limit 1) fi on true
    where f.installation_id = ${s.inst} and f.kind in ('form', 'survey') ${scopeOf(db, "f", s.allowed)} ${locOf(db, "f", s.location)}
    order by l.name, f.name limit ${limit}`;
  const now = Date.now();
  const out = rows.map((r): FormHealth => {
    const w = fromBuckets([r.b0, r.b1, r.b2, r.b3, r.b4] as number[]);
    const first = r.first_at instanceof Date ? r.first_at.getTime() : r.first_at ? new Date(r.first_at as string).getTime() : null;
    return { kind: r.kind as "form" | "survey", id: r.ext_id as string, name: r.name as string, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null,
      health: judgeWeek(w, first, now, st), weeks: [w.recent, ...w.previous] };
  });
  const rank = { drop: 0, ok: 1, zero_baseline: 2, not_enough_data: 3 } as const;
  return out.sort((a, b) => rank[a.health.verdict] - rank[b.health.verdict] || (b.health.dropPct ?? 0) - (a.health.dropPct ?? 0) || (a.locationName ?? "").localeCompare(b.locationName ?? "") || a.name.localeCompare(b.name));
}

export type FunnelHealth = { id: string; name: string; locationId: string; locationName: string | null; steps: number | null; pages: number | null; pageNames: string[]; views: null; viewsNote: string };
export async function funnelHealth(s: HScope, limit = 60): Promise<FunnelHealth[]> {
  const db = sql();
  const rows = await db`select f.ext_id, f.name, f.steps, f.pages, f.location_id, l.name loc_name,
      coalesce((select array_agg(p.name order by p.name) from (select name from dq_funnel_pages p where p.installation_id = f.installation_id and p.location_id = f.location_id and p.funnel_id = f.ext_id order by name limit 12) p), '{}') page_names
    from dq_forms f join locations l on l.installation_id = f.installation_id and l.location_id = f.location_id and not l.ignored
    where f.installation_id = ${s.inst} and f.kind = 'funnel' ${scopeOf(db, "f", s.allowed)} ${locOf(db, "f", s.location)} order by l.name, f.name limit ${limit}`;
  return rows.map((r) => ({ id: r.ext_id as string, name: r.name as string, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null,
    steps: (r.steps as number | null) ?? null, pages: (r.pages as number | null) ?? null, pageNames: (r.page_names as string[]) ?? [], views: null, viewsNote: NO_VIEWS }));
}

export type LinkHealth = { kind: "redirect" | "trigger"; id: string; name: string; target: string | null; empty: boolean; locationId: string; locationName: string | null };
export async function linkHealth(s: HScope, limit = 200): Promise<{ rows: LinkHealth[]; total: number; empty: number }> {
  const db = sql();
  const [t] = await db`select count(*)::int n, count(*) filter (where k.target is not null and btrim(k.target) = '')::int e from dq_links k join locations l on l.installation_id = k.installation_id and l.location_id = k.location_id and not l.ignored
    where k.installation_id = ${s.inst} ${scopeOf(db, "k", s.allowed)} ${locOf(db, "k", s.location)}`;
  const rows = await db`select k.kind, k.ext_id, k.name, k.target, k.location_id, l.name loc_name
    from dq_links k join locations l on l.installation_id = k.installation_id and l.location_id = k.location_id and not l.ignored
    where k.installation_id = ${s.inst} ${scopeOf(db, "k", s.allowed)} ${locOf(db, "k", s.location)} order by (k.target is not null and btrim(k.target) = '') desc, l.name, k.name limit ${limit}`;
  // the row flag is the one rule in health-core (emptyTarget); the SQL counts use the same rule (empty or only spaces)
  const list = rows.map((r): LinkHealth => { const target = (r.target as string | null) ?? null; return { kind: r.kind as "redirect" | "trigger", id: r.ext_id as string, name: r.name as string, target, empty: emptyTarget(target), locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null }; });
  return { rows: list, total: Number(t?.n ?? 0), empty: Number(t?.e ?? 0) };
}

export type AreaState = "ok" | "needs_permission" | "never";
/** Whether each area was read: ok when at least one account answered, "Needs permission: reconnect" when every answer was refused, never when nothing has been read. */
export async function healthStatus(s: HScope): Promise<Record<"forms" | "surveys" | "funnels" | "funnel_pages" | "redirects" | "links", AreaState>> {
  const db = sql();
  const rows = await db`select p.area, bool_or(p.status = 'ok') ok, bool_or(p.status = 'needs_permission') denied from dq_poll p join locations l on l.installation_id = p.installation_id and l.location_id = p.location_id and not l.ignored
    where p.installation_id = ${s.inst} ${scopeOf(db, "p", s.allowed)} ${locOf(db, "p", s.location)} group by p.area`.catch(() => []);
  const by = new Map(rows.map((r) => [r.area as string, r.ok === true ? "ok" : r.denied === true ? "needs_permission" : "never"] as const));
  const one = (a: string): AreaState => (by.get(a) as AreaState | undefined) ?? "never";
  return { forms: one("forms"), surveys: one("surveys"), funnels: one("funnels"), funnel_pages: one("funnel_pages"), redirects: one("redirects"), links: one("links") };
}

/**
 * The history (the platform keeps none): one row per form, survey or funnel per day. Forms and surveys: the last 7 days, the usual week and the verdict. Funnels: pages and steps (no views exist).
 * Idempotent: the same day twice is one row. Never throws; before the migration it does nothing.
 */
export async function recordHealth(inst: string): Promise<{ recorded: number }> {
  try {
    const db = sql();
    const st = await healthSettings(inst);
    const s: HScope = { inst, allowed: null, location: null };
    const forms = await formHealth(s, st, 2000);
    const funnels = await funnelHealth(s, 1000);
    const rows = [
      ...forms.map((f) => ({ installation_id: inst, location_id: f.locationId, kind: f.kind, ext_id: f.id, recent: f.health.verdict === "not_enough_data" ? null : f.health.recent, usual: f.health.usual, drop_pct: f.health.dropPct, verdict: f.health.verdict, pages: null as number | null, steps: null as number | null })),
      ...funnels.map((f) => ({ installation_id: inst, location_id: f.locationId, kind: "funnel", ext_id: f.id, recent: null as number | null, usual: null as number | null, drop_pct: null as number | null, verdict: "no_views", pages: f.pages, steps: f.steps })),
    ];
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300).map((r) => ({ ...r, day: new Date().toISOString().slice(0, 10), rules_version: HEALTH_VERSION }));
      await db`insert into dq_health_daily ${db(chunk, "installation_id", "location_id", "kind", "ext_id", "day", "recent", "usual", "drop_pct", "verdict", "pages", "steps", "rules_version")}
        on conflict (installation_id, location_id, kind, ext_id, day) do update set recent = excluded.recent, usual = excluded.usual, drop_pct = excluded.drop_pct, verdict = excluded.verdict, pages = excluded.pages, steps = excluded.steps, rules_version = excluded.rules_version, taken_at = now()`;
    }
    return { recorded: rows.length };
  } catch (e) {
    if (!missing(e)) console.error("Lead intake health record failed", (e as Error)?.message);
    return { recorded: 0 };
  }
}

/** In-app alert drafts for the existing alert engine (dedupe, quiet hours and digests are its job): one per form or survey whose last 7 days dropped past the threshold. */
export async function healthAlertDrafts(inst: string): Promise<Array<{ dedupeKey: string; kind: string; severity: "info" | "warning" | "critical"; locationId: string | null; title: string; detail: Record<string, unknown> }>> {
  try {
    const st = await healthSettings(inst);
    const list = await formHealth({ inst, allowed: null, location: null }, st, 2000);
    return list.filter((f) => f.health.verdict === "drop").slice(0, 60).map((f) => ({
      dedupeKey: `dq:low_applications:${f.locationId}:${f.kind}:${f.id}`.slice(0, 190), kind: "quality", severity: "warning" as const, locationId: f.locationId,
      title: `${f.locationName ?? "A client account"}: ${titleOf(f.name, f.kind, f.health)}`,
      detail: { dq: "low_applications", form: f.name, recent: f.health.recent, usual: f.health.usual, dropPct: f.health.dropPct, thresholdPct: st.dropPct },
    }));
  } catch { return []; }
}
