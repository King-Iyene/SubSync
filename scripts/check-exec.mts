import assert from "node:assert/strict";
import postgres from "postgres";

// Appointments Leadership: the database check. Two fake agencies (xtest- markers) with a few appointments each, then:
//   1. the daily rollup and its refresh give the same numbers as the rows, and a second refresh changes nothing;
//   2. the rollup answer equals the live twin ("Booked on" is always live);
//   3. every route part, asked for the other agency's account, people, calendar and source by every parameter, answers nothing of theirs and never echoes the id;
//   4. the monthly target is set, undone and cleared only inside its own agency.
// Run against a scratch database only:  EXEC_DB_URL=postgres://... FLAGS_ALL_ON=true node --import tsx scripts/check-exec.ts   (everything it creates is removed)
const url = process.env.EXEC_DB_URL;
if (!url) { console.log("EXEC_DB_URL is not set: nothing to check (use a scratch database)."); process.exit(0); }
const g = globalThis as unknown as { __subsyncSql?: ReturnType<typeof postgres> };
g.__subsyncSql = postgres(url, { prepare: false, max: 1, ssl: process.env.EXEC_DB_SSL === "on" ? "require" : false, onnotice: () => {} });

const { sql } = await import("../src/lib/db");
const q = await import("../src/lib/analytics/appointments-exec-queries");
const { handleApptExec, handleApptExecTarget } = await import("../src/lib/api/appointments-exec-routes");
const DAY = 86_400_000;
const K = Math.random().toString(36).slice(2, 7);

