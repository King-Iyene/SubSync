import { createHash, randomBytes } from "node:crypto";
import { AiError, type Fetch } from "./providers";

// Authorize-style sign-in for the AI connection (pure apart from the fetch passed in).
//   OpenRouter: OAuth PKCE (https://openrouter.ai/docs/use-cases/oauth-pkce). We send the person to OpenRouter with an S256 code challenge; OpenRouter sends them back with a one-time code; the server
//   exchanges the code plus the secret code verifier for a user-controlled API key. The customer pays OpenRouter credit and can revoke the key on OpenRouter at any time.
//   ChatGPT plan sign-in (OpenAI OAuth, scope chatgpt.tokens.use.direct, announced Sept 2026, launch partners only): the adapter is built but NOT live. It stays off until OpenAI approves our app and
//   the three settings below exist; every address here is CHECK until OpenAI's partner documentation confirms it (docs/AI_JOBS_SPEC.md, "ChatGPT sign-in: what King must apply for").
//   Anthropic: no sign-in flow is built or allowed (Anthropic prohibits using a subscription login in other products). API key only.

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_AUTH = "https://openrouter.ai/auth";

const b64 = (b: Buffer) => b.toString("base64url");
/** A fresh PKCE pair: the verifier stays on our server, only its S256 hash goes in the redirect. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64(randomBytes(48));
  return { verifier, challenge: b64(createHash("sha256").update(verifier).digest()) };
}
/** The single-use state we put in the redirect. */
export const newState = () => b64(randomBytes(32));

export const callbackUrl = (appUrl: string, state: string) => `${appUrl.replace(/\/+$/, "")}/api/integrations/ai/callback?state=${encodeURIComponent(state)}`;

export function openrouterAuthorizeUrl(callback: string, challenge: string): string {
  const u = new URL(OPENROUTER_AUTH);
  u.searchParams.set("callback_url", callback);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

const fail = (status: number): AiError =>
  status === 0 ? new AiError("network", false, false, "We could not reach OpenRouter.")
  : status === 400 || status === 403 ? new AiError("code_rejected", true, false, "OpenRouter did not accept the sign-in. It may have expired. Start again.")
  : new AiError(`http_${status}`, true, false, "OpenRouter did not finish the sign-in. Try again in a moment.");

async function post(f: Fetch, url: string, body: unknown, form = false): Promise<Record<string, unknown>> {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await f(url, { method: "POST", headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" }, body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body), signal: ctl.signal, redirect: "error" });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) throw fail(res.status);
    const j = JSON.parse(text) as unknown;
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch (e) { throw e instanceof AiError ? e : fail(0); } finally { clearTimeout(t); }
}

/** Trades the one-time code and the secret verifier for the customer's own OpenRouter key. */
export async function exchangeOpenRouter(code: string, verifier: string, f: Fetch): Promise<string> {
  const r = await post(f, `${OPENROUTER_BASE}/auth/keys`, { code, code_verifier: verifier, code_challenge_method: "S256" });
  if (typeof r.key !== "string" || r.key.length < 8) throw new AiError("no_key", true, false, "OpenRouter did not return a key. Start again.");
  return r.key;
}

// ---------------- ChatGPT plan sign-in (not live) ----------------

export const CHATGPT_SCOPE = "chatgpt.tokens.use.direct";
// CHECK: these two addresses are the usual OpenAI OAuth ones and are NOT confirmed for the plan-usage program. They are only used when the three settings below exist.
const CHATGPT_AUTH = "https://auth.openai.com/oauth/authorize";
const CHATGPT_TOKEN = "https://auth.openai.com/oauth/token";
export type ChatgptKeys = { clientId: string; clientSecret: string | null };
type Env = Record<string, string | undefined>;
/** Null until King has OpenAI's approval and has set OPENAI_OAUTH_CLIENT_ID (and OPENAI_OAUTH_CLIENT_SECRET when OpenAI issues one). */
export const chatgptKeys = (env: Env = process.env): ChatgptKeys | null => (env.OPENAI_OAUTH_CLIENT_ID ? { clientId: env.OPENAI_OAUTH_CLIENT_ID, clientSecret: env.OPENAI_OAUTH_CLIENT_SECRET ?? null } : null);
export const chatgptRedirect = (appUrl: string) => `${appUrl.replace(/\/+$/, "")}/api/integrations/ai/callback`;

export function chatgptAuthorizeUrl(k: ChatgptKeys, redirect: string, state: string, challenge: string): string {
  const u = new URL(CHATGPT_AUTH);
  for (const [a, b] of Object.entries({ response_type: "code", client_id: k.clientId, redirect_uri: redirect, scope: CHATGPT_SCOPE, state, code_challenge: challenge, code_challenge_method: "S256" })) u.searchParams.set(a, b);
  return u.toString();
}
export type ChatgptTokens = { accessToken: string; refreshToken: string | null; expiresAt: number };
const tokens = (r: Record<string, unknown>, now: number): ChatgptTokens => {
  if (typeof r.access_token !== "string") throw new AiError("no_token", true, false, "OpenAI did not return access. Start again.");
  return { accessToken: r.access_token, refreshToken: typeof r.refresh_token === "string" ? r.refresh_token : null, expiresAt: now + (typeof r.expires_in === "number" ? r.expires_in : 3600) * 1000 };
};
export async function exchangeChatgpt(k: ChatgptKeys, code: string, verifier: string, redirect: string, f: Fetch, now = Date.now()): Promise<ChatgptTokens> {
  return tokens(await post(f, CHATGPT_TOKEN, { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: k.clientId, code_verifier: verifier, ...(k.clientSecret ? { client_secret: k.clientSecret } : {}) }, true), now);
}
export async function refreshChatgpt(k: ChatgptKeys, refreshToken: string, f: Fetch, now = Date.now()): Promise<ChatgptTokens> {
  const t = tokens(await post(f, CHATGPT_TOKEN, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: k.clientId, ...(k.clientSecret ? { client_secret: k.clientSecret } : {}) }, true), now);
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}
