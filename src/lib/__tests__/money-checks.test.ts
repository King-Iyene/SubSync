import assert from "node:assert/strict";
import { test } from "node:test";
import { countInvoices, invoiceBucket, needsPermissionText, normalInvoice, readChecks, readPaged, sampleChecks, totalOf, type Getter, type McSection } from "../analytics/money-checks.ts";

const NOW = Date.UTC(2026, 10, 14);
const inv = (id: string, status: string, total: number, amountDue: number, dueDate: string, currency = "USD") => ({ _id: id, name: `Invoice ${id}`, invoiceNumber: id, status, total, amountDue, dueDate, currency, contactDetails: { name: "Pat" } });
const INVOICES = [
  inv("a", "draft", 100, 100, "2026-12-01T00:00:00Z"),
  inv("b", "sent", 200, 200, "2026-12-01T00:00:00Z"),
  inv("c", "sent", 300, 300, "2026-11-01T00:00:00Z"), // past due
  inv("d", "partially_paid", 400, 150, "2026-12-01T00:00:00Z"),
  inv("e", "partially_paid", 500, 250, "2026-10-01T00:00:00Z"), // past due
  inv("f", "paid", 600, 0, "2026-10-01T00:00:00Z"),
  inv("g", "paid", 50, 0, "2026-10-01T00:00:00Z", "EUR"),
  inv("h", "void", 70, 0, "2026-10-01T00:00:00Z"),
  inv("i", "payment_processing", 80, 80, "2026-12-01T00:00:00Z"),
  inv("j", "weird_new_status", 10, 10, "2026-12-01T00:00:00Z"),
];
const ok = (body: unknown) => ({ status: 200, body });
const byKey = (s: McSection[], k: string) => s.find((x) => x.key === k) as McSection;

test("invoices are counted by status, overdue is its own group, nothing counted twice", () => {
  const rows = INVOICES.map((x) => normalInvoice(x, NOW)!);
  const b = Object.fromEntries(countInvoices(rows).map((x) => [x.key, x]));
  assert.deepEqual(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.count])), { draft: 1, sent: 1, partially_paid: 1, overdue: 2, processing: 1, paid: 2, void: 1, other: 1 });
  assert.equal(Object.values(b).reduce((n, x) => n + x.count, 0), INVOICES.length);
  // open groups add up what is still owed; the others add up the total; currencies stay apart
  assert.deepEqual(b.overdue.money, [{ currency: "USD", amount: 550 }]);
  assert.deepEqual(b.sent.money, [{ currency: "USD", amount: 200 }]);
  assert.deepEqual(b.partially_paid.money, [{ currency: "USD", amount: 150 }]);
  assert.deepEqual(b.paid.money, [{ currency: "USD", amount: 600 }, { currency: "EUR", amount: 50 }]);
  assert.equal(b.overdue.amountLabel, "still owed");
});

test("bucket rules: a draft or paid invoice is never overdue, a missing due date is never overdue", () => {
  assert.equal(invoiceBucket("draft", "2020-01-01", NOW), "draft");
  assert.equal(invoiceBucket("paid", "2020-01-01", NOW), "paid");
  assert.equal(invoiceBucket("sent", null, NOW), "sent");
  assert.equal(invoiceBucket("sent", "not a date", NOW), "sent");
  assert.equal(invoiceBucket("SENT", "2020-01-01", NOW), "overdue");
});

test("an empty account shows the six named groups at zero, never invented rows", () => {
  const b = countInvoices([]);
  assert.deepEqual(b.map((x) => x.key), ["draft", "sent", "partially_paid", "overdue", "paid", "void"]);
  assert.ok(b.every((x) => x.count === 0 && x.money.length === 0));
});

test("totalOf reads a number, an object or a one-item list, and says null when there is none", () => {
  assert.equal(totalOf({ total: 5 }, ["total"]), 5);
  assert.equal(totalOf({ total: [{ total: 7 }] }, ["total"]), 7);
  assert.equal(totalOf({ pagination: { total: 9 } }, ["pagination.total"]), 9);
  assert.equal(totalOf({}, ["total", "totalCount"]), null);
});

