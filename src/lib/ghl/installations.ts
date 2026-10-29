import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import { normalisePlan, type Plan } from "../entitlements";
import { refreshTokens, type TokenResponse } from "./client";
import { getFreshAccessToken, type TokenStore } from "./token-manager";

export type Installation = {
  id: string;
  companyId: string;
  plan: Plan;
  isDemo: boolean;
  locationLimit: number;
};

// Store (or refresh) an agency install. Only Company-level installs are supported;
// the app is installable by agencies only.
export async function saveInstallation(tokens: TokenResponse): Promise<string> {
  if (tokens.userType !== "Company" || !tokens.companyId) {
    throw new Error("Only agency (Company) installs are supported");
  }
  const db = sql();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const [row] = await db`
    insert into installations
      (company_id, access_token_enc, refresh_token_enc, token_expires_at, scope, user_type, user_id, is_bulk_installation)
    values
      (${tokens.companyId}, ${encryptSecret(tokens.access_token)}, ${encryptSecret(tokens.refresh_token)},
       ${expiresAt}, ${tokens.scope ?? null}, ${tokens.userType}, ${tokens.userId ?? null}, ${tokens.isBulkInstallation ?? null})
    on conflict (company_id) do update set
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      token_expires_at = excluded.token_expires_at,
      scope = excluded.scope,
      user_type = excluded.user_type,
      user_id = excluded.user_id,
      is_bulk_installation = excluded.is_bulk_installation,
      uninstalled_at = null
    returning id`;
  await db`insert into settings (installation_id) values (${row.id}) on conflict do nothing`;
  return row.id as string;
}

export async function getInstallation(companyId: string): Promise<Installation | null> {
  const [row] = await sql()`
    select id, company_id, plan, is_demo, location_limit
    from installations where company_id = ${companyId} and uninstalled_at is null`;
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    plan: normalisePlan(row.plan),
    isDemo: row.is_demo,
    locationLimit: row.location_limit,
  };
}

export async function isInstalled(companyId: string): Promise<boolean> {
  return (await getInstallation(companyId)) !== null;
}

export async function setPlan(installationId: string, plan: Plan): Promise<void> {
  await sql()`update installations set plan = ${plan} where id = ${installationId}`;
}

// Delete everything we hold for one client account (it uninstalled the app, or was removed).
export async function purgeLocationData(installationId: string, locationId: string): Promise<void> {
  const db = sql();
  await db.begin(async (tx) => {
    await tx`delete from cached_contacts where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from cached_conversations where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from pipelines where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from account_metrics_daily where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from alerts where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from domain_checks where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from onboarding_tasks where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from sync_jobs where installation_id = ${installationId} and location_id = ${locationId}`;
    await tx`delete from locations where installation_id = ${installationId} and location_id = ${locationId}`;
  });
}

// The agency asked us to delete everything we have synced. Tokens, settings and API keys stay (the
// app keeps working and the next sync starts from scratch); all copied customer data goes.
export async function purgeSyncedData(installationId: string): Promise<void> {
  await sql().begin(async (tx) => {
    for (const table of [
      "cached_contacts", "cached_opportunities", "cached_conversations", "pipelines",
      "account_metrics_daily", "alerts", "domain_checks", "onboarding_tasks", "sync_jobs", "locations",
    ]) {
      await tx`delete from ${tx(table)} where installation_id = ${installationId}`;
    }
  });
}

// The agency uninstalled the app: delete tokens at once and purge all cached data. The
// installation row is kept (marked uninstalled) so a reinstall starts clean.
export async function purgeInstallation(companyId: string): Promise<void> {
  const db = sql();
  await db.begin(async (tx) => {
    const [row] = await tx`
      update installations
      set access_token_enc = null, refresh_token_enc = null, token_expires_at = null, uninstalled_at = now()
      where company_id = ${companyId} returning id`;
    if (!row) return;
    for (const table of [
      "cached_contacts", "cached_opportunities", "cached_conversations", "pipelines",
      "account_metrics_daily", "alerts", "domain_checks", "onboarding_tasks", "sync_jobs", "locations",
    ]) {
      await tx`delete from ${tx(table)} where installation_id = ${row.id}`;
    }
    await tx`delete from settings where installation_id = ${row.id}`;
  });
}

function sqlTokenStore(): TokenStore {
  return {
    async load(companyId) {
      const [row] = await sql()`
        select id, access_token_enc, refresh_token_enc, token_expires_at
        from installations where company_id = ${companyId} and uninstalled_at is null`;
      if (!row?.access_token_enc || !row.refresh_token_enc || !row.token_expires_at) return null;
      return {
        id: row.id,
        accessToken: decryptSecret(row.access_token_enc),
        refreshToken: decryptSecret(row.refresh_token_enc),
        refreshTokenKey: row.refresh_token_enc,
        expiresAt: new Date(row.token_expires_at),
      };
    },
    async swap(id, expectedKey, next) {
      const rows = await sql()`
        update installations set
          access_token_enc = ${encryptSecret(next.accessToken)},
          refresh_token_enc = ${encryptSecret(next.refreshToken)},
          token_expires_at = ${next.expiresAt.toISOString()}
        where id = ${id} and refresh_token_enc = ${expectedKey}
        returning id`;
      return rows.length === 1;
    },
  };
}

// A valid agency access token, refreshed (and the rotated refresh token saved) when needed.
export function getCompanyAccessToken(companyId: string): Promise<string> {
  return getFreshAccessToken(sqlTokenStore(), refreshTokens, companyId);
}
