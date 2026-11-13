import { briefFor, getPrefs, type BriefFlags } from "../analytics/br-queries";
import { accountNote, companyNote, peekCompanyNote, realDeps } from "../ai/brief";
import { killedGlobally } from "../ai/gateway";
import { JOBS, liveJobs } from "../ai/jobs";
import { chatgptKeys, chatgptRedirect, callbackUrl, chatgptAuthorizeUrl, exchangeChatgpt, exchangeOpenRouter, newState, openrouterAuthorizeUrl, pkcePair, OPENROUTER_BASE } from "../ai/oauth";
import { AiError, isProvider, listModels, METHOD_COST, PROVIDER_HELP, PROVIDER_NAME, PROVIDERS, recommendedModel, safeBaseUrl, type Cfg, type Fetch, type ProviderId } from "../ai/providers";
import { deleteConnection, historyFor, publicConnection, saveConnection, sentFor, setFeedback, startPending, takePending, updateSettings, usage, dbStore } from "../ai/store";
import { sql } from "../db";
import { appUrl } from "../connections/flow";
import { can, personFromSession, type Person } from "../connections/person";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";
import { handleAiDeals, isDealPart } from "./ai-deal-routes";
import { DEAL_JOB_FLAG, DEAL_JOB_IDS, isDealJobId } from "../ai/deal-jobs";

// /api/app/ai?part=status|usage|history|sent|brief-note and POST /api/app/ai/act/<models|connect|start|update|rotate|disconnect|preview|brief-note|feedback>.
// Who the caller is, and which connection they manage, come ONLY from the signed session: the company's own connection (scope '') for a company owner or administrator and for a business
// administrator; one client account's own connection for that account's administrator. Nothing here ever returns a key, a token, a verifier, or anyone's prompt or answer but the caller's own.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type Deps = { allowed: () => Promise<string[] | null> };
const fetcher: Fetch = (url, init) => fetch(url, init as RequestInit) as never;
const KEY = /^[\x21-\x7e]{8,512}$/;
const MODEL = /^[A-Za-z0-9._:/@+-]{1,200}$/;

