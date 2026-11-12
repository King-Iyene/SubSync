import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
import {
  againstOwnNormal, byAccount, filterCamps, flagsFor, pct, rate, totals, STAT_KEYS, type Camp, type DateRange,
} from "../workflows/delivery";
import { parseLogs, proofOf, snoozeUntil, summarise } from "../workflows/detail";
import { workflowDefinition, workflowErrors } from "../workflows/ghl";
import { accountNames, loadCampaigns, loadItems, loadWorkflowAlerts, saveMark, NeedsUpdate } from "../workflows/store";
import { sql } from "../db";
import { json } from "./auth";
import { actor, grantedOf, has, isOn, resolve, accountsOf, type Ctx, type Deps } from "./workflows-api";

// More routes of the Workflows module: the inline detail, the working queue marks, campaign delivery and the weekly Proof. Same rules as the rest: the
// session decides which client accounts, the browser only names an item, and an item outside the session's accounts answers like one that does not exist.

const body = async (ctx: Ctx) => (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;

export async function detail(ctx: Ctx, deps: Deps) {
  const loc = ctx.url.searchParams.get("locationId") ?? "", id = ctx.url.searchParams.get("workflowId") ?? "";
  const r = await resolve(ctx, deps, [{ locationId: loc, workflowId: id }]);
  if ("error" in r) return json({ error: r.error }, r.status);
  const w = r.items[0];
  if (id.startsWith("campaign:")) return json({ kind: "campaign", note: "Campaign steps and messages are not available from the platform yet. The delivery tab shows what it reports." });
  if (ctx.demo) {
    return json({ kind: "workflow", summary: { triggers: ["Contact created", "Form submitted"], steps: [{ n: 1, name: "Send SMS", kind: "Sms" }, { n: 2, name: "Wait 10 minutes", kind: "Wait" }, { n: 3, name: "Send email", kind: "Email" }], stepCount: 3, branches: 0, settings: ["A contact can enter only once"] },
      errors: (w.failed30d ?? 0) > 0 ? [{ at: Date.now() - 3_600_000, status: "failed", step: "Send SMS", words: "this step failed: the phone number is not valid" }] : [], needs: [] });
  }
  const granted = await grantedOf(ctx);
  const needs = [...(has(granted, "workflows.readonly") ? [] : ["workflows.readonly"]), ...(has(granted, "workflows.logs") ? [] : ["workflows.logs"])];
  let token: string;
  try { token = await deps.token(ctx, loc); } catch { return json({ kind: "workflow", summary: null, errors: [], needs, problem: "SubSync could not open this client account." }); }
  const [def, logs] = await Promise.all([
    has(granted, "workflows.readonly") ? workflowDefinition({ token }, id) : null,
    has(granted, "workflows.logs") ? workflowErrors({ token }, id, Date.now()) : null,
  ]);
  return json({ kind: "workflow", summary: def && def.ok ? summarise(def.value) : null, errors: logs && logs.ok ? parseLogs(logs.value) : [], needs });
}

export async function mark(ctx: Ctx, deps: Deps) {
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return json({ error: "Only an administrator can mark things." }, 403);
  if (!isOn(ctx, "workflows_pro")) return json({ error: "The working queue is part of the paid plan.", upgrade: true }, 402);
  const b = await body(ctx);
  if (!b) return json({ error: "Bad request" }, 400);
  const loc = String(b.locationId ?? ""), id = String(b.workflowId ?? "");
  // The missing-basics check of an account is marked with the word "coverage" and is checked against the session's accounts like everything else.
  if (id === "coverage") {
    const allowed = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
    if (!(await accountNames(ctx.installationId, allowed)).some((a) => a.locationId === loc)) return json({ error: "Not found" }, 404);
  } else {
    const r = await resolve(ctx, deps, [{ locationId: loc, workflowId: id }]);
    if ("error" in r) return json({ error: r.error }, r.status);
  }
  const action = String(b.action ?? "");
  try {
    if (action === "fixed") await saveMark(ctx.installationId, loc, id, { fixed: true, snoozedUntil: null }, me.name);
    else if (action === "reopen") await saveMark(ctx.installationId, loc, id, { fixed: false, snoozedUntil: null }, me.name);
    else if (action === "snooze") { const until = snoozeUntil(String(b.choice ?? ""), Date.now()); if (!until) return json({ error: "Pick a day, a week or a month." }, 400); await saveMark(ctx.installationId, loc, id, { snoozedUntil: until }, me.name); }
    else if (action === "watch" || action === "unwatch") await saveMark(ctx.installationId, loc, id, { watch: action === "watch" }, me.name);
    else return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof NeedsUpdate) return json({ error: e.message }, 503);
    throw e;
  }
  return json({ ok: true });
}

