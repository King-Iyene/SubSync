import { sql } from "../db";
import { getSettings } from "../analytics/queries";
import type { Feature } from "../entitlements";
import { deepLinks } from "../links";
import { libraryTemplate, BULK_CAP, GUIDES } from "../workflows-setup/library";
import { planFor, installOne } from "../workflows-setup/library-run";
import { TEMPLATES } from "../workflows-setup/templates";
import { capProblem, checkToken, makeToken, opKey } from "../workflows/guards";
import { coverageFor } from "../workflows/health";
import { EMPTY_COUNTS, FORMULA, GAPS, accountRow, dollarLine, filterRows, gapDef, pageOf, parseCursor, rankRows, todayLine, totalsOf, type AccountRow, type GapId } from "../workflows/outcomes";
import { gapPeoplePage, loadOutcomeTrend, outcomeCounts } from "../workflows/outcomes-db";
import { accountNames, appendChange, finishChange, loadItems, todayCounts } from "../workflows/store";
import { json } from "./auth";
import { ownedLocation } from "./tenant-guard";
import { accountsOf, actor, grantedOf, has, type Ctx, type Deps } from "./workflows-api";

// Workflows second pass (docs/features/WORKFLOWS_BRIEF.md): outcome gaps per client account, the people behind each gap, the template library, a safe install in one or many
// accounts, and the alerts for Today. Same rules as every route: the company, the person and the accounts come from the signed session; every account id in a request goes
// through ownedLocation before any query; an id that is not yours answers exactly like one that does not exist and is never echoed. Reads only, except install, which goes
// through the provisioner and the write gateway (a rehearsal unless the live switch and the account's own opt-in are both on).

