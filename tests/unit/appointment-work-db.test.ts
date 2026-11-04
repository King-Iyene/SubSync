import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { appointmentView } from "@/lib/analytics/appointment-queries";
import { forgetWork } from "@/lib/analytics/appointment-work-queries";
import { signSession } from "@/lib/session";

// The Appointments work lists against the real database (docs/APPOINTMENTS_REVIEW.md), with fixture companies only (removed afterwards; deleting the installation cascades).
//   1. The counts are the numbers Today reads: Needs an outcome = appointmentView.unmarkedTotal, No-shows to recover = appointmentView.recoverTotal (same rows).
//   2. A person's counted open deals are shown once; a deal with no owner is not counted.
//   3. An agency sees its own accounts only, a client's staff only theirs, and asking for another account or the client-account table gives nothing.
//   4. At 150 accounts the server sends five rows per list, one page of a full list and short comparison tables, never everything.
//   5. A chart bar's count equals the rows of the list it opens.
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CO_A = "xtest-appt-a", CO_B = "xtest-appt-b", CO_C = "xtest-appt-c";
const A1 = "xtestApptA1", A2 = "xtestApptA2", B1 = "xtestApptB1";
let instA = "", instB = "", instC = "";
const DAY = 86_400_000;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" });
async function call(token: string, path: string): Promise<{ status: number; body: Json; bytes: number }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, bytes: text.length };
}

const contact = (inst: string, loc: string, id: string, first: string, last: string, extra: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: last, email: `${id}@x.test`, phone: "+15550100000", tags: [] as string[], date_added: new Date(Date.now() - 60 * DAY), dnd: false, ...extra,
});
const appt = (inst: string, loc: string, id: string, contactId: string, status: string, daysFromNow: number, extra: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, appointment_id: id, calendar_id: `${loc}-cal`, calendar_name: "Consult", contact_id: contactId, title: "Appointment", status,
  start_at: new Date(Date.now() + daysFromNow * DAY), end_at: new Date(Date.now() + daysFromNow * DAY + 1_800_000), assigned_to: "ux1", created_remote_at: new Date(Date.now() + (daysFromNow - 3) * DAY), ...extra,
});

