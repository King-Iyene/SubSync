import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { refreshUserRollup } from "@/lib/analytics/people3-rollup";
import { refreshTeamIdentity, saveLocationUsers } from "@/lib/analytics/people3-identity";
import { loadPeople, ownedUser, scorecards } from "@/lib/analytics/people3-queries";

// The Team module against two fixture companies (removed afterwards; every id starts with xtest or pp). Written for the two earlier modules that leaked foreign ids through a trusted parameter:
// every part of GET /api/app/people3 is asked for the other company's account and people in every way it takes them and must show nothing of the other side, never an error page.
// Also: actions are credited to the person who acted, outcomes to the owner at the time, a count equals the rows it opens, and a person without full access sees only themselves.
// Skipped when no database is configured or the migrations 20261202090000_people_identity.sql, 20261202100000_people_rollup.sql and 20261202110000_people_owner_history.sql are not applied yet.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
process.env.FLAGS_ALL_ON = "true";
const CO_A = "xtest-pp3-a", CO_B = "xtest-pp3-b", A1 = "xtestPp3A1", A2 = "xtestPp3A2", B1 = "xtestPp3B1";
const DAY = 86_400_000, HOUR = 3_600_000;
const PARTS = ["today", "scorecards", "workload", "leaderboard", "money", "coaching", "access", "proof", "person", "handoff", "nextlead", "list", "options"] as const;
const LEAK_B = /zzPpB|xtestPp3B1|xtestpp3b1|ppB1|ppbpers/i;
let instA = "", instB = "", applied = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null, userId: string, personRole: "agency_owner" | "agency_admin" | "agency_staff" | "account_user") =>
  signSession({ companyId: company, userId, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole });
async function call(token: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const t = await res.text();
  let body: Json = {};
  try { body = t ? JSON.parse(t) : {}; } catch { body = { raw: t }; }
  return { status: res.status, text: t, body };
}
const ago = (ms: number) => new Date(Date.now() - ms);

