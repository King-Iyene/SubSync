import { sql } from "../db";
import { dispatchAlerts } from "../notifications/service";
import { parseGranted } from "../scope-groups";
import { capProblem, checkToken, makeToken, mayHaveActive, mayWrite, opKey, phraseMatches, deletePhrase, type WriteKind } from "../workflows/guards";
import { applyMarks, markKey } from "../workflows/detail";
import { alertDrafts, coverageFor, nextSteps, rankFindings, standardLabel, STANDARD } from "../workflows/health";
import { changeWords, entityOf, type WfItem } from "../workflows/model";
import { planRename, ruleIsEmpty, type RenameRule } from "../workflows/rename";
import { compareAcross, findDuplicates, lintNames, FIX } from "../workflows/tidy";
import { accountBars, dailySeries, decisionSlices, failingIds, ratingBars, statusSlices, topFailing } from "../workflows/reports";
import { recreate, runOne, type Result, type RunDeps } from "../workflows/run";
import { currentFindings, raiseAlerts, syncAccount, type AccountSync } from "../workflows/sync";
import {
  accountNames, appendChange, applyLocal, finishChange, findChange, latestSnapshot, loadChanges, loadDaily, loadItems, loadLabels, recordDaily, saveLabel, saveSnapshot, todayCounts, touchVisit, changesSince, NEEDS_UPDATE, NeedsUpdate,
  type LabelPatch,
} from "../workflows/store";
import { json, type AuthContext } from "./auth";
import { delivery, detail, mark, proof, viewsList, viewsRemove, viewsSave } from "./workflows-more";

// The Workflows module's routes (docs/features/WORKFLOWS.md). Same rule as every route: the company, the person and the client accounts come from the signed
// session, never from the request. A client's staff may read their own account's list and health; only an agency owner or administrator, or a business
// administrator, may organise or change anything; nothing is ever sent to the CRM unless WORKFLOWS_WRITE_LIVE is on.

export type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Deps = {
  allowed: (ctx: Ctx) => Promise<string[] | null>;
  token: (ctx: Ctx, locationId: string) => Promise<string>;
};

