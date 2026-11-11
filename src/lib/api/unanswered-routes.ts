import { unansweredHome, unansweredList, unansweredRanks } from "../analytics/unanswered-v2-queries";
import { isBucket, SORTS } from "../analytics/unanswered-v2";
import { WAITING_WINDOW_DAYS } from "../analytics/waiting";
import { isUnansweredOutcome } from "../analytics/unanswered-advanced";
import { sql } from "../db";
import { loadHideSettings } from "../analytics/unanswered-actions-queries";
import type { HideSettings } from "../analytics/unanswered-actions";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The rebuilt Unanswered messages screen's endpoints: GET /api/app/inbox?part=home|list|ranks (the one catch-all route, already guarded). The older GET /api/app/inbox (no part)
// still answers the exports, the saved views and the older tests. Who is asking comes from the verified session (`ctx`); the accounts that caller may read come from `allowed`
// (derived by the router from the session, never from the request); an id in the address only NARROWS inside them. A client's staff get no ranking of people and cannot look at
// a colleague's customers by person id.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

export type UnansweredHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof deepLinks>>;
  /** The reply target in hours (Settings) and the default first-reply target in minutes, for the agreement with Today. */
  targets: () => Promise<{ slaHours: number; targetMinutes: number }>;
};

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const CHANNEL = /^[A-Za-z0-9 .&'-]{1,40}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };

/** Sets the white-label links on every person row: the conversation (Reply) and the contact (the lead panel, the call and email buttons). */
function withUrls<T>(value: T, h: ReturnType<typeof deepLinks>): T {
  if (Array.isArray(value)) return value.map((v) => withUrls(v, h)) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = withUrls(v, h);
    if (typeof o.locationId === "string" && typeof o.conversationId === "string") {
      out.url = h.conversation(o.locationId, o.conversationId);
      out.contactUrl = typeof o.contactId === "string" ? h.contact(o.locationId, o.contactId) : h.conversation(o.locationId, o.conversationId);
    }
    return out as T;
  }
  return value;
}

/** Only an account id that is well formed narrows a request, and the query still binds it to the caller's own accounts. */
function narrowed(allowed: string[] | null, id: string | null): string[] | null | "none" {
  if (!id) return allowed;
  if (!ID.test(id)) return "none";
  if (allowed && !allowed.includes(id)) return "none";
  return [id];
}

const emptyList = { total: 0, page: 0, pages: 1, from: 0, to: 0, rows: [], facets: { buckets: { all: 0, h1: 0, h4: 0, h24: 0, h48: 0 }, owner: { all: 0, none: 0, mine: 0 }, channels: [], visibleBuckets: [] }, truncated: false };

export async function handleUnansweredPart(ctx: Ctx, h: UnansweredHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const part = sp.get("part");
  const now = Date.now();
  const [allowedAll, targets, links] = await Promise.all([h.allowed(), h.targets(), h.links()]);
  const seePeople = ctx.kind !== "client";
  const meId = ctx.session.userId ?? null;
  // Round 3 (flags inbox_snooze / inbox_hide_noise): people set aside, marked not a lead, on your own team or automatic are left out. Off: everyone, and no new table is read.
  const hideOn = ctx.entitlements.features.inbox_hide_noise && !ctx.entitlements.locked.includes("inbox_hide_noise");
  const snoozeOn = ctx.entitlements.features.inbox_snooze && !ctx.entitlements.locked.includes("inbox_snooze");
  const hide: HideSettings | null = hideOn ? await loadHideSettings(ctx.installationId) : snoozeOn ? { notALead: false, internal: false, automatic: false } : null;
  const base = { installationId: ctx.installationId, slaHours: targets.slaHours, targetMinutes: targets.targetMinutes, now, seePeople, hide };

  if (part === "home") {
    const out = await unansweredHome({ ...base, allowed: allowedAll, meId });
    return json(withUrls({
      ...out,
      kind: ctx.kind,
      canRecordOutcome: ctx.entitlements.features.inbox_breach_alert && !ctx.entitlements.locked.includes("inbox_breach_alert"),
    }, links));
  }

  if (part === "list") {
    const bucketP = sp.get("bucket");
    if (bucketP !== null && bucketP !== "all" && !isBucket(bucketP)) return json({ error: "Unknown wait" }, 400);
    const sortP = sp.get("sort") ?? "wait";
    if (!(SORTS as readonly string[]).includes(sortP)) return json({ error: "Unknown sort" }, 400);
    const channelP = sp.get("channel");
    if (channelP !== null && channelP !== "" && !CHANNEL.test(channelP)) return json({ error: "Unknown channel" }, 400);
    const ownerP = sp.get("owner");
    if (ownerP !== null && ownerP !== "" && ownerP !== "me" && ownerP !== "none" && !ID.test(ownerP)) return json({ error: "Unknown owner" }, 400);
    const allowed = narrowed(allowedAll, sp.get("account"));
    if (allowed === "none") return json(withUrls(emptyList, links));
    const out = await unansweredList({
      ...base, allowed, meId, bucket: bucketP, channel: channelP, owner: ownerP, account: null, q: (sp.get("q") ?? "").slice(0, 80), sort: sortP, page: int(sp.get("page"), 0), size: int(sp.get("size"), 25),
    });
    return json(withUrls(out, links));
  }

  if (part === "ranks") {
    const by = sp.get("by") === "owner" ? "owner" : "account";
    const out = await unansweredRanks({ ...base, allowed: allowedAll, by, q: (sp.get("q") ?? "").slice(0, 80), page: int(sp.get("page"), 0), size: int(sp.get("size"), 25) });
    return json(out);
  }

  return json({ error: "Unknown part of this screen" }, 400);
}

export async function handleUnansweredOutcome(ctx: Ctx, h: Pick<UnansweredHelpers, "allowed">): Promise<Response> {
  const body = await ctx.request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.locationId !== "string" || !ID.test(body.locationId) || typeof body.conversationId !== "string" || !ID.test(body.conversationId) || !isUnansweredOutcome(body.outcome)) {
    return json({ error: "Choose a conversation and a listed outcome" }, 400);
  }
  const allowed = narrowed(await h.allowed(), body.locationId);
  if (allowed === "none" || !allowed?.length) return json({ error: "That conversation is not available in your account view" }, 404);
  const actor = ctx.session.userId;
  if (!actor) return json({ error: "Sign in again before recording an outcome" }, 401);
  const [conversation] = await sql()`
    select contact_id, assigned_to from cached_conversations
    where installation_id = ${ctx.installationId} and location_id = ${body.locationId}
      and conversation_id = ${body.conversationId} and last_message_direction = 'inbound'
      and last_message_at > now() - ${WAITING_WINDOW_DAYS}::int * interval '1 day'`;
  if (!conversation) return json({ error: "This conversation is no longer waiting; refresh the list" }, 409);
  if (ctx.kind === "client" && ctx.session.role !== "admin" && conversation.assigned_to !== actor) {
    return json({ error: "You can only record an outcome for a conversation assigned to you" }, 403);
  }
  await sql()`
    insert into unanswered_outcomes (installation_id, location_id, conversation_id, contact_id, outcome, recorded_by)
    values (${ctx.installationId}, ${body.locationId}, ${body.conversationId}, ${conversation.contact_id ?? null}, ${body.outcome}, ${actor})`;
  return json({ ok: true, outcome: body.outcome });
}
