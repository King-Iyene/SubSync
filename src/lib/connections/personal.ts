import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import { outward, type Deps } from "../live-flags";
import { deleteFathomWebhook, keysFor, refreshTokens, revokeZoom, type Tokens } from "./oauth";
import { covers, type Person, type StatusScope } from "./person";
import { refreshLocked, type LockedRow, type RefreshStore } from "./refresh";
import { shownStatus, type Shown } from "./messages";

// Personal connections: one row per person and provider (table user_connections). Tokens are encrypted before they are saved and are read only by
// the functions in this file that need them (`accessTokenFor`, `dropProviderSide`). Every function that feeds a screen selects named columns and
// can never return a token, a secret or a webhook address: the shape returned is `MyConnection` or `TeamRow`, and a test checks that.

export type PersonalProvider = "fathom" | "zoom" | "google_meet";
export const PERSONAL_PROVIDERS: readonly PersonalProvider[] = ["fathom", "zoom", "google_meet"];
export const isPersonalProvider = (v: unknown): v is PersonalProvider => typeof v === "string" && (PERSONAL_PROVIDERS as readonly string[]).includes(v);

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type MyConnection = {
  id: string; provider: PersonalProvider; status: Shown; connectedAs: string | null; lastOkAt: string | null; lastEventAt: string | null;
  saved: number; skipped: number; lastErrorCode: string | null;
  /** True when the meeting-tool delivery switch is on, so meetings can really arrive. */
  delivery: boolean;
};

export type TeamRow = {
  id: string; person: string | null; provider: PersonalProvider; status: Shown; lastEventAt: string | null; saved: number; skipped: number; waiting: number;
  homeLocationId: string | null; connectedAt: string | null; lastErrorCode: string | null;
};

// The columns that are safe to read for a screen: no *_enc column, no public key.
const SAFE_COLUMNS = ["id", "installation_id", "ghl_user_id", "person_name", "home_location_id", "person_role", "provider", "provider_account_email", "status", "pending_since", "last_ok_at", "last_error_code", "last_event_at", "saved_count", "skipped_count", "webhook_id", "created_at"];
export { SAFE_COLUMNS };

export async function listMine(person: Person, delivery: boolean, now = Date.now()): Promise<MyConnection[]> {
  const db = sql();
  const rows = await db`select ${db(SAFE_COLUMNS as never)} from user_connections where ghl_user_id = ${person.userId} and company_key = ${person.companyKey} order by created_at`;
  return rows.map((r) => ({
    id: r.id as string, provider: r.provider as PersonalProvider, status: shownStatus(r.status as string, r.pending_since as Date | null, now), connectedAs: (r.provider_account_email as string | null) ?? null,
    lastOkAt: iso(r.last_ok_at), lastEventAt: iso(r.last_event_at), saved: r.saved_count as number, skipped: r.skipped_count as number, lastErrorCode: (r.last_error_code as string | null) ?? null, delivery,
  }));
}

/** The status table an administrator sees: names, provider, status, counts. Never a token and never any meeting content. */
export async function listTeam(installationId: string, scope: StatusScope, now = Date.now()): Promise<TeamRow[]> {
  if (scope.kind === "none") return [];
  const db = sql();
  const rows = await db`
    select ${db(SAFE_COLUMNS as never)}, (select count(*)::int from meetings m where m.installation_id = u.installation_id and m.owner_ghl_user_id = u.ghl_user_id and m.status = 'needs_contact') waiting
    from user_connections u where u.installation_id = ${installationId} order by u.created_at`;
  return rows
    .filter((r) => covers(scope, (r.home_location_id as string | null) ?? null))
    .map((r) => ({
      id: r.id as string, person: (r.person_name as string | null) ?? null, provider: r.provider as PersonalProvider, status: shownStatus(r.status as string, r.pending_since as Date | null, now),
      lastEventAt: iso(r.last_event_at), saved: r.saved_count as number, skipped: r.skipped_count as number, waiting: (r.waiting as number) ?? 0,
      homeLocationId: (r.home_location_id as string | null) ?? null, connectedAt: iso(r.created_at), lastErrorCode: (r.last_error_code as string | null) ?? null,
    }));
}

/**
 * Begin a connection: a pending row for this person and provider, so "Waiting for you..." is a stored fact that runs out after 2 minutes. An existing
 * working connection is never touched by starting again.
 */
export async function startPending(person: Person, installationId: string, provider: PersonalProvider): Promise<void> {
  const db = sql();
  await db`
    insert into user_connections (installation_id, company_key, ghl_user_id, person_name, home_location_id, person_role, provider, status, pending_since)
    values (${installationId}, ${person.companyKey}, ${person.userId}, ${person.name}, ${person.homeLocationId}, ${person.role}, ${provider}, 'pending', now())
    on conflict (ghl_user_id, provider) do update set status = 'pending', pending_since = now(), updated_at = now(),
      installation_id = excluded.installation_id, company_key = excluded.company_key, person_name = excluded.person_name, home_location_id = excluded.home_location_id, person_role = excluded.person_role
      where user_connections.status <> 'connected' or user_connections.company_key <> excluded.company_key`;
}

