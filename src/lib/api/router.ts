import { sql } from "../db";
import { buildDigest, onboardingChecklist, toCsv, type DerivedAccount } from "../analytics/derive";
import {
  allManualTasks, dismissAlert, domainCandidates, duplicateGroups, inbox, listAlerts, listDomainChecks, manualTasks, metricsTrend,
  dealHygiene, getSettings, pipelineCells, saveDomainCheck, searchContacts, setLocationFlags, setManualTask, staleDeals, updateSettings,
  visibleLocationIds, type Settings,
} from "../analytics/queries";
import { loadAccounts, refreshInsights } from "../analytics/service";
import { isSlackWebhook } from "../analytics/derive";
import { demoDomainReport } from "../demo/seed";
import { checkDomain, extractDomain } from "../dns/email-auth";
import { accountLimit, canUse, type Feature } from "../entitlements";
import { purgeSyncedData } from "../ghl/installations";
import { createKey, listKeys, MAX_KEYS, revokeKey } from "../mcp/store";
import { postToSlack } from "../notify";
import { enqueueFullSync, enqueueLocationSync, runSlice, syncStatus } from "../sync/engine";
import { integrationHealth } from "../analytics/health";
import {
  abandonedDeals, accountSummaries, agingBuckets, avgCycleDays, coverage, deadPipeline, forecast, pipelineSummaries, riskyDeals, stageTable,
  valueDistribution, winLossByMonth, winRate,
} from "../analytics/pipeline-intel";
import { OUTCOME_LABEL, PRESETS, parseFilters, parseOutcome } from "../analytics/call-intel";
import { callQueue, createCallList, deleteCallList, listCallLists, logOutcome, MAX_LISTS, outcomeSummary, speedToLead } from "../analytics/call-queries";
import {
  activitySummary, anomalyIndices, compareAccounts, contactGap, goalProgress, periodChange, renewalStatus, roi, segmentStats, zAnomaly,
} from "../analytics/client-intel";
import { accountHistory, clientExtras, periodFigures, saveProfile, type ClientExtra, type ProfilePatch } from "../analytics/client-queries";
import { dailyPriorities, replyAging, setupScore, worstDomainStatus, type SetupFacts } from "../analytics/comms-intel";
import { afterHours, communicationGaps } from "../analytics/comms-queries";
import { badDataSamples, contactOverview, topLeads, vips } from "../analytics/contact-queries";
import { getGoals, GOAL_METRICS, loadDeals, pipelineTrend, setGoal, type GoalMetric } from "../analytics/pipeline-queries";
import { authenticate, isResponse, json, type AuthContext } from "./auth";

// All authenticated data endpoints live behind /api/app/<path>. Each one needs a valid signed
// session, is scoped to the caller's installation, and is checked against the plan.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };

const LOCATION_ID = /^[A-Za-z0-9_-]{3,64}$/;

function deepLinks(appDomain: string) {
  const base = `https://${appDomain}/v2/location`;
  return {
    account: (loc: string) => `${base}/${loc}/dashboard`,
    contact: (loc: string, id: string) => `${base}/${loc}/contacts/detail/${id}`,
    opportunities: (loc: string) => `${base}/${loc}/opportunities/list`,
    conversation: (loc: string, id: string) => `${base}/${loc}/conversations/conversations/${id}`,
  };
}

async function accountsFor(ctx: Ctx) {
  const { settings, accounts } = await loadAccounts(ctx.installationId);
  const limit = accountLimit(ctx.plan, ctx.entitlements.enforced);
  let visible = limit === null ? accounts : accounts.filter((a) => !a.ignored).slice(0, limit);
  // A business or client view only ever sees its own account.
  if (ctx.limitTo) visible = accounts.filter((a) => a.locationId === ctx.limitTo);
  return { settings, accounts: visible, hidden: accounts.length - visible.length, links: deepLinks(settings.appDomain) };
}

// Lightweight scope for endpoints that do not need every account scored: just the settings and,
// only when the plan limits accounts, which ones are visible.
async function scope(ctx: Ctx) {
  const limit = accountLimit(ctx.plan, ctx.entitlements.enforced);
  const [settings, ids] = await Promise.all([
    getSettings(ctx.installationId),
    limit === null ? Promise.resolve(null) : visibleLocationIds(ctx.installationId, limit),
  ]);
  const allowed = ids ? new Set(ids) : null;
  const permits = (locationId: string) => (ctx.limitTo ? locationId === ctx.limitTo : allowed === null || allowed.has(locationId));
  return { settings, permits, links: deepLinks(settings.appDomain) };
}

const gate = (ctx: Ctx, feature: Feature) =>
  canUse(feature, ctx.plan, ctx.entitlements.enforced)
    ? null
    : json({ error: "This feature is part of the paid plan", feature, upgrade: true }, 402);

function slim(a: DerivedAccount, links: ReturnType<typeof deepLinks>) {
  return {
    locationId: a.locationId, name: a.name, ignored: a.ignored, owner: a.owner, url: links.account(a.locationId),
    contacts: a.contacts, new30d: a.new30d, openOpps: a.openOpps, openValue: a.openValue, staleOpps: a.staleOpps,
    revenueAtRisk: a.revenueAtRisk, unread: a.unread, unanswered: a.unanswered, calendars: a.calendars, pipelines: a.pipelines,
    emailPct: a.emailPct, phonePct: a.phonePct, tagPct: a.tagPct, activePct: a.activePct, completenessPct: a.completenessPct,
    daysInactive: a.daysInactive, lastActivityAt: a.lastActivityAt, dormant: a.dormant, score: a.score, band: a.band,
    churn: a.churn, winRate: a.winRate, expectedRevenue: a.expectedRevenue, followUpRevenueAtRisk: a.followUpRevenueAtRisk,
    leadFlowDropPct: a.leadFlowDropPct, syncError: a.syncError, contactsSyncedAt: a.contactsSyncedAt,
  };
}

// ---------------- handlers ----------------

