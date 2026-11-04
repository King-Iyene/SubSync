import { clearAccountConfig, loadCompany, loadConfigs, saveConfig, schemaReady, setWriteEnabled, BUILTIN } from "../analytics/cleanup-config";
import { describeRules, FIELD_WORDS, parseRules, PRESET_WORDS, presetOf, PRESETS, WINNER_WORDS } from "../analytics/cleanup-rules";
import { forgetQueue, previewCounts } from "../analytics/dedupe-queries";
import { pageOf } from "../analytics/dedupe-review";
import { checkImport, cleanCsv, MAX_BYTES, type Existing } from "../analytics/import-check";
import { findingCsv, findingRows, forgetScans, portfolio, portfolioScore, ranked, scanAccount, trendFor } from "../analytics/quality-queries";
import { FINDING_ORDER, FINDINGS, GROUP_LABEL, PART_LABEL, scoreWord, type FindingId } from "../analytics/quality";
import { sql } from "../db";
import { isLive } from "../live-flags";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The Clean-up module's own endpoints under /api/app/cleanup/... (the one guarded catch-all route). Rules, data quality, the import check and the per-account switch for
// changing contacts. Agency and business only: a client's staff are refused by the route policy (src/lib/access.ts) before they reach this file, and every handler still
// takes the accounts from the verified session, never from the request. The older run endpoints (preview, apply, undo) stay in router.ts.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type CleanupHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>>; actor: (ctx: Ctx) => string | null };

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const cc = (v: string | null): string | null => { const d = (v ?? "").replace(/\D/g, ""); return d.length >= 1 && d.length <= 4 ? d : null; };
const isFinding = (v: string | null): v is FindingId => !!v && (FINDING_ORDER as string[]).includes(v);

/** One of the caller's own accounts, or null. A request can never name another company's account. */
async function ownAccount(ctx: Ctx, h: CleanupHelpers, wanted: string | null): Promise<{ id: string; name: string | null } | null> {
  const allowed = await h.allowed();
  if (wanted && !ID.test(wanted)) return null;
  const db = sql();
  const rows = await db`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} ${wanted ? db`and location_id = ${wanted}` : db``} order by name limit 1`;
  return rows[0] ? { id: rows[0].location_id as string, name: (rows[0].name as string | null) ?? null } : null;
}

async function rulesView(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const allowed = await h.allowed();
  const [ready, configs] = await Promise.all([schemaReady(), loadConfigs(ctx.installationId, allowed)]);
  const db = sql();
  const locs = await db`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name`;
  const q = (sp.get("aq") ?? "").trim().toLowerCase().slice(0, 60);
  const list = locs.filter((l) => !q || ((l.name as string | null) ?? "").toLowerCase().includes(q));
  const accounts = pageOf(list.map((l) => {
    const c = configs.get(l.location_id as string) ?? BUILTIN;
    return { locationId: l.location_id as string, name: (l.name as string | null) ?? "Unnamed account", preset: presetOf(c.match), source: c.source, writeEnabled: c.writeEnabled };
  }), int(sp.get("ap"), 0), 8);
  const wanted = sp.get("account");
  const company = !allowed && locs.length > 1 ? await loadCompany(ctx.installationId) : null;
  const pick = (wanted && ID.test(wanted) && locs.find((l) => l.location_id === wanted)) || locs[0] || null;
  const c = pick ? configs.get(pick.location_id as string) ?? BUILTIN : BUILTIN;
  return json({
    ready, demo: ctx.demo, multi: locs.length > 1, canCompany: !allowed && locs.length > 1, masterSwitchOn: !ctx.demo && isLive("WRITE_GHL_LIVE"),
    presets: (["strict", "balanced", "loose"] as const).map((id) => ({ id, ...PRESET_WORDS[id], rules: PRESETS[id] })), fieldWords: FIELD_WORDS, winnerWords: WINNER_WORDS,
    accounts, total: locs.length,
    company: !allowed && locs.length > 1 ? (() => { const m = company?.match ?? BUILTIN.match; return { match: m, survive: company?.survive ?? BUILTIN.survive, mergeWorkflowId: company?.mergeWorkflowId ?? null, preset: presetOf(m), saved: !!company, sentence: describeRules(m) }; })() : null,
    selected: pick ? { locationId: pick.location_id as string, name: (pick.name as string | null) ?? "Unnamed account", match: c.match, survive: c.survive, preset: presetOf(c.match), source: c.source, mergeWorkflowId: c.mergeWorkflowId, writeEnabled: c.writeEnabled, sentence: describeRules(c.match) } : null,
  });
}

/** How many groups one client would have under a setting, without saving it. Used while a person is choosing. */
async function previewRules(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const acct = await ownAccount(ctx, h, sp.get("account"));
  if (!acct) return json({ error: "Account not found" }, 404);
  const preset = sp.get("preset");
  const rules = preset === "custom"
    ? parseRules({ preset: "custom", email: sp.get("email"), phone: sp.get("phone"), name: sp.get("name"), nameAlone: sp.get("nameAlone") === "1", guards: sp.get("guards") !== "0", threshold: Number(sp.get("threshold")) })
    : parseRules({ preset });
  const [now, then] = await Promise.all([previewCounts(ctx.installationId, acct.id, (await loadConfigs(ctx.installationId, [acct.id])).get(acct.id)?.match ?? BUILTIN.match), previewCounts(ctx.installationId, acct.id, rules)]);
  return json({ locationId: acct.id, now, with: then, sentence: describeRules(rules) });
}

