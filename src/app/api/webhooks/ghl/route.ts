import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { sql } from "@/lib/db";
import { canonicalType, isForeignApp, parseWebhook, verifyWebhook } from "@/lib/ghl/webhook";
import { handleWebhook, isQueuedType, liftDuplicateMark } from "@/lib/ghl/webhook-process";
import { featureOn } from "@/lib/flags";

// Receives platform webhooks. Verify the Ed25519 signature on the body, then:
//  - the high-volume events (contacts, deals, notes, conversations, messages, appointments) are written to the webhook_inbox table with ONE statement and answered at once; the
//    inbox worker (src/lib/ghl/webhook-inbox.ts, run by cron) handles them with the same code as before. A bulk import or bulk delete can send tens of thousands in hours.
//    If that one statement fails the answer is a 5xx, so the platform retries: an event is never dropped.
//  - install, uninstall, plan changes and everything else are handled here, as before (also every event when the webhook_inbox switch is off).
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyWebhook(raw, request.headers.get("x-ghl-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    event = parseWebhook(parsed);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // A signed event meant for a different app must not purge or resync one of our installs.
  if (isForeignApp(parsed, process.env.GHL_APP_ID)) return NextResponse.json({ ok: true, ignored: true });

  // The burst path. An event with no id cannot be de-duplicated, so it takes the old path.
  if (event.webhookId && isQueuedType(canonicalType(event.type)) && (await featureOn("webhook_inbox").catch(() => true))) {
    try {
      await sql()`
        insert into webhook_inbox (webhook_id, event_type, body) values (${event.webhookId}, ${event.type}, ${sql().json(parsed as never)})
        on conflict (webhook_id) do nothing`;
      return NextResponse.json({ ok: true, queued: true });
    } catch (error) {
      console.error("Webhook not queued", { type: event.type, message: safeError(error) });
      return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
    }
  }

  try {
    if (event.webhookId) {
      const fresh = await sql()`
        insert into webhook_events (webhook_id, event_type) values (${event.webhookId}, ${event.type})
        on conflict (webhook_id) do nothing returning webhook_id`;
      if (fresh.length === 0) return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json(await handleWebhook(event, parsed));
  } catch (error) {
    // A non-2xx makes the platform retry, which is what we want for transient failures. The duplicate mark is lifted first: otherwise the retry would be
    // dropped as "already seen" and the event lost for good.
    await liftDuplicateMark(event.webhookId);
    console.error("Webhook handling failed", { type: event.type, message: safeError(error) });
    return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
  }
}
