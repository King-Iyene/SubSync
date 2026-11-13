import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { briefFacts, accountFacts } from "@/lib/ai/brief";
import { runJob, type AiStore, type Conn, type Deps, type JobRequest, type RunRow } from "@/lib/ai/gateway";
import { JOBS } from "@/lib/ai/jobs";
import { chatgptKeys, exchangeOpenRouter, openrouterAuthorizeUrl, pkcePair } from "@/lib/ai/oauth";
import { complete, estimateCostUsd, listModels, recommendedModel, safeBaseUrl, type Cfg, type Fetch } from "@/lib/ai/providers";
import { checkWords, numbersNotInInput, validateJson } from "@/lib/ai/safety";
import { runTool, type AiTool } from "@/lib/ai/tools";
import type { Brief } from "@/lib/analytics/br-core";

// Golden tests for the bring-your-own-AI platform. No real provider is ever called: every request goes to a fake fetch.

const brief = (): Brief => ({
  day: "2026-11-12", dayText: "Thursday 12 Nov", headline: "h", more: 0, accounts: 12, formula: "f", bySection: {} as never,
  dollar: { amount: 4200, text: "t" },
  items: [
    { key: "a", section: "recover", title: "14 missed leads for Acme Plumbing", why: "Ann Lee waited", count: 14, dollars: 2000, tier: 2, hash: "#today" },
    { key: "b", section: "attention", title: "3 appointments with no outcome", why: "w", count: 3, dollars: null, tier: 3, hash: "#today" },
  ],
});

function memStore(conn: Partial<Conn> | null, spend = 0) {
  const runs: RunRow[] = [];
  const store: AiStore = {
    connection: async (_i, scope) => (conn && (conn.scope ?? "") === scope ? ({ scope, method: "key", provider: "openai", baseUrl: null, apiKey: "sk-test-1234567890", model: "gpt-x", status: "connected", monthlyCapUsd: 5, paused: false, shareNames: false, jobs: { brief: true }, ...conn } as Conn) : null),
    cachedRun: async (_i, _s, key) => { const r = runs.find((x) => x.idempotencyKey === key && x.status === "ok"); return r ? { id: "run-1", output: r.output ?? "" } : null; },
    monthSpendUsd: async () => spend + runs.reduce((a, r) => a + r.costUsd, 0),
    runsSince: async () => runs.length,
    insertRun: async (r) => { runs.push(r); return `run-${runs.length}`; },
    markNeedsAttention: async () => undefined,
  };
  return { store, runs };
}
const openaiReply = (content: string, extra: Record<string, unknown> = {}, usage = { prompt_tokens: 100, completion_tokens: 50 }) => ({ choices: [{ message: { content, ...extra } }], usage });
const okFetch = (replies: unknown[], calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = []): Fetch => async (url, init) => {
  calls.push({ url, init });
  const r = replies.shift();
  if (typeof r === "number") return { status: r, text: async () => "{}" };
  return { status: 200, text: async () => JSON.stringify(r) };
};
const deps = (store: AiStore, fetch: Fetch, more: Partial<Deps> = {}): Deps => ({ store, fetch, sleep: async () => undefined, killAll: () => false, now: () => Date.UTC(2026, 10, 12, 7), ...more });
const request = (facts = briefFacts(brief(), false), more: Partial<JobRequest> = {}): JobRequest => ({ installationId: "inst-1", locationId: "", userKey: "u1", job: "brief", trigger: "preview", input: facts, ...more });

describe("brief facts and privacy", () => {
  it("sends counts and dollars only by default", () => {
    const f = briefFacts(brief(), false);
    expect(f.includesNames).toBe(false);
    expect(f.text).not.toMatch(/Acme|Ann Lee/);
    expect(f.text).toContain("$4,200");
    expect(f.text).toContain("count: 14");
  });
  it("adds titles and reasons only with the opt-in, and says so in the field list", () => {
    const f = briefFacts(brief(), true);
    expect(f.text).toContain("Acme Plumbing");
    expect(f.includesNames).toBe(true);
    expect(f.fields.join(" ")).toMatch(/names/);
  });
  it("an account note names the account only with the opt-in", () => {
    const n = { name: "Acme", leads: 40, answeredInTime: 30, targetMinutes: 15, neverAnswered: 4, noShowsToRecover: 2, unmarked: 1 };
    expect(accountFacts(n, false).text).not.toContain("Acme");
    expect(accountFacts(n, true).text).toContain("Acme");
  });
});