async function saveRules(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as { scope?: unknown; match?: unknown; survive?: unknown; mergeWorkflowId?: unknown } | null;
  const scope = typeof body?.scope === "string" ? body.scope : "";
  if (scope !== "company" && !ID.test(scope)) return json({ error: "Choose a client account" }, 400);
  const wf = body?.mergeWorkflowId === undefined ? undefined : typeof body.mergeWorkflowId === "string" && body.mergeWorkflowId.trim() ? body.mergeWorkflowId.trim() : null;
  if (typeof wf === "string" && !/^[A-Za-z0-9_-]{6,64}$/.test(wf)) return json({ error: "A workflow id is letters, numbers and dashes (6 to 64 characters). Copy it from your CRM." }, 400);
  // The account is checked first, so a forged id answers "not found" whether or not the database update has been applied.
  if (scope !== "company" && !(await ownAccount(ctx, h, scope))) return json({ error: "Account not found" }, 404);
  const r = await saveConfig(ctx.installationId, await h.allowed(), h.actor(ctx), scope, { match: body?.match, survive: body?.survive, ...(wf !== undefined ? { mergeWorkflowId: wf } : {}) });
  if (r === "unavailable") return json({ error: "Saving rules is not available yet. SubSync is finishing an update, so try again later.", unavailable: true }, 503);
  if (r === "not_found") return json({ error: "Account not found" }, 404);
  forgetQueue(ctx.installationId);
  return json({ ok: true });
}

async function clearRules(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown } | null;
  if (typeof body?.locationId !== "string" || !ID.test(body.locationId)) return json({ error: "Choose a client account" }, 400);
  if (!(await ownAccount(ctx, h, body.locationId))) return json({ error: "Account not found" }, 404);
  const r = await clearAccountConfig(ctx.installationId, await h.allowed(), h.actor(ctx), body.locationId);
  if (r === "unavailable") return json({ error: "Saving rules is not available yet. SubSync is finishing an update, so try again later.", unavailable: true }, 503);
  if (r === "not_found") return json({ error: "Account not found" }, 404);
  forgetQueue(ctx.installationId);
  return json({ ok: true });
}

async function writeSwitch(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; enabled?: unknown } | null;
  if (typeof body?.locationId !== "string" || !ID.test(body.locationId) || typeof body.enabled !== "boolean") return json({ error: "Choose a client account and on or off" }, 400);
  if (!(await ownAccount(ctx, h, body.locationId))) return json({ error: "Account not found" }, 404);
  const r = await setWriteEnabled(ctx.installationId, await h.allowed(), h.actor(ctx), body.locationId, body.enabled);
  if (r === "unavailable") return json({ error: "This switch is not available yet. SubSync is finishing an update, so try again later.", unavailable: true }, 503);
  if (r === "not_found") return json({ error: "Account not found" }, 404);
  return json({ ok: true, enabled: body.enabled, masterSwitchOn: !ctx.demo && isLive("WRITE_GHL_LIVE") });
}

// ---------------- data quality ----------------

async function qualityView(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const allowed = await h.allowed();
  const country = cc(sp.get("cc"));
  const loc = sp.get("account");
  if (loc) {
    const acct = await ownAccount(ctx, h, loc);
    if (!acct) return json({ error: "Account not found" }, 404);
    const s = await scanAccount(ctx.installationId, acct.id, country);
    const trend = await trendFor(ctx.installationId, allowed, acct.id);
    return json({
      kind: "account", locationId: acct.id, name: acct.name, contacts: s.scan.total, score: s.score ? { ...s.score, word: scoreWord(s.score.score) } : null, partLabels: PART_LABEL, trend,
      minContacts: 50, duplicates: s.dup, scannedAt: new Date(s.at).toISOString(),
      findings: FINDING_ORDER.map((id) => ({ id, label: FINDINGS[id].label, todo: FINDINGS[id].todo, group: FINDINGS[id].group, groupLabel: GROUP_LABEL[FINDINGS[id].group], fixable: FINDINGS[id].fixable, count: s.scan.counts[id] })).filter((f) => f.count > 0),
    });
  }
  const p = await portfolio(ctx.installationId, allowed);
  const total = portfolioScore(p.rows);
  const sorted = ranked(p.rows);
  const page = pageOf(sorted, int(sp.get("page"), 0), Math.min(25, Math.max(1, int(sp.get("size"), 5))));
  const trend = p.rows.length > 1 ? await trendFor(ctx.installationId, allowed, null) : await trendFor(ctx.installationId, allowed, p.rows[0]?.locationId ?? null);
  const sum = (f: (r: (typeof p.rows)[number]) => number) => p.rows.reduce((s, r) => s + f(r), 0);
  return json({
    kind: "portfolio", multi: p.rows.length > 1, portfolio: { ...total, word: total.score === null ? null : scoreWord(total.score) }, trend, pending: p.pending, scannedNow: p.scannedNow,
    totals: { contacts: sum((r) => r.contacts), duplicateGroups: sum((r) => r.duplicateGroups), problems: sum((r) => FINDING_ORDER.reduce((s, k) => s + (r.counts[k] ?? 0), 0)) },
    accounts: { ...page, rows: page.rows.map((r) => ({ locationId: r.locationId, name: r.name, score: r.score, word: r.score === null ? null : scoreWord(r.score), contacts: r.contacts, day: r.day, duplicateGroups: r.duplicateGroups, problems: FINDING_ORDER.reduce((s, k) => s + (r.counts[k] ?? 0), 0) })) },
  });
}

