import assert from "node:assert/strict";
import { closeDb, sql } from "../src/lib/db";

// Speed to lead against a running dev server in demo mode: the numbers are recomputed from the raw rows and
// must agree, the reply target is a real setting that changes the result, a bad target is refused, and a
// business or client view only ever sees its own account.
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-speed.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const signIn = async (as?: string) => ((await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true, ...(as ? { as } : {}) }) })).json()) as { session: string; user: { activeLocation: string | null } });
  const agency = (await signIn()).session;
  const biz = await signIn("business");
  const cli = (await signIn("client")).session;
  const [inst] = await sql()`select id from installations where is_demo`;

  assert.equal((await fetch(`${BASE}/api/app/speed`)).status, 401);
  await call("/api/app/settings", agency, { method: "PUT", body: JSON.stringify({ speedTargetMinutes: 15 }) });
  const v = await call("/api/app/speed", agency);
  assert.equal(v.status, 200, JSON.stringify(v.body).slice(0, 200));
  assert.equal(v.body.targetMinutes, 15);
  const o = v.body.overall;
  assert.ok(o.leads > 50, "the demo has leads to time");

  // Recompute from raw rows: leads past the target window, answered within it, answered late, still waiting.
  const raw = (await sql()`
    select
      count(*) filter (where touch_at is not null and greatest(0, extract(epoch from touch_at - coalesce(clock_start, lead_at))) <= 900)::int as on_time,
      count(*) filter (where touch_at is not null and greatest(0, extract(epoch from touch_at - coalesce(clock_start, lead_at))) > 900)::int as late_n,
      count(*) filter (where touch_at is null and coalesce(clock_start, lead_at) < now() - interval '15 minutes')::int as waiting_n
    from lead_touches t join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
    where t.installation_id = ${inst.id} and t.excluded is null and t.lead_at > now() - interval '14 days'`)[0];
  assert.deepEqual([o.withinTarget, o.answeredLate, o.stillWaiting], [raw.on_time, raw.late_n, raw.waiting_n], "the screen agrees with the raw rows");
  assert.equal(o.answered, o.withinTarget + o.answeredLate);
  assert.ok(o.hitRate >= 0 && o.hitRate <= 1 && o.medianSeconds <= o.p90Seconds);

  // Sorted slowest first; an account without permission is shown as such, never with invented numbers.
  const waits = v.body.perAccount.map((a: { stillWaiting: number }) => a.stillWaiting);
  assert.deepEqual([...waits].sort((a: number, b: number) => b - a), waits);
  assert.ok(v.body.access.needsPermission.length >= 1 && v.body.perAccount.some((a: { access: string }) => a.access === "needs_permission"));
  for (const a of v.body.perAccount.filter((x: { access: string }) => x.access === "needs_permission")) assert.equal(a.leads, 0);

  // The waiting list: all past the target, longest first, with a link to the contact and no platform name.
  const w = v.body.waiting as Array<{ waitingMinutes: number; url: string }>;
  assert.ok(w.length > 0 && w.every((x) => x.waitingMinutes > 15 && x.url.startsWith("https://")));
  assert.deepEqual([...w.map((x) => x.waitingMinutes)].sort((a, b) => b - a), w.map((x) => x.waitingMinutes));
  assert.ok(!/gohighlevel|highlevel|\bghl\b/i.test(JSON.stringify(v.body.perAccount) + JSON.stringify(v.body.people)));
  assert.ok(v.body.people.every((p: { replies: number }) => p.replies >= 3), "nobody is ranked on a couple of replies");

  // The target is a real setting: a longer target can only make more leads count as on time.
  assert.equal((await call("/api/app/settings", agency, { method: "PUT", body: JSON.stringify({ speedTargetMinutes: 0 }) })).status, 400);
  assert.equal((await call("/api/app/settings", agency, { method: "PUT", body: JSON.stringify({ speedTargetMinutes: 5000 }) })).status, 400);
  assert.equal((await call("/api/app/settings", agency, { method: "PUT", body: JSON.stringify({ speedTargetMinutes: "soon" }) })).status, 400);
  assert.equal((await call("/api/app/settings", agency, { method: "PUT", body: JSON.stringify({ speedTargetMinutes: 60 }) })).status, 200);
  const longer = await call("/api/app/speed", agency);
  assert.equal(longer.body.targetMinutes, 60);
  assert.ok(longer.body.overall.withinTarget >= o.withinTarget && longer.body.overall.hitRate >= o.hitRate);
  assert.ok(longer.body.waiting.length <= v.body.waiting.length);
  await call("/api/app/settings", agency, { method: "PUT", body: JSON.stringify({ speedTargetMinutes: 15, countAutomatedTouches: false }) });
  assert.equal(((await call("/api/app/settings", agency)).body.settings).speedTargetMinutes, 15, "restored");

  // A business or client only sees its own account.
  for (const [label, t] of [["business", biz.session], ["client", cli]] as const) {
    const mine = await call("/api/app/speed", t);
    assert.equal(mine.status, 200, label);
    assert.ok(mine.body.perAccount.length <= 1, `${label}: one account at most`);
    assert.ok(mine.body.waiting.every((x: { locationId: string }) => x.locationId === biz.user.activeLocation), `${label}: only its own waiting leads`);
    assert.ok(mine.body.overall.leads <= o.leads);
  }
  assert.equal((await call("/api/app/speed?industry=bad!x&hideTest=1", agency)).status, 200);

  // A breach alert: fresh leads nobody has answered raise one alert for the account, with the right count,
  // and it goes away on its own once they are answered or removed.
  const target = (await sql()`select l.location_id, l.name from locations l where l.installation_id = ${inst.id} and not l.ignored and l.location_id not in (select location_id from lead_touches where installation_id = ${inst.id} and touch_at is null and lead_at > now() - interval '2 days') order by l.location_id limit 1`)[0];
  const ids = [0, 1, 2, 3].map((n) => `xtest-speed-${n}`);
  const cleanup = () => sql()`delete from lead_touches where installation_id = ${inst.id} and conversation_id like 'xtest-speed-%'`;
  await cleanup();
  const speedAlerts = async (tok: string) => ((await call("/api/app/alerts", tok)).body.alerts as Array<{ kind: string; locationId: string | null; title: string; severity: string }>).filter((a) => a.kind === "speed");
  try {
    assert.equal((await speedAlerts(agency)).filter((a) => a.locationId === target.location_id).length, 0, "no alert before there is a reason");
    for (const [n, id] of ids.entries()) await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at) values (${inst.id}, ${target.location_id}, ${"xtest-c" + n}, ${id}, now() - interval '90 minutes')`;
    assert.equal((await call("/api/app/sync", agency, { method: "POST", body: "{}" })).status, 200);
    const raised = (await speedAlerts(agency)).filter((a) => a.locationId === target.location_id);
    assert.equal(raised.length, 1, "exactly one alert for the account");
    assert.match(raised[0].title, /4 new leads have waited more than 15 minutes for a reply \(longest 1 h 30 min\)/);
    assert.equal(raised[0].severity, "warning");
    await call("/api/app/sync", agency, { method: "POST", body: "{}" });
    assert.equal((await speedAlerts(agency)).filter((a) => a.locationId === target.location_id).length, 1, "running it again does not duplicate it");
    assert.ok(!(await speedAlerts(biz.session)).some((a) => a.locationId !== biz.user.activeLocation), "a business never sees another account's alert");
    await cleanup();
    await call("/api/app/sync", agency, { method: "POST", body: "{}" });
    assert.equal((await speedAlerts(agency)).filter((a) => a.locationId === target.location_id).length, 0, "it resolves once the leads are gone");
  } finally {
    await cleanup();
  }

  await closeDb();
  console.log(`speed to lead: numbers match the raw rows (${raw.on_time} on time, ${raw.late_n} late, ${raw.waiting_n} waiting), target is a setting and bad targets are refused, nobody ranked on too few replies, scoped to one account for business and client, breach alert raised once with the right numbers and resolved: ok`);
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
