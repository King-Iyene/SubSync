import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { sql } from "@/lib/db";
import { runSlice, scheduleDailyRefresh, scheduleFastRefresh } from "@/lib/sync/engine";

// Called by Vercel Cron every five minutes. Each run works for up to four minutes, so a large account finishes in a few runs.
// Called by Vercel Cron. Vercel sends `Authorization: Bearer $CRON_SECRET`
// when CRON_SECRET is set; with no secret configured the endpoint refuses to run.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    const scheduled = (await scheduleDailyRefresh()) + (await scheduleFastRefresh());
    const slice = await runSlice(240_000);
    const callQueue = await import("@/lib/dial/callqueue-run").then((m) => m.runAutoCallQueues()).catch(() => null);
    // Fathom auto-match: calls waiting in a person's private inbox are looked at again once their accounts' contacts have synced (counts only; never fails the sync).
    const rematch = await import("@/lib/connections/rematch-run").then((m) => m.runRematch({ onlyIfSynced: true, maxPeople: 20 })).catch(() => null);
    // Keep the de-duplication table small.
    await sql()`delete from webhook_events where received_at < now() - interval '3 days'`;
    return NextResponse.json({ scheduled, ...slice, callQueue, rematch });
  } catch (error) {
    console.error("Cron sync failed", safeError(error));
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