const body = async (ctx: Ctx) => (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
const ID = /^[A-Za-z0-9_:.-]{1,120}$/;
const LOC = /^[A-Za-z0-9_-]{3,64}$/;
const DAY = 86_400_000;

export function actor(ctx: Ctx) {
  const pr = ctx.session.personRole as string | undefined;
  return {
    key: ctx.session.userId ?? ctx.kind, name: ctx.session.userName ?? null,
    may: mayWrite({ kind: ctx.kind, role: ctx.session.role ?? null, isOwnerOrAdmin: pr === "agency_owner" || pr === "agency_admin" || pr === "account_admin" || (ctx.demo && ctx.kind !== "client") }),
  };
}
export const isOn = (ctx: Ctx, f: "workflows_pro" | "workflows_write") => ctx.entitlements.features[f] !== false && !ctx.entitlements.locked.includes(f);

export async function grantedOf(ctx: Ctx): Promise<string[] | null> {
  if (ctx.demo) return null;
  const [inst] = await sql()`select scope from installations where id = ${ctx.installationId}`;
  return typeof inst?.scope !== "string" || inst.scope.trim() === "" ? null : parseGranted(inst.scope as string);
}
export const has = (g: string[] | null, ...s: string[]) => g === null || s.every((x) => g.includes(x));

/** The client accounts a request may touch: the signed session's own list, narrowed (never widened) by the page's own `wa` choice. */
export async function accountsOf(ctx: Ctx, deps: Deps): Promise<string[] | null> {
  const base = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
  const pick = (ctx.url.searchParams.get("wa") ?? "").split(",").filter((x) => LOC.test(x));
  if (ctx.limitTo || pick.length === 0) return base;
  return base === null ? pick : base.filter((x) => pick.includes(x));
}
const toWords = (e: unknown) => (e instanceof NeedsUpdate ? e.message : null);

// ---------------------------------------------------------------- read

async function view(ctx: Ctx, deps: Deps) {
  const allowed = await accountsOf(ctx, deps);
  const now = Date.now();
  const [{ items, available }, accounts, labels, daily, granted, { findings: allFindings, logsKnown }] = await Promise.all([
    loadItems(ctx.installationId, allowed), accountNames(ctx.installationId, allowed), loadLabels(ctx.installationId, allowed), loadDaily(ctx.installationId, allowed),
    grantedOf(ctx), currentFindings(ctx.installationId, allowed, now),
  ]);
  const marks = new Map([...labels].map(([k, v]) => [k, { fixedAt: v.fixedAt, snoozedUntil: v.snoozedUntil }]));
  const { open: findings, muted } = applyMarks(allFindings, marks, now);
  const live = items.filter((w) => !w.removedSeenAt);
  const failing = failingIds(findings);
  const visitOwner = ctx.session.userId ?? null;
  const sinceAt = !ctx.demo && visitOwner ? await touchVisit(ctx.installationId, visitOwner, now) : null;
  const sinceChanges = sinceAt ? await changesSince(ctx.installationId, allowed, sinceAt) : 0;
  const me = actor(ctx);
  const staff = ctx.kind !== "client";
  const ranked = rankFindings(findings);
  const coverage = accounts.filter((a) => !a.ignored && items.some((w) => w.locationId === a.locationId)).map((a) => coverageFor(a.locationId, items));
  const syncedAt = items.reduce((m, w) => Math.max(m, w.lastRunAt ?? 0), 0) || null;
  const [seen] = available ? await sql()`select max(last_seen_at) as at from workflow_items where installation_id = ${ctx.installationId}` : [{ at: null }];
  return json({
    kind: ctx.kind, available, demo: ctx.demo, now,
    // What this person may do. The server decides again on every change; this only decides which buttons are drawn.
    can: { organise: staff && me.may && isOn(ctx, "workflows_pro"), change: staff && me.may && isOn(ctx, "workflows_write"), health: isOn(ctx, "workflows_pro"), sync: staff },
    needs: { upgradeHealth: !isOn(ctx, "workflows_pro"), upgradeChange: !isOn(ctx, "workflows_write") },
    permissions: {
      list: has(granted, "workflows.readonly"), history: has(granted, "workflows.logs"), campaigns: has(granted, "campaigns.readonly") || has(granted, "emails/campaigns.readonly"),
      rename: has(granted, "workflows.readonly", "workflows.write"), publish: has(granted, "workflows.publish"), delete: has(granted, "workflows.delete", "workflows.readonly"),
      writeLive: process.env.WORKFLOWS_WRITE_LIVE === "true",
    },
    accounts: accounts.filter((a) => !a.ignored).map((a) => ({ locationId: a.locationId, name: a.name })),
    items: live.map((w) => ({ ...w, kind: w.kind })),
    labels: staff ? Object.fromEntries([...labels].map(([k, v]) => [k, v])) : {},
    findings: ranked, muted: muted.map((m) => ({ ...m, key: markKey(m) })), since: sinceAt ? { at: sinceAt, changes: sinceChanges } : null, logsKnown, nextSteps: nextSteps(ranked, logsKnown),
    slices: statusSlices(live, failing), bars: accountBars(live, accounts.filter((a) => !a.ignored), failing),
    top: topFailing(live).map((t) => ({ workflowId: t.w.workflowId, locationId: t.w.locationId, name: t.w.name, failed: t.w.failed30d, runs: t.w.runs30d, share: t.share })),
    decisions: decisionSlices(live, labels), ratings: ratingBars(live, labels),
    daily: { failing: dailySeries(daily, (d) => d.failing), total: dailySeries(daily, (d) => d.total), runs: dailySeries(daily, (d) => d.runs), errors: dailySeries(daily, (d) => d.errors) },
    coverage: coverage.map((c) => ({ ...c, missing: c.missing.map(standardLabel), have: c.have.map(standardLabel) })), standard: STANDARD.map((s) => s.label),
    syncedAt: seen?.at instanceof Date ? seen.at.getTime() : syncedAt,
    tidy: staff ? {
      names: lintNames(live), fixes: FIX,
      dupes: findDuplicates(live).map((d) => ({ locationId: d.locationId, exact: d.exact, ids: d.items.map((w) => w.workflowId) })),
      compare: compareAcross(live, accounts.filter((a) => !a.ignored).map((a) => a.locationId)).map((g) => ({ name: g.name, accounts: g.accounts, states: g.states, drift: g.drift, items: g.items.map((w) => ({ workflowId: w.workflowId, locationId: w.locationId })) })),
    } : null,
    caps: await todayCounts(ctx.installationId, now),
  });
}

async function history(ctx: Ctx, deps: Deps) {
  const allowed = await accountsOf(ctx, deps);
  const [changes, { items }, accounts] = await Promise.all([loadChanges(ctx.installationId, allowed), loadItems(ctx.installationId, allowed), accountNames(ctx.installationId, allowed)]);
  const name = new Map(items.map((w) => [`${w.locationId}|${w.workflowId}`, w.name]));
  const acc = new Map(accounts.map((a) => [a.locationId, a.name]));
  const undone = new Set(changes.filter((c) => c.undoes).map((c) => c.undoes as number));
  return json({
    rows: changes.map((c) => ({
      id: c.id, at: c.at, account: acc.get(c.locationId) ?? "Client account", name: name.get(`${c.locationId}|${c.workflowId}`) ?? (c.before?.name as string | undefined) ?? (c.after?.name as string | undefined) ?? "A workflow",
      type: entityOf(c.workflowId) === "campaign" ? "Campaign" : "Workflow", what: changeWords(c.kind, c.before, c.after), kind: c.kind, source: c.source === "subsync" ? "SubSync" : "Noticed in your CRM",
      who: c.source === "subsync" ? c.actorName ?? "Someone" : "Someone in your CRM", outcome: c.outcome, undone: undone.has(c.id), undoable: c.source === "subsync" && c.outcome === "done" && !undone.has(c.id) && ["rename", "publish", "unpublish", "delete"].includes(c.kind),
    })),
  });
}

// ---------------------------------------------------------------- sync

async function sync(ctx: Ctx, deps: Deps) {
  if (ctx.kind === "client") return json({ error: "Only the team that manages SubSync can refresh this." }, 403);
  const allowed = await accountsOf(ctx, deps);
  const list = (await accountNames(ctx.installationId, allowed)).filter((a) => !a.ignored).slice(0, 12);
  const granted = await grantedOf(ctx);
  const now = Date.now();
  const results: AccountSync[] = [];
  if (ctx.demo) {
    for (const a of list) results.push({ locationId: a.locationId, workflows: "ok", campaigns: "ok", count: 0, changes: 0 });
  } else {
    const recent = new Set((await sql()`select location_id from workflow_items where installation_id = ${ctx.installationId} group by location_id having max(last_seen_at) > now() - interval '60 seconds'`.catch(() => [])).map((r) => r.location_id as string));
    for (const a of list) {
      if (recent.has(a.locationId)) { results.push({ locationId: a.locationId, workflows: "skipped", campaigns: "skipped", count: 0, changes: 0 }); continue; }
      results.push(await syncAccount({ installationId: ctx.installationId, locationId: a.locationId, granted, now, token: () => deps.token(ctx, a.locationId) }));
    }
  }
  const { findings: everyFinding } = await currentFindings(ctx.installationId, allowed, now);
  const marked = await loadLabels(ctx.installationId, allowed);
  const { open: findings } = applyMarks(everyFinding, new Map([...marked].map(([k, v]) => [k, { fixedAt: v.fixedAt, snoozedUntil: v.snoozedUntil }])), now);
  const { items } = await loadItems(ctx.installationId, allowed);
  if (!ctx.demo && allowed === null) {
    // New alerts go through the same dispatcher as every other alert (in-app inbox, email, Slack when set up, quiet hours, one message per alert).
    const created = await raiseAlerts(ctx.installationId, findings);
    if (created.length) await dispatchAlerts(ctx.installationId, created).catch(() => null);
  }
  await recordDaily(ctx.installationId, items, failingIds(findings), new Date(now).toISOString().slice(0, 10));
  return json({ ok: true, accounts: results.map((r) => ({ ...r, name: list.find((a) => a.locationId === r.locationId)?.name ?? "Client account" })), alerts: alertDrafts(findings).length });
}

// ---------------------------------------------------------------- organise (SubSync only)

const clean = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
export function parsePatch(b: Record<string, unknown>): { patch: LabelPatch; addLabel: string | null } | { error: string } {
  const p: LabelPatch = {};
  if ("labels" in b) {
    if (!Array.isArray(b.labels) || b.labels.length > 10) return { error: "Use at most 10 labels." };
    p.labels = [...new Set(b.labels.map((l) => clean(l, 30)).filter((l): l is string => !!l))];
  }
  if ("group" in b) p.group = clean(b.group, 40);
  if ("rating" in b) { if (b.rating !== null && !(Number.isInteger(b.rating) && (b.rating as number) >= 1 && (b.rating as number) <= 5)) return { error: "A rating is 1 to 5." }; p.rating = (b.rating as number | null) ?? null; }
  if ("decision" in b) { if (b.decision !== null && !["keep", "review", "retire"].includes(String(b.decision))) return { error: "Choose keep, review or retire." }; p.decision = (b.decision as "keep" | "review" | "retire" | null) ?? null; }
  if ("note" in b) p.note = clean(b.note, 1000);
  if ("owner" in b) p.owner = clean(b.owner, 60);
  return { patch: p, addLabel: clean(b.addLabel, 30) };
}

type Pick = { locationId: string; workflowId: string };
const picks = (v: unknown): Pick[] | null => {
  if (!Array.isArray(v)) return null;
  const out: Pick[] = [];
  for (const x of v) {
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o.locationId !== "string" || typeof o.workflowId !== "string" || !LOC.test(o.locationId) || !ID.test(o.workflowId)) return null;
    out.push({ locationId: o.locationId, workflowId: o.workflowId });
  }
  return out;
};
/** The picked items as SubSync holds them, only inside the accounts this session may read. A pick outside them is dropped, and if anything is dropped the request is refused. */
export async function resolve(ctx: Ctx, deps: Deps, raw: unknown): Promise<{ items: WfItem[] } | { error: string; status: number }> {
  const p = picks(raw);
  if (!p || p.length === 0) return { error: "Nothing was picked.", status: 400 };
  const allowed = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
  const { items } = await loadItems(ctx.installationId, allowed);
  const by = new Map(items.map((w) => [`${w.locationId}|${w.workflowId}`, w]));
  const found = p.map((x) => by.get(`${x.locationId}|${x.workflowId}`)).filter((w): w is WfItem => !!w && !w.removedSeenAt);
  if (found.length !== p.length) return { error: "Some of these are not available to you.", status: 404 };
  return { items: found };
}

