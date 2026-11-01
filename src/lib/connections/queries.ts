import { randomBytes } from "node:crypto";
import { updateSettings } from "../analytics/queries";
import type { Meeting } from "../analytics/meeting-intel";
import { MAX_PER_HOUR, recentCount, recordMeeting } from "../analytics/meeting-queries";
import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import { keysFor, refreshTokens, type SlackInstall, type Tokens } from "./oauth";
import { chooseAccount } from "./routing";
import type { Provider } from "./state";

// Everything stored for a connection. Tokens and secrets are encrypted at rest and never returned to a
// browser: the list a person sees only has names, status and counts.

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type ConnectionView = {
  id: string; provider: Provider; status: string; label: string | null; onlyLocationId: string | null;
  saved: number; skipped: number; lastEventAt: string | null; connectedAt: string | null;
};

export async function listConnections(installationId: string): Promise<ConnectionView[]> {
  const rows = await sql()`select c.* from connections c where c.installation_id = ${installationId} order by c.created_at`;
  return rows.map((r) => ({
    id: r.id as string, provider: r.provider as Provider, status: r.status as string, label: r.label as string | null, onlyLocationId: r.only_location_id as string | null,
    saved: r.saved_count as number, skipped: r.skipped_count as number, lastEventAt: iso(r.last_event_at), connectedAt: iso(r.created_at),
  }));
}

type Row = {
  id: string; installationId: string; provider: Provider; status: string; label: string | null; externalId: string | null; accessTokenEnc: string | null; refreshTokenEnc: string | null;
  tokenExpiresAt: number | null; webhookSecretEnc: string | null; onlyLocationId: string | null; isDemo: boolean; keepTranscripts: boolean;
};
const mapRow = (r: Record<string, unknown>): Row => ({
  id: r.id as string, installationId: r.installation_id as string, provider: r.provider as Provider, status: r.status as string, label: r.label as string | null,
  externalId: r.external_id as string | null, accessTokenEnc: r.access_token_enc as string | null, refreshTokenEnc: r.refresh_token_enc as string | null,
  tokenExpiresAt: ms(r.token_expires_at), webhookSecretEnc: r.webhook_secret_enc as string | null, onlyLocationId: r.only_location_id as string | null,
  isDemo: r.is_demo === true, keepTranscripts: r.keep_transcripts === true,
});
export type ConnectionRow = Row;

async function rowsWhere(cond: "id" | "key" | "host", value: string, installationId?: string): Promise<Row[]> {
  const db = sql();
  const base = db`
    select c.*, i.is_demo, s.keep_transcripts from connections c
    join installations i on i.id = c.installation_id and i.uninstalled_at is null
    left join settings s on s.installation_id = c.installation_id`;
  const rows =
    cond === "id" ? await db`${base} where c.id = ${value} and c.installation_id = ${installationId ?? null}`
    : cond === "key" ? await db`${base} where c.public_key = ${value} and c.provider = 'fathom'`
    : await db`${base} where c.external_id = ${value} and c.provider = 'zoom' and c.status = 'connected'`;
  return rows.map(mapRow);
}

export const getConnection = async (installationId: string, id: string) => (await rowsWhere("id", id, installationId))[0] ?? null;
export const findFathomByKey = async (key: string) => (await rowsWhere("key", key))[0] ?? null;
export const findZoomByHost = (hostId: string) => rowsWhere("host", hostId);

export const newPublicKey = () => randomBytes(24).toString("base64url");

export async function saveSlack(installationId: string, s: SlackInstall, only: string | null, actor: string | null) {
  const db = sql();
  await updateSettings(installationId, { slackWebhookUrl: s.webhookUrl });
  const label = [s.team, s.channel].filter(Boolean).join(" · ") || "Slack";
  const updated = await db`update connections set label = ${label}, status = 'connected', only_location_id = ${only}, connected_by = ${actor} where installation_id = ${installationId} and provider = 'slack' returning id`;
  if (updated.length === 0) {
    await db`insert into connections (installation_id, provider, label, only_location_id, connected_by) values (${installationId}, 'slack', ${label}, ${only}, ${actor})`;
  }
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'connections.slack_connected', ${db.json({ channel: s.channel } as never)})`;
}

// Returns the connection this one replaced, so the caller can remove its old webhook at Fathom.
export async function saveFathom(installationId: string, t: Tokens, hook: { id: string; secret: string }, publicKey: string, only: string | null, actor: string | null): Promise<Row | null> {
  const db = sql();
  const [prev] = await db`select id from connections where installation_id = ${installationId} and provider = 'fathom'`;
  const previous = prev ? await getConnection(installationId, prev.id as string) : null;
  await db`delete from connections where installation_id = ${installationId} and provider = 'fathom'`;
  await db`
    insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, webhook_secret_enc, public_key, only_location_id, connected_by)
    values (${installationId}, 'fathom', 'Fathom', ${hook.id}, ${encryptSecret(t.accessToken)}, ${encryptSecret(t.refreshToken)}, ${new Date(t.expiresAt)}, ${encryptSecret(hook.secret)}, ${publicKey}, ${only}, ${actor})`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'connections.fathom_connected', ${db.json({} as never)})`;
  return previous ?? null;
}