describe.skipIf(!HAS_DB)("the appointment work lists", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAppt A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAppt B', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instC }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_C}, 'zzAppt C', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB, instC]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzAppt Client A1"], [instA, A2, "zzAppt Client A2"], [instB, B1, "zzAppt Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access) values (${inst}, ${loc}, ${name}, 'UTC', true, 'ok')`;
    }
    await sql()`insert into team_names (installation_id, user_id, name) values (${instA}, 'ux1', 'Zed Zeta')`;
    await sql()`insert into cached_contacts ${sql()([
      contact(instA, A1, "a1-p1", "Pat", "One"), contact(instA, A1, "a1-p2", "Quin", "Two"), contact(instA, A1, "a1-p3", "Rae", "Three"), contact(instA, A1, "a1-p4", "Sol", "Four"), contact(instA, A1, "a1-p5", "Tia", "Five", { dnd: true }),
      contact(instA, A2, "a2-p1", "Uma", "Six"), contact(instB, B1, "b1-p1", "Vic", "Secret"),
    ] as never)}`;
    await sql()`insert into cached_appointments ${sql()([
      appt(instA, A1, "a1-1", "a1-p1", "noshow", -3),                                   // to recover, with $1,000 of counted deals
      appt(instA, A1, "a1-2", "a1-p2", "confirmed", -2),                                // needs an outcome
      appt(instA, A1, "a1-3", "a1-p3", "confirmed", -40),                               // too old to be a job
      appt(instA, A1, "a1-4", "a1-p4", "noshow", -3), appt(instA, A1, "a1-4b", "a1-p4", "new", 2), // missed, but booked again: not on the recover list; the new one is shaky
      appt(instA, A1, "a1-5", "a1-p5", "noshow", -5),                                   // to recover, asked not to be contacted
      appt(instA, A1, "a1-6", "a1-p1", "showed", -9), appt(instA, A1, "a1-7", "a1-p2", "showed", -8), appt(instA, A1, "a1-8", "a1-p3", "showed", -7),
      appt(instA, A2, "a2-1", "a2-p1", "confirmed", -4),                                // another account of the same company
      appt(instB, B1, "b1-1", "b1-p1", "noshow", -2), appt(instB, B1, "b1-2", "b1-p1", "confirmed", -3), // another company: never visible to A
    ] as never)}`;
    await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, contact_name, name, monetary_value, status, assigned_to)
      values (${instA}, ${A1}, 'o1', 'a1-p1', 'Pat One', 'Deal', 600, 'open', 'ux1'), (${instA}, ${A1}, 'o2', 'a1-p1', 'Pat One', 'Deal 2', 400, 'open', 'ux1'),
             (${instA}, ${A1}, 'o3', 'a1-p2', 'Quin Two', 'No owner', 9000, 'open', null)`;
    // 150 accounts for the scale check, 4 appointments each: one no-show, one unmarked, one showed, and every tenth has an unconfirmed one coming up.
    const locs = Array.from({ length: 150 }, (_, i) => ({ installation_id: instC, location_id: `xtestApptC${String(i).padStart(3, "0")}`, name: `zzAppt Scale ${String(i).padStart(3, "0")}`, timezone: "UTC", client_view: true, appointments_access: "ok" }));
    await sql()`insert into locations ${sql()(locs as never)}`;
    const cs: Record<string, unknown>[] = []; const as: Record<string, unknown>[] = [];
    for (const [i, l] of locs.entries()) {
      for (let k = 0; k < 4; k++) cs.push(contact(instC, l.location_id, `${l.location_id}-c${k}`, "Person", `${i}x${k}`));
      as.push(appt(instC, l.location_id, `${l.location_id}-n`, `${l.location_id}-c0`, "noshow", -3), appt(instC, l.location_id, `${l.location_id}-u`, `${l.location_id}-c1`, "confirmed", -2), appt(instC, l.location_id, `${l.location_id}-s`, `${l.location_id}-c2`, "showed", -4));
      if (i % 10 === 0) as.push(appt(instC, l.location_id, `${l.location_id}-f`, `${l.location_id}-c3`, "new", 2));
    }
    for (let at = 0; at < cs.length; at += 500) await sql()`insert into cached_contacts ${sql()(cs.slice(at, at + 500) as never)}`;
    for (let at = 0; at < as.length; at += 500) await sql()`insert into cached_appointments ${sql()(as.slice(at, at + 500) as never)}`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("the counts are the numbers Today reads, and the headline lists are the same rows", async () => {
    forgetWork(instA);
    const view = await appointmentView(instA, null);
    const w = await call(session(CO_A, "agency", null), "appointments/work");
    expect(w.status).toBe(200);
    expect(w.body.counts.record).toBe(view.unmarkedTotal);
    expect(w.body.counts.recover).toBe(view.recoverTotal);
    expect(w.body.counts).toMatchObject({ record: 2, recover: 2, upcoming: 1 });
    const rec = await call(session(CO_A, "agency", null), "appointments/list?kind=record&size=50");
    expect(new Set((rec.body.rows as Json[]).map((r) => r.id))).toEqual(new Set(view.unmarked.map((r) => r.id)));
    const rcv = await call(session(CO_A, "agency", null), "appointments/list?kind=recover&size=50");
    expect(new Set((rcv.body.rows as Json[]).map((r) => r.id))).toEqual(new Set(view.recover.map((r) => r.id)));
    const all = await call(session(CO_A, "agency", null), "appointments/list?kind=all&size=50");
    expect(all.body.total).toBe(5);
  });

  it("a person's counted deals are shown once, and a deal with no owner is not counted", async () => {
    const rcv = await call(session(CO_A, "agency", null), "appointments/list?kind=recover&size=50");
    const pat = (rcv.body.rows as Json[]).find((r) => r.contactId === "a1-p1");
    expect(pat?.value).toBe(1000);
    const w = await call(session(CO_A, "agency", null), "appointments/work");
    expect(w.body.counts.value).toBe(1000);
    expect(w.body.lists.recover.value).toBe(1000);
    const rec = await call(session(CO_A, "agency", null), "appointments/list?kind=record&size=50");
    expect((rec.body.rows as Json[]).find((r) => r.contactId === "a1-p2")?.value).toBe(0);
    // The do-not-disturb person is on the list, marked, and the row carries what the button needs to decide.
    expect((rcv.body.rows as Json[]).find((r) => r.contactId === "a1-p5")?.dnd).toBe(true);
  });

  it("each caller sees only their own accounts, and cannot ask for another", async () => {
    const agency = session(CO_A, "agency", null);
    const w = await call(agency, "appointments/work");
    expect(JSON.stringify(w.body)).not.toContain("Secret");
    expect(JSON.stringify(w.body)).not.toContain(B1);
    const all = await call(agency, "appointments/list?kind=all&size=50");
    expect(new Set((all.body.rows as Json[]).map((r) => r.locationId))).toEqual(new Set([A1, A2]));
    const client = session(CO_A, "client", A1);
    const own = await call(client, "appointments/list?kind=all&size=50");
    expect((own.body.rows as Json[]).every((r) => r.locationId === A1)).toBe(true);
    expect(own.body.total).toBe(4);
    const forged = await call(client, `appointments/list?kind=all&location=${A2}&size=50`);
    expect(forged.body.total).toBe(0);
    const forgedB = await call(client, `appointments/list?kind=all&location=${B1}&size=50`);
    expect(forgedB.body.total).toBe(0);
    expect((await call(client, "appointments/compare?by=account")).body.total).toBe(0);
    const cw = await call(client, "appointments/work");
    expect(cw.body.several).toBe(false);
    expect(cw.body.accounts.total).toBe(0);
    expect(cw.body.canSeeAccounts).toBe(false);
    expect(JSON.stringify(cw.body)).not.toContain("Client A2");
    // Another company's contact never answers by id either.
    expect((await call(agency, `appointments/${B1}/b1-1`)).status).toBe(404);
  });

  it("a chart bar's count equals the rows of the list it opens, for every bar", async () => {
    const agency = session(CO_A, "agency", null);
    const w = await call(agency, "appointments/work");
    for (const [bucket, n] of Object.entries(w.body.outcomes.counts as Record<string, number>)) {
      const list = await call(agency, `appointments/list?kind=window&bucket=${bucket}&size=50`);
      expect(list.body.total, bucket).toBe(n);
      expect((list.body.rows as Json[]).length, bucket).toBe(Math.min(n, 50));
    }
    expect(w.body.outcomes.counts).toMatchObject({ showed: 3, noshow: 3, unmarked: 2 });
    // The rate card and its drill list use the same window: a short window gives fewer, from the same rows.
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 4 * DAY).toISOString().slice(0, 10);
    const short = await call(agency, `appointments/work?from=${from}&to=${today}`);
    const shortList = await call(agency, `appointments/list?kind=window&bucket=noshow&from=${from}&to=${today}&size=50`);
    expect(shortList.body.total).toBe(short.body.outcomes.counts.noshow);
    expect(short.body.window.defaulted).toBe(false);
  });

  it("at 150 accounts: five rows per list, one page of a full list, short comparison tables, search and sort on the server", async () => {
    forgetWork(instC);
    const token = session(CO_C, "agency", null);
    const w = await call(token, "appointments/work");
    expect(w.body.counts).toMatchObject({ record: 150, recover: 150, upcoming: 15 });
    for (const k of ["recover", "record", "upcoming"]) expect((w.body.lists[k].rows as Json[]).length).toBeLessThanOrEqual(5);
    expect(w.body.accounts.total).toBe(150);
    expect((w.body.accounts.rows as Json[]).length).toBe(5);
    expect(w.bytes, "the page's first read stays small however many accounts there are").toBeLessThan(40_000);
    const page = await call(token, "appointments/list?kind=record&size=25&page=2");
    expect(page.body.total).toBe(150);
    expect((page.body.rows as Json[]).length).toBe(25);
    expect(page.body.from).toBe(51);
    expect(page.body.options.accounts.length).toBeLessThanOrEqual(100);
    const q = await call(token, "appointments/list?kind=all&q=Scale%20042&size=25");
    expect(q.body.total).toBe(2);
    expect((q.body.rows as Json[]).every((r) => r.locationName === "zzAppt Scale 042")).toBe(true);
    const sorted = await call(token, "appointments/list?kind=record&sort=account&size=5");
    expect((sorted.body.rows as Json[]).map((r) => r.locationName)).toEqual(["zzAppt Scale 000", "zzAppt Scale 001", "zzAppt Scale 002", "zzAppt Scale 003", "zzAppt Scale 004"]);
    const cmp = await call(token, "appointments/compare?by=account&q=Scale%2001&size=10");
    expect(cmp.body.total).toBe(10);
    expect(cmp.body.rows[0].todo).toBeGreaterThanOrEqual(cmp.body.rows[9].todo);
    const filtered = await call(token, "appointments/list?kind=all&location=xtestApptC007&size=25");
    expect(filtered.body.total).toBe(2);
  });
});
