import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { ageBucket, ageDays, csvCell, daysUntil, decodeCursor, disputeAlert, encodeCursor, headlineWords, nextStepWords, priorityOf, reasonWords, reminderTexts, riskFormula, todayIn, totalsByCurrency } from "./payments-logic";
import { PM_SCOPES, PROBLEM_LABEL } from "./payments-types";
import type { PmAgeBucket, PmDispute, PmDisputes, PmHistory, PmItem, PmKind, PmMoney, PmNote, PmOptions, PmProblem, PmQueue, PmRow, PmSetup, PmSource, PmToday, PmTile, PmUpcoming } from "./payments-types";

// The database side of Payments. READ ONLY here (writes are in payments-actions.ts). EVERY read starts from `accountsOf`: the client accounts of the caller's own installation, inside the caller's
// `allowed` set, narrowed by one optional account the route already checked with ownedLocation. Every later query filters by installation_id again. Nothing here echoes an id it did not find.
type Frag = import("postgres").PendingQuery<import("postgres").Row[]>;
export type Scope = { inst: string; allowed: string[] | null };
export type Links = { account: (loc: string) => string; contact: (loc: string, id: string) => string };
export type Filters = { location?: string | null; problem?: string | null; currency?: string | null; age?: string | null; min?: number | null; max?: number | null; status?: string | null; showTest?: boolean; q?: string | null; from?: string | null; to?: string | null };

export const paymentsCache = ttlCache<object>(30_000, 200);
export const forgetPayments = (inst: string) => paymentsCache.clear(JSON.stringify([inst]).slice(0, -1));
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type Acct = { id: string; name: string; tz: string | null };
/** The ONE place a scope becomes account ids. */
export async function accountsOf(s: Scope, one?: string | null): Promise<Acct[]> {
  if (s.allowed && s.allowed.length === 0) return [];
  const rows = await sql()`select location_id, coalesce(nullif(name, ''), 'Client account') name, timezone from locations where installation_id = ${s.inst} and not ignored
    ${s.allowed ? sql()`and location_id = any(${s.allowed}::text[])` : sql()``} ${one ? sql()`and location_id = ${one}` : sql()``} order by name, location_id`;
  return rows.map((r) => ({ id: r.location_id as string, name: r.name as string, tz: (r.timezone as string | null) ?? null }));
}

const PROBLEMS = new Set(["failed_payment", "late_invoice", "past_due_plan", "failed_subscription", "failed"]); // "refund" is answered by refundsQueue
const STATUSES = new Set(["open", "contacted", "snoozed", "dismissed", "all"]);
const BUCKET: Record<string, [number, number]> = { "0-3": [0, 3], "4-7": [4, 7], "8-14": [8, 14], "15-30": [15, 30], "31+": [31, 100000] };