export type SaveArgs = {
  person: Person; installationId: string; provider: PersonalProvider; tokens: Tokens; accountEmail: string | null;
  /** Present only when the delivery switch is on and the provider created a subscription. */
  hook: { id: string; secret: string } | null; publicKey: string | null; scopes?: string | null;
};

export const newPublicKey = () => randomBytes(24).toString("base64url");

/** Saves the signed-in connection for this person (replacing an older one of theirs). Returns the old row so its provider-side subscription can be dropped. */
export async function saveConnection(a: SaveArgs): Promise<{ id: string; previous: { id: string; webhookId: string | null; installationId: string } | null }> {
  const db = sql();
  const [prev] = await db`select id, installation_id, webhook_id from user_connections where ghl_user_id = ${a.person.userId} and provider = ${a.provider}`;
  const rows = await db`
    insert into user_connections (installation_id, company_key, ghl_user_id, person_name, home_location_id, person_role, provider, provider_account_email, scopes_granted,
      access_token_enc, refresh_token_enc, token_expires_at, webhook_id, webhook_secret_enc, public_key, status, pending_since, last_ok_at, last_error_code, revoked_by, revoked_at)
    values (${a.installationId}, ${a.person.companyKey}, ${a.person.userId}, ${a.person.name}, ${a.person.homeLocationId}, ${a.person.role}, ${a.provider}, ${a.accountEmail}, ${a.scopes ?? null},
      ${encryptSecret(a.tokens.accessToken)}, ${encryptSecret(a.tokens.refreshToken)}, ${new Date(a.tokens.expiresAt)}, ${a.hook?.id ?? null},
      ${a.hook ? encryptSecret(a.hook.secret) : null}, ${a.publicKey}, 'connected', null, now(), null, null, null)
    on conflict (ghl_user_id, provider) do update set
      installation_id = excluded.installation_id, company_key = excluded.company_key, person_name = excluded.person_name, home_location_id = excluded.home_location_id, person_role = excluded.person_role,
      provider_account_email = excluded.provider_account_email, scopes_granted = excluded.scopes_granted, access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc, token_expires_at = excluded.token_expires_at, webhook_id = excluded.webhook_id,
      webhook_secret_enc = excluded.webhook_secret_enc, public_key = excluded.public_key, status = 'connected', pending_since = null, last_ok_at = now(),
      last_error_code = null, revoked_by = null, revoked_at = null, updated_at = now()
    returning id`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${a.installationId}, ${a.person.userId}, 'connections.personal_connected', ${db.json({ provider: a.provider } as never)})`;
  return { id: rows[0].id as string, previous: prev ? { id: prev.id as string, webhookId: (prev.webhook_id as string | null) ?? null, installationId: prev.installation_id as string } : null };
}

// ---------------- reading a row with its secrets (server code only) ----------------

export type SecretRow = {
  id: string; installationId: string; provider: PersonalProvider; ghlUserId: string; webhookId: string | null; accessTokenEnc: string | null; refreshTokenEnc: string | null;
  tokenExpiresAt: number | null; homeLocationId: string | null; status: string;
};

export async function secretRowOf(person: Person, id: string): Promise<SecretRow | null> {
  const [r] = await sql()`select id, installation_id, provider, ghl_user_id, webhook_id, access_token_enc, refresh_token_enc, token_expires_at, home_location_id, status from user_connections where id = ${id} and ghl_user_id = ${person.userId} and company_key = ${person.companyKey}`;
  return r ? secretRow(r) : null;
}

/** For an administrator: only a connection inside the installation, and only one their scope covers. Never returns another company's row. */
export async function secretRowForAdmin(installationId: string, scope: StatusScope, id: string): Promise<SecretRow | null> {
  const [r] = await sql()`select id, installation_id, provider, ghl_user_id, webhook_id, access_token_enc, refresh_token_enc, token_expires_at, home_location_id, status from user_connections where id = ${id} and installation_id = ${installationId}`;
  return r && covers(scope, (r.home_location_id as string | null) ?? null) ? secretRow(r) : null;
}

const secretRow = (r: Record<string, unknown>): SecretRow => ({
  id: r.id as string, installationId: r.installation_id as string, provider: r.provider as PersonalProvider, ghlUserId: r.ghl_user_id as string, webhookId: (r.webhook_id as string | null) ?? null,
  accessTokenEnc: (r.access_token_enc as string | null) ?? null, refreshTokenEnc: (r.refresh_token_enc as string | null) ?? null,
  tokenExpiresAt: r.token_expires_at instanceof Date ? r.token_expires_at.getTime() : null, homeLocationId: (r.home_location_id as string | null) ?? null, status: r.status as string,
});

// ---------------- the locked refresh ----------------

/** The real lock: a transaction that holds `select ... for update` on the row while the provider is asked. Two callers for one row take turns. */
export function pgRefreshStore(): RefreshStore {
  return {
    withLock: (id, fn) =>
      sql().begin(async (tx) => {
        const row: LockedRow = {
          read: async () => {
            const [r] = await tx`select access_token_enc, refresh_token_enc, token_expires_at, status from user_connections where id = ${id} for update`;
            // A connection that is revoked or waiting to be reconnected has nothing to refresh: asking the provider again would only spend a refresh token for nothing.
            if (!r?.access_token_enc || !r.refresh_token_enc || r.status !== 'connected') return null;
            return { accessToken: decryptSecret(r.access_token_enc as string), refreshToken: decryptSecret(r.refresh_token_enc as string), expiresAt: r.token_expires_at instanceof Date ? r.token_expires_at.getTime() : 0 };
          },
          save: async (next) => {
            await tx`update user_connections set access_token_enc = ${encryptSecret(next.accessToken)}, refresh_token_enc = ${encryptSecret(next.refreshToken)}, token_expires_at = ${new Date(next.expiresAt)}, status = 'connected', last_ok_at = now(), last_error_code = null, updated_at = now() where id = ${id}`;
          },
          markNeedsReconnect: async (code) => {
            await tx`update user_connections set status = 'needs_reconnect', last_error_code = ${code}, updated_at = now() where id = ${id}`;
          },
        };
        return fn(row);
      }) as Promise<Awaited<ReturnType<typeof fn>>>,
  };
}

/** An access token that works now, refreshed under the lock when needed. Null when the person must reconnect. */
export async function accessTokenFor(row: SecretRow, f: typeof fetch = fetch): Promise<string | null> {
  if (row.provider === "google_meet") return null;
  const provider = row.provider;
  const keys = keysFor(provider);
  if (!keys) return null;
  const result = await refreshLocked(pgRefreshStore(), row.id, async (refreshToken) => {
    const r = await refreshTokens(provider, refreshToken, keys, f);
    return r.ok ? { ok: true as const, tokens: r.tokens } : { ok: false as const };
  });
  return result.ok ? result.accessToken : null;
}

// ---------------- leaving: provider side first, then the row ----------------

/**
 * Tell the provider to stop: delete SubSync's Fathom subscription (or revoke a Zoom token). The call goes through the dry-run gate (FATHOM_WEBHOOK_LIVE,
 * which covers every meeting-tool subscription): with it off, the call is only recorded as "WOULD WRITE" and no token is read. Best effort, never throws.
 */
export async function dropProviderSide(row: Pick<SecretRow, "id" | "installationId" | "provider" | "webhookId" | "accessTokenEnc" | "refreshTokenEnc" | "tokenExpiresAt" | "ghlUserId" | "homeLocationId" | "status">, f: typeof fetch = fetch, deps: Deps = {}): Promise<"done" | "dry_run" | "skipped" | "failed"> {
  if (row.provider !== "fathom" && row.provider !== "zoom") return "skipped";
  if (row.provider === "fathom" && !row.webhookId) return "skipped";
  try {
    const done = await outward(
      { flag: "FATHOM_WEBHOOK_LIVE", verb: "DELETE", what: row.provider === "fathom" ? "fathom.webhook.delete" : "zoom.token.revoke", installationId: row.installationId, ids: { connectionId: row.id, webhookId: row.webhookId } },
      async () => {
        const token = await accessTokenFor({ ...row, provider: row.provider }, f);
        if (!token) return false;
        if (row.provider === "fathom") return deleteFathomWebhook(token, row.webhookId as string, f);
        const keys = keysFor("zoom");
        return keys ? revokeZoom(token, keys, f) : false;
      },
      deps,
    );
    return done.live ? (done.result ? "done" : "failed") : "dry_run";
  } catch {
    return "failed";
  }
}

/** A person disconnects their own tool: the provider is told first, then the row (and its tokens) is deleted. Their stored meetings stay in their inbox. */
export async function disconnectOwn(person: Person, id: string, f: typeof fetch = fetch, deps: Deps = {}): Promise<boolean> {
  const row = await secretRowOf(person, id);
  if (!row) return false;
  await dropProviderSide(row, f, deps);
  const db = sql();
  await db`delete from user_connections where id = ${id} and ghl_user_id = ${person.userId}`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${row.installationId}, ${person.userId}, 'connections.personal_removed', ${db.json({ provider: row.provider } as never)})`;
  return true;
}

/**
 * An administrator revokes someone's connection: the provider subscription is dropped, the tokens are erased, and the row stays as "revoked" so the person
 * sees why and must connect again. The administrator can never connect for someone, read their tokens, or revoke a connection outside their scope.
 */
export async function revokeByAdmin(installationId: string, admin: Person, scope: StatusScope, id: string, f: typeof fetch = fetch, deps: Deps = {}): Promise<boolean> {
  const row = await secretRowForAdmin(installationId, scope, id);
  if (!row) return false;
  await dropProviderSide(row, f, deps);
  const db = sql();
  await db`update user_connections set status = 'revoked', access_token_enc = null, refresh_token_enc = null, token_expires_at = null, webhook_id = null,
    webhook_secret_enc = null, public_key = null, revoked_by = ${admin.userId}, revoked_at = now(), updated_at = now() where id = ${id} and installation_id = ${row.installationId}`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${row.installationId}, ${admin.userId}, 'connections.personal_revoked', ${db.json({ provider: row.provider } as never)})`;
  return true;
}
