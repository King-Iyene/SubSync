import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { drainAll, runScheduled } from "@/lib/notifications/service";

// Runs every hour. Two jobs, both through the notification dispatcher (stage F9):
//   1. The daily brief: for each company whose chosen hour (in its chosen time zone) has come and whose brief has not gone out today, the brief is built once
//      and sent to everywhere that company routed it (the bell, email recipients, Slack channels). A run that is late still sends the same morning (within 3
//      hours); a day is never sent twice (the dispatcher's ledger).
//   2. Messages that were waiting: warnings held back by quiet hours, "once a day" messages whose hour has come, and sends that failed and are due a retry.
// With the live switches off (SEND_EMAIL_LIVE, SEND_SLACK_LIVE) nothing real is sent: each message is written to the log as "WOULD SEND" and marked done.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    const brief = await runScheduled("daily_brief");
    const waiting = await drainAll();
    return NextResponse.json({ companies: brief.checked, built: brief.built, waiting });
  } catch (error) {
    console.error("Cron daily failed", safeError(error));
    return NextResponse.json({ error: "Daily brief failed" }, { status: 500 });
  }
}
