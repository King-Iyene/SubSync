import { atOf } from "../analytics/window-time";
import { defaultRange } from "../analytics/missed-calls";
import { parseWindow } from "../analytics/speed-window";
import { sql } from "../db";
import { isListId } from "../dial/dial";
import { callFirstFacts, cleanLines, coldFacts, coldReport, rankCallFirst, rowsOf, type CallFirstFact } from "../ai/lead-core";
import { draftReply, explainCold, jobReady, loadCold, peekCached, rankSignals, reasonLines, summariseLead, COLD_DAYS } from "../ai/lead-run";
import { LEAD_JOB_FLAG, LEAD_JOB_IDS, type LeadJobId } from "../ai/jobs-lead";
import { killedGlobally } from "../ai/gateway";
import { parseJsonAnswer } from "../ai/safety";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { sourceRowsPage } from "./dial-routes";
import { viewerOf } from "./people3-routes";

// /api/app/ai/lead/<status|summary|rank|rank-lines|cold|cold-explain|cold-rows|draft>: the four LEAD AI jobs (docs/AI_AGENTS_PLAN.md). Suggest only. Who is asking and which accounts they may
// read come from the verified session (`allowed`); the browser sends only ids that are re-checked against those accounts. Each job has its own flag (default off) on top of ai_byo. The ranking
// (rank) and the cold-lead counts (cold, cold-rows) work with no AI connection at all; the model only adds words.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type LeadHelpers = { allowed: () => Promise<string[] | null>; locationToken: (locationId: string) => Promise<string>; links: () => Promise<ReturnType<typeof deepLinks>> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const ACCOUNT = /^[A-Za-z0-9_-]{3,64}$/;
const RANK_POOL = 100, RANK_TOP = 10;

