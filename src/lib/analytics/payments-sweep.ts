import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { getCompanyAccessToken } from "../ghl/installations";
import { locationAccessToken } from "../sync/engine";
import { refreshClientBilling } from "./clients3-billing";
import { mapStatus, monthlyOf, planPrice, normalInvoice, normalSubscription, normalTransaction, problemOf, todayIn, type Normal } from "./payments-logic";
import type { PmKind } from "./payments-types";

// Payments sweep (hourly, behind pm_module). READ ONLY. For every client account it reads the platform's transactions, subscriptions and invoices with that account's own key, keeps the
// CURRENT state in pm_items, and writes every status change into pm_events (append-only, our own history: the platform shows only the current state).
//   - Incremental: only rows created since the last good run minus 7 days (the overlap catches late changes), 100 per page, 120 ms between calls, resumable: when a run stops at its page cap the
//     next one carries on from the same offset (pm_sync_state.rows_seen) instead of starting again.
//   - Open invoices are always re-read by status (they change after they were created) and any flagged invoice not seen is read one by one (capped), so a paid invoice is never left "late".
//   - Test-mode rows are kept but marked live_mode = false and never counted unless asked. Status words the platform does not document are stored raw (and listed by scripts/pm-status-probe.ts).
//   - Amounts are stored exactly as the platform sends them (unit_check = 'assumed_major': the platform does not say whether it sends whole units or cents; see docs/DECISIONS.md).
//   - Our own writes never change these numbers: this file never writes to the CRM.

export type Resp = { status: number; body: unknown };
export type PmGetter = (path: string) => Promise<Resp>;
export type SweepDeps = { token?: (companyKey: string, locationId: string) => Promise<string>; get?: (token: string) => PmGetter; companyGet?: () => Promise<PmGetter | null>; pace?: number; skipPlans?: boolean };
export type SweepReport = { accounts: number; items: number; events: number; failed: number };

const PAGE = 100, MAX_PAGES = 50, OVERLAP_DAYS = 7, FIRST_RUN_DAYS = 90, SINGLE_CAP = 25;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object") c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };
const numOf = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

const defaultGet = (token: string): PmGetter => async (path) => {
  const res = await ghlFetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
};

type Resource = "transactions" | "subscriptions" | "invoices";
const listPath = (r: Resource, loc: string, offset: number, startAt: string | null, status: string | null): string => {
  const q = new URLSearchParams({ altId: loc, altType: "location", limit: String(PAGE), offset: String(offset) });
  if (startAt) q.set("startAt", startAt);
  if (status) q.set("status", status);
  return r === "invoices" ? `/invoices/?${q}` : `/payments/${r}?${q}`;
};
const listOf = (r: Resource, body: unknown): unknown[] => { const l = r === "invoices" ? dig(body, "invoices") : dig(body, "data"); return Array.isArray(l) ? l : []; };
const normalOf = (r: Resource, raw: unknown): Normal | null => (r === "transactions" ? normalTransaction(raw) : r === "subscriptions" ? normalSubscription(raw) : normalInvoice(raw));

type Row = { installation_id: string; location_id: string; kind: PmKind; item_id: string; status_raw: string | null; status_mapped: string; problem_kind: string | null; amount: number | null; amount_refunded: number | null; currency: string | null; due_date: string | null; contact_id: string | null; contact_name: string | null; contact_email: string | null; plan_name: string | null; source_name: string | null; live_mode: boolean; occurred_at: string | null; problem_since: string | null };

