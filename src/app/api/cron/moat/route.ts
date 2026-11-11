import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runMoatCron } from "@/lib/analytics/moat-cron";

// Runs every hour: keeps the raw lead record current and, on Monday morning, writes the weekly proof receipts (email dry-run only). Only for companies with the flags on.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    return NextResponse.json(await runMoatCron());
  } catch (error) {
    console.error("Cron moat failed", safeError(error));
    return NextResponse.json({ error: "Moat cron failed" }, { status: 500 });
  }
}
