import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Clean-up v2 (stage DQ) against the real database, with tiny xtest- fixtures only (removed afterwards; deleting the installation cascades).
//   1. Every list, count and drawer shows only the caller's own accounts; a forged account id answers "not found" and is never echoed; a forged contact id in a decision or a delete is not found.
//   2. Duplicate groups are found from blocking keys with their tier; protected people are never in a delete; a decision removes the group and is remembered.
//   3. A number on the lead-intake screen opens exactly its rows (count equals rows) and the daily record is idempotent.
// Skipped when no database is configured, or the migration 20261220090000_dq_moat.sql has not been applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";

const CO_A = "xtest-dq-a", CO_B = "xtest-dq-b";
const A1 = "xtestDqA1", B1 = "xtestDqB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string) => signSession({ companyId: company, userId: "u-agency", role: "admin", userName: "Test agency", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" } as never);
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), p.split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const contact = (inst: string, loc: string, id: string, first: string, last: string, email: string | null, phone: string | null, o: { dnd?: boolean; source?: string | null; added?: string } = {}) => ({
  installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: last, email, phone, dnd: o.dnd ?? false, source: o.source === undefined ? "Website form" : o.source, date_added: o.added ?? day(2),
});

describe.skipIf(!HAS_DB)("Clean-up v2: duplicates and lead intake", () => {
  beforeAll(async () => {
    const [t] = await sql()`select to_regclass('public.dq_groups') is not null as ok`;
    ready = t.ok === true;
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzDq A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzDq B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzDq A1"], [instB, B1, "zzDq B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    const rows = [
      // account A: a certain pair (same phone), a certain pair with someone on Do Not Disturb, a likely pair (same name, same last 7 digits), a possible pair (reversed name), a junk lead, a clean lead
      contact(instA, A1, "a-p1", "Ann", "Ames", "ann@x.co", "+15550101111", { added: day(5) }), contact(instA, A1, "a-p2", "Ann", "Ames", null, "(555) 010-1111", { added: day(1) }),
      contact(instA, A1, "a-d1", "Dee", "Dunn", "dee@x.co", "+15550102222", { dnd: true, added: day(6) }), contact(instA, A1, "a-d2", "Dee", "Dunn", "dee2@x.co", "+15550102222", { added: day(1) }),
      contact(instA, A1, "a-l1", "Cy", "Diaz", null, "+15550103333", { added: day(4) }), contact(instA, A1, "a-l2", "Cy", "Diaz", "cy@x.co", "+16660103333", { added: day(1) }),
      contact(instA, A1, "a-s1", "Eve", "Fox-Jones", null, null, { added: day(4) }), contact(instA, A1, "a-s2", "Fox-Jones", "Eve", "eve@x.co", null, { added: day(1) }),
      contact(instA, A1, "a-junk", "Test", "Test", "t@x.co", "+15550104444", { added: day(1), source: "Facebook Ads" }), contact(instA, A1, "a-ok", "Bo", "Chan", "bo@x.co", "+15550105555", { added: day(1), source: "Facebook Ads" }),
      // account B: the same phone as account A's pair, which must never be joined to it
      contact(instB, B1, "b-p1", "Ann", "Ames", "ann@x.co", "+15550101111"), contact(instB, B1, "b-p2", "Ann", "Ames", "ann2@x.co", "+15550101111"),
    ];
    for (const r of rows) await sql()`insert into cached_contacts ${sql()(r)}`;
    await sql()`insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated) values (${instA}, ${A1}, 'a-ok', 'k1', 'outbound', 'sms', 'message', now(), false)`;
    const dq = await import("@/lib/analytics/dq-queries");
    await dq.dqScanAccount(instA, A1, true);
    await dq.dqScanAccount(instB, B1, true);
  });
  afterAll(async () => { if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("finds each group with its tier and never joins two accounts", async () => {
    if (!ready) return;
    const certain = await call(session(CO_A), "GET", "dq/dupes?tier=certain");
    expect(certain.status).toBe(200);
    const sets = (certain.body.rows as Json[]).map((r) => (r.people as Json[]).map((p) => p.contactId).sort().join("+"));
    expect(sets).toContain("a-p1+a-p2");
    expect(sets).toContain("a-d1+a-d2");
    expect(JSON.stringify(certain.body)).not.toMatch(/b-p1|b-p2/);
    const likely = (await call(session(CO_A), "GET", "dq/dupes?tier=likely")).body.rows as Json[];
    expect(likely.map((r) => (r.people as Json[]).map((p) => p.contactId).sort().join("+"))).toContain("a-l1+a-l2");
    const possible = (await call(session(CO_A), "GET", "dq/dupes?tier=possible")).body.rows as Json[];
    expect(possible.map((r) => (r.people as Json[]).map((p) => p.contactId).sort().join("+"))).toContain("a-s1+a-s2");
    expect(certain.body.counts.certain.groups).toBeGreaterThanOrEqual(2);
  });

  it("a forged account, contact or cursor is refused and never echoed", async () => {
    if (!ready) return;
    for (const path of [`dq/dupes?tier=certain&account=${B1}`, `dq/overview?account=${B1}`, `dq/intake?account=${B1}`, `dq/leads?flag=all&account=${B1}`, `dq/dupe?account=${B1}&ids=b-p1,b-p2`]) {
      const r = await call(session(CO_A), "GET", path);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain(B1);
    }
    expect((await call(session(CO_A), "GET", "dq/dupes?tier=certain&after=zzz")).status).toBe(400);
    expect((await call(session(CO_A), "GET", "dq/dupes?tier=drop")).status).toBe(400);
    expect((await call(session(CO_A), "GET", "dq/leads?flag=nope")).status).toBe(400);
    // a source is a bound value, never SQL text: an injection attempt is just a source nobody has
    const inj = await call(session(CO_A), "GET", "dq/leads?flag=all&src=%27%3B%20drop%20table%20cached_contacts%3B--");
    expect(inj.status).toBe(200);
    expect(inj.body.rows).toEqual([]);
    expect((await call(session(CO_A), "GET", `dq/leads?flag=all&src=${"x".repeat(200)}`)).status).toBe(400);
    // a contact of account B, named with account A's id, is "not found" in a decision and gives an empty plan in a delete
    const decide = await call(session(CO_A), "POST", "dq/decide", { locationId: A1, contactIds: ["b-p1", "b-p2"], decision: "not_duplicate" });
    expect(decide.status).toBe(404);
    const del = await call(session(CO_A), "POST", "dq/delete", { step: "preview", locationId: A1, contactIds: ["b-p1", "b-p2"], keepContactId: "b-p1" });
    expect(del.body.requested ?? 0).toBe(0);
    const cross = await call(session(CO_A), "POST", "dq/decide", { locationId: B1, contactIds: ["b-p1", "b-p2"], decision: "not_duplicate" });
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain(B1);
    const b = await sql()`select count(*)::int n from duplicate_reviews where installation_id = ${instB}`;
    expect(b[0].n).toBe(0);
  });

  it("delete extras leaves protected people out, needs the typed words, and is a dry run while switched off", async () => {
    if (!ready) return;
    const pv = await call(session(CO_A), "POST", "dq/delete", { step: "preview", locationId: A1, contactIds: ["a-d1", "a-d2"], keepContactId: "a-d2" });
    expect(pv.status).toBe(200);
    expect(pv.body.requested).toBe(0); // a-d1 is on Do Not Disturb: protected
    expect(pv.body.protectedSkipped).toBe(1);
    const pv2 = await call(session(CO_A), "POST", "dq/delete", { step: "preview", locationId: A1, contactIds: ["a-p1", "a-p2"], keepContactId: "a-p1" });
    expect(pv2.body.requested).toBe(1);
    expect(pv2.body.phrase).toBe("delete Ann Ames");
    expect(pv2.body.mode).toBe("dry_run");
    const wrong = await call(session(CO_A), "POST", "dq/delete", { step: "do", locationId: A1, contactIds: ["a-p1", "a-p2"], keepContactId: "a-p1", typed: "delete" });
    expect(wrong.status).toBe(400);
    const dry = await call(session(CO_A), "POST", "dq/delete", { step: "do", locationId: A1, contactIds: ["a-p1", "a-p2"], keepContactId: "a-p1", typed: "delete Ann Ames" });
    expect(dry.status).toBe(200);
    expect(dry.body.done).toBe(0);
    const still = await sql()`select count(*)::int n from cached_contacts where installation_id = ${instA} and contact_id in ('a-p1', 'a-p2')`;
    expect(still[0].n).toBe(2);
  });

  it("'Not the same' removes the group, is remembered through the next scan, and is logged", async () => {
    if (!ready) return;
    const r = await call(session(CO_A), "POST", "dq/decide", { locationId: A1, contactIds: ["a-l1", "a-l2"], decision: "not_duplicate" });
    expect(r.status).toBe(200);
    const dq = await import("@/lib/analytics/dq-queries");
    await dq.scanGroups(instA, A1);
    const likely = (await call(session(CO_A), "GET", "dq/dupes?tier=likely")).body.rows as Json[];
    expect(likely.map((x) => (x.people as Json[]).map((p) => p.contactId).sort().join("+"))).not.toContain("a-l1+a-l2");
    const ev = await call(session(CO_A), "GET", "dq/events");
    expect(ev.status).toBe(200);
    expect((ev.body.rows as Json[]).some((e) => e.kind === "dup_decided")).toBe(true);
  });

  it("a number opens exactly its rows, and the daily record is idempotent", async () => {
    if (!ready) return;
    const dq = await import("@/lib/analytics/dq-queries");
    const before = await sql()`select count(*)::int n, coalesce(sum(leads), 0)::int leads from dq_source_daily where installation_id = ${instA}`;
    await dq.recomputeSourceDaily(instA, A1, 35);
    const after = await sql()`select count(*)::int n, coalesce(sum(leads), 0)::int leads from dq_source_daily where installation_id = ${instA}`;
    expect(after[0]).toEqual(before[0]);
    const intake = await call(session(CO_A), "GET", "dq/intake?range=30");
    expect(intake.status).toBe(200);
    expect(JSON.stringify(intake.body)).not.toContain(B1);
    const total = (intake.body.sources as Json[]).reduce((s, r) => s + r.leads, 0);
    expect(total).toBe(10); // account A's ten contacts, none of account B's
    for (const flag of ["all", "ok", "dup", "junk", "clean", "answered", "booked"]) {
      for (const src of [null, "website form", "facebook ads"]) {
        const q = `dq/leads?flag=${flag}&range=30${src ? `&src=${encodeURIComponent(src)}` : ""}`;
        const r = await call(session(CO_A), "GET", q);
        expect(r.status, q).toBe(200);
        const rolled = (intake.body.sources as Json[]).filter((s) => !src || s.key === src);
        const want = rolled.reduce((s, x) => s + ({ all: x.leads, ok: x.leads - x.dups - x.junk, dup: x.dups, junk: x.junk, clean: x.quality, answered: x.answered, booked: x.booked } as Json)[flag], 0);
        expect(r.body.total.n, q).toBe(want);
        expect((r.body.rows as Json[]).length, q).toBe(want);
      }
    }
    const fb = (intake.body.sources as Json[]).find((s) => s.key === "facebook ads")!;
    expect(fb.leads).toBe(2); expect(fb.junk).toBe(1); expect(fb.answered).toBe(1);
  });

  it("the quality score and its four parts are written once a day", async () => {
    if (!ready) return;
    const rows = await sql()`select score, parts from dq_scores where installation_id = ${instA}`;
    expect(rows.length).toBe(1);
    const dq = await import("@/lib/analytics/dq-queries");
    await dq.dqScanAccount(instA, A1, false);
    expect((await sql()`select count(*)::int n from dq_scores where installation_id = ${instA}`)[0].n).toBe(1);
    const o = await call(session(CO_A), "GET", "dq/overview");
    expect(o.status).toBe(200);
    expect(JSON.stringify(o.body)).not.toContain(B1);
  });
});