async function upsert(inst: string, rows: Row[], events: Array<{ loc: string; kind: PmKind; id: string; from: string | null; to: string; amount: number | null; currency: string | null; at: string }>): Promise<void> {
  if (!rows.length) return;
  const db = sql();
  const cols = ["installation_id", "location_id", "kind", "item_id", "status_raw", "status_mapped", "problem_kind", "amount", "amount_refunded", "currency", "due_date", "contact_id", "contact_name", "contact_email", "plan_name", "source_name", "live_mode", "occurred_at", "problem_since"] as const;
  for (let i = 0; i < rows.length; i += 200) {
    await db`insert into pm_items ${db(rows.slice(i, i + 200) as never, ...cols)}
      on conflict (installation_id, location_id, kind, item_id) do update set
        status_raw = excluded.status_raw, status_mapped = excluded.status_mapped, problem_kind = coalesce(excluded.problem_kind, pm_items.problem_kind),
        amount = excluded.amount, amount_refunded = excluded.amount_refunded, currency = excluded.currency, due_date = excluded.due_date,
        contact_id = coalesce(excluded.contact_id, pm_items.contact_id), contact_name = coalesce(excluded.contact_name, pm_items.contact_name), contact_email = coalesce(excluded.contact_email, pm_items.contact_email),
        plan_name = coalesce(excluded.plan_name, pm_items.plan_name), source_name = coalesce(excluded.source_name, pm_items.source_name), live_mode = excluded.live_mode, last_seen = now(),
        problem_since = case when excluded.kind = 'transaction' then coalesce(pm_items.problem_since, excluded.problem_since)
                             when excluded.problem_kind is null then pm_items.problem_since
                             when pm_items.problem_kind is null or pm_items.resolved_at is not null then excluded.problem_since
                             else coalesce(pm_items.problem_since, excluded.problem_since) end,
        resolved_at = case when excluded.kind = 'transaction' then pm_items.resolved_at
                           when excluded.problem_kind is not null then null
                           when pm_items.problem_kind is not null and pm_items.resolved_at is null then now()
                           else pm_items.resolved_at end`;
  }
  for (let i = 0; i < events.length; i += 200) {
    const part = events.slice(i, i + 200).map((e) => ({ installation_id: inst, location_id: e.loc, kind: e.kind, item_id: e.id, from_status: e.from, to_status: e.to, amount: e.amount, currency: e.currency, occurred_at: e.at }));
    await db`insert into pm_events ${db(part as never, "installation_id", "location_id", "kind", "item_id", "from_status", "to_status", "amount", "currency", "occurred_at")} on conflict do nothing`;
  }
}

/** Turn normalised platform rows into stored rows and the events for what changed since we last saw each one. Returns the number of rows written. */
async function ingest(inst: string, loc: string, tz: string | null, list: Normal[], now: number): Promise<{ rows: number; events: number }> {
  if (!list.length) return { rows: 0, events: 0 };
  const db = sql(), today = todayIn(tz, now);
  const before = new Map<string, { status: string | null; late: boolean }>();
  for (let i = 0; i < list.length; i += 500) {
    const ids = list.slice(i, i + 500).map((n) => n.itemId);
    const had = await db`select kind, item_id, status_raw, problem_kind, resolved_at from pm_items where installation_id = ${inst} and location_id = ${loc} and item_id = any(${ids}::text[])`;
    for (const h of had) before.set(`${h.kind}:${h.item_id}`, { status: (h.status_raw as string | null) ?? null, late: h.problem_kind === "late_invoice" && h.resolved_at === null });
  }
  const rows: Row[] = [], events: Parameters<typeof upsert>[2] = [];
  const iso = new Date(now).toISOString();
  for (const n of list) {
    const p = problemOf(n, today);
    const since = p ? (n.kind === "transaction" ? n.occurredAt ?? iso : p === "late_invoice" && n.dueDate ? new Date(n.dueDate + "T00:00:00Z").toISOString() : iso) : null;
    rows.push({ installation_id: inst, location_id: loc, kind: n.kind, item_id: n.itemId, status_raw: n.statusRaw, status_mapped: n.mapped, problem_kind: p, amount: n.amount, amount_refunded: n.amountRefunded, currency: n.currency, due_date: n.dueDate, contact_id: n.contactId, contact_name: n.contactName, contact_email: n.contactEmail, plan_name: null, source_name: n.sourceName, live_mode: n.liveMode, occurred_at: n.occurredAt, problem_since: since });
    if (!n.liveMode) continue;
    const prev = before.get(`${n.kind}:${n.itemId}`);
    const to = n.statusRaw ?? n.mapped;
    if (!prev) events.push({ loc, kind: n.kind, id: n.itemId, from: null, to, amount: n.amount, currency: n.currency, at: n.occurredAt ?? iso });
    else if (prev.status !== n.statusRaw) events.push({ loc, kind: n.kind, id: n.itemId, from: prev.status, to, amount: n.amount, currency: n.currency, at: iso });
    if (p === "late_invoice" && !prev?.late && since) events.push({ loc, kind: "invoice", id: n.itemId, from: n.statusRaw, to: "late", amount: n.amount, currency: n.currency, at: since });
    if (n.mapped === "other" && n.statusRaw) console.warn("Payments: a status word the platform does not document", n.kind, n.statusRaw);
  }
  await upsert(inst, rows, events);
  return { rows: rows.length, events: events.length };
}