describe("safety checks", () => {
  const input = briefFacts(brief(), false).text;
  it("accepts words that only use the given figures", () => {
    expect(checkWords(input, "About $4,200 is at risk across 12 client accounts. Start with the 14 missed leads.", 900)).toEqual({ ok: true });
  });
  it("rejects a number we did not give it, including spelled-out and rounded ones", () => {
    expect(checkWords(input, "About $4,300 is at risk.", 900).ok).toBe(false);
    expect(checkWords(input, "Nearly four thousand dollars", 900).ok).toBe(false);
    expect(checkWords(input, "About $4.2k is at risk", 900).ok).toBe(false);
    expect(numbersNotInInput(input, "14 leads, 99 calls")).toEqual(["99"]);
  });
  it("rejects promises, claims that something was done, links and vendor names", () => {
    for (const bad of ["We sent a message to all 14.", "I guarantee this will recover $4,200.", "See https://x.example for 14 more", "Fix it in GoHighLevel, 14 leads"]) expect(checkWords(input, bad, 900).ok).toBe(false);
  });
  it("rejects an answer over the length limit and an empty one", () => {
    expect(checkWords(input, "a".repeat(901), 900).ok).toBe(false);
    expect(checkWords(input, "  ", 900).ok).toBe(false);
  });
  it("validates a JSON shape", () => {
    const s = { type: "object", props: { a: { type: "string", maxLength: 3 }, n: { type: "number", integer: true } } } as const;
    expect(validateJson({ a: "ok", n: 2 }, s).ok).toBe(true);
    expect(validateJson({ a: "toolong", n: 2 }, s).ok).toBe(false);
    expect(validateJson({ a: "ok" }, s).ok).toBe(false);
  });
});

