import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runScheduled } from "@/lib/notifications/service";

// Runs every hour, at five past. The weekly summary, through the notification dispatcher (stage F9): for each company whose chosen day and hour (in its chosen
// time zone) have come and whose summary has not gone out that day, it is built once and sent to everywhere that company routed it. A late run still sends
// within 3 hours; the same week is never sent twice. With SEND_EMAIL_LIVE off, nothing real is sent: each message is logged as "WOULD SEND".
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    const r = await runScheduled("weekly_summary");
    return NextResponse.json({ companies: r.checked, built: r.built });
  } catch (error) {
    console.error("Cron weekly failed", safeError(error));
    return NextResponse.json({ error: "Weekly email failed" }, { status: 500 });
  }
}