async function state(inst: string, loc: string, resource: Resource) {
  const r = await sql()`select cursor_at, rows_seen from pm_sync_state where installation_id = ${inst} and location_id = ${loc} and resource = ${resource}`;
  return { cursor: r[0]?.cursor_at ? new Date(r[0].cursor_at as string) : null, offset: Number(r[0]?.rows_seen ?? 0) };
}
async function save(inst: string, loc: string, resource: Resource, v: { cursor: Date | null; ok: boolean; http: number; error: string | null; offset: number }) {
  await sql()`insert into pm_sync_state (installation_id, location_id, resource, cursor_at, last_ok_at, last_http, last_error, rows_seen)
    values (${inst}, ${loc}, ${resource}, ${v.cursor}, ${v.ok ? new Date() : null}, ${v.http}, ${v.error}, ${v.offset})
    on conflict (installation_id, location_id, resource) do update set cursor_at = coalesce(${v.cursor}, pm_sync_state.cursor_at), last_ok_at = coalesce(excluded.last_ok_at, pm_sync_state.last_ok_at), last_http = excluded.last_http, last_error = excluded.last_error, rows_seen = excluded.rows_seen`;
}

async function readResource(inst: string, loc: string, tz: string | null, resource: Resource, get: PmGetter, now: number, pace: number): Promise<{ ok: boolean; items: number; events: number }> {
  const st = await state(inst, loc, resource);
  const base = st.cursor ?? new Date(now - FIRST_RUN_DAYS * 86_400_000);
  const startAt = new Date(base.getTime() - OVERLAP_DAYS * 86_400_000).toISOString().slice(0, 10);
  let offset = st.offset, items = 0, events = 0, http = 200, pages = 0, finished = false;
  // Open invoices change after they were created, so they are always read by status as well.
  const sweeps: Array<{ status: string | null; useStart: boolean; resumable: boolean }> = resource === "invoices"
    ? [{ status: "sent", useStart: false, resumable: false }, { status: "partially_paid", useStart: false, resumable: false }, { status: null, useStart: true, resumable: true }]
    : [{ status: null, useStart: true, resumable: true }];
  for (const s of sweeps) {
    let off = s.resumable ? offset : 0;
    for (; pages < MAX_PAGES * sweeps.length; pages++) {
      if (pages) await wait(pace);
      const r = await get(listPath(resource, loc, off, s.useStart ? startAt : null, s.status));
      http = r.status;
      if (r.status < 200 || r.status >= 300) { await save(inst, loc, resource, { cursor: null, ok: false, http, error: r.status === 401 || r.status === 403 ? "needs_permission" : "not_available", offset: st.offset }); return { ok: false, items, events }; }
      const list = listOf(resource, r.body).map((x) => normalOf(resource, x)).filter((x): x is Normal => x !== null);
      const w = await ingest(inst, loc, tz, list, now);
      items += w.rows; events += w.events;
      const total = numOf(dig(r.body, "totalCount")) ?? numOf(dig(r.body, "total"));
      off += listOf(resource, r.body).length;
      if (listOf(resource, r.body).length < PAGE || (total !== null && off >= total)) { if (s.resumable) finished = true; break; }
      if (pages + 1 >= MAX_PAGES * sweeps.length && s.resumable) { offset = off; break; }
    }
    if (!s.resumable) continue;
  }
  if (!finished) { await save(inst, loc, resource, { cursor: null, ok: true, http, error: null, offset }); return { ok: true, items, events }; }
  await save(inst, loc, resource, { cursor: new Date(now), ok: true, http, error: null, offset: 0 });
  return { ok: true, items, events };
}

/** A flagged invoice the lists did not return this run is read by itself (capped), so a paid invoice is never left showing as late. */
async function recheckFlaggedInvoices(inst: string, loc: string, tz: string | null, get: PmGetter, now: number, pace: number): Promise<number> {
  const stale = await sql()`select item_id from pm_items where installation_id = ${inst} and location_id = ${loc} and kind = 'invoice' and problem_kind = 'late_invoice' and resolved_at is null and last_seen < ${new Date(now - 30 * 60_000)} order by last_seen limit ${SINGLE_CAP}`;
  let n = 0;
  for (const s of stale) {
    await wait(pace);
    const r = await get(`/invoices/${encodeURIComponent(s.item_id as string)}?altId=${encodeURIComponent(loc)}&altType=location`);
    const one = normalInvoice(r.status === 200 ? r.body : null);
    if (one) n += (await ingest(inst, loc, tz, [one], now)).rows;
  }
  return n;
}

