import { maintenanceOn } from "../runtime-guards";
import { sql } from "../db";
import { alarmAction, evaluateInstall, type AlarmVerdict, type LastEntry } from "./alarm";
import { loadSyncFacts } from "./freshness-queries";
import { freshnessOf } from "./freshness";
import { summariseCycles } from "./timeline";

// The operator's view of sync health across every real install, and the internal alarm. Nothing here is shown to a customer, and nothing
// here sends anything: an alarm is written to the audit log (ids, times and counts only) and appears on the diagnostics address, which only
// the server secret can open. Telling a person (email or Slack) is a dry run until the dispatcher stage adds its switches.

export type InstallDiagnostics = {
  installation: string; // first 8 characters of the id: enough to tell installs apart, not a key
  mode: string;
  accounts: number;
  verdict: AlarmVerdict;
  freshness: string;
  queue: { pending: number; oldestPendingMinutes: number | null; failed24h: number; checks24h: number };
  cadence24h: { cycles: number; medianGapMinutes: number | null; longestGapMinutes: number | null; sinceLastMinutes: number | null };
};

export type Diagnostics = {
  generatedAt: string;
  maintenance: boolean;
  installations: InstallDiagnostics[];
  /** Event types the webhook route received in the last 3 days (older rows are removed), with counts. */
  webhookEvents3d: Array<{ type: string; count: number; lastAt: string | null }>;
  alarms: number;
};

type Row = { id: string; mode: string };

async function realInstalls(): Promise<Row[]> {
  const rows = await sql()`select id, mode from installations where uninstalled_at is null and not is_demo and refresh_token_enc is not null order by created_at`;
  return rows.map((r) => ({ id: r.id as string, mode: (r.mode as string) ?? "agency" }));
}

export async function collectDiagnostics(now = Date.now()): Promise<{ diagnostics: Diagnostics; verdicts: Array<{ id: string; verdict: AlarmVerdict; detail: Record<string, unknown> }> }> {
  const db = sql();
  const installs = await realInstalls();
  const out: InstallDiagnostics[] = [];
  const verdicts: Array<{ id: string; verdict: AlarmVerdict; detail: Record<string, unknown> }> = [];
  for (const i of installs) {
    const facts = await loadSyncFacts(i.id, { now });
    const fresh = freshnessOf(facts.input);
    const cycles = await db`select created_at from sync_jobs where installation_id = ${i.id} and type = 'metrics' and created_at > now() - interval '24 hours' order by created_at`;
    const cadence = summariseCycles(cycles.map((c) => (c.created_at as Date).getTime()), now);
    const verdict = evaluateInstall({
      installationId: i.id,
      oldestSuccessAt: fresh.updatedAt,
      accounts: facts.input.accounts.length,
      pendingJobs: facts.input.pendingJobs,
      oldestPendingMinutes: facts.input.oldestPendingMinutes,
      failedJobs24h: facts.checks24h.failed,
    }, now);
    out.push({
      installation: i.id.slice(0, 8), mode: i.mode, accounts: facts.input.accounts.length, verdict: { ...verdict, installationId: i.id.slice(0, 8) }, freshness: fresh.text,
      queue: { pending: facts.input.pendingJobs, oldestPendingMinutes: facts.input.oldestPendingMinutes === null ? null : Math.round(facts.input.oldestPendingMinutes), failed24h: facts.checks24h.failed, checks24h: facts.checks24h.total },
      cadence24h: { cycles: cadence.cycles, medianGapMinutes: cadence.medianGapMinutes, longestGapMinutes: cadence.longestGap?.minutes ?? null, sinceLastMinutes: cadence.sinceLastMinutes },
    });
    verdicts.push({ id: i.id, verdict, detail: { ageMinutes: verdict.ageMinutes, why: verdict.why, pendingJobs: facts.input.pendingJobs, failedJobs24h: facts.checks24h.failed, accounts: facts.input.accounts.length } });
  }
  const events = await db`select event_type, count(*)::int n, max(received_at) last from webhook_events group by 1 order by 2 desc`;
  return {
    diagnostics: {
      generatedAt: new Date(now).toISOString(),
      maintenance: maintenanceOn(process.env),
      installations: out,
      webhookEvents3d: events.map((e) => ({ type: e.event_type as string, count: e.n as number, lastAt: e.last instanceof Date ? e.last.toISOString() : null })),
      alarms: out.filter((o) => o.verdict.state === "alarm").length,
    },
    verdicts,
  };
}

type Verdicts = Awaited<ReturnType<typeof collectDiagnostics>>["verdicts"];

/** Write down what changed for each verdict: a line when an alarm starts, an hourly reminder while it stands, a line when it clears. */
export async function recordVerdicts(verdicts: Verdicts, now = Date.now()): Promise<{ checked: number; raised: number; reminded: number; recovered: number }> {
  const db = sql();
  const tally = { checked: verdicts.length, raised: 0, reminded: 0, recovered: 0 };
  for (const v of verdicts) {
    const [last] = await db`select action, at from audit_log where installation_id = ${v.id} and action in ('sync.alarm', 'sync.recovered') order by at desc limit 1`;
    const prev: LastEntry = last ? { action: last.action as LastEntry["action"], at: (last.at as Date).getTime() } : { action: null, at: null };
    const action = alarmAction(v.verdict, prev, now);
    if (action === "none") continue;
    const name = action === "recover" ? "sync.recovered" : "sync.alarm";
    // Telling a person goes through the notification dispatcher (stage F9, kind "Data refresh problem"): the owner's own choices decide the bell, email and Slack,
    // and nothing real is sent while the live switches are off. The audit line keeps saying so.
    const outward = action === "recover" ? null : "WOULD NOTIFY the owner (handed to the notification dispatcher: nothing real is sent while the live switches are off)";
    await db`insert into audit_log (installation_id, actor, action, detail, at) values (${v.id}, 'watchdog', ${name}, ${db.json({ ...v.detail, kind: action, ...(outward ? { outward } : {}) } as never)}, ${new Date(now)})`;
    if (outward) {
      console.warn("Sync alarm", { installation: v.id.slice(0, 8), ...v.detail, outward });
      try {
        // A new alarm is sent once; a reminder at most every 6 hours, so a long outage is not a message an hour.
        const age = v.verdict.ageMinutes;
        const { notifySyncProblem } = await import("../notifications/service");
        await notifySyncProblem(v.id, {
          dedupeKey: action === "raise" ? `sync_alarm:${v.id}:${Math.floor(now / 60_000)}` : `sync_alarm:${v.id}:remind:${Math.floor(now / (6 * 3_600_000))}`,
          minutes: age, problem: age === null ? "has not finished its first refresh" : `data is ${age} minutes old and the refresh is delayed`, severity: "warning",
        });
      } catch (error) {
        console.error("Could not hand the sync alarm to the dispatcher", error instanceof Error ? error.message : "unknown");
      }
    }
    if (action === "raise") tally.raised++; else if (action === "remind") tally.reminded++; else tally.recovered++;
  }
  return tally;
}

/** One watchdog pass: evaluate every real install and write down what changed. */
export async function runWatchdog(now = Date.now()): Promise<{ checked: number; raised: number; reminded: number; recovered: number }> {
  if (maintenanceOn(process.env)) return { checked: 0, raised: 0, reminded: 0, recovered: 0 };
  return recordVerdicts((await collectDiagnostics(now)).verdicts, now);
}