const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const body = async (ctx: Ctx) => (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
const GAP_IDS = new Set<string>(GAPS.map((g) => g.id));
const PAGE = 25;

async function rowsFor(ctx: Ctx, deps: Deps, now: number): Promise<{ rows: AccountRow[]; available: boolean; allowed: string[] | null }> {
  const allowed = await accountsOf(ctx, deps);
  const [accounts, { items }] = await Promise.all([accountNames(ctx.installationId, allowed), loadItems(ctx.installationId, allowed)]);
  const live = accounts.filter((a) => !a.ignored);
  const counts = await outcomeCounts(ctx.installationId, live.map((a) => a.locationId), new Date(now));
  if (counts === null) return { rows: [], available: false, allowed };
  const known = new Set(items.map((w) => w.locationId));
  const rows = live.map((a) => accountRow(a, counts.get(a.locationId) ?? EMPTY_COUNTS, { known: known.has(a.locationId), have: known.has(a.locationId) ? coverageFor(a.locationId, items).have : [] }));
  return { rows, available: true, allowed };
}

export async function outcomes(ctx: Ctx, deps: Deps) {
  if (!on(ctx, "wf_outcomes")) return off();
  const now = Date.now();
  const sp = ctx.url.searchParams;
  const size = Math.min(100, Math.max(5, Number(sp.get("size")) || PAGE));
  const level = sp.get("level") === "attention" || sp.get("level") === "ok" ? (sp.get("level") as "attention" | "ok") : "all";
  const gapRaw = sp.get("gap") ?? "all";
  const gap = (GAP_IDS.has(gapRaw) ? gapRaw : "all") as GapId | "all";
  const q = (sp.get("q") ?? "").slice(0, 80);
  const { rows, available, allowed } = await rowsFor(ctx, deps, now);
  if (!available) return json({ available: false, now, rows: [], total: 0, next: null });
  const filtered = filterRows(rows, { q, level, gap });
  const page = pageOf(rankRows(filtered), parseCursor(sp.get("cursor")), size);
  const all = totalsOf(rows);
  const [trend, granted] = await Promise.all([loadOutcomeTrend(ctx.installationId, allowed), grantedOf(ctx)]);
  const staff = ctx.kind !== "client";
  return json({
    available: true, now, kind: ctx.kind,
    // Totals over everything this person may see (the tiles), and the count of the filtered rows (above the table): each equals the rows behind it.
    totals: all, total: filtered.length, rows: page.rows, next: page.next,
    gaps: GAPS.map((g) => ({ id: g.id, short: g.short, automation: g.automation, template: g.template })),
    dollars: dollarLine(all.value), formula: FORMULA, today: on(ctx, "wf_today") ? todayLine(all) : null, trend,
    permissions: { list: has(granted, "workflows.readonly"), write: has(granted, "workflows.readonly", "workflows.write") },
    can: { library: staff && on(ctx, "wf_library"), bulk: staff && on(ctx, "wf_bulk") },
  });
}

export async function gapPeople(ctx: Ctx, deps: Deps) {
  if (!on(ctx, "wf_outcomes")) return off();
  const sp = ctx.url.searchParams;
  const allowed = await accountsOf(ctx, deps);
  const loc = await ownedLocation(ctx.installationId, allowed, sp.get("locationId"));
  const gap = sp.get("gap") ?? "";
  if (!loc || !GAP_IDS.has(gap)) return json({ error: "Not found" }, 404);
  let after: { at: number; id: string } | null = null;
  const c = sp.get("cursor");
  if (c && /^[A-Za-z0-9_-]{1,300}$/.test(c)) {
    try {
      const o = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
      if (typeof o.at === "number" && typeof o.id === "string") after = { at: o.at, id: o.id };
    } catch { after = null; }
  }
  const links = deepLinks((await getSettings(ctx.installationId).catch(() => null))?.appDomain);
  const page = await gapPeoplePage(ctx.installationId, loc, gap as GapId, new Date(), after, 25);
  const last = page.rows[page.rows.length - 1];
  const more = page.total > 25 && page.rows.length === 25 && !!last;
  return json({
    gap, total: page.total, title: gapDef(gap)?.short ?? "People",
    rows: page.rows.map((r) => ({ contactId: r.contactId, at: r.at, name: r.name, phone: r.phone, email: r.email, dollars: r.dollars, url: links.contact(loc, r.contactId) })),
    next: more ? Buffer.from(JSON.stringify({ at: last.at, id: last.contactId })).toString("base64url") : null,
  });
}

// ---------------------------------------------------------------- library and install
export async function library(ctx: Ctx, deps: Deps) {
  if (!on(ctx, "wf_library")) return off();
  const allowed = await accountsOf(ctx, deps);
  const ids = (await accountNames(ctx.installationId, allowed)).filter((a) => !a.ignored).map((a) => a.locationId);
  const made = ids.length ? await sql()`select template_key, count(*)::int n from workflow_setup where installation_id = ${ctx.installationId} and location_id = any(${ids}::text[]) and status = 'active' group by 1`.catch(() => []) : [];
  const by = new Map(made.map((r) => [r.template_key as string, r.n as number]));
  const me = actor(ctx);
  return json({
    templates: TEMPLATES.map((t) => ({ key: t.key, name: t.name, summary: t.summary, tag: t.defaultTag, installed: by.get(t.key) ?? 0, fixes: GAPS.filter((g) => g.template === t.key).map((g) => g.short), version: t.version })),
    guides: GUIDES, accounts: ids.length, cap: BULK_CAP,
    can: { install: ctx.kind !== "client" && me.may, bulk: on(ctx, "wf_bulk") },
    live: process.env.WRITE_GHL_LIVE === "true",
  });
}

async function resolveInstall(ctx: Ctx, deps: Deps, b: Record<string, unknown>) {
  const t = libraryTemplate(b.template);
  if (!t) return { error: "Choose a template from the list.", status: 400 as const };
  const raw = Array.isArray(b.locationIds) ? b.locationIds.slice(0, BULK_CAP + 1) : [];
  if (raw.length === 0) return { error: "Choose at least one client account.", status: 400 as const };
  if (raw.length > BULK_CAP) return { error: `At most ${BULK_CAP} client accounts at a time.`, status: 400 as const };
  if (raw.length > 1 && !on(ctx, "wf_bulk")) return { error: "Installing in many accounts at once is not switched on for your account.", status: 404 as const };
  const allowed = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
  const names = new Map((await accountNames(ctx.installationId, allowed)).map((a) => [a.locationId, a.name]));
  const ids: string[] = [];
  for (const v of raw) {
    const ok = await ownedLocation(ctx.installationId, allowed, v);
    if (!ok || !names.has(ok)) return { error: "Some of these client accounts are not available to you.", status: 404 as const };
    if (!ids.includes(ok)) ids.push(ok);
  }
  return { t, ids, names };
}

export async function installPreview(ctx: Ctx, deps: Deps) {
  if (!on(ctx, "wf_library")) return off();
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return json({ error: "Only an administrator can set up workflows." }, 403);
  const b = await body(ctx);
  if (!b) return json({ error: "Bad request" }, 400);
  const r = await resolveInstall(ctx, deps, b);
  if ("error" in r) return json({ error: r.error }, r.status);
  const p = await planFor(ctx.installationId, r.t, r.ids.map((id) => ({ locationId: id, name: r.names.get(id) as string })), await grantedOf(ctx));
  const doing = p.rows.filter((x) => x.state === "would_create" || x.state === "rehearse");
  const token = makeToken({ installationId: ctx.installationId, actor: me.key, kind: "install", changes: { t: r.t.key, ids: doing.map((x) => x.locationId).sort() } }, Date.now());
  return json({ ...p, token, undo: `SubSync never deletes what it sets up. To undo, delete the workflow named "${r.t.name}" in your CRM. It is also listed in History.`, dryRunAll: doing.length > 0 && doing.every((x) => x.state === "rehearse") });
}

export async function install(ctx: Ctx, deps: Deps) {
  if (!on(ctx, "wf_library")) return off();
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return json({ error: "Only an administrator can set up workflows." }, 403);
  const b = await body(ctx);
  if (!b) return json({ error: "Bad request" }, 400);
  const r = await resolveInstall(ctx, deps, b);
  if ("error" in r) return json({ error: r.error }, r.status);
  const now = Date.now();
  const p = await planFor(ctx.installationId, r.t, r.ids.map((id) => ({ locationId: id, name: r.names.get(id) as string })), await grantedOf(ctx));
  const doing = p.rows.filter((x) => x.state === "would_create" || x.state === "rehearse");
  const token = b.token;
  const state = checkToken(token, { installationId: ctx.installationId, actor: me.key, kind: "install", changes: { t: r.t.key, ids: doing.map((x) => x.locationId).sort() } }, now);
  if (state === "expired") return json({ error: "This preview is more than 15 minutes old. Run the preview again.", expired: true }, 410);
  if (state !== "ok") return json({ error: "This preview does not match your request. Run the preview again." }, 409);
  const problem = capProblem("install", doing.length, await todayCounts(ctx.installationId, now));
  if (problem) return json({ error: problem }, 429);
  const out: Array<{ locationId: string; outcome: string; message: string }> = [];
  for (const row of doing) {
    const claim = await appendChange({ installationId: ctx.installationId, locationId: row.locationId, workflowId: `template:${r.t.key}`, kind: "install", actorKey: me.key, actorName: me.name, before: null, after: { name: r.t.name, status: "draft" }, outcome: "started", opKey: opKey(String(token), "install", row.locationId, r.t.key) });
    if (claim === null) { out.push({ locationId: row.locationId, outcome: "skipped", message: "Already done by this confirmation." }); continue; }
    const res = await installOne(r.t, { installationId: ctx.installationId, companyId: ctx.session.companyId, locationId: row.locationId }).catch(() => null);
    const outcome = !res ? "failed" : res.state === "created" || res.state === "ready" || res.state === "update_available" ? "done" : res.state === "would_create" ? "dry_run" : "failed";
    if (claim !== -1) await finishChange(claim, outcome, { name: r.t.name, status: outcome === "done" ? "published" : "draft" });
    out.push({ locationId: row.locationId, outcome, message: res?.message ?? "SubSync could not set this up just now. Try again in a minute." });
  }
  return json({ ok: true, results: out, skipped: p.rows.filter((x) => x.state === "exists" || x.state === "blocked").length, dryRun: out.some((x) => x.outcome === "dry_run") });
}
