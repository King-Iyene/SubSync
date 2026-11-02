import assert from "node:assert/strict";
import { closeDb, sql } from "../src/lib/db";
import { DAILY_LIMIT } from "../src/lib/feedback";

// Stage F8 against a running dev server in demo mode and the real database (WRITTEN, NOT RUN in the stage: the lead runs it with the integration chain).
// Proves over HTTP: feedback, problem reports and suggestions are stored for the signed-in person's own company and refused when empty; every kind of session may send
// them and none may change settings; the alert to King is a WOULD SEND audit line with ids only; the settings history is the audit log read back (names, never
// values) and is refused to a client; leaving an account out of every number works from Settings and is put back; Getting started is the guide for the role; the
// admin address opens only with the server secret and shows companies as short ids. Everything created is removed.
// Usage: BASE_URL=http://localhost:3100 CRON_SECRET=... node --env-file=.env.local --import tsx scripts/check-f8.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const CRON = process.env.CRON_SECRET;
const SECRET_WORDS = "f8 check words about client Zed Quillfeather";

async function main() {
  const signIn = async (as?: string) => ((await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true, ...(as ? { as } : {}) }) })).json()) as { session: string }).session;
  const call = async (path: string, token: string | null, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${BASE}${path}`, { method: init.method ?? "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
  };
  const agency = await signIn();
  const business = await signIn("business");
  const client = await signIn("client");
  const [inst] = await sql()`select id from installations where is_demo`;
  const wipe = async () => {
    await sql()`delete from feedback_items where installation_id = ${inst.id}`;
    await sql()`delete from roadmap_suggestions where installation_id = ${inst.id}`;
    await sql()`delete from roadmap_votes where installation_id = ${inst.id}`;
    await sql()`delete from audit_log where installation_id = ${inst.id} and (action like 'notify.king.%' or action in ('feedback.received', 'problem.reported', 'roadmap.suggested', 'settings.changed', 'accounts.flags_changed'))`;
  };
  await wipe();
  try {
    // 1. Sending needs a session, words, and a known shape.
    assert.equal((await call("/api/app/feedback", null, { method: "POST", body: { message: "x" } })).status, 401);
    assert.equal((await call("/api/app/feedback", agency, { method: "POST", body: { message: "   " } })).status, 400);
    assert.equal((await call("/api/app/problem", agency, { method: "POST", body: {} })).status, 400);
    assert.equal((await call("/api/app/roadmap/suggest", agency, { method: "POST", body: { title: "" } })).status, 400);
    assert.equal((await call("/api/app/feedback", agency, { method: "GET" })).status, 404, "nothing is read back from the feedback address");

    // 2. Every kind of session may send; each is stored against its own kind and, for a limited session, its own account.
    const f = await call("/api/app/feedback", agency, { method: "POST", body: { message: SECRET_WORDS, page: "speed", severity: "annoying" } });
    assert.equal(f.status, 200);
    assert.match(f.body.reference, /^R-[A-Z0-9]{6}$/);
    assert.equal((await call("/api/app/problem", business, { method: "POST", body: { message: "The list never loaded", page: "inbox", errorId: "E-F8CHK1" } })).status, 200);
    assert.equal((await call("/api/app/feedback", client, { method: "POST", body: { message: "From a client's staff member", page: "myday" } })).status, 200);
    const rows = await sql()`select kind, role, location_id, page, error_id from feedback_items where installation_id = ${inst.id} order by created_at`;
    assert.deepEqual(rows.map((r) => [r.kind, r.role]), [["feedback", "agency"], ["problem", "business"], ["feedback", "client"]]);
    assert.equal(rows[0].location_id, null);
    assert.ok(rows[1].location_id && rows[2].location_id, "a limited session is stored with its own account, read from the session");
    assert.equal(rows[1].error_id, "E-F8CHK1");

    // 3. The alert to King is a dry-run line with ids only; what was typed is nowhere in the audit log.
    const lines = await sql()`select detail from audit_log where installation_id = ${inst.id} and action = 'notify.king.would_send'`;
    assert.equal(lines.length, 3);
    for (const l of lines) assert.match(JSON.stringify(l.detail), /WOULD SEND to King/);
    const audit = JSON.stringify(await sql()`select detail from audit_log where installation_id = ${inst.id}`);
    assert.ok(!audit.includes("Quillfeather") && !audit.includes("never loaded"), "no audit line holds what a person typed");

    // 4. The daily limit is per person.
    for (let i = 0; i < DAILY_LIMIT; i++) await call("/api/app/feedback", client, { method: "POST", body: { message: `note ${i}` } });
    assert.equal((await call("/api/app/feedback", client, { method: "POST", body: { message: "one too many" } })).status, 429);
    assert.equal((await call("/api/app/feedback", agency, { method: "POST", body: { message: "another person is fine" } })).status, 200);

    // 5. Suggestions: stored for the company, read back only by the person who made them.
    assert.equal((await call("/api/app/roadmap/suggest", agency, { method: "POST", body: { title: "A weekly team summary", details: "per person", importance: "important" } })).status, 200);
    assert.deepEqual(((await call("/api/app/roadmap", agency)).body.mine as Array<{ title: string }>).map((m) => m.title), ["A weekly team summary"]);
    assert.deepEqual((await call("/api/app/roadmap", client)).body.mine, [], "a client's staff do not read the agency's suggestions");
    const road = (await call("/api/app/roadmap", agency)).body;
    assert.ok(road.items.every((i: { label: string; status: string }) => ["Planned", "In progress", "Considering", "Shipped"].includes(i.label)));
    const shipped = road.items.find((i: { status: string }) => i.status === "shipped");
    assert.equal((await call("/api/app/roadmap", agency, { method: "POST", body: { key: shipped.key } })).status, 400, "nothing shipped can be voted for");
    const planned = road.items.find((i: { status: string }) => i.status === "planned");
    assert.equal((await call("/api/app/roadmap", agency, { method: "POST", body: { key: planned.key } })).body.voted, true);
    assert.equal((await call("/api/app/roadmap", agency, { method: "POST", body: { key: planned.key } })).body.voted, false, "the same call takes the vote back");

    // 6. Clients can send but never change anything or read the history.
    assert.equal((await call("/api/app/settings", client, { method: "PUT", body: { brandName: "x" } })).status, 403);
    assert.equal((await call("/api/app/settings/history", client)).status, 403);
    assert.equal((await call("/api/app/accounts/anything/flags", client, { method: "PUT", body: { ignored: true } })).status, 403);

    // 7. The settings history is the audit log read back: names, never values, newest first.
    const before = (await call("/api/app/settings", agency)).body.settings.brandName as string | null;
    assert.equal((await call("/api/app/settings", agency, { method: "PUT", body: { brandName: "F8 Check Brand" } })).status, 200);
    const hist = await call("/api/app/settings/history", agency);
    assert.equal(hist.status, 200);
    assert.equal(hist.body.rows[0].action, "settings.changed");
    assert.deepEqual(hist.body.rows[0].keys, ["brandName"]);
    assert.ok(!JSON.stringify(hist.body).includes("F8 Check Brand"), "a value is never in the history");
    await call("/api/app/settings", agency, { method: "PUT", body: { brandName: before } });

    // 8. Leaving an account out of every number, from Settings, and putting it back.
    const settings = (await call("/api/app/settings", agency)).body;
    assert.ok(settings.testAccounts.length > 0 && settings.testAccounts.every((a: { locationId: string; name: string; ignored: boolean; looksTest: boolean }) => a.locationId && a.name && typeof a.ignored === "boolean" && typeof a.looksTest === "boolean"));
    assert.equal((await call("/api/app/settings", business)).body.testAccounts.length, 0, "a business has no accounts to choose between");
    const target = settings.testAccounts.find((a: { ignored: boolean }) => !a.ignored);
    // The filter bar's list counts only accounts that are not left out.
    const counted = async () => (await call("/api/app/segments", agency)).body.total as number;
    const start = await counted();
    try {
      assert.equal((await call(`/api/app/accounts/${target.locationId}/flags`, agency, { method: "PUT", body: { ignored: true } })).status, 200);
      assert.equal(await counted(), start - 1, "the account stopped counting");
      assert.equal(((await call("/api/app/settings", agency)).body.testAccounts as Array<{ locationId: string; ignored: boolean }>).find((a) => a.locationId === target.locationId)!.ignored, true);
      const logged = await sql()`select detail from audit_log where installation_id = ${inst.id} and action = 'accounts.flags_changed' order by at desc limit 1`;
      assert.deepEqual((logged[0].detail as { keys: string[] }).keys, ["ignored"]);
    } finally {
      await call(`/api/app/accounts/${target.locationId}/flags`, agency, { method: "PUT", body: { ignored: false } });
    }
    assert.equal(await counted(), start);

    // 9. Getting started is the guide for the role.
    assert.equal((await call("/api/app/start", agency)).body.role, "agency_owner");
    assert.equal((await call("/api/app/start", business)).body.role, "account_admin");
    const staff = (await call("/api/app/start", client)).body;
    assert.equal(staff.role, "account_user");
    assert.ok(!staff.steps.some((s: { id: string }) => ["brief", "email", "targets", "tests", "share", "clients"].includes(s.id)));
    assert.ok((await call("/api/app/settings", agency)).body.permissions.length >= 7, "the permission groups come with Settings");

    // 10. King's admin address opens only with the server secret and names no company.
    assert.equal((await call("/api/admin/feedback", null)).status, 401);
    assert.equal((await call("/api/admin/feedback", agency)).status, 401, "a signed-in session is not the secret");
    assert.equal((await call("/api/admin/feedback", "not-the-secret")).status, 401);
    if (CRON) {
      const admin = await call("/api/admin/feedback", CRON);
      assert.equal(admin.status, 200);
      assert.ok(admin.body.feedback.some((x: { message: string }) => x.message === SECRET_WORDS));
      assert.ok(admin.body.feedback.every((x: { company: string }) => /^[0-9a-f]{8}$/.test(x.company)));
      assert.ok(!JSON.stringify(admin.body).includes("Demo Company"), "no company name");
    } else console.log("admin address: refusals checked; CRON_SECRET not set for this run, so the authorised answer was not checked");
  } finally {
    await wipe();
    await closeDb();
  }
  console.log("F8: feedback, problem reports and suggestions stored per company and sent only as a dry-run line, daily limit, settings history without values, accounts left out of every number, a guide per role, secret-only admin address: ok");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
