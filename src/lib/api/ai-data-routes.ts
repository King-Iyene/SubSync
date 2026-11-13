import { createPreview } from "../analytics/cleanup-queries";
import { groupByKey } from "../analytics/dq-queries";
import { realDeps } from "../ai/brief";
import { askData, cleanQuestion } from "../ai/data/ask";
import { openRows, windowOf } from "../ai/data/ask-tools";
import { deleteAllTurns, deleteTurn, listTurns, saveTurn } from "../ai/data/ask-store";
import { loadCleanFacts, runDataClean, RULE_FOR, type Action } from "../ai/data/clean";
import { judgeDuplicates } from "../ai/data/dupjudge";
import { JOB_FLAG, jobEnabled, type DataJob } from "../ai/data/flags";
import { runDataReview } from "../ai/data/review";
import { loadSetupInput, runSetupAudit, setupFacts } from "../ai/data/setup";
import type { Tenant } from "../ai/tools";
import { publicConnection } from "../ai/store";
import { sql } from "../db";
import { addDays, isRealDay, localDay } from "../design/zone";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";

// /api/app/aid?part=status|history|rows and POST /api/app/aid/act/<ask|history-delete|review|clean|clean-preview|dup-judge|setup-audit>.
// The AI data jobs (Ask your data, Data review, Data cleaning proposals, Duplicate judge, Setup auditor). Who is asking, the company, the one account (client sessions) or the allowed accounts (agency
// staff) come ONLY from the signed session; a request can name an account to narrow to, never to widen. Every job needs ai_byo and its own flag. Nothing here writes to the CRM: the cleaning
// batch only makes an ordinary Fix data PREVIEW, and the person applies it there (typed confirmation, undo, protections).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type AidDeps = { allowed: () => Promise<string[] | null> };
const ID = /^[A-Za-z0-9_-]{3,64}$/;
const KEY = /^[\x21-\x7e]{1,300}$/;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const body = async (ctx: Ctx): Promise<Record<string, unknown>> => { try { const x = await ctx.request.json(); return x && typeof x === "object" ? (x as Record<string, unknown>) : {}; } catch { return {}; } };

/** The date bar's window as sent (days, in the app's zone). Anything unreal, backwards, in the future or over about 3 years is ignored and the default is used. */
export function rangeFrom(from: unknown, to: unknown, now = Date.now()): { from: string; to: string } | undefined {
  if (!isRealDay(from) || !isRealDay(to) || from > to) return undefined;
  const today = localDay(now);
  if (to > today || from < addDays(today, -1100)) return undefined;
  return { from, to };
}

