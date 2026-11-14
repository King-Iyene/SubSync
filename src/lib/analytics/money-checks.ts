import { scopeWords } from "../scope-words.ts";

// Money checks (Payments > Money checks). READ ONLY and LIVE: every section is read from the platform with the client account's own key when the tab is opened, and nothing is stored.
// It exists so each optional money permission has one plain, honest screen that uses it. Pure (no network, no database): the reader is handed a `Getter`, so every rule below is unit tested.
//
// Endpoint paths and versions are from the platform's published API description (github.com/GoHighLevel/highlevel-api-docs, apps/invoices.json, payments.json, products.json, marketplace.json):
//   GET /invoices/?altId&altType=location&limit&offset                 invoices.readonly            answer { invoices[], total }          VERIFIED in the API description
//   GET /invoices/schedule?altId&altType&limit&offset                  invoices/schedule.readonly   answer { schedules[], total }         VERIFIED in the API description
//   GET /invoices/template?altId&altType&limit&offset                  invoices/template.readonly   answer { data[], totalCount }         VERIFIED in the API description
//   GET /invoices/estimate/list?altId&altType&limit&offset             invoices/estimate.readonly   answer { estimates[], total }         path VERIFIED, answer keys and status words NOT VERIFIED LIVE
//   GET /payments/orders?altId&altType&limit&offset                    payments/orders.readonly     answer { data[], totalCount }         VERIFIED in the API description
//   GET /payments/coupon/list?altId&altType&limit&offset               payments/coupons.readonly    answer { data[], totalCount }?        path VERIFIED, answer keys NOT VERIFIED LIVE
//   GET /payments/integrations/provider/whitelabel?altId&altType       payments/integration.readonly   answer { providers[] }             VERIFIED in the API description
//   GET /payments/custom-provider/connect?locationId                   payments/custom-provider.readonly   (only the provider name is used; keys in the answer are never read or shown)   NOT VERIFIED LIVE
//   GET /products/?locationId&limit&offset                             products.readonly            answer { products[], total }          path VERIFIED, total shape NOT VERIFIED LIVE
//   GET /products/{id}/price?locationId&limit&offset                   products/prices.readonly     answer { prices[], total }            path VERIFIED, answer keys NOT VERIFIED LIVE
//   GET /products/collections?altId&altType&limit&offset               products/collection.readonly answer { data[], total }              path VERIFIED, answer keys NOT VERIFIED LIVE
//   GET /marketplace/billing/charges?limit&skip                        charges.readonly             answer { charges[], pagination{total} }   VERIFIED in the API description (no Version header declared; the usual one is sent)
// Every answer is read defensively: a list is looked for under the documented key first, and a field that is missing is shown as missing, never invented.

export type McState = "ok" | "needs_permission" | "not_available" | "error";
export type McMoney = { currency: string; amount: number };
export type McBucket = { key: string; label: string; count: number; money: McMoney[]; /** What the amount is: the invoice total, or only what is still owed. */ amountLabel: "total" | "still owed" };
export type McRow = { id: string | null; title: string; sub: string | null; amount: number | null; currency: string | null; status: string | null; bucket: string | null; date: string | null };
export type McSection = {
  key: McKey; label: string; scopes: string[]; state: McState; message: string | null;
  /** The platform's own total when it sends one, otherwise how many were read. Null when nothing could be read. */
  count: number | null; /** True when there are more than the rows read. */ truncated: boolean; rows: McRow[]; buckets: McBucket[]; note: string | null;
  /** Only the payment provider section: yes, no, or null when it could not be read. */ connected: boolean | null;
};
export type McKey = "invoices" | "schedules" | "templates" | "estimates" | "orders" | "coupons" | "providers" | "products" | "prices" | "collections" | "charges";
export const MC_KEYS: readonly McKey[] = ["invoices", "schedules", "templates", "estimates", "orders", "coupons", "providers", "products", "prices", "collections", "charges"];
export type McChecks = { account: { id: string; name: string } | null; sections: McSection[]; sample: boolean; unitsNote: string };

