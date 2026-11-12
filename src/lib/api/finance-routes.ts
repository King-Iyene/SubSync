import type { Feature } from "../entitlements";
import {
  FN_FLAGS, FN_PARTS, addDays, clampSize, csvLine, daysBetween, isDay, type FnFlag, type FnPart, type LedgerBucket, type MoveKind, type PayBasis, type Role,
} from "../analytics/finance-core";
import {
  accounts, checkLedger, churn, findAccounts, headline, ledger, ledgerOwn, movement, overview, removeLedger, removePlanPrice, removeSpend, revenue, saveChurn, savePlanPrice, saveSettings, saveSpend, setup, getSettings,
  addLedger, editLedger, markLedger, tablesMissing, today, cleanId, type ChurnEdit,
} from "../analytics/finance-queries";
import {
  checkRate, disputeList, freezePeriod, frozenLine, frozenSummary, isUuid, lineExists, listPeriods, listRates, parseLineKey, periodLabel, periodOwn, raiseDispute, removeRate, resolveDispute, saveRate, statement, statementFile,
  summary, unfreezePeriod, type Who,
} from "../analytics/finance-pay";
import { ownedUser, type Scope as PScope } from "../analytics/people3-queries";
import { sql } from "../db";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";
import { ownedLocation } from "./tenant-guard";
import { csvCell } from "../analytics/finance-core";

// /api/app/finance: the Finance module (money overview, client revenue, churn watch, setter and closer payouts, billing notes). Agency staff and an account's own team members; what each sees is decided HERE from
// the verified session, never from the request:
//   a MANAGER (agency owner or admin, no account limit) sees everything for the client accounts in `allowed`;
//   anyone else (agency staff, an account administrator, a setter) reaches ONE thing: their OWN payout statement, forced to their own person id in SQL.
// A client's read-only staff reach nothing. An account id goes through ownedLocation and a person id through ownedUser (it only NARROWS inside `allowed`); one that is not yours answers "not found" and is never echoed.
// Nothing here writes to the CRM or contacts anyone: every write is to SubSync's own fn_* tables, and every delete needs the typed name.
//   GET  ?part=options|headline|overview|movement|revenue|churn|payouts|statement|periods|ledger|setup|find|export
//   PUT  settings | plan-price | spend | churn | rate | ledger        POST ledger/add | ledger/mark | ledger/remove | dispute | dispute/resolve | freeze | unfreeze | plan-price/remove | spend/remove | rate/remove

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type FinanceHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const on = (ctx: Ctx, f: FnFlag) => ctx.entitlements.features[f as Feature] === true && !ctx.entitlements.locked.includes(f as Feature);
const off = () => json({ error: "This part of Finance is not switched on yet." }, 404);
const notFound = () => json({ error: "Not found" }, 404);
const forbidden = () => json({ error: "Only the owner or an administrator can open this part of Finance." }, 403);
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };
const text = (v: string | null, max: number) => (v ?? "").trim().slice(0, max) || null;
const typedOk = (typed: unknown, name: string) => typeof typed === "string" && typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== "";

const PART_FLAG: Record<FnPart, FnFlag[]> = {
  options: ["fn_module"], headline: ["fn_module", "fn_today"], overview: ["fn_mrr"], movement: ["fn_mrr"], revenue: ["fn_revenue"], churn: ["fn_churn"], payouts: ["fn_payouts"], statement: ["fn_payouts"],
  periods: ["fn_payouts"], ledger: ["fn_ledger"], setup: ["fn_module"], find: ["fn_module"], export: ["fn_module"],
};
const MANAGER_ONLY = new Set<FnPart>(["headline", "overview", "movement", "revenue", "churn", "payouts", "ledger", "setup", "find"]);

export async function handleFinance(ctx: Ctx, h: FinanceHelpers): Promise<Response> {
  try {
    return await run(ctx, h);
  } catch (error) {
    if (tablesMissing(error)) return off();
    throw error;
  }
}

/** The inclusive day range from the shell's date bar: from and to, at most 366 days, default the last 30 days. */
function rangeOf(sp: URLSearchParams, now = Date.now()): { from: string; to: string } | null {
  const t = today(now);
  const to = sp.get("to") ?? t, from = sp.get("from") ?? addDays(to, -29);
  if (!isDay(from) || !isDay(to) || to < from || daysBetween(from, to) > 366 || to > addDays(t, 1)) return null;
  return { from, to };
}

