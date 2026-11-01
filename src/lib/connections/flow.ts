import { outward, type Deps } from "../live-flags";
import { postToSlack } from "../notify";
import { connectError } from "./messages";
import {
  authorizeUrl, deleteFathomWebhook, exchangeSlack, keysFor, redirectUri, revokeZoom,
} from "./oauth";
import { accessTokenFor, removeConnection, saveSlack, getConnection, type ConnectionRow } from "./queries";
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

type Done = { ok: true; message: string } | { ok: false; error: string; code?: string; providerCode?: string };

// Only a WORKSPACE tool (Slack, one per account, connected by an administrator) is signed in here. A personal tool (Fathom, Zoom) is connected by the
// person it belongs to, through src/lib/connections/personal-flow.ts: there is no shared or assigned connection any more (INTEGRATIONS_SPEC section 2).
export async function completeSignIn(provider: Provider, code: string, s: OAuthState, f: typeof fetch = fetch): Promise<Done> {
  if (provider !== "slack") return connectError("P-STATE", NAMES[provider]);
  const keys = keysFor(provider);
  const base = appUrl();
  if (!keys || !base) return connectError("P-OFF", NAMES[provider]);
  const got = await exchangeSlack(code, keys, redirectUri(base, provider), f);
  if (!got.ok) return got;
  await saveSlack(s.installationId, got, s.onlyLocationId, s.actor);
  // A first message in the channel shows the connection works. It does not need to succeed.
  await postToSlack(got.webhookUrl, ":white_check_mark: SubSync is connected to this channel. Alerts and the daily brief will be posted here once you switch them on.");
  return { ok: true, message: `Connected to ${got.channel ?? "your Slack channel"}.` };
}

// Tell the provider to stop: delete SubSync's Fathom webhook, revoke the Zoom token. Best effort.
// The call goes through the dry-run gate (FATHOM_WEBHOOK_LIVE): with it off it is only recorded as a "WOULD WRITE" line and no token is read.
export async function dropProviderSide(row: ConnectionRow, f: typeof fetch, deps: Deps = {}): Promise<void> {
  if (row.isDemo || row.provider === "slack") return;
  await outward(
    { flag: "FATHOM_WEBHOOK_LIVE", verb: "DELETE", what: row.provider === "fathom" ? "fathom.webhook.delete" : "zoom.token.revoke", installationId: row.installationId, ids: { connectionId: row.id, webhookId: row.externalId } },
    async () => {
      const token = await accessTokenFor(row, f);
      if (!token) return;
      if (row.provider === "fathom" && row.externalId) await deleteFathomWebhook(token, row.externalId, f);
      if (row.provider === "zoom") {
        const keys = keysFor("zoom");
        if (keys) await revokeZoom(token, keys, f);
      }
    },
    deps,
  );
}

export async function disconnect(installationId: string, id: string, actor: string | null, f: typeof fetch = fetch): Promise<boolean> {
  const row = await getConnection(installationId, id);
  if (!row) return false;
  await dropProviderSide(row, f);
  await removeConnection(installationId, row, actor);
  return true;
}
