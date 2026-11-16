import { safeError } from "../safe-log";
import { businessKey } from "../access";
import { sql } from "../db";
import { getInstallation, purgeInstallation, purgeLocationData } from "./installations";
import { actionFor, canonicalType, type WebhookEvent } from "./webhook";
import { recordPlanEvent } from "../entitlements-queries";
import { captureWhitelabelDomain, captureWhitelabelLogo } from "../analytics/queries";
import { enqueueAreaSync, enqueueFullSync, locationAccessToken, runSlice } from "../sync/engine";
import { markDataChanged } from "../sync/data-version";
import { applyLiveWebhook } from "../live/webhook-apply";
import { isEchoOfOurWrite } from "../connections/write-log";
import { eventFromWebhook, leadEventFromWebhook } from "../analytics/touch-events";
import { recordLeadEvents, recordTouchEvents } from "../analytics/touch-events-db";
import { onContactCreated } from "./arrival";

// The handling of ONE verified, de-duplicated platform event. The webhook route calls it in the request (install, uninstall, plan changes, and every event when the
// webhook_inbox flag is off); the inbox worker calls it for the high-volume events. One function, so both paths give identical results.

/** Events that arrive in bursts (a bulk import or bulk delete) and are queued instead of handled in the request. Install, uninstall and plan events never are. */
const QUEUED_TYPE = /^(Contact|Opportunity|Note|Appointment)/;
const QUEUED_EXACT = new Set(["ConversationUnreadUpdate", "ConversationUnreadWebhook", "ConversationUpdate", "InboundMessage", "OutboundMessage"]);
export function isQueuedType(type: string | null): boolean {
  if (!type) return false;
  return QUEUED_TYPE.test(type) || QUEUED_EXACT.has(type);
}

/** The company that holds this client account, when the event did not name one. */
export async function companyOfLocation(locationId: string): Promise<string | null> {
  const [r] = await sql()`
    select i.company_id from locations l join installations i on i.id = l.installation_id
    where l.location_id = ${locationId} and i.uninstalled_at is null and not i.is_demo and i.mode <> 'business' limit 1`;
  return (r?.company_id as string | undefined) ?? null;
}
/** What became of an event, for the support view (webhook_events.outcome, added by migration 20261230090000; never stops the handler if it is not there yet). */
export async function markOutcome(webhookId: string | null, outcome: string): Promise<void> {
  if (!webhookId) return;
  await sql()`update webhook_events set outcome = ${outcome.slice(0, 120)}, handled_at = now() where webhook_id = ${webhookId}`.catch(() => undefined);
}
export async function liftDuplicateMark(webhookId: string | null): Promise<void> {
  if (!webhookId) return;
  await sql()`delete from webhook_events where webhook_id = ${webhookId}`.catch(() => undefined);
}

export type WebhookResult = Record<string, unknown>;

/** Handle one event (the caller verified the signature, dropped duplicates and checked the app id). Throws on a transient failure so the caller can retry. */
export async function handleWebhook(inEvent: WebhookEvent, parsed: unknown): Promise<WebhookResult> {
  // The live deliveries call install and uninstall INSTALL and UNINSTALL; the rest of this handler knows the documented names.
  const event = { ...inEvent, type: canonicalType(inEvent.type) };
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
    if (event.type === "PlanChange") return { ok: true };
  }
  if (action.kind === "ignore") return { ok: true };

  // A client account that installed the app for itself has its own install, keyed by its location.
  const own = event.locationId ? await getInstallation(businessKey(event.locationId)) : null;
  // Contact, message and appointment events name the account (locationId) but often NOT the company: the company then comes from the accounts we hold. Dropping those
  // events (the old behaviour) meant a person added in the CRM never reached SubSync until the next full read.
  const companyId = event.companyId ?? (event.locationId ? await companyOfLocation(event.locationId) : null);
  if (!companyId && !own) { await markOutcome(event.webhookId, "ignored: no company or account found"); return { ok: true }; }
  const installation = companyId ? await getInstallation(companyId) : null;
  // The platform tells us about the notes and comments SubSync itself wrote. Those echoes are dropped (INTEGRATIONS_SPEC section 10): no loop, no recount.
  if (event.type === "OutboundMessage" || event.type === "NoteCreate") {
    for (const target of [own, installation]) {
      if (target && (await isEchoOfOurWrite(target.id, parsed))) return { ok: true, echo: true };
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
        if (event.locationId) await (await import("../workflows-setup/run")).autoSetupOnInstall(target.id, target.companyId, event.locationId);
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
      // A message or call, a new contact, an owner change: keep its metadata (never the text) for the speed screens. A retry writes nothing new.
      if ((event.type === "InboundMessage" || event.type === "OutboundMessage") && event.locationId) {
        const te = eventFromWebhook(parsed, event.type);
        if (te) await recordTouchEvents(target.id, [te]);
      }
      const le = leadEventFromWebhook(parsed, event.type);
      if (le) await recordLeadEvents(target.id, [le]);
      // A new contact: compare it with the account's contacts right now (bounded to a couple of seconds, never throws).
      if (event.type === "ContactCreate" && event.locationId) await onContactCreated(target.id, target.companyId, event.locationId, parsed);
    }
  }
  await markOutcome(event.webhookId, "handled");
  return { ok: true };
}
