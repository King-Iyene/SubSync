import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { parseMeeting } from "@/lib/analytics/meeting-intel";
import { featureOn } from "@/lib/flags";
import { MAX_PER_HOUR, recentCount, recordMeeting, resolveHook } from "@/lib/analytics/meeting-queries";

// The address a meeting tool posts to (Fathom's webhook, or Zoom through an automation). The secret
// part of the address says which client account the notes belong to. Nothing here reads the platform
// or writes to a client's CRM: it only stores a tidy summary inside SubSync for a person to review.
export const maxDuration = 30;
const MAX_BYTES = 400_000;

export async function POST(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Switched off: the address behaves as if it does not exist.
  if (!(await featureOn("meetings"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hook = await resolveHook(token).catch(() => null);
  // Same answer for a wrong address and a revoked one.
  if (!hook) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "That is too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  const meeting = parseMeeting(body, new URL(request.url).searchParams.get("source"));
  if (!meeting) return NextResponse.json({ error: "Nothing to save: send a title, summary or transcript" }, { status: 422 });
  if ((await recentCount(hook.installationId, hook.locationId)) >= MAX_PER_HOUR) return NextResponse.json({ error: "Too many meetings this hour" }, { status: 429 });

  try {
    const saved = await recordMeeting(hook, meeting);
    return NextResponse.json({ ok: true, matchedContact: saved.matched });
  } catch (error) {
    console.error("Saving a meeting failed", safeError(error));
    return NextResponse.json({ error: "Could not save that. Try again." }, { status: 500 });
  }
}
