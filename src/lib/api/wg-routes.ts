import { account, forgetWg, getSettings, list, savePrefs, saveRule, setWatching, summary, wgCache, type Links } from "../analytics/wg-queries";
import { usageFor } from "../analytics/wg-usage";
import { WG_BUCKETS, WG_FLAGS, WG_PARTS, type WgBucket, type WgPart } from "../analytics/wg-types";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { isLive } from "../live-flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";
import { ownedLocation } from "./tenant-guard";

// GET /api/app/wg?part=summary|list|account|settings|usage|options and POST /api/app/wg/act/<settings|rule|watch>. The wallet guard is for the agency's owners and admins only
// (`level` "all" from the verified session): a client's own session, a business, or agency staff limited to some accounts get an empty answer. Which accounts may be read comes from `allowed`.
// An account id in the address goes through ownedLocation and only NARROWS inside `allowed`; one that does not belong is answered like nothing there and never echoed.
// Nothing here writes to the CRM or messages anyone: the only writes are SubSync's own limits, pauses and who is alerted.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type WgHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };
const NOTE_OFF = "Alert emails are shown here but only sent once sending is switched on for your business.";
const NOTE_ON = "Alert emails are switched on for your business.";

export async function handleWg(ctx: Ctx, h: WgHelpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as WgPart | null;
  if (!part || !(WG_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowed, dl, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(WG_FLAGS.map((f) => [f, ent.features[f as Feature] === true]));
  if (!flags.wg_wallet) return json({ error: "The wallet guard is not switched on for your account yet." }, 404);
  const { level, selfId } = viewerOf(ctx);
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, level, flags, problem: null });
  // Owners and admins only: the balances are the agency's own money.
  if (level !== "all" || ctx.limitTo !== null) return wrap({ rows: [], total: 0, accounts: 0, counts: {}, top: [] });
  const scope = { inst: ctx.installationId, allowed };
  const links: Links = { account: (l) => dl.account(l) };
  const asked = sp.get("account");
  const one = asked ? await ownedLocation(ctx.installationId, allowed, asked) : null;
  if (asked && !one) return wrap({ rows: [], total: 0, accounts: 0, counts: {}, top: [] });
  const key = JSON.stringify([ctx.installationId, allowed, level, selfId, part, sp.toString()]);
  const hit = wgCache.get(key);
  if (hit) return wrap(hit, true);
  const done = (body: object) => { wgCache.set(key, body); return wrap(body); };

  switch (part) {
    case "summary": return done(await summary(scope, links));
    case "list": {
      const b = sp.get("bucket") ?? "all";
      if (!(WG_BUCKETS as readonly string[]).includes(b)) return json({ error: "Not found" }, 404);
      return done(await list(scope, links, { bucket: b as WgBucket, q: (sp.get("q") ?? "").slice(0, 60) || null, page: Math.max(0, int(sp.get("page"), 0)), size: int(sp.get("size"), 20) }));
    }
    case "account": {
      if (!one) return json({ error: "Not found" }, 404);
      const a = await account(scope, links, one);
      return a ? done(a) : json({ error: "Not found" }, 404);
    }
    case "usage": {
      if (!one) return json({ error: "Not found" }, 404);
      return done(await usageFor(ctx.installationId, one, Math.min(30, Math.max(1, int(sp.get("days"), 7)))));
    }
    case "settings": return done(await getSettings(scope, selfId, true, isLive("SEND_EMAIL_LIVE") ? NOTE_ON : NOTE_OFF));
    case "options": return done({ accounts: (await list(scope, links, { bucket: "all", q: null, page: 0, size: 100 })).rows.map((r) => ({ locationId: r.locationId, name: r.name })) });
  }
  return json({ error: "Not found" }, 404);
}

/** POST /api/app/wg/act/<name>: settings (limit, days left, alerts on), rule (one account's limit or pause), watch (alert me or stop). SubSync-only choices. */
export async function handleWgAct(ctx: Ctx, h: WgHelpers): Promise<Response> {
  const name = ctx.segments[2];
  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  const [allowed, ent] = await Promise.all([h.allowed(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  if (ent.features.wg_wallet !== true) return json({ error: "This is not switched on for your account" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const { level, selfId } = viewerOf(ctx);
  if (level !== "all" || ctx.limitTo !== null) return json({ error: "Ask the owner of your account to do this." }, 403);
  let b: Record<string, unknown> = {};
  try { const x = await ctx.request.json(); if (x && typeof x === "object") b = x as Record<string, unknown>; } catch { /* empty body */ }
  const actor = ctx.session.userName ?? ctx.session.userId ?? null;
  switch (name) {
    case "settings": {
      const r = await savePrefs(ctx.installationId, actor, b);
      return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
    }
    case "rule": {
      const loc = await ownedLocation(ctx.installationId, allowed, b.location);
      if (!loc) return json({ error: "Not found" }, 404);
      const r = await saveRule(ctx.installationId, actor, loc, b);
      return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
    }
    case "watch": {
      if (!selfId) return json({ error: "Please sign in again" }, 401);
      await setWatching(ctx.installationId, selfId, b.on !== false);
      forgetWg(ctx.installationId);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
}
