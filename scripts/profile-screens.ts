// Read-only profile of the slow screens against the real database from this machine: for each read, the wall time and the number of statements.
// Round trips from here cost ~200 ms (far away); from the hosting region they cost a few ms, so "statements in a row" is the number to cut.
// Usage: DB_QUERY_COUNT=1 node --env-file=.env.local --import tsx scripts/profile-screens.ts [installationId]
import { closeDb, sql } from "../src/lib/db";
import { speedHome, speedList } from "../src/lib/analytics/speed-v2-queries";
import { speedPulse } from "../src/lib/analytics/speed6-queries";
import { speedRace, speedCoverage } from "../src/lib/analytics/speed-v4-queries";
import { speedBooking } from "../src/lib/analytics/speed5-queries";
import { appointmentView } from "../src/lib/analytics/appointment-queries";

const g = globalThis as unknown as { __subsyncQueries?: number };

async function main() {
  const db = sql();
  const rows = await db`select i.id, count(a.*)::int appts from installations i left join cached_appointments a on a.installation_id = i.id where not coalesce(i.is_demo, false) group by i.id order by 2 desc limit 3`;
  console.log("installations by appointments:", rows.map((r) => `${r.id} ${r.appts}`).join(" | "));
  const inst = process.argv[2] ?? (rows[0].id as string);
  const now = Date.now(), DAY = 86_400_000;
  const win = { from: new Date(now - 29 * DAY).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10), fromMs: now - 29 * DAY, toMs: now, days: 30 };
  const base = { installationId: inst, allowed: null as string[] | null, targetMinutes: 15, now, seePeople: true };
  const snap = async () => new Map((await db`select queryid::text id, total_exec_time t, calls c, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 110) q from pg_stat_statements`).map((r) => [r.id as string, r]));
  const time = async (label: string, run: () => Promise<unknown>) => {
    const before = process.env.DETAIL ? await snap() : null;
    g.__subsyncQueries = 0; const t = performance.now();
    try { await run(); } catch (e) { console.log(`${label}: FAILED ${(e as Error).message.slice(0, 80)}`); return; }
    const ms = Math.round(performance.now() - t);
    console.log(`${label.padEnd(34)} ${String(ms).padStart(6)} ms  ${String(g.__subsyncQueries).padStart(3)} statements`);
    if (before) {
      const after = await snap();
      const d = [...after].map(([id, r]) => ({ ms: Number(r.t) - Number(before.get(id)?.t ?? 0), c: Number(r.c) - Number(before.get(id)?.c ?? 0), q: r.q as string })).filter((x) => x.c > 0 && x.ms > 40).sort((a, b) => b.ms - a.ms).slice(0, 6);
      for (const x of d) console.log(`      ${Math.round(x.ms)} ms x${x.c}  ${x.q}`);
    }
  };
  await time("warm-up (connect)", () => db`select 1`);
  await time("speed home", () => speedHome({ ...base, win, cmp: null, canChangeTarget: true }));
  await time("speed list waiting", () => speedList({ installationId: inst, allowed: null, targetMinutes: 15, now, meId: null, status: "waiting", win: null, person: null, account: null, owner: null, noSource: false, week: null, day: null, replyDay: null, q: "", sort: "wait", page: 0, size: 25 } as never));
  await time("speed pulse", () => speedPulse({ ...base, filter: undefined as never, winFrom: win.fromMs, winTo: win.toMs } as never));
  await time("speed race", () => speedRace({ ...base, filter: undefined as never } as never));
  await time("speed coverage", () => speedCoverage({ ...base, filter: undefined as never, winFrom: win.fromMs, winTo: win.toMs } as never));
  await time("speed booking", () => speedBooking({ ...base, filter: undefined, winFrom: win.fromMs, winTo: win.toMs } as never));
  await time("appointments view", () => appointmentView(inst, null, now, undefined as never));
  console.log("ids:", inst);
  await closeDb();
}
main();
