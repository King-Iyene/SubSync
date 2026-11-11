import { sql } from "../db";
import { benchmarkDecision, isVertical, BENCH_MIN_ACCOUNTS, type Vertical } from "./moat-core";

// D5. THE ONE PLACE where data from more than one tenant is combined. Nothing else in the code base may read other installations' rows for a benchmark
// (a test scans for this). What leaves the database is only counts and three percentiles of per-account median reply times: no installation id, no account id, no
// name, no row. It reads only installations that opted in (settings.benchmark_opt_in), only accounts that carry this vertical tag, only the last 90 days, and
// only accounts with at least 30 answered leads. Every call writes one audit line (who asked, which vertical, how many accounts, whether it was suppressed).

export const BENCH_MIN_ANSWERED = 30;
export const BENCH_WINDOW_DAYS = 90;

export type BenchmarkOut =
  | { available: false; reason: "not_opted_in" | "no_vertical" | "suppressed"; message: string; vertical: Vertical | null }
  | { available: true; vertical: Vertical; accounts: number; medianMinutes: number; p25Minutes: number; p75Minutes: number; yours: { medianMinutes: number | null; accountsCompared: number } };

type Caller = { installationId: string; actor: string; allowedLocations: string[] | null };

export async function peerBenchmark(caller: Caller, vertical: unknown): Promise<BenchmarkOut> {
  const db = sql();
  if (!isVertical(vertical)) return { available: false, reason: "no_vertical", message: "Choose the kind of business first", vertical: null };
  // Give to get: an agency sees the benchmark only if it contributes to it.
  const [me] = await db`select benchmark_opt_in from settings where installation_id = ${caller.installationId}`;
  if (me?.benchmark_opt_in !== true) return { available: false, reason: "not_opted_in", message: "Turn on benchmarking to compare", vertical };

  const [cell] = await db`
    with per_account as (
      select t.installation_id, t.location_id,
        percentile_cont(0.5) within group (order by extract(epoch from (t.human_touch_at - coalesce(t.clock_start, t.lead_at))) / 60) med
      from lead_touches t
      join account_profiles p on p.installation_id = t.installation_id and p.location_id = t.location_id and p.vertical = ${vertical}
      join settings s on s.installation_id = t.installation_id and s.benchmark_opt_in = true
      join installations i on i.id = t.installation_id and i.uninstalled_at is null and not i.is_demo
      join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
      where t.excluded is null and t.human_touch_at is not null and t.lead_at > now() - make_interval(days => ${BENCH_WINDOW_DAYS})
      group by t.installation_id, t.location_id
      having count(*) >= ${BENCH_MIN_ANSWERED}
    ), per_agency as (select installation_id, count(*) n from per_account group by installation_id)
    select (select count(*) from per_account)::int accounts,
      (select count(*) from per_agency)::int agencies,
      coalesce((select max(n)::float / nullif(sum(n), 0) from per_agency), 0) top_share,
      (select percentile_cont(0.5) within group (order by med) from per_account) p50,
      (select percentile_cont(0.25) within group (order by med) from per_account) p25,
      (select percentile_cont(0.75) within group (order by med) from per_account) p75`;
  const accounts = Number(cell?.accounts ?? 0);
  const decision = benchmarkDecision({ accounts, agencies: Number(cell?.agencies ?? 0), topAgencyShare: Number(cell?.top_share ?? 0) });
  await db`insert into audit_log (installation_id, actor, action, detail) values (${caller.installationId}, ${caller.actor}, 'benchmark.read',
    ${db.json({ vertical, accountsBucket: accounts >= BENCH_MIN_ACCOUNTS ? "10+" : "under 10", suppressed: !decision.show } as never)})`;
  if (!decision.show) return { available: false, reason: "suppressed", message: decision.message, vertical };

  // The caller's own number, from the caller's own rows only.
  const own = await db`
    select percentile_cont(0.5) within group (order by extract(epoch from (t.human_touch_at - coalesce(t.clock_start, t.lead_at))) / 60) med
    from lead_touches t join account_profiles p on p.installation_id = t.installation_id and p.location_id = t.location_id and p.vertical = ${vertical}
    where t.installation_id = ${caller.installationId} and t.excluded is null and t.human_touch_at is not null and t.lead_at > now() - make_interval(days => ${BENCH_WINDOW_DAYS})
      and (${caller.allowedLocations === null} or t.location_id = any(${caller.allowedLocations ?? []}::text[]))`;
  const m = own[0]?.med;
  return {
    available: true, vertical, accounts,
    medianMinutes: Math.round(Number(cell.p50)), p25Minutes: Math.round(Number(cell.p25)), p75Minutes: Math.round(Number(cell.p75)),
    yours: { medianMinutes: m === null || m === undefined ? null : Math.round(Number(m)), accountsCompared: 1 },
  };
}

/** Switches this agency's own participation on or off. Only the installation's own settings row changes. */
export async function setBenchmarkOptIn(installationId: string, on: boolean): Promise<void> {
  await sql()`update settings set benchmark_opt_in = ${on} where installation_id = ${installationId}`;
}
export async function getBenchmarkOptIn(installationId: string): Promise<boolean> {
  const [r] = await sql()`select benchmark_opt_in from settings where installation_id = ${installationId}`;
  return r?.benchmark_opt_in === true;
}