describe("the gateway", () => {
  it("returns the model's words when the number check passes, and logs one run with the method, tokens and cost", async () => {
    const { store, runs } = memStore({ method: "openrouter" });
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const r = await runJob(deps(store, okFetch([openaiReply("About $4,200 is at risk across 12 client accounts. Start with the 14 missed leads.")], calls)), request());
    expect(r.ok).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ok", method: "openrouter", tokensIn: 100, tokensOut: 50, includesNames: false });
    expect(runs[0].costUsd).toBeGreaterThan(0);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].init.headers.Authorization).toBe("Bearer sk-test-1234567890");
    expect(calls[0].init.redirect).toBe("error");
    expect(runs[0].prompt).not.toContain("sk-test");
  });
  it("rejects an output with a number that was not in the input, shows nothing, and still logs the cost", async () => {
    const { store, runs } = memStore({});
    const r = await runJob(deps(store, okFetch([openaiReply("About $9,999 is at risk.")])), request());
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(runs[0].status).toBe("rejected");
  });
  it("does not call the provider twice for the same input (idempotency), but a preview is always fresh", async () => {
    const { store } = memStore({});
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const text = "About $4,200 is at risk across 12 client accounts.";
    const f = okFetch([openaiReply(text), openaiReply(text), openaiReply(text)], calls);
    await runJob(deps(store, f), request(undefined, { trigger: "view" }));
    const again = await runJob(deps(store, f), request(undefined, { trigger: "view" }));
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(calls).toHaveLength(1);
    await runJob(deps(store, f), request(undefined, { fresh: true }));
    expect(calls).toHaveLength(2);
  });
  it("refuses names unless the account opted in, before anything is sent", async () => {
    const { store } = memStore({ shareNames: false });
    const calls: unknown[] = [];
    const r = await runJob(deps(store, async (u, i) => { calls.push([u, i]); return { status: 200, text: async () => "{}" }; }), request(briefFacts(brief(), true)));
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(calls).toHaveLength(0);
    const ok = memStore({ shareNames: true });
    expect((await runJob(deps(ok.store, okFetch([openaiReply("Ann Lee has waited; 14 missed leads.")])), request(briefFacts(brief(), true)))).ok).toBe(true);
  });
  it("pauses at the monthly cap and sends nothing", async () => {
    const { store } = memStore({ monthlyCapUsd: 5 }, 5);
    const calls: unknown[] = [];
    const r = await runJob(deps(store, async () => { calls.push(1); return { status: 200, text: async () => "{}" }; }), request());
    expect(r).toMatchObject({ ok: false, code: "cap" });
    expect(calls).toHaveLength(0);
  });
  it("honours the customer's pause, the job switch, a missing connection and the global kill switch", async () => {
    const never: Fetch = async () => { throw new Error("must not be called"); };
    expect(await runJob(deps(memStore({ paused: true }).store, never), request())).toMatchObject({ code: "paused" });
    expect(await runJob(deps(memStore({ jobs: { brief: false } }).store, never), request())).toMatchObject({ code: "job_off" });
    expect(await runJob(deps(memStore(null).store, never), request())).toMatchObject({ code: "no_connection" });
    expect(await runJob(deps(memStore({}).store, never, { killAll: () => true }), request())).toMatchObject({ code: "killed" });
    expect(await runJob(deps(memStore({ status: "needs_attention" }).store, never), request())).toMatchObject({ code: "needs_attention" });
  });
  it("a planned job cannot run", async () => {
    const saved = JOBS.ask_data.status; JOBS.ask_data.status = "planned"; // ask_data is live now (PR data jobs): the check is that ANY planned job is refused
    try { expect(await runJob(deps(memStore({}).store, okFetch([])), request(undefined, { job: "ask_data" }))).toMatchObject({ code: "planned" }); } finally { JOBS.ask_data.status = saved; }
  });
  it("retries a busy provider with backoff, then gives up in plain words without the provider's text", async () => {
    const { store, runs } = memStore({});
    const sleeps: number[] = [];
    const r = await runJob(deps(store, okFetch([429, 429, 429]), { sleep: async (ms) => { sleeps.push(ms); } }), request());
    expect(r).toMatchObject({ ok: false, code: "error" });
    expect(sleeps).toEqual([400, 800]);
    expect(runs[0]).toMatchObject({ status: "error" });
    expect(JSON.stringify(r)).not.toContain("sk-test");
  });
  it("a rejected key is permanent: one try, and the connection is marked as needing attention", async () => {
    const { store } = memStore({});
    let marked = 0;
    store.markNeedsAttention = async () => { marked++; };
    let n = 0;
    const r = await runJob(deps(store, async () => { n++; return { status: 401, text: async () => '{"error":"bad key sk-test-1234567890"}' }; }), request());
    expect(n).toBe(1);
    expect(marked).toBe(1);
    expect(JSON.stringify(r)).not.toContain("sk-test");
  });
  it("uses the account's own connection first, then the company's", async () => {
    const seen: string[] = [];
    const store: AiStore = { ...memStore({ scope: "" }).store, connection: async (_i, scope) => { seen.push(scope); return scope === "" ? ({ scope: "", method: "key", provider: "openai", baseUrl: null, apiKey: "k-1234567890", model: "m", status: "connected", monthlyCapUsd: 5, paused: false, shareNames: false, jobs: { brief: true } } as Conn) : null; } };
    await runJob(deps(store, okFetch([openaiReply("12 accounts")])), request(undefined, { locationId: "LOC1" }));
    expect(seen).toEqual(["LOC1", ""]);
  });
});

