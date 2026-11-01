// Prints the real sync timeline from the database (read only: it only runs selects), per real install: when each refresh cycle was queued, when
// it started and finished, the gaps between cycles, failures, what is waiting now, and each account's last good refresh.
//   node --env-file=.env.local --import tsx scripts/sync-timeline.ts            (last 48 hours)
//   node --env-file=.env.local --import tsx scripts/sync-timeline.ts --hours 6  (the last 6 hours: use this after the schedule change is merged)
//   node --env-file=.env.local --import tsx scripts/sync-timeline.ts --rows 40  (show the last 40 cycles instead of 12)
// All times are UTC. A "cycle" is one metrics job: it is queued together with the refresh jobs of every account and runs last.
import { evaluateInstall } from "../src/lib/sync/alarm";
import { closeDb, sql } from "../src/lib/db";
import { loadSyncFacts } from "../src/lib/sync/freshness-queries";
import { freshnessOf } from "../src/lib/sync/freshness";
import { summariseCycles } from "../src/lib/sync/timeline";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const HOURS = arg("hours", 48);
const ROWS = arg("rows", 12);

const hhmm = (d: Date | null) => (d ? d.toISOString().slice(5, 19).replace("T", " ") : "-");
const mins = (a: Date | null, b: Date | null) => (a && b ? ((b.getTime() - a.getTime()) / 60_000).toFixed(1) + " min" : "-");

async function main() {
  const db = sql();
  const now = Date.now();
  console.log(`Sync timeline, last ${HOURS} hours, now ${new Date(now).toISOString()} (UTC). Read only.\n`);
  const installs = await db`select id, mode, created_at from installations where uninstalled_at is null and not is_demo and refresh_token_enc is not null order by created_at`;
  if (installs.length === 0) console.log("No real installs with a refresh token.");
  for (const i of installs) {
    const id = i.id as string;
    const facts = await loadSyncFacts(id, { now });
    const fresh = freshnessOf(facts.input);
    const verdict = evaluateInstall({
      installationId: id, oldestSuccessAt: fresh.updatedAt, accounts: facts.input.accounts.length, pendingJobs: facts.input.pendingJobs,
      oldestPendingMinutes: facts.input.oldestPendingMinutes, failedJobs24h: facts.checks24h.failed,
    }, now);
    console.log(`=== install ${id.slice(0, 8)} (${i.mode}), ${facts.input.accounts.length} account(s) ===`);
    console.log(`On screen now: "${fresh.text}"   Alarm verdict: ${verdict.state} (${verdict.why})`);

    const cycles = await db`select created_at, started_at, finished_at, status from sync_jobs
      where installation_id = ${id} and type = 'metrics' and created_at > now() - make_interval(hours => ${HOURS}) order by created_at`;
    const s = summariseCycles(cycles.map((c) => (c.created_at as Date).getTime()), now);
    console.log(`Refresh cycles queued: ${s.cycles}` + (s.firstAt ? `, first ${hhmm(new Date(s.firstAt))}, last ${hhmm(new Date(s.lastAt as number))} (${s.sinceLastMinutes} min ago)` : ""));
    if (s.cycles > 1) {
      console.log(`Gap between cycles: median ${s.medianGapMinutes} min, longest ${s.longestGap?.minutes} min (${hhmm(new Date(s.longestGap!.fromAt))} to ${hhmm(new Date(s.longestGap!.toAt))})`);
      const gaps: number[] = [];
      const t = cycles.map((c) => (c.created_at as Date).getTime());
      for (let k = 1; k < t.length; k++) gaps.push(Math.round((t[k] - t[k - 1]) / 60_000));
      const bucket = (lo: number, hi: number) => gaps.filter((g) => g >= lo && g <= hi).length;
      console.log(`Gaps: 15 min or less ${bucket(0, 15)}, 16 to 20 min ${bucket(16, 20)}, 21 to 30 min ${bucket(21, 30)}, over 30 min ${bucket(31, 1e9)}`);
      if (s.slowGaps.length > 0) {
        console.log(`Gaps over 30 minutes (${s.slowGaps.length}):`);
        for (const g of s.slowGaps.slice(-15)) console.log(`   ${hhmm(new Date(g.fromAt))}  to  ${hhmm(new Date(g.toAt))}   ${g.minutes} min`);
        if (s.slowGaps.length > 15) console.log(`   (${s.slowGaps.length - 15} older ones not listed)`);
      }
    }
    console.log(`\nLast ${Math.min(ROWS, cycles.length)} cycles (queued -> recalculation started -> finished, UTC):`);
    for (const c of cycles.slice(-ROWS)) {
      console.log(`   ${hhmm(c.created_at as Date)}  ->  ${hhmm(c.started_at as Date | null)}  ->  ${hhmm(c.finished_at as Date | null)}   ${String(c.status).padEnd(7)} whole cycle (queued to finished) ${mins(c.created_at as Date, c.finished_at as Date | null)}`);
    }

    const byStatus = await db`select type, status, count(*)::int n from sync_jobs where installation_id = ${id} and created_at > now() - make_interval(hours => ${HOURS}) group by 1, 2 order by 1, 2`;
    console.log(`\nJobs in the window: ${byStatus.map((r) => `${r.type}/${r.status}=${r.n}`).join(", ") || "none"}`);
    const failed = await db`select type, location_id, error, finished_at from sync_jobs where installation_id = ${id} and status = 'failed' and created_at > now() - make_interval(hours => ${HOURS}) order by finished_at desc limit 10`;
    console.log(failed.length === 0 ? "Failed jobs: none" : `Failed jobs (latest 10):\n${failed.map((f) => `   ${hhmm(f.finished_at as Date)} ${f.type} ${f.location_id ? String(f.location_id).slice(0, 6) : "(install)"}: ${f.error}`).join("\n")}`);
    const waiting = await db`select type, status, created_at, started_at from sync_jobs where installation_id = ${id} and status in ('pending', 'running') order by created_at`;
    console.log(waiting.length === 0 ? "Waiting or running now: nothing" : `Waiting or running now: ${waiting.map((w) => `${w.type}/${w.status} for ${((now - (w.created_at as Date).getTime()) / 60_000).toFixed(1)} min`).join(", ")}`);
    console.log("Each account, last good refresh:");
    for (const a of fresh.accounts) console.log(`   ${(a.name ?? "Unnamed").padEnd(28)} ${a.updatedAt ?? "never"}   ${a.text}${a.problem ? "   PROBLEM: " + a.problem : ""}`);

    const wh = await db`select event_type, count(*)::int n, max(received_at) last from webhook_events group by 1 order by 2 desc`;
    if (i === installs[0]) console.log(`\nWebhook events received in the last 3 days (older rows are removed): ${wh.map((w) => `${w.event_type} x${w.n} (last ${hhmm(w.last as Date)})`).join(", ") || "none"}`);
    console.log("");
  }
  await closeDb();
}
void main();
