import { sql } from "../db";
import { APP_TZ, rollupFromDay, rollupUntilDay, zoneOf } from "../design/zone";
import { deals, P_OPEN, type Scope } from "./pipeline3-queries";

// PIPELINE ROLLUP: every deal of an account is counted once, by the same rules as the live scan (deals(): value, owner, test, outlier, stuck, out of scope), and summed into
// pipeline_rollup. The screens then add up a few thousand rows instead of reading every deal. The rollup is rebuilt per account by refreshRollup (hourly sweep, after a sync,
// and on demand), inside one transaction, so a reader sees the old totals or the new ones, never half. If it is empty or older than STALE_HOURS the screens use the live scan
// and say the numbers are refreshing. Reads are always scoped to the caller's installation and the accounts they may see.
type Db = ReturnType<typeof sql>;
export const STALE_HOURS = 2, FULL_EVERY_HOURS = 6;

/** The shared predicates, on the rollup's columns. They mirror P_OPEN, P_STALE, P_NO_OWNER, P_NO_VALUE and P_FLAG of the live scan one for one. */
export const R = {
  open: (db: Db) => db`(r.status = 'open' and r.has_value and r.has_owner and not r.oos and not r.is_test and not r.outlier)`,
  stale: (db: Db) => db`(r.status = 'open' and r.has_value and r.has_owner and not r.oos and not r.is_test and not r.outlier and r.stale)`,
  noOwner: (db: Db) => db`(r.status = 'open' and not r.oos and not r.is_test and r.has_value and not r.has_owner)`,
  noValue: (db: Db) => db`(r.status = 'open' and not r.oos and not r.is_test and not r.has_value)`,
  flag: (db: Db) => db`(r.status = 'open' and not r.oos and (r.is_test or r.stale or r.outlier or (r.has_value and not r.has_owner) or not r.has_value))`,
  // closed_day is the account's LOCAL day (docs/DATE_RULES.md): a window [from, to) in real instants touches the days from localDay(from) up to the one before rollupUntilDay(to).
  closedIn: (db: Db, status: "won" | "lost", from: Date, to: Date | null) => db`(r.status = ${status} and not r.is_test and r.closed_day >= ${rollupFromDay(from.getTime())}::date ${to ? db`and r.closed_day < ${rollupUntilDay(to.getTime())}::date` : db``})`,
};

function accountScope(db: Db, s: Scope, location?: string | null) {
  return db`select l.location_id from locations l where l.installation_id = ${s.inst} and not l.ignored ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``} ${location ? db`and l.location_id = ${location}` : db``}`;
}

/** Is the rollup usable for these accounts? Every account in scope needs a refresh newer than STALE_HOURS. */
const freshMemo = new Map<string, { at: number; v: { fresh: boolean; refreshedAt: string | null } }>();
export async function rollupFresh(s: Scope, location?: string | null): Promise<{ fresh: boolean; refreshedAt: string | null }> {
  // Asked for by every screen, so it is remembered for a minute (one round trip saved per screen).
  const mk = JSON.stringify([s.inst, s.allowed, location ?? null]), hit = freshMemo.get(mk);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = await rollupFreshNow(s, location);
  if (freshMemo.size > 500) freshMemo.clear();
  freshMemo.set(mk, { at: Date.now(), v });
  return v;
}
export function forgetFresh() { freshMemo.clear(); }
async function rollupFreshNow(s: Scope, location?: string | null): Promise<{ fresh: boolean; refreshedAt: string | null }> {
  const db = sql();
  const r = (await db`
    select count(*)::int accounts, count(st.refreshed_at)::int have, count(*) filter (where st.refreshed_at > now() - ${STALE_HOURS} * interval '1 hour')::int fresh, min(st.refreshed_at) oldest
    from (${accountScope(db, s, location)}) l left join pipeline_rollup_state st on st.installation_id = ${s.inst} and st.location_id = l.location_id`)[0];
  const accounts = Number(r?.accounts ?? 0);
  return { fresh: accounts > 0 && Number(r.fresh) === accounts, refreshedAt: r?.oldest instanceof Date ? r.oldest.toISOString() : null };
}