async function labelsSave(ctx: Ctx, deps: Deps) {
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return json({ error: "Only an administrator can organise workflows." }, 403);
  if (!isOn(ctx, "workflows_pro")) return json({ error: "Labels and ratings are part of the paid plan.", upgrade: true }, 402);
  const b = await body(ctx);
  if (!b) return json({ error: "Bad request" }, 400);
  const r = await resolve(ctx, deps, b.items);
  if ("error" in r) return json({ error: r.error }, r.status);
  if (r.items.length > 100) return json({ error: "At most 100 at a time." }, 400);
  const parsed = parsePatch((b.patch ?? {}) as Record<string, unknown>);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    const cur = await loadLabels(ctx.installationId, [...new Set(r.items.map((w) => w.locationId))]);
    for (const w of r.items) {
      const patch = { ...parsed.patch };
      if (parsed.addLabel) patch.labels = [...new Set([...(patch.labels ?? cur.get(`${w.locationId}|${w.workflowId}`)?.labels ?? []), parsed.addLabel])].slice(0, 10);
      await saveLabel(ctx.installationId, w.locationId, w.workflowId, patch, me.name);
    }
  } catch (e) {
    const w = toWords(e);
    if (w) return json({ error: w }, 503);
    throw e;
  }
  return json({ ok: true, count: r.items.length });
}

