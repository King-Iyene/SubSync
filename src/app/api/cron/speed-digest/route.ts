import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/secret-compare";
import { safeError } from "@/lib/safe-log";
import { runSpeedDigests } from "@/lib/analytics/speed-digest-db";

// The Speed summary: sends every enabled message that is due in its own local time (once per day or week). Safe to call every hour, or late. With the send switches off it only writes WOULD SEND audit lines.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await runSpeedDigests()); }
  catch (error) { console.error("Cron speed digest failed", safeError(error)); return NextResponse.json({ error: "Speed digest failed" }, { status: 500 }); }
}
