import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { accountsIn } from "./clients3-queries";
import { refreshWalletsFor } from "./clients3-billing";
import {
  analyze, daily, DEFAULT_LOW_AMOUNT, DEFAULT_LOW_DAYS, FORMULA_BURN, FORMULA_SPIKE, levelOf, rankKey, topupList, usd, whyLine, DAY, type Reading,
} from "./wg-core";
import { WG_BUCKETS, type WgAccount, type WgBucket, type WgList, type WgRow, type WgSettings, type WgSummary } from "./wg-types";

// The database side of the wallet guard. Reads only, except the sweep (SubSync's own tables) and SubSync's own choices (limits, pauses, who is alerted).
// EVERY read starts from `accountsIn`: the accounts of the caller's own installation, inside the caller's `allowed` set. An id that arrives in a request is checked by the route
// (ownedLocation) first and never echoed. Every query also filters by installation_id. Nothing here writes to the CRM or messages anyone.

export type Scope = { inst: string; allowed: string[] | null };
export type Links = { account: (loc: string) => string };

const num = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);

export const wgCache = ttlCache<object>(45_000, 100);
export const forgetWg = (inst: string) => wgCache.clear(JSON.stringify([inst]).slice(0, -1));

const KEEP_DAYS = 21;
const RECHARGE_DAYS = 7;

// ------------------------------------------------------------------ the sweep (hourly, flag wg_record)