/** Client paid plans (money the agency earns): one row per account from the paid-plan list the Clients module already reads, with the plan price when the platform gives it. */
async function sweepPlans(inst: string, companyKey: string, now: number, deps: SweepDeps): Promise<{ rows: number; events: number }> {
  const db = sql();
  let companyGet: PmGetter | null = null;
  try { companyGet = deps.companyGet ? await deps.companyGet() : companyKey.startsWith("loc:") ? null : defaultGet(await getCompanyAccessToken(companyKey)); } catch { companyGet = null; }
  const fresh = await db`select 1 from client_billing where installation_id = ${inst} and fetched_at > now() - interval '45 minutes' limit 1`;
  if (!deps.skipPlans && !fresh.length) await refreshClientBilling(inst).catch(() => 0);
  const bill = await db`select b.location_id, b.state, b.plan_id, b.plan_name, b.subscription_status, coalesce(l.timezone, 'UTC') tz from client_billing b join locations l on l.installation_id = b.installation_id and l.location_id = b.location_id where b.installation_id = ${inst} and not l.ignored and b.state = 'ok'`;
  const price = new Map<string, ReturnType<typeof planPrice>>();
  for (const b of bill) {
    const pid = b.plan_id as string | null;
    if (!pid || price.has(pid) || !companyGet) continue;
    await wait(deps.pace ?? 120);
    const r = await companyGet(`/saas/saas-plan/${encodeURIComponent(pid)}?companyId=${encodeURIComponent(companyKey)}`).catch(() => ({ status: 0, body: null }));
    price.set(pid, r.status >= 200 && r.status < 300 ? planPrice(r.body) : { amount: null, currency: null, interval: null });
  }
  const list: Array<{ loc: string; n: Normal; plan: string | null }> = [];
  for (const b of bill) {
    const raw = (b.subscription_status as string | null) ?? null;
    const pr = price.get((b.plan_id as string | null) ?? "") ?? { amount: null, currency: null, interval: null };
    list.push({ loc: b.location_id as string, plan: (b.plan_name as string | null) ?? null, n: { kind: "plan", itemId: b.location_id as string, statusRaw: raw, mapped: mapStatus("plan", raw), amount: monthlyOf(pr.amount, pr.interval), amountRefunded: null, currency: pr.currency, dueDate: null, contactId: null, contactName: null, contactEmail: null, sourceName: pr.interval, liveMode: true, occurredAt: null } });
  }
  let rows = 0, events = 0;
  for (const x of list) {
    const r = await ingest(inst, x.loc, null, [x.n], now);
    rows += r.rows; events += r.events;
    if (x.plan) await db`update pm_items set plan_name = ${x.plan} where installation_id = ${inst} and location_id = ${x.loc} and kind = 'plan' and item_id = ${x.loc}`;
  }
  return { rows, events };
}

