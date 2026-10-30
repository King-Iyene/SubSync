import { NextResponse } from "next/server";
import { parseMeeting } from "@/lib/analytics/meeting-intel";
import { findFathomByKey, ingestMeeting } from "@/lib/connections/queries";
import { verifyFathom } from "@/lib/connections/signatures";
import { decryptSecret } from "@/lib/crypto";

// Fathom posts here when a recording's summary is ready. The address is the one SubSync registered with
// Fathom itself when the person signed in. Every request must carry a valid signature made with the
// secret Fathom gave us, and requests older than five minutes are refused. Nothing here writes to a
// client's CRM: it saves a summary inside SubSync for a person to review.
export const maxDuration = 30;
const MAX_BYTES = 400_000;
const KEY = /^[A-Za-z0-9_-]{20,64}$/;

export async function POST(request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const conn = KEY.test(key) ? await findFathomByKey(key).catch(() => null) : null;
  // The same answer for a wrong address and a disconnected one.
  if (!conn || !conn.webhookSecretEnc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "That is too large" }, { status: 413 });
  const h = request.headers;
  const signed = verifyFathom({
    secret: decryptSecret(conn.webhookSecretEnc), id: h.get("webhook-id"), timestamp: h.get("webhook-timestamp"), signature: h.get("webhook-signature"), body: text,
  });
  if (!signed) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  }
  // Anything that is not a usable meeting is acknowledged, so Fathom does not keep retrying it.
  const meeting = parseMeeting(body, "fathom");
  if (!meeting) return NextResponse.json({ ok: true, ignored: true });
  const recording = (body as Record<string, unknown>).recording_id;
  const externalId = `fathom:${typeof recording === "string" || typeof recording === "number" ? String(recording).slice(0, 100) : (h.get("webhook-id") ?? "").slice(0, 100)}`;
  try {
    const result = await ingestMeeting(conn, meeting, externalId);
    return NextResponse.json({ ok: true, saved: result.saved, reason: result.reason ?? null });
  } catch (error) {
    console.error("Saving a Fathom meeting failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not save that. Try again." }, { status: 500 });
  }
}
