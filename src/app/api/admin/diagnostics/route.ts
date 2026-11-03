import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { collectDiagnostics } from "@/lib/sync/watchdog";

// Sync health across every real install, for the person who runs SubSync (not a customer screen). Read only: it writes nothing.
// Only the server secret opens it (the same bearer secret the cron routes use), so it never answers a browser session.
// Example: curl -H "Authorization: Bearer $CRON_SECRET" https://<the app>/api/admin/diagnostics
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json((await collectDiagnostics()).diagnostics, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Diagnostics failed", safeError(error));
    return NextResponse.json({ error: "Diagnostics failed" }, { status: 500 });
  }
}
