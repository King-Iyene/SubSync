import { sql } from "../db";
import { outward } from "../live-flags";
import type { Col, Rec, RecordsSpec } from "../analytics/today-records";
import type { deepLinks } from "../links";
import { accountNames, NeedsUpdate } from "../workflows/store";
import { accountsOf, actor, grantedOf, has, type Ctx, type Deps as WfDeps } from "./workflows-api";
import { json } from "./auth";
import { RULES, ruleOf, fixPhone, type RuleId } from "../data-health/rules";
import { averageSeries, benchmarkLine, sinceInstall } from "../data-health/score";
import { checkFixToken, FIX_CAPS, makeFixToken, fixOpKey, planFixes, undoable, type FixKind } from "../data-health/fix";
import {
  appendFixChange, badBySource, benchmark, dayOf, dupExtras, fixesToday, flagRecords, flagTotals, loadContacts, loadFixChanges, loadMarks, loadRules, loadSettings, loadSnapshots, markUndone, outcomeStats,
  saveMark, saveRules, snapshotAccount, type SnapRow,
} from "../data-health/store";
import { proofLines } from "../data-health/digest";

// The Data health routes (docs/features/DATA_HEALTH.md). The company, the person and the client accounts come from the signed session, never from the request.
// A client's staff may read their own account; only an agency owner or administrator, or a business administrator, may save rules, mark records or fix anything.
// Nothing is sent to the CRM unless the optional contacts.write permission is granted AND DATA_HEALTH_WRITE_LIVE is on.
export type Deps = WfDeps & { links: (ctx: Ctx) => Promise<ReturnType<typeof deepLinks>> };

