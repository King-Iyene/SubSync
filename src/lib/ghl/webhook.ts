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
  | { kind: "resync"; scope: "contacts" | "opportunities" | "conversations" | "structure" }
  | { kind: "ignore" };

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
      return { kind: "resync", scope: "conversations" };
    case "LocationUpdate":
    case "AppointmentCreate":
      return { kind: "resync", scope: "structure" };
    default:
      return { kind: "ignore" };
  }
}
