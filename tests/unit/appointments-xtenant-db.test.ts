import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { ownedLocation } from "@/lib/api/tenant-guard";

// Cross-tenant regression for every Appointments route: company A (agency) and a client of A ask for company B's account, appointment and ids on every part and every
// write. Nothing of B may come back (not its data, not even its account id echoed), and B's rows must not change. Small fixtures, removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
// The shared database may hold switched-off flag rows; this test needs every Appointments part and write live, or it would prove nothing.
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-apsec-a", CO_B = "xtest-apsec-b", A1 = "xtestApSecA1", A2 = "xtestApSecA2", B1 = "xtestApSecB1";
let instA = "", instB = "";
const DAY = 86_400_000;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}
const ap = (inst: string, loc: string, id: string, c: string, status: string, d: number) => ({
  installation_id: inst, location_id: loc, appointment_id: id, calendar_id: `${loc}-cal`, calendar_name: "Consult", contact_id: c, status, start_at: new Date(Date.now() + d * DAY),
  end_at: new Date(Date.now() + d * DAY + 1_800_000), assigned_to: "closer1", booked_by_user: "setter1", created_remote_at: new Date(Date.now() + (d - 2) * DAY),
});
const PARTS = ["overview", "needs-outcome", "noshow-recovery", "booking-share", "flow-tree", "health", "sources", "calendars", "reminders", "receipt", "list"];

describe("ownedLocation guard shape checks (no database needed)", () => {
  it("refuses malformed ids before any query", async () => {
    for (const v of [null, undefined, 5, "", "a", "x y", "a'; drop table x;--"]) expect(await ownedLocation("inst", null, v)).toBeNull();
    expect(await ownedLocation("inst", ["only-this"], "other-one")).toBeNull();
  });
});