async function qualityList(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const finding = sp.get("finding");
  const acct = await ownAccount(ctx, h, sp.get("account"));
  if (!acct || !isFinding(finding)) return json({ error: "Account not found" }, 404);
  const links = await h.links();
  const r = await findingRows(ctx.installationId, acct.id, finding, cc(sp.get("cc")));
  return json({
    finding, label: FINDINGS[finding].label, todo: FINDINGS[finding].todo, account: acct.name, locationId: acct.id, count: r.count, cut: r.cut,
    rows: r.rows.map((x) => ({ ...x, url: links.contact(acct.id, x.id) })),
  });
}

async function qualityCsv(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const finding = sp.get("finding");
  const acct = await ownAccount(ctx, h, sp.get("account"));
  if (!acct || !isFinding(finding)) return json({ error: "Account not found" }, 404);
  const csv = await findingCsv(ctx.installationId, acct.id, finding, cc(sp.get("cc")), FINDINGS[finding].label);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="subsync-${finding}.csv"`, "Cache-Control": "no-store" } });
}

async function qualityScan(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown } | null;
  const acct = await ownAccount(ctx, h, typeof body?.locationId === "string" ? body.locationId : null);
  if (!acct) return json({ error: "Account not found" }, 404);
  forgetScans(ctx.installationId);
  const s = await scanAccount(ctx.installationId, acct.id);
  return json({ ok: true, contacts: s.scan.total, score: s.score?.score ?? null });
}

// ---------------- check before you import ----------------

async function importCheck(ctx: Ctx, h: CleanupHelpers): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; csv?: unknown } | null;
  if (typeof body?.csv !== "string" || body.csv.length === 0) return json({ error: "Paste or choose a file first" }, 400);
  if (body.csv.length > MAX_BYTES) return json({ error: "That file is too big to check here. Split it into files of 5,000 rows or fewer." }, 413);
  const acct = await ownAccount(ctx, h, typeof body.locationId === "string" ? body.locationId : null);
  if (!acct) return json({ error: "Choose a client account" }, 404);
  // The account's contacts are read for this one request, compared in memory and dropped. The file is never stored.
  const rows = await sql()`select contact_id, full_name, email, phone from cached_contacts where installation_id = ${ctx.installationId} and location_id = ${acct.id} limit 150000`;
  const existing: Existing[] = rows.map((r) => ({ id: r.contact_id as string, name: ((r.full_name as string | null) ?? "").trim(), email: r.email as string | null, phone: r.phone as string | null }));
  const check = checkImport(body.csv, existing);
  const links = await h.links();
  const out = { ...check, rows: check.rows.slice(0, 500).map((r) => ({ ...r, url: r.match ? links.contact(acct.id, r.match.id) : null })), shown: Math.min(500, check.rows.length) };
  if (!check.problem || check.rows.length > 0) {
    const db = sql();
    await db`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${h.actor(ctx)}, 'cleanup.import_check', ${db.json({ locationId: acct.id, rows: check.total } as never)})`;
  }
  return json({ ...out, accountName: acct.name, cleanCsv: check.rows.length ? cleanCsv(check) : "", existingCount: existing.length });
}

/** Handles the Clean-up v2 endpoints. Returns null for a path that is not one of them, so the older run endpoints can answer. */
export async function handleCleanupV2(ctx: Ctx, h: CleanupHelpers): Promise<Response | null> {
  const [, b, c] = ctx.segments;
  const m = ctx.request.method;
  if (m === "GET" && b === "rules" && !c) return rulesView(ctx, h);
  if (m === "GET" && b === "rules" && c === "preview") return previewRules(ctx, h);
  if (m === "GET" && b === "quality" && !c) return qualityView(ctx, h);
  if (m === "GET" && b === "quality" && c === "list") return qualityList(ctx, h);
  if (m === "GET" && b === "quality" && c === "csv") return qualityCsv(ctx, h);
  if (m === "POST" && b === "quality" && c === "scan") return qualityScan(ctx, h);
  if (m === "POST" && b === "rules" && !c) return saveRules(ctx, h);
  if (m === "POST" && b === "rules" && c === "clear") return clearRules(ctx, h);
  if (m === "POST" && b === "write" && !c) return writeSwitch(ctx, h);
  if (m === "POST" && b === "import-check" && !c) return importCheck(ctx, h);
  return null;
}
