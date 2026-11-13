import { atOf } from "../analytics/window-time";
import { exportProof, getSettings, listRows, markOpened, numbers, options, proof, saveSettings, snooze, today, todayCache, unsnooze, zoneForMeta, forgetToday, type Scope } from "../analytics/today3-queries";
import { isMoneyList, moneyHero, moneyRows } from "../analytics/today3-money";
import { accountsIn } from "../analytics/clients3-queries";
import { cashReceiptLines } from "../analytics/cash-intel";
import { receiptCash } from "../analytics/cash-queries";
import { TD3_FLAGS, TD3_KINDS, TD3_PARTS, TD3_LIST_ONLY, type Td3ListKind, type Td3Part } from "../analytics/today3-types";
import { clampSize, parseWindow } from "../analytics/clients3-intel";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";
import { ownedLocation } from "./tenant-guard";

// GET /api/app/today3?part=today|list|proof|numbers|settings|export|options. Read only. Who is asking comes from the verified session: `level` (agency owner or admin: all; an account
// administrator: their account; anyone else: only their own queue and account) and `allowed` (decided by the router from the session). Every account id in the address goes through
// ownedLocation and only NARROWS inside `allowed`; one that does not belong is answered like nothing there and never echoed. Free-text parameters are fixed lists (kind, week) or numbers.
// POST /api/app/today3/act/snooze|unsnooze|opened|settings: SubSync's own notes only (nothing is written to the CRM and nothing is sent to a lead).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Today3Helpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const PART_FLAG: Record<Td3Part, string[]> = {
  today: ["td_today"], list: ["td_today", "td_numbers"], proof: ["td_proof"], numbers: ["td_numbers"], money: ["td_today"], settings: ["td_module"], export: ["td_proof"], options: ["td_module", "td_today", "td_numbers", "td_proof"],
};
const KINDS = new Set<string>([...TD3_KINDS, ...TD3_LIST_ONLY]);
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };
const WEEK = /^\d{4}-\d{2}-\d{2}$/;