export async function delivery(ctx: Ctx, deps: Deps) {
  const allowed = await accountsOf(ctx, deps);
  const sp = ctx.url.searchParams;
  const now = Date.now();
  const range = (["7", "30", "90", "all"].includes(sp.get("range") ?? "") ? sp.get("range") : "all") as DateRange;
  const [{ camps, available }, accounts, granted] = await Promise.all([loadCampaigns(ctx.installationId, allowed), accountNames(ctx.installationId, allowed), grantedOf(ctx)]);
  const f = { status: (sp.get("status") ?? "all").slice(0, 20), source: (sp.get("source") ?? "all").slice(0, 30), range, now };
  const list = filterCamps(camps, f);
  const withStats = list.filter((c) => c.stats);
  const name = new Map(accounts.map((a) => [a.locationId, a.name]));
  const flags = flagsFor(list, now).map((x) => ({ ...x, campaign: list.find((c) => c.campaignId === x.campaignId && c.locationId === x.locationId)?.name ?? "", account: name.get(x.locationId) ?? "Client account" }));
  const league = byAccount(list).map((a) => ({ ...a, name: name.get(a.locationId) ?? "Client account" }));
  const pick = (sp.get("compare") ?? "").split(",").filter(Boolean).slice(0, 4);
  const normal = (c: Camp) => againstOwnNormal(c, camps);
  return json({
    available, now, statsPermitted: has(granted, "emails/stats.readonly"), permissionName: "emails/stats.readonly",
    // What the platform does not give, said once and in words (never a made-up number).
    notAvailable: { people: "Who received, opened or bounced is not available from the platform yet, so a number opens the campaigns behind it, not the contacts.", hours: "Delivery by day and hour is not available from the platform yet: it reports totals per campaign, not a timeline." },
    sources: [...new Set(camps.map((c) => c.kind).filter(Boolean))], statuses: [...new Set(camps.map((c) => c.status))],
    accounts: accounts.filter((a) => !a.ignored).map((a) => ({ locationId: a.locationId, name: a.name })),
    camps: list.map((c) => ({ ...c, account: name.get(c.locationId) ?? "Client account", deliveredRate: c.stats ? rate(c.stats.delivered, c.stats.sent) : null, normal: normal(c) })),
    totals: totals(list), withStats: withStats.length, flags, league,
    compare: pick.map((id) => list.find((c) => c.campaignId === id)).filter((c): c is Camp => !!c).map((c) => ({ campaignId: c.campaignId, locationId: c.locationId, name: c.name, account: name.get(c.locationId) ?? "", stats: c.stats, delivered: pct(c.stats ? rate(c.stats.delivered, c.stats.sent) : null) })),
    keys: STAT_KEYS,
  });
}

