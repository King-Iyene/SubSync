import { postToSlack } from "../notify";
import {
  authorizeUrl, createFathomWebhook, deleteFathomWebhook, exchangeCode, exchangeSlack, fetchZoomUser, keysFor, redirectUri, revokeZoom,
} from "./oauth";
import { accessTokenFor, newPublicKey, removeConnection, saveFathom, saveSlack, saveZoom, getConnection, type ConnectionRow } from "./queries";
import { signState, type OAuthState, type Provider } from "./state";

// The two halves of connecting an app: the link a person is sent to, and what happens when the provider
// sends them back with a code. Plus disconnecting, which also tells the provider to forget the access.

export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
export const NAMES: Record<Provider, string> = { slack: "Slack", fathom: "Fathom", zoom: "Zoom" };

export function availability(env: Record<string, string | undefined> = process.env): Record<Provider, boolean> {
  return { slack: !!keysFor("slack", env), fathom: !!keysFor("fathom", env), zoom: !!keysFor("zoom", env) };
}

export function startLink(provider: Provider, s: OAuthState): { ok: true; url: string } | { ok: false; error: string } {
  const keys = keysFor(provider);
  const base = appUrl();
  if (!keys || !base) return { ok: false, error: `Connecting ${NAMES[provider]} is not switched on yet. It needs the ${NAMES[provider]} app set up first.` };
  return { ok: true, url: authorizeUrl(provider, { clientId: keys.clientId, redirectUri: redirectUri(base, provider), state: signState(s) }) };
}

type Done = { ok: true; message: string } | { ok: false; error: string };

export async function completeSignIn(provider: Provider, code: string, s: OAuthState, f: typeof fetch = fetch): Promise<Done> {
  const keys = keysFor(provider);
  const base = appUrl();
  if (!keys || !base) return { ok: false, error: `${NAMES[provider]} is not switched on yet` };
  const redirect = redirectUri(base, provider);

  if (provider === "slack") {
    const got = await exchangeSlack(code, keys, redirect, f);
    if (!got.ok) return got;
    await saveSlack(s.installationId, got, s.onlyLocationId, s.actor);
    // A first message in the channel shows the connection works. It does not need to succeed.
    await postToSlack(got.webhookUrl, ":white_check_mark: SubSync is connected to this channel. Alerts and the daily brief will be posted here once you switch them on.");
    return { ok: true, message: `Connected to ${got.channel ?? "your Slack channel"}.` };
  }

  const tokens = await exchangeCode(provider, code, keys, redirect, f);
  if (!tokens.ok) return tokens;

  if (provider === "fathom") {
    const key = newPublicKey();
    const hook = await createFathomWebhook(tokens.tokens.accessToken, `${base}/api/hooks/fathom/${key}`, f);
    if (!hook.ok) return hook;
    const replaced = await saveFathom(s.installationId, tokens.tokens, hook, key, s.onlyLocationId, s.actor);
    if (replaced) await dropProviderSide(replaced, f);
    return { ok: true, message: "Connected. New Fathom meetings will appear in Meeting notes." };
  }

  const user = await fetchZoomUser(tokens.tokens.accessToken, f);
  if (!user.ok) return user;
  await saveZoom(s.installationId, tokens.tokens, user, s.onlyLocationId, s.actor);
  return { ok: true, message: "Connected. Meetings with an AI summary will appear in Meeting notes." };
}

// Tell the provider to stop: delete SubSync's Fathom webhook, revoke the Zoom token. Best effort.
async function dropProviderSide(row: ConnectionRow, f: typeof fetch): Promise<void> {
  if (row.isDemo || row.provider === "slack") return;
  const token = await accessTokenFor(row, f);
  if (!token) return;
  if (row.provider === "fathom" && row.externalId) await deleteFathomWebhook(token, row.externalId, f);
  if (row.provider === "zoom") {
    const keys = keysFor("zoom");
    if (keys) await revokeZoom(token, keys, f);
  }
}

export async function disconnect(installationId: string, id: string, actor: string | null, f: typeof fetch = fetch): Promise<boolean> {
  const row = await getConnection(installationId, id);
  if (!row) return false;
  await dropProviderSide(row, f);
  await removeConnection(installationId, row, actor);
  return true;
}