/** Rebuild the totals of one installation (every account, or the ones named). An account is rebuilt when a deal was saved since its last refresh, when it has never been built, or after FULL_EVERY_HOURS (the full fallback, which also catches deals removed in the CRM). `force` rebuilds all. Safe to run twice. */
export async function refreshRollup(inst: string, o: { locations?: string[] | null; force?: boolean } = {}, db: Db = sql()): Promise<{ accounts: number; rebuilt: number; rows: number }> {
  const acct = await db`select l.location_id, l.timezone from locations l where l.installation_id = ${inst} and not l.ignored ${o.locations ? db`and l.location_id = any(${o.locations}::text[])` : db``}`;
  const accounts = acct.map((r) => r.location_id as string);
  const zones = new Map(acct.map((r) => [r.location_id as string, zoneOf(r.timezone)]));
  let rebuilt = 0, rows = 0;
  for (const loc of accounts) {
    const st = (await db`select refreshed_at, (select max(o.synced_at) from cached_opportunities o where o.installation_id = ${inst} and o.location_id = ${loc}) last_saved from pipeline_rollup_state where installation_id = ${inst} and location_id = ${loc}`)[0];
    const refreshed = st?.refreshed_at instanceof Date ? st.refreshed_at.getTime() : 0, saved = st?.last_saved instanceof Date ? st.last_saved.getTime() : 0;
    const noState = !st; let needs = o.force === true || noState || saved > refreshed || Date.now() - refreshed > FULL_EVERY_HOURS * 3_600_000;
    if (!needs && !noState) { const [x] = await db`select count(*)::int n from cached_opportunities where installation_id = ${inst} and location_id = ${loc}`; needs = Number(x.n) !== Number(st.deals ?? -1); }
    if (!needs) continue;
    const scope: Scope = { inst, allowed: [loc] }, now = new Date(), tz = zones.get(loc) ?? APP_TZ;
    await db.begin(async (tx) => {
      const T = tx as unknown as Db;
      await T`delete from pipeline_rollup where installation_id = ${inst} and location_id = ${loc}`;
      const ins = await T`
        with ${deals(scope, { from: now, to: now, location: loc, includeTest: false })},
        big as (select percentile_cont(0.9) within group (order by d.value) p90, count(*) n from d where ${P_OPEN(T)}),
        med as (select d.pipeline_id, coalesce(d.stage_id, '') stage_id, percentile_cont(0.5) within group (order by d.days_in_stage) med, max(d.norm_days) norm, max(d.stays)::int stays from d where ${P_OPEN(T)} group by 1, 2),
        g as (
          select d.pipeline_id, coalesce(d.stage_id, '') stage_id, coalesce(d.owner, '') owner_id, coalesce(d.source, '') source, d.status, d.is_test, d.out_of_scope oos, d.value > 0 has_value, d.owner_ok has_owner, d.outlier, d.stale,
            (${P_OPEN(T)} and big.n >= 10 and d.value >= big.p90 and coalesce(greatest(d.last_activity_at, d.last_stage_change_at, d.last_status_change_at), d.created_at) < now() - interval '14 days') big_untouched,
            case when d.status <> 'open' and d.last_status_change_at is not null then (d.last_status_change_at at time zone ${tz})::date else date '1970-01-01' end closed_day,
            case when d.status = 'lost' then coalesce(d.lost_reason, case when d.lost_reason_id is not null then 'Reason ' || right(d.lost_reason_id, 4) end, '') else '' end lost_reason,
            count(*)::int n, sum(d.value)::float8 value
          from d, big where d.pipeline_id is not null group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
        )
        insert into pipeline_rollup (installation_id, location_id, pipeline_id, stage_id, owner_id, source, status, is_test, oos, has_value, has_owner, outlier, stale, big_untouched, closed_day, lost_reason, n, value, med_days, norm_days, stays)
        select ${inst}, ${loc}, g.pipeline_id, g.stage_id, g.owner_id, g.source, g.status, g.is_test, g.oos, g.has_value, g.has_owner, g.outlier, g.stale, g.big_untouched, g.closed_day, g.lost_reason, g.n, g.value, m.med, m.norm, m.stays
        from g left join med m on m.pipeline_id = g.pipeline_id and m.stage_id = g.stage_id returning n`;
      const total = ins.reduce((a, r) => a + Number(r.n), 0);
      await T`insert into pipeline_rollup_state (installation_id, location_id, refreshed_at, deals, rows_written) values (${inst}, ${loc}, now(), ${total}, ${ins.length})
        on conflict (installation_id, location_id) do update set refreshed_at = now(), deals = excluded.deals, rows_written = excluded.rows_written`;
      rows += ins.length;
    });
    rebuilt++;
  }
  forgetFresh();
  return { accounts: accounts.length, rebuilt, rows };
}

/** Everything the Overview's headline row needs, from the rollup (the same names the live query returns). */
export async function rollupHeadline(s: Scope, f: { location?: string | null; pipeline?: string | null; d30: Date }) {
  const db = sql();
  const [t] = await db`
    select coalesce(sum(r.n) filter (where ${R.open(db)}), 0)::int open_n, coalesce(sum(r.value) filter (where ${R.open(db)}), 0)::float8 open_v,
      coalesce(sum(r.n) filter (where ${R.stale(db)}), 0)::int stale_n, coalesce(sum(r.value) filter (where ${R.stale(db)}), 0)::float8 stale_v,
      coalesce(sum(r.n) filter (where ${R.closedIn(db, "won", f.d30, null)}), 0)::int won_n, coalesce(sum(r.value) filter (where ${R.closedIn(db, "won", f.d30, null)}), 0)::float8 won_v,
      coalesce(sum(r.n) filter (where ${R.closedIn(db, "lost", f.d30, null)}), 0)::int lost_n, coalesce(sum(r.value) filter (where ${R.closedIn(db, "lost", f.d30, null)}), 0)::float8 lost_v,
      coalesce(sum(r.n) filter (where ${R.noOwner(db)}), 0)::int no_owner, coalesce(sum(r.n) filter (where ${R.noValue(db)}), 0)::int no_value,
      coalesce(sum(r.n) filter (where r.is_test and r.status = 'open' and not r.oos), 0)::int test, coalesce(sum(r.n) filter (where r.outlier), 0)::int outliers,
      coalesce(sum(r.n) filter (where r.status = 'lost' and not r.is_test and r.closed_day >= ${rollupFromDay(f.d30.getTime())}::date and r.lost_reason = ''), 0)::int no_reason,
      coalesce(sum(r.n) filter (where r.status = 'open' and not r.oos), 0)::int open_all, coalesce(sum(r.n) filter (where ${R.flag(db)}), 0)::int flagged,
      coalesce(sum(r.n) filter (where r.big_untouched), 0)::int big_n, coalesce(sum(r.value) filter (where r.big_untouched), 0)::float8 big_v
    from pipeline_rollup r where r.installation_id = ${s.inst} and r.location_id in (${accountScope(db, s, f.location)}) ${pipeFilter(db, s, f.pipeline)}`;
  return t;
}

