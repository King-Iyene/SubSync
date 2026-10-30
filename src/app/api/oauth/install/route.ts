import { NextResponse } from "next/server";
import { redirectUri } from "@/lib/ghl/client";
import { buildInstallUrl } from "@/lib/ghl/scopes";

// Convenience entry point that sends an agency to the platform's install screen.
// The portal's own install/test links work too; both end at /api/oauth/callback.
export function GET() {
  const clientId = process.env.GHL_CLIENT_ID;
  let redirect = "";
  try { redirect = redirectUri(); } catch { /* not configured */ }
  if (!clientId || !redirect) {
    return NextResponse.json(
      { error: "The app is not configured for installs yet" },
      { status: 503 },
    );
  }
  return NextResponse.redirect(buildInstallUrl(clientId, redirect));
}