export async function proof(ctx: Ctx, deps: Deps) {
  const allowed = await accountsOf(ctx, deps);
  const now = Date.now();
  // The date bar's dates (from, to) when they are valid (checked here, never trusted); otherwise the old 7 or 30 days.
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) ? Date.parse(`${v}T00:00:00Z`) : null);
  const f0 = day(ctx.url.searchParams.get("from")), t0 = day(ctx.url.searchParams.get("to"));
  const win = f0 !== null && t0 !== null && f0 <= t0 && t0 < now && (t0 - f0) / 86_400_000 + 1 <= MAX_RANGE_DAYS ? { from: f0, until: t0 + 86_400_000 } : undefined;
  const days = win ? Math.round((win.until - win.from) / 86_400_000) : ctx.url.searchParams.get("days") === "30" ? 30 : 7;
  const [alerts, accounts, { items }] = await Promise.all([loadWorkflowAlerts(ctx.installationId, allowed, win ? win.from : now - days * 86_400_000), accountNames(ctx.installationId, allowed), loadItems(ctx.installationId, allowed)]);
  const p = proofOf(alerts, now, days, win);
  const name = new Map(accounts.map((a) => [a.locationId, a.name]));
  const row = (a: (typeof alerts)[number]) => ({ title: a.title, kind: a.kind, account: a.locationId ? name.get(a.locationId) ?? "Client account" : "", at: a.createdAt, clearedAt: a.resolvedAt });
  return json({
    days, now, ...(win ? { from: new Date(win.from).toISOString().slice(0, 10), to: new Date(win.until - 86_400_000).toISOString().slice(0, 10) } : {}), raised: p.raised.map(row), cleared: p.cleared.map(row), open: p.open.map(row), watched: items.filter((w) => !w.removedSeenAt).length,
    // "Cleared" is the honest word: SubSync can tell the condition went away, not who fixed it.
    note: "Cleared means the problem is no longer there at the latest update. SubSync cannot tell who fixed it.",
  });
}

// ---------------------------------------------------------------- saved views (the person's own: which client accounts, which part, Workflows or Campaigns)
const VIEW_MAX = 10;
const ownerOf = (ctx: Ctx) => ctx.session.userId ?? null;
export async function viewsList(ctx: Ctx) {
  const owner = ownerOf(ctx);
  if (!owner || ctx.kind === "client") return json({ views: [] });
  const rows = await sql()`select name, filters from saved_views where installation_id = ${ctx.installationId} and owner = ${owner} and page = 'workflows' order by name`.catch(() => []);
  return json({ views: rows.map((r) => ({ name: r.name as string, filters: r.filters })) });
}
export async function viewsSave(ctx: Ctx, deps: Deps) {
  const owner = ownerOf(ctx);
  if (!owner || ctx.kind === "client") return json({ error: "Saved views are for administrators." }, 403);
  const b = await body(ctx);
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : "";
  if (!name) return json({ error: "Give the view a name." }, 400);
  const f = (b?.filters ?? {}) as Record<string, unknown>;
  // Only choices are kept, never a row or a name of a workflow. The accounts are checked against the session, so another company's id is dropped.
  const allowed = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
  const known = new Set((await accountNames(ctx.installationId, allowed)).map((a) => a.locationId));
  const picked = Array.isArray(f.picked) ? f.picked.filter((x): x is string => typeof x === "string" && known.has(x)).slice(0, 50) : [];
  const clean = { show: ["workflow", "campaign", "both"].includes(String(f.show)) ? f.show : "workflow", tab: ["overview", "list", "health", "tidy", "delivery", "proof", "history"].includes(String(f.tab)) ? f.tab : "overview", picked };
  const [{ n }] = await sql()`select count(*)::int n from saved_views where installation_id = ${ctx.installationId} and owner = ${owner} and page = 'workflows' and name <> ${name}`;
  if ((n as number) >= VIEW_MAX) return json({ error: `At most ${VIEW_MAX} saved views.` }, 400);
  await sql()`insert into saved_views (installation_id, owner, page, name, filters) values (${ctx.installationId}, ${owner}, 'workflows', ${name}, ${sql().json(clean as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
  return json({ ok: true });
}
export async function viewsRemove(ctx: Ctx) {
  const owner = ownerOf(ctx);
  if (!owner || ctx.kind === "client") return json({ error: "Saved views are for administrators." }, 403);
  const name = (ctx.url.searchParams.get("name") ?? "").slice(0, 40);
  await sql()`delete from saved_views where installation_id = ${ctx.installationId} and owner = ${owner} and page = 'workflows' and name = ${name}`;
  return json({ ok: true });
}