describe("tool calling and JSON answers (extension points)", () => {
  const saved = { ...JOBS.ask_data };
  beforeEach(() => { Object.assign(JOBS.ask_data, { status: "live", system: "s", tools: ["count_leads"], maxToolRounds: 2, output: { kind: "json", maxChars: 600, schema: { type: "object", props: { answer: { type: "string", maxLength: 200 }, count: { type: "number", integer: true } } } } }); });
  afterEach(() => { Object.assign(JOBS.ask_data, saved); });
  const tool: AiTool = {
    spec: { name: "count_leads", description: "d", parameters: { type: "object", properties: {} } },
    parse: (a) => (a.days === undefined || typeof a.days === "number" ? { ok: true, args: a } : { ok: false, error: "days must be a number" }),
    run: async (t) => ({ data: { leads: t.locationId === "L1" ? 17 : 99 }, rowsHash: "#speed", rowCount: 17 }),
  };
  const call = (id: string, name: string) => openaiReply("", { tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }] });
  it("runs a whitelisted tool bound to the verified tenant and accepts an answer that quotes its numbers", async () => {
    const { store, runs } = memStore({ jobs: { ask_data: true } });
    const r = await runJob(deps(store, okFetch([call("c1", "count_leads"), openaiReply('{"answer":"There were 17 leads.","count":17}')]), { tools: { count_leads: tool } }),
      { installationId: "inst-1", locationId: "", userKey: "u1", job: "ask_data", trigger: "ask", input: { text: "How many leads?", fields: ["the question"], includesNames: false }, tenant: { installationId: "inst-1", locationId: "L1" } });
    expect(r).toMatchObject({ ok: true, json: { answer: "There were 17 leads.", count: 17 } });
    expect(runs[0].toolCalls).toBe(1);
  });
  it("rejects an answer with a number no tool returned, and a tool that is not on the whitelist is refused", async () => {
    const { store } = memStore({ jobs: { ask_data: true } });
    const r = await runJob(deps(store, okFetch([call("c1", "count_leads"), openaiReply('{"answer":"There were 18 leads.","count":18}')]), { tools: { count_leads: tool } }),
      { installationId: "inst-1", locationId: "", userKey: "u1", job: "ask_data", trigger: "ask", input: { text: "How many leads?", fields: [], includesNames: false }, tenant: { installationId: "inst-1", locationId: "L1" } });
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    const out = await runTool({ count_leads: tool }, ["other"], { installationId: "i", locationId: null }, { name: "count_leads", args: {} });
    expect(out.ok).toBe(false);
    const raw = await runTool({ count_leads: tool }, ["count_leads"], { installationId: "i", locationId: null }, { name: "drop_table", args: {} });
    expect(raw.ok).toBe(false);
    expect((await runTool({ count_leads: tool }, ["count_leads"], { installationId: "i", locationId: null }, { name: "count_leads", args: { days: "x" } })).ok).toBe(false);
  });
  it("rejects an answer that is not the expected shape", async () => {
    const { store } = memStore({ jobs: { ask_data: true } });
    const r = await runJob(deps(store, okFetch([openaiReply('{"answer":5}')]), { tools: { count_leads: tool } }),
      { installationId: "inst-1", locationId: "", userKey: "u1", job: "ask_data", trigger: "ask", input: { text: "q", fields: [], includesNames: false } });
    expect(r).toMatchObject({ ok: false, code: "rejected" });
  });
});