async function overview(ctx: Ctx) {
  // Independent queries run together so the page does not wait on them one after another.
  const [{ settings, accounts, hidden, links }, alerts, sync] = await Promise.all([
    accountsFor(ctx), listAlerts(ctx.installationId, false, 500, ctx.limitTo ?? undefined), syncStatus(ctx.installationId, ctx.limitTo),
  ]);
  const live = accounts.filter((a) => !a.ignored);
  const sum = (f: (a: DerivedAccount) => number) => live.reduce((s, a) => s + f(a), 0);
  const bands = { thriving: 0, healthy: 0, watch: 0, at_risk: 0 };
  for (const a of live) bands[a.band]++;
  const attention = [...live]
    .map((a) => {
      const reasons = [
        ...a.churn.reasons,
        ...(a.unanswered > 0 ? [`${a.unanswered} conversation${a.unanswered === 1 ? "" : "s"} waiting over ${settings.slaHours}h`] : []),
        ...(a.staleOpps >= 3 ? [`${a.staleOpps} stale deals worth $${Math.round(a.revenueAtRisk).toLocaleString("en-US")}`] : []),
      ];
      return { a, reasons, rank: (a.churn.level === "high" ? 0 : a.churn.level === "medium" ? 1 : 2) * 1000 + a.score };
    })
    .filter((x) => x.reasons.length > 0)
    .sort((x, y) => x.rank - y.rank)
    .slice(0, 8)
    .map(({ a, reasons }) => ({ locationId: a.locationId, name: a.name, score: a.score, band: a.band, churn: a.churn.level, reasons, url: links.account(a.locationId) }));
  return json({
    demo: ctx.demo,
    kind: ctx.kind,
    plan: ctx.plan,
    entitlements: ctx.entitlements,
    hiddenAccounts: hidden,
    kpis: {
      accounts: live.length, ignored: accounts.length - live.length, contacts: sum((a) => a.contacts),
      openOpps: sum((a) => a.openOpps), openValue: sum((a) => a.openValue), staleValue: sum((a) => a.revenueAtRisk),
      staleOpps: sum((a) => a.staleOpps), dormant: live.filter((a) => a.dormant).length, unread: sum((a) => a.unread),
      unanswered: sum((a) => a.unanswered), expectedRevenue: sum((a) => a.expectedRevenue ?? 0),
      followUpRevenueAtRisk: sum((a) => a.followUpRevenueAtRisk ?? 0),
      avgScore: live.length ? Math.round(sum((a) => a.score) / live.length) : 0,
      openAlerts: alerts.length, criticalAlerts: alerts.filter((x) => x.severity === "critical").length,
    },
    bands,
    attention,
    sync,
  });
}

async function accounts(ctx: Ctx) {
  const { settings, accounts: list, links } = await accountsFor(ctx);
  return json({ accounts: list.map((a) => slim(a, links)), settings: { staleDays: settings.staleDays, dormantDays: settings.dormantDays, slaHours: settings.slaHours } });
}

async function onboardingOverview(ctx: Ctx) {
  const { settings, accounts: list, links } = await accountsFor(ctx);
  const [manual, domains] = await Promise.all([allManualTasks(ctx.installationId), listDomainChecks(ctx.installationId)]);
  const rows = list
    .filter((a) => !a.ignored)
    .map((a) => {
      const mine = domains.filter((d) => d.locationId === a.locationId);
      const worst = mine.find((d) => d.status === "critical") ?? mine.find((d) => d.status === "warning") ?? mine[0] ?? null;
      const { items, completionPct } = onboardingChecklist(a, {
        domainStatus: worst?.status ?? null, manual: manual.get(a.locationId) ?? {}, custom: settings.customChecklist,
      });
      return { locationId: a.locationId, name: a.name, owner: a.owner, url: links.account(a.locationId), completionPct, items };
    })
    .sort((x, y) => x.completionPct - y.completionPct);
  return json({ accounts: rows });
}

async function accountDetail(ctx: Ctx, locationId: string) {
  const { settings, accounts: list, links } = await accountsFor(ctx);
  const a = list.find((x) => x.locationId === locationId);
  if (!a) return json({ error: "Account not found" }, 404);
  const [trend, deals, manual, domains, alerts] = await Promise.all([
    metricsTrend(ctx.installationId, locationId, 60),
    staleDeals(ctx.installationId, settings.staleDays, 10, locationId),
    manualTasks(ctx.installationId, locationId),
    listDomainChecks(ctx.installationId),
    listAlerts(ctx.installationId, false, 200),
  ]);
  const mine = domains.filter((d) => d.locationId === locationId);
  const worst = mine.find((d) => d.status === "critical") ?? mine.find((d) => d.status === "warning") ?? mine[0] ?? null;
  const checklist = onboardingChecklist(a, { domainStatus: worst?.status ?? null, manual, custom: settings.customChecklist });
  const [flagRow] = ctx.kind === "agency" ? await sql()`select client_view from locations where installation_id = ${ctx.installationId} and location_id = ${locationId}` : [];
  return json({
    clientView: flagRow?.client_view === true,
    account: slim(a, links),
    breakdown: a.breakdown,
    trend,
    staleDeals: deals.map((d) => ({ ...d, url: links.opportunities(d.locationId) })),
    checklist,
    domains: mine,
    alerts: alerts.filter((x) => x.locationId === locationId),
    settings: { staleDays: settings.staleDays, dormantDays: settings.dormantDays, slaHours: settings.slaHours },
  });
}

async function search(ctx: Ctx) {
  const q = ctx.url.searchParams.get("q") ?? "";
  const loc = ctx.limitTo ?? ctx.url.searchParams.get("location");
  if (loc && !LOCATION_ID.test(loc)) return json({ error: "Bad location" }, 400);
  const [{ permits, links }, found] = await Promise.all([scope(ctx), searchContacts(ctx.installationId, q, 60, loc ?? undefined)]);
  const hits = found.filter((h) => permits(h.locationId));
  return json({ query: q, hits: hits.map((h) => ({ ...h, url: links.contact(h.locationId, h.contactId) })) });
}

async function stale(ctx: Ctx) {
  const { settings, permits, links } = await scope(ctx);
  const days = Math.min(365, Math.max(1, Number(ctx.url.searchParams.get("days")) || settings.staleDays));
  const rows = (await staleDeals(ctx.installationId, days, 500, ctx.limitTo ?? undefined)).filter((d) => permits(d.locationId));
  return json({
    days,
    totalValue: rows.reduce((s, d) => s + d.value, 0),
    deals: rows.map((d) => ({ ...d, url: links.opportunities(d.locationId) })),
  });
}

async function inboxView(ctx: Ctx) {
  const { settings, permits, links } = await scope(ctx);
  const rows = (await inbox(ctx.installationId, settings.slaHours, 300, ctx.limitTo ?? undefined)).filter((r) => permits(r.locationId));
  return json({
    slaHours: settings.slaHours,
    overSla: rows.filter((r) => r.overSla).length,
    items: rows.map((r) => ({ ...r, url: links.conversation(r.locationId, r.conversationId) })),
  });
}