test("readPaged pages until the platform's total and stops at the cap", async () => {
  const calls: string[] = [];
  const get: Getter = async (path) => { calls.push(path); const off = Number(/offset=(\d+)/.exec(path)![1]); return ok({ invoices: Array.from({ length: Math.min(2, 5 - off) }, (_, i) => inv(`p${off + i}`, "paid", 1, 0, "2026-01-01")), total: 5 }); };
  const r = await readPaged(get, { path: (o) => `/invoices/?offset=${o}`, list: ["invoices"], total: ["total"], norm: (x) => normalInvoice(x, NOW), pageSize: 2, maxPages: 10 });
  assert.equal(r.rows.length, 5); assert.equal(r.total, 5); assert.equal(r.truncated, false); assert.equal(calls.length, 3);
  const capped = await readPaged(get, { path: (o) => `/invoices/?offset=${o}`, list: ["invoices"], total: ["total"], norm: (x) => normalInvoice(x, NOW), pageSize: 2, maxPages: 1 });
  assert.equal(capped.rows.length, 2); assert.equal(capped.truncated, true);
});

function fakeGet(overrides: Record<string, () => { status: number; body: unknown }> = {}, log: string[] = []): Getter {
  return async (path, version) => {
    log.push(`${version} ${path}`);
    for (const [frag, fn] of Object.entries(overrides)) if (path.includes(frag)) return fn();
    if (path.startsWith("/invoices/schedule")) return ok({ schedules: [{ _id: "s1", name: "Retainer" }, { _id: "s2", name: "Quarterly" }], total: 2 });
    if (path.startsWith("/invoices/template")) return ok({ data: [{ _id: "t1", name: "Standard" }], totalCount: 1 });
    if (path.startsWith("/invoices/estimate/list")) return ok({ estimates: [{ _id: "e1", name: "Roof", total: 900, currency: "USD", status: "sent" }, { _id: "e2", name: "Gutter", total: 100, currency: "USD", status: "accepted" }, { _id: "e3", name: "Fence", total: 50, currency: "USD", status: "sent" }], total: 3 });
    if (path.startsWith("/invoices/")) return ok({ invoices: INVOICES, total: INVOICES.length });
    if (path.startsWith("/payments/orders")) return ok({ data: [{ _id: "o1", name: "Kit", amount: 24, currency: "usd", status: "succeeded", createdAt: "2026-11-10T10:00:00Z" }], totalCount: 40 });
    if (path.startsWith("/payments/coupon/list")) return ok({ data: [{ _id: "c1", name: "Spring", code: "SPRING10", discountType: "percentage", discountValue: 10, active: true }], totalCount: 1 });
    if (path.startsWith("/payments/integrations/provider/whitelabel")) return ok({ providers: [{ _id: "p1", name: "Sample Pay" }] });
    if (path.startsWith("/payments/custom-provider/connect")) return ok({ name: "Sample Pay", live: { apiKey: "SECRET-LIVE-KEY", publishableKey: "pk_live_x" }, test: { apiKey: "SECRET-TEST-KEY" } });
    if (path.startsWith("/products/collections")) return ok({ data: [{ _id: "k1", name: "Seasonal" }], total: 1 });
    if (/^\/products\/[^/?]+\/price/.test(path)) return ok({ prices: [{ _id: "pr1", name: "Standard", amount: 120, currency: "USD", type: "one_time" }], total: 1 });
    if (path.startsWith("/products/")) return ok({ products: [{ _id: "pd1", name: "Inspection" }, { _id: "pd2", name: "Cleaning" }], total: [{ total: 2 }] });
    if (path.startsWith("/marketplace/billing/charges")) return ok({ charges: [{ chargeId: "ch1", amountCharged: 11.5, currency: "USD", units: 1, transactionType: "charge", refunded: false, createdAt: "2026-11-01T00:00:00Z" }, { chargeId: "ch2", amountCharged: 5, currency: "USD", refunded: true, createdAt: "2026-11-02T00:00:00Z" }], pagination: { total: 2, skip: 0, limit: 50 } });
    return { status: 404, body: null };
  };
}

test("every section reads with its own path and version, totals come from the platform's answer", async () => {
  const log: string[] = [];
  const s = await readChecks(fakeGet({}, log), "L1", null, NOW);
  assert.deepEqual(s.map((x) => x.state), s.map(() => "ok"));
  assert.equal(byKey(s, "invoices").count, 10);
  assert.equal(byKey(s, "schedules").count, 2);
  assert.equal(byKey(s, "templates").count, 1);
  assert.deepEqual(byKey(s, "estimates").buckets.map((b) => [b.key, b.count]), [["sent", 2], ["accepted", 1]]);
  assert.equal(byKey(s, "orders").count, 40);
  assert.equal(byKey(s, "orders").rows[0].currency, "USD");
  assert.equal(byKey(s, "coupons").rows[0].sub, "SPRING10 · 10% off");
  assert.equal(byKey(s, "products").count, 2);
  assert.equal(byKey(s, "prices").count, 2);
  assert.equal(byKey(s, "collections").count, 1);
  assert.deepEqual(byKey(s, "charges").buckets[0].money, [{ currency: "USD", amount: 11.5 }]);
  assert.ok(log.every((l) => l.startsWith("2021-07-28 ")));
  assert.ok(log.some((l) => l.includes("/invoices/?altId=L1&altType=location")));
  assert.ok(log.every((l) => !l.includes("L2")));
});

