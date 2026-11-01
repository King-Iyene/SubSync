import { sql } from "../db";
import { safeError } from "../safe-log";
import { buildDigest, onboardingChecklist, toCsv, type DerivedAccount } from "../analytics/derive";
import {
  allManualTasks, conversationCoverage, dismissAlert, domainCandidates, duplicateGroups, inbox, listAlerts, listDomainChecks, manualTasks, metricsTrend,
  dealHygiene, getSettings, pipelineCells, saveDomainCheck, searchContacts, setLocationFlags, setManualTask, staleDeals, updateSettings,
  visibleLocationIds, type Settings,
} from "../analytics/queries";
import { loadAccounts, refreshInsights } from "../analytics/service";
import { isSlackWebhook, MIN_CLOSED_DEALS } from "../analytics/derive";
import { demoDomainReport } from "../demo/seed";
import { checkDomain, extractDomain } from "../dns/email-auth";
import { deepLinks } from "../links";
import { isTestName } from "../analytics/test-data";
import { accountLimit, type Feature } from "../entitlements";
import { purgeSyncedData } from "../ghl/installations";
import { SYNCED_DELETE } from "../tenant-tables";
import { SHARE_LINK_DAYS } from "../data-inventory";
import { createKey, listKeys, MAX_KEYS, revokeKey } from "../mcp/store";
import { postToSlack } from "../notify";
import { enqueueFullSync, enqueueLocationSync, runSlice, syncStatus } from "../sync/engine";
import { freshnessFor, syncPanel } from "../sync/freshness-queries";
import {
  abandonedDeals, accountSummaries, agingBuckets, avgCycleDays, coverage, deadPipeline, forecast, pipelineSummaries, riskyDeals, stageTable,
  valueDistribution, winLossByMonth, winRate,
} from "../analytics/pipeline-intel";
import { OUTCOME_LABEL, PRESETS, parseFilters, parseOutcome } from "../analytics/call-intel";
import { callQueue, createCallList, deleteCallList, listCallLists, logOutcome, MAX_LISTS, outcomeSummary, speedToLead } from "../analytics/call-queries";
import {
  activitySummary, anomalyIndices, compareAccounts, contactGap, goalProgress, renewalStatus, roi, segmentStats, zAnomaly,
} from "../analytics/client-intel";
import { accountHistory, clientExtras, periodFigures, saveProfile, type ClientExtra, type ProfilePatch } from "../analytics/client-queries";
import { dailyPriorities, replyAging, setupScore, worstDomainStatus, type SetupFacts } from "../analytics/comms-intel";
import { channelCounts, channelLabel, CONVERSATIONS_READ_PER_ACCOUNT, readLimitNote, unreadSummary, WAITING_WINDOW_DAYS } from "../analytics/waiting";
import { attentionBand } from "../scoring";
import { loadStageRules, saveStageRule, stageInventory } from "../analytics/stage-rules-sql";
import { parseRulePatch, pipelineTreatment, ruleKey, stageProbability, treatmentOf } from "../analytics/stage-rules";
import { sourceSummary } from "../analytics/contact-intel";
import { MIN_MONEY_BASE_FOR_PERCENT, percentChange } from "../analytics/metrics";
import { afterHours, communicationGaps } from "../analytics/comms-queries";
import { badDataSamples, contactOverview, topLeads, vips } from "../analytics/contact-queries";
import { appointmentInsights } from "../analytics/appointment-insight-queries";
import { auditSummary, buildAudit } from "../analytics/audit-intel";
import { speedView } from "../analytics/speed-queries";
import { CHANGELOG, ROADMAP } from "../roadmap";
import { buildSharePayload } from "../analytics/share-intel";
import { randomBytes } from "node:crypto";
import { emailConfigured } from "../email";
import { validEmail } from "../analytics/weekly-email";
import { appointmentView } from "../analytics/appointment-queries";
import { compareSetup, describe as describeDiff } from "../analytics/setup-intel";
import { applyRun, createPreview, getRun, installationHasScope, listRuns, PREVIEW_VALID_HOURS, sampleChanges, undoRun } from "../analytics/cleanup-queries";
import { parseParams } from "../analytics/cleanup-intel";
import { demoWriter, platformWriter } from "../analytics/cleanup-writer";
import { availability, disconnect, startLink } from "../connections/flow";
import { listConnections } from "../connections/queries";
import { isProvider } from "../connections/state";
import { locationAccessToken } from "../sync/engine";
import { createHook, listHooks, listMeetings, MAX_HOOKS_PER_ACCOUNT, revokeHook, setMeetingStatus } from "../analytics/meeting-queries";
import { buildDailyDigest, NOT_WATCHED } from "../analytics/digest-service";
import { digestText, localParts } from "../analytics/digest-intel";
import { industryKey, industryOptions, matchesSegment, PLAYBOOKS } from "../analytics/playbooks";
import { buildQueue, recordBulk, recordDecision, summarise, undoDecision } from "../analytics/dedupe-queries";
import { bulkSelect, groupKey } from "../analytics/dedupe";
import { contactTimeline, dndSummary, leadSources, recentDealMoves, setTeamName, teamPace, teamStats, upcomingBirthdays } from "../analytics/people-queries";
import { paceOf, sourceConversion, teamLabel, teamWinRate } from "../analytics/people-intel";
import { excludedOpenDeals, getGoals, GOAL_METRICS, loadDeals, pipelineTrend, setGoal, type GoalMetric } from "../analytics/pipeline-queries";
import { MIN_CLOSED_DEALS as MIN_CLOSED, OUTLIER_MIN_DEALS, OUTLIER_SHARE, outlier as dealOutlier, winRateOf } from "../analytics/metrics";
import { parsePickedAccounts } from "../design/filters";
import { authenticate, isResponse, json, type AuthContext } from "./auth";

// All authenticated data endpoints live behind /api/app/<path>. Each one needs a valid signed
// session, is scoped to the caller's installation, and is checked against the plan.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[]; seg?: Set<string> | null };

// The "show me only..." filter an agency can set at the top of the app: a kind of industry and/or an
// owner. Every page honours it, so the whole app can be narrowed to, say, the clinics or one account
// manager's clients. A business or client view ignores it (it only ever sees its own account).
async function segmentSet(ctx: Ctx): Promise<Set<string> | null> {
  if (ctx.seg !== undefined) return ctx.seg;
  ctx.seg = null;
  if (ctx.limitTo) return ctx.seg;
  const industry = ctx.url.searchParams.get("industry");
  const owner = ctx.url.searchParams.get("owner");
  const hideTest = ctx.url.searchParams.get("hideTest") === "1";
  // Client accounts picked in the filter bar (D0). Only ids that are well formed are kept, and they are matched against this company's own accounts below, so an id from anywhere else changes nothing.
  const picked = parsePickedAccounts(ctx.url.searchParams.get("accounts"));
  if ((!industry || !/^[a-z_]{2,30}$/.test(industry)) && (!owner || owner.length > 60) && !hideTest && picked.length === 0) return ctx.seg;
  const rows = await sql()`
    select l.location_id, l.name, l.owner, p.industry from locations l
    left join account_profiles p on p.installation_id = l.installation_id and p.location_id = l.location_id
    where l.installation_id = ${ctx.installationId}`;
  const filter = { industry: industry && /^[a-z_]{2,30}$/.test(industry) ? industry : null, owner: owner && owner.length <= 60 ? owner : null };
  ctx.seg = new Set(rows.filter((r) => matchesSegment({ industry: r.industry as string | null, owner: r.owner as string | null }, filter) && !(hideTest && isTestName(r.name as string | null)) && (picked.length === 0 || picked.includes(r.location_id as string))).map((r) => r.location_id as string));
  return ctx.seg;
}

const LOCATION_ID = /^[A-Za-z0-9_-]{3,64}$/;

async function accountsFor(ctx: Ctx) {
  const { settings, accounts } = await loadAccounts(ctx.installationId);
  const limit = accountLimit(ctx.plan, ctx.entitlements.enforced);
  let visible = limit === null ? accounts : accounts.filter((a) => !a.ignored).slice(0, limit);
  // A business or client view only ever sees its own account.
  if (ctx.limitTo) visible = accounts.filter((a) => a.locationId === ctx.limitTo);
  const seg = await segmentSet(ctx);
  if (seg) visible = visible.filter((a) => seg.has(a.locationId));
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
  const seg = await segmentSet(ctx);
  const permits = (locationId: string) => (ctx.limitTo ? locationId === ctx.limitTo : (allowed === null || allowed.has(locationId)) && (seg === null || seg.has(locationId)));
  return { settings, permits, links: deepLinks(settings.appDomain) };
}

// A feature that is switched off (see flags.ts) does not exist as far as the caller can tell.
const gate = (ctx: Ctx, feature: Feature) =>
  ctx.entitlements.locked.includes(feature) ? json({ error: "This feature is part of the paid plan", feature, upgrade: true }, 402)
  : ctx.entitlements.features[feature] === false ? json({ error: "This feature is switched off", feature, off: true }, 404) : null;

