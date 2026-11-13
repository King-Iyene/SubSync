import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runWorkflowsCron } from "@/lib/workflows/cron";
import { runCallQueueDailyCheck } from "@/lib/workflows-setup/daily";

// Runs every hour, at 35 past. Reads a few client accounts' workflows and campaigns per company (read only), raises the Workflows alerts, and on Monday morning
// rehearses the weekly Proof email (logged only: it needs its own notification type before it can be sent). Only for companies that have the Workflows module switched on and the paid plan.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    const report = await runWorkflowsCron();
    // The call queue workflow check (a few accounts per run, each once a day, read only). Never lets the Workflows refresh fail.
    const callQueue = await runCallQueueDailyCheck().catch((e) => { console.error("Call queue daily check failed", safeError(e)); return null; });
    return NextResponse.json({ ...report, callQueue });
  } catch (error) {
    console.error("Cron workflows failed", safeError(error));
    return NextResponse.json({ error: "Workflows refresh failed" }, { status: 500 });
  }
}