async function run(ctx: Ctx, h: FinanceHelpers): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  if (!on(ctx, "fn_module")) return off();
  const method = ctx.request.method, sub = ctx.segments[1] ?? "", sp = ctx.url.searchParams;
  const { level, selfId } = viewerOf(ctx);
  const manager = level === "all" && ctx.kind === "agency";
  const who: Who = { level: manager ? "all" : "other", selfId };
  const inst = ctx.installationId, actor = ctx.session.userId ?? null;
  const allowed = await h.allowed();
  const scope = { inst, allowed };
  const dl = await h.links();
  const links = { account: (l: string) => dl.account(l) };
  const pscope: PScope = { inst, allowed, level, selfId };
  const now = Date.now();
  const flags = Object.fromEntries(FN_FLAGS.map((f) => [f, on(ctx, f)]));

  if (method === "GET") {
    const part = sp.get("part") as FnPart | null;
    if (!part || !(FN_PARTS as readonly string[]).includes(part)) return notFound();
    if (!PART_FLAG[part].some((f) => on(ctx, f))) return off();
    if (MANAGER_ONLY.has(part) && !manager) return forbidden();
    const r = rangeOf(sp, now);
    if (!r && ["overview", "movement", "revenue", "payouts", "statement", "export"].includes(part)) return json({ error: "Choose valid dates (at most 366 days)" }, 400);
    const range = r ?? { from: addDays(today(now), -29), to: today(now) };
    const size = clampSize(int(sp.get("size"), 25));
    const cursor = text(sp.get("cursor"), 300);
    const st = await getSettings(inst);
    const basisAsked = sp.get("basis");
    const basis: PayBasis = basisAsked === "booked" || basisAsked === "showed" || basisAsked === "won" ? basisAsked : st.payoutBasis;
    const wrap = (b: object) => json({ ...b, generatedAt: new Date(now).toISOString(), flags, manager });

    switch (part) {
      case "options": return wrap({ settings: st, level, selfId, role: ctx.session.personRole ?? null, tabs: manager ? ["overview", "revenue", "churn", "payouts", "ledger", "setup"] : ["payouts"], accounts: manager ? (await accounts(scope, links, now)).length : 0 });
      case "headline": return wrap(await headline(scope, links, now));
      case "overview": return wrap(await overview(scope, range, links, now));
      case "movement": {
        const k = sp.get("kind");
        return wrap(await movement(scope, range, k === "new" || k === "expansion" || k === "contraction" || k === "churned" ? (k as MoveKind) : null, { cursor, size }, links, now));
      }
      case "revenue": {
        const sort = sp.get("sort");
        return wrap(await revenue(scope, range, { q: text(sp.get("q"), 60), vertical: text(sp.get("vertical"), 40), sort: sort === "billed" || sort === "pipeline" ? sort : "won" }, { cursor, size }, links, now));
      }
      case "churn": {
        const lv = sp.get("level");
        return wrap(await churn(scope, { level: lv === "high" || lv === "watch" || lv === "all" ? lv : null, status: ["open", "working", "saved", "lost"].includes(sp.get("status") ?? "") ? sp.get("status") : null, showSnoozed: sp.get("snoozed") === "1", q: text(sp.get("q"), 60) }, { cursor, size }, links, now));
      }
      case "payouts": return wrap({ ...(await summary(scope, who, range, basis, { cursor, size, q: text(sp.get("q"), 60) })), rates: await listRates(scope), disputes: await disputeList(scope, who) });
      case "statement": {
        const frozen = sp.get("period");
        let rg = range, b = basis, fid: string | null = null;
        if (frozen) {
          const p = await periodOwn(inst, frozen);
          if (!p) return notFound();
          rg = { from: p.from, to: p.to }; b = p.basis; fid = p.id;
        }
        let person = who.selfId;
        if (manager) { person = await ownedUser(pscope, (allowed ?? (await accounts(scope, links, now)).map((a) => a.id)), sp.get("person")); if (!person) return notFound(); }
        if (!person) return wrap({ rows: [], total: 0, next: null, totals: { count: 0, payable: 0, held: 0, disputed: 0, value: 0 }, person: { personId: "", name: "" }, currency: st.currency, basis: b, kind: b, range: rg, frozen: fid !== null });
        const kind = sp.get("kind"), role = sp.get("role");
        const f = { kind: kind === "booked" || kind === "showed" || kind === "won" ? (kind as PayBasis) : null, role: role === "setter" || role === "closer" ? (role as Role) : null, disputedOnly: sp.get("disputed") === "1" };
        return wrap(await statement(scope, who, person, rg, b, f, { cursor, size }, fid));
      }
      case "periods": {
        const id = sp.get("id");
        if (id) {
          const p = await periodOwn(inst, id);
          if (!p) return notFound();
          if (!manager) {
            const mine = await statement(scope, who, who.selfId ?? "", { from: p.from, to: p.to }, p.basis, { kind: p.basis, role: null, disputedOnly: false }, { cursor, size }, p.id);
            return wrap({ period: p, rows: [], mine, total: 0, next: null });
          }
          return wrap({ period: p, ...(await frozenSummary(scope, p.id, { cursor, size })) });
        }
        const all = await listPeriods(scope);
        if (manager) return wrap({ rows: all });
        // A person without manager rights sees only the periods in which they have lines.
        const mine = who.selfId ? await sql()`select distinct period_id from fn_pay_lines where installation_id = ${inst} and person_id = ${who.selfId}` : [];
        const set = new Set(mine.map((x) => x.period_id as string));
        return wrap({ rows: all.filter((p) => set.has(p.id)).map((p) => ({ ...p, total: 0, accounts: 0, frozenBy: null })) });
      }
      case "ledger": {
        const b = sp.get("bucket");
        const loc = sp.get("location") ? await ownedLocation(inst, allowed, sp.get("location")) : null;
        if (sp.get("location") && !loc) return wrap({ rows: [], total: 0, next: null, counts: { overdue: 0, due_soon: 0, upcoming: 0, paid: 0 }, owed: [], overdue: [], reminders: 0 });
        return wrap(await ledger(scope, { bucket: b === "overdue" || b === "due_soon" || b === "upcoming" || b === "paid" ? (b as LedgerBucket) : "all", location: loc, q: text(sp.get("q"), 60) }, { cursor, size }, now));
      }
      case "setup": return wrap(await setup(scope, links, now));
      case "find": {
        if (sp.get("what") === "person") {
          const ids = allowed ?? (await accounts(scope, links, now)).map((a) => a.id);
          const q = (text(sp.get("q"), 60) ?? "").toLowerCase();
          const rows = await sql()`select m.user_id, coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') nm from team_members m left join team_names tn on tn.installation_id = m.installation_id and tn.user_id = m.user_id
            where m.installation_id = ${inst} and not m.deleted and (m.all_accounts or exists (select 1 from team_member_access x where x.installation_id = m.installation_id and x.user_id = m.user_id and x.location_id = any(${ids}::text[]))
              or exists (select 1 from location_users lu where lu.installation_id = m.installation_id and lu.user_id = m.user_id and lu.location_id = any(${ids}::text[])))
              ${q ? sql()`and lower(coalesce(nullif(tn.name, ''), m.name, '')) like ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : sql()``} order by lower(coalesce(nullif(tn.name, ''), m.name, '')), m.user_id limit 20`;
          return wrap({ rows: rows.filter((x) => x.nm).map((x) => ({ id: x.user_id as string, name: x.nm as string })) });
        }
        return wrap({ rows: await findAccounts(scope, text(sp.get("q"), 60)) });
      }
      case "export": return await exportFile(ctx, scope, who, manager, range, basis, pscope, links, now);
      default: return notFound();
    }
  }

  // ---- writes
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  const need = (f: FnFlag) => on(ctx, f);

  // A non-manager may only flag one of their own payout lines.
  if (sub === "dispute" && ctx.segments[2] === undefined && method === "POST") {
    if (!need("fn_payouts")) return off();
    const r = rangeOf(new URLSearchParams({ from: String(body.from ?? ""), to: String(body.to ?? "") }), now);
    const key = parseLineKey(body.lineKey);
    if (!key) return json({ error: "Not found" }, 404);
    const st = await getSettings(inst);
    let found: { personId: string; locationId: string } | null = null;
    if (isUuid(body.periodId)) found = await frozenLine(scope, who, body.periodId, String(body.lineKey));
    else if (r) found = await lineExists(scope, who, String(body.lineKey), r, body.basis === "booked" || body.basis === "showed" || body.basis === "won" ? body.basis : st.payoutBasis);
    if (!found) return notFound();
    await raiseDispute(inst, String(body.lineKey), found.locationId, found.personId, typeof body.note === "string" ? body.note.trim() : null, actor);
    return json({ ok: true });
  }
  if (!manager) return forbidden();

  if (sub === "settings" && method === "PUT") {
    const r = await saveSettings(inst, body, actor);
    return r.ok ? json({ ok: true, settings: r.value }) : json({ error: r.error }, 400);
  }
  if (sub === "plan-price") {
    if (method === "PUT") { const r = await savePlanPrice(inst, body, actor); return r.ok ? json({ ok: true }) : json({ error: r.error }, 400); }
    if (method === "POST" && ctx.segments[2] === "remove") {
      const key = typeof body.planKey === "string" ? body.planKey.trim() : "";
      const s = await setup(scope, links, now);
      const p = s.plans.find((x) => x.planKey === key);
      const nameOf = p?.planName ?? p?.planKey ?? key;
      if (!typedOk(body.confirm, nameOf)) return json({ error: "Type the plan's name exactly to confirm" }, 400);
      return json({ ok: await removePlanPrice(inst, key) });
    }
  }
  if (sub === "spend") {
    const loc = await ownedLocation(inst, allowed, body.locationId);
    if (!loc) return notFound();
    if (method === "PUT") { const r = await saveSpend(inst, loc, body, actor); return r.ok ? json({ ok: true }) : json({ error: r.error }, 400); }
    if (method === "POST" && ctx.segments[2] === "remove") {
      const [l] = await sql()`select coalesce(name, 'Client account') name from locations where installation_id = ${inst} and location_id = ${loc}`;
      if (!l || !typedOk(body.confirm, String(l.name))) return json({ error: "Type the client account's name exactly to confirm" }, 400);
      return json({ ok: await removeSpend(inst, loc, String(body.month ?? "")) });
    }
  }
  if (sub === "churn" && method === "PUT") {
    if (!need("fn_churn")) return off();
    const loc = await ownedLocation(inst, allowed, body.locationId);
    if (!loc) return notFound();
    const e: ChurnEdit = {};
    if ("status" in body) e.status = String(body.status);
    if ("snoozeDays" in body) e.snoozeDays = Number(body.snoozeDays);
    if ("muted" in body) e.muted = body.muted === true;
    if ("note" in body) e.note = typeof body.note === "string" ? body.note : null;
    if ("owner" in body) {
      if (body.owner === null || body.owner === "") e.owner = null;
      else { const o = await ownedUser(pscope, allowed ?? (await accounts(scope, links, now)).map((a) => a.id), body.owner); if (!o) return notFound(); e.owner = o; }
    }
    const r = await saveChurn(inst, loc, e, actor);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
  }
  if (sub === "rate") {
    if (!need("fn_payouts")) return off();
    const person = body.personId === undefined || body.personId === null || body.personId === "" ? "" : await ownedUser(pscope, allowed ?? (await accounts(scope, links, now)).map((a) => a.id), body.personId);
    if (person === null) return notFound();
    const loc = body.locationId === undefined || body.locationId === null || body.locationId === "" ? "" : await ownedLocation(inst, allowed, body.locationId);
    if (loc === null) return notFound();
    if (method === "PUT") {
      const v = checkRate(body);
      if (!v.ok) return json({ error: v.error }, 400);
      await saveRate(inst, person, loc, v, actor);
      return json({ ok: true });
    }
    if (method === "POST" && ctx.segments[2] === "remove") {
      if (body.role !== "setter" && body.role !== "closer") return json({ error: "Choose setter or closer" }, 400);
      const rates = await listRates(scope);
      const row = rates.find((x) => x.personId === person && x.locationId === loc && x.role === body.role);
      if (!row) return notFound();
      const name = row.person ?? row.account ?? "everyone";
      if (!typedOk(body.confirm, name)) return json({ error: `Type “${name}” exactly to confirm` }, 400);
      return json({ ok: await removeRate(inst, person, loc, body.role) });
    }
  }
  if (sub === "dispute" && ctx.segments[2] === "resolve" && method === "POST") {
    if (!need("fn_payouts")) return off();
    if (!parseLineKey(body.lineKey)) return notFound();
    const k = parseLineKey(body.lineKey);
    if (!k || !(await ownedLocation(inst, allowed, k.locationId))) return notFound();
    return json({ ok: await resolveDispute(inst, String(body.lineKey)) });
  }
  if (sub === "freeze" && method === "POST") {
    if (!need("fn_payouts")) return off();
    const from = body.from, to = body.to, basis = body.basis;
    if (!isDay(from) || !isDay(to) || to < from || daysBetween(from, to) > 366 || (basis !== "booked" && basis !== "showed" && basis !== "won")) return json({ error: "Choose the dates and what the payout is based on" }, 400);
    const label = periodLabel({ from, to }, basis);
    if (!typedOk(body.confirm, label)) return json({ error: `Type “${label}” exactly to confirm` }, 400);
    const r = await freezePeriod(scope, { from, to }, basis, actor);
    return r.ok ? json({ ok: true, id: r.id, lines: r.lines }) : json({ error: r.error }, r.status);
  }
  if (sub === "unfreeze" && method === "POST") {
    if (!need("fn_payouts")) return off();
    const p = await periodOwn(inst, body.id);
    if (!p) return notFound();
    if (!typedOk(body.confirm, p.label)) return json({ error: `Type “${p.label}” exactly to confirm` }, 400);
    return json({ ok: await unfreezePeriod(inst, p.id) });
  }
  if (sub === "ledger") {
    if (!need("fn_ledger")) return off();
    const op = ctx.segments[2] ?? "";
    if (op === "add" && method === "POST") {
      const loc = await ownedLocation(inst, allowed, body.locationId);
      if (!loc) return notFound();
      const v = checkLedger(body);
      if (!v.ok) return json({ error: v.error }, 400);
      return json({ ok: true, id: await addLedger(inst, loc, v.value, actor) });
    }
    const row = await ledgerOwn(inst, allowed, body.id);
    if (!row) return notFound();
    if (method === "PUT") {
      const v = checkLedger(body);
      if (!v.ok) return json({ error: v.error }, 400);
      await editLedger(inst, row.id, v.value);
      return json({ ok: true });
    }
    if (op === "mark" && method === "POST") { await markLedger(inst, row.id, body.paid === true, now); return json({ ok: true }); }
    if (op === "remove" && method === "POST") {
      if (!typedOk(body.confirm, row.label)) return json({ error: `Type “${row.label}” exactly to confirm` }, 400);
      await removeLedger(inst, row.id);
      return json({ ok: true });
    }
  }
  void cleanId;
  return json({ error: "Unknown request" }, 400);
}

async function exportFile(ctx: Ctx, scope: { inst: string; allowed: string[] | null }, who: Who, manager: boolean, range: { from: string; to: string }, basis: PayBasis, pscope: PScope, links: { account: (l: string) => string }, now: number): Promise<Response> {
  const sp = ctx.url.searchParams, what = sp.get("what");
  const file = (name: string, csv: string) => new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  if (what === "statement") {
    if (!on(ctx, "fn_payouts")) return off();
    let person = who.selfId, rg = range, b = basis, fid: string | null = null;
    if (sp.get("period")) { const p = await periodOwn(scope.inst, sp.get("period")); if (!p) return notFound(); rg = { from: p.from, to: p.to }; b = p.basis; fid = p.id; }
    if (manager) { person = await ownedUser(pscope, scope.allowed ?? (await accounts(scope, links, now)).map((a) => a.id), sp.get("person")); if (!person) return notFound(); }
    if (!person) return notFound();
    const kind = sp.get("kind"), role = sp.get("role");
    const out = await statementFile(scope, who, person, rg, b, { kind: kind === "booked" || kind === "showed" || kind === "won" ? (kind as PayBasis) : null, role: role === "setter" || role === "closer" ? (role as Role) : null, disputedOnly: sp.get("disputed") === "1" }, fid);
    return file(`payout-statement-${rg.from}-to-${rg.to}.csv`, out.csv);
  }
  if (!manager) return forbidden();
  if (what === "ledger") {
    if (!on(ctx, "fn_ledger")) return off();
    const lines = [csvLine(["Client account", "What it is for", "Amount", "Currency", "Due", "Status", "Paid on", "Reminder", "Note"])];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const p = await ledger(scope, { bucket: "all", location: null, q: null }, { cursor, size: 100 }, now);
      for (const r of p.rows) lines.push(csvLine([r.account, r.label, r.amount.toFixed(2), r.currency, r.dueOn, r.status, r.paidOn ?? "", r.remindOn ?? "", r.note ?? ""]));
      if (!p.next) break;
      cursor = p.next;
    }
    return file("billing-notes.csv", lines.join("\r\n") + "\r\n");
  }
  if (what === "revenue") {
    if (!on(ctx, "fn_revenue")) return off();
    const lines = [csvLine(["Client account", "Kind of business", "Plan price a month", "Currency", "New leads", "Booked", "Won deals", "Won value", "Lost deals", "Open pipeline", "Win rate %", "Average deal", "Ad spend", "Cost per lead", "Return on spend"])];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const p = await revenue(scope, range, { q: null, vertical: null, sort: "won" }, { cursor, size: 100 }, links, now);
      for (const r of p.rows) lines.push(csvLine([r.name, r.verticalLabel ?? "", r.billed?.amount ?? "", r.billed?.currency ?? "", r.newLeads, r.booked, r.won, Math.round(r.wonValue), r.lost, Math.round(r.pipelineValue), r.winRate ?? "", r.avgDeal ?? "", r.spend ?? "", r.cpl ?? "", r.roas ?? ""]));
      if (!p.next) break;
      cursor = p.next;
    }
    return file(`client-revenue-${range.from}-to-${range.to}.csv`, lines.join("\r\n") + "\r\n");
  }
  void csvCell; void listPeriods; void summary;
  return notFound();
}
