import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { schemaReady } from "@/lib/analytics/cleanup-config";
import { signSession } from "@/lib/session";

// The Clean-up module against the real database (stage CLEANUP), with fixture companies only (removed afterwards; deleting the installation cascades).
//   1. Data quality, rules, the import check, the history and the switch for changing contacts only ever see the caller's own accounts; a forged account id answers "not found".
//   2. A client's staff are refused every Clean-up route except Duplicates and History (their access rules are unchanged).
//   3. What would a setting find? Strict, Balanced and Loose give different groups for the same contacts, without saving anything.
//   4. A pasted file is compared in memory and stored nowhere; the audit line holds a count only.
//   5. Applying a clean-up never reaches the platform: not at all without the account's opt-in, and as a dry run while the master switch is off.
//   6. At 150 accounts the quality overview sends one page of five and says how many are still to be scored.
// The tests marked "needs the update" run only when the migration 20261105120000_cleanup_v2.sql has been applied to the database in use (rules, the switch, snapshots).
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const CO_A = "xtest-cl2-a", CO_B = "xtest-cl2-b", CO_C = "xtest-cl2-c";
const A1 = "xtestCl2A1", A2 = "xtestCl2A2", B1 = "xtestCl2B1";
let instA = "", instB = "", instC = "";
let ready = { rules: false, defaults: false, snapshots: false };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), p.split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

const contact = (inst: string, loc: string, id: string, first: string | null, last: string | null, email: string | null, phone: string | null) => ({
  installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: last, email, phone, tags: [] as string[], date_added: new Date(Date.now() - 30 * 86_400_000), dnd: false,
});

