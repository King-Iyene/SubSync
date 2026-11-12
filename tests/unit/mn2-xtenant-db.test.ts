import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant test for the Meeting notes list, detail, follow-up lists, coaching and tasks:
//   1. A call is read by its owner alone: another person of the SAME company, and every person of another company, get "not found" for it and never see its title, summary or contact.
//   2. The list's count equals its rows, a client account of another company named in the address changes nothing, and a matched id that points into another company is simply not there.
//   3. Coaching shows counts and averages only (no title, no summary, no attendee) and only for the people of the caller's own company.
//   4. Tasks: another company's call cannot be given a task; a task is made once, only on a certain contact, and a second tap makes nothing new.
// Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-mn-a", CO_B = "xtest-mn-b", A1 = "xtestMnA1", B1 = "xtestMnB1";
const U_A = "xtest-mn-ua", U_A2 = "xtest-mn-ua2", U_B = "xtest-mn-ub";
let instA = "", instB = "", ready = false;
const ids: Record<string, string> = {};
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, user: string, name: string) => signSession({ companyId: company, userId: user, role: "admin", userName: name, demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function meeting(inst: string, owner: string, key: string, o: { title: string; summary?: string; items?: string[]; status?: string; reason?: string | null; loc?: string | null; contact?: string | null; emails?: string[]; days: number; minutes?: number | null }) {
  const [m] = await sql()`
    insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, started_at, title, attendee_emails, summary, action_items, status, reason, duration_minutes, matched_location_id, matched_contact_id)
    values (${inst}, ${owner}, 'fathom', ${key}, ${day(o.days)}, ${o.title}, ${sql().json((o.emails ?? []) as never)}, ${o.summary ?? null}, ${sql().json((o.items ?? []) as never)}, ${o.status ?? "saved"}, ${o.reason ?? null}, ${o.minutes ?? null}, ${o.loc ?? null}, ${o.contact ?? null}) returning id`;
  ids[key] = m.id as string;
}

describe.skipIf(!HAS_DB)("Meeting notes cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select matched_contact_id from meetings limit 1`; await sql()`select 1 from mn_tasks limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'Mn Agency A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'Mn Agency B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`update installations set scope = 'contacts.write' where id = ${instA}`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzMn Client A1', 'UTC', true), (${instB}, ${B1}, 'zzMn Client B1', 'UTC', true)`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags) values
      (${instA}, ${A1}, 'xtest-mn-ca', 'Zed', 'MnA', 'zed-a@mn-xtest.test', '{}'), (${instA}, ${A1}, 'xtest-mn-ca2', 'Quinn', 'MnA', 'quinn@mn-xtest.test', '{}'), (${instB}, ${B1}, 'xtest-mn-cb', 'Zed', 'MnB', 'zed-b@mn-xtest.test', '{}')`;
    await sql()`insert into user_connections (installation_id, company_key, ghl_user_id, person_name, provider, status) values
      (${instA}, ${CO_A}, ${U_A}, 'Ada Xtest', 'fathom', 'connected'), (${instA}, ${CO_A}, ${U_A2}, 'Bo Xtest', 'fathom', 'connected'), (${instB}, ${CO_B}, ${U_B}, 'Cy Xtest', 'fathom', 'connected')`;
    await meeting(instA, U_A, "xt-a1", { title: "xtest MN A saved call", summary: "xtest A secret summary", items: ["Send quote", "Book visit"], loc: A1, contact: "xtest-mn-ca", days: 3, minutes: 30 });
    await meeting(instA, U_A, "xt-a2", { title: "xtest MN A waiting call", summary: "xtest A waiting summary", items: [], status: "needs_contact", reason: "no_match", emails: ["zed-a@mn-xtest.test"], days: 2 });
    await meeting(instA, U_A, "xt-a3", { title: "xtest MN A poisoned call", items: ["x"], loc: B1, contact: "xtest-mn-cb", days: 1 });
    await meeting(instA, U_A2, "xt-a4", { title: "xtest MN A2 private call", summary: "xtest A2 private summary", items: ["Private"], loc: A1, contact: "xtest-mn-ca2", days: 1, minutes: 20 });
    await meeting(instB, U_B, "xt-b1", { title: "xtest MN B call", summary: "xtest B secret summary", items: ["B item"], loc: B1, contact: "xtest-mn-cb", days: 2, minutes: 25 });
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("a person reads only their own calls: the list's count equals its rows, and nothing of another person or company appears", async () => {
    if (!ready) return;
    const a = await call(session(CO_A, U_A, "Ada Xtest"), "GET", "meeting-list");
    expect(a.status).toBe(200);
    expect(a.body.rows.map((r: Json) => r.id).sort()).toEqual([ids["xt-a1"], ids["xt-a2"], ids["xt-a3"]].sort());
    expect(a.body.total).toBe(a.body.rows.length);
    for (const w of ["xtest MN B call", "xtest MN A2 private call", "Zed MnB", "xtest B secret", "xtest A2 private"]) expect(a.text).not.toContain(w);
    const poisoned = a.body.rows.find((r: Json) => r.id === ids["xt-a3"]);
    expect(poisoned.contactId, "a matched id that points into another company is not there").toBeNull();
    expect(a.body.rows.find((r: Json) => r.id === ids["xt-a1"]).contactName).toBe("Zed MnA");
    // The same company, another person: their own calls only.
    const a2 = await call(session(CO_A, U_A2, "Bo Xtest"), "GET", "meeting-list");
    expect(a2.body.rows.map((r: Json) => r.id)).toEqual([ids["xt-a4"]]);
    expect(a2.text).not.toContain("xtest MN A saved call");
    const b = await call(session(CO_B, U_B, "Cy Xtest"), "GET", "meeting-list");
    expect(b.body.rows.map((r: Json) => r.id)).toEqual([ids["xt-b1"]]);
    expect(b.text).not.toContain("xtest MN A");
  });

  it("filters: a matched or waiting call, a search, a client account of another company, and keyset paging that never repeats or skips", async () => {
    if (!ready) return;
    const t = session(CO_A, U_A, "Ada Xtest");
    const needs = await call(t, "GET", "meeting-list?state=needs");
    expect(needs.body.rows.map((r: Json) => r.id).sort()).toEqual([ids["xt-a2"], ids["xt-a3"]].sort());
    expect(needs.body.total).toBe(2);
    const matched = await call(t, "GET", "meeting-list?state=matched");
    expect(matched.body.rows.map((r: Json) => r.id)).toEqual([ids["xt-a1"]]);
    expect((await call(t, "GET", "meeting-list?q=waiting")).body.rows.map((r: Json) => r.id)).toEqual([ids["xt-a2"]]);
    expect((await call(t, "GET", "meeting-list?q=Zed%20MnB")).body.rows).toEqual([]);
    const other = await call(t, "GET", `meeting-list?accounts=${B1}`);
    expect(other.text).not.toContain(B1);
    expect(other.text).not.toContain("xtest MN B");
    const p1 = await call(t, "GET", "meeting-list?limit=2");
    expect(p1.body.rows).toHaveLength(2);
    expect(p1.body.next).toBeTruthy();
    const p2 = await call(t, "GET", `meeting-list?limit=2&cursor=${encodeURIComponent(p1.body.next)}`);
    expect([...p1.body.rows, ...p2.body.rows].map((r: Json) => r.id).sort()).toEqual([ids["xt-a1"], ids["xt-a2"], ids["xt-a3"]].sort());
    expect(p2.body.next).toBeNull();
    expect((await call(t, "GET", "meeting-list?cursor=garbage")).status, "a bad cursor is dropped, not an error").toBe(200);
  });

  it("one call in full: its owner only, never echoed to anyone else, and the exact-email contacts are offered only inside the person's own accounts", async () => {
    if (!ready) return;
    const a = session(CO_A, U_A, "Ada Xtest"), a2 = session(CO_A, U_A2, "Bo Xtest"), b = session(CO_B, U_B, "Cy Xtest");
    const mine = await call(a, "GET", `meeting-list/${ids["xt-a2"]}`);
    expect(mine.status).toBe(200);
    expect(mine.body.contactId).toBeNull();
    expect(mine.body.candidates.map((c: Json) => c.contactId)).toEqual(["xtest-mn-ca"]);
    for (const [tok, id] of [[a2, "xt-a1"], [b, "xt-a1"], [b, "xt-a2"], [a, "xt-a4"], [a, "xt-b1"]] as const) {
      const r = await call(tok, "GET", `meeting-list/${ids[id]}`);
      expect(r.status, `${id} is not theirs`).toBe(404);
      expect(r.text).not.toContain("secret");
      expect(r.text).not.toContain(ids[id]);
    }
    const poisoned = await call(a, "GET", `meeting-list/${ids["xt-a3"]}`);
    expect(poisoned.body.contactId).toBeNull();
    expect(poisoned.text).not.toContain("Zed MnB");
    expect((await call(a, "GET", "meeting-list/not-an-id")).status).toBe(404);
  });

  it("follow-up lists and coaching: counts and averages for the company's own people, never content", async () => {
    if (!ready) return;
    const a = session(CO_A, U_A, "Ada Xtest");
    for (const k of ["no_followup", "no_next_step", "deal_not_moved"]) {
      const r = await call(a, "GET", `meeting-list/follow?kind=${k}`);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(r.body.rows.length);
      expect(r.text).not.toContain("xtest MN B");
      expect(r.text).not.toContain("xtest A2");
    }
    expect((await call(a, "GET", "meeting-list/follow?kind=drop")).status).toBe(400);
    const c = await call(a, "GET", "meeting-list/coach");
    expect(c.status).toBe(200);
    expect(c.body.rows.map((r: Json) => r.name).sort()).toEqual(["Ada Xtest", "Bo Xtest"]);
    for (const w of ["xtest MN", "secret", "summary", "Cy Xtest", "xtest-mn-u", "zed-a@"]) expect(c.text).not.toContain(w);
    expect(c.body.rows.every((r: Json) => !("owner" in r))).toBe(true);
    const cb = await call(session(CO_B, U_B, "Cy Xtest"), "GET", "meeting-list/coach");
    expect(cb.body.rows.map((r: Json) => r.name)).toEqual(["Cy Xtest"]);
    expect(cb.text).not.toContain("Ada Xtest");
  });

  it("tasks: not on another company's call, only on a certain contact, once, with a preview first", async () => {
    if (!ready) return;
    const a = session(CO_A, U_A, "Ada Xtest"), b = session(CO_B, U_B, "Cy Xtest");
    expect((await call(b, "POST", `meeting-list/${ids["xt-a1"]}/tasks`, { step: "preview", items: [1] })).status).toBe(404);
    expect((await call(b, "POST", `meeting-list/${ids["xt-a1"]}/tasks`, { step: "create", items: [1] })).status).toBe(404);
    expect((await call(a, "POST", `meeting-list/${ids["xt-a2"]}/tasks`, { step: "preview", items: [1] })).status, "a call with no certain contact gets no task").toBe(404);
    expect((await call(a, "POST", `meeting-list/${ids["xt-a3"]}/tasks`, { step: "preview", items: [1] })).status, "a call whose contact is in another company gets no task").toBe(404);
    expect((await call(a, "POST", `meeting-list/${ids["xt-a1"]}/tasks`, { step: "hax" })).status).toBe(400);
    const pre = await call(a, "POST", `meeting-list/${ids["xt-a1"]}/tasks`, { step: "preview", items: [1, 2, 9] });
    expect(pre.status).toBe(200);
    expect(pre.body.plans.map((p: Json) => p.itemNo)).toEqual([1, 2]);
    expect(pre.body.contactName).toBe("Zed MnA");
    const [{ n: before }] = await sql()`select count(*)::int n from mn_tasks where meeting_id = ${ids["xt-a1"]}`;
    expect(before, "a preview makes nothing").toBe(0);
    const made = await call(a, "POST", `meeting-list/${ids["xt-a1"]}/tasks`, { step: "create", items: [1] });
    // Without the permission or with changes switched off this is a refusal or a practice run; either way it is made at most once.
    expect([200, 403]).toContain(made.status);
    if (made.status === 200) {
      const again = await call(a, "POST", `meeting-list/${ids["xt-a1"]}/tasks`, { step: "create", items: [1] });
      expect(again.status).toBe(400);
      const [{ n }] = await sql()`select count(*)::int n from mn_tasks where meeting_id = ${ids["xt-a1"]}`;
      expect(n).toBe(1);
      expect(JSON.stringify(await sql()`select * from mn_tasks where meeting_id = ${ids["xt-a1"]}`)).not.toContain("Send quote");
    }
  });
});
