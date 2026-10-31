import { decryptSecret, encryptSecret } from "../crypto";
import { LOCATION_DELETE, SYNCED_DELETE, UNINSTALL_DELETE } from "../tenant-tables";
import { sql } from "../db";
import { businessKey, isBusinessKey } from "../access";
import { normalisePlan, planFromMarketplaceId, type Plan } from "../entitlements";
import { refreshTokens, type TokenResponse } from "./client";
import { getFreshAccessToken, type TokenStore } from "./token-manager";

export type Installation = {
  id: string;
  companyId: string;
  plan: Plan;
  isDemo: boolean;
  locationLimit: number;
  mode: "agency" | "business";
  locationId: string | null;
};

// Store (or refresh) an install. An agency install is a Company token keyed by the company id. A
// client account installing for itself is a Location token, keyed "loc:<locationId>" so it can
// never collide with an agency.
export async function saveInstallation(tokens: TokenResponse): Promise<string> {
  const business = tokens.userType === "Location";
  if (business ? !tokens.locationId : tokens.userType !== "Company" || !tokens.companyId) {
    throw new Error("Unsupported install type");
  }
  const key = business ? businessKey(tokens.locationId as string) : (tokens.companyId as string);
  const mode = business ? "business" : "agency";
  const plan = planFromMarketplaceId(tokens.planId);
  const db = sql();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const [row] = await db`
    insert into installations
      (company_id, access_token_enc, refresh_token_enc, token_expires_at, scope, user_type, user_id, is_bulk_installation,
       mode, location_id, agency_company_id, plan_id, plan)
    values
      (${key}, ${encryptSecret(tokens.access_token)}, ${encryptSecret(tokens.refresh_token)},
       ${expiresAt}, ${tokens.scope ?? null}, ${tokens.userType ?? null}, ${tokens.userId ?? null}, ${tokens.isBulkInstallation ?? null},
       ${mode}, ${business ? (tokens.locationId as string) : null}, ${business ? tokens.companyId ?? null : null}, ${tokens.planId ?? null}, ${plan ?? "free"})
    on conflict (company_id) do update set
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      token_expires_at = excluded.token_expires_at,
      scope = excluded.scope,
      user_type = excluded.user_type,
      user_id = excluded.user_id,
      is_bulk_installation = excluded.is_bulk_installation,
      mode = excluded.mode,
      location_id = excluded.location_id,
      agency_company_id = excluded.agency_company_id,
      plan_id = excluded.plan_id,
      plan = case when ${plan}::text is null then installations.plan else ${plan}::text end,
      uninstalled_at = null
    returning id`;
  await db`insert into settings (installation_id) values (${row.id}) on conflict do nothing`;
  if (business) {
    await db`
      insert into locations (installation_id, location_id) values (${row.id}, ${tokens.locationId as string})
      on conflict (installation_id, location_id) do nothing`;
  }
  return row.id as string;
}

export async function getInstallation(companyKey: string): Promise<Installation | null> {
  const [row] = await sql()`
    select id, company_id, plan, is_demo, location_limit, mode, location_id
    from installations where company_id = ${companyKey} and uninstalled_at is null`;
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    plan: normalisePlan(row.plan),
    isDemo: row.is_demo,
    locationLimit: row.location_limit,
    mode: row.mode === "business" ? "business" : "agency",
    locationId: (row.location_id as string | null) ?? null,
  };
}

// Has this client account installed the app for itself?
export async function businessInstalled(locationId: string): Promise<boolean> {
  return (await getInstallation(businessKey(locationId))) !== null;
}

// Has this agency switched the app on for this client's own staff?
export async function clientViewOn(companyId: string, locationId: string): Promise<boolean> {
  const [row] = await sql()`
    select l.client_view from locations l join installations i on i.id = l.installation_id
    where i.company_id = ${companyId} and i.uninstalled_at is null and l.location_id = ${locationId}`;
  return row?.client_view === true;
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
    for (const table of LOCATION_DELETE) {
      await tx`delete from ${tx(table)} where installation_id = ${installationId} and location_id = ${locationId}`;
    }
  });
}

// The agency asked us to delete everything we have synced. Tokens, settings and API keys stay (the
// app keeps working and the next sync starts from scratch); all copied customer data goes.
export async function purgeSyncedData(installationId: string): Promise<void> {
  await sql().begin(async (tx) => {
    for (const table of SYNCED_DELETE) {
      await tx`delete from ${tx(table)} where installation_id = ${installationId}`;
    }
  });
}

// The agency uninstalled the app: delete tokens at once and purge all cached data. The
// installation row is kept (marked uninstalled) so a reinstall starts clean. What is kept, and why,
// is written in src/lib/tenant-tables.ts.
export async function purgeInstallation(companyId: string): Promise<void> {
  const db = sql();
  await db.begin(async (tx) => {
    const [row] = await tx`
      update installations
      set access_token_enc = null, refresh_token_enc = null, token_expires_at = null, uninstalled_at = now()
      where company_id = ${companyId} returning id`;
    if (!row) return;
    for (const table of UNINSTALL_DELETE) {
      await tx`delete from ${tx(table)} where installation_id = ${row.id}`;
    }
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

// A valid access token for the install, refreshed (and the rotated refresh token saved) when needed.
// For an agency this is the Company token; for a business install it is that account's own token.
export function getCompanyAccessToken(companyKey: string): Promise<string> {
  const userType = isBusinessKey(companyKey) ? "Location" : "Company";
  return getFreshAccessToken(sqlTokenStore(), (refreshToken) => refreshTokens(refreshToken, userType), companyKey);
}