export async function saveZoom(installationId: string, t: Tokens, user: { id: string; email: string | null }, only: string | null, actor: string | null) {
  const db = sql();
  const label = user.email ?? "Zoom";
  const updated = await db`
    update connections set label = ${label}, status = 'connected', access_token_enc = ${encryptSecret(t.accessToken)}, refresh_token_enc = ${encryptSecret(t.refreshToken)},
      token_expires_at = ${new Date(t.expiresAt)}, only_location_id = ${only}, connected_by = ${actor}
    where installation_id = ${installationId} and provider = 'zoom' and external_id = ${user.id} returning id`;
  if (updated.length === 0) {
    await db`
      insert into connections (installation_id, provider, label, external_id, access_token_enc, refresh_token_enc, token_expires_at, only_location_id, connected_by)
      values (${installationId}, 'zoom', ${label}, ${user.id}, ${encryptSecret(t.accessToken)}, ${encryptSecret(t.refreshToken)}, ${new Date(t.expiresAt)}, ${only}, ${actor})`;
  }
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'connections.zoom_connected', ${db.json({} as never)})`;
}

// Removes the connection and everything stored for it. For Slack the saved channel address goes too.
export async function removeConnection(installationId: string, row: Row, actor: string | null) {
  const db = sql();
  await db`delete from connections where id = ${row.id} and installation_id = ${installationId}`;
  if (row.provider === "slack") await updateSettings(installationId, { slackWebhookUrl: null });
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, ${"connections." + row.provider + "_removed"}, ${db.json({} as never)})`;
}

// Zoom told us someone removed the app: forget that person's connection everywhere it was made.
export async function removeZoomByHost(hostId: string): Promise<void> {
  const db = sql();
  const gone = await db`delete from connections where provider = 'zoom' and external_id = ${hostId} returning installation_id`;
  for (const g of gone) await db`insert into audit_log (installation_id, actor, action, detail) values (${g.installation_id}, null, 'connections.zoom_removed', ${db.json({ by: 'zoom' } as never)})`;
}

// An access token that works now. Refresh tokens are used once, so the new pair is saved straight away;
// if another request already rotated them we use theirs; if the provider refuses, the connection is
// marked as needing to be reconnected rather than retried forever.
export async function accessTokenFor(row: Row, f: typeof fetch = fetch): Promise<string | null> {
  if (row.provider === "slack" || !row.accessTokenEnc) return null;
  if (row.tokenExpiresAt && row.tokenExpiresAt - Date.now() > 60_000) return decryptSecret(row.accessTokenEnc);
  const keys = keysFor(row.provider);
  if (!keys || !row.refreshTokenEnc) return null;
  const db = sql();
  const result = await refreshTokens(row.provider, decryptSecret(row.refreshTokenEnc), keys, f);
  if (result.ok) {
    await db`update connections set access_token_enc = ${encryptSecret(result.tokens.accessToken)}, refresh_token_enc = ${encryptSecret(result.tokens.refreshToken)},
      token_expires_at = ${new Date(result.tokens.expiresAt)}, status = 'connected' where id = ${row.id}`;
    return result.tokens.accessToken;
  }
  const [now] = await db`select access_token_enc, refresh_token_enc, token_expires_at from connections where id = ${row.id}`;
  if (now && now.refresh_token_enc !== row.refreshTokenEnc && ms(now.token_expires_at)! - Date.now() > 60_000) return decryptSecret(now.access_token_enc as string);
  await db`update connections set status = 'needs_reconnect' where id = ${row.id}`;
  return null;
}

// Save a meeting that arrived through a connection, in the right account. There is no "default account" (N93): a meeting that cannot be
// matched with certainty, by exact email, to one contact's account is only counted, never kept. Returns what happened for the caller's reply.
export async function ingestMeeting(c: Row, m: Meeting, externalId: string | null): Promise<{ saved: boolean; matched: boolean; reason?: "no_account" | "duplicate" | "too_many" }> {
  const db = sql();
  const emails = m.attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e);
  const known = emails.length
    ? await db`
        select c.location_id, c.contact_id, lower(c.email) email from cached_contacts c
        join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
        where c.installation_id = ${c.installationId} and lower(c.email) = any(${emails}::text[])
          ${c.onlyLocationId ? db`and c.location_id = ${c.onlyLocationId}` : db``} limit 200`
    : [];
  const routed = chooseAccount(m.attendees, known.map((k) => ({ locationId: k.location_id as string, email: k.email as string, contactId: k.contact_id as string })), c.onlyLocationId);
  const [exists] = routed ? await db`select 1 from locations where installation_id = ${c.installationId} and location_id = ${routed.locationId} and not ignored` : [];
  if (!routed || !exists) {
    await db`update connections set skipped_count = skipped_count + 1, last_event_at = now() where id = ${c.id}`;
    return { saved: false, matched: false, reason: "no_account" };
  }
  if ((await recentCount(c.installationId, routed.locationId)) >= MAX_PER_HOUR) return { saved: false, matched: false, reason: "too_many" };
  const saved = await recordMeeting({ id: "", installationId: c.installationId, locationId: routed.locationId, keepTranscripts: c.keepTranscripts }, m, externalId);
  await db`update connections set saved_count = saved_count + ${saved.duplicate ? 0 : 1}, last_event_at = now() where id = ${c.id}`;
  return saved.duplicate ? { saved: false, matched: saved.matched, reason: "duplicate" } : { saved: true, matched: saved.matched };
}