describe("provider adapters", () => {
  const cfg = (provider: Cfg["provider"], baseUrl: string | null = null): Cfg => ({ provider, baseUrl, apiKey: "KEY-1234567890", model: "m1" });
  const req = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };
  it("Anthropic: Messages API, x-api-key and anthropic-version headers, models from the models endpoint", async () => {
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const f = okFetch([{ data: [{ id: "claude-haiku-9" }, { id: "claude-sonnet-9" }] }, { content: [{ type: "text", text: "hello" }], usage: { input_tokens: 7, output_tokens: 3 } }], calls);
    const models = await listModels(cfg("anthropic"), f);
    expect(models).toEqual(["claude-haiku-9", "claude-sonnet-9"]);
    expect(recommendedModel("anthropic", models)).toBe("claude-haiku-9");
    const r = await complete(cfg("anthropic"), req, f);
    expect(r).toMatchObject({ text: "hello", usage: { tokensIn: 7, tokensOut: 3 } });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models?limit=100");
    expect(calls[1].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[1].init.headers["x-api-key"]).toBe("KEY-1234567890");
    expect(calls[1].init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls.every((c) => !c.url.includes("KEY-"))).toBe(true);
  });
  it("Gemini: key in a header (never the address), only models that can generate text", async () => {
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const f = okFetch([{ models: [{ name: "models/gemini-2-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] }, { candidates: [{ content: { parts: [{ text: "yo" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }], calls);
    expect(await listModels(cfg("gemini"), f)).toEqual(["gemini-2-flash"]);
    const r = await complete(cfg("gemini"), req, f);
    expect(r).toMatchObject({ text: "yo", usage: { tokensIn: 5, tokensOut: 2 } });
    expect(calls[1].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m1:generateContent");
    expect(calls[1].init.headers["x-goog-api-key"]).toBe("KEY-1234567890");
  });
  it("OpenAI-compatible endpoints use their own address and max_tokens", async () => {
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    await complete(cfg("compatible", "https://openrouter.ai/api/v1"), req, okFetch([openaiReply("x")], calls));
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(calls[0].init.body ?? "{}").max_tokens).toBe(100);
  });
  it("a provider error becomes plain words with no provider text", async () => {
    await expect(listModels(cfg("openai"), okFetch([401]))).rejects.toMatchObject({ code: "key_rejected" });
    await expect(listModels(cfg("openai"), async () => { throw new Error("socket hang up KEY-1234567890"); })).rejects.toMatchObject({ code: "network", message: expect.not.stringContaining("KEY-") });
  });
  it("only public https addresses are accepted for a compatible endpoint", () => {
    expect(safeBaseUrl("https://openrouter.ai/api/v1/").ok).toBe(true);
    for (const bad of ["http://openrouter.ai", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.5/v1", "https://192.168.1.1", "https://169.254.169.254/latest", "https://user:pw@a.com", "https://a.internal/x", "https://a.com:8443", "https://[::1]/", "https://intranet/v1", "not a url"]) expect(safeBaseUrl(bad).ok).toBe(false);
  });
  it("the cost estimate is a hint: a known family is cheaper than an unknown model", () => {
    expect(estimateCostUsd("gpt-4o-mini", { tokensIn: 1e6, tokensOut: 0 })).toBeLessThan(estimateCostUsd("some-new-model", { tokensIn: 1e6, tokensOut: 0 }));
  });
});

describe("sign-in (OpenRouter PKCE and ChatGPT)", () => {
  it("the challenge is the S256 hash of the secret verifier, and only the challenge is in the redirect", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const u = new URL(openrouterAuthorizeUrl("https://app.example/api/integrations/ai/callback?state=s", challenge));
    expect(u.origin + u.pathname).toBe("https://openrouter.ai/auth");
    expect(u.searchParams.get("code_challenge")).toBe(challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.toString()).not.toContain(verifier);
  });
  it("exchanges the code with the verifier and returns the key", async () => {
    const calls: Array<{ url: string; init: Parameters<Fetch>[1] }> = [];
    const key = await exchangeOpenRouter("CODE", "VERIFIER", okFetch([{ key: "sk-or-v1-abcdef123456", user_id: "u" }], calls));
    expect(key).toBe("sk-or-v1-abcdef123456");
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(JSON.parse(calls[0].init.body ?? "{}")).toEqual({ code: "CODE", code_verifier: "VERIFIER", code_challenge_method: "S256" });
    await expect(exchangeOpenRouter("CODE", "V", okFetch([400]))).rejects.toMatchObject({ code: "code_rejected" });
  });
  it("ChatGPT sign-in has no keys until OpenAI approves our app", () => {
    expect(chatgptKeys({})).toBeNull();
    expect(chatgptKeys({ OPENAI_OAUTH_CLIENT_ID: "x" })).toMatchObject({ clientId: "x" });
  });
});
