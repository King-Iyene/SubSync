import { sql } from "../db";
import { apply, checkSetup, getSettings, preview, saveSettings, status } from "../dial/callqueue-run";
import { isListId } from "../dial/dial";
import { checkSetupNow, runSetup, saveSetupSettings, setupView } from "../workflows-setup/run";
import { BATCH_MAX, statusLine } from "../dial/callqueue";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The routes behind "Send to your CRM call queue" and Auto call queue, under /api/app/dial/cq-*. The browser only names an account and (for a manual send) a list or ticked leads; the people, the guards
// (do not disturb, calling hours, caps, 24-hour memory) and the account's own opt-in are decided here. A client's staff (kind "client") can only look. SubSync cannot start a call itself.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
type H = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };
const ID = /^[A-Za-z0-9_-]{3,128}$/;

async function account(ctx: Ctx, h: H, locationId: unknown): Promise<{ id: string; companyId: string } | null> {
  if (typeof locationId !== "string" || !ID.test(locationId)) return null;
  const allowed = await h.allowed();
  if (allowed && !allowed.includes(locationId)) return null;
  const [r] = await sql()`select i.company_id from locations l join installations i on i.id = l.installation_id where l.installation_id = ${ctx.installationId} and l.location_id = ${locationId} and not l.ignored`;
  return r ? { id: locationId, companyId: r.company_id as string } : null;
}

export async function handleCallQueue(ctx: Ctx, h: H): Promise<Response> {
  const what = ctx.segments[1];
  const m = ctx.request.method;
  const body = m === "GET" ? null : ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  const loc = body ? body.locationId : ctx.url.searchParams.get("locationId");
  const writer = ctx.kind !== "client";
  try {
    if (what === "cq-status" && m === "GET") {
      const allowed = await h.allowed();
      const rows = await sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``} order by name limit 300`;
      const st = await status(ctx.installationId, rows.map((r) => r.location_id as string));
      const now = Date.now();
      const links = await h.links();
      return json({
        ready: st.ready, queueLinks: Object.fromEntries(rows.map((r) => [r.location_id as string, links.manualActions(r.location_id as string)])), accounts: rows.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Account" })), canEdit: writer,
        status: st.accounts.map((a) => ({ ...a, line: statusLine({ ...a, live: true }, now) })),
      });
    }
    if (what?.startsWith("cq-wf") && ctx.demo) {
      // The demo never touches a real account: the setup answers as a dry run.
      if (what === "cq-wf" && m === "GET") return json({ ready: true, state: "none", workflowId: null, updateAvailable: false, lastError: null, live: false, tag: "call-now", folderDefault: "Lead Response Automations", settings: { folderName: "Lead Response Automations", autoSetup: false, assignMode: "round_robin", assignUserId: null } });
      return json({ state: "would_create", message: 'Would create folder "Lead Response Automations" and workflow "Call queue". Nothing was sent: this is the demo.', lines: [] });
    }
    const a = await account(ctx, h, loc);
    if (!a) return json({ error: "Client account not found." }, 404);
    if (what === "cq-setup" && m === "GET") { const s = await getSettings(ctx.installationId, a.id); return json({ ready: s.ready, settings: s.s, canEdit: writer }); }
    if (what === "cq-wf" && m === "GET") return json({ ...(await setupView(ctx.installationId, a.id)), canEdit: writer });
    if (!writer) return json({ error: "Ask your administrator to change the call queue." }, 403);
    if (what === "cq-setup" && m === "PUT") {
      const r = await saveSettings(ctx.installationId, a.id, body ?? {});
      return json(r, r.ok ? 200 : 400);
    }
    if (what === "cq-wf-settings" && m === "PUT") { const r = await saveSetupSettings(ctx.installationId, a.id, body ?? {}); return json(r, r.ok ? 200 : 400); }
    if (what === "cq-wf-setup" && m === "POST") {
      if (body?.confirm !== true) return json({ error: "Confirm first." }, 400);
      return json(await runSetup({ installationId: ctx.installationId, companyId: a.companyId, locationId: a.id, manual: true }));
    }
    if (what === "cq-wf-check" && m === "POST") return json(await checkSetupNow({ installationId: ctx.installationId, companyId: a.companyId, locationId: a.id }));
    if (what === "cq-check" && m === "POST") {
      const cur = await getSettings(ctx.installationId, a.id);
      const s = { ...cur.s, route: body?.route === "workflow" ? "workflow" as const : cur.s.route, workflowId: typeof body?.workflowId === "string" ? body.workflowId.trim() : cur.s.workflowId };
      return json(await checkSetup(ctx.installationId, a.companyId, a.id, s));
    }
    if (what === "cq-preview" && m === "POST") {
      const keys = Array.isArray(body?.keys) ? (body.keys as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 400) : undefined;
      const list = typeof body?.list === "string" && isListId(body.list) ? body.list : undefined;
      const p = await preview(ctx.installationId, a.id, { auto: body?.auto === true, lists: list ? [list] : undefined, keys, limit: BATCH_MAX }, Date.now(), ctx.demo);
      return json(p);
    }
    if (what === "cq-send" && m === "POST") {
      if (body?.confirm !== true) return json({ error: "Confirm first. Adding to the queue cannot be undone from SubSync." }, 400);
      const keys = Array.isArray(body.keys) ? (body.keys as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 400) : undefined;
      const list = typeof body.list === "string" && isListId(body.list) ? body.list : undefined;
      if (!list && !keys) return json({ error: "Choose a list or some people." }, 400);
      const cur = await getSettings(ctx.installationId, a.id);
      const p = await preview(ctx.installationId, a.id, { auto: false, lists: list ? [list] : undefined, keys, limit: BATCH_MAX }, Date.now(), ctx.demo);
      if (!p.ok || !p.plan) return json({ ok: false, message: p.message }, 400);
      const done = await apply({ installationId: ctx.installationId, companyId: a.companyId, locationId: a.id, actor: ctx.session.userName ?? ctx.session.userId ?? null, source: "manual", plan: p.plan, settings: cur.s, demo: ctx.demo });
      return json({ ok: true, ...done, message: done.live ? `Added ${done.added} to your call queue.${done.failed ? ` ${done.failed} could not be added.` : ""}${done.needsPermission ? " Your CRM did not allow it yet: the optional contacts permission is needed." : ""}` : `${p.plan.sendNote} Nothing was sent: writing to your CRM is switched off here.` });
    }
  } catch (e) { console.error("call queue", e instanceof Error ? e.message : "failed"); return json({ error: "The call queue could not be read right now." }, 500); }
  return json({ error: "Not found" }, 404);
}
