import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { drainWebhookInbox } from "@/lib/ghl/webhook-inbox";

// Called by Vercel Cron every minute: handles the platform events the webhook route queued (a bulk import or bulk delete sends tens of thousands).
// Vercel sends `Authorization: Bearer $CRON_SECRET`; with no secret configured the endpoint refuses to run.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    return NextResponse.json(await drainWebhookInbox({ budgetMs: 40_000 }));
  } catch (error) {
    console.error("Cron webhook inbox failed", safeError(error));
    return NextResponse.json({ error: "Drain failed" }, { status: 500 });
  }
}
