import { createPublicKey, verify } from "node:crypto";
import { validDomain } from "../links.ts";

// GHL signs webhooks with Ed25519 in the X-GHL-Signature header. The key below is the public
// key published in the official webhook guide. The legacy X-WH-Signature (RSA) header was
// deprecated on 2026-09-01 and is intentionally not supported.
export const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

function check(payload: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return verify(null, Buffer.from(payload, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Verify a webhook. The official example signs `JSON.stringify(body)`, while some senders sign
 * the exact bytes, so we accept either the raw body or its re-serialised form.
 */
export function verifyWebhook(
  rawBody: string,
  signatureBase64: string | null,
  publicKeyPem: string = GHL_WEBHOOK_PUBLIC_KEY,
): boolean {
  if (!signatureBase64 || signatureBase64 === "N/A") return false;
  if (check(rawBody, signatureBase64, publicKeyPem)) return true;
  try {
    return check(JSON.stringify(JSON.parse(rawBody)), signatureBase64, publicKeyPem);
  } catch {
    return false;
  }
}

export type WebhookEvent = {
  type: string | null;
  webhookId: string | null;
  companyId: string | null;
  locationId: string | null;
  /** The company's own login domain when it resells the platform under its brand (install events carry it). Only a plain host name. */
  whitelabelDomain: string | null;
};

// Payloads put ids at the top level; some event types nest fields under `data`.
export function parseWebhook(body: unknown): WebhookEvent {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const str = (...values: unknown[]) => {
    for (const v of values) if (typeof v === "string" && v) return v;
    return null;
  };
  return {
    type: str(root.type, root.event),
    webhookId: str(root.webhookId, root.id),
    companyId: str(root.companyId, data.companyId),
    locationId: str(root.locationId, data.locationId),
    whitelabelDomain: whitelabelOf(root) ?? whitelabelOf(data),
  };
}

function whitelabelOf(source: Record<string, unknown>): string | null {
  const details = source.whitelabelDetails;
  return details && typeof details === "object" ? validDomain((details as Record<string, unknown>).domain) : null;
}

export type WebhookAction =
  | { kind: "uninstall" }
  | { kind: "install" }
  | { kind: "resync"; scope: "contacts" | "opportunities" | "conversations" | "structure" | "appointments" }
  | { kind: "ignore" };

// The platform's app events are named AppInstall and AppUninstall in its documentation and its event list, but the `type` the live deliveries
// carry is INSTALL, UNINSTALL (and UPDATE for an app version update). The live webhook log showed INSTALL and UNINSTALL arriving while the code
// only knew the long names, so those events were silently ignored. Both spellings mean the same thing.
export function canonicalType(type: string | null): string | null {
  switch (type) {
    case "INSTALL": return "AppInstall";
    case "UNINSTALL": return "AppUninstall";
    default: return type;
  }
}

// What each event should do to our cache. Names confirmed from the published API specs.
export function actionFor(type: string | null): WebhookAction {
  switch (type) {
    case "AppUninstall":
      return { kind: "uninstall" };
    case "AppInstall":
      return { kind: "install" };
    case "ContactCreate":
    case "ContactUpdate":
    case "ContactDelete":
    case "ContactTagUpdate":
      return { kind: "resync", scope: "contacts" };
    case "OpportunityCreate":
    case "OpportunityUpdate":
    case "OpportunityDelete":
    case "OpportunityStageUpdate":
    case "OpportunityStatusUpdate":
    case "OpportunityAssignedToUpdate":
    case "OpportunityMonetaryValueUpdate":
      return { kind: "resync", scope: "opportunities" };
    case "InboundMessage":
    case "OutboundMessage":
    case "ConversationUnreadWebhook":
    case "ConversationUpdate":
      return { kind: "resync", scope: "conversations" };
    case "ContactDndUpdate":
      return { kind: "resync", scope: "contacts" };
    case "AppointmentCreate":
    case "AppointmentUpdate":
    case "AppointmentDelete":
      return { kind: "resync", scope: "appointments" };
    case "LocationUpdate":
      return { kind: "resync", scope: "structure" };
    default:
      return { kind: "ignore" };
  }
}

// The signing key is the platform's own, shared by every app, so a valid signature proves the platform sent the event, not that it was
// meant for this app. A developer of another app can receive a signed event for a company that also uses it and replay it here. When the
// event names an app (install, uninstall and plan events do) and it is not ours, it must be ignored. Events that carry no app id are
// accepted as before. `ownAppId` is GHL_APP_ID; when it is not set the check is skipped.
export function isForeignApp(body: unknown, ownAppId: string | undefined | null): boolean {
  if (!ownAppId || !body || typeof body !== "object") return false;
  const root = body as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const given = typeof root.appId === "string" && root.appId ? root.appId : typeof data.appId === "string" && data.appId ? data.appId : null;
  return given !== null && given !== ownAppId;
}
