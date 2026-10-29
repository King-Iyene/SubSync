import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { runSlice, scheduleDailyRefresh } from "@/lib/sync/engine";

// Called by Vercel Cron every few minutes. Vercel sends `Authorization: Bearer $CRON_SECRET`
// when CRON_SECRET is set; with no secret configured the endpoint refuses to run.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scheduled = await scheduleDailyRefresh();
    const slice = await runSlice(45_000);
    // Keep the de-duplication table small.
    await sql()`delete from webhook_events where received_at < now() - interval '3 days'`;
    return NextResponse.json({ scheduled, ...slice });
  } catch (error) {
    console.error("Cron sync failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
