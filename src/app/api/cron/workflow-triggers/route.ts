import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runWorkflowTriggers } from "@/lib/workflow-module/runtime";

// Every 10 minutes: sends the workflow module's triggers for accounts that switched one on (flag wf_module). A dry run until WORKFLOWS_WRITE_LIVE is on.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    return NextResponse.json(await runWorkflowTriggers());
  } catch (error) {
    console.error("Cron workflow triggers failed", safeError(error));
    return NextResponse.json({ error: "Workflow triggers failed" }, { status: 500 });
  }
}