/** An account picked in the filter bar narrows inside the accounts already allowed; an id from anywhere else matches nothing. */
function narrow(allowed: string[] | null, id: string | null): string[] | null | "none" {
  if (!id) return allowed;
  if (!ACCOUNT.test(id) || (allowed && !allowed.includes(id))) return "none";
  return [id];
}
/** The one account a run is about, when the view is limited to one; '' (the company's own connection) otherwise. */
const scopeOf = (allowed: string[] | null): string => (allowed && allowed.length === 1 ? allowed[0] : "");
const bodyOf = async (ctx: Ctx): Promise<Record<string, unknown>> => { try { const x = await ctx.request.json(); return x && typeof x === "object" ? (x as Record<string, unknown>) : {}; } catch { return {}; } };
const s = (v: unknown, max = 128) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function handleAiLead(ctx: Ctx, h: LeadHelpers, on: (f: string) => boolean, user: string): Promise<Response> {
  const name = ctx.segments[2] ?? "";
  const flags = Object.fromEntries(LEAD_JOB_IDS.map((j) => [j, on(LEAD_JOB_FLAG[j]) && !ctx.demo])) as Record<LeadJobId, boolean>;
  const get = ctx.request.method === "GET", post = ctx.request.method === "POST";

  if (name === "status" && get) {
    // Which buttons to show. `flags` = the feature is switched on; `ready` = it can also use the person's AI right now (a connection, the job on, not paused).
    const allowed = await h.allowed();
    const asked = s(ctx.url.searchParams.get("locationId"), 64);
    if (asked && !(ACCOUNT.test(asked) && (!allowed || allowed.includes(asked)))) return json({ error: "Not found" }, 404);
    const loc = asked || scopeOf(allowed);
    const ready: Record<string, boolean> = {}, why: Record<string, string> = {};
    for (const j of LEAD_JOB_IDS) { if (!flags[j]) { ready[j] = false; continue; } const r = await jobReady(ctx.installationId, loc, j); ready[j] = r.ready; why[j] = r.reason; }
    return json({ flags, ready, why, killed: killedGlobally() });
  }
  const job = (({ summary: "lead_summary", draft: "reply_draft", rank: "call_first", "rank-lines": "call_first", cold: "cold_reasons", "cold-explain": "cold_reasons", "cold-rows": "cold_reasons" }) as Record<string, LeadJobId | undefined>)[name];
  if (!job) return json({ error: "Not found" }, 404);
  if (!flags[job]) return json({ error: ctx.demo ? "AI is not available in the sample data." : "This AI help is not switched on for your account yet." }, ctx.demo ? 403 : 404);
  const allowedAll = await h.allowed();
  const body = post ? await bodyOf(ctx) : {};
  const base = { installationId: ctx.installationId, userKey: user };

  // ---- one lead: summary (job 1) and reply draft (job 4)
  if (post && (name === "summary" || name === "draft")) {
    const b = body;
    const loc = s(b.locationId, 64), contact = s(b.contactId);
    if (!ACCOUNT.test(loc) || !ID.test(contact) || (allowedAll && !allowedAll.includes(loc))) return json({ ok: false, code: "not_found", error: "Lead not found.", sent: null });
    const args = { ...base, locationId: loc, allowed: allowedAll, contactId: contact, token: () => h.locationToken(loc) };
    if (name === "summary") return json(await summariseLead(args));
    return json(await draftReply({ ...args, channel: b.channel === "Email" ? "Email" : "SMS" }));
  }

  // ---- who to call first (job 2): the ranking is code; the one-line reasons are the AI add-on
  if (name === "rank" || name === "rank-lines") {
    const sp = name === "rank" ? ctx.url.searchParams : new URLSearchParams(Object.entries(body).filter(([, v]) => typeof v === "string") as Array<[string, string]>);
    if ((name === "rank" && !get) || (name === "rank-lines" && !post)) return json({ error: "Not found" }, 404);
    const list = sp.get("list") ?? "missed";
    if (!isListId(list)) return json({ error: "Unknown list" }, 400);
    const allowed = narrow(allowedAll, sp.get("f_account") ?? sp.get("account"));
    const now = Date.now();
    const wp = sp.get("from") !== null && sp.get("to") !== null ? parseWindow(sp.get("from"), sp.get("to"), now, atOf(sp)) : null;
    const range = wp && wp.ok ? { fromMs: wp.win.fromMs, toMs: wp.win.toMs } : defaultRange(now);
    const empty = { list, total: 0, considered: 0, leftOutDnd: 0, top: [], lines: {}, ready: false, sent: null };
    if (allowed === "none") return json(empty);
    const ownerId = ctx.kind === "client" ? (ctx.session.userId ?? "") : undefined;
    const out = await sourceRowsPage(ctx, allowed, list, { offset: 0, limit: RANK_POOL, ...range, ownerId }).catch(() => null);
    if (!out || !out.rows.length) return json({ ...empty, total: out?.total ?? 0 });
    const [signals, links] = await Promise.all([rankSignals(ctx.installationId, out.rows, allowed), h.links()]);
    const { ranked, leftOutDnd } = rankCallFirst(out.rows.map((r) => {
      const sg = signals.get(`${r.locationId}:${r.contactId}`);
      return { ...r, key: `${r.locationId}:${r.contactId}`, tags: sg?.tags ?? [], replies: sg?.replies ?? 0 };
    }));
    const top = ranked.slice(0, RANK_TOP);
    const loc = scopeOf(allowed);
    const st = await jobReady(ctx.installationId, loc, "call_first");
    const asked = top.map((_, i) => String(i + 1));
    const facts = callFirstFacts(top.map((t, i): CallFirstFact => ({ n: i + 1, name: t.name, source: t.source ?? null, reason: t.reason, tags: t.tags })), st.shareNames);
    let lines: Record<string, string> = {}, result: Awaited<ReturnType<typeof reasonLines>>["result"] | null = null;
    if (name === "rank-lines") {
      if (!st.ready) return json({ ok: false, code: st.reason, error: "Connect your AI and switch this job on in Settings, AI.", sent: null });
      if (!top.length) return json({ ok: false, code: "empty", error: "Nobody to rank.", sent: null });
      const r = await reasonLines({ ...base, locationId: loc }, facts, asked);
      lines = r.lines; result = r.result;
    } else if (st.ready && top.length) {
      const hit = await peekCached({ ...base, locationId: loc }, "call_first", facts).catch(() => null);
      lines = hit ? cleanLines(parseJsonAnswer(hit), asked) : {};
    }
    return json({
      list, total: out.total, considered: out.rows.length, leftOutDnd, ready: st.ready, sent: facts, ...(result ? { ok: result.ok, error: result.ok ? null : result.error, code: result.ok ? null : result.code, runId: result.ok ? result.runId : null, costUsd: result.ok ? result.costUsd : null } : {}),
      lines,
      top: top.map((t, i) => ({
        n: i + 1, contactId: t.contactId, locationId: t.locationId, locationName: t.locationName, name: t.name, phone: t.phone, timeZone: t.timeZone, source: t.source ?? null, noRecord: t.noRecord === true,
        openValue: t.openValue, ageHours: t.ageHours, score: t.score, factors: t.factors, reason: t.reason, url: links.contact(t.locationId, t.contactId),
      })),
    });
  }

  // ---- why leads go cold (job 3): the patterns are code and every count opens exactly its rows; the explanation is the AI add-on
  const allowed = narrow(allowedAll, ctx.url.searchParams.get("account") ?? (typeof body.account === "string" ? body.account : null));
  if (allowed === "none") return json({ error: "Not found" }, 404);
  const now = Date.now();
  const ownerId = ctx.kind !== "agency" && viewerOf(ctx).level === "self" ? (ctx.session.userId ?? "") : undefined;
  const load = await loadCold(ctx.installationId, allowed, now, ownerId);
  const report = coldReport(load.rows, now, { windowDays: COLD_DAYS });
  const loc = scopeOf(allowed);
  const run = { ...base, locationId: loc };

  if (name === "cold" && get) {
    const st = await jobReady(ctx.installationId, loc, "cold_reasons");
    const facts = coldFacts(report);
    const hit = st.ready && report.cold >= 5 ? await peekCached(run, "cold_reasons", facts).catch(() => null) : null;
    return json({ report, truncated: load.truncated, ready: st.ready, why: st.reason, enough: report.cold >= 5, explanation: hit ? parseJsonAnswer(hit) : null, sent: facts });
  }
  if (name === "cold-explain" && post) {
    if (report.cold < 5) return json({ ok: false, code: "thin", error: "Fewer than 5 leads went unanswered, which is too few to explain a pattern.", sent: null });
    const st = await jobReady(ctx.installationId, loc, "cold_reasons");
    if (!st.ready) return json({ ok: false, code: st.reason, error: "Connect your AI and switch this job on in Settings, AI.", sent: null });
    return json(await explainCold(run, report));
  }
  if (name === "cold-rows" && get) {
    const key = s(ctx.url.searchParams.get("pattern"), 120) || "all";
    const rows = rowsOf(load.rows, report, key, now);
    if (!rows) return json({ error: "Not found" }, 404);
    const sorted = [...rows].sort((a, b) => b.leadAt - a.leadAt || a.key.localeCompare(b.key));
    const size = [20, 50, 100].includes(Number(ctx.url.searchParams.get("size"))) ? Number(ctx.url.searchParams.get("size")) : 20;
    const page = Math.max(0, Math.min(100_000, Math.floor(Number(ctx.url.searchParams.get("page")) || 0)));
    const slice = sorted.slice(page * size, page * size + size);
    const names = new Map((await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and location_id = any(${[...new Set(slice.map((r) => r.locationId))]}::text[])`).map((l) => [l.location_id as string, (l.name as string | null) ?? "Client account"]));
    const links = await h.links();
    return json({
      pattern: key, label: key === "all" ? "Leads no person replied to" : report.patterns.find((p) => p.key === key)?.label ?? key, total: rows.length, page, size, truncated: load.truncated,
      rows: slice.map((r) => ({ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: names.get(r.locationId) ?? null, leadAt: r.leadAt, source: r.source, url: links.contact(r.locationId, r.contactId) })),
    });
  }
  return json({ error: "Not found" }, 404);
}
