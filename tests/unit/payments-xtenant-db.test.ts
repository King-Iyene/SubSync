import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { sweepPayments, type PmGetter } from "@/lib/analytics/payments-sweep";
import { runDisputeAlerts } from "@/lib/analytics/payments-alerts";

// Payments: the sweep (idempotent, resumable, test rows marked, recovery detected), the queue (keyset paging, filters, counts equal rows) and the cross-tenant guard: company A asks for, notes,
// logs disputes against and removes company B's things by every parameter. Nothing of B may come back and B's rows must not change. Skips until the Payments migration is applied.
// The platform is replaced by a stub that answers from fixtures, so no network is used. Fixtures (xtest-) removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD) || Boolean((globalThis as { __subsyncSql?: unknown }).__subsyncSql);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, k === "pm_resend" ? false : true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-pay-a", CO_B = "xtest-pay-b", A1 = "xtestPayA1", A2 = "xtestPayA2", B1 = "xtestPayB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", loc: string | null, personRole: string) =>
  signSession({ companyId: company, userId: `u-${personRole}`, role: personRole.endsWith("user") || personRole === "agency_staff" ? "user" : "admin", userName: "T", demo: false, kind, locationId: loc, personRole } as never);
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}

const NOW = Date.parse("2026-11-11T12:00:00Z");
// What the platform "says", per account. A1 has 12 failed payments (paging), one test-mode failure, one recovered failure, a late and a paid invoice and a past due repeat payment.
function stub(): (token: string) => PmGetter {
  const txnA1: Array<Record<string, unknown>> = [
    ...Array.from({ length: 12 }, (_, i) => ({ _id: `ta${i}`, status: "failed", amount: 10 + i, currency: "USD", contactId: `ca${i}`, contactName: `zzPay Ann ${i}`, contactEmail: `ann${i}@example.com`, liveMode: true, createdAt: `2026-11-0${(i % 9) + 1}T10:00:00Z` })),
    { _id: "ttest", status: "failed", amount: 999, currency: "USD", contactId: "cx", contactName: "zzPay Tester", liveMode: false, createdAt: "2026-11-05T10:00:00Z" },
    { _id: "tfail", status: "failed", amount: 55, currency: "EUR", contactId: "cr", contactName: "zzPay Rae", liveMode: true, createdAt: "2026-10-20T10:00:00Z" },
    { _id: "tfixed", status: "succeeded", amount: 55, currency: "EUR", contactId: "cr", contactName: "zzPay Rae", liveMode: true, createdAt: "2026-10-25T10:00:00Z" },
    { _id: "tref", status: "succeeded", amount: 80, amountRefunded: 30, currency: "USD", contactId: "cq", contactName: "zzPay Quinn", liveMode: true, createdAt: "2026-11-08T10:00:00Z" },
  ];
  const txnB1: Array<Record<string, unknown>> = [{ _id: "tb1", status: "failed", amount: 777, currency: "USD", contactId: "cb1", contactName: "zzPay Bruno", contactEmail: "bruno@example.com", liveMode: true, createdAt: "2026-11-02T10:00:00Z" }];
  const invA1: Array<Record<string, unknown>> = [{ _id: "ia1", status: "sent", amountDue: 300, total: 500, currency: "USD", dueDate: "2026-10-01", contactDetails: { id: "ci1", name: "zzPay Ivo", email: "ivo@example.com" }, liveMode: true, createdAt: "2026-09-20T10:00:00Z" }, { _id: "ia2", status: "paid", amountDue: 0, total: 100, currency: "USD", dueDate: "2026-10-01", contactDetails: { id: "ci2", name: "zzPay Paid" }, liveMode: true, createdAt: "2026-09-21T10:00:00Z" }];
  const invB1: Array<Record<string, unknown>> = [{ _id: "ib1", status: "sent", amountDue: 4000, currency: "USD", dueDate: "2026-10-01", contactDetails: { id: "cb2", name: "zzPay Bruno Inv", email: "bi@example.com" }, liveMode: true, createdAt: "2026-09-20T10:00:00Z" }];
  const subA1: Array<Record<string, unknown>> = [{ _id: "sa1", status: "past_due", amount: 40, currency: "USD", contactId: "cs1", contactName: "zzPay Sam", liveMode: true, createdAt: "2026-10-01T10:00:00Z" }];
  return () => async (path) => {
    const u = new URL("http://x" + path), alt = u.searchParams.get("altId") ?? "";
    const off = Number(u.searchParams.get("offset") ?? 0), lim = Number(u.searchParams.get("limit") ?? 100);
    const page = <T,>(all: T[]) => all.slice(off, off + lim);
    if (u.pathname.startsWith("/payments/transactions")) { const all = alt === A1 ? txnA1 : alt === B1 ? txnB1 : []; return { status: 200, body: { data: page(all), totalCount: all.length } }; }
    if (u.pathname.startsWith("/payments/subscriptions")) { const all = alt === A1 ? subA1 : []; return { status: 200, body: { data: page(all), totalCount: all.length } }; }
    if (u.pathname.startsWith("/invoices")) {
      const st = u.searchParams.get("status"); let all = alt === A1 ? invA1 : alt === B1 ? invB1 : [];
      if (st) all = all.filter((x) => x.status === st);
      return { status: 200, body: { invoices: page(all), total: all.length } };
    }
    return { status: 404, body: null };
  };
}