async function pipelines(ctx: Ctx) {
  const { accounts: visible, links } = await accountsFor(ctx);
  const allowed = new Set(visible.map((a) => a.locationId));
  const cells = (await pipelineCells(ctx.installationId)).filter((c) => allowed.has(c.locationId));
  const stageMap = new Map<string, { pipeline: string; stage: string; order: number; count: number; value: number }>();
  const perAccount = new Map<string, { locationId: string; name: string | null; open: { count: number; value: number }; won: { count: number; value: number }; lost: { count: number; value: number } }>();
  for (const c of cells) {
    const acc = perAccount.get(c.locationId) ?? { locationId: c.locationId, name: c.locationName, open: { count: 0, value: 0 }, won: { count: 0, value: 0 }, lost: { count: 0, value: 0 } };
    const bucket = c.status === "won" ? acc.won : c.status === "lost" ? acc.lost : acc.open;
    bucket.count += c.count;
    bucket.value += c.value;
    perAccount.set(c.locationId, acc);
    if (c.status === "open") {
      const key = `${c.pipelineName}|${c.stageName}`;
      const s = stageMap.get(key) ?? { pipeline: c.pipelineName, stage: c.stageName, order: c.stageOrder, count: 0, value: 0 };
      s.count += c.count;
      s.value += c.value;
      stageMap.set(key, s);
    }
  }
  const byAccount = [...perAccount.values()].map((a) => ({
    ...a, url: links.opportunities(a.locationId),
    winRate: a.won.count + a.lost.count >= 5 ? a.won.count / (a.won.count + a.lost.count) : null,
  })).sort((x, y) => y.open.value - x.open.value);
  return json({
    stages: [...stageMap.values()].sort((x, y) => x.pipeline.localeCompare(y.pipeline) || x.order - y.order),
    accounts: byAccount,
    totals: {
      open: byAccount.reduce((s, a) => s + a.open.value, 0),
      won: byAccount.reduce((s, a) => s + a.won.value, 0),
      expected: Math.round(visible.reduce((s, a) => s + (a.expectedRevenue ?? 0), 0)),
    },
  });
}

async function duplicates(ctx: Ctx) {
  const { permits, links } = await scope(ctx);
  const groups = (await duplicateGroups(ctx.installationId, 300, ctx.limitTo ?? undefined)).filter((g) => permits(g.locationId));
  return json({
    groups: groups.map((g) => ({
      ...g, key: g.kind === "phone" ? g.key : g.key,
      contacts: g.contactIds.map((id, i) => ({ id, name: g.names[i], url: links.contact(g.locationId, id) })),
    })),
  });
}

async function emailHealth(ctx: Ctx) {
  const [allChecks, allCandidates] = await Promise.all([listDomainChecks(ctx.installationId), domainCandidates(ctx.installationId)]);
  const checks = ctx.limitTo ? allChecks.filter((c) => c.locationId === ctx.limitTo) : allChecks;
  const candidates = ctx.limitTo ? allCandidates.filter((c) => c.locationId === ctx.limitTo) : allCandidates;
  const checked = new Set(checks.map((c) => c.domain));
  const unchecked: Array<{ domain: string; locationId: string; locationName: string | null }> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const d of [extractDomain(c.email), extractDomain(c.website)]) {
      if (d && !checked.has(d) && !seen.has(d)) {
        seen.add(d);
        unchecked.push({ domain: d, locationId: c.locationId, locationName: c.locationName });
      }
    }
  }
  const names = new Map(candidates.map((c) => [c.locationId, c.locationName]));
  return json({
    checks: checks.map((c) => ({ ...c, locationName: c.locationId ? names.get(c.locationId) ?? null : null })),
    unchecked,
  });
}

async function emailCheck(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { domains?: unknown; locationId?: unknown } | null;
  const raw = Array.isArray(body?.domains) ? body.domains : [];
  const domains = [...new Set(raw.map((d) => extractDomain(typeof d === "string" ? d : null)).filter((d): d is string => d !== null))].slice(0, 15);
  if (domains.length === 0) return json({ error: "Enter a valid domain, for example example.com" }, 400);
  const locationId = typeof body?.locationId === "string" && LOCATION_ID.test(body.locationId) ? body.locationId : null;
  const results = [];
  for (const domain of domains) {
    const report = ctx.demo ? await demoDomainReport(domain) : await checkDomain(domain);
    await saveDomainCheck(ctx.installationId, locationId, domain, report.status, report);
    results.push({ domain, status: report.status });
  }
  await refreshInsights(ctx.installationId);
  return json({ checked: results });
}

async function alertsView(ctx: Ctx) {
  const includeResolved = ctx.url.searchParams.get("resolved") === "1";
  const names = new Map((await loadAccounts(ctx.installationId)).accounts.map((a) => [a.locationId, a.name]));
  const rows = await listAlerts(ctx.installationId, includeResolved, 300, ctx.limitTo ?? undefined);
  return json({ alerts: rows.map((a) => ({ ...a, locationName: a.locationId ? names.get(a.locationId) ?? null : null })) });
}

const settingsView = async (ctx: Ctx) => {
  const { settings } = await loadAccounts(ctx.installationId);
  const [counts] = ctx.kind === "agency" ? await sql()`select count(*)::int total, count(*) filter (where client_view)::int on_ from locations where installation_id = ${ctx.installationId}` : [null];
  return json({ settings: publicSettings(settings), slackConfigured: Boolean(settings.slackWebhookUrl), kind: ctx.kind, clientView: counts ? { on: counts.on_ as number, total: counts.total as number } : null });
};

function publicSettings(s: Settings) {
  // Never send the webhook URL back to the browser: it is a secret.
  return { staleDays: s.staleDays, dormantDays: s.dormantDays, slaHours: s.slaHours, appDomain: s.appDomain, digestEnabled: s.digestEnabled, customChecklist: s.customChecklist };
}

async function settingsUpdate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  const patch: Partial<Settings> = {};
  const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  if ("staleDays" in body) { const v = int(body.staleDays, 7, 365); if (v === null) return json({ error: "Stale days must be between 7 and 365" }, 400); patch.staleDays = v; }
  if ("dormantDays" in body) { const v = int(body.dormantDays, 7, 365); if (v === null) return json({ error: "Dormant days must be between 7 and 365" }, 400); patch.dormantDays = v; }
  if ("slaHours" in body) { const v = int(body.slaHours, 1, 168); if (v === null) return json({ error: "SLA hours must be between 1 and 168" }, 400); patch.slaHours = v; }
  if ("digestEnabled" in body) patch.digestEnabled = body.digestEnabled === true;
  if ("clientViewAll" in body && ctx.kind === "agency") {
    await sql()`update locations set client_view = ${body.clientViewAll === true} where installation_id = ${ctx.installationId}`;
  }
  if ("appDomain" in body) {
    const d = typeof body.appDomain === "string" ? extractDomain(body.appDomain) : null;
    if (!d) return json({ error: "Enter the domain you log in to, for example app.gohighlevel.com" }, 400);
    patch.appDomain = d;
  }
  if ("slackWebhookUrl" in body) {
    if (body.slackWebhookUrl === null || body.slackWebhookUrl === "") patch.slackWebhookUrl = null;
    else if (typeof body.slackWebhookUrl === "string" && isSlackWebhook(body.slackWebhookUrl)) patch.slackWebhookUrl = body.slackWebhookUrl;
    else return json({ error: "That is not a Slack incoming webhook URL (https://hooks.slack.com/services/...)" }, 400);
  }
  if ("customChecklist" in body) {
    const list = Array.isArray(body.customChecklist) ? body.customChecklist : null;
    if (!list || list.length > 10 || list.some((x) => typeof x !== "string" || x.trim().length === 0 || x.length > 80)) {
      return json({ error: "Up to 10 checklist items, each up to 80 characters" }, 400);
    }
    patch.customChecklist = [...new Set(list.map((x: string) => x.trim()))];
  }
  await updateSettings(ctx.installationId, patch);
  await refreshInsights(ctx.installationId);
  return settingsView(ctx);
}