// The owner label is who at the company looks after the client: the company's own internal note, never sent to the client's staff (N84).
function slim(a: DerivedAccount, links: ReturnType<typeof deepLinks>, forClient = false) {
  return {
    locationId: a.locationId, name: a.name, ignored: a.ignored, owner: forClient ? null : a.owner, url: links.account(a.locationId),
    contacts: a.contacts, new30d: a.new30d, openOpps: a.openOpps, openValue: a.openValue, staleOpps: a.staleOpps,
    revenueAtRisk: a.revenueAtRisk, unread: a.unread, unanswered: a.unanswered, calendars: a.calendars, pipelines: a.pipelines,
    emailPct: a.emailPct, phonePct: a.phonePct, tagPct: a.tagPct, activePct: a.activePct, completenessPct: a.completenessPct,
    daysInactive: a.daysInactive, lastActivityAt: a.lastActivityAt, dormant: a.dormant, score: a.score, band: a.band, bandNote: a.bandNote,
    churn: a.churn, winRate: a.winRate, expectedRevenue: a.expectedRevenue, followUpRevenueAtRisk: a.followUpRevenueAtRisk,
    leadFlowDropPct: a.leadFlowDropPct, syncError: a.syncError, contactsSyncedAt: a.contactsSyncedAt,
  };
}

// ---------------- handlers ----------------

async function overview(ctx: Ctx) {
  // Independent queries run together so the page does not wait on them one after another.
  const [{ settings, accounts, hidden, links }, allAlerts, freshness, coverage] = await Promise.all([
    accountsFor(ctx), listAlerts(ctx.installationId, false, 500, ctx.limitTo ?? undefined), freshnessFor(ctx.installationId, { limitTo: ctx.limitTo }), conversationCoverage(ctx.installationId),
  ]);
  const overviewSeg = await segmentSet(ctx);
  const live = accounts.filter((a) => !a.ignored);
  const alerts = overviewSeg ? allAlerts.filter((a) => a.locationId !== null && overviewSeg.has(a.locationId)) : allAlerts;
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
    // Inside a "Needs attention" list nothing is labelled Healthy or Thriving (N16): an account listed here is at best "Watch".
    .map(({ a, reasons }) => ({ locationId: a.locationId, name: a.name, score: a.score, band: attentionBand(a.band), bandNote: a.bandNote, churn: a.churn.level, reasons, url: links.account(a.locationId) }));
  const liveIds = new Set(live.map((a) => a.locationId));
  const capped = coverage.filter((c) => liveIds.has(c.locationId) && c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length;
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
      unanswered: sum((a) => a.unanswered),
      // An estimate is shown only when at least one account has enough closed deals; otherwise it is null ("not enough data").
      expectedRevenue: live.some((a) => a.winRate !== null) ? sum((a) => a.expectedRevenue ?? 0) : null,
      followUpRevenueAtRisk: live.some((a) => a.winRate !== null) ? sum((a) => a.followUpRevenueAtRisk ?? 0) : null,
      estimateAccounts: live.filter((a) => a.winRate !== null).length, minClosedDeals: MIN_CLOSED_DEALS, outlier: overviewOutlier(live), excludedDeals: sum((a) => a.excludedOpen ?? 0),
      // Of the left-out deals, those in a closed-out stage or an unused pipeline (the rest have no value or no owner).
      excludedByStage: sum((a) => a.outOfScopeOpen ?? 0),
      readLimit: readLimitNote(capped, live.length),
      avgScore: live.length ? Math.round(sum((a) => a.score) / live.length) : 0,
      openAlerts: alerts.length, criticalAlerts: alerts.filter((x) => x.severity === "critical").length,
    },
    bands,
    attention,
    freshness,
  });
}

// One counted deal that is at least half of the agency-wide open pipeline is called out on the card (metrics.ts, OUTLIER_SHARE).
function overviewOutlier(live: DerivedAccount[]) {
  const count = live.reduce((s, a) => s + a.openOpps, 0);
  const value = live.reduce((s, a) => s + a.openValue, 0);
  const top = live.reduce((m, a) => Math.max(m, a.topDeal ?? 0), 0);
  return count >= OUTLIER_MIN_DEALS && value > 0 && top / value >= OUTLIER_SHARE ? { value: top, share: Math.round((top / value) * 100) / 100, of: count } : null;
}

// The instant audit: what is wrong right now, what it costs, and where to start.
async function computeAudit(ctx: Ctx) {
  const { settings, accounts } = await accountsFor(ctx);
  const live = accounts.filter((a) => !a.ignored);
  const v = await appointmentView(ctx.installationId, await allowedIds(ctx));
  const appts = v.access.total === 0 ? null : {
    readable: v.access.ok, total: v.access.total, needPermission: v.access.needsPermission.length,
    unmarked: v.unmarkedTotal, noShowsToRecover: v.recoverTotal, unconfirmed48: v.unconfirmedTotal,
  };
  const audit = buildAudit(live.map((a) => ({
    locationId: a.locationId, name: a.name, staleValue: a.staleValue, staleOpps: a.staleOpps, openValue: a.openValue, openOpps: a.openOpps, excludedOpen: a.excludedOpen ?? 0,
    unanswered: a.unanswered, winRate: a.winRate, avgDealValue: a.avgDealValue, completenessPct: a.completenessPct, contacts: a.contacts, topStaleDeal: a.topStaleDeal ?? 0,
  })), appts);
  const who = settings.brandName ?? (ctx.limitTo ? "Your business" : "Your company");
  return { audit, who, names: live.map((a) => a.name ?? "").filter(Boolean) };
}

async function auditViewData(ctx: Ctx) {
  const { audit, who } = await computeAudit(ctx);
  return json({ audit, summary: auditSummary(audit, who) });
}

// A snapshot of the audit someone can send on: totals and finding titles only, account names scrubbed, expires in 30 days.
async function auditShare(ctx: Ctx) {
  if (ctx.demo) return json({ error: "Sharing is not available in the demo" }, 400);
  const { audit, who, names } = await computeAudit(ctx);
  const id = randomBytes(24).toString("base64url");
  await sql()`insert into shared_audits (installation_id, id, payload, expires_at) values (${ctx.installationId}, ${id}, ${sql().json(buildSharePayload(audit, who, names) as never)}, now() + make_interval(days => ${SHARE_LINK_DAYS}))`;
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? ctx.url.origin).replace(/\/+$/, "");
  return json({ url: `${origin}/audit/${id}`, expiresInDays: SHARE_LINK_DAYS });
}

// The links this installation has made, newest first, with how often each was opened. Never available to a client's own staff.
async function auditShares(ctx: Ctx) {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  if (ctx.demo) return json({ links: [] }); // the demo installation holds the public sample audit; it is never listed or switched off from here
  const rows = await sql()`select id, created_at, expires_at, revoked_at, views, last_viewed_at from shared_audits where installation_id = ${ctx.installationId} order by created_at desc limit 20`;
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? ctx.url.origin).replace(/\/+$/, "");
  const now = Date.now();
  return json({ links: rows.map((r) => ({
    id: r.id as string, url: `${origin}/audit/${r.id}`, createdAt: (r.created_at as Date).toISOString(), expiresAt: (r.expires_at as Date).toISOString(),
    revoked: r.revoked_at !== null, expired: (r.expires_at as Date).getTime() <= now, views: r.views as number, lastViewedAt: r.last_viewed_at instanceof Date ? r.last_viewed_at.toISOString() : null,
  })) });
}