const hits = new Map<string, number[]>();
/** A person may try to connect or test at most 10 times a minute (the server makes these requests to a provider the person names). */
function tooFast(user: string): boolean {
  const now = Date.now(), list = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  list.push(now); hits.set(user, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 10;
}

/** Which connection this person manages: the scope, or why not. */
function manage(ctx: Ctx): { person: Person; scope: string; level: "company" | "account" } | null {
  const person = personFromSession(ctx.session, ctx.kind, ctx.limitTo);
  if (!person || !can(person.role, "connect_workspace") || person.role === "agency_staff") return null;
  if (person.kind === "client") return person.homeLocationId ? { person, scope: person.homeLocationId, level: "account" } : null;
  return { person, scope: "", level: "company" };
}

const body = async (ctx: Ctx): Promise<Record<string, unknown>> => { try { const x = await ctx.request.json(); return x && typeof x === "object" ? (x as Record<string, unknown>) : {}; } catch { return {}; } };
const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function handleAi(ctx: Ctx, deps: Deps): Promise<Response> {
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  const on = (f: string) => ent.features[f as Feature] === true;
  if (!on("ai_byo")) return json({ error: "AI is not switched on for your account yet." }, 404);
  const isAct = ctx.segments[1] === "act", part = ctx.url.searchParams.get("part");
  const m = manage(ctx), user = ctx.session.userId ?? null;
  if (!user) return json({ error: "Please sign in again" }, 401);
  const chatgpt = on("ai_chatgpt");
  // The four deal jobs (health, follow-up plan, win and loss review, forecast in words) answer from their own file; each has its own flag on top of ai_byo.
  if (isDealPart(part, isAct, ctx.segments[2])) return handleAiDeals(ctx, deps, on, user);
  const dealFlags = Object.fromEntries(DEAL_JOB_IDS.map((j) => [j, on(DEAL_JOB_FLAG[j])]));

  if (!isAct) {
    if (part === "status" || !part) {
      const methods = { key: true, openrouter: true, chatgpt: !chatgpt ? "off" : chatgptKeys() ? "ready" : "coming" };
      if (!m) return json({ canManage: false, flags: { brief: on("ai_brief") }, killed: killedGlobally() });
      const [conn, u, own] = await Promise.all([
        publicConnection(ctx.installationId, m.scope), usage(ctx.installationId, m.scope),
        m.level === "company" ? sql()`select count(*)::int n from ai_connections where installation_id = ${ctx.installationId} and location_id <> ''` : Promise.resolve([{ n: 0 }]),
      ]);
      return json({
        canManage: true, level: m.level, connection: conn, usage: u, killed: killedGlobally(), flags: { brief: on("ai_brief"), ...dealFlags }, methods,
        providers: PROVIDERS.map((id) => ({ id, name: PROVIDER_NAME[id], ...PROVIDER_HELP[id] })), methodCost: METHOD_COST,
        jobs: liveJobs().filter((j) => !isDealJobId(j.id) || on(DEAL_JOB_FLAG[j.id])).map((j) => ({ id: j.id, title: j.title, approval: j.approval })), accountConnections: Number(own[0]?.n ?? 0),
        note: "A ChatGPT or Claude chat subscription cannot be used with a key. Use an API key, OpenRouter, or (when OpenAI approves it) sign in with ChatGPT.",
      });
    }
    if (!m) return json({ error: "Ask an administrator." }, 403);
    if (part === "history") return json({ rows: await historyFor(ctx.installationId, m.scope, user) });
    if (part === "sent") {
      const r = await sentFor(ctx.installationId, m.scope, str(ctx.url.searchParams.get("run"), 40));
      return r ? json(r) : json({ error: "Not found" }, 404);
    }
    if (part === "usage") return json(await usage(ctx.installationId, m.scope));
    if (part === "brief-note") return briefNote(ctx, on, user, false);
    return json({ error: "Not found" }, 404);
  }

  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const name = ctx.segments[2];
  if (name === "brief-note") return briefNote(ctx, on, user, true);
  if (!m) return json({ error: "Ask an administrator of your account to do this." }, 403);
  const b = await body(ctx);

  switch (name) {
    case "models": case "connect": case "rotate": {
      if (tooFast(user)) return json({ error: "Too many tries. Wait a minute." }, 429);
      const saved = await dbStore.connection(ctx.installationId, m.scope);
      const provider = name === "rotate" && saved ? saved.provider : (b.provider as unknown);
      if (!isProvider(provider)) return json({ error: "Choose a provider." }, 400);
      let baseUrl: string | null = null;
      if (provider === "compatible") {
        const u = safeBaseUrl(name === "rotate" && saved?.baseUrl ? saved.baseUrl : str(b.baseUrl));
        if (!u.ok) return json({ error: u.error }, 400);
        baseUrl = u.url;
      }
      const useSaved = name === "models" && b.useSaved === true && saved;
      const apiKey = useSaved ? saved.apiKey : str(b.apiKey, 600);
      if (!KEY.test(apiKey)) return json({ error: "Paste the key exactly as your provider showed it." }, 400);
      const cfg: Cfg = { provider, baseUrl: useSaved ? saved.baseUrl : baseUrl, apiKey, model: "" };
      let models: string[];
      try { models = await listModels(cfg, fetcher); } catch (e) { return json({ error: e instanceof AiError ? e.message : "We could not test the connection." }, 400); }
      if (!models.length) return json({ error: "The connection works but offers no models for this key." }, 400);
      const recommended = recommendedModel(provider, models);
      if (name === "models") return json({ ok: true, models, recommended });
      const model = str(b.model, 200) || (name === "rotate" && saved ? saved.model : recommended ?? models[0]);
      if (!MODEL.test(model) || !models.includes(model)) return json({ error: "Choose a model from the list." }, 400);
      await saveConnection(ctx.installationId, m.scope, { provider, method: name === "rotate" && saved ? saved.method : "key", baseUrl, apiKey, model, by: user });
      return json({ ok: true, connection: await publicConnection(ctx.installationId, m.scope) });
    }
    case "start": {
      // One-click connect. OpenRouter (PKCE) is live; ChatGPT plan sign-in answers "coming" until OpenAI approves our app and its settings exist.
      const method = b.method;
      const base = appUrl();
      if (!base) return json({ error: "Sign-in is not set up on this server yet." }, 503);
      const { verifier, challenge } = pkcePair(), state = newState();
      if (method === "openrouter") {
        await startPending({ state, installationId: ctx.installationId, scope: m.scope, userKey: user, method: "openrouter", verifier });
        return json({ ok: true, url: openrouterAuthorizeUrl(callbackUrl(base, state), challenge) });
      }
      if (method === "chatgpt") {
        const keys = chatgptKeys();
        if (!chatgpt || !keys) return json({ error: "Sign in with ChatGPT is coming when OpenAI approves our app.", comingSoon: true }, 404);
        await startPending({ state, installationId: ctx.installationId, scope: m.scope, userKey: user, method: "chatgpt", verifier });
        return json({ ok: true, url: chatgptAuthorizeUrl(keys, chatgptRedirect(base), state, challenge) });
      }
      return json({ error: "Choose a way to connect." }, 400);
    }
    case "update": {
      const patch: Parameters<typeof updateSettings>[2] = {};
      if (b.model !== undefined) { const mo = str(b.model, 200); if (!MODEL.test(mo)) return json({ error: "Choose a model from the list." }, 400); patch.model = mo; }
      if (b.capUsd !== undefined) { const c = Number(b.capUsd); if (!Number.isFinite(c) || c < 0 || c > 1000) return json({ error: "The monthly limit must be between 0 and 1000 dollars." }, 400); patch.capUsd = Math.round(c * 100) / 100; }
      if (typeof b.paused === "boolean") patch.paused = b.paused;
      if (typeof b.shareNames === "boolean") patch.shareNames = b.shareNames;
      if (b.jobs && typeof b.jobs === "object") patch.jobs = Object.fromEntries(Object.entries(b.jobs as Record<string, unknown>).filter(([k]) => k in JOBS).map(([k, v]) => [k, v === true]));
      return (await updateSettings(ctx.installationId, m.scope, patch, user)) ? json({ ok: true, connection: await publicConnection(ctx.installationId, m.scope) }) : json({ error: "Connect your AI account first." }, 404);
    }
    case "disconnect": {
      // A typed confirmation naming the connection, as for every delete.
      if (str(b.confirm, 20).toLowerCase() !== "disconnect") return json({ error: "Type disconnect to confirm. The key is deleted." }, 400);
      await deleteConnection(ctx.installationId, m.scope, user);
      return json({ ok: true });
    }
    case "feedback": {
      const v = b.value === 1 || b.value === -1 ? b.value : null;
      if (v === null) return json({ error: "Bad request" }, 400);
      return (await setFeedback(ctx.installationId, m.scope, str(b.runId, 40), v)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
    }
    case "preview": {
      if (!on("ai_brief")) return json({ error: "AI wording is not switched on for your account yet." }, 404);
      const prefs = await getPrefs(ctx.installationId, user);
      if (m.level === "account") {
        const r = await accountNote({ installationId: ctx.installationId, userKey: user, trigger: "preview", fresh: true, locationId: m.scope });
        return json(shape(r.result, r.facts));
      }
      const loc = str(b.locationId, 64);
      if (loc) {
        const allowed = await deps.allowed();
        if (allowed && !allowed.includes(loc)) return json({ error: "Not found" }, 404);
        const known = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${loc}`;
        if (!known.length) return json({ error: "Not found" }, 404);
        const r = await accountNote({ installationId: ctx.installationId, userKey: user, trigger: "preview", fresh: true, locationId: loc });
        return json(shape(r.result, r.facts));
      }
      if (viewerOf(ctx).level !== "all" || ctx.limitTo !== null) return json({ error: "Ask the owner of your account to do this." }, 403);
      const r = await companyNote({ installationId: ctx.installationId, userKey: user, trigger: "preview", fresh: true }, await briefFor(ctx.installationId, prefs, flagsOf(on)));
      return json(shape(r.result, r.facts));
    }
  }
  return json({ error: "Not found" }, 404);
}

type Result = Awaited<ReturnType<typeof companyNote>>["result"];
const shape = (r: Result, facts: { text: string; fields: string[]; includesNames: boolean } | null) =>
  r.ok ? { ok: true, text: r.text, runId: r.runId, costUsd: r.costUsd, sent: facts } : { ok: false, code: r.code, error: r.message, sent: facts };

const flagsOf = (on: (f: string) => boolean): BriefFlags => ({ cf_save: on("cf_save"), cf_recover: on("cf_recover"), cf_deals: on("cf_deals"), wg_wallet: on("wg_wallet"), pm_module: on("pm_module"), td_today: on("td_today"), fn_today: on("fn_today"), sp_ignored: on("sp_ignored_leads") });

/** The AI wording for today's brief. GET only reads what was already written for exactly today's numbers; POST writes it (once per distinct input) when the account has a connection. */
async function briefNote(ctx: Ctx, on: (f: string) => boolean, user: string, generate: boolean): Promise<Response> {
  const empty = { note: null, runId: null };
  if (!on("ai_brief") || !on("br_brief") || viewerOf(ctx).level !== "all" || ctx.limitTo !== null) return json(empty);
  const conn = await publicConnection(ctx.installationId, "");
  if (!conn || conn.paused || conn.status !== "connected" || conn.jobs.brief !== true) return json(empty);
  const b = await briefFor(ctx.installationId, await getPrefs(ctx.installationId, user), flagsOf(on));
  const cached = await peekCompanyNote(ctx.installationId, b);
  if (cached !== null || !generate) return json({ note: cached, runId: null });
  if (!b.items.length) return json(empty);
  const r = await companyNote({ installationId: ctx.installationId, userKey: user, trigger: "view", deps: realDeps() }, b);
  return json(r.result.ok ? { note: r.result.text, runId: r.result.runId } : { note: null, runId: null, reason: r.result.message });
}

// ---------------- the page OpenRouter and OpenAI send the person back to ----------------

export type SignInDone = { ok: true; message: string } | { ok: false; error: string };

/** Finishes one sign-in. The single-use state (made when the person pressed Connect, from their verified session) names the company, the connection and the person; nothing else is trusted. */
export async function completeAiSignIn(state: string | null, code: string | null, f: Fetch = fetcher): Promise<SignInDone> {
  if (!state || !code || code.length > 2000) return { ok: false, error: "This link has expired or was already used. Start again from Settings." };
  const p = await takePending(state);
  if (!p) return { ok: false, error: "This link has expired or was already used. Start again from Settings." };
  try {
    if (p.method === "openrouter") {
      const key = await exchangeOpenRouter(code, p.verifier, f);
      let models: string[] = [];
      try { models = await listModels({ provider: "compatible", baseUrl: OPENROUTER_BASE, apiKey: key, model: "" }, f); } catch { /* the default router model below still works */ }
      const model = models.find((m) => /gpt-4o-mini$|haiku|flash$/.test(m)) ?? "openrouter/auto";
      await saveConnection(p.installationId, p.scope, { provider: "compatible", method: "openrouter", baseUrl: OPENROUTER_BASE, apiKey: key, model, by: p.userKey });
      return { ok: true, message: "OpenRouter is connected. It uses your own OpenRouter credit." };
    }
    const keys = chatgptKeys(), base = appUrl();
    if (!keys || !base) return { ok: false, error: "Sign in with ChatGPT is not available yet." };
    const t = await exchangeChatgpt(keys, code, p.verifier, chatgptRedirect(base), f);
    const models = await listModels({ provider: "openai", baseUrl: null, apiKey: t.accessToken, model: "" }, f).catch(() => []);
    await saveConnection(p.installationId, p.scope, { provider: "openai", method: "chatgpt", baseUrl: null, apiKey: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, model: recommendedModel("openai", models) ?? models[0] ?? "gpt-4o-mini", by: p.userKey });
    return { ok: true, message: "ChatGPT is connected. It uses your ChatGPT plan allowance." };
  } catch (e) {
    return { ok: false, error: e instanceof AiError ? e.message : "Something went wrong on our side. Nothing was changed. Try again in a moment." };
  }
}

export type { ProviderId };