// ---------------------------------------------------------------- change: preview, confirm, undo

const KINDS: WriteKind[] = ["rename", "publish", "unpublish", "delete", "clone"];
type Row = { workflowId: string; locationId: string; name: string; to: string | null; status: "change" | "unchanged" | "blocked"; problem: string | null; needsPause: boolean; maybeActive: boolean };

function ruleOf(raw: unknown): RenameRule {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);
  return { find: s(o.find, 200) || undefined, replace: s(o.replace, 200), prefix: s(o.prefix, 100) || undefined, suffix: s(o.suffix, 100) || undefined, tidy: o.tidy !== false, tidyOnly: o.tidyOnly === true, casing: o.casing === "title" ? "title" : "none" };
}

function plan(kind: WriteKind, items: WfItem[], b: Record<string, unknown>, now: number, allowedTargets: Set<string>): { rows: Row[]; error?: string } {
  const base = (w: WfItem): Row => ({ workflowId: w.workflowId, locationId: w.locationId, name: w.name, to: null, status: "change", problem: null, needsPause: false, maybeActive: false });
  if (items.some((w) => entityOf(w.workflowId) === "campaign")) return { rows: [], error: "Campaigns can be organised in SubSync but not changed from here." };
  if (kind === "rename") {
    const rule = ruleOf(b.rule);
    if (ruleIsEmpty(rule)) return { rows: [], error: "Type what to find, or a prefix or suffix to add." };
    return { rows: planRename(items, rule, b.allowPaused === true).map((r) => ({ workflowId: r.workflowId, locationId: r.locationId, name: r.from, to: r.to, status: r.status, problem: r.problem, needsPause: r.needsPause, maybeActive: false })) };
  }
  if (kind === "publish" || kind === "unpublish") {
    const want = kind === "publish" ? "published" : "draft";
    return { rows: items.map((w) => ({ ...base(w), to: want === "published" ? "Published" : "Draft", status: w.status === want ? "unchanged" : w.status === "other" ? "blocked" : "change", problem: w.status === "other" ? "Locked or in a state SubSync cannot change." : null } as Row)) };
  }
  if (kind === "delete") return { rows: items.map((w) => ({ ...base(w), to: "Deleted", maybeActive: mayHaveActive(w, now) })) };
  const target = typeof b.targetLocationId === "string" ? b.targetLocationId : "";
  if (!LOC.test(target) || !allowedTargets.has(target)) return { rows: [], error: "Pick a client account to copy into." };
  return { rows: items.map((w) => ({ ...base(w), to: `${w.name} (copy)`, status: w.locationId === target ? "blocked" : "change", problem: w.locationId === target ? "This is already in that client account." : null } as Row)) };
}

