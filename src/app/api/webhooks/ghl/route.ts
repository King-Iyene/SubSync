import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { businessKey } from "@/lib/access";
import { sql } from "@/lib/db";
import { getInstallation, purgeInstallation, purgeLocationData } from "@/lib/ghl/installations";
import { actionFor, parseWebhook, verifyWebhook } from "@/lib/ghl/webhook";
import { recordPlanEvent } from "@/lib/entitlements-queries";
import { captureWhitelabelDomain } from "@/lib/analytics/queries";
import { enqueueAreaSync, enqueueFullSync } from "@/lib/sync/engine";

// Receives platform webhooks. Verify the Ed25519 signature on the body, drop duplicates (failed
// deliveries are retried up to 12 times), then queue work and return fast: heavy lifting
// happens in the sync worker, never here.
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

  try {
    if (event.webhookId) {
      const fresh = await sql()`
        insert into webhook_events (webhook_id, event_type) values (${event.webhookId}, ${event.type})
        on conflict (webhook_id) do nothing returning webhook_id`;
      if (fresh.length === 0) return NextResponse.json({ ok: true, duplicate: true });
    }

    const action = actionFor(event.type);
    // A plan change, or the plan an install starts on, is recorded for whichever install it belongs to.
    if ((event.type === "PlanChange" || event.type === "AppInstall") && event.companyId) {
      const target = (event.locationId ? await getInstallation(businessKey(event.locationId)) : null) ?? (await getInstallation(event.companyId));
      // Recording the plan must never stop an install from syncing (the table may not exist yet).
      if (target) await recordPlanEvent(target.id, parsed).catch((e) => console.error("Recording a plan failed", safeError(e)));
      // An install event from a company that resells the platform carries its own login domain: keep it, so "Open" links land on that domain
      // from the first screen (a domain typed in Settings still wins). Sign-in captures it too, so a missed event is made up at the first open.
      if (event.type === "AppInstall" && event.whitelabelDomain && target) {
        await captureWhitelabelDomain(target.id, event.whitelabelDomain, "install").catch((e) => console.error("Keeping the login domain failed", safeError(e)));
      }
      if (event.type === "PlanChange") return NextResponse.json({ ok: true });
    }
    if (action.kind === "ignore" || !event.companyId) return NextResponse.json({ ok: true });

    // A client account that installed the app for itself has its own install, keyed by its location.
    const own = event.locationId ? await getInstallation(businessKey(event.locationId)) : null;
    const installation = await getInstallation(event.companyId);
    if (action.kind === "uninstall") {
      // A client account that installed for itself and removed the app: drop its own install.
      if (own) await purgeInstallation(own.companyId);
      // A single client account removing the app deletes just its data from the agency's install;
      // the agency removing it deletes everything and the tokens.
      if (event.locationId && installation) await purgeLocationData(installation.id, event.locationId);
      else if (!own) await purgeInstallation(event.companyId);
    } else {
      // The account may be covered by its own install, the agency's, or both.
      for (const target of [own, installation]) {
        if (!target) continue;
        if (action.kind === "install") await enqueueFullSync(target.id);
        else if (action.kind === "resync" && event.locationId) await enqueueAreaSync(target.id, event.locationId, action.scope);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A non-2xx makes the platform retry, which is what we want for transient failures.
    console.error("Webhook handling failed", { type: event.type, message: safeError(error) });
    return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
  }
}
