import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { sweepWallet } from "@/lib/analytics/wg-queries";
import { runWalletAlerts } from "@/lib/analytics/wg-alerts";
import { runBriefs } from "@/lib/analytics/br-queries";

// Cross-tenant test for the wallet guard and the 7 am brief, with tiny fixtures (prefix xtest-) removed afterwards. Skips until the wg/br migration is applied.
//   1. Each company's watchlist, counts, history and brief hold only its own accounts; the other company's account id, search text and cursor give nothing and are never echoed.
//   2. A limit, a pause and "alert me" on the other company's account answer "not found" and change nothing; a person who is not an owner gets nothing.
//   3. Our own record is append-only and idempotent (the same platform answer twice is one reading), alerts are raised once per episode and only for the company's own watchers.
//   4. A person's brief choices and history are theirs alone: another company's session, and another person in the same company, never see them.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-wg-a", CO_B = "xtest-wg-b", A1 = "xtestWgA1", A2 = "xtestWgA2", B1 = "xtestWgB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = (company: string, user = `u-${company}`) => signSession({ companyId: company, userId: user, role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
const staff = (company: string) => signSession({ companyId: company, userId: `staff-${company}`, role: "user", userName: "S", demo: false, kind: "agency", locationId: null, personRole: "agency_staff" });
const client = (company: string, loc: string) => signSession({ companyId: company, userId: `c-${company}`, role: "admin", userName: "C", demo: false, kind: "client", locationId: loc, personRole: "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}
const DAY = 86_400_000;

describe.skipIf(!HAS_DB)("wallet guard and brief cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from wg_samples limit 1`; await sql()`select 1 from br_history limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzWg A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzWg B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values
      (${instA}, ${A1}, 'zzWg Client A1', 'UTC', true, 'ok', now()), (${instA}, ${A2}, 'zzWg Client A2', 'UTC', true, 'ok', now()), (${instB}, ${B1}, 'zzWg Client B1', 'UTC', true, 'ok', now())`;
    // A1 is empty, A2 is healthy with 12 days of record, B1 is low. client_billing carries the newest answer of the platform.
    const bill = async (i: string, l: string, bal: number) => sql()`insert into client_billing (installation_id, location_id, state, wallet_state, wallet_balance, wallet_at) values (${i}, ${l}, 'ok', 'ok', ${bal}, now())
      on conflict (installation_id, location_id) do update set wallet_state = 'ok', wallet_balance = ${bal}, wallet_at = now()`;
    await bill(instA, A1, 0); await bill(instA, A2, 452); await bill(instB, B1, 6);
    for (let d = 12; d >= 1; d--) {
      for (const [i, l, start] of [[instA, A2, 500], [instB, B1, 60]] as const) {
        await sql()`insert into wg_samples (installation_id, location_id, observed_at, balance) values (${i}, ${l}, ${new Date(Date.now() - d * DAY)}, ${start - (12 - d) * 4})`;
      }
    }
    await sweepWallet(instA, Date.now(), { refresh: false });
    await sweepWallet(instB, Date.now(), { refresh: false });
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("each company's watchlist holds only its own accounts and the counts equal the rows", async () => {
    if (!ready) return;
    const a = owner(CO_A), b = owner(CO_B);
    const sa = await call(a, "GET", "wg?part=summary");
    expect(sa.status, sa.text).toBe(200);
    expect(sa.body.accounts).toBe(2);
    expect(sa.body.counts.empty).toBe(1);
    const la = await call(a, "GET", "wg?part=list&bucket=all");
    expect(la.body.rows.map((r: Json) => r.locationId).sort()).toEqual([A1, A2]);
    expect(la.body.total).toBe(sa.body.counts.all);
    expect(la.body.rows[0].locationId, "empty first").toBe(A1);
    const le = await call(a, "GET", "wg?part=list&bucket=empty");
    expect(le.body.total).toBe(sa.body.counts.empty);
    expect(le.body.rows).toHaveLength(sa.body.counts.empty);
    expect(la.text).not.toContain(B1);
    expect(la.text).not.toContain("zzWg Client B1");
    const lb = await call(b, "GET", "wg?part=list&bucket=all");
    expect(lb.body.rows.map((r: Json) => r.locationId)).toEqual([B1]);
    expect(lb.text).not.toContain("zzWg Client A");
    expect(lb.body.rows[0].level).toBe("low");
  });

  it("the other company's account, search and cursor give nothing and are never echoed", async () => {
    if (!ready) return;
    const a = owner(CO_A);
    for (const path of [`wg?part=account&account=${B1}`, `wg?part=usage&account=${B1}`, `wg?part=list&account=${B1}`, `wg?part=summary&account=${B1}`, "wg?part=list&q=zzWg%20Client%20B1", `wg?part=list&page=9&q=${B1}`, `wg?part=list&bucket=${B1}`]) {
      const r = await call(a, "GET", path);
      expect(r.text, path).not.toContain(B1);
      expect(r.text, path).not.toContain("zzWg Client B1");
      if (r.status === 200 && r.body.rows) expect(r.body.rows).toEqual([]);
    }
  });

  it("a limit, a pause or a watcher on the other company's account answers not found and changes nothing", async () => {
    if (!ready) return;
    const a = owner(CO_A);
    const r = await call(a, "POST", "wg/act/rule", { location: B1, lowAmount: 99, pauseDays: 30 });
    expect(r.status).toBe(404);
    expect((await sql()`select 1 from wg_rules where location_id = ${B1}`).length).toBe(0);
    const own = await call(a, "POST", "wg/act/rule", { location: A2, lowAmount: 460 });
    expect(own.status, own.text).toBe(200);
    const la = await call(a, "GET", "wg?part=list&bucket=low");
    expect(la.body.rows.map((x: Json) => x.locationId)).toContain(A2);
    expect(la.body.rows.find((x: Json) => x.locationId === A2).ruleAmount).toBe(460);
    const bad = await call(a, "POST", "wg/act/rule", { location: A2, lowAmount: -5 });
    expect(bad.status).toBe(400);
    expect((await call(staff(CO_A), "POST", "wg/act/rule", { location: A2, lowAmount: 1 })).status).toBe(403);
    const lb = await call(owner(CO_B), "GET", "wg?part=list&bucket=all");
    expect(lb.body.rows[0].ruleAmount).toBeNull();
  });

  it("a person who is not an owner or admin gets nothing from the wallet or the brief", async () => {
    if (!ready) return;
    for (const t of [staff(CO_A), client(CO_A, A1)]) {
      for (const path of ["wg?part=summary", "wg?part=list&bucket=all", "br?part=brief", "br?part=settings"]) {
        const r = await call(t, "GET", path);
        expect(r.text, path).not.toContain("zzWg Client");
        expect(r.text, path).not.toContain("xtestWgA");
      }
    }
  });

  it("our record is append-only and idempotent: the same platform answer twice is one reading", async () => {
    if (!ready) return;
    const before = (await sql()`select count(*)::int n from wg_samples where installation_id = ${instA} and location_id = ${A2}`)[0].n as number;
    await sweepWallet(instA, Date.now(), { refresh: false });
    await sweepWallet(instA, Date.now(), { refresh: false });
    expect((await sql()`select count(*)::int n from wg_samples where installation_id = ${instA} and location_id = ${A2}`)[0].n).toBe(before);
    const st = (await sql()`select burn_per_day::float8 b, days_left::float8 d, samples from wg_state where installation_id = ${instA} and location_id = ${A2}`)[0];
    expect(st.samples).toBeGreaterThanOrEqual(12);
    expect(st.b).toBeGreaterThan(3);
    expect(st.d).toBeGreaterThan(50);
  });

  it("alerts: once per episode, only for the company's own watchers, closed when the balance recovers", async () => {
    if (!ready) return;
    await sql()`insert into wg_watchers (installation_id, user_key) values (${instA}, 'u-xtest-wg-a')`;
    await sql()`insert into wg_watchers (installation_id, user_key) values (${instB}, 'u-xtest-wg-b')`;
    const n1 = await runWalletAlerts(instA, Date.now());
    expect(n1).toBeGreaterThanOrEqual(1);
    const mine = await sql()`select kind, recipient_user_key, location_id from alerts where installation_id = ${instA} and kind like 'wg_%'`;
    expect(mine.some((r) => r.kind === "wg_empty" && r.location_id === A1 && r.recipient_user_key === "u-xtest-wg-a")).toBe(true);
    expect(mine.every((r) => r.location_id !== B1)).toBe(true);
    expect(await runWalletAlerts(instA, Date.now()), "the same episode does not alert again").toBe(0);
    await runWalletAlerts(instB, Date.now());
    const theirs = await sql()`select recipient_user_key, location_id from alerts where installation_id = ${instB} and kind like 'wg_%'`;
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((r) => r.recipient_user_key === "u-xtest-wg-b" && r.location_id === B1)).toBe(true);
    // topped up: the open alert closes
    await sql()`update client_billing set wallet_balance = 300, wallet_at = now() where installation_id = ${instA} and location_id = ${A1}`;
    await sweepWallet(instA, Date.now(), { refresh: false });
    await runWalletAlerts(instA, Date.now());
    const open = await sql()`select 1 from alerts where installation_id = ${instA} and location_id = ${A1} and kind = 'wg_empty' and resolved_at is null`;
    expect(open.length).toBe(0);
    await sql()`update client_billing set wallet_balance = 0, wallet_at = now() where installation_id = ${instA} and location_id = ${A1}`;
  });

  it("the brief: each company's holds only its own numbers, choices and history are the person's own, and the test email is a rehearsal", async () => {
    if (!ready) return;
    const a = owner(CO_A), b = owner(CO_B), a2 = owner(CO_A, "u-second-a");
    const ba = await call(a, "GET", "br?part=brief");
    expect(ba.status, ba.text).toBe(200);
    expect(ba.body.brief.items.some((i: Json) => i.key === "wallet_empty")).toBe(true);
    expect(ba.text).not.toContain("zzWg Client B1");
    const bb = await call(b, "GET", "br?part=brief");
    expect(bb.text).not.toContain("zzWg Client A");
    expect(bb.body.brief.items.some((i: Json) => i.key === "wallet_empty")).toBe(false);
    const bad = await call(a, "POST", "br/act/settings", { email: "nope", emailOn: true, hour: 7, timezone: "UTC", sections: ["wallet"] });
    expect(bad.status).toBe(400);
    const none = await call(a, "POST", "br/act/settings", { email: "a@example.com", emailOn: true, hour: 7, timezone: "UTC", sections: [] });
    expect(none.status).toBe(400);
    const ok = await call(a, "POST", "br/act/settings", { email: "a@example.com", emailOn: true, hour: 7, timezone: "Nowhere/Land", sections: ["wallet"] });
    expect(ok.status).toBe(400);
    const saved = await call(a, "POST", "br/act/settings", { email: "a@example.com", emailOn: true, hour: 7, timezone: "UTC", quietDays: [0], sections: ["wallet"] });
    expect(saved.status, saved.text).toBe(200);
    expect((await call(a, "GET", "br?part=settings")).body.prefs.email).toBe("a@example.com");
    expect((await call(a2, "GET", "br?part=settings")).body.prefs.email, "another person in the same company").toBeNull();
    expect((await call(b, "GET", "br?part=settings")).body.prefs.email).toBeNull();
    const onlyWallet = await call(a, "GET", "br?part=brief");
    expect(onlyWallet.body.brief.items.every((i: Json) => i.section === "wallet")).toBe(true);
    // shown, then acted: the key must be one the brief held
    expect((await call(a, "POST", "br/act/seen", {})).body.recorded).toBe(true);
    expect((await call(a, "POST", "br/act/acted", { key: "not-a-key" })).status).toBe(404);
    expect((await call(a, "POST", "br/act/acted", { key: "wallet_empty" })).status).toBe(200);
    const h = await call(a, "GET", "br?part=history");
    expect(h.body.rows.find((r: Json) => r.channel === "app")).toMatchObject({ opened: true, acted: true, actedTitle: expect.stringContaining("run out of credit") });
    expect((await call(b, "GET", "br?part=history")).body.rows).toEqual([]);
    expect((await call(a2, "GET", "br?part=history")).body.rows).toEqual([]);
    expect((await call(b, "POST", "br/act/acted", { key: "wallet_empty" })).status, "another company cannot mark it").toBe(404);
    // the test goes only to the saved address, as a rehearsal while the live switch is off
    delete process.env.SEND_EMAIL_LIVE;
    const t = await call(a, "POST", "br/act/test", {});
    expect(t.status, t.text).toBe(200);
    expect(t.body.dryRun).toBe(true);
    expect(t.body.to).toBe("a@example.com");
    expect(t.body.text).not.toMatch(/gohighlevel|highlevel|\bghl\b|sub-?account/i);
    expect((await call(b, "POST", "br/act/test", {})).status, "no saved address").toBe(400);
    // the hourly run sends at most once a day, and only with something to say
    const at = Date.parse("2026-11-11T07:10:00Z");
    const f = { cf_save: false, cf_recover: false, cf_deals: false, wg_wallet: true, pm_module: false, td_today: true };
    expect(await runBriefs(instA, f, at)).toBe(1);
    expect(await runBriefs(instA, f, at + 600_000), "the day key was claimed").toBe(0);
    const hist = (await call(a, "GET", "br?part=history")).body.rows as Json[];
    expect(hist.filter((r) => r.channel === "email")).toHaveLength(1);
    expect(hist.find((r) => r.channel === "email")?.mode).toBe("dry_run");
  });
});
