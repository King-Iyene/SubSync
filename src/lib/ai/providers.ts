// Bring-your-own-AI provider adapters (server only). One neutral shape in, one neutral shape out, for OpenAI, Anthropic, Google Gemini and any OpenAI-compatible
// endpoint (for example OpenRouter). Pure apart from the `fetch` that is passed in, so every adapter is tested against a fake. The customer's key is only ever put in a
// request header; it is never put in a URL, a log line or an error message. A ChatGPT or Claude consumer subscription has no API and cannot be used here.

export const PROVIDERS = ["openai", "anthropic", "gemini", "compatible"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const PROVIDER_NAME: Record<ProviderId, string> = { openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", compatible: "OpenAI-compatible (for example OpenRouter)" };
/** How a customer connected: a pasted key, OpenRouter sign-in, or ChatGPT plan sign-in (not live until OpenAI approves our app). All three go through the same gateway and the same rules. */
export const METHODS = ["key", "openrouter", "chatgpt"] as const;
export type Method = (typeof METHODS)[number];
export const isProvider = (v: unknown): v is ProviderId => (PROVIDERS as readonly unknown[]).includes(v);

export type Cfg = { provider: ProviderId; baseUrl: string | null; apiKey: string; model: string };
export type ToolSpec = { name: string; description: string; /** JSON schema of the arguments. */ parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
/** The neutral conversation: user text, the model's answer (text and/or tool calls) and the result of each tool call. */
export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type Req = { system: string; messages: Msg[]; maxTokens: number; temperature?: number; tools?: ToolSpec[]; /** Ask for one JSON object as the answer. */ json?: boolean };
export type Usage = { tokensIn: number; tokensOut: number };
export type Reply = { text: string; toolCalls: ToolCall[]; usage: Usage };
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "error" }) => Promise<{ status: number; text(): Promise<string> }>;

/** A failure in words that never contain the provider's own text (it can echo a key). `permanent`: trying again cannot help. */
export class AiError extends Error {
  constructor(public code: string, public permanent: boolean, public needsReconnect: boolean, message: string) { super(message); }
}

export function failureFor(status: number): AiError {
  if (status === 0) return new AiError("network", false, false, "We could not reach your AI provider.");
  if (status === 401 || status === 403) return new AiError("key_rejected", true, true, "Your AI provider did not accept the key. Replace the key to keep using AI wording.");
  if (status === 404) return new AiError("model_missing", true, true, "The chosen model is not available on your AI account. Choose another model.");
  if (status === 402) return new AiError("billing", true, true, "Your AI provider says the account has no credit left. Add credit on their side, then try again.");
  if (status === 429) return new AiError("rate_limited", false, false, "Your AI provider is asking us to slow down (or your AI account is out of quota).");
  if (status >= 500) return new AiError("provider_down", false, false, "Your AI provider had a problem on their side.");
  return new AiError(`http_${status}`, true, false, "Your AI provider did not accept the request.");
}

// ---------------- the address a customer may point the compatible adapter at ----------------

/** HTTPS only, a real public host, no login in the address, no private or internal ranges (the server makes this request, so it must not be aimed inside our network). */
export function safeBaseUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, error: "That address is not valid. It looks like https://openrouter.ai/api/v1" }; }
  if (u.protocol !== "https:") return { ok: false, error: "The address must start with https://" };
  if (u.username || u.password) return { ok: false, error: "Do not put a login in the address." };
  if (u.port && u.port !== "443") return { ok: false, error: "Only the standard secure port is allowed." };
  const h = u.hostname.toLowerCase();
  const bad = h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || !h.includes(".") || h.startsWith("[")
    || /^(0|10|127)\./.test(h) || /^169\.254\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) || /^\d+$/.test(h);
  if (bad) return { ok: false, error: "That address points inside a private network. Use your provider's public address." };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` };
}

const FIXED_BASE: Record<Exclude<ProviderId, "compatible">, string> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta" };
const baseOf = (c: Pick<Cfg, "provider" | "baseUrl">) => (c.provider === "compatible" ? (c.baseUrl ?? "") : FIXED_BASE[c.provider]);

async function call(f: Fetch, url: string, method: "GET" | "POST", headers: Record<string, string>, body: unknown, ms: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await f(url, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, redirect: "error" });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) throw failureFor(res.status);
    try { return JSON.parse(text); } catch { throw new AiError("bad_reply", true, false, "Your AI provider sent an answer we could not read."); }
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw failureFor(0);
  } finally { clearTimeout(timer); }
}

const hdr = (c: Cfg): Record<string, string> => c.provider === "anthropic" ? { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" } : c.provider === "gemini" ? { "x-goog-api-key": c.apiKey } : { Authorization: `Bearer ${c.apiKey}` };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const parseArgs = (v: unknown): Record<string, unknown> => { if (typeof v === "string") { try { return obj(JSON.parse(v)); } catch { return {}; } } return obj(v); };

// ---------------- the models the provider offers ----------------

/** Lists the model ids this key can use. This is also the "Test connection" call: a tiny real request that sends no data of ours. */
export async function listModels(c: Cfg, f: Fetch, ms = 15_000): Promise<string[]> {
  const base = baseOf(c);
  if (!base) throw new AiError("no_address", true, false, "Add the address of your provider.");
  const url = c.provider === "gemini" ? `${base}/models?pageSize=200` : `${base}/models${c.provider === "anthropic" ? "?limit=100" : ""}`;
  const r = obj(await call(f, url, "GET", hdr(c), undefined, ms));
  if (c.provider === "gemini") return arr(r.models).map(obj).filter((m) => arr(m.supportedGenerationMethods).includes("generateContent")).map((m) => String(m.name ?? "").replace(/^models\//, "")).filter(Boolean).sort();
  return arr(r.data).map((m) => String(obj(m).id ?? "")).filter(Boolean).sort();
}

// ---------------- one model call ----------------

export async function complete(c: Cfg, req: Req, f: Fetch, ms = 45_000): Promise<Reply> {
  const base = baseOf(c);
  if (!base) throw new AiError("no_address", true, false, "Add the address of your provider.");
  if (c.provider === "anthropic") {
    const messages: unknown[] = [];
    for (const m of req.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "assistant") messages.push({ role: "assistant", content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...(m.toolCalls ?? []).map((t) => ({ type: "tool_use", id: t.id, name: t.name, input: t.args }))] });
      else messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] });
    }
    const r = obj(await call(f, `${base}/messages`, "POST", hdr(c), {
      model: c.model, max_tokens: req.maxTokens, system: req.system + (req.json ? "\nAnswer with one JSON object and nothing else." : ""), messages, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    }, ms));
    const parts = arr(r.content).map(obj);
    return {
      text: parts.filter((p) => p.type === "text").map((p) => String(p.text ?? "")).join("").trim(),
      toolCalls: parts.filter((p) => p.type === "tool_use").map((p) => ({ id: String(p.id ?? ""), name: String(p.name ?? ""), args: obj(p.input) })),
      usage: { tokensIn: num(obj(r.usage).input_tokens), tokensOut: num(obj(r.usage).output_tokens) },
    };
  }
  if (c.provider === "gemini") {
    const contents: unknown[] = [];
    for (const m of req.messages) {
      if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.content }] });
      else if (m.role === "assistant") contents.push({ role: "model", parts: [...(m.content ? [{ text: m.content }] : []), ...(m.toolCalls ?? []).map((t) => ({ functionCall: { name: t.name, args: t.args } }))] });
      else contents.push({ role: "user", parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] });
    }
    const r = obj(await call(f, `${base}/models/${encodeURIComponent(c.model)}:generateContent`, "POST", hdr(c), {
      systemInstruction: { parts: [{ text: req.system }] }, contents,
      generationConfig: { maxOutputTokens: req.maxTokens, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}), ...(req.json && !req.tools?.length ? { responseMimeType: "application/json" } : {}) },
      ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
    }, ms));
    const parts = arr(obj(obj(arr(r.candidates)[0]).content).parts).map(obj);
    const u = obj(r.usageMetadata);
    return {
      text: parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim(),
      toolCalls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: `g${i}`, name: String(obj(p.functionCall).name ?? ""), args: obj(obj(p.functionCall).args) })),
      usage: { tokensIn: num(u.promptTokenCount), tokensOut: num(u.candidatesTokenCount) },
    };
  }
  // OpenAI and the compatible endpoints share the chat-completions shape.
  const messages: unknown[] = [{ role: "system", content: req.system }];
  for (const m of req.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") messages.push({ role: "assistant", content: m.content || null, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) });
    else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  const r = obj(await call(f, `${base}/chat/completions`, "POST", hdr(c), {
    model: c.model, messages, ...(c.provider === "openai" ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }), ...(req.temperature !== undefined && c.provider !== "openai" ? { temperature: req.temperature } : {}),
    ...(req.json && !req.tools?.length ? { response_format: { type: "json_object" } } : {}),
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
  }, ms));
  const msg = obj(obj(arr(r.choices)[0]).message), u = obj(r.usage);
  return {
    text: typeof msg.content === "string" ? msg.content.trim() : "",
    toolCalls: arr(msg.tool_calls).map(obj).map((t) => ({ id: String(t.id ?? ""), name: String(obj(t.function).name ?? ""), args: parseArgs(obj(t.function).arguments) })),
    usage: { tokensIn: num(u.prompt_tokens), tokensOut: num(u.completion_tokens) },
  };
}

// ---------------- hints that may be wrong without breaking anything ----------------

/** A small preference list used ONLY to pre-select a model from the list the provider returned. Model ids are never hard-coded as the list. */
const RECOMMEND: Record<ProviderId, string[]> = { openai: ["gpt-4o-mini", "gpt-4.1-mini", "mini"], anthropic: ["haiku", "sonnet"], gemini: ["flash"], compatible: [] };
export function recommendedModel(p: ProviderId, ids: string[]): string | null {
  for (const hint of RECOMMEND[p]) { const hit = ids.filter((i) => i.includes(hint) && !/preview|audio|realtime|image|tts|embed/.test(i)).sort().reverse()[0]; if (hit) return hit; }
  return null;
}

/** Rough US dollars per million tokens (input, output) by model family. A guess for the spend meter only; an unknown model uses a cautious higher rate. */
const PRICE_HINT: Array<[RegExp, number, number]> = [
  [/gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini/, 0.3, 1.2], [/gpt-4\.1-nano|gpt-5-nano/, 0.1, 0.4], [/gpt-4o|gpt-4\.1|gpt-5/, 3, 12], [/haiku/, 1, 5], [/sonnet/, 3, 15], [/opus/, 15, 75], [/flash-lite/, 0.1, 0.4], [/flash/, 0.3, 2.5], [/gemini.*pro/, 1.5, 10],
];
export function estimateCostUsd(model: string, u: Usage): number {
  const hit = PRICE_HINT.find(([re]) => re.test(model.toLowerCase()));
  const i = hit ? hit[1] : 5, o = hit ? hit[2] : 20;
  return Math.round(((u.tokensIn * i + u.tokensOut * o) / 1_000_000) * 1e6) / 1e6;
}

/** Plain steps shown next to each provider. `cost` says what the customer pays and to whom. */
export const PROVIDER_HELP: Record<ProviderId, { steps: string; cost: string; keyHint: string }> = {
  anthropic: { steps: "Go to console.anthropic.com, open API Keys, press Create key, and set a monthly spend limit there first. Paste the key here.", cost: "Billed by Anthropic to your own API account. A Claude chat subscription cannot be used.", keyHint: "sk-ant-..." },
  openai: { steps: "Go to platform.openai.com, open API keys, press Create new secret key, and set a monthly budget under Billing first. Paste the key here.", cost: "Billed by OpenAI to your own API account. A ChatGPT subscription cannot be used with a key.", keyHint: "sk-..." },
  gemini: { steps: "Go to aistudio.google.com, open Get API key, press Create API key. Paste the key here.", cost: "Billed by Google to your own account (a free tier may apply).", keyHint: "AI..." },
  compatible: { steps: "Use any service that speaks the OpenAI chat format. Paste its https address (for example https://openrouter.ai/api/v1) and your key.", cost: "Billed by that service.", keyHint: "" },
};
export const METHOD_COST = {
  openrouter: "Uses your own OpenRouter credit. You can revoke the key on OpenRouter at any time.",
  chatgpt: "Uses your ChatGPT plan allowance. Not available yet: it starts when OpenAI approves our app.",
  key: "Uses your own provider account and is billed by that provider.",
} as const;
