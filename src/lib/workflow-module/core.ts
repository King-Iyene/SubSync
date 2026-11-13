import { createHash, timingSafeEqual } from "node:crypto";
import { verifyWebhook } from "../ghl/webhook.ts";
import { inQuiet } from "../notifications/timing.ts";

// Workflow module, pure rules (docs/features/WORKFLOW_MODULE.md). No database, no network, so the tests read every decision.
// Triggers: SubSync tells a customer's workflow that something needs attention. Actions: a customer's workflow asks SubSync to do one small, safe thing.

export const TRIGGERS = [
  { key: "subsync_lead_unanswered", name: "Lead unanswered", short: "A new lead has waited longer than your reply target with no human reply.", unit: "minutes", defaultThreshold: null as number | null },
  { key: "subsync_no_show", name: "No-show detected", short: "An appointment was marked as a no-show in the last day.", unit: null, defaultThreshold: null },
  { key: "subsync_deal_stuck", name: "Deal stuck in a stage", short: "An open deal has sat in one stage too long.", unit: "days", defaultThreshold: 14 },
  { key: "subsync_account_quiet", name: "Account went quiet", short: "No new leads arrived for several days.", unit: "days", defaultThreshold: 7 },
] as const;
export const ACTIONS = [
  { key: "subsync_add_to_call_queue", name: "Add to SubSync call queue", short: "Tags the contact with this account's call-queue tag so your call queue picks it up." },
  { key: "subsync_mark_outcome", name: "Mark appointment outcome", short: "Marks one past appointment as showed or no-show." },
] as const;
export type TriggerKey = (typeof TRIGGERS)[number]["key"];
export type ActionKey = (typeof ACTIONS)[number]["key"];
export type BlockKey = TriggerKey | ActionKey;
export const TRIGGER_KEYS: readonly string[] = TRIGGERS.map((t) => t.key);
export const ACTION_KEYS: readonly string[] = ACTIONS.map((a) => a.key);
export const BLOCK_KEYS: readonly string[] = [...TRIGGER_KEYS, ...ACTION_KEYS];
export const isTriggerKey = (k: unknown): k is TriggerKey => typeof k === "string" && TRIGGER_KEYS.includes(k);
export const isActionKey = (k: unknown): k is ActionKey => typeof k === "string" && ACTION_KEYS.includes(k);

/** Plain id check used everywhere an id arrives from outside. */
export const ID = /^[A-Za-z0-9_-]{4,64}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

// ---------------- verification ----------------
// VERIFIED (docs): the CRM sends the headers WE define in the portal; no platform signature header is documented for custom actions. So the portal sheet has King add one
// header, x-subsync-key, holding a long random secret (env WORKFLOW_MODULE_SECRET). If the CRM also sends X-GHL-Signature we check it too, and with
// WORKFLOW_MODULE_REQUIRE_SIGNATURE=true it becomes mandatory (CHECK in a test app whether the platform signs these calls).

export const KEY_HEADER = "x-subsync-key";
export type VerifyEnv = Record<string, string | undefined>;

const digest = (s: string) => createHash("sha256").update(s).digest();
export function secretMatches(given: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || secret.length < 24 || !given) return false;
  return timingSafeEqual(digest(given), digest(secret));
}

export type Verified = { ok: true } | { ok: false; status: 401 | 503; reason: string };
export function verifyCall(headers: { get(name: string): string | null }, rawBody: string, env: VerifyEnv): Verified {
  if (!env.WORKFLOW_MODULE_SECRET || env.WORKFLOW_MODULE_SECRET.length < 24) return { ok: false, status: 503, reason: "not_configured" };
  if (!secretMatches(headers.get(KEY_HEADER), env.WORKFLOW_MODULE_SECRET)) return { ok: false, status: 401, reason: "bad_key" };
  const sig = headers.get("x-ghl-signature");
  if (sig) { if (!verifyWebhook(rawBody, sig)) return { ok: false, status: 401, reason: "bad_signature" }; }
  else if (env.WORKFLOW_MODULE_REQUIRE_SIGNATURE === "true") return { ok: false, status: 401, reason: "no_signature" };
  return { ok: true };
}

// ---------------- the request the CRM sends (VERIFIED shape: data, extras, meta) ----------------
export type CallBody = { key: string | null; locationId: string | null; contactId: string | null; workflowId: string | null; data: Record<string, unknown>; callId: string | null };
export function parseCall(body: unknown): CallBody {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const extras = obj(o.extras), meta = obj(o.meta), data = obj(o.data);
  const id = (v: unknown) => (isId(v) ? v : null);
  return { key: typeof meta.key === "string" ? meta.key.slice(0, 80) : null, locationId: id(extras.locationId), contactId: id(extras.contactId), workflowId: id(extras.workflowId), data, callId: typeof extras.executionId === "string" ? extras.executionId.slice(0, 80) : null };
}

/** One call = one key. The CRM documents no execution id, so the key is the workflow, contact and the action's own inputs: a retried call hashes the same and does nothing twice. */
export function idempotencyKey(call: CallBody): string {
  const stable = JSON.stringify([call.key, call.locationId, call.workflowId, call.contactId, call.callId, Object.keys(call.data).sort().map((k) => [k, call.data[k]])]);
  return createHash("sha256").update(stable).digest("hex").slice(0, 40);
}