/** After the reads: failed payments that a later payment from the same person made good are marked fixed, ranks are refreshed, and the daily totals are rebuilt for the last 90 days. */
export async function finishPayments(inst: string): Promise<void> {
  const db = sql();
  await db`update pm_items f set resolved_at = r.at
    from (select f2.location_id, f2.item_id, (select min(p.occurred_at) from pm_items p where p.installation_id = f2.installation_id and p.location_id = f2.location_id and p.kind = 'transaction' and p.status_mapped = 'paid' and p.contact_id = f2.contact_id and p.currency is not distinct from f2.currency and p.occurred_at > f2.occurred_at) at
          from pm_items f2 where f2.installation_id = ${inst} and f2.kind = 'transaction' and f2.problem_kind = 'failed_payment' and f2.resolved_at is null and f2.contact_id is not null and f2.occurred_at is not null) r
    where f.installation_id = ${inst} and f.kind = 'transaction' and f.location_id = r.location_id and f.item_id = r.item_id and r.at is not null`;
  await db`insert into pm_events (installation_id, location_id, kind, item_id, from_status, to_status, amount, currency, occurred_at)
    select installation_id, location_id, kind, item_id, status_raw, 'recovered', amount, currency, resolved_at from pm_items where installation_id = ${inst} and kind = 'transaction' and problem_kind = 'failed_payment' and resolved_at is not null and live_mode on conflict do nothing`;
  await db`update pm_items set rank_score = round((case when amount > 0 then amount else 1 end * case
      when problem_since is null or now() - problem_since <= interval '3 days' then 1 when now() - problem_since <= interval '7 days' then 1.5 when now() - problem_since <= interval '14 days' then 2 when now() - problem_since <= interval '30 days' then 3 else 4 end)::numeric, 2)
    where installation_id = ${inst} and problem_kind is not null and resolved_at is null`;
  await db`insert into pm_rollup_daily (installation_id, location_id, day, currency, failed_count, failed_amount, late_count, late_amount, recovered_count, recovered_amount, refund_count, refund_amount)
    select ${inst}, location_id, d, cur,
      sum(f_c)::int, sum(f_a), sum(l_c)::int, sum(l_a), sum(r_c)::int, sum(r_a), sum(x_c)::int, sum(x_a)
    from (
      select location_id, (occurred_at at time zone 'UTC')::date d, coalesce(currency, '') cur, 1 f_c, coalesce(amount, 0) f_a, 0 l_c, 0 l_a, 0 r_c, 0 r_a, 0 x_c, 0 x_a from pm_items where installation_id = ${inst} and kind = 'transaction' and problem_kind = 'failed_payment' and live_mode and occurred_at >= now() - interval '90 days'
      union all select location_id, due_date, coalesce(currency, ''), 0, 0, 1, coalesce(amount, 0), 0, 0, 0, 0 from pm_items where installation_id = ${inst} and kind = 'invoice' and problem_kind = 'late_invoice' and live_mode and due_date >= (now() - interval '90 days')::date
      union all select location_id, (resolved_at at time zone 'UTC')::date, coalesce(currency, ''), 0, 0, 0, 0, 1, coalesce(amount, 0), 0, 0 from pm_items where installation_id = ${inst} and resolved_at is not null and problem_kind is not null and live_mode and resolved_at >= now() - interval '90 days'
      union all select location_id, (occurred_at at time zone 'UTC')::date, coalesce(currency, ''), 0, 0, 0, 0, 0, 0, 1, coalesce(amount_refunded, 0) from pm_items where installation_id = ${inst} and kind = 'transaction' and amount_refunded > 0 and live_mode and occurred_at >= now() - interval '90 days'
    ) t where d is not null group by location_id, d, cur
    on conflict (installation_id, location_id, day, currency) do update set failed_count = excluded.failed_count, failed_amount = excluded.failed_amount, late_count = excluded.late_count, late_amount = excluded.late_amount, recovered_count = excluded.recovered_count, recovered_amount = excluded.recovered_amount, refund_count = excluded.refund_count, refund_amount = excluded.refund_amount`;
}

/** One company's hourly Payments read. Every account is read on its own key; one account failing never stops the others. */
export async function sweepPayments(inst: string, now = Date.now(), deps: SweepDeps = {}): Promise<SweepReport> {
  const db = sql();
  const rep: SweepReport = { accounts: 0, items: 0, events: 0, failed: 0 };
  const co = await db`select company_id from installations where id = ${inst}`;
  const companyKey = co[0]?.company_id as string | undefined;
  if (!companyKey) return rep;
  const pace = deps.pace ?? 120;
  try { const p = await sweepPlans(inst, companyKey, now, deps); rep.items += p.rows; rep.events += p.events; } catch (e) { console.error("Payments: plans failed", e instanceof Error ? e.message : "error"); rep.failed++; }
  const accts = await db`select location_id, timezone from locations where installation_id = ${inst} and not ignored order by location_id`;
  for (const a of accts) {
    const loc = a.location_id as string, tz = (a.timezone as string | null) ?? null;
    rep.accounts++;
    let token: string;
    try { token = await (deps.token ?? locationAccessToken)(companyKey, loc); } catch { rep.failed++; await save(inst, loc, "transactions", { cursor: null, ok: false, http: 0, error: "no_token", offset: 0 }).catch(() => undefined); continue; }
    const get = (deps.get ?? defaultGet)(token);
    for (const res of ["transactions", "subscriptions", "invoices"] as const) {
      try { const r = await readResource(inst, loc, tz, res, get, now, pace); rep.items += r.items; rep.events += r.events; if (!r.ok) rep.failed++; } catch (e) { rep.failed++; console.error("Payments: read failed", res, e instanceof Error ? e.message : "error"); }
    }
    await recheckFlaggedInvoices(inst, loc, tz, get, now, pace).catch(() => 0);
  }
  await finishPayments(inst);
  return rep;
}