export type Resp = { status: number; body: unknown };
export type Getter = (path: string, version: string) => Promise<Resp>;

export const NOT_AVAILABLE = "Not available from the platform yet";
export const UNITS_NOTE = "Amounts are shown as the platform sends them, in whole currency units, one currency at a time.";
const V = "2021-07-28";
const PAGE = 100, MAX_PAGES = 10, ROW_CAP = 300, PRICE_PRODUCTS = 20;

// What to say when a permission has no entry in the shared plain-words list yet (a new optional permission). Never the raw name.
const LOCAL_WORDS: Record<string, string> = {
  "invoices.readonly": "read invoices", "invoices/schedule.readonly": "read invoice schedules", "invoices/template.readonly": "read invoice templates", "invoices/estimate.readonly": "read estimates",
  "payments/orders.readonly": "read orders", "payments/coupons.readonly": "read coupons", "payments/integration.readonly": "see which payment providers are connected",
  "payments/custom-provider.readonly": "see which custom payment provider is connected", "products.readonly": "read products", "products/prices.readonly": "read product prices",
  "products/collection.readonly": "read product collections", "charges.readonly": "read charges made by apps",
};
const GENERIC = scopeWords("__unknown__");
export const wordsFor = (scope: string): string => { const w = scopeWords(scope); return w === GENERIC ? LOCAL_WORDS[scope] ?? GENERIC : w; };
export const needsPermissionText = (scopes: string[]): string => {
  const w = [...new Set(scopes.map(wordsFor))];
  return `Needs permission: reconnect and allow SubSync to ${w.length <= 1 ? w[0] ?? "read this" : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`}.`;
};

const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object" && !Array.isArray(c)) c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const dateOf = (v: unknown): string | null => { const s = str(v); if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };
const cur = (v: unknown): string | null => { const s = str(v); return s ? s.toUpperCase().slice(0, 3) : null; };

/** The first list found under the given keys (an array under the first key that holds one). */
export function listOf(body: unknown, keys: string[]): unknown[] {
  for (const k of keys) { const v = dig(body, k); if (Array.isArray(v)) return v; }
  return [];
}
/** The platform's total, wherever it sits: a number, or { total } / [{ total }]. Null when it sends none. */
export function totalOf(body: unknown, keys: string[]): number | null {
  for (const k of keys) {
    const v = k.includes(".") ? dig(body, ...k.split(".")) : dig(body, k);
    const n = num(v); if (n !== null) return n;
    if (Array.isArray(v) && v.length) { const m = num(rec(v[0]).total); if (m !== null) return m; }
  }
  return null;
}

// ---- invoices: status counting ----
export type InvoiceBucketKey = "draft" | "sent" | "partially_paid" | "paid" | "void" | "overdue" | "processing" | "other";
const BUCKETS: Array<[InvoiceBucketKey, string, "total" | "still owed"]> = [
  ["draft", "Draft", "total"], ["sent", "Sent, waiting for payment", "still owed"], ["partially_paid", "Partly paid", "still owed"], ["overdue", "Overdue (sent or partly paid, past the due date)", "still owed"],
  ["processing", "Payment processing", "total"], ["paid", "Paid", "total"], ["void", "Void", "total"], ["other", "Another status", "total"],
];
/** Which bucket an invoice is in. Overdue means sent or partly paid with a due date that has passed; it is its own bucket, so nothing is counted twice. */
export function invoiceBucket(status: string | null, dueDate: string | null, now: number): InvoiceBucketKey {
  const s = (status ?? "").toLowerCase();
  const late = (() => { const t = dueDate ? Date.parse(dueDate) : NaN; return Number.isFinite(t) && t < now; })();
  if (s === "draft") return "draft";
  if (s === "paid") return "paid";
  if (s === "void") return "void";
  if (s === "payment_processing") return "processing";
  if (s === "sent" || s === "partially_paid") return late ? "overdue" : s === "sent" ? "sent" : "partially_paid";
  return "other";
}
export function normalInvoice(raw: unknown, now: number): McRow | null {
  const o = rec(raw);
  const id = str(o._id) ?? str(o.id);
  if (!id && !str(o.name) && !str(o.invoiceNumber)) return null;
  const status = str(o.status), dueDate = str(o.dueDate);
  const bucket = invoiceBucket(status, dueDate, now);
  const total = num(o.total), owed = num(o.amountDue);
  const open = bucket === "sent" || bucket === "partially_paid" || bucket === "overdue";
  const who = str(rec(o.contactDetails).name) ?? str(o.contactName);
  const number = str(o.invoiceNumber);
  return { id, title: str(o.name) ?? (number ? `Invoice ${number}` : "Invoice"), sub: [number ? `No. ${number}` : null, who].filter(Boolean).join(" · ") || null, amount: open && owed !== null ? owed : total, currency: cur(o.currency), status, bucket, date: dateOf(dueDate) };
}
export function addMoney(list: McMoney[], currency: string | null, amount: number | null): void {
  if (amount === null) return;
  const c = currency ?? "";
  const hit = list.find((m) => m.currency === c);
  if (hit) hit.amount = Math.round((hit.amount + amount) * 100) / 100; else list.push({ currency: c, amount: Math.round(amount * 100) / 100 });
}
/** Counts and money per bucket from invoice rows. Only buckets that have invoices are returned (plus the six the screen always names). */
export function countInvoices(rows: McRow[]): McBucket[] {
  const always = new Set<string>(["draft", "sent", "partially_paid", "paid", "void", "overdue"]);
  return BUCKETS.map(([key, label, amountLabel]) => {
    const mine = rows.filter((r) => r.bucket === key);
    const money: McMoney[] = [];
    for (const r of mine) addMoney(money, r.currency, r.amount);
    return { key, label, count: mine.length, money, amountLabel };
  }).filter((b) => b.count > 0 || always.has(b.key));
}
/** Estimates: the platform's own status words, counted as they come (the list of words is not published, so none are guessed). */
export function countByStatus(rows: McRow[]): McBucket[] {
  const by = new Map<string, McRow[]>();
  for (const r of rows) { const k = (r.status ?? "No status").toLowerCase(); by.set(k, [...(by.get(k) ?? []), r]); }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, rs]) => {
    const money: McMoney[] = [];
    for (const r of rs) addMoney(money, r.currency, r.amount);
    return { key, label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), count: rs.length, money, amountLabel: "total" as const };
  });
}

// ---- row makers for the other sections ----
const discountText = (o: Record<string, unknown>): string | null => {
  const v = num(o.discountValue), t = str(o.discountType);
  if (v === null) return null;
  return t && /percent/i.test(t) ? `${v}% off` : `${v} off`;
};
export const normalEstimate = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && !str(o.name)) return null; return { id, title: str(o.name) ?? (str(o.estimateNumber) ? `Estimate ${str(o.estimateNumber)}` : "Estimate"), sub: str(rec(o.contactDetails).name), amount: num(o.total), currency: cur(o.currency), status: str(o.status) ?? str(o.estimateStatus), bucket: null, date: dateOf(o.issueDate) ?? dateOf(o.createdAt) }; };
export const normalOrder = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id) return null; return { id, title: str(o.name) ?? str(o.sourceName) ?? "Order", sub: str(o.contactName) ?? str(o.sourceType), amount: num(o.amount), currency: cur(o.currency), status: str(o.status) ?? str(o.paymentStatus), bucket: null, date: dateOf(o.createdAt) }; };
export const normalCoupon = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && !str(o.name) && !str(o.code)) return null; return { id, title: str(o.name) ?? str(o.code) ?? "Coupon", sub: [str(o.code), discountText(o)].filter(Boolean).join(" · ") || null, amount: null, currency: null, status: typeof o.active === "boolean" ? (o.active ? "Active" : "Inactive") : str(o.status), bucket: null, date: dateOf(o.endDate) ?? dateOf(o.startDate) }; };
export const normalProduct = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && !str(o.name)) return null; return { id, title: str(o.name) ?? "Product", sub: str(o.productType), amount: null, currency: null, status: typeof o.availableInStore === "boolean" ? (o.availableInStore ? "In your store" : "Not in your store") : null, bucket: null, date: dateOf(o.createdAt) }; };
export const normalPrice = (raw: unknown, productName: string | null): McRow | null => {
  const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && num(o.amount) === null) return null;
  const every = str(rec(o.recurring).interval);
  return { id, title: [productName, str(o.name)].filter(Boolean).join(" - ") || "Price", sub: every ? `Repeats every ${num(rec(o.recurring).intervalCount) ?? 1} ${every}` : str(o.type) === "recurring" ? "Repeats" : "One time", amount: num(o.amount), currency: cur(o.currency), status: null, bucket: null, date: dateOf(o.createdAt) };
};
export const normalCollection = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && !str(o.name)) return null; return { id, title: str(o.name) ?? "Collection", sub: str(o.slug), amount: null, currency: null, status: null, bucket: null, date: dateOf(o.createdAt) }; };
export const normalCharge = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o.chargeId) ?? str(o._id) ?? str(o.id); if (!id) return null; const units = num(o.units); return { id, title: str(rec(o.meta).description) ?? "Charge made by an app", sub: [str(o.transactionType), units !== null ? `${units} ${units === 1 ? "unit" : "units"}` : null].filter(Boolean).join(" · ") || null, amount: num(o.amountCharged), currency: cur(o.currency), status: o.refunded === true ? "Refunded" : "Charged", bucket: null, date: dateOf(o.createdAt) }; };
export const normalTemplate = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && !str(o.name)) return null; return { id, title: str(o.name) ?? "Template", sub: null, amount: num(o.total), currency: cur(o.currency), status: null, bucket: null, date: dateOf(o.updatedAt) ?? dateOf(o.createdAt) }; };
export const normalSchedule = (raw: unknown): McRow | null => { const o = rec(raw); const id = str(o._id) ?? str(o.id); if (!id && !str(o.name)) return null; return { id, title: str(o.name) ?? "Schedule", sub: str(rec(o.contactDetails).name), amount: num(o.total), currency: cur(o.currency), status: str(o.status), bucket: null, date: dateOf(rec(o.schedule).startDate) ?? dateOf(o.createdAt) }; };

// ---- reading ----
const blank = (key: McKey, label: string, scopes: string[]): McSection => ({ key, label, scopes, state: "ok", message: null, count: null, truncated: false, rows: [], buckets: [], note: null, connected: null });
const fail = (s: McSection, status: number, granted: boolean): McSection => {
  if (status === 401 || status === 403) return { ...s, state: granted ? "not_available" : "needs_permission", message: granted ? `${NOT_AVAILABLE}: it refused this account even with the permission allowed (often a plan feature that is not switched on).` : needsPermissionText(s.scopes) };
  if (status === 404 || status === 405 || status === 410 || status === 422) return { ...s, state: "not_available", message: `${NOT_AVAILABLE}: this account has nothing at this address.` };
  return { ...s, state: "error", message: "Your CRM did not answer. Try again in a minute." };
};

type PagedCfg = { path: (offset: number) => string; version?: string; list: string[]; total: string[]; norm: (raw: unknown) => McRow | null; pageSize?: number; maxPages?: number };
/** Pages through a list (at most MAX_PAGES), stopping at the platform's total or a short page. Returns what it got and the first failing status, if any. */
export async function readPaged(get: Getter, cfg: PagedCfg): Promise<{ status: number; rows: McRow[]; total: number | null; truncated: boolean; rawCount: number }> {
  const size = cfg.pageSize ?? PAGE, max = cfg.maxPages ?? MAX_PAGES;
  const rows: McRow[] = []; let total: number | null = null, rawCount = 0, status = 200, truncated = false;
  for (let p = 0; p < max; p++) {
    let r: Resp;
    try { r = await get(cfg.path(p * size), cfg.version ?? V); } catch { return { status: 0, rows, total, truncated, rawCount }; }
    if (r.status < 200 || r.status >= 300) { status = r.status; if (p === 0) return { status, rows: [], total: null, truncated: false, rawCount: 0 }; truncated = true; break; }
    const items = listOf(r.body, cfg.list);
    total = totalOf(r.body, cfg.total) ?? total;
    rawCount += items.length;
    for (const it of items) { const n = cfg.norm(it); if (n) rows.push(n); }
    if (items.length < size || (total !== null && rawCount >= total)) return { status: 200, rows, total, truncated: false, rawCount };
    if (p === max - 1) truncated = true;
  }
  return { status, rows, total, truncated, rawCount };
}

const hasScope = (granted: string[] | null, s: string) => granted === null || granted.includes(s);
/** Everything the Money checks tab shows for ONE account. `granted` is the permissions the install holds (null when not known: the platform is asked and decides). */
export async function readChecks(get: Getter, locationId: string, granted: string[] | null, now = Date.now()): Promise<McSection[]> {
  const L = encodeURIComponent(locationId);
  const alt = `altId=${L}&altType=location`;
  const out = new Map<McKey, McSection>();

  /** One section from one paged list. Without the permission the platform is not asked at all. */
  async function simple(key: McKey, label: string, scope: string, cfg: PagedCfg, after?: (s: McSection, r: Awaited<ReturnType<typeof readPaged>>) => McSection): Promise<void> {
    const base = blank(key, label, [scope]);
    if (!hasScope(granted, scope)) { out.set(key, { ...base, state: "needs_permission", message: needsPermissionText([scope]) }); return; }
    const r = await readPaged(get, cfg);
    if (r.status !== 200) { out.set(key, fail(base, r.status, granted !== null)); return; }
    let s: McSection = { ...base, count: r.total ?? r.rawCount, truncated: r.truncated || (r.total !== null && r.total > r.rawCount), rows: r.rows.slice(0, ROW_CAP) };
    if (after) s = after(s, r);
    out.set(key, s);
  }

  const tasks: Array<Promise<void>> = [
    simple("invoices", "Invoices", "invoices.readonly", { path: (o) => `/invoices/?${alt}&limit=${PAGE}&offset=${o}`, list: ["invoices"], total: ["total"], norm: (x) => normalInvoice(x, now) }, (s, r) => ({ ...s, buckets: countInvoices(r.rows), note: "Overdue means sent or partly paid with a due date that has passed. Each invoice is in one group only." })),
    simple("schedules", "Invoice schedules", "invoices/schedule.readonly", { path: (o) => `/invoices/schedule?${alt}&limit=${PAGE}&offset=${o}`, list: ["schedules"], total: ["total"], norm: normalSchedule, maxPages: 3 }),
    simple("templates", "Invoice templates", "invoices/template.readonly", { path: (o) => `/invoices/template?${alt}&limit=${PAGE}&offset=${o}`, list: ["data", "templates"], total: ["totalCount", "total"], norm: normalTemplate, maxPages: 3 }),
    simple("estimates", "Estimates", "invoices/estimate.readonly", { path: (o) => `/invoices/estimate/list?${alt}&limit=${PAGE}&offset=${o}`, list: ["estimates", "data"], total: ["total", "totalCount"], norm: normalEstimate, maxPages: 5 }, (s, r) => ({ ...s, buckets: countByStatus(r.rows), note: "Status words are the platform's own." })),
    simple("orders", "Recent orders", "payments/orders.readonly", { path: (o) => `/payments/orders?${alt}&limit=25&offset=${o}`, list: ["data"], total: ["totalCount", "total"], norm: normalOrder, pageSize: 25, maxPages: 1 }, (s) => ({ ...s, note: "The newest 25 orders. Open a person in a list to see their own orders." })),
    simple("coupons", "Coupons", "payments/coupons.readonly", { path: (o) => `/payments/coupon/list?${alt}&limit=${PAGE}&offset=${o}`, list: ["data", "coupons"], total: ["totalCount", "total"], norm: normalCoupon, maxPages: 3 }),
    simple("collections", "Product collections", "products/collection.readonly", { path: (o) => `/products/collections?${alt}&limit=${PAGE}&offset=${o}`, list: ["data", "collections"], total: ["total", "totalCount"], norm: normalCollection, maxPages: 3 }),
    simple("charges", "Charges made by apps", "charges.readonly", { path: (o) => `/marketplace/billing/charges?limit=50&skip=${o}`, list: ["charges"], total: ["pagination.total", "count"], norm: normalCharge, pageSize: 50, maxPages: 2 }, (s, r) => {
      const money: McMoney[] = [];
      for (const x of r.rows) if (x.status === "Charged") addMoney(money, x.currency, x.amount);
      return { ...s, buckets: s.rows.length ? [{ key: "charged", label: "Charged to this account", count: r.rows.filter((x) => x.status === "Charged").length, money, amountLabel: "total" }] : [], note: "Charges made to this account by apps from the marketplace." };
    }),
  ];

  // Payment providers: the list of custom providers plus the one custom provider connection. Only the name is read; the keys the platform may send are never read or shown.
  tasks.push((async () => {
    const scopes = ["payments/integration.readonly", "payments/custom-provider.readonly"];
    const base = blank("providers", "Payment provider", scopes);
    const canList = hasScope(granted, scopes[0]), canOne = hasScope(granted, scopes[1]);
    if (!canList && !canOne) { out.set("providers", { ...base, state: "needs_permission", message: needsPermissionText(scopes) }); return; }
    const rows: McRow[] = [];
    let ok = false, last = 0;
    if (canList) {
      const r = await get(`/payments/integrations/provider/whitelabel?${alt}`, V).catch(() => ({ status: 0, body: null } as Resp));
      last = r.status;
      if (r.status === 200) { ok = true; for (const p of listOf(r.body, ["providers"])) { const o = rec(p); rows.push({ id: str(o._id) ?? str(o.id), title: str(o.name) ?? str(o.title) ?? str(o.provider) ?? "Payment provider", sub: "Custom payment provider", amount: null, currency: null, status: "Connected", bucket: null, date: null }); } }
    }
    if (canOne) {
      const r = await get(`/payments/custom-provider/connect?locationId=${L}`, V).catch(() => ({ status: 0, body: null } as Resp));
      if (r.status === 200) { ok = true; const nm = str(dig(r.body, "name")); if (nm && !rows.some((x) => x.title === nm)) rows.push({ id: null, title: nm, sub: "Custom payment provider", amount: null, currency: null, status: "Connected", bucket: null, date: null }); }
      else if (r.status === 404) ok = true; // no custom provider set up for this account
      else if (!ok) last = r.status;
    }
    if (!ok) { out.set("providers", fail(base, last, canList && canOne)); return; }
    out.set("providers", { ...base, count: rows.length, rows, connected: rows.length > 0, note: `Only custom payment providers are reported. ${NOT_AVAILABLE}: whether Stripe, PayPal or another built-in provider is connected.` });
  })());

  // Products, then the prices of the first products (one call per product, so it is capped and said so).
  tasks.push((async () => {
    const scope = "products.readonly", pscope = "products/prices.readonly";
    const base = blank("products", "Products", [scope]), pbase = blank("prices", "Prices", [pscope]);
    let products: Array<{ id: string; name: string | null }> = [];
    if (!hasScope(granted, scope)) out.set("products", { ...base, state: "needs_permission", message: needsPermissionText([scope]) });
    else {
      const raw: unknown[] = [];
      const r = await readPaged(get, { path: (o) => `/products/?locationId=${L}&limit=${PAGE}&offset=${o}`, list: ["products", "data"], total: ["total", "totalCount"], norm: (x) => { raw.push(x); return normalProduct(x); }, maxPages: 3 });
      if (r.status !== 200) out.set("products", fail(base, r.status, granted !== null));
      else {
        products = raw.map((x) => ({ id: str(rec(x)._id) ?? str(rec(x).id) ?? "", name: str(rec(x).name) })).filter((p) => p.id);
        out.set("products", { ...base, count: r.total ?? r.rawCount, truncated: r.truncated || (r.total !== null && r.total > r.rawCount), rows: r.rows.slice(0, ROW_CAP) });
      }
    }
    if (!hasScope(granted, pscope)) { out.set("prices", { ...pbase, state: "needs_permission", message: needsPermissionText([pscope]) }); return; }
    const pState = out.get("products");
    if (pState && pState.state !== "ok") { out.set("prices", { ...pbase, state: pState.state === "needs_permission" ? "needs_permission" : pState.state, message: pState.state === "needs_permission" ? needsPermissionText([scope]) : pState.message }); return; }
    const first = products.slice(0, PRICE_PRODUCTS);
    const rows: McRow[] = []; let bad = 0, lastBad = 0;
    for (let i = 0; i < first.length; i += 5) {
      const got = await Promise.all(first.slice(i, i + 5).map((p) => readPaged(get, { path: (o) => `/products/${encodeURIComponent(p.id)}/price?locationId=${L}&limit=${PAGE}&offset=${o}`, list: ["prices", "data"], total: ["total", "totalCount"], norm: (x) => normalPrice(x, p.name), maxPages: 2 })));
      for (const g of got) { if (g.status !== 200) { bad++; lastBad = g.status; } else rows.push(...g.rows); }
    }
    if (first.length > 0 && bad === first.length) { out.set("prices", fail(pbase, lastBad, granted !== null)); return; }
    const partial = products.length > first.length || (out.get("products")?.truncated ?? false);
    out.set("prices", { ...pbase, count: rows.length, truncated: partial, rows: rows.slice(0, ROW_CAP), note: partial ? `Counted for the first ${first.length} products only (one request per product).` : null });
  })());

  await Promise.all(tasks);
  return MC_KEYS.map((k) => out.get(k) ?? blank(k, k, []));
}

/** Clearly labelled SAMPLE data, used only for the demo company and the ?pmfx screens. Never mixed with real rows. */
export function sampleChecks(): McChecks {
  const now = Date.UTC(2026, 10, 14);
  const raw = [
    { _id: "i1", name: "Roof repair deposit", status: "sent", total: 1200, amountDue: 1200, currency: "USD", dueDate: "2026-11-30T00:00:00Z", invoiceNumber: "INV-1001", contactDetails: { name: "Dana Ortiz" } },
    { _id: "i2", name: "Spring clean-up", status: "sent", total: 450, amountDue: 450, currency: "USD", dueDate: "2026-11-02T00:00:00Z", invoiceNumber: "INV-1002", contactDetails: { name: "Ken Mills" } },
    { _id: "i3", name: "Whitening package", status: "partially_paid", total: 800, amountDue: 300, currency: "USD", dueDate: "2026-12-05T00:00:00Z", invoiceNumber: "INV-1003", contactDetails: { name: "Ivo Petrov" } },
    { _id: "i4", name: "Consult fee", status: "paid", total: 150, amountDue: 0, currency: "USD", dueDate: "2026-10-20T00:00:00Z", invoiceNumber: "INV-1004", contactDetails: { name: "Rae Chen" } },
    { _id: "i5", name: "Solar survey", status: "paid", total: 600, amountDue: 0, currency: "USD", dueDate: "2026-10-01T00:00:00Z", invoiceNumber: "INV-1005", contactDetails: { name: "Mia Costa" } },
    { _id: "i6", name: "New client proposal", status: "draft", total: 2200, amountDue: 2200, currency: "USD", dueDate: "2026-12-20T00:00:00Z", invoiceNumber: "INV-1006", contactDetails: { name: "Sam Lee" } },
    { _id: "i7", name: "Duplicate invoice", status: "void", total: 300, amountDue: 0, currency: "USD", dueDate: "2026-10-10T00:00:00Z", invoiceNumber: "INV-1007", contactDetails: { name: "Ken Mills" } },
  ];
  const inv = raw.map((x) => normalInvoice(x, now)).filter((x): x is McRow => !!x);
  const sec = (key: McKey, label: string, scopes: string[], o: Partial<McSection>): McSection => ({ ...blank(key, label, scopes), ...o });
  const rows = (title: string[], o: Partial<McRow> = {}): McRow[] => title.map((t, i) => ({ id: `${t}-${i}`, title: t, sub: null, amount: null, currency: null, status: null, bucket: null, date: "2026-11-05", ...o }));
  return {
    account: { id: "sample-account", name: "Sample Roofing" }, sample: true, unitsNote: UNITS_NOTE,
    sections: [
      sec("invoices", "Invoices", ["invoices.readonly"], { count: inv.length, rows: inv, buckets: countInvoices(inv), note: "Overdue means sent or partly paid with a due date that has passed. Each invoice is in one group only." }),
      sec("schedules", "Invoice schedules", ["invoices/schedule.readonly"], { count: 2, rows: rows(["Monthly retainer", "Quarterly service"]) }),
      sec("templates", "Invoice templates", ["invoices/template.readonly"], { count: 3, rows: rows(["Standard job", "Deposit", "Final payment"]) }),
      sec("estimates", "Estimates", ["invoices/estimate.readonly"], { count: 3, rows: rows(["Gutter replacement", "Full roof"], { amount: 5400, currency: "USD", status: "sent" }), buckets: [{ key: "sent", label: "Sent", count: 2, money: [{ currency: "USD", amount: 10800 }], amountLabel: "total" }, { key: "accepted", label: "Accepted", count: 1, money: [{ currency: "USD", amount: 900 }], amountLabel: "total" }], note: "Status words are the platform's own." }),
      sec("orders", "Recent orders", ["payments/orders.readonly"], { count: 2, rows: rows(["Gutter guard kit", "Seasonal plan"], { amount: 240, currency: "USD", status: "succeeded" }), note: "The newest 25 orders. Open a person in a list to see their own orders." }),
      sec("coupons", "Coupons", ["payments/coupons.readonly"], { count: 2, rows: rows(["Spring special", "Referral"], { status: "Active", sub: "SPRING10 · 10% off" }) }),
      sec("providers", "Payment provider", ["payments/integration.readonly", "payments/custom-provider.readonly"], { count: 1, connected: true, rows: rows(["Sample Pay"], { sub: "Custom payment provider", status: "Connected", date: null }), note: `Only custom payment providers are reported. ${NOT_AVAILABLE}: whether Stripe, PayPal or another built-in provider is connected.` }),
      sec("products", "Products", ["products.readonly"], { count: 2, rows: rows(["Roof inspection", "Gutter cleaning"], { sub: "DIGITAL" }) }),
      sec("prices", "Prices", ["products/prices.readonly"], { count: 3, rows: rows(["Roof inspection - Standard", "Gutter cleaning - One visit", "Gutter cleaning - Yearly"], { amount: 120, currency: "USD", sub: "One time" }) }),
      sec("collections", "Product collections", ["products/collection.readonly"], { count: 1, rows: rows(["Seasonal services"]) }),
      sec("charges", "Charges made by apps", ["charges.readonly"], { count: 2, rows: rows(["Charge made by an app"], { amount: 11.5, currency: "USD", status: "Charged", sub: "usage · 1 unit" }), buckets: [{ key: "charged", label: "Charged to this account", count: 2, money: [{ currency: "USD", amount: 23 }], amountLabel: "total" }], note: "Charges made to this account by apps from the marketplace." }),
    ],
  };
}