async function gate(ctx: Ctx, kind: string): Promise<Response | WriteKind> {
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return json({ error: "Only an administrator can change workflows." }, 403);
  if (!isOn(ctx, "workflows_write")) return json({ error: "Changing workflows is part of the paid plan.", upgrade: true }, 402);
  if (!KINDS.includes(kind as WriteKind)) return json({ error: "Unknown change." }, 400);
  return kind as WriteKind;
}

async function preview(ctx: Ctx, deps: Deps) {
  const b = await body(ctx);
  if (!b) return json({ error: "Bad request" }, 400);
  const kind = await gate(ctx, String(b.kind));
  if (typeof kind !== "string") return kind;
  const r = await resolve(ctx, deps, b.items);
  if ("error" in r) return json({ error: r.error }, r.status);
  const accountIds = new Set((await accountNames(ctx.installationId, ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx))).map((a) => a.locationId));
  const now = Date.now();
  const p = plan(kind, r.items, b, now, ctx.limitTo ? new Set<string>() : accountIds);
  if (p.error) return json({ error: p.error }, 400);
  const caps = await todayCounts(ctx.installationId, now);
  const doing = p.rows.filter((x) => x.status === "change");
  const problem = doing.length ? capProblem(kind, doing.length, caps) : null;
  const me = actor(ctx);
  const changes = doing.map((x) => ({ l: x.locationId, w: x.workflowId, to: x.to }));
  return json({
    kind, rows: p.rows, count: doing.length, problem, dryRun: process.env.WORKFLOWS_WRITE_LIVE !== "true" && !ctx.demo,
    token: doing.length && !problem ? makeToken({ installationId: ctx.installationId, actor: me.key, kind, changes: { changes, target: b.targetLocationId ?? null } }, now) : null,
    // What has to be typed for a delete, and which rows may still have people inside.
    phrase: kind === "delete" ? deletePhrase(doing.map((x) => x.name)) : null,
    pauses: doing.filter((x) => x.needsPause && kind === "rename").length, active: doing.filter((x) => x.maybeActive).length,
  });
}

