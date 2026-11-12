import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant and behaviour test for Finance (money overview, client revenue, churn watch, payouts, billing notes):
//   1. Each company reads and writes only its OWN client accounts and people; the other company's ids answer "not found" and are never echoed.
//   2. A person without manager rights (agency staff, account administrator) reaches ONLY their own payout statement, whatever person id they send; a client's staff reach nothing.
//   3. A statement's count equals its rows, a frozen period is a copy that never changes, a disputed line is held out of the payable total, deletes need the typed name, a formula in a name stays text in the CSV.
// Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-fn-a", CO_B = "xtest-fn-b", A1 = "xtestFnA1", A2 = "xtestFnA2", B1 = "xtestFnB1";
const SET_A = "xt-fn-a-setter", CLOSE_A = "xt-fn-a-closer", SET_B = "xt-fn-b-setter";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client" | "business" = "agency", loc: string | null = null, personRole: string = "agency_owner", userId = `u-${company}`) =>
  signSession({ companyId: company, userId, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole } as never);
async function call(token: string, method: "GET" | "POST" | "PUT", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}
const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const at = (back: number, hour = 12) => new Date(new Date(`${day(back)}T00:00:00Z`).getTime() + hour * 3_600_000);
const RANGE = `from=${day(29)}&to=${day(0)}`;

async function seed(inst: string, loc: string, tag: string, setter: string, closer: string, wins: number, past: boolean) {
  const db = sql();
  await db`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, ${`zzFn ${tag}`})`;
  await db`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status, price_amount, price_currency, billing_interval) values (${inst}, ${loc}, 'ok', 'plan-x', 'Growth', ${past ? "past_due" : "active"}, 300, 'USD', 'month')`;
  for (let d = 0; d < 60; d++) await db`insert into client_daily (installation_id, location_id, day, new_leads, booked, won, won_value, staff_messages) values (${inst}, ${loc}, ${day(d)}::date, ${d < 14 && tag === "A2" ? 0 : 5}, 2, ${d % 20 === 0 ? 1 : 0}, ${d % 20 === 0 ? 1000 : 0}, 10)`;
  for (let i = 0; i < 6; i++) {
    const c = `xtest-c-${loc}-${i}`;
    await db`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, assigned_to) values (${inst}, ${loc}, ${c}, ${`Zed${tag}`}, ${`Person${i}`}, ${setter})`;
    await db`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, status, start_at, created_remote_at, assigned_to, booked_by_user) values (${inst}, ${loc}, ${`xtest-a-${loc}-${i}`}, ${c}, ${i === 5 ? "cancelled" : i % 2 ? "showed" : "noshow"}, ${at(10 + i)}, ${at(12 + i)}, ${closer}, ${setter})`;
    if (i < wins) await db`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, status, monetary_value, last_status_change_at, assigned_to) values (${inst}, ${loc}, ${`xtest-o-${loc}-${i}`}, ${c}, 'won', ${1000 + i * 500}, ${at(5)}, ${closer})`;
  }
}
const nameOf = (id: string) => (id === SET_A ? "=HYPERLINK(1)" : id === CLOSE_A ? "Casey Closer" : "Bo Setter");

