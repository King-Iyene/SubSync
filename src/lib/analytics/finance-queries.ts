import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { planOf, type BillingRow } from "./clients2-core";
import { ownersOf } from "./clients-actions-queries";
import { isVertical, VERTICAL_LABEL } from "./moat-core";
import {
  addDays, avgDealOf, churnOf, cleanAmount, cleanCurrency, cplOf, daysBetween, decodeKey, encodeKey, factOf, headlineOf, isDay, isMonth, monthlyFrom, pageDesc, playbookOf, roasOf, snapMrr, spendInRange, totalsOf, trendOf,
  waterfallOf, winRateOf, bucketOf, DAY, CHURN_BASE_DAYS, CHURN_RECENT_DAYS, type ChurnLevel, type EnteredPrice, type Evidence, type LedgerBucket, type LedgerStatus, type Money, type Move, type MoveKind, type PayBasis,
  type PlanFact, type PlaybookStep, type RevenueRow, type SnapRow,
} from "./finance-core";

// Finance reads and writes. Read only against the CRM copies; every write is to SubSync's own fn_* tables. EVERY query starts from the caller's scope (installation + allowed accounts, decided from the
// signed session by the router) and filters by installation_id again. An id from a request is checked by the route first (ownedLocation / ownedUser) and never echoed back.

export type Scope = { inst: string; allowed: string[] | null };
export type Links = { account: (loc: string) => string };
export type Range = { from: string; to: string }; // inclusive days (YYYY-MM-DD)

export const financeCache = ttlCache<object>(60_000, 100);
export const forgetFinance = (inst: string) => financeCache.clear(JSON.stringify([inst]).slice(0, -1));
export const tablesMissing = (e: unknown) => { const x = e as { code?: string; message?: string } | null; return x?.code === "42P01" || /relation "(public\.)?fn_[a-z_]+" does not exist/i.test(String(x?.message ?? "")); };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const cleanId = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// ---------- settings ----------

export type FnSettings = { payoutBasis: PayBasis; currency: string; dealWindowDays: number; saved: boolean };
export async function getSettings(inst: string): Promise<FnSettings> {
  const r = await sql()`select payout_basis, currency, deal_window_days from fn_settings where installation_id = ${inst}`;
  return r[0] ? { payoutBasis: r[0].payout_basis as PayBasis, currency: r[0].currency as string, dealWindowDays: Number(r[0].deal_window_days), saved: true } : { payoutBasis: "won", currency: "USD", dealWindowDays: 30, saved: false };
}
export async function saveSettings(inst: string, body: Record<string, unknown>, actor: string | null): Promise<{ ok: true; value: FnSettings } | { ok: false; error: string }> {
  const cur = await getSettings(inst);
  const basis = body.payoutBasis === undefined ? cur.payoutBasis : body.payoutBasis;
  if (basis !== "booked" && basis !== "showed" && basis !== "won") return { ok: false, error: "Choose booked, showed or won" };
  const currency = body.currency === undefined ? cur.currency : cleanCurrency(body.currency);
  if (!currency) return { ok: false, error: "Use a three letter currency code, like USD" };
  const days = body.dealWindowDays === undefined ? cur.dealWindowDays : Number(body.dealWindowDays);
  if (!Number.isInteger(days) || days < 7 || days > 180) return { ok: false, error: "The days between an appointment and a win must be 7 to 180" };
  await sql()`insert into fn_settings (installation_id, payout_basis, currency, deal_window_days, updated_by) values (${inst}, ${basis}, ${currency}, ${days}, ${actor})
    on conflict (installation_id) do update set payout_basis = excluded.payout_basis, currency = excluded.currency, deal_window_days = excluded.deal_window_days, updated_by = excluded.updated_by, updated_at = now()`;
  forgetFinance(inst);
  return { ok: true, value: { payoutBasis: basis, currency, dealWindowDays: days, saved: true } };
}

// ---------- the account list with plan facts ----------

export type Acct = {
  id: string; name: string; vertical: string | null; verticalLabel: string | null;
  plan: { id: string | null; name: string | null; pay: string; payLabel: string; monthly: number | null; currency: string | null; since: string | null; state: string };
  fact: PlanFact; url: string | null;
};

async function enteredPrices(inst: string): Promise<Map<string, EnteredPrice>> {
  const rows = await sql()`select plan_key, amount, currency, billing_interval from fn_plan_prices where installation_id = ${inst}`.catch(() => []);
  return new Map(rows.map((r) => [r.plan_key as string, { planKey: r.plan_key as string, amount: Number(r.amount), currency: r.currency as string, billingInterval: r.billing_interval as "month" | "year" }]));
}