async function flags(ctx: Ctx, locationId: string) {
  const body = (await ctx.request.json().catch(() => null)) as { ignored?: unknown; owner?: unknown; clientView?: unknown } | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  const patch: { ignored?: boolean; owner?: string | null; clientView?: boolean } = {};
  if ("ignored" in body) patch.ignored = body.ignored === true;
  if ("clientView" in body) patch.clientView = body.clientView === true;
  if ("owner" in body) {
    if (body.owner === null || body.owner === "") patch.owner = null;
    else if (typeof body.owner === "string" && body.owner.length <= 60) patch.owner = body.owner.trim();
    else return json({ error: "Owner must be up to 60 characters" }, 400);
  }
  if (!(await setLocationFlags(ctx.installationId, locationId, patch))) return json({ error: "Account not found" }, 404);
  await refreshInsights(ctx.installationId);
  return json({ ok: true });
}

async function taskUpdate(ctx: Ctx, locationId: string) {
  const body = (await ctx.request.json().catch(() => null)) as { task?: unknown; done?: unknown } | null;
  const task = typeof body?.task === "string" ? body.task : "";
  if (!/^(manual|custom):.{1,80}$/.test(task)) return json({ error: "Invalid task" }, 400);
  if (ctx.limitTo && ctx.limitTo !== locationId) return json({ error: "Account not found" }, 404);
  await setManualTask(ctx.installationId, locationId, task, body?.done === true);
  return json({ ok: true });
}

async function exportCsv(ctx: Ctx, kind: string) {
  const { settings, permits } = await scope(ctx);
  const file = (name: string, csv: string) =>
    new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  switch (kind) {
    case "accounts": {
      const { accounts: visible } = await accountsFor(ctx);
      return file("subsync-accounts", toCsv(visible, [
        { label: "Account", value: (a) => a.name }, { label: "Owner", value: (a) => a.owner }, { label: "Score", value: (a) => a.score },
        { label: "Health band", value: (a) => a.band }, { label: "Churn risk", value: (a) => a.churn.level },
        { label: "Days inactive", value: (a) => a.daysInactive }, { label: "Dormant", value: (a) => (a.dormant ? "yes" : "no") },
        { label: "Contacts", value: (a) => a.contacts }, { label: "New contacts (30d)", value: (a) => a.new30d },
        { label: "Data completeness %", value: (a) => a.completenessPct }, { label: "Open deals", value: (a) => a.openOpps },
        { label: "Open deal value", value: (a) => Math.round(a.openValue) }, { label: "Stale deals", value: (a) => a.staleOpps },
        { label: "Stale deal value", value: (a) => a.revenueAtRisk }, { label: "Unanswered conversations", value: (a) => a.unanswered },
        { label: "Win rate %", value: (a) => (a.winRate === null ? "" : Math.round(a.winRate * 100)) },
      ]));
    }
    case "stale": {
      const rows = (await staleDeals(ctx.installationId, settings.staleDays, 5000, ctx.limitTo ?? undefined)).filter((d) => permits(d.locationId));
      return file("subsync-stale-deals", toCsv(rows, [
        { label: "Account", value: (d) => d.locationName }, { label: "Deal", value: (d) => d.name }, { label: "Contact", value: (d) => d.contactName },
        { label: "Value", value: (d) => d.value }, { label: "Pipeline", value: (d) => d.pipelineName }, { label: "Stage", value: (d) => d.stageName },
        { label: "Days stale", value: (d) => d.daysStale }, { label: "Last activity", value: (d) => d.lastActivityAt },
      ]));
    }
    case "duplicates": {
      const rows = (await duplicateGroups(ctx.installationId, 5000, ctx.limitTo ?? undefined)).filter((g) => permits(g.locationId));
      return file("subsync-duplicates", toCsv(rows, [
        { label: "Account", value: (g) => g.locationName }, { label: "Matched on", value: (g) => g.kind }, { label: "Value", value: (g) => g.key },
        { label: "Contacts", value: (g) => g.count }, { label: "Names", value: (g) => g.names.join("; ") }, { label: "Contact ids", value: (g) => g.contactIds.join("; ") },
      ]));
    }
    case "inbox": {
      const rows = (await inbox(ctx.installationId, settings.slaHours, 2000, ctx.limitTo ?? undefined)).filter((r) => permits(r.locationId));
      return file("subsync-inbox", toCsv(rows, [
        { label: "Account", value: (r) => r.locationName }, { label: "Contact", value: (r) => r.contactName }, { label: "Channel", value: (r) => r.lastMessageType },
        { label: "Last message", value: (r) => r.lastMessageAt }, { label: "Direction", value: (r) => r.lastMessageDirection },
        { label: "Unread", value: (r) => r.unreadCount }, { label: "Over SLA", value: (r) => (r.overSla ? "yes" : "no") }, { label: "Waiting hours", value: (r) => r.waitingHours },
      ]));
    }
    case "deals": {
      const deals = await loadDeals(ctx.installationId, await allowedIds(ctx));
      const risky = riskyDeals(deals, Date.now(), 100000);
      return file("subsync-open-deals", toCsv(risky, [
        { label: "Account", value: (d) => d.locationName }, { label: "Pipeline", value: (d) => d.pipelineName }, { label: "Stage", value: (d) => d.stageName },
        { label: "Deal", value: (d) => d.name }, { label: "Contact", value: (d) => d.contactName }, { label: "Value", value: (d) => d.value },
        { label: "Created", value: (d) => (d.createdAt ? new Date(d.createdAt).toISOString() : "") },
        { label: "Risk score", value: (d) => d.score }, { label: "Why", value: (d) => d.reasons.join("; ") },
      ]));
    }
    case "clients": {
      const now = Date.now();
      const allowed = await allowedIds(ctx);
      const [{ accounts, links }, extras, domainOf] = await Promise.all([accountsFor(ctx), clientExtras(ctx.installationId, allowed), domainStatusByAccount(ctx.installationId)]);
      const rows = accounts.filter((a) => !a.ignored).map((a) => clientRow(a, extras.get(a.locationId), null, links, now, domainOf(a.locationId)));
      return file("subsync-clients", toCsv(rows, [
        { label: "Client", value: (c) => c.name }, { label: "Health", value: (c) => c.band }, { label: "Score", value: (c) => c.score }, { label: "Churn risk", value: (c) => c.churn },
        { label: "Monthly fee", value: (c) => c.profile.monthlyFee }, { label: "Renewal date", value: (c) => c.profile.renewalDate },
        { label: "Days to renewal", value: (c) => c.renewal?.daysLeft ?? "" }, { label: "Last spoken", value: (c) => c.profile.lastContactedAt },
        { label: "Pipeline value created (30d)", value: (c) => c.roi?.pipelineMultiple ?? "" }, { label: "Setup score", value: (c) => c.setup.score },
        { label: "Industry", value: (c) => c.profile.industry }, { label: "Open pipeline", value: (c) => Math.round(c.openValue) },
      ]));
    }
    case "alerts": {
      const rows = await listAlerts(ctx.installationId, false, 2000, ctx.limitTo ?? undefined);
      return file("subsync-alerts", toCsv(rows, [
        { label: "Severity", value: (a) => a.severity }, { label: "Alert", value: (a) => a.title }, { label: "Type", value: (a) => a.kind }, { label: "Raised", value: (a) => a.createdAt },
      ]));
    }
    default:
      return json({ error: "Unknown export" }, 404);
  }
}