test("the payment provider section never exposes the keys the platform sends", async () => {
  const s = await readChecks(fakeGet(), "L1", null, NOW);
  const p = byKey(s, "providers");
  assert.equal(p.connected, true);
  assert.deepEqual(p.rows.map((r) => r.title), ["Sample Pay"]);
  assert.ok(!JSON.stringify(s).includes("SECRET"));
  assert.ok(!JSON.stringify(s).includes("pk_live"));
});

test("a permission that was not granted is never asked for, and says what to allow", async () => {
  const log: string[] = [];
  const granted = ["invoices.readonly"];
  const s = await readChecks(fakeGet({}, log), "L1", granted, NOW);
  assert.equal(byKey(s, "invoices").state, "ok");
  for (const k of ["schedules", "templates", "estimates", "orders", "coupons", "providers", "products", "prices", "collections", "charges"]) {
    assert.equal(byKey(s, k).state, "needs_permission", k);
    assert.match(byKey(s, k).message ?? "", /^Needs permission: reconnect and allow SubSync to /);
  }
  assert.equal(log.filter((l) => !l.includes("/invoices/?")).length, 0);
  assert.match(needsPermissionText(["invoices/estimate.readonly"]), /read estimates/);
});

test("a refusal from the platform is needs permission when unsure, and 404 is not available, a failure is an error", async () => {
  const s = await readChecks(fakeGet({ "/payments/orders": () => ({ status: 403, body: null }), "/payments/coupon/list": () => ({ status: 404, body: null }), "/marketplace/billing/charges": () => ({ status: 500, body: null }) }), "L1", null, NOW);
  assert.equal(byKey(s, "orders").state, "needs_permission");
  assert.equal(byKey(s, "coupons").state, "not_available");
  assert.match(byKey(s, "coupons").message ?? "", /^Not available from the platform yet/);
  assert.equal(byKey(s, "charges").state, "error");
  assert.equal(byKey(s, "invoices").state, "ok"); // one failing part never blanks the rest
});

test("with the permission granted, a platform refusal says not available (never 'reconnect')", async () => {
  const s = await readChecks(fakeGet({ "/payments/orders": () => ({ status: 403, body: null }) }), "L1", ["payments/orders.readonly"], NOW);
  assert.equal(byKey(s, "orders").state, "not_available");
  assert.ok(!/reconnect/i.test(byKey(s, "orders").message ?? ""));
});

test("empty answers are real zeros; a provider answering 404 means none is connected", async () => {
  const empty = fakeGet({ "/invoices/schedule": () => ok({ schedules: [], total: 0 }), "/payments/integrations": () => ok({ providers: [] }), "/payments/custom-provider": () => ({ status: 404, body: null }) });
  const s = await readChecks(empty, "L1", null, NOW);
  assert.equal(byKey(s, "schedules").count, 0);
  assert.deepEqual(byKey(s, "schedules").rows, []);
  assert.equal(byKey(s, "providers").state, "ok");
  assert.equal(byKey(s, "providers").connected, false);
});

test("prices are read for the first 20 products only, and say so", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ _id: `pd${i}`, name: `P${i}` }));
  const log: string[] = [];
  const s = await readChecks(fakeGet({ "/products/?": () => ok({ products: many, total: 25 }) }, log), "L1", null, NOW);
  assert.equal(log.filter((l) => /\/price\?/.test(l)).length, 20);
  assert.equal(byKey(s, "prices").truncated, true);
  assert.match(byKey(s, "prices").note ?? "", /first 20 products/);
});

test("the sample is labelled and holds every section", () => {
  const c = sampleChecks();
  assert.equal(c.sample, true);
  assert.equal(c.sections.length, 11);
  assert.ok(!JSON.stringify(c).toLowerCase().includes("needs permission"));
});