describe.skipIf(!HAS_DB)("appointments cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from appointment_history limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzSec A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzSec B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access) values (${instA}, ${A1}, 'zzSec Client A1', 'UTC', true, 'ok'), (${instA}, ${A2}, 'zzSec Client A2', 'UTC', true, 'ok'), (${instB}, ${B1}, 'zzSec Client B', 'UTC', true, 'ok')`;
    await sql()`insert into cached_appointments ${sql()([ap(instA, A1, "secA1", "p1", "noshow", -5), ap(instA, A2, "secA2", "p2", "noshow", -5), ap(instB, B1, "secB1", "q1", "noshow", -4)] as never)}`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("an agency cannot read another company's account on any part", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    for (const part of PARTS) {
      for (const extra of [`&location=${B1}`, `&location=${B1}&calendar=${B1}-cal&user=closer1&setter=setter1&closer=closer1&bucket=noshow&q=q1&source=x`]) {
        const r = await call(t, "GET", `appointments?part=${part}${extra}`);
        expect(r.text, `${part}${extra}`).not.toContain(B1);
        expect(r.text, `${part}${extra}`).not.toContain("zzSec Client B");
        expect(r.text, `${part}${extra}`).not.toContain("secB1");
      }
    }
    for (const q of [`part=detail&location=${B1}&id=secB1`, `part=detail&location=${A1}&id=secB1`, `part=detail&location=${B1}&id=secA1`]) {
      const r = await call(t, "GET", `appointments?${q}`);
      expect(r.status, q).toBe(404);
    }
    { const d = await call(t, "GET", `appointments?part=detail&location=${A1}&id=secA1`); expect(d.status, d.text).toBe(200); }
    for (const q of [`work`, `list?location=${B1}`, `list?kind=all&location=${B1}&calendar=${B1}-cal`, `compare?by=account`, `compare?by=calendar`]) {
      const r = await call(t, "GET", `appointments/${q}`);
      expect(r.text, q).not.toContain(B1);
      expect(r.text, q).not.toContain("secB1");
    }
  });

  it("a client's staff cannot read a sibling account or another company's", async () => {
    if (!ok) return;
    const t = session(CO_A, "client", A1);
    for (const part of PARTS) for (const loc of [A2, B1]) {
      const r = await call(t, "GET", `appointments?part=${part}&location=${loc}`);
      expect(r.text, `${part} ${loc}`).not.toContain(loc);
      expect(r.text).not.toContain("secA2");
    }
    for (const q of [`part=detail&location=${A2}&id=secA2`, `part=detail&location=${B1}&id=secB1`]) expect((await call(t, "GET", `appointments?${q}`)).status, q).toBe(404);
  });

  it("panel, slots and every write refuse a foreign account or appointment and change nothing", async () => {
    if (!ok) return;
    const snap = async () => JSON.stringify(await sql()`select appointment_id, status, start_at, assigned_to from cached_appointments where installation_id = ${instB} order by 1`);
    const before = await snap();
    const countA = (await sql()`select count(*)::int n from cached_appointments where installation_id = ${instA}`)[0].n;
    for (const t of [session(CO_A, "agency", null), session(CO_A, "client", A1)]) {
      for (const q of [`panel?locationId=${B1}&id=secB1`, `panel?locationId=${A1}&id=secB1`, `slots?locationId=${B1}&id=secB1`]) {
        const r = await call(t, "GET", `appointments/act/${q}`);
        expect(r.status, q).toBeGreaterThanOrEqual(400);
        expect(r.text, q).not.toContain("secB1");
        expect(r.text, q).not.toContain("zzSec Client B");
      }
      const loc = B1, id = "secB1", batchId = "00000000-0000-0000-0000-000000000000";
      const when = { startAt: new Date(Date.now() + DAY).toISOString(), endAt: new Date(Date.now() + DAY + 1_800_000).toISOString() };
      const posts: Array<[string, unknown]> = [
        ["act/apply", { locationId: loc, appointmentId: id, action: { kind: "status", status: "showed" }, confirmed: true }],
        ["act/apply", { locationId: A1, appointmentId: id, action: { kind: "status", status: "showed" }, confirmed: true }],
        ["act/apply", { locationId: loc, appointmentId: id, action: { kind: "delete" }, confirmed: true, typed: "x" }],
        ["act/create", { locationId: loc, contactId: "q1", ...when, calendarId: `${loc}-cal`, confirmed: true }],
        ["act/rebook", { locationId: loc, appointmentId: id, ...when, confirmed: true }],
        ["act/bulk", { locationId: loc, appointmentIds: [id], action: { kind: "status", status: "showed" }, confirmed: true }],
        ["act/bulk", { locationId: A1, appointmentIds: [id], action: { kind: "delete" }, confirmed: true, typed: "x" }],
        ["act/undo", { locationId: loc, batchId }],
        ["meetings/match", { locationId: loc, appointmentId: id, meetingId: batchId }],
        ["meetings/followup-note", { locationId: loc, appointmentId: id }],
      ];
      for (const [p, b] of posts) {
        const r = await call(t, "POST", `appointments/${p}`, b);
        expect(r.status, `${p} ${JSON.stringify(b).slice(0, 60)}`).toBeGreaterThanOrEqual(400);
        expect(r.text).not.toContain("zzSec Client B");
      }
    }
    expect(await snap()).toBe(before);
    expect((await sql()`select count(*)::int n from cached_appointments where installation_id = ${instA}`)[0].n).toBe(countA);
    expect((await sql()`select count(*)::int n from appointment_history where installation_id = ${instB}`)[0].n).toBe(0);
  });

  it("the guard accepts only the caller's own account", async () => {
    if (!ok) return;
    expect(await ownedLocation(instA, null, A1)).toBe(A1);
    expect(await ownedLocation(instA, null, B1)).toBeNull();
    expect(await ownedLocation(instA, [A1], A2)).toBeNull();
    expect(await ownedLocation(instB, null, A1)).toBeNull();
  });
});
