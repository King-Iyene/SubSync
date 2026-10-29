import "server-only";
import { getInstalledLocations } from "../ghl/client";
import { getCompanyAccessToken, getInstallationId } from "../ghl/installations";
import { supabaseAdmin } from "../supabase/admin";
import { listAllInstalledLocations } from "./installed-locations";

// Pull the list of client accounts where the app is installed and upsert them into `locations`.
// Returns how many accounts were found.
export async function syncInstalledLocations(companyId: string): Promise<number> {
  const appId = process.env.GHL_APP_ID;
  if (!appId) throw new Error("Missing environment variable GHL_APP_ID");

  const installationId = await getInstallationId(companyId);
  if (!installationId) throw new Error("No installation found for this agency");

  const accessToken = await getCompanyAccessToken(companyId);
  const installed = await listAllInstalledLocations((page) =>
    getInstalledLocations(accessToken, companyId, appId, page),
  );

  const db = supabaseAdmin();
  const rows = installed.map((location) => ({
    installation_id: installationId,
    location_id: location._id,
    name: location.name ?? null,
  }));

  for (let start = 0; start < rows.length; start += 500) {
    const { error } = await db
      .from("locations")
      .upsert(rows.slice(start, start + 500), { onConflict: "installation_id,location_id" });
    if (error) throw new Error("Failed to save client accounts");
  }
  return rows.length;
}
