import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { runWatchdog } from "@/lib/sync/watchdog";

// The internal alarm. Called by Vercel Cron every ten minutes, from its own entry in vercel.json so that it still runs if the sync worker's own
// function is the thing that broke. It writes "sync.alarm" and "sync.recovered" lines to the audit log (ids, times and counts only) and sends
// nothing: telling a person is a dry run for now. It does not stop for the maintenance switch's sake: during maintenance it simply does nothing.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runWatchdog());
  } catch (error) {
    console.error("Cron watchdog failed", safeError(error));
    return NextResponse.json({ error: "Watchdog failed" }, { status: 500 });
  }
}