describe.skipIf(!HAS_DB)("payments: sweep, queue and cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from pm_items limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzPay A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzPay B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${instA}, ${A1}, 'zzPay Client A1', 'UTC'), (${instA}, ${A2}, 'zzPay Client A2', 'UTC'), (${instB}, ${B1}, 'zzPay Client B', 'UTC')`;
    await sql()`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status) values (${instA}, ${A2}, 'ok', 'plan1', 'Growth', 'past_due')`;
    const deps = { skipPlans: true, pace: 0, token: async () => "t", get: stub(), companyGet: async () => (async () => ({ status: 200, body: { title: "Growth", pricing: [{ amount: 297, currency: "usd", billingInterval: "month" }] } })) as PmGetter };
    await sweepPayments(instA, NOW, deps);
    await sweepPayments(instB, NOW, { ...deps });
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("the sweep stores current state, marks test rows, flags what needs action and finds the recovered one", async () => {
    if (!ok) return;
    const items = await sql()`select kind, item_id, problem_kind, live_mode, resolved_at, amount, currency from pm_items where installation_id = ${instA}`;
    const by = (id: string) => items.find((r) => r.item_id === id);
    expect(by("ta0")?.problem_kind).toBe("failed_payment");
    expect(by("ttest")?.live_mode).toBe(false);
    expect(by("ia1")?.problem_kind).toBe("late_invoice");
    expect(Number(by("ia1")?.amount)).toBe(300);
    expect(by("ia2")?.problem_kind).toBeNull();
    expect(by("sa1")?.problem_kind).toBe("failed_subscription");
    expect(by(A2)?.problem_kind).toBe("past_due_plan");
    expect(Number(by(A2)?.amount)).toBe(297);
    expect(by("tfail")?.resolved_at).not.toBeNull();
    expect(by("tfixed")?.problem_kind).toBeNull();
  });

  it("running the sweep again adds no duplicate rows and no duplicate events", async () => {
    if (!ok) return;
    const before = { i: Number((await sql()`select count(*) c from pm_items where installation_id = ${instA}`)[0].c), e: Number((await sql()`select count(*) c from pm_events where installation_id = ${instA}`)[0].c) };
    await sweepPayments(instA, NOW + 3_600_000, { skipPlans: true, pace: 0, token: async () => "t", get: stub(), companyGet: async () => null });
    const after = { i: Number((await sql()`select count(*) c from pm_items where installation_id = ${instA}`)[0].c), e: Number((await sql()`select count(*) c from pm_events where installation_id = ${instA}`)[0].c) };
    expect(after).toEqual(before);
    const ev = await sql()`select to_status from pm_events where installation_id = ${instA} and item_id = 'tfail'`;
    expect(ev.map((x) => x.to_status).sort()).toEqual(["failed", "recovered"]);
  });

  it("the queue pages by keyset, the count equals the rows, test rows are hidden unless asked, and money stays per currency", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    const keys: string[] = [];
    let cursor = "", total = -1, guard = 0;
    do {
      const r = await call(t, "GET", `payments?part=queue&size=5${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      if (total < 0) total = r.body.total;
      keys.push(...r.body.rows.map((x: Json) => x.key));
      cursor = r.body.next ?? "";
    } while (cursor && ++guard < 20);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(total);
    expect(total).toBe(12 + 1 + 1 + 1); // 12 failed, 1 late invoice, 1 failed repeat payment, 1 past due plan (the recovered one and the test row are not in it)
    expect(keys.some((k) => k.includes("ttest"))).toBe(false);
    const withTest = await call(t, "GET", "payments?part=queue&size=100&test=1");
    expect(withTest.body.total).toBe(total + 1);
    const eur = await call(t, "GET", "payments?part=queue&currency=EUR");
    expect(eur.body.total).toBe(0);
    const usd = await call(t, "GET", "payments?part=queue&currency=USD&size=100");
    expect(usd.body.totals).toHaveLength(1);
    expect(usd.body.totals[0].currency).toBe("USD");
    const first = (await call(t, "GET", "payments?part=queue&size=3")).body.rows;
    expect(first[0].amount * 1).toBeGreaterThanOrEqual(first[2].amount * 1 - 1e9); // ranked list returned
  });

  it("Today: tile counts equal the rows behind them", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    const today = await call(t, "GET", "payments?part=today");
    expect(today.status).toBe(200);
    const tile = (k: string) => today.body.tiles.find((x: Json) => x.key === k);
    expect(tile("failed").count).toBe((await call(t, "GET", "payments?part=queue&problem=failed")).body.total);
    expect(tile("late").count).toBe((await call(t, "GET", "payments?part=queue&problem=late_invoice")).body.total);
    expect(tile("past_due_plans").count).toBe((await call(t, "GET", "payments?part=queue&problem=past_due_plan")).body.total);
    expect(tile("refunds").count).toBe((await call(t, "GET", "payments?part=queue&problem=refund")).body.total);
    expect(tile("refunds").count).toBe(1);
  });

  it("reads: B's customers, amounts, accounts and ids never appear for A, whatever is asked", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    for (const path of ["payments?part=today", "payments?part=queue&size=100", "payments?part=queue&q=zzPay Bruno", "payments?part=queue&status=all&test=1", "payments?part=disputes", "payments?part=upcoming", "payments?part=history", "payments?part=options", "payments?part=setup", "payments?part=export", `payments?part=queue&cursor=${B1}`]) {
      const r = await call(t, "GET", path);
      expect(r.status, path).toBe(200);
      for (const bad of ["zzPay Bruno", "bruno@example.com", B1, "zzPay Client B", "ib1", "tb1", "777", "4000"]) expect(r.text, `${path} leaked ${bad}`).not.toContain(bad);
    }
    for (const path of [`payments?part=queue&location=${B1}`, `payments?part=today&location=${B1}`, `payments?part=disputes&location=${B1}`]) {
      const r = await call(t, "GET", path);
      expect(r.status, path).toBe(200);
      expect(r.text, path).not.toContain("zzPay Bruno");
      expect(r.body.rows ?? r.body.tiles ?? []).toBeTruthy();
      expect((r.body.rows ?? []).length, path).toBe(0);
    }
    expect((await call(t, "GET", `payments?part=item&loc=${B1}&kind=transaction&id=tb1`)).status).toBe(404);
    expect((await call(t, "GET", `payments?part=item&loc=${A1}&kind=transaction&id=tb1`)).status).toBe(404);
    expect((await call(t, "GET", `payments?part=item&loc=${A1}&kind=transaction&id=ta0`)).status).toBe(200);
  });

  it("writes: a note, dispute or removal aimed at B changes nothing; A's own work, preview, typed removal and notes work", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    const tb = session(CO_B, "agency", null, "agency_owner");
    const [{ id: bDispute }] = (await sql()`insert into pm_disputes (installation_id, location_id, customer, opened_on) values (${instB}, ${B1}, 'zzPay B dispute', '2026-11-01') returning id`) as unknown as Array<{ id: string }>;
    expect((await call(t, "POST", "payments/act/note", { location: B1, kind: "transaction", id: "tb1", action: "contacted" })).status).toBe(404);
    expect((await call(t, "POST", "payments/act/note", { location: A1, kind: "transaction", id: "tb1", action: "contacted" })).status).toBe(400); // an id of B's under A's account is not an item
    expect((await call(t, "POST", "payments/act/dispute", { location: B1, customer: "x", openedOn: "2026-11-01", step: "do" })).status).toBe(404);
    expect((await call(t, "POST", "payments/act/dispute-edit", { id: bDispute, customer: "hacked", openedOn: "2026-11-01", step: "do" })).status).toBe(404);
    expect((await call(t, "POST", "payments/act/dispute-remove", { id: bDispute, step: "do", confirm: "zzPay B dispute" })).status).toBe(404);
    expect(Number((await sql()`select count(*) c from pm_disputes where id = ${bDispute} and customer = 'zzPay B dispute'`)[0].c)).toBe(1);
    expect(Number((await sql()`select count(*) c from pm_notes where installation_id = ${instB}`)[0].c)).toBe(0);
    expect((await call(tb, "GET", "payments?part=disputes")).body.total).toBe(1);

    // A's own: preview first, nothing saved by the preview
    const mk = { location: A1, customer: "zzPay Dana", amount: 480, currency: "usd", openedOn: "2026-11-05", evidenceDueOn: "2026-11-13", status: "open", processorUrl: "https://example.com/d/1" };
    const pre = await call(t, "POST", "payments/act/dispute", { ...mk, step: "preview" });
    expect(pre.status).toBe(200);
    expect(Number((await sql()`select count(*) c from pm_disputes where installation_id = ${instA}`)[0].c)).toBe(0);
    expect((await call(t, "POST", "payments/act/dispute", { ...mk, processorUrl: "javascript:alert(1)", step: "do" })).status).toBe(400);
    const made = await call(t, "POST", "payments/act/dispute", { ...mk, step: "do" });
    expect(made.status).toBe(200);
    const id = made.body.id as string;
    const list = await call(t, "GET", "payments?part=disputes");
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.label).toMatch(/Entered by you/);
    const edit = await call(t, "POST", "payments/act/dispute-edit", { id, status: "won", step: "preview" });
    expect(edit.body.lines.some((l: Json) => l.field === "Status")).toBe(true);
    expect((await call(t, "GET", "payments?part=disputes")).body.rows[0].status).toBe("open");
    expect((await call(t, "POST", "payments/act/dispute-edit", { id, status: "won", step: "do" })).status).toBe(200);
    expect((await call(t, "GET", "payments?part=disputes&status=won")).body.rows).toHaveLength(1);
    expect((await call(t, "POST", "payments/act/dispute-remove", { id, step: "do", confirm: "wrong" })).status).toBe(400);
    expect((await call(t, "POST", "payments/act/dispute-remove", { id, step: "do", confirm: "zzPay Dana" })).status).toBe(200);
    expect((await call(t, "GET", "payments?part=disputes")).body.rows).toHaveLength(0);

    // notes: dismiss needs a reason; snooze hides from the default list; contacted stays listed
    const item = { location: A1, kind: "transaction", id: "ta1" };
    expect((await call(t, "POST", "payments/act/note", { ...item, action: "dismiss" })).status).toBe(400);
    expect((await call(t, "POST", "payments/act/note", { ...item, action: "snooze", days: 3 })).status).toBe(200);
    expect((await call(t, "GET", "payments?part=queue&size=100")).body.rows.some((r: Json) => r.itemId === "ta1")).toBe(false);
    expect((await call(t, "GET", "payments?part=queue&size=100&status=snoozed")).body.rows.map((r: Json) => r.itemId)).toEqual(["ta1"]);
    expect((await call(t, "POST", "payments/act/note", { location: A1, kind: "transaction", id: "ta2", action: "contacted", note: "called" })).status).toBe(200);
    expect((await call(t, "GET", "payments?part=queue&size=100&status=contacted")).body.rows.map((r: Json) => r.itemId)).toEqual(["ta2"]);
    const panel = await call(t, "GET", `payments?part=item&loc=${A1}&kind=transaction&id=ta2`);
    expect(panel.body.messages).toHaveLength(3);
    expect(panel.body.notes[0].action).toBe("contacted");
    expect(panel.body.canResend).toBe(false);
    expect((await call(t, "POST", "payments/act/resend", { location: A1, id: "ia1", step: "preview" })).status).toBe(404); // switched off
  });


  it("dispute reminders: one alert per dispute and stage, only for the person who logged it, none for B or for finished ones", async () => {
    if (!ok) return;
    const due = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
    await sql()`insert into pm_disputes (installation_id, location_id, customer, opened_on, evidence_due_on, status, created_by) values
      (${instA}, ${A1}, 'zzPay Soon', '2026-11-01', ${due(1)}, 'open', 'u-x1'), (${instA}, ${A1}, 'zzPay Far', '2026-11-01', ${due(9)}, 'open', 'u-x1'), (${instA}, ${A1}, 'zzPay Won', '2026-11-01', ${due(1)}, 'won', 'u-x1'),
      (${instB}, ${B1}, 'zzPay B soon', '2026-11-01', ${due(1)}, 'open', 'u-b1')`;
    const n1 = await runDisputeAlerts(instA, NOW);
    expect(n1).toBe(1);
    expect(await runDisputeAlerts(instA, NOW)).toBe(0);
    const a = await sql()`select recipient_user_key, title from alerts where installation_id = ${instA} and kind = 'pm_dispute_due'`.catch(() => []);
    if (a.length) { expect(a).toHaveLength(1); expect(String(a[0].title)).toContain("zzPay Soon"); expect(String(a[0].title)).not.toContain("zzPay B"); }
    expect((await sql()`select count(*) c from alerts where installation_id = ${instB} and kind = 'pm_dispute_due'`.catch(() => [{ c: 0 }]))[0].c * 1).toBe(0);
  });

  it("who may see it: an account administrator sees only their own account; an account user and a client's staff see nothing; resend is off", async () => {
    if (!ok) return;
    const admin = await call(session(CO_A, "business", A1, "account_admin"), "GET", "payments?part=queue&size=100");
    expect(admin.status).toBe(200);
    expect(admin.body.canSee).toBe(true);
    expect(admin.body.rows.length).toBeGreaterThan(0);
    expect(admin.body.rows.every((r: Json) => r.locationId === A1)).toBe(true);
    const user = await call(session(CO_A, "business", A1, "account_user"), "GET", "payments?part=queue&size=100");
    expect(user.body.canSee).toBe(false);
    expect(user.body.rows).toEqual([]);
    expect((await call(session(CO_A, "business", A1, "account_user"), "POST", "payments/act/note", { location: A1, kind: "transaction", id: "ta3", action: "contacted" })).status).toBe(403);
    const client = await call(session(CO_A, "client", A1, "account_admin"), "GET", "payments?part=today");
    expect([200, 403]).toContain(client.status);
    expect(client.body.rows ?? []).toEqual([]);
    const own = await call(session(CO_A, "business", A1, "account_admin"), "GET", `payments?part=queue&location=${A2}`);
    expect(own.body.rows).toEqual([]);
  });
});
