import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runDataHealthCron } from "@/lib/data-health/cron";

// Runs every hour, at 50 past. Scores a few client accounts per company (read only), keeps the daily record, raises the quality firewall alerts through the shared
// dispatcher and rehearses the weekly digest (logged only). Only for companies that have the Data health module on and the paid plan.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    return NextResponse.json(await runDataHealthCron());
  } catch (error) {
    console.error("Cron data health failed", safeError(error));
    return NextResponse.json({ error: "Data health refresh failed" }, { status: 500 });
  }
}