// Switching a link off. Only this installation's own links can be revoked: the id alone is not enough.
async function auditRevoke(ctx: Ctx) {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  if (ctx.demo) return json({ error: "Sharing is not available in the demo" }, 400);
  const body = (await ctx.request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(body.id)) return json({ error: "Unknown link" }, 400);
  const done = await sql()`update shared_audits set revoked_at = now() where id = ${body.id} and installation_id = ${ctx.installationId} and revoked_at is null returning id`;
  if (done.length === 0) return json({ error: "That link was not found or is already switched off" }, 404);
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'audit.share_revoked', ${sql().json({ ref: body.id.slice(-6) } as never)})`;
  return json({ ok: true });
}

// How fast new leads get a first reply from a person.
async function speedViewData(ctx: Ctx) {
  const sc = await scope(ctx);
  const v = await speedView(ctx.installationId, await allowedIds(ctx), sc.settings.speedTargetMinutes);
  return json({
    ...v, waiting: v.waiting.map((w) => ({ ...w, url: sc.links.contact(w.locationId, w.contactId) })),
    // The leads behind each week of the trend, with the same white-label link as every other list (KF-6).
    trend: v.trend.map((w) => ({ ...w, members: w.members.map((m) => ({ ...m, url: sc.links.contact(m.locationId, m.contactId) })) })),
  });
}

// Voting is per person and counted inside the one installation, so one agency never sees another's votes.
const voterOf = (ctx: Ctx) => `${ctx.kind}:${ctx.limitTo ?? "agency"}:${ctx.session.userId ?? ""}`;

async function roadmapView(ctx: Ctx) {
  const rows = await sql()`select item_key, count(*)::int n, bool_or(voter = ${voterOf(ctx)}) mine from roadmap_votes where installation_id = ${ctx.installationId} group by item_key`;
  const by = new Map(rows.map((r) => [r.item_key as string, { n: r.n as number, mine: Boolean(r.mine) }]));
  return json({ items: ROADMAP.map((i) => ({ ...i, votes: by.get(i.key)?.n ?? 0, voted: by.get(i.key)?.mine ?? false })), changelog: CHANGELOG });
}

async function roadmapVote(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== "string" || !ROADMAP.some((i) => i.key === body.key)) return json({ error: "Unknown item" }, 400);
  const voter = voterOf(ctx);
  const gone = await sql()`delete from roadmap_votes where installation_id = ${ctx.installationId} and item_key = ${body.key} and voter = ${voter} returning 1`;
  if (gone.length === 0) await sql()`insert into roadmap_votes (installation_id, item_key, voter) values (${ctx.installationId}, ${body.key}, ${voter})`;
  return json({ ok: true, voted: gone.length === 0 });
}

async function appointmentsView(ctx: Ctx) {
  const sc = await scope(ctx);
  const v = await appointmentView(ctx.installationId, await allowedIds(ctx));
  const link = (p: { locationId: string; contactId: string }) => sc.links.contact(p.locationId, p.contactId);
  return json({
    ...v, canSeeAccounts: ctx.limitTo === null,
    unconfirmed: v.unconfirmed.map((p) => ({ ...p, url: link(p) })), recover: v.recover.map((p) => ({ ...p, url: link(p) })), unmarked: v.unmarked.map((p) => ({ ...p, url: link(p) })),
  });
}

// The deeper read of the same calendars: show rate by time and source, recovery, fairness, follow-up gaps and
// a short brief before each upcoming appointment. Limited to the accounts the caller may see.
async function appointmentInsightsView(ctx: Ctx) {
  const sc = await scope(ctx);
  const v = await appointmentInsights(ctx.installationId, await allowedIds(ctx));
  const link = (p: { locationId: string; contactId: string }) => sc.links.contact(p.locationId, p.contactId);
  return json({
    ...v,
    repeatNoShows: v.repeatNoShows.map((p) => ({ ...p, url: link(p) })),
    followUp: { ...v.followUp, contacts: v.followUp.contacts.map((p) => ({ ...p, url: link(p) })) },
    briefs: v.briefs.map((p) => ({ ...p, url: link(p) })),
  });
}

// Agency only (the route is not in any limited view's allow-list): compare each account's pipelines and
// stages with a baseline account.
async function setupCompare(ctx: Ctx) {
  const requested = ctx.url.searchParams.get("baseline");
  if (requested && !LOCATION_ID.test(requested)) return json({ error: "Invalid account" }, 400);
  const allowed = await allowedIds(ctx);
  const [locs, pipes] = await Promise.all([
    sql()`select location_id, name, calendar_count from locations where installation_id = ${ctx.installationId} and not ignored order by name`,
    sql()`select location_id, name, stages from pipelines where installation_id = ${ctx.installationId}`,
  ]);
  const visible = locs.filter((l) => allowed === null || allowed.includes(l.location_id as string));
  const setups = visible.map((l) => ({
    locationId: l.location_id as string, name: (l.name as string | null) ?? "Unnamed account", calendars: l.calendar_count as number | null,
    pipelines: pipes.filter((p) => p.location_id === l.location_id).map((p) => ({ name: (p.name as string | null) ?? "Pipeline", stages: ((p.stages as Array<{ name: string }> | null) ?? []).map((s) => s.name) })),
  }));
  const base = setups.find((s) => s.locationId === requested) ?? setups.find((s) => s.pipelines.length > 0) ?? null;
  return json({
    accounts: setups.map((s) => ({ locationId: s.locationId, name: s.name })),
    baseline: base ? { locationId: base.locationId, name: base.name, pipelines: base.pipelines.length, calendars: base.calendars } : null,
    rows: base ? setups.filter((s) => s.locationId !== base.locationId).map((s) => { const d = compareSetup(base, s); return { locationId: s.locationId, name: s.name, matches: d.matches, notes: describeDiff(d) }; }) : [],
  });
}

async function meetingsView(ctx: Ctx) {
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const [meetings, hooks, locs] = await Promise.all([
    listMeetings(ctx.installationId, allowed),
    listHooks(ctx.installationId, allowed),
    sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``} order by name`,
  ]);
  return json({
    meetings: meetings.map((m) => ({ ...m, contactUrl: m.contactId ? sc.links.contact(m.locationId, m.contactId) : null })),
    hooks, accounts: locs.map((l) => ({ locationId: l.location_id as string, name: (l.name as string | null) ?? "Unnamed account" })),
    maxHooks: MAX_HOOKS_PER_ACCOUNT, keepTranscripts: sc.settings.keepTranscripts, canManage: ctx.kind !== "client", moreTools: zoomOn(ctx),
  });
}

async function meetingHookCreate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; label?: unknown } | null;
  const loc = ctx.limitTo ?? body?.locationId;
  if (typeof loc !== "string" || !LOCATION_ID.test(loc)) return json({ error: "Choose a client account" }, 400);
  const allowed = await allowedIds(ctx);
  if (allowed && !allowed.includes(loc)) return json({ error: "Account not found" }, 404);
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;
  const made = await createHook(ctx.installationId, loc, label);
  if (made === "no_account") return json({ error: "Account not found" }, 404);
  if (made === "limit") return json({ error: `An account can have up to ${MAX_HOOKS_PER_ACCOUNT} addresses. Turn one off first.` }, 400);
  // The address is shown this one time: only a hash is stored.
  return json({ ok: true, id: made.id, url: `${ctx.url.origin}/api/hooks/meeting/${made.token}` });
}