/** The tenant for this request: the verified session decides the company and the accounts; `wanted` can only narrow to one account the person may already see. */
export async function tenantFor(ctx: Pick<AuthContext, "installationId" | "limitTo">, allowed: string[] | null, wanted: string, range?: { from: string; to: string }): Promise<Tenant | null> {
  if (ctx.limitTo) return { installationId: ctx.installationId, locationId: ctx.limitTo, allowed: [ctx.limitTo], range };
  if (wanted) {
    if (!ID.test(wanted) || (allowed && !allowed.includes(wanted))) return null;
    const known = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${wanted} and not ignored`;
    return known.length ? { installationId: ctx.installationId, locationId: wanted, allowed: [wanted], range } : null;
  }
  return { installationId: ctx.installationId, locationId: null, allowed, range };
}

async function audit(ctx: Ctx, action: string, detail: Record<string, unknown>) {
  const db = sql();
  await db`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userName ?? ctx.session.userId ?? null}, ${action}, ${db.json(detail as never)})`.catch(() => undefined);
}

export async function handleAiData(ctx: Ctx, deps: AidDeps): Promise<Response> {
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  const on = (f: string) => ent.features[f as Feature] === true;
  if (!on("ai_byo")) return json({ error: "AI is not switched on for your account yet." }, 404);
  const user = ctx.session.userId ?? null;
  if (!user) return json({ error: "Please sign in again" }, 401);
  const enabled = (job: DataJob) => jobEnabled(on, job);
  const level = viewerOf(ctx).level, staffLevel = level !== "self", notClient = ctx.kind !== "client";
  const isAct = ctx.segments[1] === "act", sp = ctx.url.searchParams;

  if (!isAct) {
    const part = sp.get("part") ?? "status";
    if (part === "status") {
      const allowed = await deps.allowed();
      const [mine, own] = await Promise.all([publicConnection(ctx.installationId, ctx.limitTo ?? ""), ctx.limitTo ? publicConnection(ctx.installationId, "") : Promise.resolve(null)]);
      const conn = mine ?? own;
      const jobs = Object.fromEntries((Object.keys(JOB_FLAG) as DataJob[]).map((j) => [j, { flag: enabled(j), connected: Boolean(conn && conn.status === "connected" && !conn.paused), on: Boolean(conn && conn.jobs[j] === true) }]));
      return json({ jobs, shareNames: conn?.shareNames === true, canReview: staffLevel, canClean: staffLevel && notClient, accountLimited: Boolean(ctx.limitTo) || allowed !== null, demo: ctx.demo });
    }
    if (!enabled("ask_data")) return json({ error: "Ask your data is not switched on yet." }, 404);
    if (part === "history") return json({ turns: await listTurns(ctx.installationId, user) });
    if (part === "rows") {
      const hash = str(sp.get("hash"), 200), tenant = await tenantFor(ctx, await deps.allowed(), str(sp.get("account"), 64));
      if (!tenant) return json({ error: "Not found" }, 404);
      const r = await openRows(tenant, hash, Number(sp.get("offset") ?? 0), Number(sp.get("limit") ?? 25)).catch(() => null);
      return r ? json(r) : json({ error: "Not found" }, 404);
    }
    return json({ error: "Not found" }, 404);
  }

  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be used with AI." }, 403);
  const name = ctx.segments[2], b = await body(ctx), account = str(b.account, 64);
  const allowed = await deps.allowed();

  switch (name) {
    case "ask": {
      if (!enabled("ask_data")) return json({ error: "Ask your data is not switched on yet." }, 404);
      const q = cleanQuestion(b.question);
      const tenant = await tenantFor(ctx, allowed, account, rangeFrom(b.from, b.to));
      if (!tenant) return json({ error: "Not found" }, 404);
      const r = await askData({ tenant, userKey: user, question: q, deps: realDeps() });
      await audit(ctx, "ai.ask", { ok: r.ok, tools: r.ok ? r.tools : [], account: tenant.locationId, chars: q.length });
      if (!r.ok) return json({ ok: false, code: r.code, error: r.message }, r.code === "question" ? 400 : 200);
      const w = windowOf(tenant);
      const id = await saveTurn(ctx.installationId, user, tenant.locationId ?? "", q, r.answer, r.runId, { from: w.from, to: w.to });
      return json({ ok: true, turnId: id, answer: r.answer, window: r.window, account: tenant.locationId, cached: r.cached });
    }
    case "history-delete": {
      // A typed confirmation, as for every delete: "delete" for one question, "delete all" for the whole history. Only the caller's own turns can ever match.
      const c = str(b.confirm, 20).toLowerCase();
      if (b.all === true) { if (c !== "delete all") return json({ error: "Type delete all to confirm." }, 400); return json({ ok: true, deleted: await deleteAllTurns(ctx.installationId, user) }); }
      if (c !== "delete") return json({ error: "Type delete to confirm." }, 400);
      return (await deleteTurn(ctx.installationId, user, str(b.id, 40))) ? json({ ok: true }) : json({ error: "Not found" }, 404);
    }
    case "review": {
      if (!enabled("data_review")) return json({ error: "Data review is not switched on yet." }, 404);
      if (!staffLevel) return json({ error: "Ask the owner of your account to do this." }, 403);
      const tenant = await tenantFor(ctx, allowed, account);
      if (!tenant) return json({ error: "Not found" }, 404);
      const r = await runDataReview({ tenant, userKey: user, deps: realDeps(), fresh: b.fresh === true });
      await audit(ctx, "ai.data_review", { ok: r.ok, account: tenant.locationId });
      return json(r.ok ? { ok: true, summary: r.summary, findings: r.findings, runId: r.runId, scope: r.scope, cached: r.cached } : { ok: false, code: r.code, error: r.message });
    }
    case "clean": case "clean-preview": {
      if (!enabled("data_clean")) return json({ error: "Data cleaning proposals are not switched on yet." }, 404);
      if (!staffLevel || !notClient) return json({ error: "Ask the owner of your account to do this." }, 403);
      const tenant = await tenantFor(ctx, allowed, account);
      if (!tenant?.locationId) return json({ error: "Choose a client account." }, 400);
      if (name === "clean-preview") {
        // The ONLY way a batch leaves this screen: an ordinary Fix data preview for the kinds of fix in the batch. Nothing is changed; the person applies it in Fix data.
        const rules = (Array.isArray(b.actions) ? b.actions : []).map((a) => RULE_FOR[a as Action]).filter((r): r is "phone" | "name" | "email" => Boolean(r));
        const uniq = [...new Set(rules)];
        if (!uniq.length) return json({ error: "Nothing in this batch can be applied in Fix data." }, 400);
        const made = await createPreview(ctx.installationId, tenant.locationId, ctx.session.userName ?? ctx.session.userId ?? null, { rules: uniq, defaultCountryCode: null, tag: null });
        await audit(ctx, "ai.data_clean.preview", { account: tenant.locationId, runId: made.runId, total: made.total });
        return json({ ok: true, runId: made.runId, total: made.total, summary: made.summary });
      }
      const facts = await loadCleanFacts(ctx.installationId, tenant.locationId);
      const r = await runDataClean({ installationId: ctx.installationId, locationId: tenant.locationId, userKey: user, deps: realDeps(), facts, fresh: b.fresh === true });
      await audit(ctx, "ai.data_clean", { ok: r.ok, account: tenant.locationId });
      return json(r.ok ? { ok: true, proposals: r.proposals, merges: r.merges, rules: r.rules, runId: r.runId, cached: r.cached } : { ok: false, code: r.code, error: r.message });
    }
    case "dup-judge": {
      if (!enabled("dup_adjudicate")) return json({ error: "The duplicate judge is not switched on yet." }, 404);
      if (!notClient) return json({ error: "Not found" }, 404);
      const tenant = await tenantFor(ctx, allowed, account);
      const key = str(b.key, 300);
      if (!tenant?.locationId || !KEY.test(key)) return json({ error: "Choose a group." }, 400);
      const g = await groupByKey({ inst: ctx.installationId, allowed: [tenant.locationId], location: tenant.locationId }, tenant.locationId, key);
      if (!g) return json({ error: "Not found" }, 404);
      const r = await judgeDuplicates({ installationId: ctx.installationId, userKey: user, group: g, deps: realDeps(), fresh: b.fresh === true });
      await audit(ctx, "ai.dup_judge", { ok: r.ok, account: tenant.locationId });
      return json(r.ok ? { ok: true, verdict: r.verdict, reasons: r.reasons, namesDiffer: r.namesDiffer, downgraded: r.downgraded, protectedCount: r.protectedCount, runId: r.runId } : { ok: false, code: r.code, error: r.message });
    }
    case "setup-audit": {
      if (!enabled("setup_audit")) return json({ error: "The setup auditor is not switched on yet." }, 404);
      if (!staffLevel) return json({ error: "Ask the owner of your account to do this." }, 403);
      const tenant = await tenantFor(ctx, allowed, account);
      if (!tenant?.locationId) return json({ error: "Choose a client account." }, 400);
      const facts = setupFacts(await loadSetupInput(ctx.installationId, tenant.locationId));
      const r = await runSetupAudit({ installationId: ctx.installationId, locationId: tenant.locationId, userKey: user, deps: realDeps(), facts, fresh: b.fresh === true });
      await audit(ctx, "ai.setup_audit", { ok: r.ok, account: tenant.locationId });
      return json(r.ok ? { ok: true, issues: r.issues, allFine: r.allFine, facts: facts.lines.map((l) => ({ id: l.id, ok: l.ok, text: l.text })), runId: r.runId } : { ok: false, code: r.code, error: r.message });
    }
  }
  return json({ error: "Not found" }, 404);
}