// ---------------- trigger subscription (the CRM tells us where to send) ----------------
export const TARGET_HOST = "services.leadconnectorhq.com";
export function safeTargetUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 400) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.hostname !== TARGET_HOST || u.username || u.password || u.port) return null;
    if (!/^\/workflows-marketplace\/triggers\/execute\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return null;
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}
export type Subscription = { triggerKey: TriggerKey; targetUrl: string; workflowId: string; triggerId: string; locationId: string; eventType: "CREATED" | "UPDATED" | "DELETED" };
export function parseSubscription(body: unknown): Subscription | null {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const td = (o.triggerData && typeof o.triggerData === "object" ? o.triggerData : {}) as Record<string, unknown>;
  const ex = (o.extras && typeof o.extras === "object" ? o.extras : {}) as Record<string, unknown>;
  const meta = (o.meta && typeof o.meta === "object" ? o.meta : {}) as Record<string, unknown>;
  const key = td.key ?? meta.key, url = safeTargetUrl(td.targetUrl), ev = td.eventType;
  if (!isTriggerKey(key) || !url || !isId(ex.locationId) || !(ev === "CREATED" || ev === "UPDATED" || ev === "DELETED")) return null;
  return { triggerKey: key, targetUrl: url, workflowId: isId(ex.workflowId) ? ex.workflowId : "", triggerId: isId(td.id) ? td.id : "", locationId: ex.locationId, eventType: ev };
}

// ---------------- what a trigger carries: plain fields and a link, nothing else ----------------
export type Subject = { contactId: string | null; name: string | null; phone: string | null; source: string | null; minutesWaiting: number | null; pipeline: string | null; stage: string | null; owner: string | null; episode: string; link: string };
const clip = (v: string | null, n: number) => (v ? v.replace(/[\r\n\t]+/g, " ").slice(0, n) : null);
export function triggerPayload(key: TriggerKey, s: Subject): Record<string, unknown> {
  return {
    trigger: key, contactId: s.contactId, name: clip(s.name, 120), phone: clip(s.phone, 40), source: clip(s.source, 80),
    minutesWaiting: s.minutesWaiting === null ? null : Math.max(0, Math.round(s.minutesWaiting)), pipeline: clip(s.pipeline, 120), stage: clip(s.stage, 120), owner: clip(s.owner, 120), link: s.link,
  };
}
export const PAYLOAD_FIELDS = ["trigger", "contactId", "name", "phone", "source", "minutesWaiting", "pipeline", "stage", "owner", "link"] as const;

/** One send per episode: the same lead, appointment, or deal-in-this-stage is never sent twice. */
export const dedupeKey = (key: TriggerKey, episode: string) => `${key}:${episode}`.slice(0, 160);

// ---------------- limits ----------------
export const RATE = { perHour: 30, perDay: 200, perRun: 20 } as const;
export function roomLeft(sentLastHour: number, sentLastDay: number, rate: { perHour: number; perDay: number; perRun: number } = RATE): number {
  return Math.max(0, Math.min(rate.perRun, rate.perHour - sentLastHour, rate.perDay - sentLastDay));
}
/** Quiet hours (default 21:00 to 07:00 local): nothing is sent; the item stays eligible for the next run. */
export function heldForQuiet(localHour: number | null, quietOn: boolean, start = 21, end = 7): boolean {
  return quietOn && localHour !== null && inQuiet(localHour, start, end);
}
export const clampThreshold = (v: unknown, key: TriggerKey): number | null => {
  const def = TRIGGERS.find((t) => t.key === key)?.defaultThreshold ?? null;
  if (v === null || v === undefined || v === "") return def;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : def;
};

// ---------------- action results: plain words ----------------
export type ActionResult = { ok: boolean; result: string; message: string };
export const RESULT_WORDS: Record<string, string> = {
  done: "Done.", dry_run: "Recorded. Changes to your CRM are switched off, so nothing was sent.", already: "Already done earlier, so nothing changed.",
  not_enabled: "This SubSync block is switched off for this account. Turn it on in SubSync, Settings, Integrations, Workflow blocks.",
  unknown_account: "This account is not set up in SubSync.", not_found: "SubSync could not find that contact or appointment in this account.",
  dnd: "This person asked not to be contacted, so SubSync left them alone.", protected: "This contact is protected (open deal, upcoming appointment or an active payment), so SubSync left them alone.",
  future: "That appointment has not happened yet.", bad_input: "Something needed is missing from the workflow step.", needs_permission: "Needs permission: reconnect SubSync and approve the write permission.",
  failed: "The CRM did not accept the change. Try again later.", off: "Workflow blocks are not available yet.", limit: "Too many calls too fast. Try again in a minute.",
};
export const answer = (result: string, ok: boolean): ActionResult => ({ ok, result, message: RESULT_WORDS[result] ?? RESULT_WORDS.failed! });

export const CALL_CAP_PER_MINUTE = 60;