export async function handleToday3(ctx: Ctx, h: Today3Helpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as Td3Part | null;
  if (!part || !(TD3_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowed, dl, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(TD3_FLAGS.map((f) => [f, ent.features[f as Feature] === true]));
  if (!PART_FLAG[part].some((f) => flags[f])) return json({ error: "This part of Today is not switched on yet." }, 404);

  const { level, selfId } = viewerOf(ctx);
  const scope: Scope = { inst: ctx.installationId, allowed, level, selfId };
  const wrap = (body: object, cached = false, problem: string | null = null, timezone = "UTC") => json({ ...body, generatedAt: new Date().toISOString(), cached, canSee: true, level, flags, problem, timezone });
  const nothing = (extra: object = {}) => wrap({ rows: [], total: 0, page: 0, size: 20, pages: 1, truncated: false, tiles: [], items: [], accounts: [], ...extra });

  const asked = sp.get("location");
  const one = asked ? await ownedLocation(ctx.installationId, allowed, asked) : null;
  if (asked && !one) return nothing();
  const links = { account: (l: string) => dl.account(l), contact: (l: string, c: string) => dl.contact(l, c) };
  const key = JSON.stringify([ctx.installationId, allowed, level, selfId, part, sp.toString()]);
  const hit = todayCache.get(key);
  if (hit && part !== "export") return wrap(hit, true, null, (hit as { timezone?: string }).timezone ?? "UTC");
  const done = (body: object) => { todayCache.set(key, body); return wrap(body, false, null, (body as { timezone?: string }).timezone ?? "UTC"); };
  const now = Date.now();
  const page = Math.max(0, int(sp.get("page"), 0)), size = clampSize(int(sp.get("size"), 20));

  switch (part) {
    case "today": return done(await today(scope, one, now));
    case "list": {
      const kind = sp.get("kind");
      if (!kind || !KINDS.has(kind)) return json({ error: "Not found" }, 404);
      if (isMoneyList(kind)) return done(await moneyRows(scope, one, kind as Td3ListKind, { page, size }, links, now));
      return done(await listRows(scope, one, kind as Td3ListKind, { page, size }, links, now));
    }
    case "money": return done(await moneyHero(scope, one, now));
    case "proof": {
      const p = await proof(scope, one, WEEK.test(sp.get("week") ?? "") ? sp.get("week") : null, { page, size }, now);
      // The cash features add their proof lines to the same weekly receipt: missed leads followed up and flagged deals that moved (estimates are labelled; a line with nothing behind it is left out).
      if (ent.features.cf_recover === true || ent.features.cf_deals === true) {
        const lines = cashReceiptLines(await receiptCash(scope, one, new Date(`${p.weekStart}T00:00:00Z`)).catch(() => ({ recovered: 0, recoveredValue: null, moved: 0, movedValue: null, lostNoReason: 0 })));
        if (lines.length) return done({ ...p, lines: [...p.lines, ...lines] });
      }
      return done(p);
    }
    case "numbers": {
      // The date bar's dates (from and to) are read first, and checked here (never trusted); without them the old days choice still works.
      if (sp.get("from") && sp.get("to")) { const w = parseWindow(sp.get("from"), sp.get("to"), now, atOf(sp)); return done(await numbers(scope, one, { from: w.from, to: w.to }, now)); }
      const d = int(sp.get("days"), 30); return done(await numbers(scope, one, d <= 7 ? 7 : d <= 30 ? 30 : 90, now));
    }
    case "settings": {
      const accts = await accountsIn({ inst: scope.inst, allowed }, {});
      return done(await getSettings(scope.inst, accts.map((a) => a.id), level !== "self"));
    }
    case "options": return done(await options(scope));
    case "export": {
      const csv = await exportProof(scope, one, WEEK.test(sp.get("week") ?? "") ? sp.get("week") : null, now);
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="proof.csv"', "cache-control": "no-store" } });
    }
  }
  void zoneForMeta;
  return json({ error: "Not found" }, 404);
}

/** POST /api/app/today3/act/<name>. Admin-only notes (snooze, settings) refuse a team member; "opened" is a plain tap counter for anyone. */
export async function handleToday3Act(ctx: Ctx, h: Today3Helpers): Promise<Response> {
  const name = ctx.segments[2];
  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  const [allowed, ent] = await Promise.all([h.allowed(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const on = (f: string) => ent.features[f as Feature] === true;
  if (!on("td_module") && !on("td_today")) return json({ error: "This is not switched on for your account" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const { level } = viewerOf(ctx);
  let body: Record<string, unknown> = {};
  try { body = (await ctx.request.json()) as Record<string, unknown>; } catch { body = {}; }
  const actor = ctx.session.userName ?? ctx.session.userId ?? null;
  const loc = typeof body.location === "string" && body.location ? await ownedLocation(ctx.installationId, allowed, body.location) : null;
  if (typeof body.location === "string" && body.location && !loc) return json({ error: "That is not available" }, 404);
  switch (name) {
    case "opened": { await markOpened(ctx.installationId, loc, String(body.kind ?? "")); return json({ ok: true }); }
    case "snooze": {
      if (level === "self") return json({ error: "Ask your administrator to do this." }, 403);
      const kind = String(body.kind ?? "");
      if (!(TD3_KINDS as readonly string[]).includes(kind)) return json({ error: "Not found" }, 404);
      const r = await snooze(ctx.installationId, actor, kind, loc, Number(body.days ?? 1));
      return r ? json({ ok: true, id: r.id }) : json({ error: "Not found" }, 404);
    }
    case "unsnooze": {
      if (level === "self") return json({ error: "Ask your administrator to do this." }, 403);
      return (await unsnooze(ctx.installationId, String(body.id ?? ""))) ? json({ ok: true }) : json({ error: "Not found" }, 404);
    }
    case "settings": {
      if (level === "self") return json({ error: "Ask your administrator to do this." }, 403);
      if (!on("td_email") && body.emailOn === true) return json({ error: "The daily email is not switched on for your account yet." }, 404);
      const r = await saveSettings(ctx.installationId, actor, body);
      if (!r.ok) return json({ error: r.error }, 400);
      forgetToday(ctx.installationId);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
}
