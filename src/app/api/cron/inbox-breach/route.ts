import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runInboxBreachCron } from "@/lib/analytics/inbox-breach-alerts";

// Runs every hour. Evaluates 24-hour breach alerts for the Unanswered inbox
// and raises breach24 alerts through the shared dispatcher.
// Only for companies that have the inbox_breach_alert flag enabled.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    const rep = await runInboxBreachCron();
    return NextResponse.json(rep);
  } catch (error) {
    console.error("Cron inbox breach failed", safeError(error));
    return NextResponse.json({ error: "Inbox breach cron failed" }, { status: 500 });
  }
}