async function meetingHookRevoke(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  return (await revokeHook(ctx.installationId, await allowedIds(ctx), id)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
}

async function meetingUpdate(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  const body = (await ctx.request.json().catch(() => null)) as { status?: unknown } | null;
  if (body?.status !== "new" && body?.status !== "filed" && body?.status !== "dismissed") return json({ error: "Unknown status" }, 400);
  return (await setMeetingStatus(ctx.installationId, await allowedIds(ctx), id, body.status)) ? json({ ok: true }) : json({ error: "Not found" }, 404);
}

// ---------------- data cleanup: preview, confirm, apply, undo ----------------
// The only feature that changes a client's contacts. It always shows the exact changes first, needs the
// number of changes typed back to confirm, re-checks each contact right before changing it, keeps the
// value it replaced, and can be undone. It never runs for a client view.

async function cleanupView(ctx: Ctx) {
  const allowed = await allowedIds(ctx);
  const [runs, locs, canWrite] = await Promise.all([
    listRuns(ctx.installationId, allowed),
    sql()`select location_id, name from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``} order by name`,
    ctx.demo ? Promise.resolve(true) : installationHasScope(ctx.installationId, "contacts.write"),
  ]);
  return json({
    runs, canWrite, accounts: locs.map((l) => ({ locationId: l.location_id as string, name: (l.name as string | null) ?? "Unnamed account" })),
    previewValidHours: PREVIEW_VALID_HOURS,
    writeNote: canWrite ? null : "Previewing is always safe. To apply changes, SubSync needs permission to edit contacts, which this install has not approved yet.",
  });
}

async function cleanupPreview(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  const loc = ctx.limitTo ?? body?.locationId;
  if (typeof loc !== "string" || !LOCATION_ID.test(loc)) return json({ error: "Choose a client account" }, 400);
  const allowed = await allowedIds(ctx);
  if (allowed && !allowed.includes(loc)) return json({ error: "Account not found" }, 404);
  const [known] = await sql()`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${loc} and not ignored`;
  if (!known) return json({ error: "Account not found" }, 404);
  const parsed = parseParams(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const made = await createPreview(ctx.installationId, loc, actorOf(ctx), parsed.params);
  return json({ ok: true, ...made });
}

async function cleanupRunView(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  const run = await getRun(ctx.installationId, await allowedIds(ctx), id);
  if (!run) return json({ error: "Not found" }, 404);
  return json({ run, changes: await sampleChanges(id) });
}

async function cleanupWork(ctx: Ctx, id: string, mode: "apply" | "undo") {
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  const run = await getRun(ctx.installationId, await allowedIds(ctx), id);
  if (!run) return json({ error: "Not found" }, 404);
  const body = (await ctx.request.json().catch(() => null)) as { confirm?: unknown } | null;

  if (mode === "apply") {
    if (run.status === "applied" || run.status === "undone" || run.status === "undoing") return json({ error: "This run has already been applied" }, 409);
    if (run.total === 0) return json({ error: "There is nothing to change" }, 400);
    const starting = run.status === "previewed" || run.status === "needs_permission";
    if (starting) {
      if (Number(body?.confirm) !== run.total) return json({ error: `Type ${run.total} to confirm that you want to make ${run.total} change${run.total === 1 ? "" : "s"}` }, 400);
      if (run.createdAt && Date.now() - Date.parse(run.createdAt) > PREVIEW_VALID_HOURS * 3_600_000) return json({ error: "This preview is more than a day old. Run the preview again so it reflects today's data." }, 410);
    }
  } else if (!(run.status === "applied" || run.status === "partial" || run.status === "applying" || run.status === "undoing") || run.applied === 0 && run.status !== "undoing") {
    return json({ error: "There is nothing to undo" }, 409);
  }

  if (!ctx.demo && !(await installationHasScope(ctx.installationId, "contacts.write"))) {
    return json({ error: "SubSync does not have permission to change contacts in this account yet. Nothing was changed.", needsPermission: true }, 403);
  }
  const writer = ctx.demo ? demoWriter(ctx.installationId, run.locationId) : platformWriter(await locationAccessToken(ctx.session.companyId, run.locationId));
  const done = mode === "apply" ? await applyRun(ctx.installationId, run, writer, !ctx.demo, actorOf(ctx)) : await undoRun(ctx.installationId, run, writer, !ctx.demo, actorOf(ctx));
  return json({ run: done, finished: done.status !== "applying" && done.status !== "undoing" });
}

// ---------------- connections: sign in to Slack, Fathom and Zoom ----------------
// Zoom and Google Meet are hidden behind the zoom_meet switch (off by default): the card, the stored connections and the sign-in start all vanish.
const zoomOn = (ctx: Ctx) => ctx.entitlements.features.zoom_meet !== false;

async function connectionsView(ctx: Ctx) {
  const connections = await listConnections(ctx.installationId);
  const available = availability();
  const showZoom = zoomOn(ctx);
  return json({
    connections: showZoom ? connections : connections.filter((c) => c.provider !== "zoom"),
    available: showZoom ? available : { slack: available.slack, fathom: available.fathom },
  });
}

async function connectionStart(ctx: Ctx, provider: string) {
  if (!isProvider(provider) || (provider === "zoom" && !zoomOn(ctx))) return json({ error: "Not found" }, 404);
  if (ctx.demo) return json({ error: "Connecting is not available in the demo. It needs a real install." }, 400);
  const link = startLink(provider, { provider, installationId: ctx.installationId, onlyLocationId: ctx.limitTo, actor: actorOf(ctx) });
  return link.ok ? json({ url: link.url }) : json({ error: link.error }, 503);
}

async function connectionRemove(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);
  return (await disconnect(ctx.installationId, id, actorOf(ctx))) ? json({ ok: true }) : json({ error: "Not found" }, 404);
}

async function dailyView(ctx: Ctx) {
  const sc = await scope(ctx);
  const d = await buildDailyDigest(ctx.installationId, { limitTo: ctx.limitTo, planLimit: accountLimit(ctx.plan, ctx.entitlements.enforced), onlyIds: await segmentSet(ctx) });
  const seen = (await conversationCoverage(ctx.installationId)).filter((c) => sc.permits(c.locationId));
  return json({
    readLimit: readLimitNote(seen.filter((c) => c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, seen.length),
    generatedAt: d.generatedAt, freshness: d.freshness, connection: d.connection, headlines: d.headlines, accounts: d.accounts, limited: ctx.limitTo !== null,
    attention: d.attention.map((a) => ({ ...a, url: sc.links.account(a.locationId) })),
    fine: d.fine, notWatched: NOT_WATCHED,
    schedule: { hour: d.settings.digestHour ?? 8, timezone: d.settings.digestTimezone, slack: Boolean(d.settings.slackWebhookUrl) && d.settings.digestEnabled },
  });
}

const USAGE_VIEWS = new Set(["today", "overview", "accounts", "clients", "team", "search", "deals", "pipeline", "leads", "calls", "inbox", "onboarding", "email", "duplicates", "alerts", "settings", "help", "account", "meetings", "audit", "speed", "appointments"]);

// A counter of which pages get opened (no personal data), so the getting-started checklist can
// tick itself off and so the agency can see what its team uses.
async function usagePing(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { view?: unknown } | null;
  if (typeof body?.view !== "string" || !USAGE_VIEWS.has(body.view)) return json({ error: "Unknown page" }, 400);
  await sql()`
    insert into usage_events (installation_id, day, view) values (${ctx.installationId}, current_date, ${body.view})
    on conflict (installation_id, day, view) do update set n = usage_events.n + 1`;
  return json({ ok: true });
}

// The getting-started checklist, with each step's real state.
async function startView(ctx: Ctx) {
  const db = sql();
  const [views, [locs], status, settings, [clientOn]] = await Promise.all([
    db`select distinct view from usage_events where installation_id = ${ctx.installationId}`,
    db`select count(*)::int total, count(*) filter (where contacts_synced_at is not null)::int synced from locations
        where installation_id = ${ctx.installationId} ${ctx.limitTo ? db`and location_id = ${ctx.limitTo}` : db``}`,
    syncStatus(ctx.installationId, ctx.limitTo),
    getSettings(ctx.installationId),
    ctx.kind === "agency" ? db`select count(*)::int n from locations where installation_id = ${ctx.installationId} and client_view` : Promise.resolve([{ n: 0 }]),
  ]);
  const seen = new Set(views.map((v) => v.view as string));
  const agency = ctx.kind === "agency";
  const synced = locs.total > 0 && locs.synced === locs.total && status.pending === 0;
  const syncDetail = locs.total === 0
    ? (status.pending > 0 ? "Looking for your accounts..." : "No accounts found yet. The platform can take a minute after an install: press Sync now on the home page.")
    : synced ? `${locs.total} account${locs.total === 1 ? "" : "s"} read. ${(await freshnessFor(ctx.installationId, { limitTo: ctx.limitTo })).text}.`
    : `${locs.synced} of ${locs.total} account${locs.total === 1 ? "" : "s"} read, ${status.pending} job${status.pending === 1 ? "" : "s"} left.`;
  const steps = [
    { id: "connected", title: "Connect SubSync", done: true, detail: agency ? "Connected to all your client accounts." : "Connected to your account.",
      body: "You are signed in through the platform, so there is nothing to type. SubSync only reads your data.", view: null, cta: null },
    { id: "synced", title: "Let the first sync finish", done: synced, detail: syncDetail,
      body: "SubSync reads your " + (agency ? "client accounts" : "account") + " in the background. The first sync takes a few minutes, longer with many contacts. Numbers fill in as it goes.", view: "overview", cta: "See how fresh your data is" },
    { id: "today", title: "See what needs you today", done: seen.has("today"),
      detail: null, body: "Today ranks what to do first, with the reason and a link, and compares each account with its own normal.", view: "today", cta: "Open Today" },
    { id: "search", title: "Find any contact", done: seen.has("search"),
      detail: null, body: "Search by name, email or phone" + (agency ? " across every client account at once" : "") + ", and open a contact's timeline.", view: "search", cta: "Open contact search" },
    { id: "duplicates", title: "Review likely duplicates", done: seen.has("duplicates"),
      detail: null, body: "See likely duplicate contacts with a confidence score, decide which record to keep, then merge them in the platform.", view: "duplicates", cta: "Open Duplicates" },
    { id: "brief", title: "Get the daily brief in Slack", done: Boolean(settings.slackWebhookUrl) && settings.digestEnabled,
      detail: null, body: "Paste a Slack incoming webhook in Settings and choose the hour. It arrives once a day in your time zone.", view: "settings", cta: "Open Settings" },
    { id: "email", title: "Get alerts and the Monday email", done: Boolean(settings.digestEmail),
      detail: null, body: "Type one email address in Settings. New critical and warning alerts are emailed to it straight away, and a short summary arrives every Monday. Nothing is sent until you add an address.", view: "settings", cta: "Open Settings" },
    ...(ctx.entitlements.features.meetings !== false ? [{ id: "meetings", title: "Connect a meeting tool (optional)", done: seen.has("meetings"), optional: true,
      detail: null, body: `Connect ${zoomOn(ctx) ? "Zoom or Fathom" : "Fathom"} in Settings and each meeting summary is saved in SubSync and added to the matching contact's notes in your CRM.`, view: "meetings", cta: "Open Meeting notes" }] : []),
    ...(agency ? [{ id: "clients", title: "Let a client see their own account", done: (clientOn?.n ?? 0) > 0, optional: true,
      detail: null, body: "Switch on a read-only view for a client's own staff. They see only their own account: never other clients, fees or notes.", view: "settings", cta: "Open Settings" }] : []),
  ];
  // A client's own staff get the steps about using SubSync. The steps about alerts, email, meeting tools and client access report what the company
  // set up in Settings (whether a Slack channel or an email address is saved), which a client never receives (N84).
  const shown = ctx.kind === "client" ? steps.filter((s) => !["brief", "email", "meetings", "clients"].includes(s.id)) : steps;
  return json({ kind: ctx.kind, steps: shown, doneCount: shown.filter((s) => s.done).length, total: shown.length });
}

// Options for the filter bar. Not narrowed by the filter itself, so you can always change it.
async function segmentsView(ctx: Ctx) {
  const all = await sql()`
    select l.location_id, l.name, l.owner, l.ignored, p.industry from locations l
    left join account_profiles p on p.installation_id = l.installation_id and p.location_id = l.location_id
    where l.installation_id = ${ctx.installationId}`;
  // Ignored accounts are listed (so the filter bar can say they are left out and why) but never counted in the totals, industries or owners.
  const rows = all.filter((r) => !r.ignored);
  const owners = new Map<string, number>();
  for (const r of rows) if (r.owner) owners.set(r.owner as string, (owners.get(r.owner as string) ?? 0) + 1);
  return json({
    total: rows.length,
    // The client accounts an agency can pick between in the filter bar (this endpoint is agency only; a business or client session is refused by the route policy).
    accounts: all.map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", test: isTestName(r.name as string | null), ignored: r.ignored === true, industry: industryKey(r.industry as string | null), owner: (r.owner as string | null) ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
    testAccounts: rows.filter((r) => isTestName(r.name as string | null)).length,
    industries: industryOptions(rows.map((r) => r.industry as string | null)),
    owners: [...owners.entries()].map(([name, accounts]) => ({ name, accounts })).sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name)),
  });
}

