import { NextResponse } from "next/server";
import { adminSummary } from "@/lib/feedback-queries";
import { safeError } from "@/lib/safe-log";

// King's view of what people said: feedback, problem reports, roadmap suggestions and votes, across every company. Not a customer screen. Read only.
// Only the server secret opens it (the same bearer secret the cron routes use), so it never answers a browser session.
// Example: curl -H "Authorization: Bearer $CRON_SECRET" https://<the app>/api/admin/feedback
// Companies appear as short ids, never names or emails. The message text is what the person typed to us, so it is shown here and nowhere else.
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await adminSummary(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Feedback summary failed", safeError(error));
    return NextResponse.json({ error: "Summary failed" }, { status: 500 });
  }
}