/** Reads the balances (at most once every six hours per account, by the billing refresh), keeps one append-only reading per platform answer, and refreshes the working row of each account. Idempotent. */
export async function sweepWallet(inst: string, now = Date.now(), opts: { refresh?: boolean } = {}): Promise<{ readings: number; accounts: number }> {
  const db = sql();
  if (opts.refresh !== false) await refreshWalletsFor(inst).catch(() => false);
  const rows = await db`select l.location_id, b.wallet_state, b.wallet_balance, b.wallet_credits, b.wallet_at
    from locations l left join client_billing b on b.installation_id = l.installation_id and b.location_id = l.location_id
    where l.installation_id = ${inst} and not l.ignored`;
  const ok = rows.filter((r) => r.wallet_state === "ok" && r.wallet_at && num(r.wallet_balance) !== null);
  const fresh = new Set<string>();
  if (ok.length) {
    const ins = await db`insert into wg_samples (installation_id, location_id, observed_at, balance, credits)
      select ${inst}, x.l, x.o::timestamptz, x.b::numeric, x.c::numeric
      from unnest(${ok.map((r) => r.location_id as string)}::text[], ${ok.map((r) => iso(r.wallet_at) as string)}::text[], ${ok.map((r) => String(num(r.wallet_balance)))}::text[], ${ok.map((r) => (num(r.wallet_credits) === null ? null : String(num(r.wallet_credits))))}::text[]) as x(l, o, b, c)
      on conflict (installation_id, location_id, observed_at) do nothing returning location_id`;
    for (const r of ins) fresh.add(r.location_id as string);
  }
  const have = await db`select location_id, computed_at from wg_state where installation_id = ${inst}`;
  const computed = new Map(have.map((r) => [r.location_id as string, (r.computed_at as Date).getTime()]));
  const due: string[] = [];
  let accounts = 0;
  for (const r of rows) {
    const id = r.location_id as string, st = (r.wallet_state as string | null) ?? "not_checked";
    if (st !== "ok") {
      const state = st === "needs_permission" ? "needs_permission" : st === "not_checked" || st === null ? "not_checked" : "not_available";
      await db`insert into wg_state (installation_id, location_id, wallet_state, computed_at) values (${inst}, ${id}, ${state}, now())
        on conflict (installation_id, location_id) do update set wallet_state = excluded.wallet_state, balance = null, credits = null, days_left = null, burn_per_day = null, spike = false, computed_at = now()`;
      accounts++;
      continue;
    }
    if (fresh.has(id) || !computed.has(id) || now - (computed.get(id) as number) > 6 * 3_600_000) due.push(id);
  }
  if (due.length) {
    const rd = await db`select location_id, observed_at, balance::float8 b from wg_samples where installation_id = ${inst} and location_id = any(${due}::text[]) and observed_at >= ${new Date(now - KEEP_DAYS * DAY)} order by location_id, observed_at`;
    const by = new Map<string, Reading[]>();
    for (const r of rd) { const l = by.get(r.location_id as string) ?? []; l.push({ at: (r.observed_at as Date).getTime(), balance: Number(r.b) }); by.set(r.location_id as string, l); }
    const cur = new Map(rows.map((r) => [r.location_id as string, r]));
    for (const id of due) {
      const readings = by.get(id) ?? [], a = analyze(readings, now), c = cur.get(id);
      if (!c) continue;
      const first = readings[0], last = readings[readings.length - 1];
      await db`insert into wg_state (installation_id, location_id, wallet_state, balance, credits, observed_at, samples, span_days, burn_per_day, days_left, spent_7d, topups_7d, last_topup_at, spike, spike_spent, spike_baseline, spike_day, computed_at)
        values (${inst}, ${id}, 'ok', ${num(c.wallet_balance)}, ${num(c.wallet_credits)}, ${iso(c.wallet_at)}, ${a.readings}, ${first && last ? (last.at - first.at) / DAY : null}, ${a.burn.perDay}, ${a.daysLeft}, ${a.spent7d}, ${a.topups7d},
          ${a.lastTopupAt ? new Date(a.lastTopupAt) : null}, ${a.spike.spike}, ${a.spike.spent}, ${a.spike.baseline}, ${a.spike.day}, now())
        on conflict (installation_id, location_id) do update set wallet_state = 'ok', balance = excluded.balance, credits = excluded.credits, observed_at = excluded.observed_at, samples = excluded.samples, span_days = excluded.span_days,
          burn_per_day = excluded.burn_per_day, days_left = excluded.days_left, spent_7d = excluded.spent_7d, topups_7d = excluded.topups_7d, last_topup_at = excluded.last_topup_at, spike = excluded.spike,
          spike_spent = excluded.spike_spent, spike_baseline = excluded.spike_baseline, spike_day = excluded.spike_day, computed_at = now()`;
      for (const t of topupList(readings).filter((x) => x.at >= now - RECHARGE_DAYS * DAY)) {
        await db`insert into wg_events (installation_id, location_id, kind, episode, amount, at) values (${inst}, ${id}, 'recharge', ${new Date(t.at).toISOString()}, ${t.amount}, ${new Date(t.at)}) on conflict do nothing`;
      }
      accounts++;
    }
  }
  forgetWg(inst);
  return { readings: fresh.size, accounts };
}

// ------------------------------------------------------------------ the board

type Prefs = { lowAmount: number; lowDays: number; alertsOn: boolean; spikeOn: boolean };
export async function getPrefs(inst: string): Promise<Prefs> {
  const [p] = await sql()`select low_amount::float8 la, low_days, alerts_on, spike_on from wg_prefs where installation_id = ${inst}`.catch(() => []);
  return { lowAmount: p ? Number(p.la) : DEFAULT_LOW_AMOUNT, lowDays: p ? Number(p.low_days) : DEFAULT_LOW_DAYS, alertsOn: p ? p.alerts_on === true : true, spikeOn: p ? p.spike_on === true : true };
}