function pipeFilter(db: Db, s: Scope, pipeline?: string | null) {
  if (!pipeline) return db``;
  const key = pipeline.trim().toLowerCase().replace(/\s+/g, " ");
  return db`and (r.location_id, r.pipeline_id) in (select p.location_id, p.pipeline_id from pipelines p where p.installation_id = ${s.inst} and lower(regexp_replace(btrim(coalesce(p.name, '')), '[[:space:]]+', ' ', 'g')) = ${key})`;
}

/** Open money per (account, stage), for the stage table of the Overview. */
export async function rollupOpenByStage(s: Scope, f: { location?: string | null; pipeline?: string | null }) {
  const db = sql();
  return db`select r.location_id, r.stage_id, coalesce(sum(r.n) filter (where ${R.open(db)}), 0)::int n, coalesce(sum(r.value) filter (where ${R.open(db)}), 0)::float8 v,
      coalesce(sum(r.n) filter (where ${R.stale(db)}), 0)::int sn, coalesce(sum(r.value) filter (where ${R.stale(db)}), 0)::float8 sv
    from pipeline_rollup r where r.installation_id = ${s.inst} and r.location_id in (${accountScope(db, s, f.location)}) and r.status = 'open' ${pipeFilter(db, s, f.pipeline)} group by 1, 2`;
}

/** Wins and losses per day, for the Overview trend. */
export async function rollupCloses(s: Scope, f: { location?: string | null; pipeline?: string | null }, days: number) {
  const db = sql();
  return db`select r.closed_day dy, coalesce(sum(r.n) filter (where r.status = 'won'), 0)::int won, coalesce(sum(r.n) filter (where r.status = 'lost'), 0)::int lost
    from pipeline_rollup r where r.installation_id = ${s.inst} and r.location_id in (${accountScope(db, s, f.location)}) and r.status in ('won', 'lost') and not r.is_test
      and r.closed_day >= ${rollupFromDay(Date.now() - days * 86_400_000)}::date ${pipeFilter(db, s, f.pipeline)} group by 1`;
}

/** The stage rows, lost rows (with their reason) and won totals of the stacks, from the rollup. Same shapes as the live parts. */
export async function rollupFlow(s: Scope, f: { location?: string | null; pipeline?: string | null; from: Date; to: Date }) {
  const db = sql(), base = db`r.installation_id = ${s.inst} and r.location_id in (${accountScope(db, s, f.location)})`, pf = pipeFilter(db, s, f.pipeline);
  const [open, drain, [vault]] = await Promise.all([
    db`select r.location_id, r.stage_id, sum(r.n)::int n, sum(r.value)::float8 v, coalesce(sum(r.n) filter (where r.stale), 0)::int sn, coalesce(sum(r.value) filter (where r.stale), 0)::float8 sv,
        max(r.med_days) med, max(r.norm_days) norm, max(r.stays)::int stays
       from pipeline_rollup r where ${base} and ${R.open(db)} ${pf} group by 1, 2`,
    db`select r.location_id, r.stage_id, nullif(r.lost_reason, '') reason, sum(r.n)::int n, sum(r.value)::float8 v from pipeline_rollup r
       where ${base} and ${R.closedIn(db, "lost", f.from, f.to)} and r.has_value ${pf} group by 1, 2, 3`,
    db`select coalesce(sum(r.value) filter (where ${R.closedIn(db, "won", f.from, f.to)}), 0)::float8 won_v, coalesce(sum(r.n) filter (where ${R.closedIn(db, "won", f.from, f.to)}), 0)::int won_n,
        coalesce(sum(r.value) filter (where ${R.closedIn(db, "won", new Date(Date.now() - 7 * 86_400_000), null)}), 0)::float8 w7v, coalesce(sum(r.n) filter (where ${R.closedIn(db, "won", new Date(Date.now() - 7 * 86_400_000), null)}), 0)::int w7n
       from pipeline_rollup r where ${base} and r.status = 'won' ${pf}`,
  ]);
  return { open, drain, vault };
}