async function seed(key: "a" | "b") {
  const marker = `xtest-${key}-${K}`;
  const [inst] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${marker + "co"}, ${marker + " Agency"}, 'pro', 'x', now() + interval '1 hour') returning id`;
  const loc = `xtestLoc${key}${K}`, cal = `xtestCal${key}${K}`, owner = `xtestOwn${key}${K}`, booker = `xtestBk${key}${K}`, source = `xtest-src-${key}-${K}`;
  await sql()`insert into locations (installation_id, location_id, name, email, timezone) values (${inst.id}, ${loc}, ${marker + " Location"}, ${marker + "@x.test"}, 'America/New_York')`;
  await sql()`insert into team_names (installation_id, user_id, name) values (${inst.id}, ${owner}, ${marker + " Closer"}), (${inst.id}, ${booker}, ${marker + " Setter"})`;
  const plan: Array<[string, number]> = [["showed", 12], ["noshow", 4], ["cancelled", 2], ["booked", 2]];
  let n = 0;
  for (const [status, count] of plan) for (let i = 0; i < count; i++, n++) {
    const id = `xtestA${key}${K}${n}`, contact = `xtestC${key}${K}${n}`, start = new Date(Date.now() - (2 + (n % 18)) * DAY - 5 * 3_600_000);
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, source, tags, date_added, last_activity_at) values (${inst.id}, ${loc}, ${contact}, ${marker}, ${"P" + n}, ${n + marker + "@x.test"}, ${source}, '{}', now(), now())`;
    await sql()`insert into cached_appointments (installation_id, location_id, appointment_id, calendar_id, calendar_name, contact_id, title, status, start_at, end_at, assigned_to, booked_by_user, created_remote_at)
      values (${inst.id}, ${loc}, ${id}, ${cal}, ${marker + " Calendar"}, ${contact}, 't', ${status}, ${start}, ${new Date(start.getTime() + 1_800_000)}, ${owner}, ${booker}, ${new Date(start.getTime() - 3 * DAY)})`;
    if (status === "showed" && n % 3 === 0) await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, contact_name, name, monetary_value, status, last_status_change_at, stage_name) values (${inst.id}, ${loc}, ${"xtestO" + key + K + n}, ${contact}, 'n', 'd', 1000, 'won', ${new Date(start.getTime() + DAY)}, 'Won')`;
  }
  return { inst: inst.id as string, loc, cal, owner, booker, source, marker };
}

const A = await seed("a"), B = await seed("b");
const failures: string[] = [];
const step = async (name: string, f: () => Promise<void>) => { try { await f(); console.log("ok  ", name); } catch (e) { failures.push(name); console.log("FAIL", name, "-", (e as Error).message); } };
try {
  const f = { from: new Date(Date.now() - 25 * DAY), to: new Date(Date.now() + DAY), basis: "appt" as const };
  const sa = { inst: A.inst, allowed: [A.loc] }, sb = { inst: B.inst, allowed: [B.loc] };

  await step("rollup answers equal the rows (20 booked, 12 showed, 4 no-show, 2 cancelled, 2 unmarked)", async () => {
    const s = await q.summary(sa, f);
    assert.equal(s.live, false, "the rollup is used");
    const c = s.totals.cur;
    assert.deepEqual([c.booked, c.showed, c.noshow, c.cancelled, c.unmarked], [20, 12, 4, 2, 2]);
    assert.equal(c.won, 4); assert.equal(c.wonValue, 4000);
    const st = await sql()`select count(*)::int n from appointment_exec_state where installation_id = ${A.inst}`; assert.equal(st[0].n, 1);
  });
  await step("a second refresh changes nothing (idempotent)", async () => {
    const before = await sql()`select coalesce(sum(booked), 0)::int b, count(*)::int n from appointment_exec_daily where installation_id = ${A.inst}`;
    await q.refreshExecRollup(A.inst, { id: A.loc, name: "x", tz: "America/New_York" }, 45);
    await q.refreshExecRollup(A.inst, { id: A.loc, name: "x", tz: "America/New_York" }, 45);
    const after = await sql()`select coalesce(sum(booked), 0)::int b, count(*)::int n from appointment_exec_daily where installation_id = ${A.inst}`;
    assert.deepEqual(after[0], before[0]);
  });
  await step("the live twin gives the same totals as the rollup", async () => {
    const roll = (await q.summary(sa, f)).totals.cur;
    const live = await q.summary(sa, { ...f, status: "" , basis: "appt", stage: "" } as never); // same filters: rollup again
    assert.deepEqual(live.totals.cur, roll);
    const forced = await q.summary(sa, { ...f, stage: "Won" }); // a deal stage forces the live twin
    assert.equal(forced.live, true);
    assert.equal(forced.totals.cur.won, 4, "won deals are in the 'Won' stage");
    const byBooked = await q.summary(sa, { ...f, basis: "booked", from: new Date(Date.now() - 30 * DAY) });
    assert.equal(byBooked.live, true); assert.equal(byBooked.totals.cur.booked, 20);
  });
  await step("a booked-on range narrows every number and its rows the same way", async () => {
    const r = { ...f, bookedFrom: new Date(Date.now() - 12 * DAY), bookedTo: new Date(Date.now() - 6 * DAY) };
    const s2 = await q.summary(sa, r);
    assert.equal(s2.live, true);
    const rows = await q.rows(sa, r, { bucket: "booked", page: 0, size: 100 }, null);
    assert.equal(rows.total, s2.totals.cur.booked, "the number and its rows agree");
    for (const [bucket, key] of [["showed", "showed"], ["noshow", "noshow"], ["cancelled", "cancelled"], ["unmarked", "unmarked"], ["won", "won"]] as const) assert.equal((await q.rows(sa, f, { bucket, page: 0, size: 100 }, null)).total, (await q.summary(sa, f)).totals.cur[key], `${bucket}: the number and its rows agree`);
    assert.ok(s2.totals.cur.booked > 0 && s2.totals.cur.booked < 20);
  });
  await step("every part answers for its own agency", async () => {
    const [bd, sl, pc, dc, rw] = await Promise.all([q.boards(sa, f), q.slots(sa, f), q.pace(sa, f), q.decisions(sa, f), q.rows(sa, f, { bucket: "noshow", page: 0, size: 20 }, null)]);
    assert.equal(bd.setters.length, 1); assert.equal(bd.setters[0].name, `${A.marker} Setter`);
    assert.ok(bd.calendars[0].name.includes(A.marker));
    assert.equal(rw.total, 4); assert.ok(sl.cells.length > 0); assert.ok(pc.sentence.length > 0); assert.ok(Array.isArray(dc.decisions));
    assert.equal((await q.rows(sa, f, { bucket: "booked", dow: 99, page: 0, size: 20 }, null)).total, 20, "an impossible weekday is ignored, not trusted");
  });

  // Route level: asked for the other agency's account, people, calendar, source by every parameter.
  const ctxFor = (inst: string, allowed: string[], url: string, method = "GET", body?: unknown) => ({
    session: { userId: "xtest-user" }, installationId: inst, plan: "pro", demo: false, entitlements: {}, kind: "agency", limitTo: null,
    request: new Request("http://x" + url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url: new URL("http://x" + url), segments: ["appointments", "exec"], allowed,
  } as never);
  const helpers = (allowed: string[]) => ({ allowed: async () => allowed, links: async () => ({ contact: (l: string, c: string) => `https://crm.test/${l}/${c}` }) as never });
  await step("every route part: the other agency's ids answer nothing and are never echoed", async () => {
    const parts = ["summary", "pace", "boards", "slots", "decisions", "rows"];
    const asks = (p: string) => [
      `?part=${p}&location=${B.loc}`, `?part=${p}&setter=${B.booker}&closer=${B.owner}&user=${B.owner}&calendar=${B.cal}&source=${B.source}&basis=booked`,
      `?part=${p}&bucket=noshow&dow=1&hour=9&location=${B.loc}`, `?part=${p}&after=2026-01-01T00:00:00.000Z%7C${B.marker}`,
    ];
    for (const p of parts) for (const a of asks(p)) {
      const res = await handleApptExec(ctxFor(A.inst, [A.loc], "/api/app/appointments/exec" + a), helpers([A.loc]));
      const text = await res.text();
      assert.ok(res.status === 200 || res.status === 404, `${p}: status ${res.status}`);
      for (const bad of [B.loc, B.cal, B.owner, B.booker, B.source, B.marker]) assert.ok(!text.includes(bad), `${p} ${a}: leaked ${bad}`);
    }
    const own = await (await handleApptExec(ctxFor(A.inst, [A.loc], `/api/app/appointments/exec?part=summary&location=${A.loc}`), helpers([A.loc]))).json() as { totals: { cur: { booked: number } } };
    assert.equal(own.totals.cur.booked, 20, "the own account still answers");
    // A client's staff see no ranking of people or accounts.
    const cl = ctxFor(A.inst, [A.loc], "/api/app/appointments/exec?part=boards"); (cl as unknown as { kind: string; limitTo: string }).kind = "client"; (cl as unknown as { limitTo: string }).limitTo = A.loc;
    const cb = await (await handleApptExec(cl, helpers([A.loc]))).json() as { setters: unknown[]; closers: unknown[]; accounts: unknown[] };
    assert.deepEqual([cb.setters.length, cb.closers.length, cb.accounts.length], [0, 0, 0]);
  });
  await step("the target is set, undone and cleared only inside its own agency", async () => {
    const put = (inst: string, allowed: string[], body: unknown) => handleApptExecTarget(ctxFor(inst, allowed, "/api/app/appointments/exec-target", "PUT", body), helpers(allowed));
    assert.equal((await put(A.inst, [A.loc], { location: B.loc, target: 50 })).status, 404, "another agency's account is not found");
    assert.equal((await put(A.inst, [A.loc], { location: A.loc, target: 0 })).status, 400);
    assert.equal((await put(A.inst, [A.loc], { location: A.loc, target: 50 })).status, 200);
    assert.equal((await put(A.inst, [A.loc], { location: A.loc, target: 60 })).status, 200);
    assert.equal((await (await put(A.inst, [A.loc], { location: A.loc, target: "undo" })).json() as { target: number }).target, 50);
    assert.equal((await q.pace(sa, { ...f, location: A.loc })).target, 50);
    assert.equal((await q.pace(sb, { ...f, location: B.loc })).target, null, "the other agency has no target");
    assert.equal((await (await put(A.inst, [A.loc], { location: A.loc, target: null })).json() as { target: number | null }).target, null);
    const audit = await sql()`select count(*)::int n from audit_log where installation_id = ${A.inst} and action = 'appointments.exec_target_changed'`; assert.ok(audit[0].n >= 4);
  });
} finally {
  for (const x of [A, B]) await sql()`delete from installations where id = ${x.inst}`;
  await sql().end({ timeout: 5 });
}
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log("\nAll leadership database checks passed.");
