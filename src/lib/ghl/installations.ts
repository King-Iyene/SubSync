import "server-only";
import { encryptSecret } from "../crypto";
import { supabaseAdmin } from "../supabase/admin";
import type { TokenResponse } from "./client";

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