describe.skipIf(!HAS_DB)("team module", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from user_daily limit 1`; await sql()`select 1 from team_members limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    const db = sql();
    for (const co of [CO_A, CO_B]) await db`delete from installations where company_id = ${co}`;
    const mk = async (co: string, name: string) => ((await db`insert into installations (company_id, company_name, plan) values (${co}, ${name}, 'pro') returning id`) as unknown as Array<{ id: string }>)[0].id;
    instA = await mk(CO_A, "zzPp3 A"); instB = await mk(CO_B, "zzPpB B");
    for (const i of [instA, instB]) await db`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await db`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, users_access, last_synced_at) values
      (${instA}, ${A1}, 'zzPp3 Client A1', 'UTC', true, 'ok', 'ok', now()), (${instA}, ${A2}, 'zzPp3 Client A2', 'UTC', true, 'ok', 'ok', now()), (${instB}, ${B1}, 'zzPpB Client', 'UTC', true, 'ok', 'ok', now())`;
    await db`insert into team_members (installation_id, user_id, name, role, all_accounts, source) values
      (${instA}, 'ppOwnerA', 'Olive Owner', 'agency_admin', true, 'users'), (${instA}, 'ppSet1', 'Sam Setter', 'account_user', false, 'users'), (${instA}, 'ppSet2', 'Dee Setter', 'account_user', false, 'users'),
      (${instA}, 'ppClose1', 'Cal Closer', 'account_user', false, 'users'), (${instB}, 'ppB1', 'zzPpB Person', 'account_user', false, 'users')`;
    await db`insert into team_member_access (installation_id, user_id, location_id, source) values
      (${instA}, 'ppSet1', ${A1}, 'location_list'), (${instA}, 'ppSet1', ${A2}, 'location_list'), (${instA}, 'ppSet2', ${A1}, 'location_list'), (${instA}, 'ppClose1', ${A1}, 'location_list'), (${instA}, 'ppOwnerA', ${A1}, 'location_list'),
      (${instB}, 'ppB1', ${B1}, 'location_list')`;
    // Leads answered first: Sam 25 (20 inside the 15 minute target), Dee 25 (10 inside).
    const lt = (inst: string, loc: string, user: string, id: string, i: number, fast: boolean) => ({
      installation_id: inst, location_id: loc, contact_id: `c-${id}-${i}`, conversation_id: `cv-${id}-${i}`, lead_at: ago((1 + i) * DAY), touch_at: new Date(Date.now() - (1 + i) * DAY + (fast ? 5 * 60_000 : 60 * 60_000)), touch_user_id: user,
    });
    await db`insert into lead_touches ${db([
      ...Array.from({ length: 25 }, (_, i) => lt(instA, A1, "ppSet1", "s1", i, i < 20)), ...Array.from({ length: 25 }, (_, i) => lt(instA, A1, "ppSet2", "s2", i, i < 10)),
      ...Array.from({ length: 25 }, (_, i) => lt(instB, B1, "ppB1", "b1", i, true)),
    ] as never)}`;
    // Touches: a person, a workflow message, a message with no person, and Dee's text to the contact of an appointment with no recorded creator.
    const te = (inst: string, loc: string, key: string, user: string | null, automated: boolean, contact: string, at: Date) => ({ installation_id: inst, location_id: loc, contact_id: contact, event_key: key, direction: "outbound", channel: "sms", kind: "message", at, user_id: user, automated });
    await db`insert into touch_events ${db([
      te(instA, A1, "t1", "ppSet1", false, "c-x1", ago(2 * DAY)), te(instA, A1, "t2", null, true, "c-x2", ago(2 * DAY)), te(instA, A1, "t3", null, false, "c-x3", ago(2 * DAY)),
      te(instA, A1, "t4", "ppSet2", false, "c-ap3", ago(13 * DAY)), te(instB, B1, "tb1", "ppB1", false, "c-b", ago(2 * DAY)),
    ] as never)}`;
    // Appointments: two Sam created, one with no recorded creator (Dee texted the contact first), plus one needing an outcome and one coming up (Cal's).
    const ap = (inst: string, loc: string, id: string, o: Record<string, unknown>) => ({ installation_id: inst, location_id: loc, appointment_id: id, contact_id: `c-${id}`, title: `Appt ${id}`, assigned_to: "ppClose1", ...o });
    await db`insert into cached_appointments ${db([
      ap(instA, A1, "ap1", { status: "showed", start_at: ago(8 * DAY), created_remote_at: ago(10 * DAY), booked_by_user: "ppSet1" }),
      ap(instA, A1, "ap2", { status: "noshow", start_at: ago(7 * DAY), created_remote_at: ago(10 * DAY), booked_by_user: "ppSet1" }),
      ap(instA, A1, "ap3", { status: "showed", start_at: ago(9 * DAY), created_remote_at: ago(12 * DAY), booked_by_user: null, contact_id: "c-ap3" }),
      ap(instA, A1, "ap4", { status: "booked", start_at: ago(5 * HOUR), created_remote_at: ago(3 * DAY), booked_by_user: "ppSet1" }),
      ap(instA, A1, "ap6", { status: "showed", start_at: ago(18 * DAY), created_remote_at: ago(20 * DAY), booked_by_user: "ppSet1", contact_id: "c-d1" }),
      ap(instA, A1, "ap5", { status: "confirmed", start_at: new Date(Date.now() + 2 * DAY), created_remote_at: ago(1 * DAY), booked_by_user: "ppSet1" }),
      ap(instB, B1, "apb", { status: "showed", start_at: ago(8 * DAY), created_remote_at: ago(10 * DAY), booked_by_user: "ppB1", assigned_to: "ppB1", title: "zzPpB appt" }),
    ] as never)}`;
    // Deals: won 5 days ago, owned by Dee WHEN it was won and by Cal today; two open deals of Cal (one quiet); one of the other company.
    const deal = (inst: string, loc: string, id: string, o: Record<string, unknown>) => ({
      installation_id: inst, location_id: loc, opportunity_id: id, pipeline_id: `${loc}-pl`, pipeline_name: "Sales", stage_id: "new", stage_name: "New", contact_id: `c-${id}`, contact_name: `Person ${id}`, name: `Deal ${id}`,
      monetary_value: 1000, status: "open", assigned_to: "ppClose1", created_remote_at: ago(60 * DAY), last_stage_change_at: ago(2 * DAY), last_status_change_at: null, ...o,
    });
    await db`insert into cached_opportunities ${db([
      deal(instA, A1, "d1", { status: "won", monetary_value: 5000, last_status_change_at: ago(5 * DAY), last_stage_change_at: ago(5 * DAY) }),
      deal(instA, A1, "d2", { monetary_value: 1000 }), deal(instA, A1, "d3", { monetary_value: 2000, last_stage_change_at: ago(40 * DAY) }),
      deal(instB, B1, "db1", { name: "zzPpB deal", contact_name: "zzPpB lead", assigned_to: "ppB1", status: "won", monetary_value: 9000, last_status_change_at: ago(3 * DAY) }),
    ] as never)}`;
    await db`insert into deal_history (installation_id, location_id, opportunity_id, kind, event_key, from_value, to_value, actor_kind, at) values
      (${instA}, ${A1}, 'd1', 'owner', 'owner|d1|first', null, 'ppSet2', 'system', ${ago(40 * DAY)}), (${instA}, ${A1}, 'd1', 'owner', 'owner|d1|x', 'ppSet2', 'ppClose1', 'person', ${ago(2 * DAY)})`;
    // Waiting replies: Sam has three (5 hours, 30 hours, 1 hour), one has nobody; the other company has one.
    const cv = (inst: string, loc: string, id: string, hours: number, assigned: string | null, name: string) => ({ installation_id: inst, location_id: loc, conversation_id: id, contact_id: `c-${id}`, contact_name: name, last_message_direction: "inbound", last_message_at: ago(hours * HOUR), assigned_to: assigned });
    await db`insert into cached_conversations ${db([
      cv(instA, A1, "w1", 5, "ppSet1", "Lead W1"), cv(instA, A1, "w2", 30, "ppSet1", "Lead W2"), cv(instA, A1, "w3", 1, "ppSet1", "Lead W3"), cv(instA, A1, "w4", 6, null, "Lead W4"),
      cv(instB, B1, "wb1", 9, "ppB1", "zzPpB lead"),
    ] as never)}`;
    await refreshUserRollup(instA, 60);
    await refreshUserRollup(instB, 60);
  });
  afterAll(async () => {
    if (applied) {
      const db = sql();
      for (const i of [instA, instB]) for (const t of ["user_daily", "user_rollup_state", "user_workload_daily", "team_member_access", "team_members", "deal_history", "touch_events", "lead_touches"]) await db`delete from ${db(t)} where installation_id = ${i}`.catch(() => undefined);
      for (const co of [CO_A, CO_B]) await db`delete from installations where company_id = ${co}`;
    }
    await closeDb();
  });

  it("credits actions to the person who acted and outcomes to the owner at the time", async () => {
    if (!applied) return;
    const r = await call(session(CO_A, "agency", null, "ppOwnerA", "agency_owner"), `people3?part=scorecards&location=${A1}&size=100`);
    expect(r.status).toBe(200);
    const by = new Map<string, Json>((r.body.rows as Json[]).map((x) => [x.person.userId, x]));
    const sam = by.get("ppSet1")!, dee = by.get("ppSet2")!, cal = by.get("ppClose1")!;
    expect(sam.answeredFirst.current).toBe(25);
    expect(sam.inTime.value).toBeCloseTo(0.8, 5);
    expect(sam.typicalReplySeconds).toBe(300);
    expect(dee.inTime.value).toBeCloseTo(0.4, 5);
    expect(sam.apptsSet.current).toBe(5); // ap1, ap2, ap4, ap5, ap6 carry Sam as the recorded creator
    expect(sam.setShowed.of).toBe(3); // ap1 and ap6 showed, ap2 no-show
    expect(dee.apptsSetEstimated).toBe(1); // ap3 has no creator: Dee was the last person to text that contact
    expect(dee.wonValue.current).toBe(5000); // owner at the time of the win
    expect(cal.wonValue.current).toBe(0); // today's owner is not credited
    expect(sam.waiting).toBe(3);
    expect(r.body.unattributed).toEqual({ automated: 1, unknown: 1 });
  });

  it("a count equals the rows it opens", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const wl = await call(t, `people3?part=workload&location=${A1}&size=100`);
    const row = (u: string) => (wl.body.rows as Json[]).find((x) => x.person.userId === u)!;
    const sam = row("ppSet1"), cal = row("ppClose1");
    expect([sam.waiting, sam.waitingOld]).toEqual([3, 2]);
    expect([cal.openDeals, cal.staleDeals, cal.needsOutcome, cal.upcoming]).toEqual([2, 1, 1, 1]);
    const total = async (reason: string, user: string) => (await call(t, `people3?part=list&reason=${reason}&user=${user}&location=${A1}`)).body.total;
    expect(await total("waiting", "ppSet1")).toBe(sam.waiting);
    expect(await total("waiting_old", "ppSet1")).toBe(sam.waitingOld);
    expect(await total("open_deals", "ppClose1")).toBe(cal.openDeals);
    expect(await total("stale_deals", "ppClose1")).toBe(cal.staleDeals);
    expect(await total("needs_outcome", "ppClose1")).toBe(cal.needsOutcome);
    expect(await total("upcoming", "ppClose1")).toBe(cal.upcoming);
    const rows = (await call(t, `people3?part=list&reason=waiting_old&user=ppSet1&location=${A1}`)).body.rows as Json[];
    expect(rows.map((x) => x.title).sort()).toEqual(["Lead W1", "Lead W2"]);
    expect((await call(t, `people3?part=list&reason=no_owner&location=${A1}`)).body.total).toBe(1);
  });

  it("the other parts answer with real numbers", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const money = (await call(t, `people3?part=money&location=${A1}`)).body;
    const cal = (money.rows as Json[]).find((x) => x.person.userId === "ppClose1")!;
    expect([cal.openValue, cal.staleValue, cal.atRiskValue]).toEqual([3000, 2000, 2000]);
    expect((money.rows as Json[]).find((x) => x.person.userId === "ppSet2")!.wonValue).toBe(5000);
    expect(money.totals.wonValue).toBe(5000);
    const hand = (await call(t, `people3?part=handoff&location=${A1}`)).body;
    expect(hand.rows.map((x: Json) => [x.setter.name, x.closer.name, x.deals, x.medianDays])).toEqual([["Sam Setter", "Dee Setter", 1, 15]]);
    const acc = (await call(t, "people3?part=access")).body;
    expect(acc.rows.map((x: Json) => x.person.userId).sort()).toEqual(["ppClose1", "ppOwnerA", "ppSet1", "ppSet2"]);
    expect(acc.accounts.find((x: Json) => x.locationId === A1).people).toBe(4);
    const next = (await call(t, `people3?part=nextlead&location=${A1}`)).body;
    expect(next.isEstimate).toBe(true);
    expect(next.suggestion.userId).toBe("ppSet2");
    expect(next.suggestion.reasons[0]).toMatch(/no leads waiting/);
    const person = (await call(t, `people3?part=person&user=ppSet1&location=${A1}`)).body;
    expect(person.weeks).toHaveLength(8);
    expect(person.headline).toMatch(/Sam Setter/);
    expect(person.accounts[0].waiting).toBe(3);
    const coach = (await call(t, `people3?part=coaching&user=ppSet1&location=${A1}`)).body;
    expect(coach.moves).toHaveLength(4);
    const today = (await call(t, `people3?part=today&location=${A1}`)).body;
    expect(today.lines[0].kind).toBe("idle");
    expect(today.lines[0].text).toMatch(/No activity recorded in your CRM/);
    expect((await call(t, "people3?part=options")).body.accounts).toHaveLength(2);
    const csv = await call(t, `people3?part=export&location=${A1}`);
    expect(csv.text).toMatch(/^Person,Accounts,/);
    expect(csv.text).toMatch(/Sam Setter/);
  });

  it("the live scan answers exactly like the rollup, and refreshing twice changes nothing", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const count = async () => Number((await sql()`select count(*)::int c from user_daily where installation_id = ${instA}`)[0].c);
    const before = await count();
    await refreshUserRollup(instA, 60);
    expect(await count()).toBe(before);
    const viaTable = await call(t, `people3?part=scorecards&location=${A1}&size=100`);
    await sql()`update user_rollup_state set refreshed_at = now() - interval '5 hours' where installation_id = ${instA}`;
    const live = await call(t, `people3?part=scorecards&location=${A1}&size=99`);
    expect(live.status).toBe(200);
    expect(live.body.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(live.body.rows)).toBe(JSON.stringify(viaTable.body.rows));
    await sql()`update user_rollup_state set refreshed_at = now() where installation_id = ${instA}`;
  });

  it("new people appear by themselves, the users list gives roles and accounts, and someone who left keeps their history greyed", async () => {
    if (!applied) return;
    const db = sql();
    await saveLocationUsers(instA, A2, [
      { id: "ppListed", name: "Lee Listed", photoUrl: null, email: "lee@example.test", roleType: "account", role: "user", locationIds: [A2], deleted: false },
      { id: "ppSet1", name: "Sam Setter", photoUrl: null, email: null, roleType: "account", role: "user", locationIds: [A1, A2], deleted: false },
    ]);
    expect((await db`select role, source from team_members where installation_id = ${instA} and user_id = 'ppListed'`)[0]).toMatchObject({ role: "account_user", source: "users" });
    await db`insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, user_id, automated) values (${instA}, ${A1}, 'c-new', 'tnew', 'outbound', 'sms', 'message', now(), 'ppNew1', false)`;
    const rep = await refreshTeamIdentity(instA);
    expect(rep.fromActivity).toBeGreaterThan(0);
    const o = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const acc = (await call(o, "people3?part=access&size=100")).body;
    const fresh = (acc.rows as Json[]).find((x) => x.person.userId === "ppNew1")!;
    expect(fresh.person.isNew).toBe(true);
    expect(fresh.person.name).toBe("Unnamed user");
    expect(fresh.flags).toContain("new");
    expect(acc.newPeople).toBeGreaterThan(0);
    await db`update team_members set deleted = true where installation_id = ${instA} and user_id = 'ppListed'`;
    const after = (await call(o, "people3?part=access&size=100&q=Lee")).body;
    expect(after.rows[0].person.name).toBe("Lee Listed");
    expect(after.rows[0].person.deleted).toBe(true);
    expect(after.rows[0].flags).toContain("deleted");
    await db`delete from team_members where installation_id = ${instA} and user_id in ('ppListed', 'ppNew1')`;
    await db`delete from team_member_access where installation_id = ${instA} and user_id in ('ppListed', 'ppNew1')`;
  });

  it("an account administrator sees the people of their own account only, and a person id from another account is not found", async () => {
    if (!applied) return;
    const acct = (allowed: string[]) => ({ inst: instA, allowed, level: "account" as const, selfId: "ppSet1" });
    const names = async (allowed: string[]) => [...(await loadPeople(acct(allowed), [{ id: allowed[0], name: "x", tz: null, targetMinutes: 15, clock: { zone: null, businessHours: false, openHour: 9, closeHour: 17 }, usersAccess: "ok", lastSyncAt: null }])).keys()].sort();
    expect(await names([A1])).toEqual(["ppClose1", "ppOwnerA", "ppSet1", "ppSet2"]);
    expect(await names([A2])).toEqual(["ppSet1"]);
    expect(await ownedUser(acct([A2]), [A2], "ppSet2")).toBeNull();
    expect(await ownedUser(acct([A1]), [A1], "ppSet2")).toBe("ppSet2");
    expect(await ownedUser(acct([A1]), [A1], "ppB1")).toBeNull();
    const w = { from: new Date(Date.now() - 28 * DAY), to: new Date(Date.now() + DAY) };
    const r = await scorecards(acct([A2]), { ...w }, { sort: "answered", size: 25 }, 29);
    expect(r.rows.map((x) => x.person.userId)).toEqual(["ppSet1"]);
  });

  it("ranks fairly inside one account and shows the top half by default", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const lb = await call(t, `people3?part=leaderboard&location=${A1}&role=setter`);
    const board = (lb.body.boards as Json[])[0];
    expect(board.kind).toBe("setters");
    expect(board.ranked).toBe(2);
    expect(board.visibility).toBe("top_half");
    expect(board.shown.map((x: Json) => x.person.userId)).toEqual(["ppSet1"]);
    expect(board.hidden).toBe(1);
    expect(board.shown[0].rank).toBe(1);
    const all = await call(t, `people3?part=leaderboard&location=${A1}&role=setter&all=1`);
    expect((all.body.boards as Json[])[0].shown.map((x: Json) => x.person.userId)).toEqual(["ppSet1", "ppSet2"]);
  });

  it("every part, asked for the other company's account or people in every way, shows nothing of them and never errors", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const asks = [
      "", `location=${B1}`, `user=ppB1`, `user=ppB1&location=${B1}`, `location=${A1}&user=ppB1`, `location=${B1}&user=ppSet1`, "after=garbage", `after=${Buffer.from(JSON.stringify([1, "ppB1"])).toString("base64url")}`,
      "q=zzPpB", "source=zzPpB", `ids=${B1}`, `account=${B1}`, `userId=ppB1`, "location=%27%3B%20select%201", `location=${"x".repeat(200)}`, `user=${"y".repeat(200)}`, "sort=won&dir=asc&size=100", "from=2020-01-01&to=2020-01-02", "named=1", "admins=1&all=1",
    ];
    for (const part of PARTS) for (const extra of asks) {
      const r = await call(t, `people3?part=${part}&reason=waiting&${extra}`);
      expect(r.status, `${part} ${extra}`).toBeLessThan(500);
      expect(r.text, `${part} ${extra}`).not.toMatch(LEAK_B);
    }
    const csv = await call(t, "people3?part=export");
    expect(csv.text).not.toMatch(LEAK_B);
    expect((await call(t, `people3?part=export&location=${B1}`)).text).not.toMatch(LEAK_B);
    for (const reason of ["waiting", "waiting_old", "stale_deals", "open_deals", "needs_outcome", "upcoming", "no_owner"]) {
      for (const extra of ["", `location=${B1}`, "user=ppB1", `user=ppB1&location=${B1}`]) expect((await call(t, `people3?part=list&reason=${reason}&${extra}`)).text, `${reason} ${extra}`).not.toMatch(LEAK_B);
    }
    // Company B asking about company A's people sees nothing of A either.
    const tb = session(CO_B, "agency", null, "ppB1", "agency_owner");
    for (const part of PARTS) for (const extra of ["", `location=${A1}`, "user=ppSet1", `user=ppSet1&location=${A1}`]) {
      const r = await call(tb, `people3?part=${part}&reason=waiting&${extra}`);
      expect(r.status, `B ${part} ${extra}`).toBeLessThan(500);
      expect(r.text, `B ${part} ${extra}`).not.toMatch(/zzPp3|xtestPp3A|ppSet|ppClose|ppOwnerA|Sam Setter|Dee Setter|Cal Closer/);
    }
  });

  it("a person without full access sees only themselves, enforced on the server", async () => {
    if (!applied) return;
    const staffs = [session(CO_A, "agency", null, "ppSet1", "agency_staff"), session(CO_A, "client", A1, "ppSet1", "account_user")];
    for (const tok of staffs) {
      const sc = await call(tok, "people3?part=scorecards&size=100");
      expect(sc.status).toBe(200);
      expect((sc.body.rows as Json[]).map((x) => x.person.userId)).toEqual(["ppSet1"]);
      expect(sc.text).not.toMatch(/ppSet2|ppClose1|ppOwnerA|Dee Setter|Cal Closer|Olive Owner/);
      for (const part of PARTS) for (const extra of ["", "user=ppSet2", `user=ppClose1&location=${A1}`, "admins=1&all=1"]) {
        const r = await call(tok, `people3?part=${part}&reason=waiting&${extra}`);
        expect(r.status, `${part} ${extra}`).toBeLessThan(500);
        expect(r.text, `${part} ${extra}`).not.toMatch(/ppSet2|ppClose1|ppOwnerA|Dee Setter|Cal Closer|Olive Owner/);
        expect(r.text, `${part} ${extra}`).not.toMatch(LEAK_B);
      }
      const lb = await call(tok, `people3?part=leaderboard&location=${A1}&all=1`);
      const board = (lb.body.boards as Json[])[0];
      expect(board.shown).toEqual([]);
      expect(board.you.rank).toBe(1);
      expect(board.you.of).toBe(2);
      const wl = await call(tok, "people3?part=workload&size=100");
      expect((wl.body.rows as Json[]).every((x) => x.person.userId === "ppSet1")).toBe(true);
      expect((await call(tok, "people3?part=list&reason=no_owner")).body.rows).toEqual([]);
      expect((await call(tok, "people3?part=options")).body.viewer.canSeeEmail).toBe(false);
    }
  });

  it("the client receipt is team level by default and names staff only when the agency chose that for the client", async () => {
    if (!applied) return;
    const owner = session(CO_A, "agency", null, "ppOwnerA", "agency_owner");
    const plain = await call(owner, `people3?part=proof&location=${A1}`);
    expect(plain.body.staff).toBeNull();
    expect(plain.body.naming).toBe("team");
    expect(plain.body.leads).toBe(50);
    expect(plain.body.answered).toBe(50);
    // The address cannot switch naming on: only the saved choice for this client does (PB table people_proof_prefs, applied by 20261203090000).
    expect((await call(owner, `people3?part=proof&location=${A1}&named=1`)).body.staff).toBeNull();
    try { await sql()`insert into people_proof_prefs (installation_id, location_id, name_staff) values (${instA}, ${A1}, true) on conflict (installation_id, location_id) do update set name_staff = true`; } catch { return; }
    const named = await call(owner, `people3?part=proof&location=${A1}`);
    expect((named.body.staff as Json[]).map((x) => x.name).sort()).toEqual(["Dee Setter", "Sam Setter"]);
    const staff = await call(session(CO_A, "agency", null, "ppSet1", "agency_staff"), `people3?part=proof&location=${A1}&named=1`);
    expect(staff.body.staff).toBeNull();
    expect(staff.body.leads).toBe(0);
    await sql()`delete from people_proof_prefs where installation_id = ${instA}`;
  });
});
