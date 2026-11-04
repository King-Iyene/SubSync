import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The duplicate review against the real database (stage DUP), with fixture companies only (removed afterwards; deleting the installation cascades).
//   1. Each caller sees only the groups of the accounts they may see: an agency its own accounts, a client's staff their one account, never another company's.
//   2. Not a duplicate, Not now and Undo are remembered on the server and checked against the caller's accounts: another account's contacts answer "not found".
//   3. The one-click merge is SWITCHED OFF: it records one "WOULD WRITE" line with ids and field names only, never a contact detail, and sends nothing
//      (no live switch is set in this test, and the fetch of the platform is never reached). A record with a conversation is refused with the reason.
//   4. At 150 accounts and 450 groups the server sends one page, one group in detail and a short client list, never the whole list.
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CO_A = "xtest-dup-a", CO_B = "xtest-dup-b", CO_C = "xtest-dup-c";
const A1 = "xtestDupA1", A2 = "xtestDupA2", B1 = "xtestDupB1";
let instA = "", instB = "", instC = "";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const segments = p.split("/");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), segments);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

const contact = (inst: string, loc: string, id: string, first: string, last: string, email: string | null, phone: string | null, extra: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: last, email, phone, tags: [] as string[], date_added: new Date(Date.now() - 30 * 86_400_000), dnd: false, ...extra, // every row names the same columns: a bulk insert takes them from the first row
});

