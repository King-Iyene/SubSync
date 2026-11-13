import { isSlackWebhook } from "../analytics/derive.ts";
import type { Attendee } from "../analytics/meeting-intel.ts";
import { connectError, providerCodeOf, SLACK_REDIRECT_ERRORS, SLACK_SCOPE_ERRORS, type ConnectCode } from "./messages.ts";
import { DEFAULT_WANTED, TRIGGERS_FIRST, TRIGGERS_SOLO, type WantedContent } from "./fathom.ts";
import type { Provider } from "./state.ts";

// Talking to Slack, Fathom and Zoom to sign a person in and keep the connection alive. The network call
// is passed in, so every function here is tested with a fake provider. Nothing here logs a token, and an
// error message never contains one.

type Fetch = typeof fetch;
export type Keys = { clientId: string; clientSecret: string };
export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
/** A failed step: the plain words a person reads, a short code they can send us, and the provider's own code for the log (never shown, never a secret). */
export type Failed = { ok: false; error: string; code?: ConnectCode; providerCode?: string };

const TIMEOUT_MS = 10_000;
const FATHOM_AUTH = "https://fathom.video/external/v1/oauth2/authorize";
// Fathom's developer docs (read 2 Nov 2026) put the token endpoint on api.fathom.ai; the sign-in page itself is on fathom.video (the app page shows that address).
const FATHOM_TOKEN = "https://api.fathom.ai/external/v1/oauth2/token";
const FATHOM_API = "https://api.fathom.ai/external/v1";