// What each kind of client cares about, and which of your accounts fall under it.
async function playbooksView(ctx: Ctx) {
  const [allRows, settings, seg] = await Promise.all([
    sql()`select l.location_id, l.name, p.industry from locations l
      left join account_profiles p on p.installation_id = l.installation_id and p.location_id = l.location_id
      where l.installation_id = ${ctx.installationId} and not l.ignored`,
    getSettings(ctx.installationId),
    segmentSet(ctx),
  ]);
  // The accounts listed under each industry follow the filter at the top of the app, like every other page (N8).
  const rows = seg ? allRows.filter((r) => seg.has(r.location_id as string)) : allRows;
  const unset = rows.filter((r) => !((r.industry as string | null) ?? "").trim()).length;
  return json({
    industryTargets: settings.industryTargets, globalReplyHours: settings.slaHours, accountsWithoutIndustry: unset,
    playbooks: PLAYBOOKS.map((p) => ({
      id: p.id, label: p.label, replyHours: p.replyHours, replyWhy: p.replyWhy, staleDays: p.staleDays, watch: p.watch, callLists: p.callLists, checklist: p.checklist, privacy: p.privacy ?? null,
      accounts: rows.filter((r) => p.match.test(((r.industry as string | null) ?? "").trim() || "\u0000")).map((r) => ({ locationId: r.location_id as string, name: r.name as string | null })),
    })),
  });
}

async function accounts(ctx: Ctx) {
  const { settings, accounts: list, links } = await accountsFor(ctx);
  return json({ accounts: list.map((a) => slim(a, links, ctx.kind === "client")), settings: { staleDays: settings.staleDays, dormantDays: settings.dormantDays, slaHours: settings.slaHours } });
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
      return { locationId: a.locationId, name: a.name, owner: ctx.kind === "client" ? null : a.owner, url: links.account(a.locationId), completionPct, items };
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
    brand: { name: settings.brandName, color: settings.brandColor },
    account: slim(a, links, ctx.kind === "client"),
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
  if (loc && !LOCATION_ID.test(loc)) return json({ error: "Bad account" }, 400);
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
  // The same list and the same window as the Today and Overview counts: nothing is cut short at a few hundred, and if the list ever is
  // (more than the limit), the screen says so instead of showing a smaller number as if it were the total.
  const LIMIT = 2000;
  const [fetched, coverage] = await Promise.all([inbox(ctx.installationId, settings.slaHours, LIMIT, ctx.limitTo ?? undefined), conversationCoverage(ctx.installationId)]);
  const rows = fetched.filter((r) => permits(r.locationId));
  const late = rows.filter((r) => r.overSla);
  const seen = coverage.filter((c) => permits(c.locationId));
  return json({
    slaHours: settings.slaHours,
    windowDays: WAITING_WINDOW_DAYS,
    overSla: late.length,
    waitingTotal: late.length,
    // Unread is its own count (N15): every conversation with something nobody opened, the same figure Today shows. Some are also waiting; the
    // sentence says how many, so nothing is added or taken away unseen.
    unread: unreadSummary(rows),
    readLimit: readLimitNote(seen.filter((c) => c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, seen.length),
    channels: channelCounts(late.map((r) => r.lastMessageType)),
    truncated: rows.length >= LIMIT,
    items: rows.map((r) => ({ ...r, channel: channelLabel(r.lastMessageType), url: links.conversation(r.locationId, r.conversationId) })),
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
    winRate: winRateOf(a.won.count, a.lost.count).rate,
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
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const showReviewed = ctx.url.searchParams.get("reviewed") === "1";
  const q = await buildQueue(ctx.installationId, allowed);
  const summary = await summarise(ctx.installationId, allowed, q.open, q.reviews.size);
  const list = (showReviewed ? q.all : q.open).slice(0, 60);
  return json({
    summary, truncated: q.truncated, canReview: ctx.kind !== "client",
    groups: list.map((g) => ({
      key: g.key, locationId: g.locationId, locationName: g.locationName, confidence: g.confidence, reasons: g.reasons, kind: g.kind,
      survivorId: g.survivorId, plan: g.plan, review: q.reviews.get(g.locationId + ":" + g.key) ?? null,
      people: g.people.map((p) => ({ ...p, url: sc.links.contact(g.locationId, p.contactId) })),
    })),
  });
}

const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;

async function duplicateReview(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; contactIds?: unknown; decision?: unknown; keepContactId?: unknown } | null;
  const ids = Array.isArray(body?.contactIds) ? body.contactIds : [];
  if (typeof body?.locationId !== "string" || !LOCATION_ID.test(body.locationId) || ids.length < 2 || ids.length > 40 || ids.some((i) => typeof i !== "string" || !LOCATION_ID.test(i))) {
    return json({ error: "Send the account and the contacts in the group" }, 400);
  }
  const decision = body.decision;
  if (decision !== "keep" && decision !== "not_duplicate" && decision !== "merged_in_platform") return json({ error: "Unknown decision" }, 400);
  const keep = typeof body.keepContactId === "string" ? body.keepContactId : null;
  if (decision !== "not_duplicate" && !keep) return json({ error: "Choose the record to keep" }, 400);
  const contactIds = ids as string[];
  const result = await recordDecision(ctx.installationId, await allowedIds(ctx), actorOf(ctx), {
    locationId: body.locationId, key: groupKey(contactIds), decision, keepContactId: decision === "not_duplicate" ? null : keep, contactIds,
  });
  return result === "ok" ? json({ ok: true }) : json({ error: "Those contacts were not found" }, 404);
}

async function duplicateBulk(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { decision?: unknown; minConfidence?: unknown; maxConfidence?: unknown; dryRun?: unknown } | null;
  const decision = body?.decision;
  if (decision !== "not_duplicate" && decision !== "keep") return json({ error: "Unknown action" }, 400);
  const min = Number(body?.minConfidence);
  const max = body?.maxConfidence === undefined ? 100 : Number(body.maxConfidence);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) return json({ error: "Choose a confidence range between 0 and 100" }, 400);
  const q = await buildQueue(ctx.installationId, await allowedIds(ctx));
  const chosen = bulkSelect(q.open, new Set(), min, max).slice(0, 500);
  // A dry run (the default) changes nothing: it only says what would be recorded.
  if (body?.dryRun !== false) {
    return json({
      dryRun: true, count: chosen.length, contacts: chosen.reduce((s, g) => s + g.people.length, 0),
      sample: chosen.slice(0, 8).map((g) => ({ locationName: g.locationName, confidence: g.confidence, reasons: g.reasons, names: g.people.map((p) => p.name) })),
    });
  }
  return json({ ok: true, count: await recordBulk(ctx.installationId, actorOf(ctx), decision, chosen) });
}

async function duplicateUndo(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; key?: unknown } | null;
  if (typeof body?.locationId !== "string" || !LOCATION_ID.test(body.locationId) || typeof body.key !== "string" || !/^[0-9a-f]{8}-\d{1,3}$/.test(body.key)) return json({ error: "Invalid request" }, 400);
  return (await undoDecision(ctx.installationId, await allowedIds(ctx), actorOf(ctx), body.locationId, body.key)) ? json({ ok: true }) : json({ error: "Decision not found" }, 404);
}

async function emailHealth(ctx: Ctx) {
  const [allChecks, allCandidates] = await Promise.all([listDomainChecks(ctx.installationId), domainCandidates(ctx.installationId)]);
  const seg = await segmentSet(ctx);
  const keep = (id: string | null) => (ctx.limitTo ? id === ctx.limitTo : !seg || (id !== null && seg.has(id)));
  const checks = allChecks.filter((c) => keep(c.locationId));
  const candidates = allCandidates.filter((c) => keep(c.locationId));
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
  const seg = await segmentSet(ctx);
  const rows = (await listAlerts(ctx.installationId, includeResolved, 300, ctx.limitTo ?? undefined)).filter((a) => !seg || (a.locationId !== null && seg.has(a.locationId)));
  return json({ alerts: rows.map((a) => ({ ...a, locationName: a.locationId ? names.get(a.locationId) ?? null : null })) });
}