describe.skipIf(!HAS_DB)("the duplicate review", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzDup A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzDup B', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instC }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_C}, 'zzDup C', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB, instC]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzDup Client A1"], [instA, A2, "zzDup Client A2"], [instB, B1, "zzDup Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    }
    const rows = [
      // A1: two groups. a1x is a plain pair; a1y is a pair where one record has a conversation and one is Do Not Disturb.
      contact(instA, A1, "a1x-1", "Ann", "Ames", "ann@x.test", "+15550101111"), contact(instA, A1, "a1x-2", "Ann", "Ames", "ann@x.test", "+15550101111"),
      contact(instA, A1, "a1y-1", "Bo", "Bell", "bo@x.test", "+15550102222"), contact(instA, A1, "a1y-2", "Bo", "Bell", "bo@x.test", "+15550102222", { dnd: true }),
      // A2: one group.
      contact(instA, A2, "a2x-1", "Cy", "Cole", "cy@x.test", null), contact(instA, A2, "a2x-2", "Cy", "Cole", "CY@x.test", null),
      // B1: one group (another company; must never show up for A).
      contact(instB, B1, "b1x-1", "Di", "Dunn", "di@x.test", "+15550104444"), contact(instB, B1, "b1x-2", "Di", "Dunn", "di@x.test", "+15550104444"),
    ];
    await sql()`insert into cached_contacts ${sql()(rows as never)}`;
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at)
      values (${instA}, ${A1}, 'a1y-conv', 'a1y-1', 'Bo Bell', 'TYPE_SMS', 'inbound', now() - interval '2 days')`;
    // 150 accounts for the scale check: the first 75 have 4 groups (8 contacts), the other 75 have 2 groups (4 contacts): 450 groups in all.
    const locs = Array.from({ length: 150 }, (_, i) => ({ installation_id: instC, location_id: `xtestDupC${String(i).padStart(3, "0")}`, name: `zzDup Scale ${String(i).padStart(3, "0")}`, timezone: "UTC", client_view: true }));
    await sql()`insert into locations ${sql()(locs as never)}`;
    const many: Record<string, unknown>[] = [];
    for (const [i, l] of locs.entries()) {
      const n = i < 75 ? 4 : 2; // groups per account
      for (let g = 0; g < n; g++) {
        for (const k of [1, 2]) many.push(contact(instC, l.location_id, `${l.location_id}-g${g}-${k}`, "Person", `${i}x${g}`, `p${i}-${g}@scale.test`, null));
      }
    }
    for (let at = 0; at < many.length; at += 500) await sql()`insert into cached_contacts ${sql()(many.slice(at, at + 500) as never)}`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("an agency sees its own groups only, and a client's staff only their account's", async () => {
    const agency = session(CO_A, "agency", null);
    const all = await call(agency, "GET", "duplicates?size=50");
    expect(all.status).toBe(200);
    expect(all.body.health.groups).toBe(3);
    expect(all.body.health.extra).toBe(3);
    const rows = all.body.list.rows as Json[];
    expect(new Set(rows.map((r) => r.locationId))).toEqual(new Set([A1, A2]));
    expect(JSON.stringify(all.body)).not.toContain("Di Dunn");
    expect(JSON.stringify(all.body)).not.toContain(B1);
    const client = session(CO_A, "client", A1);
    const mine = await call(client, "GET", "duplicates?size=50");
    expect(mine.status).toBe(200);
    expect(mine.body.health.groups).toBe(2);
    expect((mine.body.list.rows as Json[]).every((r) => r.locationId === A1)).toBe(true);
    expect(mine.body.canExport).toBe(false);
    // Asking for the other account in the address changes nothing: the client still only sees theirs.
    const sneaky = await call(client, "GET", `duplicates?location=${A2}&focus=${A2}:${(rows.find((r) => r.locationId === A2) as Json).key}`);
    expect(sneaky.body.list.total).toBe(0);
    expect(sneaky.body.step).toBeNull();
    // The second company never sees the first.
    const other = await call(session(CO_B, "agency", null), "GET", "duplicates?size=50");
    expect(other.body.health.groups).toBe(1);
    expect(JSON.stringify(other.body)).not.toContain("Ann Ames");
  });

  it("the group on screen carries what the review shows: the best match and why, Do Not Disturb, conversation, and no other account's data", async () => {
    const agency = session(CO_A, "agency", null);
    const list = await call(agency, "GET", "duplicates?size=50");
    const y = (list.body.list.rows as Json[]).find((r) => r.locationId === A1 && r.warn) as Json;
    expect(y, "the Do Not Disturb pair is flagged").toBeTruthy();
    const step = await call(agency, "GET", `duplicates?focus=${A1}:${y.key}`);
    const s = step.body.step as Json;
    expect(s.locationId).toBe(A1);
    expect(s.survivorId).toBe("a1y-1"); // the one with the conversation
    expect(s.why).toMatch(/conversation/);
    expect(((s.people as Json[]).find((p) => p.contactId === "a1y-2") as Json).dnd).toBe(true);
    expect(s.enriched).toBe(true);
  });

  it("not a duplicate, not now and undo are remembered, and another account's contacts are 'not found'", async () => {
    const agency = session(CO_A, "agency", null);
    const client = session(CO_A, "client", A1);
    const x = ((await call(client, "GET", "duplicates?size=50")).body.list.rows as Json[]).find((r) => !r.warn) as Json;
    const ids = ["a1x-1", "a1x-2"];
    // Not a duplicate (a client's staff may decide about their own account).
    expect((await call(client, "POST", "duplicates/review", { locationId: A1, contactIds: ids, decision: "not_duplicate" })).status).toBe(200);
    expect((await call(client, "GET", "duplicates?size=50")).body.health.groups).toBe(1);
    expect((await call(agency, "GET", "duplicates?size=50")).body.health.groups).toBe(2);
    const done = await call(client, "GET", "duplicates?status=decided&size=50");
    expect(done.body.list.rows[0].decision.kind).toBe("not_duplicate");
    expect((await call(client, "POST", "duplicates/undo", { locationId: A1, key: x.key })).status).toBe(200);
    expect((await call(agency, "GET", "duplicates?size=50")).body.health.groups).toBe(3);
    // Not now: set aside, gone from the open list, back with undo.
    expect((await call(client, "POST", "duplicates/snooze", { locationId: A1, contactIds: ids })).status).toBe(200);
    const aside = await call(agency, "GET", "duplicates?size=50");
    expect(aside.body.health.groups).toBe(2);
    expect(aside.body.counts.later).toBe(1);
    expect((await call(client, "POST", "duplicates/unsnooze", { locationId: A1, contactIds: ids })).status).toBe(200);
    expect((await call(agency, "GET", "duplicates?size=50")).body.counts.later).toBe(0);
    // Another account's contacts, in every form: nothing recorded.
    for (const [who, body] of [[client, { locationId: A2, contactIds: ["a2x-1", "a2x-2"] }], [client, { locationId: A1, contactIds: ["a2x-1", "a2x-2"] }], [session(CO_B, "agency", null), { locationId: A1, contactIds: ids }]] as const) {
      for (const path of ["duplicates/snooze", "duplicates/unsnooze", "duplicates/review", "duplicates/merge"]) {
        const r = await call(who, "POST", path, { ...body, decision: "not_duplicate", keepContactId: body.contactIds[0] });
        expect(r.status, `${path} ${JSON.stringify(body)}`).toBe(404);
      }
    }
    const [{ n }] = await sql()`select count(*)::int n from duplicate_reviews where installation_id = any(${[instA, instB]}::uuid[])`;
    expect(n, "nothing was recorded by the forged requests").toBe(0);
    const [{ m }] = await sql()`select count(*)::int m from duplicate_snoozes where installation_id = any(${[instA, instB]}::uuid[])`;
    expect(m).toBe(0);
  });

  it("the one-click merge is switched off: it records a WOULD WRITE line with ids only, and refuses a record with a conversation", async () => {
    expect(process.env.WRITE_GHL_LIVE, "the switch is off in the test environment").not.toBe("true");
    const agency = session(CO_A, "agency", null);
    const ok = await call(agency, "POST", "duplicates/merge", { locationId: A1, contactIds: ["a1x-1", "a1x-2"], keepContactId: "a1x-1" });
    expect(ok.status).toBe(200);
    expect(ok.body.switchedOff).toBe(true);
    expect(ok.body.message).toMatch(/switched off/);
    const lines = await sql()`select action, detail from audit_log where installation_id = ${instA} and action = 'dry_run.would_write'`;
    expect(lines.length).toBe(1);
    expect(lines[0].detail.what).toBe("crm.contact.merge");
    expect(Object.keys(lines[0].detail.ids as Json).sort()).toEqual(["keepContactId", "locationId", "removeContactId"]);
    expect(JSON.stringify(lines[0].detail)).not.toMatch(/ann@|Ames|\+1555/);
    // A conversation (and a Do Not Disturb mark) cannot be carried over by the API: refused, with the reason, whatever the switch says.
    const blocked = await call(agency, "POST", "duplicates/merge", { locationId: A1, contactIds: ["a1y-1", "a1y-2"], keepContactId: "a1y-2" });
    expect(blocked.status).toBe(200);
    expect(blocked.body.blocked).toBe(true);
    expect((blocked.body.blockers as Json[]).map((b) => b.id)).toEqual(expect.arrayContaining(["conversation", "dnd"]));
    expect((await sql()`select count(*)::int n from audit_log where installation_id = ${instA} and action = 'dry_run.would_write'`)[0].n, "a refused merge records no write").toBe(1);
    // The two records were not touched.
    expect((await sql()`select count(*)::int n from cached_contacts where installation_id = ${instA}`)[0].n).toBe(6);
  });

  it("at 150 accounts and 450 groups the server sends one page, one group and a short client list", async () => {
    const agency = session(CO_C, "agency", null);
    const t0 = Date.now();
    const res = await call(agency, "GET", "duplicates?size=100000&an=1000");
    expect(res.status).toBe(200);
    expect(res.body.health.groups).toBe(450);
    expect(res.body.health.extra).toBe(450);
    expect(res.body.list.total).toBe(450);
    expect((res.body.list.rows as Json[]).length).toBeLessThanOrEqual(50);
    expect((res.body.upNext as Json[]).length).toBeLessThanOrEqual(5);
    expect(res.body.accounts.total).toBe(150);
    expect((res.body.accounts.rows as Json[]).length).toBeLessThanOrEqual(10);
    expect(res.body.step.people.length).toBe(2);
    expect(JSON.stringify(res.body).length, "one page, not the list").toBeLessThan(60_000);
    expect(Date.now() - t0).toBeLessThan(60_000);
    // Paging reaches the end; the per-client search narrows on the server.
    const last = await call(agency, "GET", "duplicates?size=50&page=8");
    expect(last.body.list.rows.length).toBe(50);
    expect(last.body.list.to).toBe(450);
    const found = await call(agency, "GET", "duplicates?aq=scale 007&an=10");
    expect(found.body.accounts.total).toBe(1);
  });
});