async function confirm(ctx: Ctx, deps: Deps) {
  const b = await body(ctx);
  if (!b) return json({ error: "Bad request" }, 400);
  const kind = await gate(ctx, String(b.kind));
  if (typeof kind !== "string") return kind;
  const r = await resolve(ctx, deps, b.items);
  if ("error" in r) return json({ error: r.error }, r.status);
  const now = Date.now();
  const accountIds = new Set((await accountNames(ctx.installationId, ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx))).map((a) => a.locationId));
  const p = plan(kind, r.items, b, now, ctx.limitTo ? new Set<string>() : accountIds);
  if (p.error) return json({ error: p.error }, 400);
  const doing = p.rows.filter((x) => x.status === "change");
  const me = actor(ctx);
  const token = b.token;
  const state = checkToken(token, { installationId: ctx.installationId, actor: me.key, kind, changes: { changes: doing.map((x) => ({ l: x.locationId, w: x.workflowId, to: x.to })), target: b.targetLocationId ?? null } }, now);
  if (state === "expired") return json({ error: "This preview is more than 15 minutes old. Run the preview again.", expired: true }, 410);
  if (state !== "ok") return json({ error: "This preview does not match your request. Run the preview again." }, 409);
  const caps = await todayCounts(ctx.installationId, now);
  const problem = capProblem(kind, doing.length, caps);
  if (problem) return json({ error: problem }, 429);
  if (kind === "delete") {
    if (!phraseMatches(b.typed, doing.map((x) => x.name))) return json({ error: "The words you typed do not match. Nothing was deleted." }, 400);
    if (doing.some((x) => x.maybeActive) && b.confirmActive !== true) return json({ error: "Some of these ran recently and may still have people inside. Tick the box to confirm.", needsActiveConfirm: true }, 400);
  }
  if (kind === "rename" && doing.some((x) => x.needsPause) && b.allowPaused !== true) return json({ error: "Published workflows need the pause box ticked." }, 400);

  const granted = await grantedOf(ctx);
  const results: Array<Result & { already?: boolean }> = [];
  for (const row of doing) {
    const w = r.items.find((i) => i.workflowId === row.workflowId && i.locationId === row.locationId) as WfItem;
    const key = opKey(String(token), kind, w.locationId, w.workflowId);
    const claim = await appendChange({ installationId: ctx.installationId, locationId: w.locationId, workflowId: w.workflowId, kind, actorKey: me.key, actorName: me.name, before: { name: w.name, status: w.status }, after: row.to ? { name: kind === "rename" || kind === "clone" ? row.to : w.name, status: w.status } : null, outcome: "started", opKey: key }).catch((e) => { if (e instanceof NeedsUpdate) return -1; throw e; });
    if (claim === -1) return json({ error: NEEDS_UPDATE }, 503);
    if (claim === null) { results.push({ workflowId: w.workflowId, locationId: w.locationId, name: w.name, outcome: "skipped", message: "Already done by this confirmation.", already: true }); continue; }
    const rd: RunDeps = { installationId: ctx.installationId, granted, token: (loc) => deps.token(ctx, loc), demo: ctx.demo, idem: key, saveCopy: (def) => saveSnapshot(ctx.installationId, w.locationId, w.workflowId, w.name, kind, def) };
    const res = await runOne(kind, w, { newName: row.to ?? undefined, targetLocationId: typeof b.targetLocationId === "string" ? b.targetLocationId : undefined }, rd);
    const applied = res.outcome === "done";
    await finishChange(claim, res.outcome, { name: res.newName ?? w.name, status: kind === "publish" ? "published" : kind === "unpublish" ? "draft" : w.status, newWorkflowId: res.newWorkflowId ?? null });
    if (applied) {
      if (kind === "rename") await applyLocal(ctx.installationId, w.locationId, w.workflowId, { name: row.to ?? w.name });
      else if (kind === "publish") await applyLocal(ctx.installationId, w.locationId, w.workflowId, { status: "published" });
      else if (kind === "unpublish") await applyLocal(ctx.installationId, w.locationId, w.workflowId, { status: "draft" });
      else if (kind === "delete") await applyLocal(ctx.installationId, w.locationId, w.workflowId, { remove: true });
    }
    results.push(res);
  }
  return json({ ok: true, results: results.map((x) => ({ workflowId: x.workflowId, locationId: x.locationId, name: x.name, outcome: x.outcome, message: x.message })), dryRun: results.some((x) => x.outcome === "dry_run") });
}