// Which keys a provider needs. A provider with a missing key shows as "not switched on yet".
export function keysFor(provider: Provider, env: Record<string, string | undefined> = process.env): Keys | null {
  const upper = provider.toUpperCase();
  const clientId = env[`${upper}_CLIENT_ID`];
  const clientSecret = env[`${upper}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  // Zoom also needs the secret token it signs notifications with.
  if (provider === "zoom" && !env.ZOOM_WEBHOOK_SECRET_TOKEN) return null;
  return { clientId, clientSecret };
}

export const redirectUri = (appUrl: string, provider: Provider) => `${appUrl.replace(/\/+$/, "")}/api/integrations/${provider}/callback`;

/** The bot permissions chat needs, asked for only when chat is being launched (SLACK_CHAT_SCOPES=true). Smallest set that can hear a mention or a direct message and reply. */
export const SLACK_CHAT_SCOPES = ["app_mentions:read", "chat:write", "im:history", "im:read", "im:write"] as const;

export function authorizeUrl(provider: Provider, p: { clientId: string; redirectUri: string; state: string; chat?: boolean }): string {
  const u =
    provider === "slack" ? new URL("https://slack.com/oauth/v2/authorize")
    : provider === "fathom" ? new URL(FATHOM_AUTH)
    : new URL("https://zoom.us/oauth/authorize");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("state", p.state);
  if (provider === "slack") u.searchParams.set("scope", p.chat ? ["incoming-webhook", ...SLACK_CHAT_SCOPES].join(",") : "incoming-webhook");
  else u.searchParams.set("response_type", "code");
  if (provider === "fathom") u.searchParams.set("scope", "public_api");
  return u.toString();
}

const call = async (f: Fetch, url: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> => {
  const r = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch { /* an empty or non-JSON answer */ }
  return { status: r.status, json };
};

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };

// ---- Slack: the person picks a channel on Slack's own page and Slack hands back its incoming webhook.
export type SlackInstall = { ok: true; webhookUrl: string; team: string | null; channel: string | null; /** Present only when chat scopes were granted: the workspace's bot (never logged or sent to a browser). */ bot?: { token: string; teamId: string; userId: string | null; channelId: string | null } };
export async function exchangeSlack(code: string, keys: Keys, redirect: string, f: Fetch = fetch): Promise<SlackInstall | Failed> {
  try {
    const { status, json } = await call(f, "https://slack.com/api/oauth.v2.access", {
      method: "POST", headers: FORM, body: form({ code, client_id: keys.clientId, client_secret: keys.clientSecret, redirect_uri: redirect }),
    });
    if (json.ok !== true) {
      const providerCode = providerCodeOf(status, json);
      return SLACK_REDIRECT_ERRORS.has(providerCode) ? connectError("S-REDIRECT", "Slack", providerCode) : SLACK_SCOPE_ERRORS.has(providerCode) ? connectError("S-SCOPE", "Slack", providerCode) : connectError("P-AUTH", "Slack", providerCode);
    }
    const hook = (json.incoming_webhook ?? {}) as Record<string, unknown>;
    const url = str(hook.url, 500);
    if (!url || !isSlackWebhook(url)) return { ok: false, error: "Slack did not give a channel to post to. Choose a channel and try again" };
    const team = (json.team ?? {}) as Record<string, unknown>;
    const botToken = str(json.access_token, 300), teamId = str(team.id, 40);
    const bot = botToken && botToken.startsWith("xoxb-") && teamId ? { bot: { token: botToken, teamId, userId: str(json.bot_user_id, 40), channelId: str(hook.channel_id, 40) } } : {};
    return { ok: true, webhookUrl: url, team: str(team.name, 100), channel: str(hook.channel, 100), ...bot };
  } catch {
    return connectError("P-NET", "Slack");
  }
}

// ---- Fathom and Zoom: a one-hour or longer access token plus a refresh token that is used once.
function tokensFrom(json: Record<string, unknown>, now: number): Tokens | null {
  const accessToken = str(json.access_token, 4_000);
  const refreshToken = str(json.refresh_token, 4_000);
  if (!accessToken || !refreshToken) return null;
  const secs = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3_600;
  return { accessToken, refreshToken, expiresAt: now + secs * 1000 };
}

const basic = (k: Keys) => "Basic " + Buffer.from(`${k.clientId}:${k.clientSecret}`).toString("base64");

async function tokenCall(provider: "fathom" | "zoom", params: Record<string, string>, keys: Keys, f: Fetch, now: number): Promise<{ ok: true; tokens: Tokens } | Failed> {
  try {
    const fathom = provider === "fathom";
    const { status, json } = await call(f, fathom ? FATHOM_TOKEN : "https://zoom.us/oauth/token", {
      method: "POST",
      headers: fathom ? FORM : { ...FORM, authorization: basic(keys) },
      body: form(fathom ? { ...params, client_id: keys.clientId, client_secret: keys.clientSecret } : params),
    });
    const tokens = status >= 200 && status < 300 ? tokensFrom(json, now) : null;
    return tokens ? { ok: true, tokens } : connectError("P-AUTH", provider === "fathom" ? "Fathom" : "Zoom", providerCodeOf(status, json));
  } catch {
    return connectError("P-NET", provider === "fathom" ? "Fathom" : "Zoom");
  }
}

export const exchangeCode = (provider: "fathom" | "zoom", code: string, keys: Keys, redirect: string, f: Fetch = fetch, now = Date.now()) =>
  tokenCall(provider, { grant_type: "authorization_code", code, redirect_uri: redirect }, keys, f, now);

export const refreshTokens = (provider: "fathom" | "zoom", refreshToken: string, keys: Keys, f: Fetch = fetch, now = Date.now()) =>
  tokenCall(provider, { grant_type: "refresh_token", refresh_token: refreshToken }, keys, f, now);

// ---- Fathom: SubSync registers its own webhook, so the person never pastes an address.
// Only what the person chose to save is requested (summary and action items by default; the transcript only when chosen, stage E2b). The secret is shown by
// Fathom ONCE, in this answer, so it is returned here and stored by the caller before anything else happens.
async function postWebhook(accessToken: string, destinationUrl: string, triggers: readonly string[], want: WantedContent, f: Fetch) {
  return call(f, `${FATHOM_API}/webhooks`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ destination_url: destinationUrl, triggered_for: triggers, include_summary: want.summary, include_action_items: want.actionItems, include_transcript: want.transcript, include_crm_matches: false }),
  });
}

export async function createFathomWebhook(accessToken: string, destinationUrl: string, f: Fetch = fetch, want: WantedContent = DEFAULT_WANTED): Promise<{ ok: true; id: string; secret: string; triggers: string } | Failed> {
  try {
    // First with the person's own recordings plus the ones they share with a team. A solo plan refuses the team type (it is Team-plan only): then the person's own recordings alone.
    let triggers: readonly string[] = TRIGGERS_FIRST;
    let { status, json } = await postWebhook(accessToken, destinationUrl, triggers, want, f);
    if (status === 400) {
      triggers = TRIGGERS_SOLO;
      ({ status, json } = await postWebhook(accessToken, destinationUrl, triggers, want, f));
    }
    const id = str(json.id, 200);
    const secret = str(json.secret, 500);
    return status >= 200 && status < 300 && id && secret ? { ok: true, id, secret, triggers: triggers.join(",") } : connectError("F-HOOK", "Fathom", providerCodeOf(status, json));
  } catch {
    return connectError("P-NET", "Fathom");
  }
}

// A cheap read that proves the connection still works: the person's own meeting list, one item. NOT VERIFIED LIVE (see docs/features/E0.md).
export async function testFathom(accessToken: string, f: Fetch = fetch): Promise<{ ok: true } | { ok: false; status: number }> {
  try {
    const { status } = await call(f, `${FATHOM_API}/meetings?limit=1`, { headers: { authorization: `Bearer ${accessToken}` } });
    return status >= 200 && status < 300 ? { ok: true } : { ok: false, status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function deleteFathomWebhook(accessToken: string, webhookId: string, f: Fetch = fetch): Promise<boolean> {
  try {
    const { status } = await call(f, `${FATHOM_API}/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}

// ---- Zoom: who signed in, and (best effort) who joined a meeting.
export async function fetchZoomUser(accessToken: string, f: Fetch = fetch): Promise<{ ok: true; id: string; email: string | null } | Failed> {
  try {
    const { status, json } = await call(f, "https://api.zoom.us/v2/users/me", { headers: { authorization: `Bearer ${accessToken}` } });
    const id = str(json.id, 100);
    // The usual cause of a refusal here is a missing scope (user:read:user); the provider's own code goes to the log, the person gets Z-IDENT.
    return status === 200 && id ? { ok: true, id, email: str(json.email, 200)?.toLowerCase() ?? null } : connectError("Z-IDENT", "Zoom", providerCodeOf(status, json));
  } catch {
    return connectError("P-NET", "Zoom");
  }
}

// A Zoom meeting id that starts with "/" or holds "//" must be encoded twice.
export const zoomUuidPath = (uuid: string) => encodeURIComponent(/^\/|\/\//.test(uuid) ? encodeURIComponent(uuid) : uuid);

export function attendeesFromZoom(json: Record<string, unknown>, hostEmail: string | null): Attendee[] {
  const list = Array.isArray(json.participants) ? json.participants : [];
  const seen = new Set<string>();
  const out: Attendee[] = [];
  for (const p of list) {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const email = str(o.user_email, 200)?.toLowerCase() ?? null;
    const name = str(o.name, 120);
    const key = email ?? name;
    if (!key || seen.has(key) || (email && email === hostEmail)) continue;
    seen.add(key);
    out.push({ name, email });
    if (out.length >= 50) break;
  }
  return out;
}

export async function fetchZoomParticipants(accessToken: string, uuid: string, hostEmail: string | null, f: Fetch = fetch): Promise<Attendee[]> {
  try {
    const { status, json } = await call(f, `https://api.zoom.us/v2/past_meetings/${zoomUuidPath(uuid)}/participants?page_size=100`, { headers: { authorization: `Bearer ${accessToken}` } });
    return status === 200 ? attendeesFromZoom(json, hostEmail) : [];
  } catch {
    return [];
  }
}

export async function revokeZoom(accessToken: string, keys: Keys, f: Fetch = fetch): Promise<boolean> {
  try {
    const { status } = await call(f, "https://zoom.us/oauth/revoke", { method: "POST", headers: { ...FORM, authorization: basic(keys) }, body: form({ token: accessToken }) });
    return status >= 200 && status < 300;
  } catch {
    return false;
  }
}
