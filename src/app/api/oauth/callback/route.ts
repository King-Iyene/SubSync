import { NextResponse } from "next/server";
import { exchangeCode, GhlError } from "@/lib/ghl/client";
import { saveInstallation } from "@/lib/ghl/installations";
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
      console.error("Initial sync did not start", error instanceof Error ? error.message : "unknown error");
    }
    return done("/installed");
  } catch (error) {
    // Log what failed without echoing tokens, codes or request bodies.
    if (error instanceof GhlError) {
      console.error("OAuth code exchange failed", { status: error.status, detail: error.detail });
    } else {
      console.error("Install failed", error instanceof Error ? error.message : "unknown error");
    }
    return done("/installed/error");
  }
}