async function hygiene(ctx: Ctx) {
  const { permits } = await scope(ctx);
  const rows = (await dealHygiene(ctx.installationId)).filter((r) => permits(r.locationId));
  return json({
    accounts: rows,
    totals: {
      open: rows.reduce((s, r) => s + r.open, 0), noValue: rows.reduce((s, r) => s + r.noValue, 0),
      noContact: rows.reduce((s, r) => s + r.noContact, 0), ancient: rows.reduce((s, r) => s + r.ancient, 0),
    },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function keysList(ctx: Ctx) {
  return json({ keys: await listKeys(ctx.installationId), max: MAX_KEYS, endpoint: `${ctx.url.origin}/api/mcp` });
}

async function keysCreate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 60) return json({ error: "Give the key a name of up to 60 characters" }, 400);
  const created = await createKey(ctx.installationId, name);
  if (created === "limit") return json({ error: `You can have up to ${MAX_KEYS} active keys. Revoke one first.` }, 400);
  // The key is returned this one time only; we keep just a hash.
  return json({ key: created.key, row: created.row });
}

async function keysRevoke(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return json({ error: "Key not found" }, 404);
  return (await revokeKey(ctx.installationId, id)) ? json({ ok: true }) : json({ error: "Key not found" }, 404);
}

async function purgeData(ctx: Ctx) {
  if (ctx.demo) return json({ error: "Demo data cannot be deleted" }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm' }, 400);
  await purgeSyncedData(ctx.installationId);
  return json({ ok: true });
}

async function syncStart(ctx: Ctx) {
  if (ctx.demo) {
    await refreshInsights(ctx.installationId);
    return json({ ok: true, demo: true });
  }
  await enqueueFullSync(ctx.installationId);
  // Do a short slice now so the first results appear quickly; cron continues the rest.
  const slice = await runSlice(20_000);
  return json({ ok: true, ...slice, status: await syncStatus(ctx.installationId) });
}

async function allowedIds(ctx: Ctx): Promise<string[] | null> {
  if (ctx.limitTo) return [ctx.limitTo];
  const limit = accountLimit(ctx.plan, ctx.entitlements.enforced);
  return limit === null ? null : visibleLocationIds(ctx.installationId, limit);
}

async function pipelineIntel(ctx: Ctx) {
  const location = ctx.url.searchParams.get("location") ?? undefined;
  if (location && !LOCATION_ID.test(location)) return json({ error: "Invalid account" }, 400);
  const [allowed, goals] = await Promise.all([allowedIds(ctx), ctx.kind === "client" ? Promise.resolve({} as Awaited<ReturnType<typeof getGoals>>) : getGoals(ctx.installationId)]);
  const [deals, trend, sc] = await Promise.all([loadDeals(ctx.installationId, allowed, location), pipelineTrend(ctx.installationId, allowed), scope(ctx)]);
  const now = Date.now();
  const opens = deals.filter((d) => d.status === "open");
  const openValue = opens.reduce((s, d) => s + d.value, 0);
  const link = (d: { locationId: string }) => sc.links.opportunities(d.locationId);
  const risky = riskyDeals(deals, now, 20).map((d) => ({ ...d, url: link(d) }));
  const aband = abandonedDeals(deals, now);
  const dead = deadPipeline(deals, now);
  return json({
    totals: { open: opens.length, openValue, won: deals.filter((d) => d.status === "won").length, lost: deals.filter((d) => d.status === "lost").length, winRate: winRate(deals), avgCycleDays: avgCycleDays(deals) },
    forecast: forecast(deals, now),
    coverage: coverage(openValue, goals.monthly_revenue ?? null),
    stages: stageTable(deals, now),
    aging: agingBuckets(deals, now),
    distribution: valueDistribution(deals),
    winLoss: winLossByMonth(deals, now),
    risky,
    abandoned: { total: aband.total, value: aband.value, deals: aband.deals.slice(0, 15).map((d) => ({ ...d, url: link(d) })) },
    dead: { total: dead.total, rows: dead.rows.slice(0, 15).map((row) => ({ ...row.deal, reasons: row.reasons, url: link(row.deal) })) },
    accounts: location ? [] : accountSummaries(deals, now),
    pipelines: pipelineSummaries(deals).slice(0, 40),
    trend,
    goals,
  });
}

async function contactIntel(ctx: Ctx) {
  const allowed = await allowedIds(ctx);
  const [overview, leads, vipList, samples, sc] = await Promise.all([
    contactOverview(ctx.installationId, allowed), topLeads(ctx.installationId, allowed), vips(ctx.installationId, allowed),
    badDataSamples(ctx.installationId, allowed), scope(ctx),
  ]);
  const link = (c: { locationId: string; contactId: string }) => sc.links.contact(c.locationId, c.contactId);
  return json({
    ...overview,
    topLeads: leads.map((c) => ({ ...c, url: link(c) })),
    vips: vipList.map((c) => ({ ...c, url: link(c) })),
    badData: samples.map((c) => ({ ...c, url: link(c) })),
  });
}

async function callQueueView(ctx: Ctx) {
  const params = Object.fromEntries(ctx.url.searchParams.entries());
  const parsed = parseFilters(params);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const allowed = await allowedIds(ctx);
  const [queue, speed, summary, sc] = await Promise.all([
    callQueue(ctx.installationId, allowed, parsed.filters), speedToLead(ctx.installationId, allowed), outcomeSummary(ctx.installationId), scope(ctx),
  ]);
  return json({
    presets: PRESETS, filters: parsed.filters, outcomes: OUTCOME_LABEL, total: queue.total, speedToLead: speed, summary,
    rows: queue.rows.map((row) => ({ ...row, url: sc.links.contact(row.locationId, row.contactId) })),
  });
}

async function callListsView(ctx: Ctx) {
  return json({ lists: await listCallLists(ctx.installationId), max: MAX_LISTS });
}

async function callListCreate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { name?: unknown; filters?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 60) return json({ error: "Give the list a name (up to 60 characters)" }, 400);
  const parsed = parseFilters(body?.filters);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const made = await createCallList(ctx.installationId, name, parsed.filters);
  if (made === "too_many") return json({ error: `You can save up to ${MAX_LISTS} lists. Delete one first.` }, 400);
  return json({ ok: true, id: made.id });
}

async function callListDelete(ctx: Ctx, id: string) {
  return (await deleteCallList(ctx.installationId, id)) ? json({ ok: true }) : json({ error: "List not found" }, 404);
}

async function callOutcomeCreate(ctx: Ctx) {
  const parsed = parseOutcome(await ctx.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const ok = await logOutcome(ctx.installationId, await allowedIds(ctx), parsed.value);
  return ok ? json({ ok: true }) : json({ error: "Contact not found" }, 404);
}

async function callOutcomesView(ctx: Ctx) {
  const raw = ctx.url.searchParams.get("since");
  let since: Date | undefined;
  if (raw) {
    since = new Date(raw);
    if (Number.isNaN(since.getTime()) || Date.now() - since.getTime() > 86_400_000 || since.getTime() > Date.now() + 60_000) return json({ error: "Invalid start time" }, 400);
  }
  return json(await outcomeSummary(ctx.installationId, since));
}

const GOAL_LABEL: Record<string, string> = { monthly_revenue: "Revenue won this month", monthly_leads: "New contacts this month", monthly_deals_won: "Deals won this month" };

async function domainStatusByAccount(installationId: string) {
  const by = new Map<string, string[]>();
  for (const d of await listDomainChecks(installationId)) if (d.locationId) by.set(d.locationId, [...(by.get(d.locationId) ?? []), d.status]);
  return (id: string) => worstDomainStatus(by.get(id) ?? []);
}

function clientRow(a: DerivedAccount, e: ClientExtra | undefined, avgCycle: number | null, links: ReturnType<typeof deepLinks>, now: number, emailAuth: SetupFacts["emailAuth"] = "unchecked") {
  const fee = e?.monthlyFee ?? null;
  const installed = e?.installedAt ?? null;
  const daysIn = installed === null ? null : Math.floor((now - installed) / 86_400_000);
  const hasWon = (e?.firstWonAt ?? null) !== null;
  return {
    locationId: a.locationId, name: a.name, url: links.account(a.locationId), score: a.score, band: a.band, churn: a.churn.level, dormant: a.dormant,
    new30d: a.new30d, openValue: a.openValue, unanswered: a.unanswered, completenessPct: a.completenessPct, winRate: a.winRate, avgCycleDays: avgCycle,
    profile: { monthlyFee: fee, renewalDate: e?.renewalDate ?? null, industry: e?.industry ?? null, notes: e?.notes ?? null, lastContactedAt: e?.lastContactedAt ? new Date(e.lastContactedAt).toISOString() : null },
    roi: roi({ monthlyFee: fee, pipelineCreated30d: e?.pipelineCreated30d ?? 0, wonValue30d: e?.wonValue30d ?? 0 }),
    renewal: renewalStatus(e?.renewalDate ?? null, now),
    contactGap: contactGap(e?.lastContactedAt ?? null, now),
    progress: {
      daysSinceInstall: daysIn, firstLeadAt: e?.firstLeadAt ? new Date(e.firstLeadAt).toISOString() : null, firstWonAt: e?.firstWonAt ? new Date(e.firstWonAt).toISOString() : null,
      // 6.7: a client well past setup with no won deal needs a conversation.
      needsIntervention: daysIn !== null && daysIn >= 30 && !hasWon,
    },
    setup: setupScore({ pipelines: a.pipelines, calendars: a.calendars, contacts: a.contacts, completenessPct: a.completenessPct, emailAuth, daysInactive: a.daysInactive }),
    activity: activitySummary({ name: a.name ?? "this account", newContacts: e?.newContacts30d ?? a.new30d, dealsWon: e?.wonCount30d ?? 0, wonValue: e?.wonValue30d ?? 0, pipelineCreated: e?.pipelineCreated30d ?? 0, days: 30 }),
  };
}

async function clientsView(ctx: Ctx) {
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const [{ accounts, links }, extras, deals, domainOf] = await Promise.all([accountsFor(ctx), clientExtras(ctx.installationId, allowed), loadDeals(ctx.installationId, allowed), domainStatusByAccount(ctx.installationId)]);
  const cycles = new Map(accountSummaries(deals, now).map((s) => [s.locationId, s.avgCycleDays]));
  const rows = accounts.filter((a) => !a.ignored).map((a) => clientRow(a, extras.get(a.locationId), cycles.get(a.locationId) ?? null, links, now, domainOf(a.locationId)));
  const withFee = rows.filter((x) => x.profile.monthlyFee !== null);
  const atRisk = (x: (typeof rows)[number]) => x.band === "at_risk" || x.churn === "high" || x.dormant;
  return json({
    clients: rows.sort((a, b) => a.score - b.score),
    revenue: {
      monthly: withFee.reduce((s, x) => s + (x.profile.monthlyFee ?? 0), 0),
      atRisk: withFee.filter(atRisk).reduce((s, x) => s + (x.profile.monthlyFee ?? 0), 0),
      clientsWithFee: withFee.length,
    },
    renewals: rows.filter((x) => x.renewal && x.renewal.bucket !== "later").sort((a, b) => (a.renewal?.daysLeft ?? 0) - (b.renewal?.daysLeft ?? 0))
      .map((x) => ({ locationId: x.locationId, name: x.name, daysLeft: x.renewal?.daysLeft ?? 0, bucket: x.renewal?.bucket ?? "later", fee: x.profile.monthlyFee })),
    segments: segmentStats(rows.map((x) => ({ industry: x.profile.industry, score: x.score, winRate: x.winRate, openValue: x.openValue }))),
    compare: rows.map((x) => ({ locationId: x.locationId, name: x.name ?? "Unnamed account", new30d: x.new30d, winRate: x.winRate, avgCycleDays: x.avgCycleDays, unanswered: x.unanswered, completenessPct: x.completenessPct, score: x.score, openValue: x.openValue })),
  });
}

async function clientsCompare(ctx: Ctx) {
  const a = ctx.url.searchParams.get("a") ?? "";
  const b = ctx.url.searchParams.get("b") ?? "";
  if (!LOCATION_ID.test(a) || !LOCATION_ID.test(b) || a === b) return json({ error: "Pick two different accounts" }, 400);
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const [{ accounts }, deals] = await Promise.all([accountsFor(ctx), loadDeals(ctx.installationId, allowed)]);
  const cycles = new Map(accountSummaries(deals, now).map((s) => [s.locationId, s.avgCycleDays]));
  const facts = (id: string) => {
    const x = accounts.find((acc) => acc.locationId === id && !acc.ignored);
    return x ? { name: x.name ?? "Unnamed account", new30d: x.new30d, winRate: x.winRate, avgCycleDays: cycles.get(id) ?? null, unanswered: x.unanswered, completenessPct: x.completenessPct, score: x.score, openValue: x.openValue } : null;
  };
  const fa = facts(a);
  const fb = facts(b);
  if (!fa || !fb) return json({ error: "Account not found" }, 404);
  return json({ a: fa, b: fb, notes: compareAccounts(fa, fb) });
}

async function clientUpdate(ctx: Ctx, locationId: string) {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Send a JSON body" }, 400);
  const patch: ProfilePatch = {};
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if ("monthlyFee" in body) {
    if (blank(body.monthlyFee)) patch.monthlyFee = null;
    else {
      const n = Number(body.monthlyFee);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return json({ error: "Enter a monthly fee between 0 and 10,000,000" }, 400);
      patch.monthlyFee = n;
    }
  }
  if ("renewalDate" in body) {
    if (blank(body.renewalDate)) patch.renewalDate = null;
    else if (typeof body.renewalDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.renewalDate) || Number.isNaN(Date.parse(body.renewalDate + "T00:00:00Z"))) return json({ error: "Use a date like 2027-03-31" }, 400);
    else patch.renewalDate = body.renewalDate;
  }
  if ("industry" in body) {
    if (blank(body.industry)) patch.industry = null;
    else if (typeof body.industry !== "string" || body.industry.length > 60) return json({ error: "Industry is too long (60 characters)" }, 400);
    else patch.industry = body.industry.trim();
  }
  if ("notes" in body) {
    if (blank(body.notes)) patch.notes = null;
    else if (typeof body.notes !== "string" || body.notes.length > 2000) return json({ error: "Notes are too long (2000 characters)" }, 400);
    else patch.notes = body.notes;
  }
  if (body.markContacted === true) patch.markContacted = true;
  if (Object.keys(patch).length === 0) return json({ error: "Nothing to save" }, 400);
  const ok = await saveProfile(ctx.installationId, await allowedIds(ctx), locationId, patch);
  return ok ? json({ ok: true }) : json({ error: "Account not found" }, 404);
}

async function qbrView(ctx: Ctx, locationId: string) {
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const [{ accounts, links }, extras, deals, history, domainOf] = await Promise.all([
    accountsFor(ctx), clientExtras(ctx.installationId, allowed), loadDeals(ctx.installationId, allowed, locationId), accountHistory(ctx.installationId, locationId), domainStatusByAccount(ctx.installationId),
  ]);
  const a = accounts.find((x) => x.locationId === locationId && !x.ignored);
  if (!a) return json({ error: "Account not found" }, 404);
  const avgCycle = accountSummaries(deals, now)[0]?.avgCycleDays ?? null;
  const open = (await listAlerts(ctx.installationId, false, 500)).filter((al) => al.locationId === locationId);
  return json({ client: clientRow(a, extras.get(locationId), avgCycle, links, now, domainOf(locationId)), history, openAlerts: open.length, generatedAt: new Date(now).toISOString() });
}

async function execSummary(ctx: Ctx) {
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const [f, goals] = await Promise.all([periodFigures(ctx.installationId, allowed), getGoals(ctx.installationId)]);
  const pct = (cur: number, prev: number | null) => (prev === null ? null : periodChange(cur, prev).pct);
  const kpis = [
    { key: "contacts", label: "New contacts, 30 days", current: f.contacts.cur, previous: f.contacts.prev, pct: pct(f.contacts.cur, f.contacts.prev), money: false },
    { key: "won", label: "Deals won, 30 days", current: f.won.curCount, previous: f.won.prevCount, pct: pct(f.won.curCount, f.won.prevCount), money: false },
    { key: "revenue", label: "Revenue won, 30 days", current: f.won.curValue, previous: f.won.prevValue, pct: pct(f.won.curValue, f.won.prevValue), money: true },
    { key: "pipeline", label: "Open pipeline", current: f.pipeline.now, previous: f.pipeline.then, pct: pct(f.pipeline.now, f.pipeline.then), money: true },
    { key: "score", label: "Average engagement score", current: f.score.now, previous: f.score.then, pct: pct(f.score.now, f.score.then), money: false },
  ];
  const actual = { monthly_revenue: f.month.revenue, monthly_leads: f.month.leads, monthly_deals_won: f.month.deals } as Record<string, number>;
  const goalRows = GOAL_METRICS.filter((m) => goals[m]).map((m) => ({ metric: m, label: GOAL_LABEL[m], ...goalProgress(goals[m] as number, actual[m], now) }));
  const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const series = [
    { key: "newContacts", label: "New contacts (30 day total)", values: f.series.map((s) => s.newContacts), fmt: (n: number) => String(Math.round(n)) },
    { key: "openValue", label: "Open pipeline", values: f.series.map((s) => s.openValue), fmt: money },
    { key: "score", label: "Average engagement score", values: f.series.map((s) => s.score), fmt: (n: number) => String(Math.round(n)) },
  ];
  const anomalies = series.flatMap((s) => {
    const z = zAnomaly(s.values);
    return z ? [{ key: s.key, label: s.label, direction: z.direction, latest: s.fmt(z.latest), average: s.fmt(z.mean), message: s.label + " today (" + s.fmt(z.latest) + ") is unusually " + z.direction + " its 90 day average (" + s.fmt(z.mean) + ")." }] : [];
  });
  return json({
    kpis, goals: goalRows, anomalies, targets: goals,
    trend: { days: f.series.map((s) => s.day), openValue: f.series.map((s) => s.openValue), openValueAnomalies: anomalyIndices(f.series.map((s) => s.openValue)) },
  });
}

async function commsIntel(ctx: Ctx) {
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const [rows, gaps, after] = await Promise.all([inbox(ctx.installationId, sc.settings.slaHours, 2000), communicationGaps(ctx.installationId, allowed), afterHours(ctx.installationId, allowed)]);
  const waiting = rows.filter((x) => sc.permits(x.locationId) && x.lastMessageDirection === "inbound" && x.waitingHours !== null).map((x) => x.waitingHours as number);
  return json({
    aging: replyAging(waiting),
    gaps: { ...gaps, deals: gaps.deals.map((d) => ({ ...d, url: sc.links.opportunities(d.locationId) })) },
    afterHours: after,
  });
}

async function dailyBrief(ctx: Ctx) {
  const now = Date.now();
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const [{ accounts }, speed, deals, vipList, extras, rows] = await Promise.all([
    accountsFor(ctx), speedToLead(ctx.installationId, allowed), loadDeals(ctx.installationId, allowed), vips(ctx.installationId, allowed),
    clientExtras(ctx.installationId, allowed), inbox(ctx.installationId, sc.settings.slaHours, 300),
  ]);
  const live = accounts.filter((a) => !a.ignored);
  const late = rows.filter((x) => sc.permits(x.locationId) && x.overSla);
  const top = riskyDeals(deals, now, 1)[0];
  const trouble = live.filter((a) => a.band === "at_risk" || a.churn.level === "high" || a.dormant).length;
  const renewals = [...extras.values()].filter((e) => { const s = renewalStatus(e.renewalDate, now); return s !== null && s.daysLeft <= 30; }).length;
  const priorities = dailyPriorities({
    newLeadsLastHour: speed.last60, overSla: late.length, oldestWaitingHours: late.reduce((m, x) => Math.max(m, x.waitingHours ?? 0), 0) || null,
    topDeal: top && top.score >= 60 && top.value > 0 ? { name: top.name ?? top.contactName ?? "A deal", account: top.locationName, value: top.value, score: top.score, reason: top.reasons[0] ?? "It needs attention" } : null,
    vipsNeedingContact: vipList.filter((v) => v.needsContact).length, atRiskAccounts: trouble, dormantAccounts: 0, renewalsWithin30: renewals,
    staleValue: live.reduce((s, a) => s + a.revenueAtRisk, 0), staleDeals: live.reduce((s, a) => s + a.staleOpps, 0),
  });
  return json({ priorities });
}

async function goalsView(ctx: Ctx) {
  return json({ goals: await getGoals(ctx.installationId) });
}

async function goalsUpdate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { metric?: unknown; target?: unknown } | null;
  if (!body || typeof body.metric !== "string" || !(GOAL_METRICS as readonly string[]).includes(body.metric)) return json({ error: "Unknown goal" }, 400);
  if (body.target === null) {
    await setGoal(ctx.installationId, body.metric as GoalMetric, null);
    return json({ ok: true });
  }
  const target = Number(body.target);
  if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000) return json({ error: "Enter a positive number" }, 400);
  await setGoal(ctx.installationId, body.metric as GoalMetric, target);
  return json({ ok: true });
}

