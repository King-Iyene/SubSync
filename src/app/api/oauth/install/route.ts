import { NextResponse } from "next/server";
import { buildInstallUrl } from "@/lib/ghl/scopes";

// Convenience entry point that sends an agency to the platform's install screen.
// The portal's own install/test links work too; both end at /api/oauth/callback.
export function GET() {
  const clientId = process.env.GHL_CLIENT_ID;
  const redirectUri = process.env.GHL_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "The app is not configured for installs yet" },
      { status: 503 },
    );
  }
  return NextResponse.redirect(buildInstallUrl(clientId, redirectUri));
}
