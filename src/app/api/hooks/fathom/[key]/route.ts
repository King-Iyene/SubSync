import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { parseMeeting } from "@/lib/analytics/meeting-intel";
import { featureOn } from "@/lib/flags";
import { findFathomByKey, ingestMeeting } from "@/lib/connections/queries";
import { verifyFathom } from "@/lib/connections/signatures";
import { decryptSecret } from "@/lib/crypto";
import { handleFathomDelivery, KEY, MAX_BYTES } from "@/lib/connections/fathom-hook";
import { crmWriter, findHookConnection, pgDeliveryStore, pgIngestStore } from "@/lib/connections/ingest-store";
import { wantedForPerson } from "@/lib/connections/wanted";

// Fathom posts here when a recording's summary is ready. The address is the one SubSync registered with
// Fathom itself when the person signed in, and it belongs to ONE person. Every request must carry a valid
// signature made with the secret Fathom gave us, and requests older than five minutes are refused.
// A delivery to a person's own address is handled by src/lib/connections/fathom-hook.ts (signature, delivery id claimed once, stored for that person,
// the note written as them through the dry-run client). Only the older shared connection (made before connections became personal) still takes the
// path below, which saves a summary inside SubSync for a person to review and never writes to the CRM itself.
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const legacy = (await featureOn("connections")) && KEY.test(key) ? await findFathomByKey(key).catch(() => null) : null;
  if (!legacy) {
    const text = await request.text();
    const h = request.headers;
    const answer = await handleFathomDelivery(
      { key, headers: { id: h.get("webhook-id"), timestamp: h.get("webhook-timestamp"), signature: h.get("webhook-signature") }, body: text },
      {
        enabled: () => featureOn("connections"), find: (k) => findHookConnection(k), store: pgIngestStore(), deliveries: pgDeliveryStore(),
        write: (c) => crmWriter(c.person.companyKey),
        wantTranscript: async (c) => (await wantedForPerson(c.installationId, c.person)).transcript,
        logError: (code, error) => console.error("Saving a Fathom meeting failed", code, safeError(error)),
      },
    );
    return NextResponse.json(answer.body, { status: answer.status });
  }

  const secret = legacy.webhookSecretEnc ? decryptSecret(legacy.webhookSecretEnc) : null;
  // The same answer for a wrong address and a disconnected one.
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "That is too large" }, { status: 413 });
  const h = request.headers;
  const signed = verifyFathom({ secret, id: h.get("webhook-id"), timestamp: h.get("webhook-timestamp"), signature: h.get("webhook-signature"), body: text });
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
    const result = await ingestMeeting(legacy, meeting, externalId);
    return NextResponse.json({ ok: true, saved: result.saved, reason: result.reason ?? null });
  } catch (error) {
    console.error("Saving a Fathom meeting failed", safeError(error));
    return NextResponse.json({ error: "Could not save that. Try again." }, { status: 500 });
  }
}
