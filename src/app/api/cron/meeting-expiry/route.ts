import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runMeetingMaintenance } from "@/lib/connections/maintenance";

// Once a day: calls nobody was matched to leave the person's private Meeting inbox when their time is up, handled calls lose their text after 90 days,
// old delivery ids are removed, and a person who is no longer in the CRM loses their connection and calls (only when the users permission is granted).
// The answer holds counts only, never any content. Does nothing while the kill switch is on.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    return NextResponse.json(await runMeetingMaintenance());
  } catch (error) {
    console.error("Cron meeting-expiry failed", safeError(error));
    return NextResponse.json({ error: "Meeting clean-up failed" }, { status: 500 });
  }
}
