import { NextResponse } from "next/server";
import { redirectUri } from "@/lib/ghl/client";
import { buildInstallUrl } from "@/lib/ghl/scopes";
import { installTarget } from "@/lib/install-redirect";

// The one stable install address of the website: Install buttons everywhere point to /install. It redirects to the marketplace listing (MARKETPLACE_LISTING_URL,
// when set) or to the install screen the app already builds. The older /api/oauth/install keeps working. Nothing secret is logged or put in an address.
export function GET(request: Request) {
  let redirect: string | null = null;
  try { redirect = redirectUri(); } catch { /* not configured: the Support page is the fallback */ }
  const target = installTarget(
    { listingUrl: process.env.MARKETPLACE_LISTING_URL, clientId: process.env.GHL_CLIENT_ID, redirectUri: redirect, crm: new URL(request.url).searchParams.get("crm") },
    buildInstallUrl,
  );
  return NextResponse.redirect(new URL(target.href, request.url), 302);
}