/** Every client account the caller may read, with its plan facts and kind of business. Cached a minute. */
export async function accounts(s: Scope, links?: Links, now = Date.now()): Promise<Acct[]> {
  const key = JSON.stringify([s.inst, "accts", s.allowed]);
  const hit = financeCache.get(key) as Acct[] | undefined;
  if (hit) return hit;
  if (s.allowed && s.allowed.length === 0) return [];
  const db = sql();
  const where = db`l.installation_id = ${s.inst} and not l.ignored ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``}`;
  let rows: Record<string, unknown>[];
  try {
    rows = await db`select l.location_id, coalesce(nullif(l.name, ''), 'Client account') name, ap.vertical, b.state, b.plan_id, b.plan_name, b.subscription_status, b.price_amount, b.price_currency, b.billing_interval, b.status_since, b.http_status, b.reason, b.fetched_at
      from locations l left join account_profiles ap on ap.installation_id = l.installation_id and ap.location_id = l.location_id
      left join client_billing b on b.installation_id = l.installation_id and b.location_id = l.location_id where ${where} order by lower(l.name) nulls last, l.location_id limit 5000`;
  } catch {
    rows = await db`select l.location_id, coalesce(nullif(l.name, ''), 'Client account') name, ap.vertical, b.state, b.plan_id, b.plan_name, b.subscription_status, b.fetched_at
      from locations l left join account_profiles ap on ap.installation_id = l.installation_id and ap.location_id = l.location_id
      left join client_billing b on b.installation_id = l.installation_id and b.location_id = l.location_id where ${where} order by lower(l.name) nulls last, l.location_id limit 5000`;
  }
  const entered = await enteredPrices(s.inst);
  const out: Acct[] = rows.map((r) => {
    const p = planOf(r.state === undefined || r.state === null ? undefined : (r as BillingRow), now);
    const v = (r.vertical as string | null) ?? null;
    const planId = (r.plan_id as string | null) ?? null, planName = (r.plan_name as string | null) ?? null;
    const fact = factOf({ locationId: r.location_id as string, planId, planName, pay: p.pay, monthly: p.monthly, currency: p.currency }, entered);
    return {
      id: r.location_id as string, name: r.name as string, vertical: v, verticalLabel: v && isVertical(v) ? VERTICAL_LABEL[v] : v,
      plan: { id: planId, name: planName, pay: p.pay, payLabel: p.payLabel, monthly: fact.monthly, currency: fact.currency, since: p.since, state: p.state }, fact, url: links ? links.account(r.location_id as string) : null,
    };
  });
  financeCache.set(key, out);
  return out;
}

const snapKeep = (a: Acct) => a.plan.state === "ok" || a.plan.state === "no_plan";

// ---------- overview ----------

type Series = Array<{ day: string; amount: number }>;
async function trendSeries(s: Scope, ids: string[], cur: string, r: Range): Promise<{ series: Series; startsOn: string | null }> {
  const db = sql();
  const [rows, first] = await Promise.all([
    db`select day::text d, coalesce(sum(monthly) filter (where pay = 'paid' and monthly is not null and coalesce(currency, 'USD') = ${cur}), 0)::float8 amt
       from fn_mrr_snapshot where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${r.from}::date and day <= ${r.to}::date group by 1 order by 1`,
    db`select min(day)::text d from fn_mrr_snapshot where installation_id = ${s.inst}`,
  ]);
  return { series: rows.map((x) => ({ day: x.d as string, amount: n(x.amt) })), startsOn: (first[0]?.d as string | null) ?? null };
}
async function snapshotRows(s: Scope, ids: string[], day: string): Promise<SnapRow[]> {
  const rows = await sql()`select location_id, day::text d, pay, monthly, currency from fn_mrr_snapshot where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day = ${day}::date`;
  return rows.map((x) => ({ locationId: x.location_id as string, day: x.d as string, pay: x.pay as string, monthly: x.monthly === null ? null : Number(x.monthly), currency: (x.currency as string | null) ?? null }));
}
async function ends(s: Scope, ids: string[], r: Range): Promise<{ a: string | null; b: string | null }> {
  const x = await sql()`select min(day)::text a, max(day)::text b from fn_mrr_snapshot where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${r.from}::date and day <= ${r.to}::date`;
  return { a: (x[0]?.a as string | null) ?? null, b: (x[0]?.b as string | null) ?? null };
}

export async function overview(s: Scope, r: Range, links: Links, now = Date.now()) {
  const accts = await accounts(s, links, now);
  const facts = accts.map((a) => a.fact);
  const t = totalsOf(facts);
  const primary = t.mrr[0]?.currency ?? t.atRisk[0]?.currency ?? null;
  const ids = accts.map((a) => a.id);
  const empty = { series: [] as Series, startsOn: null as string | null };
  const ts = primary && ids.length ? await trendSeries(s, ids, primary, r) : empty;
  const startsOn = ts.startsOn ?? (ids.length ? (await sql()`select min(day)::text d from fn_mrr_snapshot where installation_id = ${s.inst}`)[0]?.d ?? null : null);
  const trend = trendOf(ts.series, primary, startsOn);
  let wf = null as ReturnType<typeof waterfallOf>["w"] | null;
  if (primary && ids.length) {
    const e = await ends(s, ids, r);
    if (e.a && e.b) { const [a, b] = await Promise.all([snapshotRows(s, ids, e.a), snapshotRows(s, ids, e.b)]); wf = waterfallOf(a, b, primary, e.a, e.b, startsOn).w; }
    else wf = waterfallOf([], [], primary, r.from, r.from, startsOn).w;
  }
  const mix = new Map<string, { planKey: string; planName: string | null; accounts: number; monthly: number; currency: string | null; priced: number; source: string }>();
  for (const a of accts) {
    if (a.fact.pay !== "paid" && a.fact.pay !== "past_due") continue;
    const k = a.fact.planKey ?? "(no plan name)";
    const e = mix.get(k) ?? { planKey: k, planName: a.fact.planName, accounts: 0, monthly: 0, currency: a.fact.currency, priced: 0, source: a.fact.source };
    e.accounts++; if (a.fact.monthly !== null) { e.monthly += a.fact.monthly; e.priced++; }
    mix.set(k, e);
  }
  const byVertical = new Map<string, { key: string; label: string; accounts: number; monthly: number }>();
  for (const a of accts) {
    if (a.fact.pay !== "paid" || a.fact.monthly === null || (a.fact.currency ?? "USD") !== primary) continue;
    const k = a.vertical ?? "(none)";
    const e = byVertical.get(k) ?? { key: k, label: a.verticalLabel ?? "Kind of business not set", accounts: 0, monthly: 0 };
    e.accounts++; e.monthly += a.fact.monthly; byVertical.set(k, e);
  }
  const top = accts.filter((a) => a.fact.pay === "paid" && a.fact.monthly !== null && (a.fact.currency ?? "USD") === primary).sort((x, y) => (y.fact.monthly ?? 0) - (x.fact.monthly ?? 0) || (x.id < y.id ? -1 : 1)).slice(0, 8).map((a) => ({ locationId: a.id, name: a.name, monthly: a.fact.monthly as number, source: a.fact.source }));
  return {
    primaryCurrency: primary, totals: t, trend, waterfall: wf, range: r,
    planMix: [...mix.values()].map((m) => ({ ...m, monthly: Math.round(m.monthly * 100) / 100 })).sort((x, y) => y.accounts - x.accounts).slice(0, 20),
    verticals: [...byVertical.values()].map((v) => ({ ...v, monthly: Math.round(v.monthly * 100) / 100 })).sort((x, y) => y.monthly - x.monthly),
    topAccounts: top,
    unpaid: accts.filter((a) => a.fact.pay === "past_due" || a.fact.pay === "other").length,
  };
}