const API_HOST = "https://services.leadconnectorhq.com";
const LOC = /^[A-Za-z0-9_-]{3,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTACT = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = 86_400_000;
const body = async (ctx: Ctx) => (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
const feature = (ctx: Ctx, f: "data_health_pro" | "data_health_fix") => ctx.entitlements.features[f] !== false && !ctx.entitlements.locked.includes(f);
export const MAX_ROWS = 500;
// The import guard counts each contact once, for the four kinds of bad record (the same count as the Imports table).
const BAD_RULES = new Set(["duplicate", "junk", "bad_phone", "bad_email"]);
const uniqueContacts = <T extends { contactId: string }>(rows: T[]) => { const seen = new Set<string>(); return rows.filter((r) => (seen.has(r.contactId) ? false : (seen.add(r.contactId), true))); };

/** One account the signed session may read, or null. Never the request's word alone. */
async function oneAccount(ctx: Ctx, deps: Deps, loc: unknown): Promise<string | null> {
  if (typeof loc !== "string" || !LOC.test(loc)) return null;
  const base = ctx.limitTo ? [ctx.limitTo] : await deps.allowed(ctx);
  if (base !== null) {
    if (!base.includes(loc)) return null;
    // A single account named by the session must still belong to this company (a session can never widen itself to another company).
    if (ctx.limitTo) { const [mine] = await sql`select 1 as x from locations where installation_id = ${ctx.installationId} and location_id = ${loc}`; if (!mine) return null; }
    return loc;
  }
  // "Every account of this company": the account must still belong to this company, so another company's id answers like one that does not exist.
  const [own] = await sql()`select 1 as x from locations where installation_id = ${ctx.installationId} and location_id = ${loc}`;
  return own ? loc : null;
}

async function accountsInView(ctx: Ctx, deps: Deps) {
  const allowed = await accountsOf(ctx, deps);
  const all = (await accountNames(ctx.installationId, allowed)).filter((a) => !a.ignored);
  // The free plan reads one account (the first, or the one the page picked); the paid plan reads every account.
  return feature(ctx, "data_health_pro") ? all : all.slice(0, 1);
}

async function view(ctx: Ctx, deps: Deps) {
  const now = Date.now(), today = dayOf(now);
  const accounts = await accountsInView(ctx, deps);
  const ids = accounts.map((a) => a.locationId);
  let snaps = await loadSnapshots(ctx.installationId, ids, dayOf(now - 400 * DAY));
  const have = new Set(snaps.filter((s) => s.day === today).map((s) => s.locationId));
  for (const id of ids.filter((x) => !have.has(x)).slice(0, 6)) await snapshotAccount(ctx.installationId, id, now).catch((e) => { if (!(e instanceof NeedsUpdate)) throw e; });
  if (ids.some((x) => !have.has(x))) snaps = await loadSnapshots(ctx.installationId, ids, dayOf(now - 400 * DAY));
  const by = new Map<string, SnapRow[]>();
  for (const s of snaps) by.set(s.locationId, [...(by.get(s.locationId) ?? []), s]);
  const rows = accounts.map((a) => {
    const h = by.get(a.locationId) ?? [], last = h[h.length - 1] ?? null, prev = [...h].reverse().find((s) => s.day <= dayOf(now - 7 * DAY)) ?? null;
    const comps = RULES.map((r) => { const c = last?.components.find((x) => x.id === r.id); return { id: r.id, label: r.label, plain: r.plain, count: c?.count ?? 0, penalty: c?.penalty ?? 0, weight: r.weight }; });
    return { locationId: a.locationId, name: a.name, score: last?.score ?? null, total: last?.total ?? 0, day: last?.day ?? null, weekAgo: prev?.score ?? null, bucket: last?.bucket ?? null, components: comps, series: h.slice(-120).map((s) => ({ day: s.day, score: s.score })) };
  });
  const [ownTotals, outcomes, rules] = await Promise.all([flagTotals(ctx.installationId, ids), outcomeStats(ctx.installationId, ids, now - 90 * DAY), loadRules(ctx.installationId, ids)]);
  const single = rows.length === 1 ? rows[0] : null;
  const bench = single ? await benchmark(ctx.installationId, single.bucket) : null;
  const settings = single ? await loadSettings(ctx.installationId, single.locationId) : await loadSettings(ctx.installationId, "*");
  const scored = rows.filter((r) => r.score !== null);
  const me = actor(ctx);
  const granted = await grantedOf(ctx);
  return json({
    kind: ctx.kind, demo: ctx.demo, now, today,
    can: { rules: ctx.kind !== "client" && me.may && feature(ctx, "data_health_pro"), mark: ctx.kind !== "client" && feature(ctx, "data_health_pro"), fix: ctx.kind !== "client" && me.may && feature(ctx, "data_health_fix"), pro: feature(ctx, "data_health_pro"), league: rows.length > 1 },
    needs: { upgradePro: !feature(ctx, "data_health_pro"), upgradeFix: !feature(ctx, "data_health_fix") },
    permissions: { fix: has(granted, "contacts.write"), writeLive: process.env.DATA_HEALTH_WRITE_LIVE === "true", scope: "contacts.write" },
    accounts: rows,
    league: [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((r) => ({ locationId: r.locationId, name: r.name, score: r.score, weekAgo: r.weekAgo, total: r.total })),
    average: scored.length ? Math.round(scored.reduce((s, r) => s + (r.score as number), 0) / scored.length) : null,
    since: sinceInstall(averageSeries(snaps), ownTotals.found, ownTotals.fixed),
    outcomes, benchmark: single ? { line: benchmarkLine(single.score, bench, single.bucket ?? ""), bucket: single.bucket, optedOut: settings.optOut, shown: bench !== null } : null,
    rules: rules.map((r) => ({ locationId: r.locationId, junkWords: r.junkWords, staleDays: r.staleDays, phoneRegion: r.phoneRegion, spikeMin: r.spikeMin })),
    settings: { junkWords: settings.junkWords, staleDays: settings.staleDays, phoneRegion: settings.phoneRegion, spikeMin: settings.spikeMin, optOut: settings.optOut },
    weights: RULES.map((r) => ({ id: r.id, label: r.label, plain: r.plain, weight: r.weight })),
  });
}

const COLS: Col[] = [
  { key: "name", header: "Name", type: "text", primary: true, w: 16 },
  { key: "account", header: "Client account", type: "text", facet: true, w: 12 },
  { key: "problem", header: "Problem", type: "kind", facet: true, w: 14 },
  { key: "email", header: "Email", type: "text", w: 16 },
  { key: "phone", header: "Phone", type: "text", w: 11 },
  { key: "source", header: "Source", type: "text", facet: true, w: 10 },
  { key: "since", header: "Found on", type: "date", w: 10 },
  { key: "state", header: "State", type: "kind", facet: true, w: 9 },
  { key: "owner", header: "Owner", type: "text", facet: true, w: 9 },
  { key: "crm", header: "CRM", type: "link", w: 7 },
];

async function records(ctx: Ctx, deps: Deps) {
  const loc = await oneAccount(ctx, deps, ctx.url.searchParams.get("loc"));
  if (!loc) return json({ error: "Not found" }, 404);
  const q = ctx.url.searchParams;
  const rule = q.get("rule"), day = q.get("day"), mode = q.get("mode") ?? "flags", src = q.get("src");
  if (rule && !ruleOf(rule)) return json({ error: "Unknown problem" }, 400);
  if (day && !DAY_RE.test(day)) return json({ error: "Bad date" }, 400);
  const [{ rows, total }, marks, names, links] = await Promise.all([
    flagRecords(ctx.installationId, loc, rule, day, mode === "flags" ? MAX_ROWS : 5000), loadMarks(ctx.installationId, [loc]), accountNames(ctx.installationId, [loc]), deps.links(ctx),
  ]);
  const mark = new Map(marks.map((m) => [m.contactId, m]));
  const account = names[0]?.name ?? "Client account";
  const seen = new Set<string>();
  const wanted = mode === "queue" ? rows.filter((r) => mark.get(r.contactId)?.state === "todo") : mode === "fixed" ? rows.filter((r) => mark.get(r.contactId)?.state === "fixed") : mode === "source" ? uniqueContacts(rows.filter((r) => BAD_RULES.has(r.rule) && ((r.source ?? "").trim() || "Unknown source") === src)) : rows;
  const recs: Rec[] = [];
  for (const r of wanted) {
    const m = mark.get(r.contactId), id = `${r.contactId}|${r.rule}`;
    if (seen.has(id)) continue;
    seen.add(id);
    recs.push({
      id, url: r.gone ? null : links.contact(loc, r.contactId), lead: null,
      cells: { name: r.name, account, problem: ruleOf(r.rule)?.label ?? r.rule, email: r.email, phone: r.phone, source: r.source, since: Date.parse(r.firstSeen), state: m?.state === "fixed" ? "Marked fixed" : m?.state === "todo" ? "In the queue" : r.gone ? "Gone from your CRM" : "Open", owner: m?.owner ?? null, crm: r.gone ? null : "Open" },
    });
  }
  const cols = COLS.filter((c) => c.primary || recs.some((r) => r.cells[c.key] !== null && r.cells[c.key] !== ""));
  const label = rule ? ruleOf(rule)?.label ?? "Records" : "Records with a problem";
  const cut = mode === "flags" && total > recs.length;
  const spec: RecordsSpec = {
    key: `dh-${loc}-${rule ?? "all"}-${day ?? "now"}-${mode}-${src ?? ""}`, title: day ? `${label} on ${day}` : label, subtitle: `${account}. ${day ? "How it stood on that day." : "Open now."}`, noun: "records",
    count: mode === "flags" ? total : recs.length, cols, rows: recs, note: cut ? `Showing the first ${recs.length} of ${total}. Narrow it with the filters.` : null, dateKey: "since", preset: {}, exportName: `data-health-${rule ?? "all"}`,
  };
  return json({ spec });
}

async function sources(ctx: Ctx, deps: Deps) {
  const loc = await oneAccount(ctx, deps, ctx.url.searchParams.get("loc"));
  if (!loc) return json({ error: "Not found" }, 404);
  if (!feature(ctx, "data_health_pro")) return json({ locked: true, sources: [], spikes: [] });
  const now = Date.now();
  const [bySrc, snap] = await Promise.all([badBySource(ctx.installationId, loc, dayOf(now - 3 * DAY)), snapshotAccount(ctx.installationId, loc, now)]);
  return json({ locked: false, sources: bySrc, spikes: snap.spikes.map((s) => ({ source: s.source, recent: s.recent, created: s.created, usual: s.baselinePerDay, kinds: s.kinds })) });
}

async function refresh(ctx: Ctx, deps: Deps) {
  const b = await body(ctx);
  const loc = await oneAccount(ctx, deps, b?.locationId);
  if (!loc) return json({ error: "Not found" }, 404);
  const r = await snapshotAccount(ctx.installationId, loc, Date.now());
  return json({ ok: true, score: r.score, total: r.total });
}

async function markSave(ctx: Ctx, deps: Deps) {
  if (ctx.kind === "client" || !feature(ctx, "data_health_pro")) return json({ error: "Only the team that manages SubSync can do this on the paid plan." }, 403);
  const b = await body(ctx);
  const loc = await oneAccount(ctx, deps, b?.locationId);
  const ids = Array.isArray(b?.contactIds) ? (b.contactIds as unknown[]).filter((x): x is string => typeof x === "string" && CONTACT.test(x)).slice(0, 500) : [];
  const state = b?.state;
  if (!loc || ids.length === 0 || (state !== undefined && !["todo", "ignored", "fixed", "open"].includes(state as string))) return json({ error: "Nothing to save." }, 400);
  const owner = typeof b?.owner === "string" ? b.owner.slice(0, 80) : b?.owner === null ? null : undefined;
  const note = typeof b?.note === "string" ? b.note.slice(0, 500) : b?.note === null ? null : undefined;
  await saveMark(ctx.installationId, loc, ids, { state: state as never, owner, note }, ctx.session.userName ?? ctx.session.userId ?? ctx.kind);
  return json({ ok: true, count: ids.length });
}

async function rulesSave(ctx: Ctx, deps: Deps) {
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return json({ error: "Only an administrator can change these." }, 403);
  const b = await body(ctx);
  const raw = b?.locationId === "*" ? "*" : await oneAccount(ctx, deps, b?.locationId);
  if (!raw) return json({ error: "Not found" }, 404);
  // "*" (every account) is for the whole company, so a single-account session may not write it, except its own benchmark choice.
  if (raw === "*" && ctx.limitTo) return json({ error: "Not allowed." }, 403);
  const words = Array.isArray(b?.junkWords) ? (b.junkWords as unknown[]).filter((w): w is string => typeof w === "string").map((w) => w.trim().toLowerCase().slice(0, 60)).filter(Boolean).slice(0, 100) : undefined;
  const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : v === null ? null : undefined);
  await saveRules(ctx.installationId, raw, {
    junkWords: words, staleDays: n(b?.staleDays, 30, 1500), spikeMin: n(b?.spikeMin, 3, 500),
    phoneRegion: typeof b?.phoneRegion === "string" && /^\d{1,3}$/.test(b.phoneRegion) ? b.phoneRegion : b?.phoneRegion === null ? null : undefined,
    optOut: typeof b?.optOut === "boolean" ? b.optOut : undefined,
  }, ctx.session.userName ?? ctx.session.userId ?? ctx.kind);
  return json({ ok: true });
}

// ---------------------------------------------------------------- safe fixes

const KINDS = (v: unknown): FixKind[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is FixKind => x === "phone" || x === "name") : []);

type Gate = { err: Response } | { err?: undefined; loc: string; kinds: FixKind[]; me: ReturnType<typeof actor> };
async function fixGate(ctx: Ctx, deps: Deps, b: Record<string, unknown> | null): Promise<Gate> {
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may) return { err: json({ error: "Only an administrator can fix records." }, 403) };
  if (!feature(ctx, "data_health_fix")) return { err: json({ error: "Fixing records is on the paid plan." }, 402) };
  const loc = await oneAccount(ctx, deps, b?.locationId);
  const kinds = KINDS(b?.kinds);
  if (!loc || kinds.length === 0) return { err: json({ error: "Choose a client account and what to fix." }, 400) };
  const granted = await grantedOf(ctx);
  if (!has(granted, "contacts.write")) return { err: json({ error: "Needs permission: reconnect and allow contacts.write.", needsPermission: "contacts.write" }, 403) };
  return { loc, kinds, me };
}
async function planFor(ctx: Ctx, loc: string, kinds: FixKind[], now: number) {
  const [contacts, settings, used] = await Promise.all([loadContacts(ctx.installationId, loc, now), loadSettings(ctx.installationId, loc), fixesToday(ctx.installationId, loc, now)]);
  return planFixes(contacts, kinds, settings.phoneRegion, FIX_CAPS.perDay - used);
}

