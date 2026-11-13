import { NextResponse } from "next/server";
import { safeError } from "@/lib/safe-log";
import { businessKey } from "@/lib/access";
import { sql } from "@/lib/db";
import { getInstallation, purgeInstallation, purgeLocationData } from "@/lib/ghl/installations";
import { actionFor, canonicalType, isForeignApp, parseWebhook, verifyWebhook } from "@/lib/ghl/webhook";
import { recordPlanEvent } from "@/lib/entitlements-queries";
import { captureWhitelabelDomain, captureWhitelabelLogo } from "@/lib/analytics/queries";
import { enqueueAreaSync, enqueueFullSync, locationAccessToken, runSlice } from "@/lib/sync/engine";
import { markDataChanged } from "@/lib/sync/data-version";
import { applyLiveWebhook } from "@/lib/live/webhook-apply";
import { isEchoOfOurWrite } from "@/lib/connections/write-log";
import { eventFromWebhook, leadEventFromWebhook } from "@/lib/analytics/touch-events";
import { recordLeadEvents, recordTouchEvents } from "@/lib/analytics/touch-events-db";
import { onContactCreated } from "@/lib/ghl/arrival";

/** The company that holds this client account, when the event did not name one. */
async function companyOfLocation(locationId: string): Promise<string | null> {
  const [r] = await sql()`
    select i.company_id from locations l join installations i on i.id = l.installation_id
    where l.location_id = ${locationId} and i.uninstalled_at is null and not i.is_demo and i.mode <> 'business' limit 1`;
  return (r?.company_id as string | undefined) ?? null;
}
/** What became of an event, for the support view (webhook_events.outcome, added by migration 20261230090000; never stops the handler if it is not there yet). */
async function markOutcome(webhookId: string | null, outcome: string): Promise<void> {
  if (!webhookId) return;
  await sql()`update webhook_events set outcome = ${outcome.slice(0, 120)}, handled_at = now() where webhook_id = ${webhookId}`.catch(() => undefined);
}
async function liftDuplicateMark(webhookId: string | null): Promise<void> {
  if (!webhookId) return;
  await sql()`delete from webhook_events where webhook_id = ${webhookId}`.catch(() => undefined);
}

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

  // A signed event meant for a different app must not purge or resync one of our installs.
  if (isForeignApp(parsed, process.env.GHL_APP_ID)) return NextResponse.json({ ok: true, ignored: true });

  try {
    if (event.webhookId) {
      const fresh = await sql()`
        insert into webhook_events (webhook_id, event_type) values (${event.webhookId}, ${event.type})
        on conflict (webhook_id) do nothing returning webhook_id`;
      if (fresh.length === 0) return NextResponse.json({ ok: true, duplicate: true });
    }

    // The live deliveries call install and uninstall INSTALL and UNINSTALL; the rest of this handler knows the documented names.
    event = { ...event, type: canonicalType(event.type) };
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
      if (event.type === "AppInstall" && event.whitelabelLogoUrl && target) {
        await captureWhitelabelLogo(target.id, event.whitelabelLogoUrl).catch((e) => console.error("Keeping the logo failed", safeError(e)));
      }
      if (event.type === "PlanChange") return NextResponse.json({ ok: true });
    }
    if (action.kind === "ignore") return NextResponse.json({ ok: true });

    // A client account that installed the app for itself has its own install, keyed by its location.
    const own = event.locationId ? await getInstallation(businessKey(event.locationId)) : null;
    // Contact, message and appointment events name the account (locationId) but often NOT the company: the company then comes from the accounts we hold. Dropping those
    // events (the old behaviour) meant a person added in the CRM never reached SubSync until the next full read.
    const companyId = event.companyId ?? (event.locationId ? await companyOfLocation(event.locationId) : null);
    if (!companyId && !own) { await markOutcome(event.webhookId, "ignored: no company or account found"); return NextResponse.json({ ok: true }); }
    const installation = companyId ? await getInstallation(companyId) : null;
    // The platform tells us about the notes and comments SubSync itself wrote. Those echoes are dropped (INTEGRATIONS_SPEC section 10): no loop, no recount.
    if (event.type === "OutboundMessage" || event.type === "NoteCreate") {
      for (const target of [own, installation]) {
        if (target && (await isEchoOfOurWrite(target.id, parsed))) return NextResponse.json({ ok: true, echo: true });
      }
    }
    if (action.kind === "uninstall") {
      // A client account that installed for itself and removed the app: drop its own install.
      if (own) await purgeInstallation(own.companyId);
      // A single client account removing the app deletes just its data from the agency's install;
      // the agency removing it deletes everything and the tokens.
      if (event.locationId && installation) await purgeLocationData(installation.id, event.locationId);
      else if (!own && event.companyId) await purgeInstallation(event.companyId);
    } else {
      // The account may be covered by its own install, the agency's, or both.
      for (const target of [own, installation]) {
        if (!target) continue;
        // Contacts, deals, appointments and conversations are updated in the copy right now (about a second); the area re-read is only queued when that was not enough.
        const applied = action.kind === "resync" && event.locationId
          ? await applyLiveWebhook({ installationId: target.id, locationId: event.locationId, type: event.type, body: parsed }, { token: (loc) => locationAccessToken(target.companyId, loc) })
          : { skipResync: false };
        if (action.kind === "install") {
          await enqueueFullSync(target.id);
          // Workflow setup runs only when this account switched automatic setup on; it never stops an install.
          if (event.locationId) await (await import("@/lib/workflows-setup/run")).autoSetupOnInstall(target.id, target.companyId, event.locationId);
        }
        else if (action.kind === "resync" && event.locationId && !applied.skipResync) {
          await enqueueAreaSync(target.id, event.locationId, action.scope);
          // A new appointment (or anything the live copy could not apply) is read right now, for this account only and for a few seconds, instead of waiting for the next scheduled run.
          if (action.scope === "appointments" || action.scope === "contacts" || action.scope === "opportunities") {
            await runSlice(5_000, { installationId: target.id, locationId: event.locationId, focusLocationId: event.locationId, concurrency: 2 }).catch((e) => console.error("quick read after an event failed", e instanceof Error ? e.message : "error"));
          }
        }
        // Tell every open screen of this account that something changed (they re-read their own data quietly).
        if (action.kind === "resync" && event.locationId) await markDataChanged(target.id, event.locationId, "live").catch(() => undefined);
        // A new contact: compare it with the account's contacts right now (bounded to a couple of seconds, never throws).
        // A message or call, a new contact, an owner change: keep its metadata (never the text) for the speed screens. A retry writes nothing new.
        if ((event.type === "InboundMessage" || event.type === "OutboundMessage") && event.locationId) {
          const te = eventFromWebhook(parsed, event.type);
          if (te) await recordTouchEvents(target.id, [te]);
        }
        const le = leadEventFromWebhook(parsed, event.type);
        if (le) await recordLeadEvents(target.id, [le]);
        if (event.type === "ContactCreate" && event.locationId) await onContactCreated(target.id, target.companyId, event.locationId, parsed);
      }
    }
    await markOutcome(event.webhookId, "handled");
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A non-2xx makes the platform retry, which is what we want for transient failures. The duplicate mark is lifted first: otherwise the retry would be
    // dropped as "already seen" and the event lost for good.
    await liftDuplicateMark(event.webhookId);
    console.error("Webhook handling failed", { type: event.type, message: safeError(error) });
    return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
  }
}
