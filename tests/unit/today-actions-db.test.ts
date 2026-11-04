import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import type { TodayData } from "@/lib/analytics/today-types";

// The working queue of Today against the real database: Done, Snooze, Assign and Undo on a Fix first row.
//   1. The marks live only in SubSync (the today_actions table). A press is one appended row; an Undo is one more row that points at it.
//   2. The caller, the lane and the account all come from the signed session. The browser names only a row (account and kind) and what to do; a row of another
//      company's account, or of a sibling account a client's staff may not read, answers exactly like a row that does not exist.
//   3. A client's staff mark in a lane of their own, so their marks can never hide a problem from the agency; they may not assign.
//   4. If the database update has not been applied (no today_actions table) Today still opens with every row and a press answers in plain words.
// Fixture companies only, removed afterwards (deleting the installation cascades). Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO_A = "xtest-tact-a", CO_B = "xtest-tact-b";
const A1 = "xtestTactA1", A2 = "xtestTactA2", B1 = "xtestTactB1";
let instA = "", instB = "";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null, userId = `u-${kind}`) =>
  signSession({ companyId: company, userId, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" });
async function today(token: string, query = ""): Promise<TodayData & Json> {
  const res = await handle(new Request(`http://localhost/api/app/today${query}`, { headers: { Authorization: `Bearer ${token}` } }), ["today"]);
  expect(res.status).toBe(200);
  return (await res.json()) as TodayData & Json;
}
async function act(token: string, body: Json): Promise<{ status: number; body: Json }> {
  const res = await handle(new Request("http://localhost/api/app/today/action", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), ["today", "action"]);
  return { status: res.status, body: (await res.json()) as Json };
}
const idsOf = (d: TodayData, loc: string, kind: string) => d.items.filter((i) => i.locationId === loc && i.kind === kind).map((i) => i.id).sort();

describe.skipIf(!HAS_DB)("Today's working queue", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAct A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAct B', 'pro') returning id` as unknown as Array<{ id: string }>;
    await sql()`insert into settings (installation_id) values (${instA}) on conflict do nothing`;
    await sql()`insert into settings (installation_id) values (${instB}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzAct Client A1"], [instA, A2, "zzAct Client A2"], [instB, B1, "zzAct Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
      for (let i = 0; i < 3; i++) {
        await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at)
          values (${inst}, ${loc}, ${`${loc}-c${i}`}, ${`${loc}-p${i}`}, ${`Person ${loc} ${i}`}, 'TYPE_SMS', 'inbound', now() - interval '3 days')`;
      }
    }
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("Done on a row is one appended event that holds exactly that row's items, and nothing else", async () => {
    const agency = session(CO_A, "agency", null);
    const before = await today(agency);
    const mine = idsOf(before, A1, "unanswered");
    expect(mine.length).toBe(3);
    const r = await act(agency, { action: "done", rowKey: `${A1}|unanswered` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.count).toBe(3);
    const rows = await sql()`select action, lane, location_id, item_ids from today_actions where installation_id = ${instA}`;
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("done");
    expect(rows[0].lane).toBe("team");
    expect([...(rows[0].item_ids as string[])].sort()).toEqual(mine);
    const after = await today(agency);
    expect(Object.keys(after.holds).sort()).toEqual(mine);
    // The sibling account is untouched.
    expect(Object.keys(after.holds).some((id) => id.includes(A2))).toBe(false);
  });

  it("Undo is a new row pointing at the press; the hold ends and nothing was deleted", async () => {
    const agency = session(CO_A, "agency", null);
    const [{ id }] = await sql()`select id::int from today_actions where installation_id = ${instA} and action = 'done' limit 1`;
    const u = await act(agency, { action: "undo", eventId: id });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    const all = await sql()`select action, undoes::int from today_actions where installation_id = ${instA} order by id`;
    expect(all.map((r) => r.action)).toEqual(["done", "undo"]);
    expect(all[1].undoes).toBe(id);
    expect(Object.keys((await today(agency)).holds)).toEqual([]);
  });

  it("Snooze needs a choice and sets a return time; Assign to me shows the person's name", async () => {
    const agency = session(CO_A, "agency", null);
    expect((await act(agency, { action: "snooze", rowKey: `${A1}|unanswered` })).status).toBe(400);
    const s = await act(agency, { action: "snooze", rowKey: `${A1}|unanswered`, choice: "day" });
    expect(s.status).toBe(200);
    expect(s.body.until).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    const a = await act(agency, { action: "assign", rowKey: `${A2}|unanswered` });
    expect(a.status).toBe(200);
    const d = await today(agency);
    expect(d.holds[`unanswered:${A1}:${A1}-p0`] ?? Object.values(d.holds)[0]).toBeTruthy();
    expect(Object.values(d.assigned as Record<string, { by: string | null }>).some((x) => x.by === "Test agency")).toBe(true);
  });

  it("a row of another company's account, or of an account that does not exist, is refused with the same answer", async () => {
    const agency = session(CO_A, "agency", null);
    const foreign = await act(agency, { action: "done", rowKey: `${B1}|unanswered` });
    const missing = await act(agency, { action: "done", rowKey: `xtestNoSuchAccount|unanswered` });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect((await sql()`select count(*)::int n from today_actions where installation_id = ${instB}`)[0].n).toBe(0);
    // Malformed rows never reach the database.
    for (const rowKey of ["", `${A1}`, `${A1}|nothing`, `${A1}|unanswered|x`, "../../x|unanswered", 42, null]) expect((await act(agency, { action: "done", rowKey })).status, String(rowKey)).toBe(400);
    expect((await act(agency, { action: "delete", rowKey: `${A1}|unanswered` })).status).toBe(400);
  });

  it("a client's staff mark in their own lane, cannot assign, cannot reach a sibling account, and cannot undo someone else's mark", async () => {
    const agency = session(CO_A, "agency", null);
    const client = session(CO_A, "client", A1, "u-setter");
    const before = await today(agency);
    const held = Object.keys(before.holds).length;
    const own = await act(client, { action: "done", rowKey: `${A1}|unanswered` });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const lane = await sql()`select lane from today_actions where id = ${own.body.eventId}`;
    expect(lane[0].lane).toBe("user:u-setter");
    // The agency's queue is unchanged by the setter's mark.
    expect(Object.keys((await today(agency)).holds).length).toBe(held);
    // The setter's own read holds the row back.
    expect(Object.keys((await today(client)).holds).length).toBeGreaterThan(0);
    expect((await act(client, { action: "assign", rowKey: `${A1}|unanswered` })).status).toBe(403);
    expect((await act(client, { action: "done", rowKey: `${A2}|unanswered` })).status).toBe(404);
    expect((await act(client, { action: "done", rowKey: `${B1}|unanswered` })).status).toBe(404);
    // An event id from the team lane finds nothing for the setter.
    const [team] = await sql()`select id::int from today_actions where installation_id = ${instA} and lane = 'team' order by id limit 1`;
    expect((await act(client, { action: "undo", eventId: team.id })).status).toBe(404);
    // Another setter cannot undo this setter's mark either.
    const other = session(CO_A, "client", A1, "u-other");
    expect((await act(other, { action: "undo", eventId: own.body.eventId })).status).toBe(404);
  });

  it("with no session, or a session of another company, nothing is written", async () => {
    const before = (await sql()`select count(*)::int n from today_actions`)[0].n;
    const res = await handle(new Request("http://localhost/api/app/today/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "done", rowKey: `${A1}|unanswered` }) }), ["today", "action"]);
    expect(res.status).toBe(401);
    const b = await act(session(CO_B, "agency", null), { action: "done", rowKey: `${A1}|unanswered` });
    expect(b.status).toBe(404);
    expect((await sql()`select count(*)::int n from today_actions`)[0].n).toBe(before);
  });

  it("without the today_actions table Today still opens with every row, and a press answers in plain words", async () => {
    await sql()`alter table today_actions rename to today_actions_off`;
    try {
      const agency = session(CO_A, "agency", null);
      const d = await today(agency);
      expect(d.items.length).toBeGreaterThan(0);
      expect(d.holds).toEqual({});
      expect(d.actionsReady).toBe(false);
      const r = await act(agency, { action: "done", rowKey: `${A1}|unanswered` });
      expect(r.status).toBe(503);
      expect(r.body.needsUpdate).toBe(true);
      expect(String(r.body.error)).toMatch(/latest database update/i);
    } finally {
      await sql()`alter table today_actions_off rename to today_actions`;
    }
  });
});