export async function movement(s: Scope, r: Range, kind: MoveKind | null, o: { cursor: string | null; size: number }, links: Links, now = Date.now()) {
  const accts = await accounts(s, links, now), ids = accts.map((a) => a.id);
  const t = totalsOf(accts.map((a) => a.fact));
  const primary = t.mrr[0]?.currency ?? t.atRisk[0]?.currency ?? null;
  if (!primary || !ids.length) return { rows: [] as Array<Move & { name: string; url: string | null }>, total: 0, next: null as string | null, from: null as string | null, to: null as string | null };
  const e = await ends(s, ids, r);
  if (!e.a || !e.b || e.a === e.b) return { rows: [], total: 0, next: null, from: e.a, to: e.b };
  const [a, b] = await Promise.all([snapshotRows(s, ids, e.a), snapshotRows(s, ids, e.b)]);
  const all = waterfallOf(a, b, primary, e.a, e.b, null).moves.filter((m) => !kind || m.kind === kind);
  const names = new Map(accts.map((x) => [x.id, x]));
  const page = pageDesc(all, (m) => Math.abs(m.delta), (m) => m.locationId, decodeKey(o.cursor), o.size);
  return { rows: page.rows.map((m) => ({ ...m, name: names.get(m.locationId)?.name ?? "Client account", url: names.get(m.locationId)?.url ?? null, currency: primary })), total: all.length, next: page.next, from: e.a, to: e.b };
}

// ---------- the daily money record (written by the daily check; idempotent) ----------

export async function recordSnapshot(inst: string, now = Date.now()): Promise<number> {
  const accts = await accounts({ inst, allowed: null }, undefined, now);
  const keep = accts.filter(snapKeep);
  if (!keep.length) return 0;
  const day = today(now), db = sql();
  let wrote = 0;
  for (let i = 0; i < keep.length; i += 200) {
    const chunk = keep.slice(i, i + 200);
    await db`insert into fn_mrr_snapshot (installation_id, location_id, day, plan_key, plan_name, pay, monthly, currency, source)
      select ${inst}, x.location_id, ${day}::date, x.plan_key, x.plan_name, x.pay, x.monthly, x.currency, x.source
      from jsonb_to_recordset(${db.json(chunk.map((a) => ({ location_id: a.id, plan_key: a.fact.planKey, plan_name: a.fact.planName, pay: a.fact.pay, monthly: a.fact.monthly, currency: a.fact.currency, source: a.fact.source })) as never)}::jsonb)
        as x(location_id text, plan_key text, plan_name text, pay text, monthly numeric, currency text, source text)
      on conflict (installation_id, location_id, day) do update set plan_key = excluded.plan_key, plan_name = excluded.plan_name, pay = excluded.pay, monthly = excluded.monthly, currency = excluded.currency, source = excluded.source, recorded_at = now()`;
    wrote += chunk.length;
  }
  return wrote;
}

// ---------- revenue per client ----------

export type RevFilters = { q: string | null; vertical: string | null; sort: "won" | "billed" | "pipeline" };
async function revenueRows(s: Scope, r: Range, links: Links, now: number): Promise<{ rows: RevenueRow[]; cur: string }> {
  const key = JSON.stringify([s.inst, "rev", s.allowed, r]);
  const hit = financeCache.get(key) as { rows: RevenueRow[]; cur: string } | undefined;
  if (hit) return hit;
  const accts = await accounts(s, links, now), ids = accts.map((a) => a.id);
  const cur = (await getSettings(s.inst)).currency;
  if (!ids.length) return { rows: [], cur };
  const db = sql();
  const toEx = addDays(r.to, 1);
  const [d, p, sp] = await Promise.all([
    db`select location_id, coalesce(sum(new_leads),0)::int nl, coalesce(sum(booked),0)::int bk, coalesce(sum(won),0)::int won, coalesce(sum(won_value),0)::float8 wv, coalesce(sum(lost),0)::int lost
       from client_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${r.from}::date and day <= ${r.to}::date group by 1`.catch(() => []),
    db`select location_id, count(*)::int c, coalesce(sum(monetary_value),0)::float8 v from cached_opportunities where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and status = 'open' and coalesce(monetary_value, 0) > 0 and assigned_to is not null group by 1`,
    db`select location_id, month::text m, amount::float8 a, currency from fn_ad_spend where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and month < ${toEx}::date and month >= (${r.from}::date - interval '31 days')`.catch(() => []),
  ]);
  const D = new Map(d.map((x) => [x.location_id as string, x])), P = new Map(p.map((x) => [x.location_id as string, x]));
  const S = new Map<string, Array<{ month: string; amount: number; currency: string }>>();
  for (const x of sp) { const a = S.get(x.location_id as string) ?? []; a.push({ month: x.m as string, amount: Number(x.a), currency: x.currency as string }); S.set(x.location_id as string, a); }
  const rows: RevenueRow[] = accts.map((a) => {
    const x = D.get(a.id), pp = P.get(a.id), spend = S.get(a.id);
    const won = n(x?.won), wv = n(x?.wv), lost = n(x?.lost), leads = n(x?.nl);
    const wr = winRateOf(won, lost);
    const spent = spend && spend.length ? spendInRange(spend, r.from, toEx) : null;
    const sCur = spend && spend.length ? spend[0].currency : null;
    return {
      locationId: a.id, name: a.name, vertical: a.vertical, verticalLabel: a.verticalLabel,
      billed: a.fact.monthly !== null && a.fact.pay === "paid" ? { amount: a.fact.monthly, currency: a.fact.currency ?? "USD" } : null, billedSource: a.fact.source, pay: a.fact.pay,
      newLeads: leads, booked: n(x?.bk), won, wonValue: wv, lost, pipelineValue: n(pp?.v), pipelineCount: n(pp?.c),
      avgDeal: avgDealOf(won, wv), winRate: wr.rate, winRateNote: wr.note,
      spend: spent !== null && spent > 0 ? spent : null, spendCurrency: sCur, cpl: cplOf(spent, leads), roas: sCur === cur ? roasOf(spent, wv) : null,
    };
  });
  const out = { rows, cur };
  financeCache.set(key, out);
  return out;
}