async function healthView(ctx: Ctx) {
  return json(await integrationHealth(ctx.installationId, ctx.demo));
}

async function resyncOne(ctx: Ctx, locationId: string) {
  if (ctx.demo) return json({ ok: true, demo: true });
  if (ctx.limitTo && ctx.limitTo !== locationId) return json({ error: "Account not found" }, 404);
  const known = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${locationId}`;
  if (known.length === 0) return json({ error: "Account not found" }, 404);
  await enqueueLocationSync(ctx.installationId, locationId);
  const slice = await runSlice(15_000);
  return json({ ok: true, ...slice });
}

async function testSlack(ctx: Ctx) {
  const { settings } = await loadAccounts(ctx.installationId);
  if (!settings.slackWebhookUrl) return json({ error: "Add a Slack webhook URL first" }, 400);
  const ok = await postToSlack(settings.slackWebhookUrl, ":white_check_mark: SubSync is connected to this channel.");
  return ok ? json({ ok: true }) : json({ error: "Slack did not accept the message. Check the webhook URL." }, 502);
}

async function digestPreview(ctx: Ctx) {
  const { accounts: list } = await accountsFor(ctx);
  const open = await listAlerts(ctx.installationId, false, 500);
  return json({ text: buildDigest(ctx.demo ? "Demo Agency" : "your agency", list, open.length) });
}

// ---------------- routing ----------------

const FEATURE_FOR: Record<string, Feature> = {
  search: "search", onboarding: "onboarding", stale: "stale", inbox: "inbox", pipelines: "pipelines", duplicates: "duplicates", email: "email",
  alerts: "alerts", settings: "settings", export: "exports", digest: "reports", "api-keys": "ai", hygiene: "stale", "pipeline-intel": "pipelines", "contact-intel": "activity", clients: "reports", qbr: "reports", "comms-intel": "inbox", "call-queue": "calls", "call-lists": "calls", "call-outcomes": "calls",
};

export async function handle(request: Request, segments: string[]): Promise<Response> {
  const auth = await authenticate(request, segments);
  if (isResponse(auth)) return auth;
  const ctx: Ctx = { ...auth, request, url: new URL(request.url), segments };
  const [a, b, c] = segments;
  const method = request.method;

  const blocked = FEATURE_FOR[a] ? gate(ctx, FEATURE_FOR[a]) : null;
  if (blocked) return blocked;

  try {
    if (method === "GET") {
      if (a === "overview") return await overview(ctx);
      if (a === "accounts" && !b) return await accounts(ctx);
      if (a === "onboarding") return await onboardingOverview(ctx);
      if (a === "accounts" && b && LOCATION_ID.test(b) && !c) return await accountDetail(ctx, b);
      if (a === "search") return await search(ctx);
      if (a === "stale") return await stale(ctx);
      if (a === "hygiene") return await hygiene(ctx);
      if (a === "api-keys") return await keysList(ctx);
      if (a === "inbox") return await inboxView(ctx);
      if (a === "pipelines") return await pipelines(ctx);
      if (a === "duplicates") return await duplicates(ctx);
      if (a === "email" && !b) return await emailHealth(ctx);
      if (a === "alerts") return await alertsView(ctx);
      if (a === "settings") return await settingsView(ctx);
      if (a === "export" && b) return await exportCsv(ctx, b);
      if (a === "sync") return json(await syncStatus(ctx.installationId));
      if (a === "health") return await healthView(ctx);
      if (a === "pipeline-intel") return await pipelineIntel(ctx);
      if (a === "contact-intel") return await contactIntel(ctx);
      if (a === "call-queue") return await callQueueView(ctx);
      if (a === "call-lists") return await callListsView(ctx);
      if (a === "call-outcomes") return await callOutcomesView(ctx);
      if (a === "goals") return await goalsView(ctx);
      if (a === "exec-summary") return await execSummary(ctx);
      if (a === "daily-brief") return await dailyBrief(ctx);
      if (a === "comms-intel") return await commsIntel(ctx);
      if (a === "clients" && !b) return await clientsView(ctx);
      if (a === "clients" && b === "compare") return await clientsCompare(ctx);
      if (a === "qbr" && b && LOCATION_ID.test(b)) return await qbrView(ctx, b);
      if (a === "digest") return await digestPreview(ctx);
    }
    if (method === "POST") {
      if (a === "email" && b === "check") return await emailCheck(ctx);
      if (a === "alerts" && b && c === "dismiss") {
        await dismissAlert(ctx.installationId, b);
        return json({ ok: true });
      }
      if (a === "sync" && b && LOCATION_ID.test(b)) return await resyncOne(ctx, b);
      if (a === "sync" && !b) return await syncStart(ctx);
      if (a === "call-lists" && !b) return await callListCreate(ctx);
      if (a === "call-outcomes" && !b) return await callOutcomeCreate(ctx);
      if (a === "settings" && b === "test-slack") return await testSlack(ctx);
      if (a === "settings" && b === "purge") return await purgeData(ctx);
      if (a === "api-keys" && !b) return await keysCreate(ctx);
      if (a === "api-keys" && b && c === "revoke") return await keysRevoke(ctx, b);
    }
    if (method === "DELETE") {
      if (a === "call-lists" && b && /^[0-9a-fA-F-]{36}$/.test(b)) return await callListDelete(ctx, b);
    }
    if (method === "PUT") {
      if (a === "settings") return await settingsUpdate(ctx);
      if (a === "goals") return await goalsUpdate(ctx);
      if (a === "clients" && b && LOCATION_ID.test(b)) return await clientUpdate(ctx, b);
      if (a === "accounts" && b && LOCATION_ID.test(b) && c === "flags") return await flags(ctx, b);
      if (a === "accounts" && b && LOCATION_ID.test(b) && c === "tasks") return await taskUpdate(ctx, b);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("API error", { path: segments.join("/"), message: error instanceof Error ? error.message : "unknown" });
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
