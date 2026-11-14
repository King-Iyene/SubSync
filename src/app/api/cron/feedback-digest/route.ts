import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { runFeedbackDigest } from "@/lib/notifications/feedback-alert-run";

// The owner's optional daily feedback summary (FEEDBACK_DIGEST=daily, or the switch in the Feedback inbox; off by default). Safe to call more than once a day. With the send switches off it only records what would go.
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runFeedbackDigest()); }
  catch (error) { console.error("Cron feedback digest failed", safeError(error)); return NextResponse.json({ error: "Feedback digest failed" }, { status: 500 }); }
}