export async function revenue(s: Scope, r: Range, f: RevFilters, o: { cursor: string | null; size: number }, links: Links, now = Date.now()) {
  const { rows: all, cur } = await revenueRows(s, r, links, now);
  const q = (f.q ?? "").trim().toLowerCase();
  const rows = all.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!f.vertical || (f.vertical === "(none)" ? !x.vertical : x.vertical === f.vertical)));
  const sortKey = (x: RevenueRow) => (f.sort === "billed" ? x.billed?.amount ?? 0 : f.sort === "pipeline" ? x.pipelineValue : x.wonValue);
  const page = pageDesc(rows, sortKey, (x) => x.locationId, decodeKey(o.cursor), o.size);
  const won = rows.reduce((a, x) => a + x.won, 0), lost = rows.reduce((a, x) => a + x.lost, 0), wv = rows.reduce((a, x) => a + x.wonValue, 0), pv = rows.reduce((a, x) => a + x.pipelineValue, 0);
  const leads = rows.reduce((a, x) => a + x.newLeads, 0);
  const wr = winRateOf(won, lost);
  const withSpend = rows.filter((x) => x.spend !== null && x.spendCurrency === cur);
  const sp = withSpend.reduce((a, x) => a + (x.spend ?? 0), 0), spWon = withSpend.reduce((a, x) => a + x.wonValue, 0), spLeads = withSpend.reduce((a, x) => a + x.newLeads, 0);
  const vm = new Map<string, { key: string; label: string; accounts: number; won: number; wonValue: number; pipelineValue: number }>();
  for (const x of rows) {
    const k = x.vertical ?? "(none)", e = vm.get(k) ?? { key: k, label: x.verticalLabel ?? "Kind of business not set", accounts: 0, won: 0, wonValue: 0, pipelineValue: 0 };
    e.accounts++; e.won += x.won; e.wonValue += x.wonValue; e.pipelineValue += x.pipelineValue; vm.set(k, e);
  }
  const hasDaily = all.some((x) => x.newLeads + x.won + x.lost + x.booked > 0);
  return {
    rows: page.rows, total: rows.length, all: all.length, next: page.next, currency: cur, range: r, hasDaily,
    totals: { won, wonValue: Math.round(wv), pipelineValue: Math.round(pv), newLeads: leads, avgDeal: avgDealOf(won, wv), winRate: wr.rate, winRateNote: wr.note, spend: withSpend.length ? Math.round(sp) : null, spendAccounts: withSpend.length, cpl: cplOf(sp, spLeads), roas: roasOf(sp, spWon) },
    verticals: [...vm.values()].sort((a, b) => b.wonValue - a.wonValue).map((v) => ({ ...v, wonValue: Math.round(v.wonValue), pipelineValue: Math.round(v.pipelineValue) })),
    spendNote: withSpend.length === 0 ? "Not available from the platform yet. Ad spend is not in the CRM, so enter it per client account in Setup to see cost per lead and return on spend." : null,
  };
}

// ---------- churn watch ----------

export type ChurnRow = {
  locationId: string; name: string; url: string | null; vertical: string | null; verticalLabel: string | null;
  level: ChurnLevel; points: number; evidence: Evidence[]; playbook: PlaybookStep[]; mrr: Money | null; payLabel: string;
  owner: { userId: string | null; name: string | null; manager: string | null }; status: "open" | "working" | "saved" | "lost"; snoozedUntil: string | null; muted: boolean; note: string | null; historyDays: number;
};
export type ChurnFilters = { level: "high" | "watch" | "all" | null; status: string | null; showSnoozed: boolean; q: string | null };