/** The shared conditions of the queue, the tiles and the export (alias i = pm_items, n = the latest actions on the item). */
function conds(f: Filters, ids: string[]): Frag {
  const db = sql();
  const parts: Frag[] = [db`i.location_id = any(${ids}::text[])`];
  if (f.problem && PROBLEMS.has(f.problem)) parts.push(f.problem === "failed" ? db`i.problem_kind in ('failed_payment', 'failed_subscription')` : db`i.problem_kind = ${f.problem}`);
  if (f.currency && /^[A-Za-z]{3}$/.test(f.currency)) parts.push(db`i.currency = ${f.currency.toUpperCase()}`);
  if (f.age && BUCKET[f.age]) parts.push(db`floor(extract(epoch from (now() - coalesce(i.problem_since, now()))) / 86400) between ${BUCKET[f.age][0]} and ${BUCKET[f.age][1]}`);
  if (f.min !== null && f.min !== undefined && Number.isFinite(f.min)) parts.push(db`i.amount >= ${f.min}`);
  if (f.max !== null && f.max !== undefined && Number.isFinite(f.max)) parts.push(db`i.amount <= ${f.max}`);
  if (!f.showTest) parts.push(db`i.live_mode`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) parts.push(db`i.problem_since >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) parts.push(db`i.problem_since < (${f.to}::date + 1)`);
  const q = (f.q ?? "").trim().slice(0, 60);
  if (q) { const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; parts.push(db`(i.contact_name ilike ${like} or i.contact_email ilike ${like})`); }
  const st = f.status && STATUSES.has(f.status) ? f.status : "open";
  if (st === "open") parts.push(db`n.dismissed_at is null and n.snoozed_until is null`);
  else if (st === "contacted") parts.push(db`n.dismissed_at is null and n.contacted_at is not null`);
  else if (st === "snoozed") parts.push(db`n.dismissed_at is null and n.snoozed_until is not null`);
  else if (st === "dismissed") parts.push(db`n.dismissed_at is not null`);
  return parts.reduce((a, b) => db`${a} and ${b}`);
}
const lateral = () => sql()`left join lateral (select
    (select max(at) from pm_notes x where x.installation_id = i.installation_id and x.location_id = i.location_id and x.kind = i.kind and x.item_id = i.item_id and x.action = 'dismiss') dismissed_at,
    (select max(until_at) from pm_notes x where x.installation_id = i.installation_id and x.location_id = i.location_id and x.kind = i.kind and x.item_id = i.item_id and x.action = 'snooze' and x.until_at > now()) snoozed_until,
    (select max(at) from pm_notes x where x.installation_id = i.installation_id and x.location_id = i.location_id and x.kind = i.kind and x.item_id = i.item_id and x.action = 'contacted') contacted_at) n on true`;

function rowOf(r: Record<string, unknown>, now: number, links: Links, nameOf: Map<string, string>): PmRow {
  const problem = r.problem_kind as PmProblem, since = iso(r.problem_since), days = ageDays(since, now), amount = nn(r.amount), loc = r.location_id as string, cid = (r.contact_id as string | null) ?? null;
  const rank = n(r.rank_score);
  const snoozed = r.snoozed_until ? iso(r.snoozed_until) : null;
  return {
    key: `${loc}:${r.kind}:${r.item_id}`, locationId: loc, accountName: nameOf.get(loc) ?? "Client account", kind: r.kind as PmKind, itemId: r.item_id as string, problem, problemLabel: PROBLEM_LABEL[problem],
    who: problem === "past_due_plan" ? (nameOf.get(loc) ?? null) : ((r.contact_name as string | null) ?? null), email: (r.contact_email as string | null) ?? null, contactId: cid, amount, currency: (r.currency as string | null) ?? null,
    ageDays: days, since, reason: reasonWords(problem, (r.status_raw as string | null) ?? null), next: nextStepWords(problem), priority: priorityOf(rank, days),
    status: snoozed ? "snoozed" : r.contacted_at ? "contacted" : "open", snoozedUntil: snoozed, liveMode: r.live_mode !== false,
    crmUrl: cid ? links.contact(loc, cid) : links.account(loc), planName: (r.plan_name as string | null) ?? null,
  };
}

/** The refunds of the last 30 days (the Refunds tile): payments that were paid and then partly or fully given back. Same days as the daily totals, so the count equals the rows. */
async function refundsQueue(s: Scope, f: Filters, cursor: string | null, size: number, links: Links, ids: string[], names: Map<string, string>, now: number): Promise<PmQueue> {
  const db = sql(), c = decodeCursor(cursor);
  const q = (f.q ?? "").trim().slice(0, 60), like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const base = db`i.installation_id = ${s.inst} and i.location_id = any(${ids}::text[]) and i.kind = 'transaction' and i.amount_refunded > 0 and (i.live_mode or ${!!f.showTest}) and (i.occurred_at at time zone 'UTC')::date >= (now() - interval '30 days')::date
    ${f.currency && /^[A-Za-z]{3}$/.test(f.currency) ? db`and i.currency = ${f.currency.toUpperCase()}` : db``} ${q ? db`and (i.contact_name ilike ${like} or i.contact_email ilike ${like})` : db``}`;
  const key = c ? db`and (extract(epoch from i.occurred_at) < ${c.r} or (extract(epoch from i.occurred_at) = ${c.r} and (i.location_id, i.kind, i.item_id) > (${c.l}, ${c.k}, ${c.i})))` : db``;
  const [rows, agg] = await Promise.all([
    db`select i.*, extract(epoch from i.occurred_at)::float8 ts from pm_items i where ${base} ${key} order by i.occurred_at desc, i.location_id, i.kind, i.item_id limit ${size + 1}`,
    db`select coalesce(i.currency, '') currency, count(*)::int c, coalesce(sum(i.amount_refunded), 0) a from pm_items i where ${base} group by 1 order by 3 desc`,
  ]);
  const page = rows.slice(0, size), last = page[page.length - 1];
  const out: PmRow[] = page.map((r) => {
    const loc = r.location_id as string, cid = (r.contact_id as string | null) ?? null, days = ageDays(iso(r.occurred_at), now);
    return { key: `${loc}:transaction:${r.item_id}`, locationId: loc, accountName: names.get(loc) ?? "Client account", kind: "transaction", itemId: r.item_id as string, problem: "refund", problemLabel: PROBLEM_LABEL.refund, who: (r.contact_name as string | null) ?? null, email: (r.contact_email as string | null) ?? null, contactId: cid,
      amount: nn(r.amount_refunded), currency: (r.currency as string | null) ?? null, ageDays: days, since: iso(r.occurred_at), reason: reasonWords("refund", null), next: nextStepWords("refund"), priority: "low", status: "open", snoozedUntil: null, liveMode: r.live_mode !== false, crmUrl: cid ? links.contact(loc, cid) : links.account(loc), planName: null };
  });
  const totals: PmMoney[] = agg.map((r) => ({ currency: r.currency as string, count: n(r.c), amount: n(r.a) }));
  return { rows: out, total: totals.reduce((a, t) => a + t.count, 0), next: rows.length > size && last ? encodeCursor({ r: Number(last.ts), l: last.location_id as string, k: last.kind as string, i: last.item_id as string }) : null, totals, truncated: false };
}

export async function queue(s: Scope, f: Filters, cursor: string | null, size: number, links: Links, now = Date.now()): Promise<PmQueue> {
  const accts = await accountsOf(s, f.location);
  if (!accts.length) return { rows: [], total: 0, next: null, totals: [], truncated: false };
  const ids = accts.map((a) => a.id), names = new Map(accts.map((a) => [a.id, a.name])), db = sql();
  if (f.problem === "refund") return refundsQueue(s, f, cursor, size, links, ids, names, now);
  const c = decodeCursor(cursor), where = conds(f, ids);
  const key = c ? db`and (i.rank_score < ${c.r} or (i.rank_score = ${c.r} and (i.location_id, i.kind, i.item_id) > (${c.l}, ${c.k}, ${c.i})))` : db``;
  const [rows, agg] = await Promise.all([
    db`select i.*, n.snoozed_until, n.contacted_at from pm_items i ${lateral()} where i.installation_id = ${s.inst} and i.problem_kind is not null and i.resolved_at is null and ${where} ${key}
       order by i.rank_score desc, i.location_id, i.kind, i.item_id limit ${size + 1}`,
    db`select coalesce(i.currency, '') currency, count(*)::int c, coalesce(sum(case when i.amount > 0 then i.amount else 0 end), 0) a from pm_items i ${lateral()} where i.installation_id = ${s.inst} and i.problem_kind is not null and i.resolved_at is null and ${where} group by 1 order by 3 desc`,
  ]);
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  const totals: PmMoney[] = agg.map((r) => ({ currency: r.currency as string, count: n(r.c), amount: n(r.a) }));
  return { rows: page.map((r) => rowOf(r, now, links, names)), total: totals.reduce((a, t) => a + t.count, 0), next: rows.length > size && last ? encodeCursor({ r: n(last.rank_score), l: last.location_id as string, k: last.kind as string, i: last.item_id as string }) : null, totals, truncated: false };
}

const SOURCE_LABEL = { plans: "Your clients' paid plans", transactions: "Payments", subscriptions: "Repeat payments", invoices: "Invoices" } as const;
export async function sources(s: Scope, ids: string[]): Promise<PmSource[]> {
  const db = sql();
  const [st, pl] = await Promise.all([
    db`select resource, bool_or(last_error is null and last_ok_at is not null) ok, bool_or(last_error = 'needs_permission') perm, bool_or(last_error is not null and last_error <> 'needs_permission') bad, max(last_ok_at) at from pm_sync_state where installation_id = ${s.inst} and location_id = any(${ids}::text[]) group by resource`,
    db`select count(*) filter (where state = 'ok')::int ok, count(*) filter (where state = 'needs_permission')::int perm, count(*) filter (where state = 'not_available')::int na, max(fetched_at) at from client_billing where installation_id = ${s.inst} and location_id = any(${ids}::text[])`,
  ]);
  const out: PmSource[] = [];
  const p = pl[0] ?? {};
  out.push({ key: "plans", label: SOURCE_LABEL.plans, scope: PM_SCOPES.plans, lastOkAt: iso(p.at), state: n(p.ok) > 0 ? "ok" : n(p.perm) > 0 ? "needs_permission" : n(p.na) > 0 ? "not_available" : "not_checked",
    message: n(p.ok) > 0 ? null : n(p.perm) > 0 ? "Needs permission: reconnect" : n(p.na) > 0 ? "Not available from the platform yet" : "Not checked yet" });
  for (const key of ["transactions", "subscriptions", "invoices"] as const) {
    const r = st.find((x) => x.resource === key);
    const state: PmSource["state"] = !r ? "not_checked" : r.ok ? "ok" : r.perm ? "needs_permission" : r.bad ? "not_available" : "not_checked";
    out.push({ key, label: SOURCE_LABEL[key], scope: PM_SCOPES[key], state, lastOkAt: iso(r?.at), message: state === "ok" ? null : state === "needs_permission" ? "Needs permission: reconnect" : state === "not_available" ? "Not available from the platform yet" : "Not checked yet" });
  }
  return out;
}

export async function today(s: Scope, f: Filters): Promise<PmToday> {
  const accts = await accountsOf(s, f.location);
  const empty: PmToday = { headline: "No client accounts yet.", button: null, tiles: [], atRisk: [], recoveredLast30: [], avgDaysToRecover: null, recoveryRate: null, historyStarts: null, sources: [], accounts: 0, testRowsHidden: 0, setupNote: null, expectedMonthly: [] };
  if (!accts.length) return empty;
  const ids = accts.map((a) => a.id), db = sql();
  const where = conds({ ...f, problem: null, status: "open" }, ids);
  const [grp, recent, disp, hist, plans, src, testRows, live] = await Promise.all([
    db`select i.problem_kind, coalesce(i.currency, '') currency, count(*)::int c, coalesce(sum(case when i.amount > 0 then i.amount else 0 end), 0) a, count(distinct i.location_id)::int accts
       from pm_items i ${lateral()} where i.installation_id = ${s.inst} and i.problem_kind is not null and i.resolved_at is null and ${where} group by 1, 2`,
    db`select coalesce(currency, '') currency, sum(recovered_count)::int rc, sum(recovered_amount) ra, sum(refund_count)::int fc, sum(refund_amount) fa from pm_rollup_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= (now() - interval '30 days')::date group by 1`,
    db`select coalesce(currency, '') currency, count(*)::int c, coalesce(sum(amount), 0) a from pm_disputes where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and status = 'open' group by 1`,
    db`select (select min(observed_at) from pm_events where installation_id = ${s.inst} and location_id = any(${ids}::text[])) first_at,
        (select count(*) from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and problem_since is not null and live_mode and problem_since >= now() - interval '90 days')::int flagged,
        (select count(*) from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and problem_since is not null and resolved_at is not null and live_mode and problem_since >= now() - interval '90 days')::int fixed,
        (select avg(extract(epoch from (resolved_at - problem_since)) / 86400) from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and resolved_at is not null and problem_since is not null and live_mode and resolved_at >= now() - interval '90 days') avg_days`,
    db`select coalesce(currency, '') currency, count(*)::int c, coalesce(sum(amount), 0) a from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and kind = 'plan' and status_mapped = 'active' and amount is not null group by 1`,
    sources(s, ids),
    db`select count(*)::int c from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and problem_kind is not null and resolved_at is null and not live_mode`,
    db`select count(*)::int c from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and kind <> 'plan' and live_mode`,
  ]);
  const sum = (kinds: string[]): PmMoney[] => { const m = new Map<string, PmMoney>(); for (const g of grp) if (kinds.includes(g.problem_kind as string)) { const e = m.get(g.currency as string) ?? { currency: g.currency as string, count: 0, amount: 0 }; e.count += n(g.c); e.amount += n(g.a); m.set(g.currency as string, e); } return [...m.values()]; };
  const cnt = (m: PmMoney[]) => m.reduce((a, x) => a + x.count, 0);
  const failed = sum(["failed_payment", "failed_subscription"]), late = sum(["late_invoice"]), pastDue = sum(["past_due_plan"]);
  const refunds: PmMoney[] = recent.filter((r) => n(r.fc) > 0).map((r) => ({ currency: r.currency as string, count: n(r.fc), amount: n(r.fa) }));
  const disputes: PmMoney[] = disp.map((r) => ({ currency: r.currency as string, count: n(r.c), amount: n(r.a) }));
  const tiles: PmTile[] = [
    { key: "failed", label: "Failed payments", count: cnt(failed), money: failed, note: null, filter: { problem: "failed" } },
    { key: "late", label: "Late invoices", count: cnt(late), money: late, note: null, filter: { problem: "late_invoice" } },
    { key: "past_due_plans", label: "Past due plans", count: cnt(pastDue), money: pastDue, note: "Money your clients owe you for the plan you sell them.", filter: { problem: "past_due_plan" } },
    { key: "disputes", label: "Open payment disputes", count: cnt(disputes), money: disputes, note: "Entered by you; not read from your payment processor.", filter: { disputes: true } },
    { key: "refunds", label: "Refunds, last 30 days", count: cnt(refunds), money: refunds, note: null, filter: { problem: "refund" } },
  ];
  const need = cnt(failed) + cnt(late) + cnt(pastDue);
  const accountsWith = Math.max(0, ...grp.map((g) => n(g.accts)));
  const byCur = new Map<string, { f: number; l: number; p: number; amt: number }>();
  for (const g of grp) { const e = byCur.get(g.currency as string) ?? { f: 0, l: 0, p: 0, amt: 0 }; const k = g.problem_kind as string; if (k === "late_invoice") e.l += n(g.c); else if (k === "past_due_plan") e.p += n(g.c); else e.f += n(g.c); e.amt += n(g.a); byCur.set(g.currency as string, e); }
  const atRisk = [...byCur.entries()].map(([currency, e]) => ({ currency, amount: Math.round(e.amt * 100) / 100, count: e.f + e.l + e.p, formula: riskFormula({ failed: e.f, late: e.l, plans: e.p }) })).sort((a, b) => b.amount - a.amount);
  const h = hist[0] ?? {};
  const noLive = n(live[0]?.c) === 0 && src.some((x) => x.state === "ok");
  return {
    headline: headlineWords({ needAction: need, accountsWithProblems: accountsWith }), button: need > 0 ? { label: "Review them", count: need } : null, tiles, atRisk,
    recoveredLast30: recent.filter((r) => n(r.rc) > 0).map((r) => ({ currency: r.currency as string, count: n(r.rc), amount: n(r.ra) })),
    avgDaysToRecover: h.avg_days !== null && h.avg_days !== undefined ? Math.round(Number(h.avg_days) * 10) / 10 : null, recoveryRate: n(h.flagged) > 0 ? Math.round((n(h.fixed) / n(h.flagged)) * 100) : null,
    historyStarts: h.first_at ? iso(h.first_at)!.slice(0, 10) : null, sources: src, accounts: accts.length, testRowsHidden: n(testRows[0]?.c),
    setupNote: noLive ? "No live payments were found in your accounts yet. Check that your payment processor is connected and not in test mode." : null,
    expectedMonthly: plans.map((p) => ({ currency: p.currency as string, amount: Math.round(n(p.a) * 100) / 100, count: n(p.c), formula: `Estimate: plan price per month times ${n(p.c)} paying client account${n(p.c) === 1 ? "" : "s"}. The platform does not give billing days.` })),
  };
}

export async function item(s: Scope, loc: string, kind: string, id: string, links: Links, brand: string | null, resendOn: boolean, now = Date.now()): Promise<PmItem | null> {
  if (!["transaction", "invoice", "subscription", "plan"].includes(kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const accts = await accountsOf(s, loc);
  if (!accts.length) return null;
  const db = sql(), names = new Map(accts.map((a) => [a.id, a.name]));
  const r = await db`select i.*, n.snoozed_until, n.contacted_at from pm_items i ${lateral()} where i.installation_id = ${s.inst} and i.location_id = ${loc} and i.kind = ${kind} and i.item_id = ${id} and i.problem_kind is not null`;
  if (!r.length) return null;
  const row = rowOf(r[0], now, links, names);
  const [ev, nt] = await Promise.all([
    db`select to_status, from_status, amount, currency, occurred_at from pm_events where installation_id = ${s.inst} and location_id = ${loc} and kind = ${kind} and item_id = ${id} order by occurred_at, observed_at limit 100`,
    db`select id, action, reason, note, until_at, by_name, at from pm_notes where installation_id = ${s.inst} and location_id = ${loc} and kind = ${kind} and item_id = ${id} order by at desc limit 50`,
  ]);
  const what = kind === "invoice" ? "invoice" : kind === "plan" ? "plan" : "payment";
  const notes: PmNote[] = nt.map((x) => ({ id: x.id as string, action: x.action as PmNote["action"], reason: (x.reason as string | null) ?? null, note: (x.note as string | null) ?? null, until: iso(x.until_at), by: (x.by_name as string | null) ?? null, at: iso(x.at)! }));
  return {
    row, events: ev.map((x) => ({ at: iso(x.occurred_at)!, status: x.to_status as string, from: (x.from_status as string | null) ?? null, amount: nn(x.amount), currency: (x.currency as string | null) ?? null })), notes,
    messages: reminderTexts({ name: row.who, amount: row.amount, currency: row.currency, what, business: brand }), canResend: resendOn && kind === "invoice" && !!row.contactId,
    resendNote: resendOn ? "Sends the invoice again to the customer. You will see exactly who gets it first." : "",
  };
}

export async function disputes(s: Scope, f: { location?: string | null; status?: string | null }, now = Date.now()): Promise<PmDisputes> {
  const accts = await accountsOf(s, f.location);
  const label = "Entered by you; not read from your payment processor.";
  if (!accts.length) return { rows: [], total: 0, open: 0, due: 0, label };
  const ids = accts.map((a) => a.id), by = new Map(accts.map((a) => [a.id, a]));
  const st = f.status && ["open", "evidence_sent", "won", "lost"].includes(f.status) ? f.status : null;
  const rows = await sql()`select * from pm_disputes where installation_id = ${s.inst} and location_id = any(${ids}::text[]) ${st ? sql()`and status = ${st}` : sql()``} order by (status in ('won', 'lost')), evidence_due_on nulls last, opened_on desc limit 500`;
  const out: PmDispute[] = rows.map((r) => {
    const a = by.get(r.location_id as string), today = todayIn(a?.tz, now), due = r.evidence_due_on ? String(r.evidence_due_on instanceof Date ? r.evidence_due_on.toISOString() : r.evidence_due_on).slice(0, 10) : null;
    const left = daysUntil(due, today);
    return { id: r.id as string, locationId: r.location_id as string, accountName: a?.name ?? "Client account", customer: r.customer as string, amount: nn(r.amount), currency: (r.currency as string | null) ?? null, reason: (r.reason as string | null) ?? null,
      openedOn: String(r.opened_on instanceof Date ? r.opened_on.toISOString() : r.opened_on).slice(0, 10), evidenceDueOn: due, status: r.status as PmDispute["status"], processorUrl: (r.processor_url as string | null) ?? null, notes: (r.notes as string | null) ?? null,
      daysLeft: left, alert: disputeAlert(r.status as string, left), updatedAt: iso(r.updated_at)! };
  });
  return { rows: out, total: out.length, open: out.filter((d) => d.status === "open").length, due: out.filter((d) => d.alert !== null).length, label };
}

/** Disputes whose evidence date is within 3 days or past, for the daily brief and the in-app alert (one list per installation, every account the caller may see). */
export async function disputesDue(s: Scope, now = Date.now()): Promise<PmDispute[]> {
  return (await disputes(s, {}, now)).rows.filter((d) => d.alert !== null);
}

export async function upcoming(s: Scope, f: Filters): Promise<PmUpcoming> {
  const accts = await accountsOf(s, f.location);
  const ids = accts.map((a) => a.id), src = ids.length ? await sources(s, ids) : [];
  const plans = ids.length ? await sql()`select coalesce(currency, '') currency, count(*)::int c, coalesce(sum(amount), 0) a, count(*) filter (where amount is null)::int unknown from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and kind = 'plan' and status_mapped = 'active' group by 1` : [];
  const priced = plans.filter((p) => n(p.a) > 0);
  const ps = src.find((x) => x.key === "plans");
  return {
    plans: {
      state: ps?.state ?? "not_checked",
      items: priced.map((p) => ({ currency: p.currency as string, amount: Math.round(n(p.a) * 100) / 100, count: n(p.c), accounts: n(p.c), formula: "Estimate: plan price per month times paying client accounts. The platform does not give billing days." })),
      note: priced.length ? "About this much a month from your clients (estimate). The platform does not tell us the day each client is charged." : ps?.state === "needs_permission" ? "Needs permission: reconnect" : "Not available from the platform yet: the price of the plans you sell.",
    },
    customers: { available: false, note: "Not available from the platform yet: the date of the next repeat payment for your clients' customers." },
    missing: ["Next charge date of a paid plan", "Why a payment failed", "Retrying a card from SubSync", "A link for the customer to update their card", "Payment disputes from your processor"],
  };
}

export async function history(s: Scope, f: Filters): Promise<PmHistory> {
  const accts = await accountsOf(s, f.location);
  const empty: PmHistory = { historyStarts: null, days: [], repeat: [], avgDaysToRecover: null, recoveryRate: null, recovered: [], flagged: 0, fixed: 0 };
  if (!accts.length) return empty;
  const ids = accts.map((a) => a.id), names = new Map(accts.map((a) => [a.id, a.name])), db = sql();
  const [days, rep, st, first, rec] = await Promise.all([
    db`select day, sum(failed_count)::int f, sum(recovered_count)::int r, sum(late_count)::int l from pm_rollup_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= (now() - interval '90 days')::date group by day order by day`,
    db`select location_id, coalesce(max(contact_name), 'A customer') who, count(*)::int c from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and kind <> 'plan' and problem_since is not null and live_mode and problem_since >= now() - interval '180 days' and contact_id is not null group by location_id, contact_id having count(*) >= 2 order by 3 desc, 1 limit 20`,
    db`select count(*) filter (where problem_since >= now() - interval '90 days')::int flagged, count(*) filter (where resolved_at is not null and problem_since >= now() - interval '90 days')::int fixed, avg(extract(epoch from (resolved_at - problem_since)) / 86400) filter (where resolved_at is not null and problem_since >= now() - interval '90 days') avg_days from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and problem_since is not null and live_mode`,
    db`select min(observed_at) at from pm_events where installation_id = ${s.inst} and location_id = any(${ids}::text[])`,
    db`select coalesce(currency, '') currency, sum(recovered_count)::int c, sum(recovered_amount) a from pm_rollup_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= (now() - interval '90 days')::date group by 1 having sum(recovered_count) > 0`,
  ]);
  const t = st[0] ?? {};
  return {
    historyStarts: first[0]?.at ? iso(first[0].at)!.slice(0, 10) : null,
    days: days.map((d) => ({ day: String(d.day instanceof Date ? d.day.toISOString() : d.day).slice(0, 10), failed: n(d.f), recovered: n(d.r), late: n(d.l) })),
    repeat: rep.map((r) => ({ locationId: r.location_id as string, accountName: names.get(r.location_id as string) ?? "Client account", who: r.who as string, count: n(r.c) })),
    avgDaysToRecover: t.avg_days !== null && t.avg_days !== undefined ? Math.round(Number(t.avg_days) * 10) / 10 : null, recoveryRate: n(t.flagged) > 0 ? Math.round((n(t.fixed) / n(t.flagged)) * 100) : null,
    recovered: rec.map((r) => ({ currency: r.currency as string, count: n(r.c), amount: n(r.a) })), flagged: n(t.flagged), fixed: n(t.fixed),
  };
}

export async function options(s: Scope, flags: Record<string, boolean>): Promise<PmOptions> {
  const accts = await accountsOf(s, null), ids = accts.map((a) => a.id);
  const cur = ids.length ? await sql()`select distinct currency from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and currency is not null order by 1 limit 20` : [];
  const last = ids.length ? await sql()`select max(last_ok_at) at from pm_sync_state where installation_id = ${s.inst} and location_id = any(${ids}::text[])` : [];
  return { accounts: accts.map((a) => ({ id: a.id, name: a.name })), currencies: cur.map((c) => c.currency as string), flags, roleLevel: "agency", lastSync: iso(last[0]?.at) };
}

export async function setup(s: Scope): Promise<PmSetup> {
  const accts = await accountsOf(s, null), ids = accts.map((a) => a.id);
  const src = ids.length ? await sources(s, ids) : [];
  const db = sql();
  const c = ids.length ? (await db`select count(*) filter (where kind <> 'plan' and live_mode)::int live, count(*) filter (where kind <> 'plan' and not live_mode)::int test, count(*) filter (where kind = 'plan')::int plans from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[])`)[0] : { live: 0, test: 0, plans: 0 };
  const odd = ids.length ? await db`select kind, status_raw, count(*)::int c from pm_items where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and status_mapped = 'other' and status_raw is not null group by 1, 2 order by 3 desc limit 10` : [];
  const checks = [
    { key: "live", title: "Live payments found", ok: n(c.live) > 0, detail: n(c.live) > 0 ? `${n(c.live)} payments, invoices and repeat payments read.` : n(c.test) > 0 ? `Only test payments were found (${n(c.test)}). Switch your payment processor to live mode.` : "None found yet. Either nothing has been paid, the payment permissions are missing, or your processor is not connected." },
    { key: "plans", title: "Plans you sell to your clients", ok: n(c.plans) > 0, detail: n(c.plans) > 0 ? `${n(c.plans)} client accounts are on a paid plan from you.` : "None found. If you sell paid plans to your clients, check that this is switched on in your CRM." },
    { key: "words", title: "Status words we do not recognise", ok: odd.length === 0, detail: odd.length === 0 ? "Every status word was understood." : `Shown as "other": ${odd.map((o) => `${o.status_raw} (${o.c})`).join(", ")}.` },
  ];
  return { sources: src, checks, scopes: Object.values(PM_SCOPES).filter((x) => x !== PM_SCOPES.wallet && x !== PM_SCOPES.installer) };
}

export async function exportCsv(s: Scope, f: Filters, links: Links, now = Date.now()): Promise<string> {
  const head = ["Account", "Type", "Who", "Email", "Amount", "Currency", "Days", "Status", "Why", "Open in your CRM"];
  const lines = [head.map(csvCell).join(",")];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = await queue(s, f, cursor, 250, links, now);
    for (const r of q.rows) lines.push([r.accountName, r.problemLabel, r.who, r.email, r.amount, r.currency, r.ageDays, r.status, r.reason, r.crmUrl].map(csvCell).join(","));
    cursor = q.next;
    if (!cursor) break;
  }
  return lines.join("\r\n") + "\r\n";
}

export type { PmAgeBucket };
export { ageBucket, totalsByCurrency };
