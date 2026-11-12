import { briefSlack, briefText, SECTION_LABEL, SECTIONS } from "../analytics/br-core";
import { briefFor, getPrefs, history, recordActed, recordSeen, savePrefs, sendTest, forgetBrief, type BriefFlags } from "../analytics/br-queries";
import { localDay, validZone } from "../analytics/cash-intel";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { isLive } from "../live-flags";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";

// GET /api/app/br?part=brief|text|settings|history and POST /api/app/br/act/<settings|test|seen|acted>. The 7 am brief is for the agency's owners and admins (`level` "all" from the verified
// session). Every person's choices and history are keyed by the verified user id from the session, never by anything the browser sends. Nothing here changes the CRM or messages a lead;
// the email goes through the one outward gate (dry run until the live switch is on), and only to the address the person saved for themselves.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
const PARTS = ["brief", "text", "settings", "history"] as const;
const BR_FLAGS = ["br_brief", "br_email", "br_record"] as const;
const NOTE_OFF = "The email is shown here as a dry run: it is only sent once sending is switched on for your business.";
const NOTE_ON = "The email is switched on for your business.";

export async function handleBr(ctx: Ctx): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part");
  const isAct = ctx.segments[1] === "act";
  if (!isAct && (!part || !(PARTS as readonly string[]).includes(part))) return json({ error: "Not found" }, 404);
  const ent = await resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo);
  const on = (f: string) => ent.features[f as Feature] === true;
  const flags = Object.fromEntries(BR_FLAGS.map((f) => [f, on(f)]));
  if (!flags.br_brief) return json({ error: "The brief is not switched on for your account yet." }, 404);
  const { level } = viewerOf(ctx), user = ctx.session.userId ?? null;
  const wrap = (body: object) => json({ ...body, generatedAt: new Date().toISOString(), level, flags, problem: null });
  if (level !== "all" || ctx.limitTo !== null) return isAct ? json({ error: "Ask the owner of your account to do this." }, 403) : wrap({ brief: null });
  if (!user) return json({ error: "Please sign in again" }, 401);
  const f: BriefFlags = { cf_save: on("cf_save"), cf_recover: on("cf_recover"), cf_deals: on("cf_deals"), wg_wallet: on("wg_wallet"), pm_module: on("pm_module"), td_today: on("td_today"), fn_today: on("fn_today") };
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

  if (isAct) return act(ctx, ctx.segments[2], user, f, on("br_email"), on("br_record"));

  const prefs = await getPrefs(ctx.installationId, user);
  switch (part) {
    case "brief": {
      const b = await briefFor(ctx.installationId, prefs, f);
      return wrap({ brief: b, labels: SECTION_LABEL, sections: prefs.sections });
    }
    case "text": {
      const b = await briefFor(ctx.installationId, prefs, f);
      return wrap({ text: briefText(b, base), slack: briefSlack(b, base) });
    }
    case "settings": {
      return wrap({ prefs: { ...prefs, lastSentKey: undefined }, labels: SECTION_LABEL, allSections: SECTIONS, emailAvailable: on("br_email"), sendingNote: isLive("SEND_EMAIL_LIVE") ? NOTE_ON : NOTE_OFF });
    }
    case "history": return wrap({ rows: on("br_record") ? await history(ctx.installationId, user) : [] });
  }
  return json({ error: "Not found" }, 404);
}

async function act(ctx: Ctx, name: string, user: string, f: BriefFlags, emailOn: boolean, recordOn: boolean): Promise<Response> {
  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  let b: Record<string, unknown> = {};
  try { const x = await ctx.request.json(); if (x && typeof x === "object") b = x as Record<string, unknown>; } catch { /* empty body */ }
  switch (name) {
    case "settings": {
      if (b.emailOn === true && !emailOn) return json({ error: "The brief by email is not switched on for your account yet." }, 404);
      const r = await savePrefs(ctx.installationId, user, b);
      if (!r.ok) return json({ error: r.error }, 400);
      forgetBrief(ctx.installationId);
      return json({ ok: true });
    }
    case "test": {
      if (!emailOn) return json({ error: "The brief by email is not switched on for your account yet." }, 404);
      const r = await sendTest(ctx.installationId, user, f);
      return r.ok ? json({ ok: true, dryRun: r.dryRun, to: r.to, subject: r.subject, text: r.text }) : json({ error: r.error }, r.status);
    }
    case "seen": {
      if (!recordOn) return json({ ok: true, recorded: false });
      const p = await getPrefs(ctx.installationId, user), day = localDay(Date.now(), validZone(p.timezone));
      await recordSeen(ctx.installationId, user, day, await briefFor(ctx.installationId, p, f));
      return json({ ok: true, recorded: true });
    }
    case "acted": {
      if (!recordOn) return json({ ok: true, recorded: false });
      const p = await getPrefs(ctx.installationId, user), day = localDay(Date.now(), validZone(p.timezone));
      const ok = await recordActed(ctx.installationId, user, day, String(b.key ?? ""));
      return ok ? json({ ok: true, recorded: true }) : json({ error: "Not found" }, 404);
    }
  }
  return json({ error: "Not found" }, 404);
}