async function undo(ctx: Ctx, deps: Deps) {
  const b = await body(ctx);
  const id = typeof b?.changeId === "number" ? b.changeId : NaN;
  const gated = await gate(ctx, "rename");
  if (typeof gated !== "string") return gated;
  if (!Number.isInteger(id)) return json({ error: "Bad request" }, 400);
  const allowed = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
  const found = await findChange(ctx.installationId, allowed, id);
  if (!found || found.change.source !== "subsync" || found.change.outcome !== "done") return json({ error: "That change cannot be undone." }, 404);
  if (found.undone) return json({ error: "That change was already undone." }, 409);
  const c = found.change;
  const now = Date.now();
  const me = actor(ctx);
  const caps = await todayCounts(ctx.installationId, now);
  const problem = capProblem(c.kind === "delete" ? "rename" : (c.kind as WriteKind), 1, caps);
  if (problem) return json({ error: problem }, 429);
  const { items } = await loadItems(ctx.installationId, allowed);
  const cur = items.find((w) => w.locationId === c.locationId && w.workflowId === c.workflowId);
  const granted = await grantedOf(ctx);
  const key = opKey(`undo-${id}`, "rename", c.locationId, c.workflowId);
  const rd: RunDeps = { installationId: ctx.installationId, granted, token: (loc) => deps.token(ctx, loc), demo: ctx.demo, idem: key };
  let res: Result;
  let kindDone = c.kind;
  if (c.kind === "rename" && cur) res = await runOne("rename", cur, { newName: String(c.before?.name ?? "") }, { ...rd, saveCopy: (def) => saveSnapshot(ctx.installationId, c.locationId, c.workflowId, cur.name, "undo", def) });
  else if (c.kind === "publish" && cur) { kindDone = "unpublish"; res = await runOne("unpublish", cur, {}, rd); }
  else if (c.kind === "unpublish" && cur) { kindDone = "publish"; res = await runOne("publish", cur, {}, rd); }
  else if (c.kind === "delete") {
    const snap = await latestSnapshot(ctx.installationId, c.locationId, c.workflowId);
    if (!snap) return json({ error: "No saved copy was found, so this cannot be recreated." }, 404);
    kindDone = "restore";
    res = await recreate({ workflowId: c.workflowId, locationId: c.locationId, name: snap.name }, snap.definition, rd);
  } else return json({ error: "That change cannot be undone." }, 400);
  const row = await appendChange({ installationId: ctx.installationId, locationId: c.locationId, workflowId: c.workflowId, kind: kindDone, actorKey: me.key, actorName: me.name, before: c.after, after: c.before, outcome: res.outcome, undoes: id, opKey: key });
  if (res.outcome === "done") {
    if (c.kind === "rename") await applyLocal(ctx.installationId, c.locationId, c.workflowId, { name: String(c.before?.name ?? "") });
    if (c.kind === "publish") await applyLocal(ctx.installationId, c.locationId, c.workflowId, { status: "draft" });
    if (c.kind === "unpublish") await applyLocal(ctx.installationId, c.locationId, c.workflowId, { status: "published" });
  }
  return json({ ok: res.outcome === "done" || res.outcome === "dry_run", outcome: res.outcome, message: res.message, recorded: row !== null });
}

export async function handleWorkflows(ctx: Ctx, deps: Deps): Promise<Response> {
  const [, a, b] = ctx.segments;
  const m = ctx.request.method;
  try {
    if (m === "GET" && !a) return await view(ctx, deps);
    if (m === "GET" && a === "history") return await history(ctx, deps);
    if (m === "POST" && a === "sync") return await sync(ctx, deps);
    if (m === "PUT" && a === "labels") return await labelsSave(ctx, deps);
    if (m === "POST" && a === "preview") return await preview(ctx, deps);
    if (m === "POST" && a === "confirm") return await confirm(ctx, deps);
    if (m === "POST" && a === "undo") return await undo(ctx, deps);
    if (m === "GET" && a === "detail") return await detail(ctx, deps);
    if (m === "POST" && a === "mark") return await mark(ctx, deps);
    if (m === "GET" && a === "delivery") return await delivery(ctx, deps);
    if (m === "GET" && a === "proof") return await proof(ctx, deps);
    if (m === "GET" && a === "views") return await viewsList(ctx);
    if (m === "POST" && a === "views") return await viewsSave(ctx, deps);
    if (m === "DELETE" && a === "views") return await viewsRemove(ctx);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof NeedsUpdate) return json({ error: e.message }, 503);
    console.error("Workflows route failed", b ?? a ?? "", e instanceof Error ? e.message : "unknown");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
void DAY;