const settingsView = async (ctx: Ctx) => {
  const { settings } = await loadAccounts(ctx.installationId);
  const [counts] = ctx.kind === "agency" ? await sql()`select count(*)::int total, count(*) filter (where client_view)::int on_ from locations where installation_id = ${ctx.installationId}` : [null];
  const accts = ctx.kind === "agency" ? await sql()`select location_id, name, client_view from locations where installation_id = ${ctx.installationId} and not ignored order by lower(coalesce(name, ''))` : [];
  // Is a meeting tool connected? Its privacy switches stay visible even while the Meeting notes page is off.
  const [meetingTool] = await sql()`select 1 from connections where installation_id = ${ctx.installationId} and provider in ('fathom', 'zoom') ${zoomOn(ctx) ? sql()`` : sql()`and provider <> 'zoom'`} limit 1`;
  return json({ features: ctx.entitlements.features, settings: publicSettings(settings), slackConfigured: Boolean(settings.slackWebhookUrl), kind: ctx.kind, canDeleteData: ctx.session.dataOwner === true, meetingTool: Boolean(meetingTool), clientView: counts ? { on: counts.on_ as number, total: counts.total as number } : null, clientAccounts: accts.map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", on: r.client_view === true })) });
};

function publicSettings(s: Settings) {
  // Never send the webhook URL back to the browser: it is a secret.
  return { staleDays: s.staleDays, dormantDays: s.dormantDays, slaHours: s.slaHours, appDomain: s.appDomain, appDomainSource: s.appDomainSource, detectedDomain: s.detectedDomain, digestEnabled: s.digestEnabled, customChecklist: s.customChecklist, digestHour: s.digestHour, digestTimezone: s.digestTimezone, digestEmail: s.digestEmail, emailReady: emailConfigured(), brandName: s.brandName, brandColor: s.brandColor, industryTargets: s.industryTargets, keepTranscripts: s.keepTranscripts, pushNotesToCrm: s.pushNotesToCrm, speedTargetMinutes: s.speedTargetMinutes, countAutomatedTouches: s.countAutomatedTouches, speedBusinessHours: s.speedBusinessHours, speedOpenHour: s.speedOpenHour, speedCloseHour: s.speedCloseHour, alertQuietHours: s.alertQuietHours, coldTags: s.coldTags };
}

const INSIGHT_SETTINGS = new Set(["staleDays", "dormantDays", "slaHours", "speedTargetMinutes", "countAutomatedTouches", "speedBusinessHours", "speedOpenHour", "speedCloseHour", "industryTargets", "alertQuietHours"]);

async function settingsUpdate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  const patch: Partial<Settings> & { appDomainOverride?: string | null } = {};
  const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  if ("staleDays" in body) { const v = int(body.staleDays, 7, 365); if (v === null) return json({ error: "Stale days must be between 7 and 365" }, 400); patch.staleDays = v; }
  if ("dormantDays" in body) { const v = int(body.dormantDays, 7, 365); if (v === null) return json({ error: "Days before an account counts as gone quiet must be between 7 and 365" }, 400); patch.dormantDays = v; }
  if ("slaHours" in body) { const v = int(body.slaHours, 1, 168); if (v === null) return json({ error: "SLA hours must be between 1 and 168" }, 400); patch.slaHours = v; }
  if ("digestEnabled" in body) patch.digestEnabled = body.digestEnabled === true;
  if ("industryTargets" in body) patch.industryTargets = body.industryTargets === true;
  if ("keepTranscripts" in body) patch.keepTranscripts = body.keepTranscripts === true;
  if ("pushNotesToCrm" in body) patch.pushNotesToCrm = body.pushNotesToCrm === true;
  if ("speedTargetMinutes" in body) {
    const n = Number(body.speedTargetMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 1440) return json({ error: "Enter a reply target between 1 and 1440 minutes" }, 400);
    patch.speedTargetMinutes = n;
  }
  if ("countAutomatedTouches" in body) patch.countAutomatedTouches = body.countAutomatedTouches === true;
  if ("speedBusinessHours" in body) patch.speedBusinessHours = body.speedBusinessHours === true;
  if ("alertQuietHours" in body) patch.alertQuietHours = body.alertQuietHours === true;
  if ("speedOpenHour" in body || "speedCloseHour" in body) {
    const open = Number(body.speedOpenHour);
    const close = Number(body.speedCloseHour);
    if (!Number.isInteger(open) || !Number.isInteger(close) || open < 0 || close > 24 || close <= open) return json({ error: "Choose opening and closing hours between 0 and 24, with closing after opening" }, 400);
    patch.speedOpenHour = open;
    patch.speedCloseHour = close;
  }
  if ("brandName" in body) {
    if (body.brandName === null || body.brandName === "") patch.brandName = null;
    else if (typeof body.brandName === "string" && body.brandName.trim().length <= 60) patch.brandName = body.brandName.trim();
    else return json({ error: "Your name can be up to 60 characters" }, 400);
  }
  if ("brandColor" in body) {
    if (body.brandColor === null || body.brandColor === "") patch.brandColor = null;
    else if (typeof body.brandColor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.brandColor)) patch.brandColor = body.brandColor.toLowerCase();
    else return json({ error: "Choose a colour like #1d4ed8" }, 400);
  }
  if ("digestHour" in body) {
    if (body.digestHour === null) patch.digestHour = null;
    else { const v = int(body.digestHour, 0, 23); if (v === null) return json({ error: "Choose an hour between 0 and 23" }, 400); patch.digestHour = v; }
  }
  if ("digestEmail" in body) {
    if (body.digestEmail === null || body.digestEmail === "") patch.digestEmail = null;
    else if (typeof body.digestEmail === "string" && validEmail(body.digestEmail.trim())) patch.digestEmail = body.digestEmail.trim();
    else return json({ error: "Enter one email address" }, 400);
  }
  if ("digestTimezone" in body) {
    if (body.digestTimezone === null || body.digestTimezone === "") patch.digestTimezone = null;
    else if (typeof body.digestTimezone === "string" && body.digestTimezone.length <= 64 && localParts(new Date(), body.digestTimezone) !== null) patch.digestTimezone = body.digestTimezone;
    else return json({ error: "That is not a time zone we recognise, for example Africa/Lagos or America/New_York" }, 400);
  }
  if ("coldTags" in body) {
    // null puts it back to "decided from the tag names"; a list (even an empty one) is the owner's choice.
    if (body.coldTags === null) patch.coldTags = null;
    else if (Array.isArray(body.coldTags) && body.coldTags.length <= 50 && body.coldTags.every((t) => typeof t === "string" && t.trim().length > 0 && t.length <= 80)) patch.coldTags = [...new Set((body.coldTags as string[]).map((t) => t.trim()))];
    else return json({ error: "Choose up to 50 tags" }, 400);
  }
  if ("clientViewAll" in body && ctx.kind === "agency") {
    await sql()`update locations set client_view = ${body.clientViewAll === true} where installation_id = ${ctx.installationId}`;
  }
  // The login domain is found automatically (sign-in and install event). What is typed here is only an override: an empty value takes it off.
  if ("appDomainOverride" in body) {
    if (body.appDomainOverride === null || body.appDomainOverride === "") patch.appDomainOverride = null;
    else {
      const d = typeof body.appDomainOverride === "string" ? extractDomain(body.appDomainOverride) : null;
      if (!d) return json({ error: "Enter the domain you log in to, for example app.youragency.com" }, 400);
      patch.appDomainOverride = d;
    }
  } else if ("appDomain" in body) {
    // Older screens send the domain on every save. It only counts as an override when it is not what the links already use.
    const d = typeof body.appDomain === "string" ? extractDomain(body.appDomain) : null;
    if (!d) return json({ error: "Enter the domain you log in to, for example app.youragency.com" }, 400);
    if (d !== (await getSettings(ctx.installationId)).appDomain) patch.appDomainOverride = d;
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
  // Recomputing every account takes many seconds. Only settings that feed a number or an alert need it; a brand name, an email address or a
  // Slack address changes no figure, so saving those returns at once.
  if (Object.keys(patch).some((k) => INSIGHT_SETTINGS.has(k))) await refreshInsights(ctx.installationId);
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
        { label: "Channel", value: (r) => channelLabel(r.lastMessageType) }, { label: "Unread", value: (r) => r.unreadCount }, { label: "Over SLA", value: (r) => (r.overSla ? "yes" : "no") }, { label: "Waiting hours", value: (r) => r.waitingHours },
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
      // The same narrowing as the Alerts page: an alert about an account the filter hides is not exported either.
      const alertSeg = await segmentSet(ctx);
      const rows = (await listAlerts(ctx.installationId, false, 2000, ctx.limitTo ?? undefined)).filter((a) => !alertSeg || (a.locationId !== null && alertSeg.has(a.locationId)));
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

// "Delete my data": only the owner (see mayDeleteData), only with the typed word, and always written to the audit log, refused or done.
// The audit log is not part of what is deleted, so the record outlives the data.
async function purgeData(ctx: Ctx) {
  if (ctx.demo) return json({ error: "Demo data cannot be deleted" }, 403);
  const audit = (action: string, detail: Record<string, unknown>) =>
    sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${actorOf(ctx)}, ${action}, ${sql().json(detail as never)})`;
  if (ctx.session.dataOwner !== true) {
    await audit("data.purge_refused", { kind: ctx.kind });
    return json({ error: "Only the owner of your company account can delete all the data. Ask them to do it.", forbidden: true }, 403);
  }
  const body = (await ctx.request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm' }, 400);
  await purgeSyncedData(ctx.installationId);
  await audit("data.purged", { tables: SYNCED_DELETE.length, kind: ctx.kind });
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
  const base = limit === null ? null : await visibleLocationIds(ctx.installationId, limit);
  const seg = await segmentSet(ctx);
  if (!seg) return base;
  return base === null ? [...seg] : base.filter((id) => seg.has(id));
}

async function pipelineIntel(ctx: Ctx) {
  const location = ctx.url.searchParams.get("location") ?? undefined;
  if (location && !LOCATION_ID.test(location)) return json({ error: "Invalid account" }, 400);
  const [allowed, goals] = await Promise.all([allowedIds(ctx), ctx.kind === "client" ? Promise.resolve({} as Awaited<ReturnType<typeof getGoals>>) : getGoals(ctx.installationId)]);
  const [deals, trend, sc, excluded, rules] = await Promise.all([loadDeals(ctx.installationId, allowed, location), pipelineTrend(ctx.installationId, allowed), scope(ctx), excludedOpenDeals(ctx.installationId, allowed, location), loadStageRules(ctx.installationId)]);
  // What the owner decided about stages and pipelines is the agency's own working note: a client's staff get the numbers built on it, never the controls.
  const stageControls = ctx.kind === "client" ? null : await stageControlsFor(ctx, allowed, rules);
  const now = Date.now();
  const opens = deals.filter((d) => d.status === "open");
  const openValue = opens.reduce((s, d) => s + d.value, 0);
  const link = (d: { locationId: string }) => sc.links.opportunities(d.locationId);
  const risky = riskyDeals(deals, now, 20).map((d) => ({ ...d, url: link(d) }));
  const aband = abandonedDeals(deals, now);
  const dead = deadPipeline(deals, now);
  return json({
    totals: { open: opens.length, openValue, won: deals.filter((d) => d.status === "won").length, lost: deals.filter((d) => d.status === "lost").length, winRate: winRate(deals), avgCycleDays: avgCycleDays(deals) },
    forecast: forecast(deals, now, ctx.kind === "client" ? [] : rules),
    stageControls,
    excluded, outlier: dealOutlier(deals), minClosedDeals: MIN_CLOSED,
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
    trend: trend.points, trendNote: trend.note, trendSince: trend.since,
    goals,
  });
}

// The list the owner edits under "Stages and pipelines": every pipeline and stage with how many open deals sit in each, how it is treated now,
// who decided, and the win probability the owner set (if any).
async function stageControlsFor(ctx: Ctx, allowed: string[] | null, rules: Awaited<ReturnType<typeof loadStageRules>>) {
  const inv = await stageInventory(ctx.installationId, allowed);
  const pipelines = [...new Set(inv.map((r) => r.pipeline))].map((name) => ({ name, ...pipelineTreatment(name, rules) }));
  const stages = inv.map((r) => {
    const t = treatmentOf(r.pipeline, r.stage, rules);
    const p = stageProbability(r.pipeline, r.stage, rules);
    return { pipeline: r.pipeline, stage: r.stage, deals: r.deals, countedDeals: r.countedDeals, treatment: t.label, out: t.out, source: t.source, why: t.why, probability: p === null ? null : Math.round(p * 100) };
  });
  return {
    canEdit: true,
    // Added up here, not on the screen.
    totals: { deals: inv.reduce((s, r) => s + r.deals, 0), countedDeals: inv.reduce((s, r) => s + r.countedDeals, 0), closedOutByName: stages.filter((s) => s.out && s.source === "name").length },
    pipelines,
    stages,
  };
}

// One change to how a pipeline or stage is treated, or to a stage's win probability. Only the owner's side may change it (agency or business).
async function stageRuleSave(ctx: Ctx) {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const parsed = parseRulePatch(await ctx.request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { pipeline, stage, cls, winProbability } = parsed.patch;
  // The pipeline or stage named must exist in this installation, so the table cannot be filled with names nobody has.
  const known = (await stageInventory(ctx.installationId, null)).some((r) => ruleKey(r.pipeline) === ruleKey(pipeline) && (stage === null || ruleKey(r.stage) === ruleKey(stage)));
  if (!known) return json({ error: "That pipeline or stage was not found" }, 404);
  await saveStageRule(ctx.installationId, actorOf(ctx), { pipelineKey: ruleKey(pipeline), stageKey: stage === null ? "" : ruleKey(stage), ...(cls !== undefined ? { cls } : {}), ...(winProbability !== undefined ? { winProbability } : {}) });
  // The totals that every screen shows are counted again now, so they change at once, and the history is not mixed (definitions.ts).
  if (cls !== undefined) await refreshInsights(ctx.installationId);
  return json({ ok: true });
}

async function contactIntel(ctx: Ctx) {
  const allowed = await allowedIds(ctx);
  const [overview, leads, vipList, samples, sc, sources, dnd, birthdays] = await Promise.all([
    // The cold-list choice is the agency's own setting. A client's staff get the split it produces, built on the suggestion from the tag names.
    contactOverview(ctx.installationId, allowed, ctx.kind === "client" ? null : (await getSettings(ctx.installationId)).coldTags), topLeads(ctx.installationId, allowed), vips(ctx.installationId, allowed),
    badDataSamples(ctx.installationId, allowed), scope(ctx),
    leadSources(ctx.installationId, allowed), dndSummary(ctx.installationId, allowed), upcomingBirthdays(ctx.installationId, allowed),
  ]);
  const link = (c: { locationId: string; contactId: string }) => sc.links.contact(c.locationId, c.contactId);
  return json({
    ...overview,
    topLeads: leads.map((c) => ({ ...c, url: link(c) })),
    vips: vipList.map((c) => ({ ...c, url: link(c) })),
    badData: samples.map((c) => ({ ...c, url: link(c) })),
    sources: sources.map((s) => ({ ...s, conversion: sourceConversion(s) })),
    sourceSummary: sourceSummary(sources),
    canEditCold: ctx.kind !== "client",
    dnd,
    birthdays: birthdays.map((b) => ({ ...b, url: link(b) })),
  });
}

async function teamView(ctx: Ctx) {
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const [rows, pace] = await Promise.all([teamStats(ctx.installationId, allowed, sc.settings.staleDays), teamPace(ctx.installationId, allowed)]);
  return json({
    staleDays: sc.settings.staleDays,
    members: rows.map((r) => ({ ...r, label: teamLabel(r.userId, r.name), winRate: teamWinRate(r), pace: paceOf(pace.get(r.userId) ?? { replies: 0, medianSeconds: null, held: 0, noShow: 0 }) })),
  });
}

async function teamName(ctx: Ctx, userId: string) {
  const body = (await ctx.request.json().catch(() => null)) as { name?: unknown } | null;
  const raw = body?.name;
  if (raw === null || raw === "") {
    await setTeamName(ctx.installationId, userId, null);
    return json({ ok: true });
  }
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 60) return json({ error: "Enter a name up to 60 characters" }, 400);
  await setTeamName(ctx.installationId, userId, raw.trim());
  return json({ ok: true });
}

async function dealMoves(ctx: Ctx) {
  const sc = await scope(ctx);
  const moves = await recentDealMoves(ctx.installationId, await allowedIds(ctx));
  return json({ moves: moves.map((m) => ({ ...m, url: sc.links.opportunities(m.locationId) })) });
}

async function contactDetail(ctx: Ctx, locationId: string, contactId: string) {
  const sc = await scope(ctx);
  const found = await contactTimeline(ctx.installationId, await allowedIds(ctx), locationId, contactId);
  if (!found) return json({ error: "Contact not found" }, 404);
  return json({ ...found, url: sc.links.contact(locationId, contactId) });
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
  const { settings: brandSettings } = await accountsFor(ctx);
  return json({ brand: { name: brandSettings.brandName, color: brandSettings.brandColor }, client: clientRow(a, extras.get(locationId), avgCycle, links, now, domainOf(locationId)), history, openAlerts: open.length, generatedAt: new Date(now).toISOString() });
}

async function execSummary(ctx: Ctx) {
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const [f, goals] = await Promise.all([periodFigures(ctx.installationId, allowed), getGoals(ctx.installationId)]);
  const pct = (cur: number, prev: number | null, minBase = 10) => percentChange(cur, prev, minBase);
  const kpis = [
    { key: "contacts", label: "New contacts, 30 days", current: f.contacts.cur, previous: f.contacts.prev, pct: pct(f.contacts.cur, f.contacts.prev), money: false },
    { key: "won", label: "Deals won, 30 days", current: f.won.curCount, previous: f.won.prevCount, pct: pct(f.won.curCount, f.won.prevCount), money: false },
    { key: "revenue", label: "Revenue won, 30 days", current: f.won.curValue, previous: f.won.prevValue, pct: pct(f.won.curValue, f.won.prevValue, MIN_MONEY_BASE_FOR_PERCENT), money: true },
    { key: "pipeline", label: "Open pipeline", current: f.pipeline.now, previous: f.pipeline.then, pct: pct(f.pipeline.now, f.pipeline.then, MIN_MONEY_BASE_FOR_PERCENT), money: true },
    { key: "score", label: "Average engagement score", current: f.score.now, previous: f.score.then, pct: pct(f.score.now, f.score.then), money: false },
  ];
  const actual = { monthly_revenue: f.month.revenue, monthly_leads: f.month.leads, monthly_deals_won: f.month.deals } as Record<string, number>;
  const goalRows = GOAL_METRICS.filter((m) => goals[m]).map((m) => ({ metric: m, label: GOAL_LABEL[m], ...goalProgress(goals[m] as number, actual[m], now) }));
  const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const series = [
    { key: "newContacts", label: "New contacts (30 day total)", values: f.series.map((s) => s.newContacts), fmt: (n: number) => String(Math.round(n)) },
    // Deal figures are compared only across days counted the same way (definitions.ts, N39).
    { key: "openValue", label: "Open pipeline", values: f.series.filter((s) => s.dealsOk).map((s) => s.openValue), fmt: money },
    { key: "score", label: "Average engagement score", values: f.series.filter((s) => s.dealsOk).map((s) => s.score), fmt: (n: number) => String(Math.round(n)) },
  ];
  const anomalies = series.flatMap((s) => {
    const z = zAnomaly(s.values);
    return z ? [{ key: s.key, label: s.label, direction: z.direction, latest: s.fmt(z.latest), average: s.fmt(z.mean), message: s.label + " today (" + s.fmt(z.latest) + ") is unusually " + z.direction + " its 90 day average (" + s.fmt(z.mean) + ")." }] : [];
  });
  return json({
    kpis, goals: goalRows, anomalies, targets: goals,
    trend: { days: f.series.filter((s) => s.dealsOk).map((s) => s.day), openValue: f.series.filter((s) => s.dealsOk).map((s) => s.openValue), openValueAnomalies: anomalyIndices(f.series.filter((s) => s.dealsOk).map((s) => s.openValue)) },
  });
}

async function commsIntel(ctx: Ctx) {
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const [rows, gaps, after] = await Promise.all([inbox(ctx.installationId, sc.settings.slaHours, 2000), communicationGaps(ctx.installationId, allowed), afterHours(ctx.installationId, allowed)]);
  // The same set as the Inbox list and the Today count (N15): the customer wrote last, past the reply target, inside the window. Never every inbound thread.
  const waiting = rows.filter((x) => sc.permits(x.locationId) && x.overSla && x.waitingHours !== null).map((x) => x.waitingHours as number);
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
    clientExtras(ctx.installationId, allowed), inbox(ctx.installationId, sc.settings.slaHours, 2000),
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

// The one freshness sentence, for every kind of person (a client sees its own account's only). A filter on screen never changes it.
async function freshnessView(ctx: Ctx) {
  return json({ freshness: await freshnessFor(ctx.installationId, { limitTo: ctx.limitTo }) });
}

// The Sync status panel: freshness, next run, failures with reasons, what runs when. Agency and business only.
async function syncStatusView(ctx: Ctx) {
  return json(await syncPanel(ctx.installationId, { limitTo: ctx.limitTo }));
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
  const d = await buildDailyDigest(ctx.installationId, { limitTo: ctx.limitTo, planLimit: accountLimit(ctx.plan, ctx.entitlements.enforced), onlyIds: await segmentSet(ctx) });
  return json({ text: digestText(ctx.demo ? "Demo Company" : "your company", { attention: d.attention, fine: d.fine.length, headlines: d.headlines, freshnessLabel: d.freshness.text }, ctx.url.origin) });
}

// ---------------- routing ----------------

const FEATURE_FOR: Record<string, Feature> = {
  search: "search", onboarding: "onboarding", stale: "stale", inbox: "inbox", pipelines: "pipelines", duplicates: "duplicates", email: "email",
  alerts: "alerts", appointments: "appointments", audit: "audit", speed: "speed", "appointment-insights": "appointments", meetings: "meetings", connections: "connections", cleanup: "cleanup", "setup-compare": "setup_compare", playbooks: "playbooks", daily: "overview", team: "team", "deal-events": "pipelines", contact: "search", settings: "settings", export: "exports", digest: "overview", "api-keys": "ai", hygiene: "stale", "pipeline-intel": "pipelines", "contact-intel": "activity", clients: "clients", qbr: "reports", "comms-intel": "inbox", "call-queue": "calls", "call-lists": "calls", "call-outcomes": "calls",
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
      if (a === "daily") return await dailyView(ctx);
      if (a === "roadmap") return await roadmapView(ctx);
      if (a === "appointments") return await appointmentsView(ctx);
      if (a === "audit" && b === "shares") return await auditShares(ctx);
      if (a === "audit") return await auditViewData(ctx);
      if (a === "speed") return await speedViewData(ctx);
      if (a === "appointment-insights") return await appointmentInsightsView(ctx);
      if (a === "setup-compare") return await setupCompare(ctx);
      if (a === "segments") return await segmentsView(ctx);
      if (a === "meetings") return await meetingsView(ctx);
      if (a === "connections" && !b) return await connectionsView(ctx);
      if (a === "cleanup" && !b) return await cleanupView(ctx);
      if (a === "cleanup" && b) return await cleanupRunView(ctx, b);
      if (a === "playbooks") return await playbooksView(ctx);
      if (a === "start") return await startView(ctx);
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
      if (a === "sync-status") return await syncStatusView(ctx);
      if (a === "freshness") return await freshnessView(ctx);
      if (a === "pipeline-intel") return await pipelineIntel(ctx);
      if (a === "contact-intel") return await contactIntel(ctx);
      if (a === "team") return await teamView(ctx);
      if (a === "deal-events") return await dealMoves(ctx);
      if (a === "contact" && b && c && LOCATION_ID.test(b) && LOCATION_ID.test(c)) return await contactDetail(ctx, b, c);
      if (a === "call-queue") return await callQueueView(ctx);
      if (a === "call-lists") return await callListsView(ctx);
      if (a === "call-outcomes") return await callOutcomesView(ctx);
      if (a === "goals") return await goalsView(ctx);
      if (a === "exec-summary") return await execSummary(ctx);
      if (a === "daily-brief") return await dailyBrief(ctx);
      if (a === "comms-intel") return await commsIntel(ctx);
      if (a === "clients" && !b) return await clientsView(ctx);
      if (a === "clients" && b === "compare") return ctx.entitlements.features.reports === false ? json({ error: "This feature is switched off", feature: "reports", off: true }, 404) : await clientsCompare(ctx);
      if (a === "qbr" && b && LOCATION_ID.test(b)) return await qbrView(ctx, b);
      if (a === "digest") return await digestPreview(ctx);
    }
    if (method === "POST") {
      if (a === "email" && b === "check") return await emailCheck(ctx);
      if (a === "usage" && !b) return await usagePing(ctx);
      if (a === "audit" && b === "share") return await auditShare(ctx);
      if (a === "audit" && b === "revoke") return await auditRevoke(ctx);
      if (a === "roadmap" && !b) return await roadmapVote(ctx);
      if (a === "cleanup" && b === "preview") return await cleanupPreview(ctx);
      if (a === "cleanup" && b && c === "apply") return await cleanupWork(ctx, b, "apply");
      if (a === "cleanup" && b && c === "undo") return await cleanupWork(ctx, b, "undo");
      if (a === "connections" && b && c === "start") return await connectionStart(ctx, b);
      if (a === "meetings" && b === "hooks" && !c) return await meetingHookCreate(ctx);
      if (a === "meetings" && b === "hooks" && c && segments[3] === "revoke") return await meetingHookRevoke(ctx, c);
      if (a === "duplicates" && b === "review") return await duplicateReview(ctx);
      if (a === "duplicates" && b === "bulk") return await duplicateBulk(ctx);
      if (a === "duplicates" && b === "undo") return await duplicateUndo(ctx);
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
      if (a === "connections" && b && !c) return await connectionRemove(ctx, b);
      if (a === "call-lists" && b && /^[0-9a-fA-F-]{36}$/.test(b)) return await callListDelete(ctx, b);
    }
    if (method === "PUT") {
      if (a === "settings") return await settingsUpdate(ctx);
      if (a === "goals") return await goalsUpdate(ctx);
      if (a === "stage-rules") return await stageRuleSave(ctx);
      if (a === "meetings" && b) return await meetingUpdate(ctx, b);
      if (a === "team" && b && LOCATION_ID.test(b)) return await teamName(ctx, b);
      if (a === "clients" && b && LOCATION_ID.test(b)) return await clientUpdate(ctx, b);
      if (a === "accounts" && b && LOCATION_ID.test(b) && c === "flags") return await flags(ctx, b);
      if (a === "accounts" && b && LOCATION_ID.test(b) && c === "tasks") return await taskUpdate(ctx, b);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("API error", { path: segments.join("/"), message: safeError(error) });
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