describe.skipIf(!HAS_DB)("Finance cross-tenant and behaviour", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from fn_ledger limit 1`; await sql()`select 1 from fn_pay_lines limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'Brightside Marketing', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'Zeta Media', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await seed(instA, A1, "A1", SET_A, CLOSE_A, 4, false);
    await seed(instA, A2, "A2", SET_A, CLOSE_A, 0, true);
    await seed(instB, B1, "B1", SET_B, "xt-fn-b-closer", 3, false);
    for (const [inst, ids] of [[instA, [SET_A, CLOSE_A]], [instB, [SET_B, "xt-fn-b-closer"]]] as const) for (const u of ids) await sql()`insert into team_members (installation_id, user_id, name, role, all_accounts) values (${inst}, ${u}, ${nameOf(u)}, 'agency_staff', true)`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("the overview, revenue and churn lists hold only this company's accounts and the counts equal the rows", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    const rev = await call(a, "GET", `finance?part=revenue&${RANGE}&size=50`);
    expect(rev.status).toBe(200);
    expect(rev.body.rows.map((r: Json) => r.locationId).sort()).toEqual([A1, A2]);
    expect(rev.body.total).toBe(2);
    expect(rev.body.totals.won).toBe(rev.body.rows.reduce((n: number, r: Json) => n + r.won, 0));
    expect(rev.text).not.toMatch(/zzFn B1|xtestFnB1|Zeta Media/);
    expect((await call(b, "GET", `finance?part=revenue&${RANGE}`)).body.rows.map((r: Json) => r.locationId)).toEqual([B1]);
    const ov = await call(a, "GET", `finance?part=overview&${RANGE}`);
    expect(ov.status).toBe(200);
    expect(ov.body.totals.mrr).toEqual([{ currency: "USD", amount: 300, accounts: 1 }]);
    expect(ov.body.totals.atRisk).toEqual([{ currency: "USD", amount: 300, accounts: 1 }]);
    expect(ov.body.trend.enough).toBe(false);
    const ch = await call(a, "GET", "finance?part=churn&level=all&size=50");
    expect(ch.body.rows.map((r: Json) => r.locationId).sort()).toEqual([A1, A2]);
    expect(ch.body.total).toBe(2);
    const a2 = ch.body.rows.find((r: Json) => r.locationId === A2);
    expect(a2.evidence.map((e: Json) => e.key)).toEqual(expect.arrayContaining(["plan", "no_leads"]));
    expect(ch.text).not.toMatch(/zzFn B1|xtestFnB1/);
  });

  it("another company's account or person id answers 'not found' on every read and write, and is never echoed", async () => {
    if (!ready) return;
    const a = session(CO_A);
    for (const [m, p, body] of [
      ["PUT", "finance/churn", { locationId: B1, status: "working" }], ["PUT", "finance/spend", { locationId: B1, month: day(0).slice(0, 7), amount: 5, currency: "USD" }], ["POST", "finance/ledger/add", { locationId: B1, label: "x", amount: 1, currency: "USD", dueOn: day(1) }],
      ["PUT", "finance/rate", { role: "setter", personId: SET_B, pct: 1, flat: 1 }], ["PUT", "finance/rate", { role: "setter", locationId: B1, pct: 1, flat: 1 }], ["PUT", "finance/churn", { locationId: A1, owner: SET_B }],
      ["GET", `finance?part=statement&person=${SET_B}&${RANGE}`, undefined], ["GET", `finance?part=ledger&location=${B1}`, undefined], ["GET", `finance?part=export&what=statement&person=${SET_B}&${RANGE}`, undefined],
    ] as const) {
      const r = await call(a, m, p, body);
      if (p.startsWith("finance?part=ledger")) { expect(r.body.rows).toEqual([]); continue; }
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(r.text).not.toMatch(/xtestFnB1|xt-fn-b-|Zeta/);
    }
    const found = await call(a, "GET", "finance?part=find&what=account&q=B1");
    expect(found.body.rows).toEqual([]);
    expect((await call(a, "GET", "finance?part=find&what=person&q=Bo")).body.rows).toEqual([]);
  });

  it("a person without manager rights sees only their own statement; a client's staff see nothing; a forged session is refused", async () => {
    if (!ready) return;
    const staff = session(CO_A, "agency", null, "agency_staff", SET_A);
    for (const part of ["overview", "revenue", "churn", "payouts", "ledger", "setup", "headline", "movement"]) expect((await call(staff, "GET", `finance?part=${part}&${RANGE}`)).status, part).toBe(403);
    for (const [m, p, body] of [["PUT", "finance/settings", { currency: "EUR" }], ["POST", "finance/freeze", { from: day(29), to: day(0), basis: "booked", confirm: "x" }], ["PUT", "finance/rate", { role: "setter", pct: 1 }], ["PUT", "finance/churn", { locationId: A1, status: "lost" }]] as const) expect((await call(staff, m, p, body)).status, p).toBe(403);
    // Their own statement, even when they ask for somebody else's person id.
    const mine = await call(staff, "GET", `finance?part=statement&person=${CLOSE_A}&basis=booked&${RANGE}&size=50`);
    expect(mine.status).toBe(200);
    expect(mine.body.person.personId).toBe(SET_A);
    expect(mine.body.rows.every((r: Json) => r.role === "setter" || r.role === "closer")).toBe(true);
    const all = await call(staff, "GET", `finance?part=statement&basis=booked&${RANGE}&size=50`);
    expect(all.body.total).toBe(10); // booked as setter: 5 of 6 (one is cancelled) in each of A1 and A2; every line is theirs
    expect(all.body.person.personId).toBe(SET_A);
    expect((await call(session(CO_A, "client", A1), "GET", `finance?part=statement&${RANGE}`)).status).toBe(403);
    expect((await call("forged.token.value", "GET", `finance?part=statement&${RANGE}`)).status).toBe(401);
    const acct = await call(session(CO_A, "business", A1, "account_admin", SET_A), "GET", `finance?part=payouts&${RANGE}`);
    expect(acct.status).toBe(403);
  });

  it("the payout report counts each line once, count equals rows, the CSV is formula-safe, and a bad date is refused", async () => {
    if (!ready) return;
    const a = session(CO_A);
    expect((await call(a, "PUT", "finance/settings", { payoutBasis: "booked", currency: "USD" })).status).toBe(200);
    expect((await call(a, "PUT", "finance/rate", { role: "setter", pct: 0, flat: 25 })).status).toBe(200);
    expect((await call(a, "PUT", "finance/rate", { role: "setter", personId: SET_A, locationId: A2, pct: 0, flat: 40 })).status).toBe(200);
    const sum = await call(a, "GET", `finance?part=payouts&${RANGE}&size=50`);
    expect(sum.status).toBe(200);
    const s = sum.body.rows.find((r: Json) => r.personId === SET_A);
    expect(s.name).toBe("=HYPERLINK(1)");
    expect(s.booked).toBe(10); // 5 not cancelled in each of A1 and A2
    expect(s.payable).toBe(5 * 25 + 5 * 40); // the most specific rate wins in A2
    const st = await call(a, "GET", `finance?part=statement&person=${SET_A}&kind=booked&role=setter&${RANGE}&size=100`);
    expect(st.body.total).toBe(s.booked);
    expect(st.body.rows).toHaveLength(s.booked);
    expect(new Set(st.body.rows.map((r: Json) => r.lineKey)).size).toBe(s.booked);
    const csv = await handle(new Request(`http://localhost/api/app/finance?part=export&what=statement&person=${SET_A}&kind=booked&role=setter&${RANGE}`, { headers: { Authorization: `Bearer ${a}` } }), ["finance"]);
    const text = await csv.text();
    expect(text.trim().split("\r\n")).toHaveLength(1 + s.booked);
    expect(text).toContain("'=HYPERLINK(1)");
    expect((await call(a, "GET", "finance?part=payouts&from=2026-13-40&to=2026-14-01")).status).toBe(400);
    expect((await call(a, "GET", `finance?part=payouts&from=${day(900)}&to=${day(0)}`)).status).toBe(400);
  });

  it("a flagged line is held out of the payable total, only its own person or the owner can flag it, and only the owner settles it", async () => {
    if (!ready) return;
    const a = session(CO_A), staff = session(CO_A, "agency", null, "agency_staff", SET_A), other = session(CO_A, "agency", null, "agency_staff", CLOSE_A);
    const lines = (await call(a, "GET", `finance?part=statement&person=${SET_A}&kind=booked&role=setter&${RANGE}&size=100`)).body.rows as Json[];
    const key = lines[0].lineKey as string;
    const body = { lineKey: key, note: "I did not book this.", from: day(29), to: day(0), basis: "booked" };
    expect((await call(other, "POST", "finance/dispute", body)).status, "someone else's line").toBe(404);
    expect((await call(a, "POST", "finance/dispute", { ...body, lineKey: "booked:xtestFnB1:xtest-a-xtestFnB1-1:setter" })).status).toBe(404);
    expect((await call(a, "POST", "finance/dispute", { ...body, lineKey: "../../etc" })).status).toBe(404);
    const before = (await call(a, "GET", `finance?part=payouts&${RANGE}&size=50`)).body.rows.find((r: Json) => r.personId === SET_A).payable;
    expect((await call(staff, "POST", "finance/dispute", body)).status).toBe(200);
    const after = (await call(a, "GET", `finance?part=payouts&${RANGE}&size=50`)).body;
    const row = after.rows.find((r: Json) => r.personId === SET_A);
    expect(row.disputed).toBe(1);
    expect(row.payable + row.held).toBe(before);
    expect(row.held).toBeGreaterThan(0);
    expect(after.disputes).toHaveLength(1);
    expect((await call(staff, "POST", "finance/dispute/resolve", { lineKey: key })).status).toBe(403);
    expect((await call(a, "POST", "finance/dispute/resolve", { lineKey: key })).body.ok).toBe(true);
    expect((await call(a, "GET", `finance?part=payouts&${RANGE}&size=50`)).body.rows.find((r: Json) => r.personId === SET_A).payable).toBe(before);
  });

  it("freezing needs the typed label, copies every line, never changes afterwards, and unfreezing needs the typed label", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B), staff = session(CO_A, "agency", null, "agency_staff", SET_A);
    const label = `${day(29)} to ${day(0)} (booked)`;
    expect((await call(a, "POST", "finance/freeze", { from: day(29), to: day(0), basis: "booked" })).status).toBe(400);
    expect((await call(a, "POST", "finance/freeze", { from: day(29), to: day(0), basis: "booked", confirm: "nope" })).status).toBe(400);
    const live = (await call(a, "GET", `finance?part=payouts&${RANGE}&size=50`)).body;
    const fr = await call(a, "POST", "finance/freeze", { from: day(29), to: day(0), basis: "booked", confirm: ` ${label.toUpperCase()} ` });
    expect(fr.status).toBe(200);
    expect(fr.body.lines).toBe(live.totals.counted);
    expect((await call(a, "POST", "finance/freeze", { from: day(29), to: day(0), basis: "booked", confirm: label })).status, "freezing twice").toBe(409);
    // The CRM changes afterwards: the live total moves, the frozen copy does not.
    await sql()`update cached_appointments set status = 'cancelled' where installation_id = ${instA} and location_id = ${A1}`;
    (await import("@/lib/analytics/finance-queries")).financeCache.clear("");
    const liveAfter = (await call(a, "GET", `finance?part=payouts&${RANGE}&size=50`)).body;
    expect(liveAfter.totals.payable).toBeLessThan(live.totals.payable);
    const periods = (await call(a, "GET", "finance?part=periods")).body.rows as Json[];
    expect(periods).toHaveLength(1);
    expect(periods[0].total).toBe(live.totals.payable + live.totals.held);
    const frozen = await call(a, "GET", `finance?part=statement&period=${fr.body.id}&person=${SET_A}&size=100`);
    expect(frozen.body.frozen).toBe(true);
    expect(frozen.body.total).toBe(live.rows.find((r: Json) => r.personId === SET_A).counted);
    const sum = await call(a, "GET", `finance?part=periods&id=${fr.body.id}`);
    expect(sum.body.rows.find((r: Json) => r.personId === SET_A).lines).toBe(frozen.body.total);
    // Another company cannot open or unfreeze it; a person sees only the period that has their lines, and only their own.
    expect((await call(b, "GET", `finance?part=statement&period=${fr.body.id}`)).status).toBe(404);
    expect((await call(b, "POST", "finance/unfreeze", { id: fr.body.id, confirm: label })).status).toBe(404);
    expect((await call(staff, "GET", `finance?part=periods&id=${fr.body.id}`)).body.mine.person.personId).toBe(SET_A);
    expect((await call(staff, "POST", "finance/unfreeze", { id: fr.body.id, confirm: label })).status).toBe(403);
    expect((await call(a, "POST", "finance/unfreeze", { id: fr.body.id, confirm: "wrong" })).status).toBe(400);
    expect((await call(a, "POST", "finance/unfreeze", { id: fr.body.id, confirm: label })).body.ok).toBe(true);
    expect((await call(a, "GET", "finance?part=periods")).body.rows).toEqual([]);
    await sql()`update cached_appointments set status = 'showed' where installation_id = ${instA} and location_id = ${A1} and status = 'cancelled' and appointment_id <> ${`xtest-a-${A1}-5`}`;
  });

  it("billing notes: add, list by group, mark paid, edit; a foreign account is refused; delete needs the typed name", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    const add = await call(a, "POST", "finance/ledger/add", { locationId: A1, label: "March retainer", amount: 1200, currency: "usd", dueOn: day(5), remindOn: day(1), note: "chase" });
    expect(add.status).toBe(200);
    expect((await call(a, "POST", "finance/ledger/add", { locationId: A1, label: "Setup fee", amount: 300, currency: "USD", dueOn: day(-3) })).status).toBe(200);
    expect((await call(a, "POST", "finance/ledger/add", { locationId: A1, label: "", amount: 1, dueOn: day(1) })).status).toBe(400);
    expect((await call(a, "POST", "finance/ledger/add", { locationId: A1, label: "x", amount: -5, dueOn: day(1) })).status).toBe(400);
    expect((await call(a, "POST", "finance/ledger/add", { locationId: A1, label: "x", amount: 5, dueOn: "2026-02-31" })).status).toBe(400);
    const l = (await call(a, "GET", "finance?part=ledger&size=50")).body;
    expect(l.counts).toMatchObject({ overdue: 1, due_soon: 1, upcoming: 0, paid: 0 });
    expect(l.total).toBe(l.rows.length);
    expect(l.overdue).toEqual([{ currency: "USD", amount: 1200 }]);
    expect((await call(a, "GET", "finance?part=ledger&bucket=overdue")).body.rows.map((r: Json) => r.label)).toEqual(["March retainer"]);
    expect((await call(b, "GET", "finance?part=ledger")).body.rows).toEqual([]);
    expect((await call(b, "POST", "finance/ledger/mark", { id: add.body.id, paid: true })).status).toBe(404);
    expect((await call(b, "POST", "finance/ledger/remove", { id: add.body.id, confirm: "March retainer" })).status).toBe(404);
    expect((await call(a, "POST", "finance/ledger/mark", { id: add.body.id, paid: true })).body.ok).toBe(true);
    expect((await call(a, "GET", "finance?part=ledger")).body.counts.paid).toBe(1);
    expect((await call(a, "PUT", "finance/ledger", { id: add.body.id, label: "March retainer", amount: 1250, currency: "USD", dueOn: day(5) })).status).toBe(200);
    expect((await call(a, "POST", "finance/ledger/remove", { id: add.body.id, confirm: "nope" })).status).toBe(400);
    expect((await call(a, "POST", "finance/ledger/remove", { id: add.body.id, confirm: "march RETAINER" })).body.ok).toBe(true);
    const hl = (await call(a, "GET", "finance?part=headline")).body;
    expect(hl.line).toMatch(/\$300 a month/);
    expect(typeof hl.today).toBe("string");
  });

  it("plan prices and ad spend are SubSync-only entries: validated, labelled, and removed only with the typed name", async () => {
    if (!ready) return;
    const a = session(CO_A);
    await sql()`update client_billing set price_amount = null, price_currency = null where installation_id = ${instA} and location_id = ${A1}`;
    const { financeCache } = await import("@/lib/analytics/finance-queries");
    financeCache.clear("");
    expect((await call(a, "GET", `finance?part=overview&${RANGE}`)).body.totals.noPrice.accounts).toBe(1);
    expect((await call(a, "PUT", "finance/plan-price", { planKey: "plan-x", planName: "Growth", amount: 3600, currency: "USD", billingInterval: "year" })).status).toBe(200);
    expect((await call(a, "PUT", "finance/plan-price", { planKey: "plan-x", amount: "abc" })).status).toBe(400);
    const ov = (await call(a, "GET", `finance?part=overview&${RANGE}`)).body;
    expect(ov.totals.mrr).toEqual([{ currency: "USD", amount: 300, accounts: 1 }]);
    expect(ov.totals.usesEntered).toBe(true);
    expect((await call(a, "PUT", "finance/spend", { locationId: A1, month: day(0).slice(0, 7), amount: 900, currency: "USD" })).status).toBe(200);
    expect((await call(a, "PUT", "finance/spend", { locationId: A1, month: "2026-13", amount: 900 })).status).toBe(400);
    const rv = (await call(a, "GET", `finance?part=revenue&${RANGE}&size=50`)).body;
    expect(rv.rows.find((r: Json) => r.locationId === A1).spend).not.toBeNull();
    expect(rv.rows.find((r: Json) => r.locationId === A2).spend).toBeNull();
    expect((await call(a, "POST", "finance/spend/remove", { locationId: A1, month: day(0).slice(0, 7), confirm: "nope" })).status).toBe(400);
    expect((await call(a, "POST", "finance/spend/remove", { locationId: A1, month: day(0).slice(0, 7), confirm: "zzFn A1" })).body.ok).toBe(true);
    expect((await call(a, "POST", "finance/plan-price/remove", { planKey: "plan-x", confirm: "nope" })).status).toBe(400);
    expect((await call(a, "POST", "finance/plan-price/remove", { planKey: "plan-x", confirm: "growth" })).body.ok).toBe(true);
  });

  it("churn choices (owner, snooze, status) save for this company's accounts only and move the list", async () => {
    if (!ready) return;
    const a = session(CO_A);
    expect((await call(a, "PUT", "finance/churn", { locationId: A2, owner: CLOSE_A, status: "working", note: "Call Monday" })).status).toBe(200);
    const row = (await call(a, "GET", "finance?part=churn&level=all&size=50")).body.rows.find((r: Json) => r.locationId === A2);
    expect(row.owner.userId).toBe(CLOSE_A);
    expect(row.owner.name).toBe("Casey Closer");
    expect(row.status).toBe("working");
    expect((await call(a, "PUT", "finance/churn", { locationId: A2, status: "bogus" })).status).toBe(400);
    expect((await call(a, "PUT", "finance/churn", { locationId: A2, snoozeDays: 14 })).status).toBe(200);
    expect((await call(a, "GET", "finance?part=churn&level=all&size=50")).body.rows.map((r: Json) => r.locationId)).not.toContain(A2);
    expect((await call(a, "GET", "finance?part=churn&level=all&snoozed=1")).body.rows.map((r: Json) => r.locationId)).toEqual([A2]);
  });
});