async function churnAll(s: Scope, links: Links, now: number): Promise<ChurnRow[]> {
  const key = JSON.stringify([s.inst, "churn", s.allowed]);
  const hit = financeCache.get(key) as ChurnRow[] | undefined;
  if (hit) return hit;
  const accts = await accounts(s, links, now), ids = accts.map((a) => a.id);
  if (!ids.length) return [];
  const db = sql();
  const t0 = today(now), recentFrom = addDays(t0, -CHURN_RECENT_DAYS + 1), baseFrom = addDays(t0, -CHURN_RECENT_DAYS - CHURN_BASE_DAYS + 1), w1 = addDays(t0, -55), w2 = addDays(t0, -111);
  const [daily, speed, state, owners, names] = await Promise.all([
    db`select location_id,
        coalesce(sum(new_leads) filter (where day >= ${recentFrom}::date), 0)::int l_r, coalesce(sum(new_leads) filter (where day >= ${baseFrom}::date and day < ${recentFrom}::date), 0)::int l_b,
        coalesce(sum(booked) filter (where day >= ${recentFrom}::date), 0)::int b_r, coalesce(sum(booked) filter (where day >= ${baseFrom}::date and day < ${recentFrom}::date), 0)::int b_b,
        coalesce(sum(staff_messages) filter (where day >= ${recentFrom}::date), 0)::int s_r, coalesce(sum(staff_messages) filter (where day >= ${baseFrom}::date and day < ${recentFrom}::date), 0)::int s_b,
        coalesce(sum(won) filter (where day >= ${w1}::date), 0)::int w_r, coalesce(sum(won) filter (where day >= ${w2}::date and day < ${w1}::date), 0)::int w_p,
        (current_date - min(day))::int hist
       from client_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${w2}::date group by 1`.catch(() => []),
    db`select location_id,
        coalesce(sum(answered) filter (where day >= ${recentFrom}::date), 0)::int a_r, coalesce(sum(within_target) filter (where day >= ${recentFrom}::date), 0)::int t_r,
        coalesce(sum(answered) filter (where day >= ${baseFrom}::date and day < ${recentFrom}::date), 0)::int a_b, coalesce(sum(within_target) filter (where day >= ${baseFrom}::date and day < ${recentFrom}::date), 0)::int t_b
       from speed_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${baseFrom}::date group by 1`.catch(() => []),
    db`select location_id, owner_user_id, status, snoozed_until, muted, note from fn_churn_state where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.catch(() => []),
    ownersOf(s.inst, ids).catch(() => ({ ready: false, owners: {} as Record<string, string> })),
    nameMap(s.inst, null),
  ]);
  const D = new Map(daily.map((x) => [x.location_id as string, x])), Sp = new Map(speed.map((x) => [x.location_id as string, x])), St = new Map(state.map((x) => [x.location_id as string, x]));
  const rows: ChurnRow[] = accts.map((a) => {
    const d = D.get(a.id), sp = Sp.get(a.id), st = St.get(a.id);
    // Days of record: how long ago our daily record for this account began (capped by the window we read).
    const hist = d ? Math.min(n(d.hist), 112) : 0;
    const c = churnOf({
      plan: { pay: a.fact.pay, monthly: a.fact.monthly, currency: a.fact.currency }, historyDays: hist,
      leads: { recent: n(d?.l_r), base: n(d?.l_b) }, booked: { recent: n(d?.b_r), base: n(d?.b_b) }, staff: { recent: n(d?.s_r), base: n(d?.s_b) },
      reply: { recentAnswered: n(sp?.a_r), recentWithin: n(sp?.t_r), baseAnswered: n(sp?.a_b), baseWithin: n(sp?.t_b) }, wins: { recent56: n(d?.w_r), prior56: n(d?.w_p) },
    });
    const ownerId = (st?.owner_user_id as string | null) ?? null;
    return {
      locationId: a.id, name: a.name, url: a.url, vertical: a.vertical, verticalLabel: a.verticalLabel, level: c.level, points: c.points, evidence: c.evidence, playbook: playbookOf(c.evidence), mrr: c.mrr, payLabel: a.plan.payLabel,
      owner: { userId: ownerId, name: ownerId ? names.get(ownerId) ?? null : null, manager: owners.owners[a.id] ?? null },
      status: ((st?.status as string | undefined) ?? "open") as ChurnRow["status"], snoozedUntil: iso(st?.snoozed_until), muted: st?.muted === true, note: (st?.note as string | null) ?? null, historyDays: hist,
    };
  });
  financeCache.set(key, rows);
  return rows;
}

const snoozed = (r: ChurnRow, now: number) => r.muted || (r.snoozedUntil !== null && Date.parse(r.snoozedUntil) > now);
export async function churn(s: Scope, f: ChurnFilters, o: { cursor: string | null; size: number }, links: Links, now = Date.now()) {
  const all = await churnAll(s, links, now);
  const q = (f.q ?? "").trim().toLowerCase();
  const listed = all.filter((r) => r.level === "high" || r.level === "watch");
  const counts = { high: listed.filter((r) => r.level === "high" && !snoozed(r, now)).length, watch: listed.filter((r) => r.level === "watch" && !snoozed(r, now)).length, snoozed: listed.filter((r) => snoozed(r, now)).length, left: all.filter((r) => r.level === "left").length, notEnough: all.filter((r) => r.level === "not_enough_data").length, steady: all.filter((r) => r.level === "steady").length, all: all.length };
  const pick = all.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (f.level === "all") { /* every account, scored */ } else if (f.level === "high" ? r.level !== "high" : f.level === "watch" ? r.level !== "watch" : r.level !== "high" && r.level !== "watch") return false;
    if (f.status && r.status !== f.status) return false;
    return f.showSnoozed ? snoozed(r, now) : !snoozed(r, now);
  });
  const key = (r: ChurnRow) => r.points * 1e9 + (r.mrr?.amount ?? 0);
  const page = pageDesc(pick, key, (r) => r.locationId, decodeKey(o.cursor), o.size);
  const mrrAt = (lv: ChurnLevel) => { const m = new Map<string, number>(); for (const r of listed) if (r.level === lv && !snoozed(r, now) && r.mrr) m.set(r.mrr.currency, (m.get(r.mrr.currency) ?? 0) + r.mrr.amount); return [...m.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount); };
  return { rows: page.rows, total: pick.length, next: page.next, counts, mrrAtRisk: [...mrrAt("high"), ...mrrAt("watch")].reduce<Array<{ currency: string; amount: number }>>((a, x) => { const e = a.find((y) => y.currency === x.currency); if (e) e.amount += x.amount; else a.push({ ...x }); return a; }, []), historyNote: counts.notEnough > 0 ? `${counts.notEnough} ${counts.notEnough === 1 ? "account has" : "accounts have"} under ${28} days of record, so the activity checks wait for more days.` : null };
}

export type ChurnEdit = { status?: string; owner?: string | null; snoozeDays?: number; muted?: boolean; note?: string | null };
export async function saveChurn(inst: string, loc: string, e: ChurnEdit, actor: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = sql();
  const cur = (await db`select owner_user_id, status, snoozed_until, muted, note from fn_churn_state where installation_id = ${inst} and location_id = ${loc}`)[0];
  const status = e.status === undefined ? (cur?.status as string | undefined) ?? "open" : e.status;
  if (!["open", "working", "saved", "lost"].includes(status)) return { ok: false, error: "Choose open, working, saved or lost" };
  let snoozedUntil: Date | null = cur?.snoozed_until ? new Date(cur.snoozed_until as Date) : null;
  if (e.snoozeDays !== undefined) { const d = Number(e.snoozeDays); if (!Number.isInteger(d) || d < 0 || d > 90) return { ok: false, error: "Snooze for 0 to 90 days" }; snoozedUntil = d === 0 ? null : new Date(Date.now() + d * DAY); }
  const note = e.note === undefined ? (cur?.note as string | null | undefined) ?? null : (typeof e.note === "string" ? e.note.trim().slice(0, 1000) || null : null);
  const owner = e.owner === undefined ? (cur?.owner_user_id as string | null | undefined) ?? null : e.owner;
  const muted = e.muted === undefined ? cur?.muted === true : e.muted === true;
  await db`insert into fn_churn_state (installation_id, location_id, owner_user_id, status, snoozed_until, muted, note, updated_by) values (${inst}, ${loc}, ${owner}, ${status}, ${snoozedUntil}, ${muted}, ${note}, ${actor})
    on conflict (installation_id, location_id) do update set owner_user_id = excluded.owner_user_id, status = excluded.status, snoozed_until = excluded.snoozed_until, muted = excluded.muted, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`;
  forgetFinance(inst);
  return { ok: true };
}

// ---------- people names ----------

export async function nameMap(inst: string, ids: string[] | null): Promise<Map<string, string>> {
  const db = sql();
  const rows = await db`select m.user_id, coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') nm from team_members m left join team_names tn on tn.installation_id = m.installation_id and tn.user_id = m.user_id
    where m.installation_id = ${inst} ${ids ? db`and m.user_id = any(${ids}::text[])` : db``} limit 5000`.catch(() => []);
  return new Map(rows.filter((r) => r.nm).map((r) => [r.user_id as string, r.nm as string]));
}

// ---------- billing notes (the ledger) ----------

export type LedgerRow = { id: string; locationId: string; account: string; label: string; amount: number; currency: string; dueOn: string; status: LedgerStatus; paidOn: string | null; remindOn: string | null; note: string | null; bucket: LedgerBucket; createdAt: string };
const ledgerOf = (r: Record<string, unknown>, t: string): LedgerRow => ({
  id: r.id as string, locationId: r.location_id as string, account: (r.name as string | null) ?? "Client account", label: r.label as string, amount: Number(r.amount), currency: r.currency as string, dueOn: r.due_on as string,
  status: r.status as LedgerStatus, paidOn: (r.paid_on as string | null) ?? null, remindOn: (r.remind_on as string | null) ?? null, note: (r.note as string | null) ?? null, bucket: bucketOf(r.status as LedgerStatus, r.due_on as string, t), createdAt: iso(r.created_at) as string,
});
export type LedgerFilters = { bucket: LedgerBucket | "all" | null; location: string | null; q: string | null };

export async function ledger(s: Scope, f: LedgerFilters, o: { cursor: string | null; size: number }, now = Date.now()) {
  const db = sql();
  const t = today(now), soon = addDays(t, 7);
  if (s.allowed && s.allowed.length === 0) return { rows: [] as LedgerRow[], total: 0, next: null as string | null, counts: { overdue: 0, due_soon: 0, upcoming: 0, paid: 0 }, owed: [] as Money[], overdue: [] as Money[], reminders: 0 };
  const scope = db`g.installation_id = ${s.inst} ${s.allowed ? db`and g.location_id = any(${s.allowed}::text[])` : db``}`;
  const bucketSql = f.bucket === "overdue" ? db`and g.status = 'unpaid' and g.due_on < ${t}::date` : f.bucket === "due_soon" ? db`and g.status = 'unpaid' and g.due_on >= ${t}::date and g.due_on <= ${soon}::date` : f.bucket === "upcoming" ? db`and g.status = 'unpaid' and g.due_on > ${soon}::date` : f.bucket === "paid" ? db`and g.status = 'paid'` : db``;
  const q = (f.q ?? "").trim().slice(0, 60);
  const where = db`${scope} ${bucketSql} ${f.location ? db`and g.location_id = ${f.location}` : db``} ${q ? db`and (g.label ilike ${like(q)} or l.name ilike ${like(q)})` : db``}`;
  const cur = decodeKey(o.cursor);
  const [rows, cnt, owed, over] = await Promise.all([
    db`select g.*, l.name, g.due_on::text due_on, g.paid_on::text paid_on, g.remind_on::text remind_on from fn_ledger g left join locations l on l.installation_id = g.installation_id and l.location_id = g.location_id
       where ${where} ${cur ? db`and (g.due_on, g.id::text) > (${String(cur.k)}::date, ${cur.id}::text)` : db``} order by g.due_on, g.id limit ${o.size + 1}`,
    db`select count(*) filter (where g.status = 'unpaid' and g.due_on < ${t}::date)::int overdue, count(*) filter (where g.status = 'unpaid' and g.due_on >= ${t}::date and g.due_on <= ${soon}::date)::int due_soon,
        count(*) filter (where g.status = 'unpaid' and g.due_on > ${soon}::date)::int upcoming, count(*) filter (where g.status = 'paid')::int paid, count(*)::int total
       from fn_ledger g left join locations l on l.installation_id = g.installation_id and l.location_id = g.location_id where ${scope}`,
    db`select currency, coalesce(sum(amount), 0)::float8 a from fn_ledger g where ${scope} and g.status = 'unpaid' group by 1 order by 2 desc`,
    db`select currency, coalesce(sum(amount), 0)::float8 a from fn_ledger g where ${scope} and g.status = 'unpaid' and g.due_on < ${t}::date group by 1 order by 2 desc`,
  ]);
  const page = rows.slice(0, o.size).map((r) => ledgerOf(r, t));
  const last = page[page.length - 1];
  const total = f.bucket === "overdue" ? n(cnt[0]?.overdue) : f.bucket === "due_soon" ? n(cnt[0]?.due_soon) : f.bucket === "upcoming" ? n(cnt[0]?.upcoming) : f.bucket === "paid" ? n(cnt[0]?.paid) : n(cnt[0]?.total);
  const reminderRows = await db`select count(*)::int c from fn_ledger g where ${scope} and g.status = 'unpaid' and (g.due_on <= ${soon}::date or (g.remind_on is not null and g.remind_on <= ${t}::date))`;
  return {
    rows: page, total, next: rows.length > o.size && last ? encodeKey({ k: last.dueOn, id: last.id }) : null,
    counts: { overdue: n(cnt[0]?.overdue), due_soon: n(cnt[0]?.due_soon), upcoming: n(cnt[0]?.upcoming), paid: n(cnt[0]?.paid) },
    owed: owed.map((x) => ({ currency: x.currency as string, amount: Math.round(n(x.a) * 100) / 100 })), overdue: over.map((x) => ({ currency: x.currency as string, amount: Math.round(n(x.a) * 100) / 100 })), reminders: n(reminderRows[0]?.c),
  };
}

export type LedgerInput = { label: string; amount: number; currency: string; dueOn: string; remindOn: string | null; note: string | null };
export function checkLedger(b: Record<string, unknown>): { ok: true; value: LedgerInput } | { ok: false; error: string } {
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 120) : "";
  if (!label) return { ok: false, error: "Write what this is for, like “March retainer”" };
  const amount = cleanAmount(b.amount);
  if (amount === null) return { ok: false, error: "Enter the amount as a number" };
  const currency = cleanCurrency(b.currency ?? "USD");
  if (!currency) return { ok: false, error: "Use a three letter currency code, like USD" };
  if (!isDay(b.dueOn)) return { ok: false, error: "Choose the due date" };
  const remindOn = b.remindOn === undefined || b.remindOn === null || b.remindOn === "" ? null : b.remindOn;
  if (remindOn !== null && !isDay(remindOn)) return { ok: false, error: "Choose a reminder date" };
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) || null : null;
  return { ok: true, value: { label, amount, currency, dueOn: b.dueOn as string, remindOn: remindOn as string | null, note } };
}
export async function addLedger(inst: string, loc: string, v: LedgerInput, actor: string | null): Promise<string> {
  const r = await sql()`insert into fn_ledger (installation_id, location_id, label, amount, currency, due_on, remind_on, note, created_by) values (${inst}, ${loc}, ${v.label}, ${v.amount}, ${v.currency}, ${v.dueOn}::date, ${v.remindOn}::date, ${v.note}, ${actor}) returning id`;
  forgetFinance(inst);
  return r[0].id as string;
}
const UUID = /^[0-9a-f-]{36}$/i;
export async function ledgerOwn(inst: string, allowed: string[] | null, id: unknown): Promise<{ id: string; locationId: string; label: string } | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const r = await sql()`select id, location_id, label from fn_ledger where installation_id = ${inst} and id = ${id}::uuid ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``}`;
  return r[0] ? { id: r[0].id as string, locationId: r[0].location_id as string, label: r[0].label as string } : null;
}
export async function editLedger(inst: string, id: string, v: LedgerInput): Promise<void> {
  await sql()`update fn_ledger set label = ${v.label}, amount = ${v.amount}, currency = ${v.currency}, due_on = ${v.dueOn}::date, remind_on = ${v.remindOn}::date, note = ${v.note}, updated_at = now() where installation_id = ${inst} and id = ${id}::uuid`;
  forgetFinance(inst);
}
export async function markLedger(inst: string, id: string, paid: boolean, now = Date.now()): Promise<void> {
  await sql()`update fn_ledger set status = ${paid ? "paid" : "unpaid"}, paid_on = ${paid ? today(now) : null}::date, updated_at = now() where installation_id = ${inst} and id = ${id}::uuid`;
  forgetFinance(inst);
}
export async function removeLedger(inst: string, id: string): Promise<void> {
  await sql()`delete from fn_ledger where installation_id = ${inst} and id = ${id}::uuid`;
  forgetFinance(inst);
}

// ---------- setup: plan prices, ad spend, rates ----------

export async function setup(s: Scope, links: Links, now = Date.now()) {
  const accts = await accounts(s, links, now), db = sql();
  const [entered, spend, settings] = await Promise.all([
    db`select plan_key, plan_name, amount::float8 amount, currency, billing_interval from fn_plan_prices where installation_id = ${s.inst} order by lower(coalesce(plan_name, plan_key))`,
    db`select s.location_id, l.name, s.month::text month, s.amount::float8 amount, s.currency from fn_ad_spend s left join locations l on l.installation_id = s.installation_id and l.location_id = s.location_id
       where s.installation_id = ${s.inst} ${s.allowed ? db`and s.location_id = any(${s.allowed}::text[])` : db``} order by s.month desc, lower(l.name) limit 200`,
    getSettings(s.inst),
  ]);
  const plans = new Map<string, { planKey: string; planName: string | null; accounts: number; platformPrice: number | null; currency: string | null }>();
  for (const a of accts) {
    if (!a.fact.planKey) continue;
    const e = plans.get(a.fact.planKey) ?? { planKey: a.fact.planKey, planName: a.fact.planName, accounts: 0, platformPrice: null, currency: null };
    e.accounts++; if (a.fact.source === "platform" && a.fact.monthly !== null) { e.platformPrice = a.fact.monthly; e.currency = a.fact.currency; }
    plans.set(a.fact.planKey, e);
  }
  const E = new Map(entered.map((x) => [x.plan_key as string, x]));
  return {
    settings, plans: [...plans.values()].sort((a, b) => b.accounts - a.accounts).map((p) => ({ ...p, entered: E.get(p.planKey) ? { amount: Number(E.get(p.planKey)?.amount), currency: E.get(p.planKey)?.currency as string, billingInterval: E.get(p.planKey)?.billing_interval as string } : null })),
    spend: spend.map((x) => ({ locationId: x.location_id as string, account: (x.name as string | null) ?? "Client account", month: (x.month as string).slice(0, 7), amount: Number(x.amount), currency: x.currency as string })),
    accounts: accts.length,
  };
}
export async function savePlanPrice(inst: string, b: Record<string, unknown>, actor: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = typeof b.planKey === "string" ? b.planKey.trim().slice(0, 120) : "";
  if (!key) return { ok: false, error: "Choose a plan" };
  const amount = cleanAmount(b.amount), currency = cleanCurrency(b.currency ?? "USD"), bi = b.billingInterval === "year" ? "year" : b.billingInterval === "month" || b.billingInterval === undefined ? "month" : null;
  if (amount === null) return { ok: false, error: "Enter the price as a number" };
  if (!currency) return { ok: false, error: "Use a three letter currency code, like USD" };
  if (!bi) return { ok: false, error: "Choose month or year" };
  const name = typeof b.planName === "string" ? b.planName.trim().slice(0, 120) || null : null;
  await sql()`insert into fn_plan_prices (installation_id, plan_key, plan_name, amount, currency, billing_interval, updated_by) values (${inst}, ${key}, ${name}, ${amount}, ${currency}, ${bi}, ${actor})
    on conflict (installation_id, plan_key) do update set plan_name = excluded.plan_name, amount = excluded.amount, currency = excluded.currency, billing_interval = excluded.billing_interval, updated_by = excluded.updated_by, updated_at = now()`;
  forgetFinance(inst);
  return { ok: true };
}
export async function removePlanPrice(inst: string, key: string): Promise<boolean> {
  const r = await sql()`delete from fn_plan_prices where installation_id = ${inst} and plan_key = ${key} returning plan_key`;
  forgetFinance(inst);
  return r.length > 0;
}
export async function saveSpend(inst: string, loc: string, b: Record<string, unknown>, actor: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isMonth(b.month)) return { ok: false, error: "Choose the month" };
  const amount = cleanAmount(b.amount), currency = cleanCurrency(b.currency ?? "USD");
  if (amount === null) return { ok: false, error: "Enter the amount as a number" };
  if (!currency) return { ok: false, error: "Use a three letter currency code, like USD" };
  await sql()`insert into fn_ad_spend (installation_id, location_id, month, amount, currency, updated_by) values (${inst}, ${loc}, ${`${b.month}-01`}::date, ${amount}, ${currency}, ${actor})
    on conflict (installation_id, location_id, month) do update set amount = excluded.amount, currency = excluded.currency, updated_by = excluded.updated_by, updated_at = now()`;
  forgetFinance(inst);
  return { ok: true };
}
export async function removeSpend(inst: string, loc: string, month: string): Promise<boolean> {
  if (!isMonth(month)) return false;
  const r = await sql()`delete from fn_ad_spend where installation_id = ${inst} and location_id = ${loc} and month = ${`${month}-01`}::date returning month`;
  forgetFinance(inst);
  return r.length > 0;
}

// ---------- searchable pickers ----------

export async function findAccounts(s: Scope, q: string | null): Promise<Array<{ id: string; name: string }>> {
  const db = sql();
  if (s.allowed && s.allowed.length === 0) return [];
  const t = (q ?? "").trim().slice(0, 60);
  const rows = await db`select location_id, coalesce(nullif(name, ''), 'Client account') name from locations where installation_id = ${s.inst} and not ignored ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``} ${t ? db`and name ilike ${like(t)}` : db``} order by lower(name) nulls last, location_id limit 20`;
  return rows.map((r) => ({ id: r.location_id as string, name: r.name as string }));
}

// ---------- the one-line headline ----------

export async function headline(s: Scope, links: Links, now = Date.now()) {
  const [accts, ch, lg] = await Promise.all([accounts(s, links, now), churnAll(s, links, now), ledger(s, { bucket: "all", location: null, q: null }, { cursor: null, size: 5 }, now).catch(() => null)]);
  const t = totalsOf(accts.map((a) => a.fact));
  const primary = t.mrr[0] ?? null, risk = t.atRisk[0] ?? null;
  const failing = accts.filter((a) => a.fact.pay === "past_due").length;
  const hi = ch.filter((r) => r.level === "high" && !snoozed(r, now));
  const hiM = hi.filter((r) => r.mrr && r.mrr.currency === primary?.currency).reduce((a, r) => a + (r.mrr?.amount ?? 0), 0);
  const od = lg?.overdue[0] ?? null;
  let disputes = 0;
  try { disputes = n((await sql()`select count(*)::int c from fn_pay_disputes where installation_id = ${s.inst} and status = 'open' ${s.allowed ? sql()`and location_id = any(${s.allowed}::text[])` : sql()``}`)[0]?.c); } catch { /* table not created yet */ }
  const h = headlineOf({
    atRisk: risk ? { amount: risk.amount, currency: risk.currency } : null, failing, highRisk: hi.length, highRiskMrr: hiM > 0 && primary ? { amount: Math.round(hiM), currency: primary.currency } : null,
    overdue: { count: lg?.counts.overdue ?? 0, total: od }, dueSoon: lg?.counts.due_soon ?? 0, disputes, mrr: primary ? { amount: primary.amount, currency: primary.currency } : null, noPrice: t.noPrice.accounts,
  });
  return { ...h, mrr: t.mrr, atRisk: t.atRisk, failing, highRisk: hi.length, overdue: lg?.counts.overdue ?? 0, dueSoon: lg?.counts.due_soon ?? 0, disputes, reminders: lg?.reminders ?? 0, noPrice: t.noPrice.accounts, accounts: t.accounts.total };
}

export { monthlyFrom, snapMrr, daysBetween };
