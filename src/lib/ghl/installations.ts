import "server-only";
import { decryptSecret, encryptSecret } from "../crypto";
import { supabaseAdmin } from "../supabase/admin";
import { refreshTokens, type TokenResponse } from "./client";
import { getFreshAccessToken, type TokenStore } from "./token-manager";

// Store (or refresh) an agency install. Only Company-level installs are supported;
// the app is installable by agencies only.
export async function saveInstallation(tokens: TokenResponse): Promise<string> {
  if (tokens.userType !== "Company" || !tokens.companyId) {
    throw new Error("Only agency (Company) installs are supported");
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("installations")
    .upsert(
      {
        company_id: tokens.companyId,
        access_token_enc: encryptSecret(tokens.access_token),
        refresh_token_enc: encryptSecret(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? null,
        user_type: tokens.userType,
        user_id: tokens.userId ?? null,
        is_bulk_installation: tokens.isBulkInstallation ?? null,
        uninstalled_at: null,
      },
      { onConflict: "company_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error("Failed to save installation");

  // Make sure the agency has a settings row with defaults.
  const settings = await db
    .from("settings")
    .upsert({ installation_id: data.id }, { onConflict: "installation_id", ignoreDuplicates: true });
  if (settings.error) throw new Error("Failed to save settings");

  return data.id as string;
}

export async function isInstalled(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("installations")
    .select("id")
    .eq("company_id", companyId)
    .is("uninstalled_at", null)
    .maybeSingle();
  if (error) throw new Error("Failed to look up installation");
  return Boolean(data);
}

export async function getInstallationId(companyId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("installations")
    .select("id")
    .eq("company_id", companyId)
    .is("uninstalled_at", null)
    .maybeSingle();
  if (error) throw new Error("Failed to look up installation");
  return (data?.id as string | undefined) ?? null;
}

function supabaseTokenStore(): TokenStore {
  return {
    async load(companyId) {
      const { data, error } = await supabaseAdmin()
        .from("installations")
        .select("id, access_token_enc, refresh_token_enc, token_expires_at")
        .eq("company_id", companyId)
        .is("uninstalled_at", null)
        .maybeSingle();
      if (error) throw new Error("Failed to load installation");
      if (!data?.access_token_enc || !data.refresh_token_enc || !data.token_expires_at) return null;
      return {
        id: data.id as string,
        accessToken: decryptSecret(data.access_token_enc),
        refreshToken: decryptSecret(data.refresh_token_enc),
        refreshTokenKey: data.refresh_token_enc as string,
        expiresAt: new Date(data.token_expires_at),
      };
    },
    async swap(id, expectedKey, next) {
      const { data, error } = await supabaseAdmin()
        .from("installations")
        .update({
          access_token_enc: encryptSecret(next.accessToken),
          refresh_token_enc: encryptSecret(next.refreshToken),
          token_expires_at: next.expiresAt.toISOString(),
        })
        .eq("id", id)
        .eq("refresh_token_enc", expectedKey)
        .select("id");
      if (error) throw new Error("Failed to save refreshed tokens");
      return (data?.length ?? 0) === 1;
    },
  };
}

// A valid agency access token, refreshed (and the rotated refresh token saved) when needed.
export function getCompanyAccessToken(companyId: string): Promise<string> {
  return getFreshAccessToken(supabaseTokenStore(), refreshTokens, companyId);
}
