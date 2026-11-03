import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { collectCapabilities } from "@/lib/ghl/capabilities-run";

// The live capability check, for the person who runs SubSync (not a customer screen): which kinds of data the platform really gives this app,
// install by install, and why anything is missing (docs/CAPABILITIES.md). Read only: GET requests to the platform, at most 70 of them, and
// the answer holds field names, counts and statuses, never a value or a token. Only the server secret opens it (the same bearer secret the
// cron routes use), so it never answers a browser session.
// Example: curl -H "Authorization: Bearer $CRON_SECRET" https://<the app>/api/admin/capabilities
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await collectCapabilities(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Capability check failed", safeError(error));
    return NextResponse.json({ error: "Capability check failed" }, { status: 500 });
  }
}