/** Every account the caller may see, with the working numbers and the level. The one source of the counts and of the lists, so a count always equals its rows. */
export async function boardRows(s: Scope, links: Links, now = Date.now()): Promise<{ rows: WgRow[]; prefs: Prefs }> {
  const [accts, prefs] = await Promise.all([accountsIn({ inst: s.inst, allowed: s.allowed }, {}), getPrefs(s.inst)]);
  if (!accts.length) return { rows: [], prefs };
  const ids = accts.map((a) => a.id), db = sql();
  const [st, bill, rules] = await Promise.all([
    db`select * from wg_state where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.catch(() => []),
    db`select location_id, wallet_state, wallet_balance, wallet_credits, wallet_at from client_billing where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.catch(() => []),
    db`select location_id, low_amount::float8 la, muted_until from wg_rules where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.catch(() => []),
  ]);
  const S = new Map(st.map((r) => [r.location_id as string, r])), B = new Map(bill.map((r) => [r.location_id as string, r])), R = new Map(rules.map((r) => [r.location_id as string, r]));
  const rows: WgRow[] = accts.map((a) => {
    const w = S.get(a.id), b = B.get(a.id), r = R.get(a.id);
    // The newest answer of the platform (client_billing) wins for the balance; the analysis comes from our own readings (wg_state).
    const bs = (b?.wallet_state as string | null) ?? (w?.wallet_state as string | null) ?? "not_checked";
    const state = (bs === "ok" || bs === "needs_permission" || bs === "not_checked" ? bs : "not_available") as WgRow["state"];
    const balance = state === "ok" ? num(b?.wallet_balance) ?? num(w?.balance) : null;
    const credits = state === "ok" ? num(b?.wallet_credits) ?? num(w?.credits) : null;
    const hasAnalysis = state === "ok" && w?.wallet_state === "ok";
    const daysLeft = hasAnalysis ? num(w?.days_left) : null;
    const spike = hasAnalysis && w?.spike === true && prefs.spikeOn;
    const ruleAmount = r ? num(r.la) : null, lowAmount = ruleAmount ?? prefs.lowAmount;
    const rules = { lowAmount, lowDays: prefs.lowDays };
    const level = levelOf({ balance, daysLeft: balance !== null && balance > 0 ? daysLeft : balance !== null ? 0 : null, spike }, rules);
    const pausedUntil = r?.muted_until && (r.muted_until as Date).getTime() > now ? iso(r.muted_until) : null;
    const burn = hasAnalysis ? num(w?.burn_per_day) : null;
    return {
      locationId: a.id, name: a.name, balance, credits, level, state, observedAt: iso(b?.wallet_at ?? w?.observed_at),
      burnPerDay: burn, daysLeft: balance !== null && balance <= 0 ? 0 : daysLeft, spent7d: hasAnalysis ? num(w?.spent_7d) : null, topups7d: hasAnalysis ? Number(w?.topups_7d ?? 0) : 0,
      spike, spikeSpent: spike ? num(w?.spike_spent) : null, spikeBaseline: spike ? num(w?.spike_baseline) : null, readings: hasAnalysis ? Number(w?.samples ?? 0) : 0,
      enough: hasAnalysis && burn !== null, why: whyLine({ balance, daysLeft, burnPerDay: burn, spike, spikeSpent: spike ? num(w?.spike_spent) : null, spikeBaseline: spike ? num(w?.spike_baseline) : null, lowAmount, state }),
      lowAmount, ruleAmount, pausedUntil, url: links.account(a.id),
    };
  });
  rows.sort((x, y) => { const a = rankKey(x), b = rankKey(y); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || x.name.localeCompare(y.name); });
  return { rows, prefs };
}

export const inBucket = (r: WgRow, b: WgBucket): boolean =>
  b === "all" ? true : b === "empty" ? r.level === "empty" : b === "low" ? r.level === "low" : b === "spike" ? r.spike : b === "unknown" ? r.balance === null : r.pausedUntil !== null;

const first = async (inst: string): Promise<string | null> => {
  try { const r = await sql()`select min(observed_at)::date::text d from wg_samples where installation_id = ${inst}`; return (r[0]?.d as string | null) ?? null; } catch { return null; }
};

export async function summary(s: Scope, links: Links, now = Date.now()): Promise<WgSummary> {
  const { rows, prefs } = await boardRows(s, links, now);
  const counts = Object.fromEntries(WG_BUCKETS.map((b) => [b, rows.filter((r) => inBucket(r, b)).length])) as Record<WgBucket, number>;
  const headline = rows.length === 0 ? "No client accounts yet."
    : counts.unknown === rows.length ? "Credit balances are not readable yet. Reconnect and allow the wallet permission so SubSync can watch them."
    : counts.empty > 0 ? `${counts.empty} client ${counts.empty === 1 ? "account has" : "accounts have"} an empty credit balance${counts.low ? ` and ${counts.low} ${counts.low === 1 ? "is" : "are"} running low` : ""}.`
    : counts.low > 0 ? `${counts.low} client ${counts.low === 1 ? "account is" : "accounts are"} running low on credit.`
    : counts.spike > 0 ? `No balance is low, but ${counts.spike} ${counts.spike === 1 ? "account is" : "accounts are"} spending far more than usual.` : "Every readable credit balance looks healthy.";
  return {
    accounts: rows.length, counts, headline, needsPermission: rows.filter((r) => r.state === "needs_permission").length,
    top: rows.filter((r) => r.level === "empty" || r.level === "low").slice(0, 3), formulaBurn: FORMULA_BURN, formulaSpike: FORMULA_SPIKE, historyStarts: await first(s.inst), prefs,
    autoRecharge: { available: false, note: "Not available from the platform yet: it does not let apps read whether auto-recharge is on, so SubSync never guesses. Check it in your CRM, Settings, Billing." },
  };
}

export async function list(s: Scope, links: Links, o: { bucket: WgBucket; q: string | null; page: number; size: number }, now = Date.now()): Promise<WgList> {
  const { rows } = await boardRows(s, links, now);
  const q = (o.q ?? "").trim().toLowerCase();
  const hit = rows.filter((r) => inBucket(r, o.bucket) && (!q || r.name.toLowerCase().includes(q)));
  const size = Math.min(100, Math.max(5, o.size)), pages = Math.max(1, Math.ceil(hit.length / size)), page = Math.min(Math.max(0, o.page), pages - 1);
  return { rows: hit.slice(page * size, page * size + size), total: hit.length, page, size, pages, bucket: o.bucket };
}

// ------------------------------------------------------------------ one account

const EVENT_WORDS: Record<string, (b: number | null, a: number | null) => string> = {
  empty: () => "The balance reached zero.", low: (b) => `The balance went low${b !== null ? ` (${usd(b)})` : ""}.`,
  spike: (_b, a) => `Spend jumped${a !== null ? `: ${usd(a)} in a day` : ""}.`, recharge: (_b, a) => `Topped up${a !== null ? ` by about ${usd(a)}` : ""}.`,
};

/** One account's history from our own readings. The id must already have passed ownedLocation. */
export async function account(s: Scope, links: Links, location: string, now = Date.now()): Promise<WgAccount | null> {
  const { rows } = await boardRows({ inst: s.inst, allowed: s.allowed ? s.allowed.filter((x) => x === location) : [location] }, links, now);
  const row = rows.find((r) => r.locationId === location);
  if (!row) return null;
  const db = sql();
  const [rd, ev] = await Promise.all([
    db`select observed_at, balance::float8 b from wg_samples where installation_id = ${s.inst} and location_id = ${location} and observed_at >= ${new Date(now - 30 * DAY)} order by observed_at`.catch(() => []),
    db`select id, kind, at, balance::float8 b, amount::float8 a from wg_events where installation_id = ${s.inst} and location_id = ${location} order by id desc limit 20`.catch(() => []),
  ]);
  const readings: Reading[] = rd.map((r) => ({ at: (r.observed_at as Date).getTime(), balance: Number(r.b) }));
  const step = Math.max(1, Math.ceil(readings.length / 60));
  return {
    row,
    series: daily(readings).slice(-30).map((d) => ({ day: d.day, spent: Math.round(d.spent * 100) / 100, topups: d.topups, covered: d.covered })),
    balances: readings.filter((_, i) => i % step === 0 || i === readings.length - 1).map((r) => ({ at: new Date(r.at).toISOString(), balance: r.balance })),
    events: ev.map((e) => ({ id: Number(e.id), kind: e.kind as "low" | "empty" | "spike" | "recharge", at: iso(e.at) as string, text: (EVENT_WORDS[e.kind as string] ?? (() => ""))(num(e.b), num(e.a)) })),
  };
}

// ------------------------------------------------------------------ settings (SubSync's own choices)

export async function getSettings(s: Scope, userKey: string | null, canEdit: boolean, sendingNote: string): Promise<WgSettings> {
  const [prefs, accts] = await Promise.all([getPrefs(s.inst), accountsIn({ inst: s.inst, allowed: s.allowed }, {})]);
  const ids = accts.map((a) => a.id), name = new Map(accts.map((a) => [a.id, a.name]));
  const [rules, w] = await Promise.all([
    ids.length ? sql()`select location_id, low_amount::float8 la, muted_until from wg_rules where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and (low_amount is not null or muted_until > now())`.catch(() => []) : Promise.resolve([]),
    userKey ? sql()`select 1 from wg_watchers where installation_id = ${s.inst} and user_key = ${userKey}`.catch(() => []) : Promise.resolve([]),
  ]);
  return {
    canEdit, ...prefs, watching: w.length > 0, sendingNote,
    rules: rules.map((r) => ({ locationId: r.location_id as string, name: name.get(r.location_id as string) ?? "Client account", lowAmount: num(r.la), pausedUntil: r.muted_until && (r.muted_until as Date).getTime() > Date.now() ? iso(r.muted_until) : null })),
  };
}

export async function savePrefs(inst: string, by: string | null, b: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const la = Number(b.lowAmount ?? DEFAULT_LOW_AMOUNT), ld = Number(b.lowDays ?? DEFAULT_LOW_DAYS);
  if (!Number.isFinite(la) || la < 0 || la > 100_000) return { ok: false, error: "Choose a balance limit between 0 and 100,000." };
  if (!Number.isInteger(ld) || ld < 1 || ld > 30) return { ok: false, error: "Choose days left between 1 and 30." };
  await sql()`insert into wg_prefs (installation_id, low_amount, low_days, alerts_on, spike_on, updated_by, updated_at) values (${inst}, ${la}, ${ld}, ${b.alertsOn !== false}, ${b.spikeOn !== false}, ${by}, now())
    on conflict (installation_id) do update set low_amount = excluded.low_amount, low_days = excluded.low_days, alerts_on = excluded.alerts_on, spike_on = excluded.spike_on, updated_by = excluded.updated_by, updated_at = now()`;
  forgetWg(inst);
  return { ok: true };
}

/** A limit or a pause for ONE account. `location` must have passed ownedLocation. lowAmount null = back to the default; pauseDays 0 = alerts back on. */
export async function saveRule(inst: string, by: string | null, location: string, b: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const raw = b.lowAmount, la = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (la !== null && (!Number.isFinite(la) || la < 0 || la > 100_000)) return { ok: false, error: "Choose a balance limit between 0 and 100,000." };
  const pd = b.pauseDays === undefined ? undefined : Number(b.pauseDays);
  if (pd !== undefined && (!Number.isInteger(pd) || pd < 0 || pd > 90)) return { ok: false, error: "Pause for 0 to 90 days." };
  const db = sql();
  await db`insert into wg_rules (installation_id, location_id, low_amount, muted_until, updated_by, updated_at)
    values (${inst}, ${location}, ${la}, ${pd && pd > 0 ? db`now() + make_interval(days => ${pd})` : null}, ${by}, now())
    on conflict (installation_id, location_id) do update set low_amount = excluded.low_amount,
      muted_until = ${pd === undefined ? db`wg_rules.muted_until` : pd > 0 ? db`now() + make_interval(days => ${pd})` : db`null`}, updated_by = excluded.updated_by, updated_at = now()`;
  forgetWg(inst);
  return { ok: true };
}

export async function setWatching(inst: string, userKey: string, on: boolean): Promise<void> {
  const db = sql();
  if (on) await db`insert into wg_watchers (installation_id, user_key) values (${inst}, ${userKey}) on conflict do nothing`;
  else await db`delete from wg_watchers where installation_id = ${inst} and user_key = ${userKey}`;
}
