import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { exchangeCode, GhlError } from "@/lib/ghl/client";
import { saveInstallation } from "@/lib/ghl/installations";
import { signLanding } from "@/lib/install-landing";
import { companyDomain } from "@/lib/analytics/queries";
import { enqueueFullSync, runSlice } from "@/lib/sync/engine";

export async function GET(request: Request) {
  const done = (path: string) => NextResponse.redirect(new URL(path, request.url));

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return done("/installed/error");

  try {
    const tokens = await exchangeCode(code);
    const installationId = await saveInstallation(tokens);

    // Best effort: the install itself has succeeded, so a failure here must not fail it. The
    // first sync is queued and the cron worker finishes it; we also run a short slice now so
    // the client account list is there by the time the agency opens the app.
    try {
      await enqueueFullSync(installationId);
      await runSlice(15_000);
    } catch (error) {
      console.error("Initial sync did not start", safeError(error));
    }
    // Tell the page where to send the person back to: what kind of install it was, the account, and the company's own CRM domain when one is stored. No token goes in the address.
    let landing = "";
    try {
      const resolved = await companyDomain(installationId);
      const business = tokens.userType === "Location" && tokens.locationId;
      landing = signLanding({ kind: business ? "account" : "company", locationId: business ? (tokens.locationId as string) : null, domain: resolved.source === "default" ? null : resolved.appDomain });
    } catch (error) {
      console.error("Install landing details were not built", safeError(error));
    }
    return done(landing ? `/installed?v=${encodeURIComponent(landing)}` : "/installed");
  } catch (error) {
    // Log what failed without echoing tokens, codes or request bodies.
    if (error instanceof GhlError) {
      console.error("OAuth code exchange failed", { status: error.status, detail: safeError(new Error(typeof error.detail === "string" ? error.detail : "see status")) });
    } else {
      console.error("Install failed", safeError(error));
    }
    return done("/installed/error");
  }
}