async function fixPreview(ctx: Ctx, deps: Deps) {
  const b = await body(ctx);
  const g = await fixGate(ctx, deps, b);
  if (g.err) return g.err;
  const now = Date.now();
  const plan = await planFor(ctx, g.loc, g.kinds, now);
  const token = makeFixToken({ installationId: ctx.installationId, actor: g.me.key, locationId: g.loc, changes: plan.changes }, now);
  return json({ changes: plan.changes, skipped: plan.skipped.length, skippedWhy: [...new Set(plan.skipped.map((s) => s.reason))], cut: plan.cut, token, live: process.env.DATA_HEALTH_WRITE_LIVE === "true", capPerDay: FIX_CAPS.perDay, note: "Active payments and workflows cannot be seen from the platform yet, so only contacts with no open deal, no upcoming appointment and no do-not-disturb are changed." });
}

async function put(token: string, locationId: string, contactId: string, fields: Record<string, string>): Promise<boolean> {
  const res = await fetch(`${API_HOST}/contacts/${encodeURIComponent(contactId)}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(fields) }).catch(() => null);
  void locationId;
  return !!res && res.ok;
}

async function fixConfirm(ctx: Ctx, deps: Deps) {
  const b = await body(ctx);
  const g = await fixGate(ctx, deps, b);
  if (g.err) return g.err;
  const now = Date.now();
  const plan = await planFor(ctx, g.loc, g.kinds, now);
  const tok = String(b?.token ?? "");
  const state = checkFixToken(tok, { installationId: ctx.installationId, actor: g.me.key, locationId: g.loc, changes: plan.changes }, now);
  if (state !== "ok") return json({ error: state === "expired" ? "That preview is too old. Run it again." : "The records changed since the preview. Run it again.", stale: true }, 409);
  const live = process.env.DATA_HEALTH_WRITE_LIVE === "true";
  const out = await outward({ flag: "DATA_HEALTH_WRITE_LIVE", verb: "WRITE", what: "data_health.contacts.fix", installationId: ctx.installationId, ids: { locationId: g.loc }, fields: ["phone", "firstName", "lastName"] } as never, async () => true);
  const byContact = new Map<string, Record<string, string>>();
  for (const c of plan.changes) byContact.set(c.contactId, { ...(byContact.get(c.contactId) ?? {}), [c.field]: c.after });
  const accessToken = live ? await deps.token(ctx, g.loc) : "";
  let done = 0, failed = 0;
  for (const [contactId, fields] of byContact) {
    const ok = live && out.live ? await put(accessToken, g.loc, contactId, fields) : true;
    for (const c of plan.changes.filter((x) => x.contactId === contactId)) {
      const id = await appendFixChange({ installationId: ctx.installationId, locationId: g.loc, contactId, field: c.field, before: c.before, after: c.after, outcome: ok ? (live ? "done" : "dry_run") : "failed", actorKey: g.me.key, actorName: g.me.name, opKey: fixOpKey(tok, c) });
      if (id !== null) { if (ok) done++; else failed++; }
    }
  }
  return json({ ok: failed === 0, outcome: live ? "done" : "dry_run", done, failed, message: live ? `${done} changes saved in your CRM. You can undo them for 24 hours.` : `Rehearsal only: ${done} changes were checked and recorded, nothing was sent to your CRM.` });
}

async function fixUndo(ctx: Ctx, deps: Deps) {
  const me = actor(ctx);
  if (ctx.kind === "client" || !me.may || !feature(ctx, "data_health_fix")) return json({ error: "Only an administrator can undo fixes." }, 403);
  const b = await body(ctx);
  const loc = await oneAccount(ctx, deps, b?.locationId);
  if (!loc) return json({ error: "Not found" }, 404);
  const now = Date.now();
  const rows = (await loadFixChanges(ctx.installationId, loc)).filter((c) => !c.undoes && !c.undone && (c.outcome === "done" || c.outcome === "dry_run") && undoable(c.at, now));
  const want = typeof b?.id === "number" ? rows.filter((r) => r.id === b.id) : rows;
  if (want.length === 0) return json({ error: "Nothing to undo. Fixes can be undone for 24 hours." }, 404);
  const live = process.env.DATA_HEALTH_WRITE_LIVE === "true";
  const tokenValue = live ? await deps.token(ctx, loc) : "";
  let n = 0;
  for (const c of want) {
    const ok = live && c.outcome === "done" ? await put(tokenValue, loc, c.contactId, { [c.field]: c.before }) : true;
    if (!ok) continue;
    await appendFixChange({ installationId: ctx.installationId, locationId: loc, contactId: c.contactId, field: c.field, before: c.after, after: c.before, outcome: "undo", actorKey: me.key, actorName: me.name, opKey: `undo-${c.id}`, undoes: c.id });
    await markUndone(ctx.installationId, c.id);
    n++;
  }
  return json({ ok: true, undone: n });
}

async function fixHistory(ctx: Ctx, deps: Deps) {
  const loc = await oneAccount(ctx, deps, ctx.url.searchParams.get("loc"));
  if (!loc) return json({ error: "Not found" }, 404);
  const now = Date.now();
  const rows = await loadFixChanges(ctx.installationId, loc, 100);
  return json({ rows: rows.map((r) => ({ ...r, undoable: !r.undoes && !r.undone && (r.outcome === "done" || r.outcome === "dry_run") && undoable(r.at, now) })) });
}

// ---------------------------------------------------------------- proof page and export (the person's own record, in their hands)

async function proof(ctx: Ctx, deps: Deps) {
  const loc = await oneAccount(ctx, deps, ctx.url.searchParams.get("loc"));
  if (!loc) return json({ error: "Not found" }, 404);
  const now = Date.now();
  const [snaps, totals, outcomes, names, dup] = await Promise.all([loadSnapshots(ctx.installationId, [loc], "2000-01-01"), flagTotals(ctx.installationId, [loc]), outcomeStats(ctx.installationId, [loc], 0), accountNames(ctx.installationId, [loc]), dupExtras(ctx.installationId, loc)]);
  const since = sinceInstall(snaps, totals.found, totals.fixed);
  const last = snaps[snaps.length - 1];
  const open = (last?.components ?? []).filter((c) => c.count > 0).sort((a, b) => b.penalty - a.penalty).slice(0, 5).map((c) => ({ id: c.id, label: ruleOf(c.id)?.label ?? c.id, count: c.count }));
  return json({ account: names[0]?.name ?? "Client account", now, since, series: snaps.map((s) => ({ day: s.day, score: s.score })), outcomes, open, duplicates: dup.size, lines: proofLines({ account: names[0]?.name ?? "Client account", since, score: last?.score ?? null, outcomes, open }) });
}

async function exportAll(ctx: Ctx, deps: Deps) {
  const loc = await oneAccount(ctx, deps, ctx.url.searchParams.get("loc"));
  if (!loc) return json({ error: "Not found" }, 404);
  const [snaps, marks, rules, changes, settings] = await Promise.all([loadSnapshots(ctx.installationId, [loc], "2000-01-01"), loadMarks(ctx.installationId, [loc]), loadRules(ctx.installationId, [loc]), loadFixChanges(ctx.installationId, loc, 1000), loadSettings(ctx.installationId, loc)]);
  return json({ exportedAt: new Date().toISOString(), locationId: loc, rules: { ...settings, saved: rules }, marks, snapshots: snaps, fixes: changes }, 200);
}

export async function handleDataHealth(ctx: Ctx, deps: Deps): Promise<Response> {
  const [, a] = ctx.segments;
  const m = ctx.request.method;
  try {
    if (m === "GET" && !a) return await view(ctx, deps);
    if (m === "GET" && a === "records") return await records(ctx, deps);
    if (m === "GET" && a === "sources") return await sources(ctx, deps);
    if (m === "GET" && a === "proof") return await proof(ctx, deps);
    if (m === "GET" && a === "export") return await exportAll(ctx, deps);
    if (m === "GET" && a === "fixes") return await fixHistory(ctx, deps);
    if (m === "POST" && a === "refresh") return await refresh(ctx, deps);
    if (m === "POST" && a === "mark") return await markSave(ctx, deps);
    if (m === "PUT" && a === "rules") return await rulesSave(ctx, deps);
    if (m === "POST" && a === "preview") return await fixPreview(ctx, deps);
    if (m === "POST" && a === "confirm") return await fixConfirm(ctx, deps);
    if (m === "POST" && a === "undo") return await fixUndo(ctx, deps);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof NeedsUpdate) return json({ error: e.message }, 503);
    console.error("Data health route failed", a ?? "", e instanceof Error ? e.message : "unknown");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
void sql; void fixPhone;
export type { RuleId };
