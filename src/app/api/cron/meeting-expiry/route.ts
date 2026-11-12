import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { maintenanceOn } from "@/lib/runtime-guards";
import { runMeetingMaintenance } from "@/lib/connections/maintenance";
import { dayToRecord } from "@/lib/connections/meeting-logging";
import { recordOutcomesForAll } from "@/lib/connections/meeting-logging-store";

// Once a day: calls nobody was matched to leave the person's private Meeting inbox when their time is up, handled calls lose their text after 90 days,
// old delivery ids are removed, and a person who is no longer in the CRM loses their connection and calls (only when the users permission is granted).
// The answer holds counts only, never any content. Does nothing while the kill switch is on.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (maintenanceOn(process.env)) return NextResponse.json({ skipped: "maintenance" });
  try {
    const result = await runMeetingMaintenance();
    // Our own history (MEETINGS_BRIEF slice 4): counts per account for the day whose seven following days are complete. Idempotent; a failure here never fails the clean-up.
    const outcomes = await recordOutcomesForAll(dayToRecord(Date.now())).catch((error) => { console.error("Meeting outcome record failed", safeError(error)); return { error: "outcome_record_failed" }; });
    return NextResponse.json({ ...result, outcomes });
  } catch (error) {
    console.error("Cron meeting-expiry failed", safeError(error));
    return NextResponse.json({ error: "Meeting clean-up failed" }, { status: 500 });
  }
}