describe.skipIf(!HAS_DB)("the Clean-up module", () => {
  beforeAll(async () => {
    ready = await schemaReady();
    for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzCl2 A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzCl2 B', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instC }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_C}, 'zzCl2 C', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB, instC]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzCl2 Client A1"], [instA, A2, "zzCl2 Client A2"], [instB, B1, "zzCl2 Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    }
    const rows = [
      // A1: an exact pair, a nickname pair (only Loose), a bad email, a typo domain, a phone not in international format, an empty contact.
      contact(instA, A1, "a1-1", "Ann", "Ames", "ann@x.test", "+15550101111"), contact(instA, A1, "a1-2", "Ann", "Ames", "ann@x.test", "+15550101111"),
      contact(instA, A1, "a1-3", "Bob", "Hart", "bob@hart.test", null), contact(instA, A1, "a1-4", "Robert", "Hart", "robert@hart.test", null),
      contact(instA, A1, "a1-5", "Eve", "Stone", "not-an-email", "+15550105555"), contact(instA, A1, "a1-6", "Frank", "Diaz", "frank@gmial.com", "(555) 010-6666"),
      contact(instA, A1, "a1-7", null, null, null, null),
      contact(instA, A2, "a2-1", "Cy", "Cole", "cy@x.test", null),
      contact(instB, B1, "b1-1", "Di", "Dunn", "di@x.test", "+15550104444"), contact(instB, B1, "b1-2", "Di", "Dunn", "di@x.test", "+15550104444"),
    ];
    await sql()`insert into cached_contacts ${sql()(rows as never)}`;
    // 150 accounts for the scale check, a few contacts each.
    const locs = Array.from({ length: 150 }, (_, i) => ({ installation_id: instC, location_id: `xtestCl2C${String(i).padStart(3, "0")}`, name: `zzCl2 Scale ${String(i).padStart(3, "0")}`, timezone: "UTC", client_view: true }));
    await sql()`insert into locations ${sql()(locs as never)}`;
    const many = locs.flatMap((l, i) => [1, 2, 3].map((k) => contact(instC, l.location_id, `${l.location_id}-${k}`, "Person", `${i}x${k}`, `p${i}-${k}@scale.test`, null)));
    for (let at = 0; at < many.length; at += 500) await sql()`insert into cached_contacts ${sql()(many.slice(at, at + 500) as never)}`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("an agency sees only its own accounts in the quality overview, and a forged account answers not found", async () => {
    const agency = session(CO_A, "agency", null);
    const all = await call(agency, "GET", "cleanup/quality?size=25");
    expect(all.status).toBe(200);
    expect(all.body.accounts.total).toBe(2);
    expect(new Set((all.body.accounts.rows as Json[]).map((r) => r.locationId))).toEqual(new Set([A1, A2]));
    expect(JSON.stringify(all.body)).not.toContain(B1);
    expect((await call(agency, "GET", `cleanup/quality?account=${B1}`)).status).toBe(404);
    expect((await call(agency, "GET", `cleanup/quality/list?account=${B1}&finding=bad_email`)).status).toBe(404);
    expect((await call(agency, "GET", `cleanup/quality/csv?account=${B1}&finding=bad_email`)).status).toBe(404);
    expect((await call(agency, "POST", "cleanup/quality/scan", { locationId: B1 })).status).toBe(404);
    expect((await call(agency, "GET", `cleanup/rules/preview?account=${B1}&preset=loose`)).status).toBe(404);
    expect((await call(agency, "POST", "cleanup/write", { locationId: B1, enabled: true })).status).toBe(404);
    expect((await call(agency, "POST", "cleanup/rules", { scope: B1, match: { preset: "loose" } })).status).toBe(404);
  });

  it("the findings of one account list exactly the contacts they count", async () => {
    const agency = session(CO_A, "agency", null);
    const q = await call(agency, "GET", `cleanup/quality?account=${A1}&cc=1`);
    expect(q.status).toBe(200);
    expect(q.body.contacts).toBe(7);
    expect(q.body.score, "seven contacts are too few to score").toBeNull();
    const counts = Object.fromEntries((q.body.findings as Json[]).map((f) => [f.id, f.count]));
    for (const id of ["bad_email", "email_typo", "phone_format", "empty_record"]) {
      expect(counts[id], id).toBeGreaterThan(0);
      const l = await call(agency, "GET", `cleanup/quality/list?account=${A1}&finding=${id}&cc=1`);
      expect(l.status).toBe(200);
      expect(l.body.rows.length, `rows behind ${id}`).toBe(counts[id]);
      expect(l.body.count).toBe(counts[id]);
    }
    const fix = await call(agency, "GET", `cleanup/quality/list?account=${A1}&finding=phone_format&cc=1`);
    expect(fix.body.rows[0].fix).toEqual([{ field: "phone", before: "(555) 010-6666", after: "+15550106666" }]);
    const csv = await handle(new Request(`http://localhost/api/app/cleanup/quality/csv?account=${A1}&finding=email_typo`, { headers: { Authorization: `Bearer ${agency}` } }), ["cleanup", "quality", "csv"]);
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("frank@gmial.com,frank@gmail.com");
  });

  it("a client's staff are refused the Clean-up routes they never had, and may still use Duplicates and its history", async () => {
    const client = session(CO_A, "client", A1);
    for (const path of ["cleanup/quality", "cleanup/rules", `cleanup/quality/list?account=${A1}&finding=bad_email`, "cleanup/rules/preview?preset=loose"]) expect((await call(client, "GET", path)).status, path).toBe(403);
    for (const [path, body] of [["cleanup/import-check", { locationId: A1, csv: "Email\na@b.co" }], ["cleanup/write", { locationId: A1, enabled: true }], ["cleanup/rules", { scope: A1 }], ["duplicates/merge-workflow", { locationId: A1, contactIds: ["a1-1", "a1-2"], keepContactId: "a1-1", confirm: true }]] as const) {
      expect((await call(client, "POST", path, body)).status, path).toBe(path === "duplicates/merge-workflow" ? 403 : 403);
    }
    const h = await call(client, "GET", "duplicates/history");
    expect(h.status).toBe(200);
    const r = await call(client, "GET", "duplicates/rules");
    expect(r.status).toBe(200);
  });

  it("what would this setting find: strict, balanced and loose differ, and nothing is saved", async () => {
    const agency = session(CO_A, "agency", null);
    const get = async (preset: string) => (await call(agency, "GET", `cleanup/rules/preview?account=${A1}&preset=${preset}`)).body.with.groups as number;
    const [strict, balanced, loose] = [await get("strict"), await get("balanced"), await get("loose")];
    expect(strict).toBe(1);
    expect(balanced).toBe(1);
    expect(loose, "Loose also finds Bob and Robert Hart").toBe(2);
    const view = await call(agency, "GET", `cleanup/rules?account=${A1}`);
    expect(view.body.selected.preset, "looking changed nothing").toBe("balanced");
  });

  it("a pasted file is compared in memory: the matches are found and the file is stored nowhere", async () => {
    const agency = session(CO_A, "agency", null);
    const csv = "Name,Email,Phone\nAnn Ames,ANN@x.test,\nGrace Hopper,grace@new.test,(555) 777-8888\nBob Hart,,";
    const r = await call(agency, "POST", "cleanup/import-check", { locationId: A1, csv });
    expect(r.status).toBe(200);
    expect(r.body.rows.map((x: Json) => x.verdict)).toEqual(["exists", "new", "maybe"]);
    expect(r.body.rows[0].url).toContain(A1);
    expect(JSON.stringify(r.body)).not.toContain(B1);
    const log = await sql()`select detail from audit_log where installation_id = ${instA} and action = 'cleanup.import_check' order by id desc limit 1`;
    expect(log[0].detail).toEqual({ locationId: A1, rows: 3 });
    expect((await call(agency, "POST", "cleanup/import-check", { locationId: B1, csv })).status).toBe(404);
    expect((await call(agency, "POST", "cleanup/import-check", { locationId: A1, csv: "x".repeat(1_600_000) })).status).toBe(413);
  });

  it("history lists a decision with who and when, takes it back, and never shows another company's lines", async () => {
    const agency = session(CO_A, "agency", null);
    const d = await call(agency, "POST", "duplicates/review", { locationId: A1, contactIds: ["a1-1", "a1-2"], decision: "not_duplicate" });
    expect(d.status).toBe(200);
    await sql()`insert into audit_log (installation_id, actor, action, detail) values (${instB}, 'B person', 'duplicates.not_duplicate', ${sql().json({ locationId: B1, key: "00000000-2" } as never)})`;
    const h = await call(agency, "GET", "duplicates/history");
    expect(h.status).toBe(200);
    const mine = (h.body.rows as Json[]).find((r) => r.kind === "decision" && r.locationId === A1)!;
    expect(mine.text).toMatch(/not a duplicate/i);
    expect(mine.who).toBe("Test agency");
    expect(mine.undo).toBeTruthy();
    expect(JSON.stringify(h.body)).not.toContain("B person");
    const u = await call(agency, "POST", "duplicates/undo", { locationId: mine.undo.locationId, key: mine.undo.key });
    expect(u.status).toBe(200);
    const after = await call(agency, "GET", "duplicates/history");
    expect((after.body.rows as Json[]).filter((r) => r.undo).length).toBe(0);
    const client = await call(session(CO_A, "client", A2), "GET", "duplicates/history");
    expect(JSON.stringify(client.body)).not.toContain(A1);
  });

  it("applying a clean-up never reaches the platform: refused without the account's opt-in, a dry run with it while the master switch is off", async () => {
    const agency = session(CO_A, "agency", null);
    const prev = await call(agency, "POST", "cleanup/preview", { locationId: A1, rules: ["email", "phone"], defaultCountryCode: "+1" });
    expect(prev.status).toBe(200);
    expect(prev.body.summary.email).toBe(1);
    expect(prev.body.summary.phone).toBe(1);
    const apply = await call(agency, "POST", `cleanup/${prev.body.runId}/apply`, { confirm: prev.body.total });
    expect(apply.status, "without the opt-in nothing is sent").toBe(403);
    expect(apply.body.notAllowed).toBe(true);
    if (!ready.rules) return;
    expect((await call(agency, "POST", "cleanup/write", { locationId: A1, enabled: true })).status).toBe(200);
    const dry = await call(agency, "POST", `cleanup/${prev.body.runId}/apply`, { confirm: prev.body.total });
    expect(dry.status).toBe(200);
    expect(dry.body.run.status, "switched off: the changes stay waiting").toBe("previewed");
    expect(dry.body.run.applied).toBe(0);
    const lines = await sql()`select action, detail from audit_log where installation_id = ${instA} and action = 'dry_run.would_write' order by id desc limit 1`;
    expect(lines[0].detail.what).toBe("crm.contact.update");
    expect(JSON.stringify(lines[0].detail)).not.toContain("gmail");
    await call(agency, "POST", "cleanup/write", { locationId: A1, enabled: false });
  });

  it("needs the update: rules are saved per account, change the groups, and fall back to the company default", async () => {
    if (!ready.rules) return;
    const agency = session(CO_A, "agency", null);
    expect((await call(agency, "POST", "cleanup/rules", { scope: A1, match: { preset: "loose" } })).status).toBe(200);
    const q = await call(agency, "GET", "duplicates?size=25");
    expect(q.body.counts.open, "Loose finds the nickname pair too").toBe(3);
    expect((await call(agency, "GET", `cleanup/rules?account=${A1}`)).body.selected.preset).toBe("loose");
    expect((await call(agency, "GET", `cleanup/rules?account=${A2}`)).body.selected.preset).toBe("balanced");
    expect((await call(agency, "POST", "cleanup/rules/clear", { locationId: A1 })).status).toBe(200);
    expect((await call(agency, "GET", "duplicates?size=25")).body.counts.open).toBe(2);
    const biz = session(CO_A, "business", A1);
    expect((await call(biz, "POST", "cleanup/rules", { scope: "company", match: { preset: "strict" } })).status, "a business cannot set company-wide rules").toBe(404);
    expect((await call(biz, "POST", "cleanup/rules", { scope: A2, match: { preset: "strict" } })).status, "nor another account's").toBe(404);
  });

  it("needs the update: a snapshot is stored once a day and a trend needs history", async () => {
    if (!ready.snapshots) return;
    const agency = session(CO_A, "agency", null);
    await call(agency, "POST", "cleanup/quality/scan", { locationId: A2 });
    const n = await sql()`select count(*)::int c from cleanup_quality_snapshots where installation_id = ${instA} and location_id = ${A2} and day = current_date`;
    expect(n[0].c).toBe(1);
    await call(agency, "POST", "cleanup/quality/scan", { locationId: A2 });
    expect((await sql()`select count(*)::int c from cleanup_quality_snapshots where installation_id = ${instA} and location_id = ${A2}`)[0].c, "a second scan the same day replaces, never adds").toBe(1);
    const q = await call(agency, "GET", `cleanup/quality?account=${A2}`);
    expect(q.body.trend.state).toBe("not_enough");
    expect((await sql()`select count(*)::int c from cleanup_quality_snapshots where installation_id = ${instB}`)[0].c).toBe(0);
  });

  it("at 150 accounts the overview sends one page of five and says what is still to be scored", async () => {
    const agency = session(CO_C, "agency", null);
    const r = await call(agency, "GET", "cleanup/quality?size=5");
    expect(r.status).toBe(200);
    expect(r.body.accounts.total).toBe(150);
    expect(r.body.accounts.rows.length).toBe(5);
    expect(r.body.accounts.pages).toBe(30);
    expect(JSON.stringify(r.body).length, "never the whole list").toBeLessThan(20_000);
    expect(r.body.totals.contacts).toBeGreaterThan(0);
  });
});
