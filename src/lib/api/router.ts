import { atOf } from "../analytics/window-time";
import { validLogoUrl } from "@/lib/brand-logo";
import { sql } from "../db";
import { safeError } from "../safe-log";
import { dealTrust, leftOutRows, liveLocationIds } from "../analytics/deal-trust-queries";
import { HOW_LEFT_OUT, HOW_STALE_WORKED_OUT, countingLine, leftOutLine } from "../analytics/deal-trust";
import { buildDigest, onboardingChecklist, toCsv, type DerivedAccount } from "../analytics/derive";
import {
  allManualTasks, conversationCoverage, dismissAlert, domainCandidates, duplicateGroups, inbox, listAlerts, listDomainChecks, manualTasks, metricsTrend,
  dealHygiene, getSettings, pipelineCells, saveDomainCheck, searchContacts, setLocationFlags, setManualTask, staleDeals, staleDealsPage, updateSettings,
  visibleLocationIds, type Settings,
} from "../analytics/queries";
import { loadAccounts, refreshInsights } from "../analytics/service";
import { DIRTY_EXEMPT } from "../analytics/account-rollup";
import { markRollupDirty } from "../analytics/account-rollup-db";
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
import { changedLine, runState, stepRows, SYNC_THROTTLE_MS, throttle, type RunStatus } from "../sync/run-status";
import { enqueueFullSync, enqueueHardSync, enqueueJobs, enqueueLocationSync, enqueueQuickSync, runSlice, syncStatus } from "../sync/engine";
import { autoKinds, mayCheck, orderAccounts } from "../sync/incremental";
import { readDataVersion } from "../sync/data-version";
import { freshnessFor, syncPanel } from "../sync/freshness-queries";
import {
  abandonedDeals, accountSummaries, agingBuckets, avgCycleDays, coverage, deadPipeline, forecast, pipelineSummaries, riskyDeals, stageTable,
  valueDistribution, winLossByMonth, winRate,
} from "../analytics/pipeline-intel";
import { OUTCOME_LABEL, PRESETS, parseFilters, parseOutcome } from "../analytics/call-intel";
import { callQueueAll, createCallList, deleteCallList, listCallLists, logOutcome, MAX_LISTS, outcomeSummary, speedToLead } from "../analytics/call-queries";
import {
  activitySummary, anomalyIndices, contactGap, goalProgress, renewalStatus, roi, segmentStats, zAnomaly,
} from "../analytics/client-intel";
import { clientExtras, periodFigures, saveProfile, type ClientExtra, type ProfilePatch } from "../analytics/client-queries";
import { dailyPriorities, replyAging, setupScore, worstDomainStatus, type SetupFacts } from "../analytics/comms-intel";
import { channelCounts, channelLabel, CONVERSATIONS_READ_PER_ACCOUNT, readLimitNote, unreadSummary, WAITING_WINDOW_DAYS } from "../analytics/waiting";
import { attentionBand } from "../scoring";
import { loadStageRules, saveStageRule, stageInventory } from "../analytics/stage-rules-sql";
import { parseRulePatch, pipelineTreatment, ruleKey, stageProbability, treatmentOf } from "../analytics/stage-rules";
import { sourceSummary } from "../analytics/contact-intel";
import { MIN_MONEY_BASE_FOR_PERCENT, percentChange } from "../analytics/metrics";
import { afterHours, communicationGaps } from "../analytics/comms-queries";
import { contactOwners, listViews, removeView, saveView, teamNames } from "../analytics/inbox-queries";
import { assigneeLabel, MAX_SAVED_VIEWS, sanitizeQueue, viewName } from "../analytics/waiting-view";
import { badDataSamples, contactOverview, topLeads, vips } from "../analytics/contact-queries";
import { appointmentInsights } from "../analytics/appointment-insight-queries";
import { buildAudit } from "../analytics/audit-intel";
import { shareSourceOf } from "../analytics/audit-v2";
import { revokeShared } from "../analytics/share-queries";
import { clientPage, coreFor, pagePayload, type AuditBase, type Core } from "./audit-api";
import { AUDIT_RULES_VERSION, buildHistory, runsFromAudit, shareThenNow, type History, type RunRow } from "../analytics/au-history";
import { readPrefs, readStored, recordRuns, setAccountMute, setMonthlyOn } from "../analytics/au-history-queries";
import { ownedLocation } from "./tenant-guard";
import { handleClientsPart } from "./clients-book-routes";
import { appointmentList, staleDealList, waitingList, type AuditList } from "../analytics/audit-queries";
import { DEAL_RULES_VERSION } from "../analytics/definitions";
import { speedPart, speedView } from "../analytics/speed-queries";
import { isPart, parseWindow } from "../analytics/speed-window";
import { CHANGELOG, ROADMAP, STATUS_LABEL, STATUS_MEANING } from "../roadmap";
import { buildSharePayload } from "../analytics/share-intel";
import { randomBytes } from "node:crypto";
import { emailConfigured } from "../email";
import { validEmail } from "../analytics/weekly-email";
import { ACK_ESCALATION_GRACE_MAX, ACK_ESCALATION_GRACE_MIN } from "../analytics/unanswered-advanced";
import { appointmentBreakdown, appointmentDetail, appointmentView, setShowRateTarget } from "../analytics/appointment-queries";
import { clampTarget, parseFilters as parseApptFilters, parseWindow as parseApptWindow } from "../analytics/appointment-f3";
import { compareSetup, describe as describeDiff } from "../analytics/setup-intel";
import {
  baselineShare, compareTable, dealFigures, driftRows, endpoints, INDUSTRY_PICKER, lastSpokenMs, parseCompareIds, parseQuarter, pointsIn, previousQuarter, proofSummary,
  qbrFindings, quarterOf, quarterProgress, recentQuarters, SHARED_BASELINE, type Quarter,
} from "../analytics/client-success";
import { alertsOf, historyStart, noteSummaries, quarterFacts } from "../analytics/client-success-queries";
import * as clientRoutes from "./client-routes";
import { handleWorkflows } from "./workflows-api";
import { handleDataHealth } from "./data-health-api";
import { applyRun, createPreview, getRun, installationHasScope, listRuns, PREVIEW_VALID_HOURS, sampleChanges, undoRun } from "../analytics/cleanup-queries";
import { parseParams } from "../analytics/cleanup-intel";
import { demoWriter, platformWriter } from "../analytics/cleanup-writer";
import { availability, disconnect, startLink } from "../connections/flow";
import { listConnections } from "../connections/queries";
import { isProvider } from "../connections/state";
import { locationAccessToken } from "../sync/engine";
import { createHook, listHooks, listMeetings, MAX_HOOKS_PER_ACCOUNT, revokeHook, setMeetingStatus } from "../analytics/meeting-queries";
import { buildDailyDigest, NOT_WATCHED, seriesByLocation } from "../analytics/digest-service";
import { portfolioRangeChanges, validFromDay, validToDay } from "../analytics/today-intel";
import { buildToday } from "./today-api";
import { growthGoalSave, growthRead, growthSettingsSave, type GrowthDeps } from "./growth-api";
import { growthEmails } from "./growth-emails";
import { leadFlowRead } from "./lead-flow-api";
import { clientsFlowRead } from "./clients-flow-api";
import { briefFromToday, todayAction, todayBrief, userKeyOf as todayUserKey, type TodayDeps } from "./today-actions";
import { todayViewRemove, todayViewSave, todayViewsList } from "./today-views";
import { lanesFor } from "../analytics/today-state";
import { resolveEntitlements } from "../flags";
import type { Plan } from "../entitlements";
import { digestText, localParts } from "../analytics/digest-intel";
import { industryKey, industryOptions, matchesSegment, PLAYBOOKS } from "../analytics/playbooks";
import { buildQueue, recordBulk, recordDecision, summarise, undoDecision } from "../analytics/dedupe-queries";
import { bulkSelect, groupKey } from "../analytics/dedupe";
import { contactTimeline, dndSummary, leadSources, recentDealMoves, setTeamName, teamPace, teamStats, upcomingBirthdays } from "../analytics/people-queries";
import { paceOf, sourceConversion, teamLabel, teamWinRate } from "../analytics/people-intel";
import { excludedOpenDeals, getGoals, GOAL_METRICS, loadDeals, pipelineTrend, setGoal, type GoalMetric } from "../analytics/pipeline-queries";
import { MIN_CLOSED_DEALS as MIN_CLOSED, OUTLIER_MIN_DEALS, OUTLIER_SHARE, outlier as dealOutlier, winRateOf } from "../analytics/metrics";
import { parsePickedAccounts } from "../design/filters";
import { myConnectionRemove, myConnectionsView, myConnectionStart, myConnectionTest, policySave, teamConnectionRevoke, teamConnectionsView } from "./connections-api";
import { bellAction, bellView, copyPreview, copyReset, copySave, destinationAdvanced, destinationRemove, destinationsView, destinationStart, destinationTest, prefSave, prefsView, prefTest } from "./notifications-api";
import { meetingConfirm, meetingContactSearch, meetingDismiss, meetingIgnore, meetingInboxView, meetingLink, meetingSettingsSave } from "./meetings-api";
import { meetingLoggedView } from "./meeting-logged-api";
import { meetingSetupAccountView, meetingSetupFieldsSave, meetingSetupFieldsView, meetingSetupPreview, meetingSetupSaveMine, meetingSetupView } from "./meeting-setup-api";
import { can, personFromSession } from "../connections/person";
import { handlePeople, timeoutResponse } from "./people-routes";
import { handleDuplicates } from "./duplicates-routes";
import { handleCu } from "./cu-routes";
import { handleDq } from "./dq-routes";
import { handleWorkbench } from "./workbench-routes";
import { handleDial } from "./dial-routes";
import { handleBoard } from "./pipeline-board-routes";
import { handleCleanupV2 } from "./cleanup-routes";
import { gatedWriter } from "../ghl/crm-gateway";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { isLive } from "../live-flags";
import { answerKey, cachedAnswer, forgetAllReads, forgetAnswers, readCacheOn } from "../read-cache";
import { demoRead, forgetDemoAnswers } from "./demo-cache";
import { answerStoreKey, judgeAnswer, storable } from "../analytics/read-answers";
import { readAnswer, storeAnswer } from "../analytics/read-answers-db";
import { handleSpeedPrefs, handleSpeedDigest, handleSpeedLadder, handleSpeedPart, handleSpeedTarget } from "./speed-routes";
import { handleUnansweredOutcome, handleUnansweredPart } from "./unanswered-routes";
import { handleMoat } from "./moat-routes";
import { handleUnansweredActions } from "./unanswered-actions-routes";
import { handleUnansweredPart3, handleUnansweredViewRemove, handleUnansweredViewSave } from "./unanswered-routes3";
import { handleApptWork } from "./appointment-work-routes";
import { handleAppointments3 } from "./appointments3-routes";
import { handleSaleBasis } from "./sale-basis-routes";
import { handleOwnerlessDeals, handleTestDeals } from "./test-deals-routes";
import { handleApptExec, handleApptExecTarget } from "./appointments-exec-routes";
import { handleBfFunnel, handleBfRecover } from "./bf-routes";
import { handlePipeline3, handlePipelineHistorySettings } from "./pipeline3-routes";
import { handleClients3 } from "./clients3-routes";
import { handleProof } from "./proof-routes";
import { handleAiTeam } from "./ai-team-routes";
import { handleFinance } from "./finance-routes";
import { handleClients2 } from "./clients2-routes";
import { handlePeople3 } from "./people3-routes";
import { handleTeamRoles } from "./team-roles-routes";
import { handleSettings2 } from "./settings2-routes";
import { handlePayments } from "./payments-routes";
import { handleToday3, handleToday3Act } from "./today3-routes";
import { handleCash, handleCashAct } from "./cash-routes";
import { handleWg, handleWgAct } from "./wg-routes";
import { handleBr } from "./br-routes";
import { handleAi } from "./ai-routes";
import { handleAiData } from "./ai-data-routes";
import { handleWfm } from "./wfm-routes";
import { handleApptActions } from "./appointment-actions-routes";
import { handleMeetingList } from "./mn2-routes";
import { handleAm } from "./am-routes";
import { handlePipelineActions } from "./pipeline-actions-routes";
import { grantedOf } from "./workflows-api";
import { handleClientActions } from "./clients-actions-routes";
import { handlePeopleActions } from "./people-actions-routes";
import { buildSteps, guideRoleOf } from "../getting-started";
import { changedSettingKeys, feedbackGivenBy, logAccountFlags, logKeyChange, logSettingsChange, recordVote } from "../feedback-queries";
import { groupStatus, parseGranted } from "../scope-groups";
import { NOTE_SCOPE } from "../meeting-wording";
import { giveFeedback, history as settingsHistoryView, ownSuggestions, reportProblem, suggest, whoOf } from "./f8-routes";
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
// One request often asks for its settings, links and visible accounts several times (each handler's own helpers); work them out once per request.
const scopeMemo = new WeakMap<object, ReturnType<typeof computeScope>>();
function scope(ctx: Ctx) { let m = scopeMemo.get(ctx); if (!m) { m = computeScope(ctx); scopeMemo.set(ctx, m); } return m; }
const allowedMemo = new WeakMap<object, Promise<string[] | null>>();

async function computeScope(ctx: Ctx) {
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
    accountsFor(ctx), listAlerts(ctx.installationId, false, 500, ctx.limitTo ?? undefined, ctx.session.userId), freshnessFor(ctx.installationId, { limitTo: ctx.limitTo }), conversationCoverage(ctx.installationId),
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
  // The basis under the dollar tiles: the same shared function as Today and the Pipeline (deal-trust-queries.ts).
  const trust = ctx.demo ? null : await dealTrust(ctx.installationId, [...liveIds]).catch(() => null);
  return json({
    demo: ctx.demo,
    trust: trust ? { counting: countingLine(trust.counted.deals, trust.leftOut), leftOutLine: leftOutLine(trust.leftOut), leftOutDeals: trust.leftOut.deals, notJudged: trust.leftOut.notJudged, howStale: HOW_STALE_WORKED_OUT, howLeftOut: HOW_LEFT_OUT } : null,
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

// The instant audit: what is wrong right now, what it costs, and where to start. It covers exactly the accounts every other page covers under the same
// filter (the page filter is carried on the request, N8); the lists behind its numbers (KF-6) and the snapshot a share link keeps are both built from
// that same set of accounts, never from anything the browser names.
async function computeAudit(ctx: Ctx, withLists = false) {
  const { settings, accounts, hidden, links } = await accountsFor(ctx);
  const live = accounts.filter((a) => !a.ignored);
  const liveIds = live.map((a) => a.locationId);
  const liveSet = new Set(liveIds);
  const [v, coverageRows] = await Promise.all([appointmentView(ctx.installationId, liveIds), conversationCoverage(ctx.installationId)]);
  const appts = v.access.total === 0 ? null : {
    readable: v.access.ok, total: v.access.total, needPermission: v.access.needsPermission.length,
    unmarked: v.unmarkedTotal, noShowsToRecover: v.recoverTotal, unconfirmed48: v.unconfirmedTotal,
  };
  // SubSync reads the newest conversations of an account up to a limit; the waiting count says so when any account is at it (N15).
  const readLimit = readLimitNote(coverageRows.filter((c) => liveSet.has(c.locationId) && c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, live.length);
  const audit = buildAudit(live.map((a) => ({
    locationId: a.locationId, name: a.name, staleValue: a.staleValue, staleOpps: a.staleOpps, openValue: a.openValue, openOpps: a.openOpps, excludedOpen: a.excludedOpen ?? 0,
    unanswered: a.unanswered, winRate: a.winRate, avgDealValue: a.avgDealValue, completenessPct: a.completenessPct, contacts: a.contacts, topStaleDeal: a.topStaleDeal ?? 0,
    wonCount: a.wonCount, lostCount: a.lostCount,
  })), appts, { staleDays: settings.staleDays, slaHours: settings.slaHours, readLimit });
  const who = settings.brandName ?? (ctx.limitTo ? "Your business" : "Your company");
  let lists: Record<string, AuditList> | null = null;
  if (withLists) {
    const [stale, waiting] = await Promise.all([staleDealList(ctx.installationId, liveIds, settings.staleDays), waitingList(ctx.installationId, liveIds, settings.slaHours)]);
    const withUrl = (l: AuditList) => ({ ...l, rows: l.rows.map((r) => ({ ...r, url: r.contactId ? links.contact(r.locationId, r.contactId) : links.opportunities(r.locationId) })) });
    lists = { stale: withUrl(stale), slow: withUrl(waiting) };
    if (appts) { lists.unmarked = withUrl(appointmentList(v.unmarked, v.unmarkedTotal, "Started")); lists.noshows = withUrl(appointmentList(v.recover, v.recoverTotal, "No-show on")); }
  }
  return { audit, who, names: live.map((a) => a.name ?? "").filter(Boolean), settings, hidden, lists, readLimit, live, links, apptView: v };
}

// The rebuilt Account audit (docs/AUDIT_REVIEW.md). The accounts come from the signed session and the page filter, never from the request; the one thing the
// request may add is `location`, which only NARROWS to one of those accounts (an id that is not one of them changes nothing). The heavy read is kept for 45 seconds per
// caller scope, so paging the client list or opening the page twice does not read everything again; `fresh=1` (the Run again button) skips the kept copy.
async function auditScope(ctx: Ctx, wanted: string | null) {
  const { settings, accounts, hidden, links } = await accountsFor(ctx);
  let live = accounts.filter((a) => !a.ignored);
  const focus = wanted && LOCATION_ID.test(wanted) ? live.find((a) => a.locationId === wanted) ?? null : null;
  if (focus) live = [focus];
  const ids = live.map((a) => a.locationId);
  const idSet = new Set(ids);
  const base = async (): Promise<AuditBase> => {
    const [apptView, coverage] = await Promise.all([appointmentView(ctx.installationId, ids), conversationCoverage(ctx.installationId)]);
    return { settings, live, apptView, links, readLimit: readLimitNote(coverage.filter((c) => idSet.has(c.locationId) && c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, live.length) };
  };
  return { settings, hidden, ids, base, focus: focus ? { id: focus.locationId, name: focus.name ?? "Unnamed account" } : null };
}

// The rebuilt Clients screen (docs/CLIENTS_REVIEW.md): the client accounts come from the signed session and the page filter, the heavy read is the Account audit's own kept read
// (same accounts, same 45 seconds), and the route is agency only (the route policy refuses a business owner and a client's staff before this runs).
async function clientsBookPart(ctx: Ctx) {
  const { settings, accounts, links } = await accountsFor(ctx);
  const live = accounts.filter((a) => !a.ignored);
  const ids = live.map((a) => a.locationId);
  const idSet = new Set(ids);
  const base = async (): Promise<AuditBase> => {
    const [apptView, coverage] = await Promise.all([appointmentView(ctx.installationId, ids), conversationCoverage(ctx.installationId)]);
    return { settings, live, apptView, links, readLimit: readLimitNote(coverage.filter((c) => idSet.has(c.locationId) && c.stored >= CONVERSATIONS_READ_PER_ACCOUNT).length, live.length) };
  };
  const now = Date.now();
  return handleClientsPart({ ctx, settings, live, links, now, core: () => coreFor({ installationId: ctx.installationId, ids, limitTo: ctx.limitTo, now, base }) });
}

async function auditCore(ctx: Ctx, wanted: string | null, fresh = false) {
  const s = await auditScope(ctx, wanted);
  const core = await coreFor({ installationId: ctx.installationId, ids: s.ids, limitTo: ctx.limitTo, now: Date.now(), base: s.base, fresh });
  return { s, core };
}

const auOn = (ctx: Ctx, f: "au_history" | "au_onepager" | "au_monthly") => ctx.entitlements.features[f] !== false && !ctx.entitlements.locked.includes(f);

// The audit history (docs/features/AUDIT_BRIEF.md). Today's counts for the accounts this caller may read are stored once per account per day (the first read of the day stands),
// then compared with the first run and the last earlier run of the same accounts. The ids come from the audit's own scope (the signed session), never from the request.
// Accounts still being read for the first time are not stored (a zero there would be a false baseline). Never throws: the audit page works without its history.
async function auditHistoryOf(ctx: Ctx, core: Core): Promise<History | null> {
  if (ctx.demo || !auOn(ctx, "au_history")) return null;
  try {
    const unread = new Set(core.unreadIds);
    const runs = runsFromAudit(core.audit, core.accounts, core.calendars).filter((r) => !unread.has(r.locationId));
    await recordRuns(ctx.installationId, runs, core.now, "view");
    const ids = core.accounts.map((a) => a.id);
    const stored = await readStored(ctx.installationId, ids, core.now);
    const today = new Date(core.now).toISOString().slice(0, 10);
    const now: RunRow[] = runs.map((r) => ({ ...r, runDay: today, rulesVersion: AUDIT_RULES_VERSION, baseline: false }));
    return buildHistory({ today, now, stored, names: new Map(core.accounts.map((a) => [a.id, a.name])) });
  } catch (error) { console.error("Audit history failed", error instanceof Error ? error.message : "unknown"); return null; }
}

async function auditV2View(ctx: Ctx) {
  const sp = ctx.url.searchParams;
  const { s, core } = await auditCore(ctx, sp.get("location"), sp.get("fresh") === "1");
  const who = s.settings.brandName ?? (ctx.limitTo ? "Your business" : "Your company");
  // The history is a second, lazy read (?part=history) so the first screen never waits for it.
  if (sp.get("part") === "history") return json({ history: await auditHistoryOf(ctx, core) });
  return json({
    ...pagePayload(core, sp, { brand: { name: s.settings.brandName, color: s.settings.brandColor, logoUrl: s.settings.brandLogoUrl }, who }),
    history: null, au: { history: auOn(ctx, "au_history"), onepager: auOn(ctx, "au_onepager"), monthly: auOn(ctx, "au_monthly") && ctx.kind !== "client" },
    hiddenAccounts: ctx.limitTo ? 0 : s.hidden, focus: s.focus,
    // Sharing is for an agency or a business, never a client's own staff; the demo holds only the public sample.
    canShare: ctx.kind !== "client" && !ctx.demo, demo: ctx.demo, shareDays: SHARE_LINK_DAYS,
  });
}

/** One page of the client list (search, order, page), from the same kept read as the page. Only for an agency looking at more than one client account. */
async function auditClientsView(ctx: Ctx) {
  const sp = ctx.url.searchParams;
  const { core } = await auditCore(ctx, sp.get("location"));
  if (core.scope !== "all") return json({ error: "Not available in this view" }, 404);
  return json(clientPage(core, sp));
}

// The monthly re-audit message settings: on or off for the company, and mute for one client account. SubSync-only settings, for a business or an agency (never a client's staff).
// The account id passes the shared guard against the accounts this caller may read before anything is written, and is never echoed back.
async function auditPrefs(ctx: Ctx) {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  if (ctx.demo) return json({ error: "Not available in the demo" }, 400);
  const off = gate(ctx, "au_monthly");
  if (off) return off;
  const { accounts } = await accountsFor(ctx);
  const live = accounts.filter((a) => !a.ignored);
  const ids = live.map((a) => a.locationId);
  if (ctx.request.method === "POST") {
    const body = (await ctx.request.json().catch(() => null)) as { monthly?: unknown; location?: unknown; muted?: unknown } | null;
    if (typeof body?.monthly === "boolean") {
      await setMonthlyOn(ctx.installationId, body.monthly);
      await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'audit.monthly_toggled', ${sql().json({ on: body.monthly } as never)})`;
    }
    if (body?.location !== undefined) {
      const loc = await ownedLocation(ctx.installationId, ids, body.location);
      if (!loc || typeof body.muted !== "boolean") return json({ error: "Not found" }, 404);
      await setAccountMute(ctx.installationId, loc, body.muted);
    }
  }
  const prefs = await readPrefs(ctx.installationId, ids);
  const muted = new Set(prefs.muted);
  return json({ monthly: prefs.on, accounts: live.map((a) => ({ id: a.locationId, name: a.name ?? "Unnamed account", muted: muted.has(a.locationId) })) });
}

// A snapshot of the audit someone can send on: the sentence, the figures, finding titles, fix steps and definitions only, account names scrubbed, expires in SHARE_LINK_DAYS.
// It covers the same accounts as the page the person was looking at (the page filter, and the one client if they had opened one), and never holds a contact, a deal or a conversation.
async function auditShare(ctx: Ctx) {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  if (ctx.demo) return json({ error: "Sharing is not available in the demo" }, 400);
  const body = (await ctx.request.json().catch(() => null)) as { location?: unknown } | null;
  const { s, core } = await auditCore(ctx, typeof body?.location === "string" ? body.location : null);
  const who = s.settings.brandName ?? (ctx.limitTo ? "Your business" : "Your company");
  const id = randomBytes(24).toString("base64url");
  // The one-pager also carries the counts then and now (counts only) when the history is on and there is something comparable.
  const history = auOn(ctx, "au_onepager") ? await auditHistoryOf(ctx, core) : null;
  const thenNow = history?.thenNow ? shareThenNow(history.thenNow, core.accounts.length) : null;
  const payload = buildSharePayload(shareSourceOf(core.audit, core.healthy, core.accounts.length), who, core.accountNames, new Date(), { branded: s.settings.brandName !== null, brandColor: s.settings.brandColor, logoUrl: s.settings.brandLogoUrl, rulesVersion: DEAL_RULES_VERSION, thenNow });
  await sql()`insert into shared_audits (installation_id, id, payload, expires_at) values (${ctx.installationId}, ${id}, ${sql().json(payload as never)}, now() + make_interval(days => ${SHARE_LINK_DAYS}))`;
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
  // The screen asks for the last six characters of the link to be typed. When they are sent they must match (a mistyped confirmation switches nothing off).
  const typed = (body as { typed?: unknown }).typed;
  if (typed !== undefined && typed !== body.id.slice(-6)) return json({ error: "The confirmation does not match this link" }, 400);
  if (!(await revokeShared(ctx.installationId, body.id))) return json({ error: "That link was not found or is already switched off" }, 404);
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'audit.share_revoked', ${sql().json({ ref: body.id.slice(-6) } as never)})`;
  return json({ ok: true });
}

// How fast new leads get a first reply from a person.
// Every lead row (anything with a client account and a contact) gets the white-label link that opens it in the CRM, wherever it sits in the answer.
function withContactUrls<T>(value: T, link: (locationId: string, contactId: string) => string): T {
  if (Array.isArray(value)) return value.map((v) => withContactUrls(v, link)) as T;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = withContactUrls(v, link);
    if (typeof o.locationId === "string" && typeof o.contactId === "string") out.url = link(o.locationId, o.contactId);
    return out as T;
  }
  return value;
}

async function speedViewData(ctx: Ctx) {
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const part = ctx.url.searchParams.get("part");
  // One card of the screen over the range that card chose (KF-4). Same accounts, same rows, same judging as the main answer; the dates are checked here, never trusted.
  if (part !== null) {
    if (!isPart(part)) return json({ error: "Unknown part of this screen" }, 400);
    const now = Date.now();
    const win = parseWindow(ctx.url.searchParams.get("from"), ctx.url.searchParams.get("to"), now, atOf(ctx.url.searchParams));
    if (!win.ok) return json({ error: win.error }, 400);
    const cmpFrom = ctx.url.searchParams.get("cmpFrom"), cmpTo = ctx.url.searchParams.get("cmpTo");
    const cmp = cmpFrom || cmpTo ? parseWindow(cmpFrom, cmpTo, now) : null;
    if (cmp && !cmp.ok) return json({ error: "The comparison range is not valid: " + cmp.error }, 400);
    const out = await speedPart(ctx.installationId, allowed, sc.settings.speedTargetMinutes, part, win.win, cmp && cmp.ok ? cmp.win : null, now);
    return json(withContactUrls(out, sc.links.contact));
  }
  const v = await speedView(ctx.installationId, allowed, sc.settings.speedTargetMinutes);
  return json({
    ...v,
    // How the numbers are measured, shown on the page itself (N78): the reply target and whether automatic messages count. A client's staff can read it, not change it.
    measuring: { targetMinutes: sc.settings.speedTargetMinutes, countAutomated: sc.settings.countAutomatedTouches, businessHours: sc.settings.speedBusinessHours, canChange: ctx.kind !== "client" },
    waiting: v.waiting.map((w) => ({ ...w, url: sc.links.contact(w.locationId, w.contactId) })),
    // The leads behind each week of the trend, with the same white-label link as every other list (KF-6).
    trend: v.trend.map((w) => ({ ...w, members: w.members.map((m) => ({ ...m, url: sc.links.contact(m.locationId, m.contactId) })) })),
  });
}

// Voting is per person and counted inside the one installation, so one agency never sees another's votes.
const voterOf = (ctx: Ctx) => `${ctx.kind}:${ctx.limitTo ?? "agency"}:${ctx.session.userId ?? ""}`;

async function roadmapView(ctx: Ctx) {
  const rows = await sql()`select item_key, count(*)::int n, bool_or(voter = ${voterOf(ctx)}) mine from roadmap_votes where installation_id = ${ctx.installationId} group by item_key`;
  const by = new Map(rows.map((r) => [r.item_key as string, { n: r.n as number, mine: Boolean(r.mine) }]));
  // Statuses are words, with what each means; a shipped item has nothing left to vote for. Your own suggestions come with it (never anyone else's).
  return json({
    items: ROADMAP.map((i) => ({ ...i, label: STATUS_LABEL[i.status], votes: by.get(i.key)?.n ?? 0, voted: by.get(i.key)?.mine ?? false })),
    statusMeaning: STATUS_MEANING, changelog: CHANGELOG, mine: await ownSuggestions(ctx),
  });
}

async function roadmapVote(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { key?: unknown } | null;
  const item = typeof body?.key === "string" ? ROADMAP.find((i) => i.key === body.key) : undefined;
  if (!item) return json({ error: "Unknown item" }, 400);
  if (item.status === "shipped") return json({ error: "That one is already live, so there is nothing left to vote for." }, 400);
  const voter = voterOf(ctx);
  const gone = await sql()`delete from roadmap_votes where installation_id = ${ctx.installationId} and item_key = ${item.key} and voter = ${voter} returning 1`;
  if (gone.length === 0) {
    await sql()`insert into roadmap_votes (installation_id, item_key, voter) values (${ctx.installationId}, ${item.key}, ${voter}) on conflict do nothing`;
    await recordVote(ctx.installationId, actorOf(ctx), item.key); // a dry-run line for King's daily digest: ids only
  }
  return json({ ok: true, voted: gone.length === 0 });
}

// The date window and the three filters come from the address (from, to, cmpFrom, cmpTo, calendar, user, source). They only narrow what the caller is
// already allowed to see: the accounts are fixed by allowedIds, never by anything sent here.
function apptParams(ctx: Ctx) {
  const q = ctx.url.searchParams;
  return {
    window: parseApptWindow({ from: q.get("from"), to: q.get("to"), cmpFrom: q.get("cmpFrom"), cmpTo: q.get("cmpTo"), fromTime: q.get("fromTime"), toTime: q.get("toTime") }, Date.now()),
    filters: parseApptFilters({ calendar: q.get("calendar"), user: q.get("user"), source: q.get("source") }),
  };
}

// A list row with its white-label link to the contact. A booking with no contact has no link.
function withLink<T extends { locationId: string; contactId: string | null }>(sc: Awaited<ReturnType<typeof scope>>) {
  return (p: T) => ({ ...p, url: p.contactId ? sc.links.contact(p.locationId, p.contactId) : null });
}

async function appointmentsView(ctx: Ctx) {
  const sc = await scope(ctx);
  const v = await appointmentView(ctx.installationId, await allowedIds(ctx), Date.now(), apptParams(ctx));
  const link = withLink(sc);
  return json({
    ...v, canSeeAccounts: ctx.limitTo === null, canEditTargets: ctx.kind !== "client",
    items: v.items.map(link), upcoming: v.upcoming.map(link), unmarked: v.unmarked.map(link), recover: v.recover.map(link),
    // The "My day" page and the audit read this older shape: the people to remind (booked, not confirmed, within two days).
    unconfirmed: v.upcoming.filter((r) => r.unconfirmed).slice(0, 15).map(link),
  });
}

// The calendar, person and client-account breakdowns: their own window, the same three filters.
async function appointmentsBreakdownView(ctx: Ctx) {
  const sc = await scope(ctx);
  const v = await appointmentBreakdown(ctx.installationId, await allowedIds(ctx), Date.now(), apptParams(ctx));
  return json({ ...v, canSeeAccounts: ctx.limitTo === null, items: v.items.map(withLink(sc)) });
}

// One appointment. The account it belongs to must be one the caller may see; anything else is "not found", the same answer as an id that does not exist.
async function appointmentDetailView(ctx: Ctx, locationId: string, appointmentId: string) {
  const sc = await scope(ctx);
  const found = await appointmentDetail(ctx.installationId, await allowedIds(ctx), locationId, appointmentId);
  if (!found || !sc.permits(locationId)) return json({ error: "Appointment not found" }, 404);
  return json({ ...found, url: found.contact ? sc.links.contact(locationId, found.contact.contactId) : null });
}

// The show-rate target is the account's own setting. A client's staff cannot change it (the route policy refuses them too); the change is written to the audit log.
async function appointmentTargetUpdate(ctx: Ctx) {
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { showRate?: unknown } | null;
  const value = body?.showRate === null ? null : clampTarget(body?.showRate);
  if (body === null || (body.showRate !== null && value === null)) return json({ error: "Choose a show-rate target between 30% and 100%" }, 400);
  if (ctx.demo) return json({ error: "Targets cannot be changed in the demo" }, 400);
  await setShowRateTarget(ctx.installationId, value);
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${ctx.session.userId ?? ctx.kind}, 'appointments.target_changed', ${sql().json({ showRate: value } as never)})`;
  return json({ ok: true, showRate: value });
}

// The deeper read of the same calendars: show rate by time and source, recovery, fairness, follow-up gaps and
// a short brief before each upcoming appointment. Limited to the accounts the caller may see.
async function appointmentInsightsView(ctx: Ctx) {
  const sc = await scope(ctx);
  const v = await appointmentInsights(ctx.installationId, await allowedIds(ctx), Date.now(), apptParams(ctx));
  const link = (p: { locationId: string; contactId: string }) => sc.links.contact(p.locationId, p.contactId);
  const itemLink = withLink(sc);
  return json({
    ...v, canEditTargets: ctx.kind !== "client",
    items: v.items.map(itemLink),
    funnel: { ...v.funnel, steps: v.funnel.steps.map((s) => ({ ...s, members: s.members.map((m) => ({ ...m, url: link(m) })) })) },
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
    rows: base ? setups.filter((s) => s.locationId !== base.locationId && baselineShare(base, s) >= SHARED_BASELINE).map((s) => { const d = compareSetup(base, s); return { locationId: s.locationId, name: s.name, matches: d.matches, notes: describeDiff(d), share: baselineShare(base, s), drift: driftRows(base, s) }; }) : [],
    // Accounts that did not start from the baseline's template are not compared with it: a list of differences between two unrelated clients says nothing.
    unrelated: base ? setups.filter((s) => s.locationId !== base.locationId && baselineShare(base, s) < SHARED_BASELINE).map((s) => ({ locationId: s.locationId, name: s.name, pipelines: s.pipelines.length })) : [],
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
    pushNotesToCrm: sc.settings.pushNotesToCrm, noteWriteGranted: ctx.demo ? null : await installationHasScope(ctx.installationId, NOTE_SCOPE),
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
    runs, canWrite, masterSwitchOn: !ctx.demo && isLive("WRITE_GHL_LIVE"), accounts: locs.map((l) => ({ locationId: l.location_id as string, name: (l.name as string | null) ?? "Unnamed account" })),
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

  // The gateway (src/lib/ghl/crm-gateway.ts): this account must have allowed changes (Settings), and the server's master switch must be on. Otherwise the run is a dry run:
  // nothing is sent, one "WOULD WRITE" line is recorded and the changes stay waiting. The demo company is made up and always uses its own copy.
  const optedIn = ctx.demo || (await writeEnabledFor(ctx.installationId, run.locationId));
  if (!ctx.demo && !optedIn) {
    return json({ error: "Changing contacts is not switched on for this client account. Switch it on in Settings first. Nothing was changed.", notAllowed: true }, 403);
  }
  const live = !ctx.demo && isLive("WRITE_GHL_LIVE");
  if (live && !(await installationHasScope(ctx.installationId, "contacts.write"))) {
    return json({ error: "SubSync does not have permission to change contacts in this account yet. Nothing was changed.", needsPermission: true }, 403);
  }
  const writer = ctx.demo
    ? demoWriter(ctx.installationId, run.locationId)
    : gatedWriter(platformWriter(live ? await locationAccessToken(ctx.session.companyId, run.locationId) : ""), { installationId: ctx.installationId, locationId: run.locationId, actor: actorOf(ctx), runId: run.id, optedIn });
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
  // Only a workspace tool (Slack) is connected here, and only by an administrator. Personal tools are connected by each person under my-connections.
  if (provider !== "slack") return json({ error: "Connect your own tools from My connections" }, 404);
  const person = personFromSession(ctx.session, ctx.kind, ctx.limitTo);
  if (!person || !can(person.role, "connect_workspace")) return json({ error: "Only an administrator can connect Slack", forbidden: true }, 403);
  if (!isProvider(provider)) return json({ error: "Not found" }, 404);
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

// How the four headline figures on Today changed since the start of the window a card asked for (stage F5, KF-4). Same accounts as every other read
// (plan limit, the page filter, one account for a business); the only thing taken from the request is a start date, checked before it is used.
async function dailyChanges(ctx: Ctx) {
  const [{ today }] = await sql()`select current_date::text as today`;
  const from = validFromDay(ctx.url.searchParams.get("from"), today as string);
  if (!from) return json({ error: "Pick a start date within the last year and before today" }, 400);
  const to = validToDay(ctx.url.searchParams.get("to"), from, today as string);
  if (!to) return json({ error: "Pick an end date that is not before the start and not in the future" }, 400);
  const { accounts } = await accountsFor(ctx);
  const ids = accounts.filter((a) => !a.ignored).map((a) => a.locationId);
  const span = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 2;
  const series = await seriesByLocation(ctx.installationId, ids, span);
  return json({ from, to, accounts: ids.length, changes: portfolioRangeChanges([...series.values()], from, to) });
}

// The rebuilt Today: the ranked things to fix, the five kinds behind them, reply speed against the account's own usual and what SubSync caught (src/lib/api/today-api.ts).
// The accounts come from the signed session (a business or a client's staff see only their own, whatever `accounts=` says) and the page filter, never from a parameter alone.
async function todayData(ctx: Ctx) {
  const sc = await scope(ctx);
  const [allowed, audit] = await Promise.all([allowedIds(ctx), computeAudit(ctx, true)]);
  const userKey = todayUserKey(ctx);
  return buildToday({ installationId: ctx.installationId, kind: ctx.kind, limitTo: ctx.limitTo, now: Date.now(), allowed, settings: sc.settings, audit, links: sc.links, permits: sc.permits, lanes: lanesFor(ctx.kind, userKey), userKey });
}
async function todayView(ctx: Ctx) {
  return json(await todayData(ctx));
}
const todayDeps: TodayDeps = { load: (c) => todayData(c as Ctx), permits: async (c, locationId) => (await scope(c as Ctx)).permits(locationId) };
const growthDeps: GrowthDeps = {
  permits: async (c) => (await scope(c as Ctx)).permits,
  contactUrl: async (c) => (await scope(c as Ctx)).links.contact,
  accountUrl: async (c) => (await scope(c as Ctx)).links.account,
};

/** The daily brief for one company, built from the same Today read the screen uses (the scheduled brief calls this; it sends nothing itself). */
export async function todayBriefForInstallation(installationId: string, plan: Plan, companyId: string): Promise<{ headline: string; lines: string[] }> {
  const session = { companyId, userId: null, role: null, userName: null, demo: false, kind: "agency" as const, locationId: null, exp: 0 };
  const ctx: Ctx = { session, installationId, plan, demo: false, entitlements: await resolveEntitlements(plan, installationId), kind: "agency", limitTo: null, request: new Request("http://localhost/internal"), url: new URL("http://localhost/internal"), segments: ["today"] };
  return briefFromToday(await todayData(ctx));
}

const USAGE_VIEWS = new Set(["today", "overview", "accounts", "clients", "team", "search", "deals", "pipeline", "leads", "calls", "inbox", "onboarding", "email", "duplicates", "alerts", "settings", "help", "account", "meetings", "audit", "speed", "appointments", "people", "myday", "roadmap", "notifications", "workflows", "payments", "finance", "cleanup", "data-health", "connections"]);

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

// The Getting started guide for this person's role, with each step's real state. The steps and when they tick are in src/lib/getting-started.ts (unit tested);
// this only gathers the facts, all from the signed session's own installation. A client's staff get steps ticked from their own browser, not the company counter.
async function startView(ctx: Ctx) {
  const db = sql();
  const agency = ctx.kind === "agency";
  const [views, [locs], status, settings, [clientOn], accountRows, [shares], changed, given, [feeOn]] = await Promise.all([
    db`select distinct view from usage_events where installation_id = ${ctx.installationId}`,
    db`select count(*)::int total, count(*) filter (where contacts_synced_at is not null)::int synced from locations
        where installation_id = ${ctx.installationId} ${ctx.limitTo ? db`and location_id = ${ctx.limitTo}` : db``}`,
    syncStatus(ctx.installationId, ctx.limitTo),
    getSettings(ctx.installationId),
    agency ? db`select count(*)::int n from locations where installation_id = ${ctx.installationId} and client_view` : Promise.resolve([{ n: 0 }]),
    agency ? db`select name, ignored from locations where installation_id = ${ctx.installationId}` : Promise.resolve([]),
    agency ? db`select count(*)::int n from shared_audits where installation_id = ${ctx.installationId}` : Promise.resolve([{ n: 0 }]),
    ctx.kind === "client" ? Promise.resolve(new Set<string>()) : changedSettingKeys(ctx.installationId),
    feedbackGivenBy(ctx.installationId, whoOf(ctx).who),
    agency ? db`select count(*)::int n from account_profiles where installation_id = ${ctx.installationId} and monthly_fee is not null` : Promise.resolve([{ n: 0 }]),
  ]);
  const synced = locs.total > 0 && locs.synced === locs.total && status.pending === 0;
  const syncDetail = locs.total === 0
    ? (status.pending > 0 ? "Looking for your accounts..." : "No accounts found yet. The platform can take a minute after an install: press Sync now on the home page.")
    : synced ? `${locs.total} account${locs.total === 1 ? "" : "s"} read. ${(await freshnessFor(ctx.installationId, { limitTo: ctx.limitTo })).text}.`
    : `${locs.synced} of ${locs.total} account${locs.total === 1 ? "" : "s"} read, ${status.pending} job${status.pending === 1 ? "" : "s"} left.`;
  const role = guideRoleOf(ctx.kind, ctx.session.role);
  const steps = buildSteps(role, {
    synced, syncDetail, seen: new Set(views.map((v) => v.view as string)), companyUsage: ctx.kind !== "client",
    slackBrief: Boolean(settings.slackWebhookUrl) && settings.digestEnabled, emailSet: Boolean(settings.digestEmail), clientViewOn: clientOn?.n ?? 0,
    ignoredCount: accountRows.filter((r) => r.ignored === true).length, testLookingCount: accountRows.filter((r) => r.ignored !== true && isTestName(r.name as string | null)).length,
    changedKeys: changed, sharedAudits: shares?.n ?? 0, feedbackGiven: given,
    meetingsPage: ctx.entitlements.features.meetings !== false, zoomOn: zoomOn(ctx),
    clientFees: feeOn?.n ?? 0, clientsPage: ctx.entitlements.features.clients !== false,
    dealAi: { on: ctx.kind !== "client" && ctx.entitlements.features.ai_byo === true && (["ai_deal_health", "ai_deal_followup", "ai_deal_winloss", "ai_deal_forecast"] as const).some((k) => ctx.entitlements.features[k] === true), connected: ((await sql()`select count(*)::int n from ai_connections where installation_id = ${ctx.installationId} and status = 'connected'`.catch(() => []))[0]?.n ?? 0) > 0 },
  });
  // A client's staff never receive what the company set up in Settings (N84): their guide has no such step, and the facts above for it are empty.
  return json({ kind: ctx.kind, role, steps, doneCount: steps.filter((s) => s.done).length, total: steps.length });
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
    staleDeals(ctx.installationId, 0, 10, locationId),
    manualTasks(ctx.installationId, locationId),
    listDomainChecks(ctx.installationId),
    listAlerts(ctx.installationId, false, 200, undefined, ctx.session.userId),
  ]);
  const mine = domains.filter((d) => d.locationId === locationId);
  const worst = mine.find((d) => d.status === "critical") ?? mine.find((d) => d.status === "warning") ?? mine[0] ?? null;
  const checklist = onboardingChecklist(a, { domainStatus: worst?.status ?? null, manual, custom: settings.customChecklist });
  const [flagRow] = ctx.kind === "agency" ? await sql()`select client_view from locations where installation_id = ${ctx.installationId} and location_id = ${locationId}` : [];
  return json({
    clientView: flagRow?.client_view === true,
    brand: { name: settings.brandName, color: settings.brandColor, logoUrl: settings.brandLogoUrl },
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
  const { permits, links } = await scope(ctx);
  // The caller's own accounts only (the same ids that every number on the page was counted from).
  const ids = ((await allowedIds(ctx)) ?? (await liveLocationIds(ctx.installationId))).filter(permits);
  const left = ctx.url.searchParams.get("left") === "1";
  const [pg, trust, lo] = await Promise.all([
    left ? null : staleDealsPage(ctx.installationId, { ids, limit: 500 }),
    dealTrust(ctx.installationId, ids),
    left ? leftOutRows(ctx.installationId, ids, null, 500, 0) : null,
  ]);
  const basis = { counting: countingLine(trust.counted.deals, trust.leftOut), leftOutLine: leftOutLine(trust.leftOut), leftOutDeals: trust.leftOut.deals, notJudged: trust.leftOut.notJudged, howStale: HOW_STALE_WORKED_OUT, howLeftOut: HOW_LEFT_OUT };
  if (lo) {
    return json({
      leftOut: true, total: lo.total, totalValue: lo.rows.reduce((s, d) => s + d.value, 0), trust: basis,
      deals: lo.rows.map((d) => ({ opportunityId: d.opportunityId, locationId: d.locationId, locationName: d.locationName, name: d.name, contactName: d.contactName, value: d.value, pipelineName: d.pipeline, stageName: d.stage, lastActivityAt: null, daysStale: d.daysInStep, leftOutReason: d.reason, url: links.opportunities(d.locationId) })),
    });
  }
  return json({
    leftOut: false, total: pg?.total ?? 0, totalValue: pg?.totalValue ?? 0, trust: basis,
    deals: (pg?.rows ?? []).map((d) => ({ ...d, url: links.opportunities(d.locationId) })),
  });
}

async function inboxView(ctx: Ctx) {
  const { settings, permits, links } = await scope(ctx);
  // The same list and the same window as the Today and Overview counts: nothing is cut short at a few hundred, and if the list ever is
  // (more than the limit), the screen says so instead of showing a smaller number as if it were the total.
  const LIMIT = 2000;
  const [fetched, coverage, names] = await Promise.all([inbox(ctx.installationId, settings.slaHours, LIMIT, ctx.limitTo ?? undefined), conversationCoverage(ctx.installationId), teamNames(ctx.installationId)]);
  const rows = fetched.filter((r) => permits(r.locationId));
  const late = rows.filter((r) => r.overSla);
  const seen = coverage.filter((c) => permits(c.locationId));
  // Who each conversation's contact is assigned to, as a name (N21). The conversation list does not say who a conversation is assigned to, so the
  // contact's own team member is used; the page says so.
  const owners = await contactOwners(ctx.installationId, rows);
  const now = Date.now();
  const items = rows.map((r) => {
    const assignedTo = r.contactId ? owners.get(r.locationId + ":" + r.contactId) ?? null : null;
    const at = r.lastMessageAt ? Date.parse(r.lastMessageAt) : NaN;
    return {
      ...r, assignedTo, assignee: assigneeLabel(assignedTo, names), ageHours: Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 3_600_000)) : null,
      channel: channelLabel(r.lastMessageType), url: links.conversation(r.locationId, r.conversationId),
    };
  });
  // "Assigned to me" is offered only to a person who really is assigned some of these contacts (their own sign-in id, never anyone else's).
  const me = ctx.session.userId && items.some((i) => i.assignedTo === ctx.session.userId) ? ctx.session.userId : null;
  return json({
    me,
    namesMissing: items.some((i) => i.assignedTo !== null && !names.has(i.assignedTo)),
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
    items,
  });
}

// A person's saved views of the Unanswered messages page (per person, kept on the server so they follow the person to another device). The owner key is
// derived here from the verified session, never from anything the browser sends.
async function inboxViews(ctx: Ctx) {
  return json({ views: await listViews(ctx.installationId, voterOf(ctx)), max: MAX_SAVED_VIEWS });
}

async function inboxViewSave(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as { name?: unknown; filters?: unknown } | null;
  const name = viewName(body?.name);
  if (!name) return json({ error: "Give the view a name of up to 40 characters" }, 400);
  const outcome = await saveView(ctx.installationId, voterOf(ctx), name, sanitizeQueue(body?.filters));
  if (outcome === "full") return json({ error: "You can keep " + MAX_SAVED_VIEWS + " saved views. Remove one first." }, 409);
  return json({ ok: true, views: await listViews(ctx.installationId, voterOf(ctx)), max: MAX_SAVED_VIEWS });
}

async function inboxViewRemove(ctx: Ctx, id: string) {
  const gone = await removeView(ctx.installationId, voterOf(ctx), id);
  return gone ? json({ ok: true, views: await listViews(ctx.installationId, voterOf(ctx)), max: MAX_SAVED_VIEWS }) : json({ error: "View not found" }, 404);
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
  // Recording many decisions at once is for whoever runs the company or the business; a client's staff decide one group at a time.
  if (ctx.kind === "client") return json({ error: "Not available in this view" }, 403);
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
  const rows = (await listAlerts(ctx.installationId, includeResolved, 300, ctx.limitTo ?? undefined, ctx.session.userId)).filter((a) => !seg || (a.locationId !== null && seg.has(a.locationId)));
  return json({ alerts: rows.map((a) => ({ ...a, locationName: a.locationId ? names.get(a.locationId) ?? null : null })) });
}

const settingsView = async (ctx: Ctx) => {
  const { settings } = await loadAccounts(ctx.installationId);
  const [counts] = ctx.kind === "agency" ? await sql()`select count(*)::int total, count(*) filter (where client_view)::int on_ from locations where installation_id = ${ctx.installationId}` : [null];
  const accts = ctx.kind === "agency" ? await sql()`select location_id, name, client_view from locations where installation_id = ${ctx.installationId} and not ignored order by lower(coalesce(name, ''))` : [];
  // Is a meeting tool connected? Its privacy switches stay visible even while the Meeting notes page is off.
  const [meetingTool] = await sql()`select 1 from connections where installation_id = ${ctx.installationId} and provider in ('fathom', 'zoom') ${zoomOn(ctx) ? sql()`` : sql()`and provider <> 'zoom'`} limit 1`;
  // Which permissions this install granted (names only), grouped by what they are for (N64). Not known for the demo, so nothing is marked missing there.
  const [inst] = await sql()`select scope from installations where id = ${ctx.installationId}`;
  const granted = ctx.demo || typeof inst?.scope !== "string" || inst.scope.trim() === "" ? null : parseGranted(inst.scope as string);
  // Every client account, ignored ones too, so the owner can leave a test account out of every number or put it back (N1). Agency sessions only.
  const everyAccount = ctx.kind === "agency" ? await sql()`select location_id, name, ignored from locations where installation_id = ${ctx.installationId} order by lower(coalesce(name, ''))` : [];
  return json({
    features: ctx.entitlements.features, settings: publicSettings(settings), slackConfigured: Boolean(settings.slackWebhookUrl), kind: ctx.kind, canDeleteData: ctx.session.dataOwner === true, meetingTool: Boolean(meetingTool),
    clientView: counts ? { on: counts.on_ as number, total: counts.total as number } : null, clientAccounts: accts.map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", on: r.client_view === true })),
    permissions: groupStatus(granted), noteWriteGranted: granted === null ? null : granted.includes(NOTE_SCOPE),
    testAccounts: everyAccount.map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", ignored: r.ignored === true, looksTest: isTestName(r.name as string | null) })),
  });
};

function publicSettings(s: Settings) {
  // Never send the webhook URL back to the browser: it is a secret.
  return { staleDays: s.staleDays, dormantDays: s.dormantDays, slaHours: s.slaHours, appDomain: s.appDomain, appDomainSource: s.appDomainSource, detectedDomain: s.detectedDomain, digestEnabled: s.digestEnabled, customChecklist: s.customChecklist, digestHour: s.digestHour, digestTimezone: s.digestTimezone, digestEmail: s.digestEmail, emailReady: emailConfigured(), brandName: s.brandName, brandColor: s.brandColor, brandLogoUrl: s.brandLogoOverride, detectedLogoUrl: s.brandLogoUrl && !s.brandLogoOverride ? s.brandLogoUrl : null, industryTargets: s.industryTargets, keepTranscripts: s.keepTranscripts, pushNotesToCrm: s.pushNotesToCrm, speedTargetMinutes: s.speedTargetMinutes, countAutomatedTouches: s.countAutomatedTouches, speedBusinessHours: s.speedBusinessHours, speedOpenHour: s.speedOpenHour, speedCloseHour: s.speedCloseHour, alertQuietHours: s.alertQuietHours, inboxAckGraceMinutes: s.inboxAckGraceMinutes, coldTags: s.coldTags };
}

const INSIGHT_SETTINGS = new Set(["staleDays", "dormantDays", "slaHours", "speedTargetMinutes", "countAutomatedTouches", "speedBusinessHours", "speedOpenHour", "speedCloseHour", "industryTargets", "alertQuietHours"]);

async function settingsUpdate(ctx: Ctx) {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  const patch: Partial<Settings> & { appDomainOverride?: string | null } = {};
  const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  if ("staleDays" in body) { const v = int(body.staleDays, 7, 365); if (v === null) return json({ error: "Stale days must be between 7 and 365" }, 400); patch.staleDays = v; }
  if ("dormantDays" in body) { const v = int(body.dormantDays, 7, 365); if (v === null) return json({ error: "Days before an account counts as gone quiet must be between 7 and 365" }, 400); patch.dormantDays = v; }
  if ("slaHours" in body) { const v = int(body.slaHours, 1, 168); if (v === null) return json({ error: "Reply target hours must be between 1 and 168" }, 400); patch.slaHours = v; }
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
  if ("inboxAckGraceMinutes" in body) {
    const v = int(body.inboxAckGraceMinutes, ACK_ESCALATION_GRACE_MIN, ACK_ESCALATION_GRACE_MAX);
    if (v === null) return json({ error: `Alert escalation must be between ${ACK_ESCALATION_GRACE_MIN} and ${ACK_ESCALATION_GRACE_MAX} minutes` }, 400);
    patch.inboxAckGraceMinutes = v;
  }
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
  if ("brandLogoUrl" in body) {
    if (body.brandLogoUrl === null || body.brandLogoUrl === "") patch.brandLogoOverride = null;
    else if (validLogoUrl(body.brandLogoUrl)) patch.brandLogoOverride = validLogoUrl(body.brandLogoUrl);
    else return json({ error: "Use a web address that starts with https:// and has no ? or #" }, 400);
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
  // Every change to a setting is written to the audit log: the names of the settings, never their values (a Slack address is a secret).
  await logSettingsChange(ctx.installationId, actorOf(ctx), ctx.kind, [...Object.keys(patch), ...("clientViewAll" in body && ctx.kind === "agency" ? ["clientViewAll"] : [])]);
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
  await logAccountFlags(ctx.installationId, actorOf(ctx), ctx.kind, locationId, Object.keys(patch));
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
      const rows = (await staleDeals(ctx.installationId, 0, 5000, ctx.limitTo ?? undefined)).filter((d) => permits(d.locationId));
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
      const [owners, who] = await Promise.all([contactOwners(ctx.installationId, rows), teamNames(ctx.installationId)]);
      return file("subsync-inbox", toCsv(rows, [
        { label: "Account", value: (r) => r.locationName }, { label: "Contact", value: (r) => r.contactName }, { label: "Channel", value: (r) => r.lastMessageType },
        { label: "Last message", value: (r) => r.lastMessageAt }, { label: "Direction", value: (r) => r.lastMessageDirection },
        { label: "Channel", value: (r) => channelLabel(r.lastMessageType) }, { label: "Unread", value: (r) => r.unreadCount }, { label: "Past reply target", value: (r) => (r.overSla ? "yes" : "no") }, { label: "Waiting hours", value: (r) => r.waitingHours },
        { label: "Assigned to", value: (r) => assigneeLabel(r.contactId ? owners.get(r.locationId + ":" + r.contactId) ?? null : null, who) },
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
      const rows = (await listAlerts(ctx.installationId, false, 2000, ctx.limitTo ?? undefined, ctx.session.userId)).filter((a) => !alertSeg || (a.locationId !== null && alertSeg.has(a.locationId)));
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
  await logKeyChange(ctx.installationId, actorOf(ctx), ctx.kind, true);
  return json({ key: created.key, row: created.row });
}

async function keysRevoke(ctx: Ctx, id: string) {
  if (!UUID.test(id)) return json({ error: "Key not found" }, 404);
  if (!(await revokeKey(ctx.installationId, id))) return json({ error: "Key not found" }, 404);
  await logKeyChange(ctx.installationId, actorOf(ctx), ctx.kind, false);
  return json({ ok: true });
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

const SYNC_SLICE_MS = 12_000;
const SYNC_WORKERS = 4;

// One sync per account per 30 seconds: the latest queued job of this scope (one account, or the whole company) decides.
async function syncTooSoon(ctx: Ctx, locationId: string | null) {
  const [r] = await sql()`select max(created_at) t from sync_jobs where installation_id = ${ctx.installationId} and (${locationId}::text is null or location_id = ${locationId})`;
  const t = throttle(r?.t instanceof Date ? r.t.getTime() : null, Date.now());
  return t.ok ? null : json({ error: `A sync just started. Try again in ${t.retryAfterSec} seconds.`, retryAfterSec: t.retryAfterSec, throttledMs: SYNC_THROTTLE_MS }, 429);
}

// The status popup of "Sync now": progress by account while it runs, then what changed. `since` is when the person pressed the button.
async function syncRunView(ctx: Ctx) {
  const sinceRaw = ctx.url.searchParams.get("since") ?? "";
  const sinceMs = Date.parse(sinceRaw);
  const since = Number.isFinite(sinceMs) ? new Date(Math.min(sinceMs, Date.now())) : new Date(Date.now() - 60_000);
  if (ctx.demo) {
    const empty: RunStatus = { state: "done", startedAt: since.toISOString(), lastFinishedAt: new Date().toISOString(), accounts: [], progress: { done: 1, total: 1 }, changed: { contacts: 0, conversations: 0, appointments: 0 }, changes: [], errors: [] };
    return json(empty);
  }
  const allowed = await allowedIds(ctx);
  const only = allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``;
  const db = sql();
  const [jobs, names, c1, c2, c3, fails, [last], stepJobs] = await Promise.all([
    db`select location_id, status, count(*)::int n from sync_jobs where installation_id = ${ctx.installationId} and created_at >= ${since} and location_id is not null ${only} group by location_id, status`,
    db`select location_id, name from locations where installation_id = ${ctx.installationId} ${only}`,
    db`select location_id, count(*)::int n from cached_contacts where installation_id = ${ctx.installationId} and synced_at >= ${since} ${only} group by location_id`,
    db`select location_id, count(*)::int n from cached_conversations where installation_id = ${ctx.installationId} and synced_at >= ${since} ${only} group by location_id`,
    db`select location_id, count(*)::int n from cached_appointments where installation_id = ${ctx.installationId} and synced_at >= ${since} ${only} group by location_id`,
    db`select location_id, error from sync_jobs where installation_id = ${ctx.installationId} and created_at >= ${since} and status = 'failed' ${only} order by finished_at desc limit 5`,
    db`select max(finished_at) f from sync_jobs where installation_id = ${ctx.installationId} and status = 'done'`,
    db`select type, location_id, status, started_at, finished_at, error from sync_jobs where installation_id = ${ctx.installationId} and created_at >= ${since} and location_id is not null ${only} order by created_at, id limit 60`,
  ]);
  const nameOf = new Map(names.map((r) => [r.location_id as string, (r.name as string | null) ?? null]));
  const acc = new Map<string, { locationId: string; name: string | null; pending: number; done: number; failed: number }>();
  for (const j of jobs) {
    const id = j.location_id as string;
    const a = acc.get(id) ?? { locationId: id, name: nameOf.get(id) ?? null, pending: 0, done: 0, failed: 0 };
    if (j.status === "pending" || j.status === "running") a.pending += j.n; else if (j.status === "done") a.done += j.n; else a.failed += j.n;
    acc.set(id, a);
  }
  const accounts = [...acc.values()].sort((a, b) => b.pending - a.pending || (a.name ?? "").localeCompare(b.name ?? ""));
  const tot = accounts.reduce((t, a) => ({ pending: t.pending + a.pending, done: t.done + a.done, failed: t.failed + a.failed }), { pending: 0, done: 0, failed: 0 });
  const by = new Map<string, { locationId: string; name: string | null; contacts: number; conversations: number; appointments: number }>();
  const add = (rows: ArrayLike<Record<string, unknown>>, k: "contacts" | "conversations" | "appointments") => {
    for (const r of Array.from(rows)) { const id = r.location_id as string; const e = by.get(id) ?? { locationId: id, name: nameOf.get(id) ?? null, contacts: 0, conversations: 0, appointments: 0 }; e[k] += Number(r.n); by.set(id, e); }
  };
  add(c1, "contacts"); add(c2, "conversations"); add(c3, "appointments");
  const changes = [...by.values()].sort((a, b) => b.contacts + b.conversations + b.appointments - (a.contacts + a.conversations + a.appointments)).slice(0, 10);
  const changed = { contacts: c1.reduce((t, r) => t + Number(r.n), 0), conversations: c2.reduce((t, r) => t + Number(r.n), 0), appointments: c3.reduce((t, r) => t + Number(r.n), 0) };
  const out: RunStatus = {
    state: runState(tot), startedAt: since.toISOString(), lastFinishedAt: last?.f instanceof Date ? last.f.toISOString() : null, accounts, progress: { done: tot.done + tot.failed, total: tot.pending + tot.done + tot.failed },
    changed, changes, errors: fails.map((f) => ({ locationId: (f.location_id as string | null) ?? null, error: String(f.error ?? "A read failed").slice(0, 160) })),
    steps: stepRows(stepJobs as never, nameOf, Date.now()),
  };
  return json({ ...out, line: changedLine(changed), version: await readDataVersion(ctx.installationId, allowed) });
}

// What a sync call asks for: `full` is the hard sync (re-read everything, in the background), `focus` is the account on screen (worked first).
async function syncBody(ctx: Ctx): Promise<{ full: boolean; focus: string | null }> {
  const b = (await ctx.request.json().catch(() => null)) as { full?: unknown; focus?: unknown } | null;
  return { full: b?.full === true, focus: typeof b?.focus === "string" && LOCATION_ID.test(b.focus) ? b.focus : null };
}

// The accounts a sync may touch for this person: the ones they can see, not ignored.
async function syncableIds(ctx: Ctx, only?: string): Promise<string[]> {
  const allowed = await allowedIds(ctx);
  const rows = await sql()`select location_id from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``}`;
  const ids = rows.map((r) => r.location_id as string);
  return only ? ids.filter((i) => i === only) : ids;
}

async function syncStart(ctx: Ctx) {
  if (ctx.demo) {
    await refreshInsights(ctx.installationId);
    return json({ ok: true, demo: true });
  }
  const { full, focus } = await syncBody(ctx);
  const ids = await syncableIds(ctx);
  if (full) {
    // The hard sync re-reads everything. It is queued and works in the background: this call returns after a short first slice and never blocks a screen.
    const tooSoon = await syncTooSoon(ctx, ctx.limitTo ?? null);
    if (tooSoon) return tooSoon;
    await enqueueHardSync(ctx.installationId, ids);
    await enqueueFullSync(ctx.installationId);
  } else {
    // The normal sync reads only what changed since the last good read (contacts and deals), so a big account no longer holds everything else up.
    await enqueueQuickSync(ctx.installationId, ids);
    await enqueueJobs(ctx.installationId, [null], ["metrics"]);
  }
  // Work now, side by side, on this install only; the popup keeps calling sync/work until nothing is left, and cron catches anything that is still open.
  const slice = await runSlice(full ? 4_000 : SYNC_SLICE_MS, { installationId: ctx.installationId, locationId: ctx.limitTo ?? null, focusLocationId: focus ?? ctx.limitTo ?? null, concurrency: SYNC_WORKERS });
  return json({ ok: true, ...slice, full, status: await syncStatus(ctx.installationId) });
}

const AUTO_SLICE_MS = 6_000;
// The automatic check: called when SubSync opens, when the tab comes back and about once a minute while it is visible. For the account on screen first (then the ones checked longest ago,
// at most five) it queues the cheap incremental reads, never twice for one account (the queue refuses a duplicate while one is pending or running), and works them for a few seconds.
// Nothing changed = one small read per kind and no refresh signal. Returns the data version: when it moves, the screen re-reads its own data.
async function syncAuto(ctx: Ctx) {
  if (ctx.demo) return json({ ok: true, state: "live", updatedAt: Date.now(), version: 0, pending: 0, failed: false });
  const { focus: asked } = await syncBody(ctx);
  const allowed = await allowedIds(ctx);
  const db = sql();
  const rows = await db`
    select l.location_id, l.conversations_synced_at, w.last_checked_at from locations l
    left join sync_watermarks w on w.installation_id = l.installation_id and w.location_id = l.location_id and w.kind = 'contacts'
    where l.installation_id = ${ctx.installationId} and not l.ignored ${allowed ? sql()`and l.location_id = any(${allowed}::text[])` : sql()``}`;
  const ids = rows.map((r) => r.location_id as string);
  const focus = (asked && ids.includes(asked) ? asked : null) ?? (ctx.limitTo && ids.includes(ctx.limitTo) ? ctx.limitTo : null);
  const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
  const checked = new Map(rows.map((r) => [r.location_id as string, ms(r.last_checked_at)]));
  const busyRows = await db`select distinct location_id from sync_jobs where installation_id = ${ctx.installationId} and status in ('pending', 'running') and location_id is not null`;
  const busy = new Set(busyRows.map((r) => r.location_id as string));
  const now = Date.now();
  const pick = orderAccounts(ids, focus, checked).filter((id) => mayCheck({ lastCheckedMs: checked.get(id) ?? null, nowMs: now, busy: busy.has(id) }));
  for (const id of pick) {
    const row = rows.find((r) => r.location_id === id);
    await enqueueQuickSync(ctx.installationId, [id], autoKinds({ nowMs: now, conversationsSyncedMs: ms(row?.conversations_synced_at) }));
  }
  if (pick.length > 0) await runSlice(AUTO_SLICE_MS, { installationId: ctx.installationId, locationId: ctx.limitTo ?? null, focusLocationId: focus, concurrency: SYNC_WORKERS });
  const scopeIds = focus ? [focus] : ids;
  const [[p], [f], [u]] = await Promise.all([
    db`select count(*)::int n from sync_jobs where installation_id = ${ctx.installationId} and status in ('pending', 'running') and location_id = any(${scopeIds}::text[])`,
    db`select count(*)::int n from sync_jobs where installation_id = ${ctx.installationId} and status = 'failed' and finished_at > now() - interval '10 minutes' and location_id = any(${scopeIds}::text[])`,
    db`select max(last_checked_at) t from sync_watermarks where installation_id = ${ctx.installationId} and kind = 'contacts' and location_id = any(${scopeIds}::text[])`,
  ]);
  const version = await readDataVersion(ctx.installationId, allowed);
  return json({ ok: true, updatedAt: ms(u?.t) ?? 0, version, pending: p.n as number, failed: (f.n as number) > 0, focus, checkedAccounts: pick.length });
}

function allowedIds(ctx: Ctx): Promise<string[] | null> {
  let m = allowedMemo.get(ctx); if (!m) { m = computeAllowedIds(ctx); allowedMemo.set(ctx, m); } return m;
}

async function computeAllowedIds(ctx: Ctx): Promise<string[] | null> {
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
  const pipelines = [...new Set(inv.map((r) => r.pipeline))].map((name) => {
    const t = pipelineTreatment(name, rules), rows = inv.filter((r) => r.pipeline === name), outreach = t.source !== 'owner' && rows.some((r) => r.outreach);
    // A bulk outreach list is suggested as not counted (deal-trust.ts); the owner can mark it In use to count it.
    return { name, ...t, notInUse: t.notInUse || outreach, outreach, counted: rows.reduce((a, r) => a + r.countedDeals, 0), why: outreach ? `Looks like a bulk outreach list (${Math.max(...rows.map((r) => r.pipeDeals)).toLocaleString('en-US')} deals, most in one step with the same amount), not a sales pipeline. Its deals are left out of every dollar figure until you mark it In use.` : t.why };
  });
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
  const [rows, pace, [acc]] = await Promise.all([
    teamStats(ctx.installationId, allowed, sc.settings.staleDays), teamPace(ctx.installationId, allowed),
    // How the last read of the team list went for the accounts in view, so a person who has no name can be explained instead of shown as an id.
    sql()`select count(*) filter (where users_access = 'ok')::int ok, count(*) filter (where users_access = 'needs_permission')::int blocked from locations
      where installation_id = ${ctx.installationId} and not ignored ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``}`,
  ]);
  const usersState = Number(acc?.ok) > 0 ? "ok" : Number(acc?.blocked) > 0 ? "needs_permission" : null;
  return json({
    staleDays: sc.settings.staleDays,
    members: rows.map((r) => ({ ...r, label: teamLabel(r.userId, r.name, usersState), winRate: teamWinRate(r), pace: paceOf(pace.get(r.userId) ?? { replies: 0, medianSeconds: null, held: 0, noShow: 0 }) })),
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
  // One page of up to CALL_PAGE rows (the list holds at most 400 candidates); the whole list is read once and kept for a short time, so turning the page is instant.
  const page = Math.min(4, Math.max(1, Math.floor(Number(params.page)) || 1));
  const started = Date.now();
  try {
    const [queue, speed, summary, sc] = await Promise.all([
      callQueueAll(ctx.installationId, allowed, parsed.filters), speedToLead(ctx.installationId, allowed), outcomeSummary(ctx.installationId), scope(ctx),
    ]);
    return json({
      presets: PRESETS, filters: parsed.filters, outcomes: OUTCOME_LABEL, total: queue.total, capped: queue.total >= 400, page, pages: Math.max(1, Math.ceil(queue.total / CALL_PAGE)), pageSize: CALL_PAGE,
      speedToLead: speed, summary, tookMs: Date.now() - started, cached: queue.cached === true,
      rows: queue.rows.slice((page - 1) * CALL_PAGE, page * CALL_PAGE).map((row) => ({ ...row, url: sc.links.contact(row.locationId, row.contactId) })),
    });
  } catch (error) {
    const t = timeoutResponse(error, "call-queue");
    if (t) return t;
    throw error;
  }
}
const CALL_PAGE = 100;

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

type ClientNotes = { count: number; lastConversationOn: string | null; lastNote: { body: string; author: string | null; on: string } | null };
// money and notes are the counted-deal figures and the log of conversations (stage C1): Value created uses the same counted deals as every other screen, and
// "last spoken" is the later of the "I spoke to them today" press and the newest logged conversation.
function clientRow(a: DerivedAccount, e: ClientExtra | undefined, avgCycle: number | null, links: ReturnType<typeof deepLinks>, now: number, emailAuth: SetupFacts["emailAuth"] = "unchecked", money?: { pipelineCreated: number; wonValue: number; wonCount: number }, notes?: ClientNotes) {
  const fee = e?.monthlyFee ?? null;
  const spoken = lastSpokenMs(e?.lastContactedAt ?? null, notes?.lastConversationOn ? [notes.lastConversationOn] : []);
  const installed = e?.installedAt ?? null;
  const daysIn = installed === null ? null : Math.floor((now - installed) / 86_400_000);
  const hasWon = (e?.firstWonAt ?? null) !== null;
  return {
    locationId: a.locationId, name: a.name, url: links.account(a.locationId), score: a.score, band: a.band, churn: a.churn.level, dormant: a.dormant,
    new30d: a.new30d, openValue: a.openValue, unanswered: a.unanswered, completenessPct: a.completenessPct, winRate: a.winRate, avgCycleDays: avgCycle,
    profile: { monthlyFee: fee, renewalDate: e?.renewalDate ?? null, industry: e?.industry ?? null, notes: e?.notes ?? null, lastContactedAt: spoken === null ? null : new Date(spoken).toISOString() },
    log: { count: notes?.count ?? 0, lastNote: notes?.lastNote ?? null },
    roi: roi({ monthlyFee: fee, pipelineCreated30d: money?.pipelineCreated ?? e?.pipelineCreated30d ?? 0, wonValue30d: money?.wonValue ?? e?.wonValue30d ?? 0 }),
    renewal: renewalStatus(e?.renewalDate ?? null, now),
    contactGap: contactGap(spoken, now),
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
  const [{ accounts, links }, extras, deals, domainOf, notes] = await Promise.all([accountsFor(ctx), clientExtras(ctx.installationId, allowed), loadDeals(ctx.installationId, allowed), domainStatusByAccount(ctx.installationId), noteSummaries(ctx.installationId, allowed)]);
  const cycles = new Map(accountSummaries(deals, now).map((s) => [s.locationId, s.avgCycleDays]));
  const money = dealFigures(deals, now - 30 * 86_400_000, now);
  const rows = accounts.filter((a) => !a.ignored).map((a) => clientRow(a, extras.get(a.locationId), cycles.get(a.locationId) ?? null, links, now, domainOf(a.locationId), money.get(a.locationId) ?? { pipelineCreated: 0, wonValue: 0, wonCount: 0 }, notes.get(a.locationId)));
  const withFee = rows.filter((x) => x.profile.monthlyFee !== null);
  const atRisk = (x: (typeof rows)[number]) => x.band === "at_risk" || x.churn === "high" || x.dormant;
  return json({
    clients: rows.sort((a, b) => a.score - b.score),
    revenue: {
      monthly: withFee.reduce((s, x) => s + (x.profile.monthlyFee ?? 0), 0),
      atRisk: withFee.filter(atRisk).reduce((s, x) => s + (x.profile.monthlyFee ?? 0), 0),
      clientsWithFee: withFee.length,
    },
    // First-use guidance (KF-7): nobody has typed a fee, a renewal date or an industry yet, so the screen explains what to do instead of showing bare "n/a".
    firstUse: { noFees: withFee.length === 0, noRenewals: rows.every((x) => !x.profile.renewalDate), noIndustry: rows.every((x) => !x.profile.industry), noLog: rows.every((x) => x.log.count === 0) },
    industryChoices: INDUSTRY_PICKER.map((p) => p.value),
    renewals: rows.filter((x) => x.renewal && x.renewal.bucket !== "later").sort((a, b) => (a.renewal?.daysLeft ?? 0) - (b.renewal?.daysLeft ?? 0))
      .map((x) => ({ locationId: x.locationId, name: x.name, daysLeft: x.renewal?.daysLeft ?? 0, bucket: x.renewal?.bucket ?? "later", fee: x.profile.monthlyFee })),
    segments: segmentStats(rows.map((x) => ({ industry: x.profile.industry, score: x.score, winRate: x.winRate, openValue: x.openValue }))),
    compare: rows.map((x) => ({ locationId: x.locationId, name: x.name ?? "Unnamed account", new30d: x.new30d, winRate: x.winRate, avgCycleDays: x.avgCycleDays, unanswered: x.unanswered, completenessPct: x.completenessPct, score: x.score, openValue: x.openValue })),
  });
}

// Two or more clients side by side (ids=a,b,c; the older a and b still work), each figure against the average of the clients picked, with the
// clients that are far apart highlighted (client-success.ts). Missing figures stay missing: no guessing.
async function clientsCompare(ctx: Ctx) {
  const ids = parseCompareIds(ctx.url.searchParams.get("ids"), ctx.url.searchParams.get("a"), ctx.url.searchParams.get("b"), (x) => LOCATION_ID.test(x));
  if (ids.length < 2) return json({ error: "Pick at least two different clients" }, 400);
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const [{ accounts }, deals] = await Promise.all([accountsFor(ctx), loadDeals(ctx.installationId, allowed)]);
  const cycles = new Map(accountSummaries(deals, now).map((s) => [s.locationId, s.avgCycleDays]));
  const picked = ids.map((id) => accounts.find((acc) => acc.locationId === id && !acc.ignored)).filter((x): x is DerivedAccount => Boolean(x));
  if (picked.length !== ids.length) return json({ error: "Account not found" }, 404);
  const clients = picked.map((x) => ({
    locationId: x.locationId, name: x.name ?? "Unnamed account",
    values: { score: x.score, new30d: x.new30d, openValue: x.openValue, winRate: x.winRate, avgCycleDays: cycles.get(x.locationId) ?? null, unanswered: x.unanswered, completenessPct: x.completenessPct },
  }));
  return json({ clients, ...compareTable(clients) });
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

// A quarterly review of one client (stage C1): the quarter asked for (default: the current one, which is said to be still running), the quarter before it,
// their numbers, wins and issues, the daily series behind the charts, and "what SubSync caught". Everything is read from what SubSync holds; where its record
// does not reach back (it only knows what it saw since it started watching), the review says so instead of drawing an empty chart.
async function qbrView(ctx: Ctx, locationId: string) {
  const now = Date.now();
  const allowed = await allowedIds(ctx);
  const asked = ctx.url.searchParams.get("quarter");
  const quarter: Quarter | null = asked ? parseQuarter(asked) : quarterOf(now);
  if (!quarter) return json({ error: "Pick a quarter like 2026-Q4" }, 400);
  const previous = previousQuarter(quarter);
  const [{ accounts, links, settings }, extras, deals, domainOf, notes, alerts, start, days] = await Promise.all([
    accountsFor(ctx), clientExtras(ctx.installationId, allowed), loadDeals(ctx.installationId, allowed, locationId), domainStatusByAccount(ctx.installationId),
    noteSummaries(ctx.installationId, allowed), alertsOf(ctx.installationId, locationId), historyStart(ctx.installationId, locationId), clientRoutes.trendDays(ctx.installationId, locationId, 400),
  ]);
  const a = accounts.find((x) => x.locationId === locationId && !x.ignored);
  if (!a) return json({ error: "Account not found" }, 404);
  const avgCycle = accountSummaries(deals, now)[0]?.avgCycleDays ?? null;
  const money = dealFigures(deals, now - 30 * 86_400_000, now);
  const client = clientRow(a, extras.get(locationId), avgCycle, links, now, domainOf(locationId), money.get(locationId), notes.get(locationId));
  const [cur, prev, speed] = await Promise.all([
    quarterFacts(ctx.installationId, locationId, quarter, deals), quarterFacts(ctx.installationId, locationId, previous, deals),
    speedView(ctx.installationId, [locationId], settings.speedTargetMinutes).catch(() => null),
  ]);
  const openAlerts = alerts.filter((x) => !x.resolvedAt).length;
  const findings = qbrFindings(cur, prev.healthDays > 0 || prev.contactsAdded > 0 ? prev : null, {
    dormant: a.dormant, unanswered: a.unanswered, staleOpps: a.staleOpps, completenessPct: a.completenessPct, openAlerts, monthlyFee: client.profile.monthlyFee,
    replyHitRate: speed?.overall.hitRate ?? null, replyLeads: speed?.overall.leads ?? 0,
  });
  const progress = quarterProgress(quarter, now);
  const current = pointsIn(days, quarter.from, quarter.to);
  return json({
    brand: { name: settings.brandName, color: settings.brandColor, logoUrl: settings.brandLogoUrl }, client, openAlerts, generatedAt: new Date(now).toISOString(),
    quarter: { ...quarter, ...progress }, previous, quarters: recentQuarters(now, 6).map((q) => ({ key: q.key, label: q.label })),
    facts: cur, previousFacts: prev, findings, proof: proofSummary(alerts, quarter), historyStartsOn: start,
    series: { current, previous: pointsIn(days, previous.from, previous.to) },
    health: endpoints(current.map((p) => p.healthScore)),
    // How fast new leads got a first reply lately (the Speed to lead page's own figure, last two weeks); its history is shorter than a quarter, so it is said as such.
    reply: speed ? { hitRate: speed.overall.hitRate, leads: speed.overall.leads, targetMinutes: speed.targetMinutes, windowDays: speed.windowDays } : null,
  });
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
  // The deals with no contact moved to Pipeline (read by deal-gaps). The Unanswered messages page asks for gaps=0 so it does not pay for them.
  const wantGaps = ctx.url.searchParams.get("gaps") !== "0";
  const [rows, gaps, after] = await Promise.all([inbox(ctx.installationId, sc.settings.slaHours, 2000), wantGaps ? communicationGaps(ctx.installationId, allowed) : Promise.resolve(null), afterHours(ctx.installationId, allowed)]);
  // The same set as the Inbox list and the Today count (N15): the customer wrote last, past the reply target, inside the window. Never every inbound thread.
  const waiting = rows.filter((x) => sc.permits(x.locationId) && x.overSla && x.waitingHours !== null).map((x) => x.waitingHours as number);
  return json({
    aging: replyAging(waiting),
    ...(gaps ? { gaps: { ...gaps, deals: gaps.deals.map((d) => ({ ...d, url: sc.links.opportunities(d.locationId) })) } } : {}),
    afterHours: after,
  });
}

// Counted open deals whose contact has gone quiet (moved here from the Unanswered messages page). The same deals and the same rules as the Pipeline
// (a value, an owner, in play); the total is counted over all of them and the rows are the first ones, the screen says how many there are in all.
async function dealGaps(ctx: Ctx) {
  const sc = await scope(ctx);
  const allowed = await allowedIds(ctx);
  const asked = Number(ctx.url.searchParams.get("days"));
  const days = [7, 14, 30].includes(asked) ? asked : 7;
  const gaps = await communicationGaps(ctx.installationId, allowed, days, 200);
  return json({ ...gaps, deals: gaps.deals.map((d) => ({ ...d, url: sc.links.opportunities(d.locationId) })) });
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
  const { full } = await syncBody(ctx);
  if (full) {
    const tooSoon = await syncTooSoon(ctx, locationId);
    if (tooSoon) return tooSoon;
    await enqueueLocationSync(ctx.installationId, locationId); // a hard sync of one account: everything is read again
  } else {
    await enqueueQuickSync(ctx.installationId, [locationId]);
  }
  // Only this account's steps, side by side: a small account is finished in well under 20 seconds, whoever else is queued.
  const slice = await runSlice(SYNC_SLICE_MS, { installationId: ctx.installationId, locationId, concurrency: SYNC_WORKERS });
  return json({ ok: true, ...slice });
}

// The sync popup keeps calling this while steps are still waiting (each call works for a few seconds, side by side), so a sync never waits for the next 5-minute tick.
async function syncWork(ctx: Ctx) {
  if (ctx.demo) return json({ ok: true, moreWork: false });
  const slice = await runSlice(SYNC_SLICE_MS, { installationId: ctx.installationId, locationId: ctx.limitTo ?? null, concurrency: SYNC_WORKERS });
  return json({ ok: true, ...slice });
}

async function testSlack(ctx: Ctx) {
  const { settings } = await loadAccounts(ctx.installationId);
  if (!settings.slackWebhookUrl) return json({ error: "Add a Slack webhook URL first" }, 400);
  const ok = await postToSlack(settings.slackWebhookUrl, ":white_check_mark: SubSync is connected to this channel.", { installationId: ctx.installationId, what: "slack.test_message" });
  return ok ? json({ ok: true }) : json({ error: "Slack did not accept the message. Check the webhook URL." }, 502);
}

async function digestPreview(ctx: Ctx) {
  const d = await buildDailyDigest(ctx.installationId, { limitTo: ctx.limitTo, planLimit: accountLimit(ctx.plan, ctx.entitlements.enforced), onlyIds: await segmentSet(ctx) });
  return json({ text: digestText(ctx.demo ? "Demo Company" : "your company", { attention: d.attention, fine: d.fine.length, headlines: d.headlines, freshnessLabel: d.freshness.text }, ctx.url.origin) });
}

// ---------------- routing ----------------

// What the Clients module's own routes (client-routes.ts) need from this file.
// Who did it is the person's name from sign-in, never a raw id (N21): without a name the line says "Someone".
const clientDeps: clientRoutes.Deps = { allowedIds, accountsFor, actorOf: (ctx) => ctx.session.userName ?? null, locationId: LOCATION_ID };

const FEATURE_FOR: Record<string, Feature> = {
  "data-health": "data_health", search: "search", onboarding: "onboarding", stale: "stale", inbox: "inbox", pipelines: "pipelines", duplicates: "duplicates", email: "email",
  "meeting-inbox": "meetings", "meeting-setup": "meetings", "meeting-logged": "meetings", "meeting-list": "meetings", "my-connections": "connections", "team-connections": "connections", "meeting-policy": "connections", alerts: "alerts", notifications: "alerts", "notification-prefs": "alerts", "notification-destinations": "alerts", appointments: "appointments", audit: "audit", speed: "speed", "appointment-insights": "appointments", meetings: "meetings", connections: "connections", cleanup: "cleanup", cu: "cleanup", "setup-compare": "setup_compare", playbooks: "playbooks", daily: "overview", today: "overview", team: "team", "deal-events": "pipelines", contact: "search", settings: "settings", export: "exports", digest: "overview", "api-keys": "ai", hygiene: "stale", "pipeline-intel": "pipelines", "contact-intel": "activity", clients: "clients", qbr: "reports", "comms-intel": "inbox", "deal-gaps": "pipelines", "call-queue": "calls", "call-lists": "calls", "call-outcomes": "calls", people: "search", workbench: "search", dial: "calls", workflows: "workflows", "client-onboarding": "onboarding",
};

// The reads that are heavy and are opened again and again (Speed to lead and Appointments, every part). Their finished answer is kept for 30 seconds per installation + person + exact
// address (read-cache.ts), so a second click, or a colleague on the same screen, is instant. Any change (POST, PUT, DELETE) forgets them as soon as it finishes. The digest read and the lists that carry a
// person's own marks are included because the key holds the person.
const HEAVY_READ = new Set(["speed", "appointments"]);

// Every answer carries how long it took (Server-Timing: visible in the browser's network panel), and a read that took SLOW_API_MS or more writes one log line with the route name only
// (ids are masked; no query values, no names, no tokens), so the slow screens can be found in the host's logs.
const SLOW_API_MS = 2_500;
export async function handle(request: Request, segments: string[]): Promise<Response> {
  const t0 = performance.now();
  const res = await handleTimed(request, segments);
  const ms = Math.round(performance.now() - t0);
  try { res.headers.set("Server-Timing", `app;dur=${ms}`); } catch { /* an immutable response keeps no header */ }
  if (ms >= SLOW_API_MS) {
    const part = new URL(request.url).searchParams.get("part");
    console.warn("slow_api", { route: segments.map((s) => (/^[A-Za-z0-9_-]{12,}$/.test(s) ? ":id" : s)).join("/"), part: part && /^[a-z0-9_-]{1,30}$/i.test(part) ? part : null, method: request.method, status: res.status, ms });
  }
  return res;
}

async function handleTimed(request: Request, segments: string[]): Promise<Response> {
  const auth = await authenticate(request, segments);
  if (isResponse(auth)) return auth;
  const ctx: Ctx = { ...auth, request, url: new URL(request.url), segments };
  if (request.method !== "GET") {
    // The automatic check runs every minute or so on every open tab: it must not empty the read caches or mark the rollup dirty (a sync that really changed rows does that itself, data-version.ts).
    const auto = segments[0] === "sync" && segments[1] === "auto";
    try { return await dispatch(ctx); } finally { if (!auto) { forgetDemoAnswers(); forgetAllReads(); forgetAnswers(ctx.installationId); if (!DIRTY_EXEMPT.test(segments[0] ?? "")) await markRollupDirty(ctx.installationId).catch(() => undefined); } }
  }
  // A demo session keeps its finished answers in memory (demo-cache.ts), so a screen opened twice is instant.
  if (ctx.demo) return demoRead(`${ctx.installationId}|${ctx.kind}:${ctx.limitTo ?? ""}|${ctx.url.pathname}?${[...ctx.url.searchParams].filter(([k]) => k !== "_r").map(([k, v]) => `${k}=${v}`).join("&")}`, ctx.url.searchParams.has("_r"), () => readAnswerOrCompute(ctx));
  return readAnswerOrCompute(ctx);
}

async function readAnswerOrCompute(ctx: Ctx): Promise<Response> {
  const { request, segments } = ctx;
  // The race is "right now" (it refreshes itself), so it is always read fresh.
  const stored = storable(request.method, segments, ctx.url.searchParams);
  if ((HEAVY_READ.has(segments[0]) && ctx.url.searchParams.has("part") && ctx.url.searchParams.get("part") !== "race") || stored) {
    const who = `${ctx.kind}:${ctx.limitTo ?? ""}:${ctx.session.userId ?? ""}`;
    const key = answerKey(ctx.installationId, who, `${ctx.url.pathname}?${ctx.url.searchParams.toString()}`);
    const compute = async () => { const r = await dispatch(ctx); return { status: r.status, body: await r.text() }; };
    // Round 6: the finished answer is also kept in the database (read_answers), so the first click on a cold server instance is one lookup. Fresh for 5 minutes, shown while a new one is made for 30,
    // never used after a change was made through SubSync (dirty), never shared between people or installations (the key holds both). A "Try again" (_r) always recomputes.
    const make = async () => {
      if (!stored || !readCacheOn()) return compute();
      const sk = answerStoreKey(who, ctx.url.pathname, ctx.url.searchParams);
      const hit = ctx.url.searchParams.has("_r") ? null : await readAnswer(ctx.installationId, sk).catch(() => null);
      const verdict = judgeAnswer(hit);
      if (hit && verdict !== "unusable") {
        if (verdict === "stale") void compute().then((o) => o.status === 200 ? storeAnswer(ctx.installationId, sk, o.body) : undefined).catch(() => undefined);
        return { status: 200, body: hit.body };
      }
      const o = await compute();
      if (o.status === 200) void storeAnswer(ctx.installationId, sk, o.body).catch(() => undefined);
      return o;
    };
    const out = await cachedAnswer(key, make);
    return new Response(out.body, { status: out.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  return dispatch(ctx);
}

async function dispatch(ctx: Ctx): Promise<Response> {
  const { segments, request } = ctx;
  const [a, b, c] = segments;
  const method = request.method;

  const blocked = FEATURE_FOR[a] ? gate(ctx, FEATURE_FOR[a]) : null;
  if (blocked) return blocked;

  try {
    if (a === "data-health") return await handleDataHealth(ctx, { allowed: allowedIds, token: (c, loc) => locationAccessToken(c.session.companyId, loc), links: async () => (await scope(ctx)).links });
    if (a === "workflows") return await handleWorkflows(ctx, { allowed: allowedIds, token: (c, loc) => locationAccessToken(c.session.companyId, loc) });
    if (a === "people") {
      return await handlePeople(ctx, {
        allowed: () => allowedIds(ctx),
        links: async () => (await scope(ctx)).links,
        coldChoice: async () => (ctx.kind === "client" ? null : (await getSettings(ctx.installationId)).coldTags),
        voter: voterOf(ctx),
        locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId),
        settings: async () => { const st = (await scope(ctx)).settings; return { staleDays: st.staleDays, speedTargetMinutes: st.speedTargetMinutes }; },
      });
    }
    // The Lead workbench (stage MOAT): the live conversation, the preview and the one gateway every write goes through (switched off by default).
    if (a === "dial") return await handleDial(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    if (a === "workbench") return await handleWorkbench(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    // Appointments round 3: /api/app/appointments?part=... (overview, lists, booking share, flow tree, health, sources, calendars, reminders, receipt, detail; read only).
    // Appointments, Leadership tab: /api/app/appointments/exec?part=... (read only) and PUT .../exec-target (SubSync-only monthly target).
    if (a === "appointments" && b === "sale-basis" && !c && (method === "GET" || method === "PUT")) return await handleSaleBasis(ctx);
    if (a === "deal-rules" && b === "test-names" && !c && (method === "GET" || method === "PUT")) return await handleTestDeals(ctx);
    if (a === "deal-rules" && b === "ownerless" && !c && (method === "GET" || method === "PUT")) return await handleOwnerlessDeals(ctx);
    if (a === "appointments" && b === "exec" && !c && method === "GET") return await handleApptExec(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    // Appointments, Booking funnel: GET /api/app/appointments/funnel?part=... (read only) and POST .../funnel-recover (tags dropped leads; preview, caps, dry run unless live; flags bf_*).
    if (a === "appointments" && b === "funnel" && !c && method === "GET") return await handleBfFunnel(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId), actor: actorOf });
    if (a === "appointments" && b === "funnel-recover" && !c && method === "POST") return await handleBfRecover(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId), actor: actorOf });
    if (a === "appointments" && b === "exec-target" && !c && method === "PUT") return await handleApptExecTarget(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    if (a === "appointments" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handleAppointments3(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Pipeline round 3: /api/app/pipeline3?part=... (overview, money flow, attention, won and lost, forecast, people, sources, stage history, health, receipt, lists, detail; read only).
    if (a === "pipeline3" && b === "history-settings" && !c && method === "PUT") return await handlePipelineHistorySettings(ctx);
    if (a === "pipeline3" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handlePipeline3(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Branded client Proof page and monthly report (stage PR): reports per client account, the secret client link, settings. Agency staff only; flags pr_* checked inside.
    if (a === "proof") return await handleProof(ctx, { allowed: () => allowedIds(ctx), settings: async () => (await scope(ctx)).settings });
    // Finance (stage FN): money overview, client revenue, churn watch, setter and closer payouts, billing notes. Managers see everything; anyone else only their own payout statement (decided inside).
    if (a === "finance") return await handleFinance(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    // Clients round 3: /api/app/clients3?part=... (overview, needs attention, trends, compare, receipt, people, setup, lists; read only).
    if (a === "clients3" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handleClients3(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Payments: /api/app/payments?part=... (today, queue, item, disputes, upcoming, history, options, setup, export; read only) and /api/app/payments/act/<note|dispute|dispute-edit|dispute-remove|resend>
    // (SubSync's own notes and dispute log; resend is off). Flags, the account and the person are checked inside.
    if (a === "payments" && ((method === "GET" && !b && ctx.url.searchParams.has("part")) || (method === "POST" && b === "act" && ctx.segments.length === 3))) {
      return await handlePayments(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, brand: async () => (await scope(ctx)).settings.brandName ?? null, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    // Clients v2 (client-account management): /api/app/clients2?part=... (accounts, today, plans needing attention, one account) and /api/app/clients2/<op> (SubSync-only notes, kind of business, saved views).
    if (a === "clients2" && ((method === "GET" && !b && ctx.url.searchParams.has("part")) || (method === "POST" && b && ctx.segments.length === 2))) {
      return await handleClients2(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Today (front page): /api/app/today3?part=... (today, list, proof, numbers, settings, export; read only) and /api/app/today3/act/... (SubSync-only notes).
    if (a === "today3" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handleToday3(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    if (a === "today3" && b === "act" && ctx.segments.length === 3) {
      return await handleToday3Act(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Settings, guides and What's new (stage ST): /api/app/st/<home|state|connections|progress>. Per-person marks only; never changes the CRM or a setting.
    if (a === "st" && ctx.segments.length === 2) return await handleSettings2(ctx);
    // Cash features: /api/app/cash?part=... (save this account, recover, deals; read only) and /api/app/cash/act/... (SubSync notes; the one CRM change, an owner change, goes through the safe gateway).
    if (a === "cash" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handleCash(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, targets: async () => { const st = (await scope(ctx)).settings; return { slaHours: st.slaHours, targetMinutes: st.speedTargetMinutes }; }, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    if (a === "cash" && b === "act" && ctx.segments.length === 3) {
      return await handleCashAct(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, targets: async () => { const st = (await scope(ctx)).settings; return { slaHours: st.slaHours, targetMinutes: st.speedTargetMinutes }; }, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    // Wallet guard: /api/app/wg?part=... (summary, list, account, settings, usage, options; read only) and /api/app/wg/act/... (SubSync's own limits, pauses and who is alerted). Owners and admins only.
    if (a === "wg" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handleWg(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    if (a === "wg" && b === "act" && ctx.segments.length === 3) {
      return await handleWgAct(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Workflow blocks: /api/app/wfm and /api/app/wfm/act/set. Administrators only (checked inside); flag wf_module.
    if (a === "wfm" && ((method === "GET" && !b) || (b === "act" && ctx.segments.length === 3 && ctx.segments[2] === "set"))) {
      return await handleWfm(ctx, { allowed: () => allowedIds(ctx) });
    }
    // Bring your own AI: /api/app/ai?part=... and /api/app/ai/act/<name>. Administrators only for the connection (checked inside); flag ai_byo.
    if (a === "ai-team" && ((method === "GET" && !b) || (b === "act" && ctx.segments.length === 3))) return await handleAiTeam(ctx, { allowed: () => allowedIds(ctx) });
    if (a === "ai" && ((method === "GET" && !b) || (b === "act" && ctx.segments.length === 3) || (b === "lead" && ctx.segments.length === 3))) {
      return await handleAi(ctx, { allowed: () => allowedIds(ctx), locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId), links: async () => (await scope(ctx)).links });
    }
    // AI data jobs (Ask your data, data review, cleaning proposals, duplicate judge, setup auditor): /api/app/aid?part=... and /api/app/aid/act/<name>. Each job has its own flag; checked inside.
    if (a === "aid" && ((method === "GET" && !b) || (b === "act" && ctx.segments.length === 3))) {
      return await handleAiData(ctx, { allowed: () => allowedIds(ctx) });
    }
    // The 7 am brief: /api/app/br?part=brief|text|settings|history and /api/app/br/act/<settings|test|seen|acted>. Owners and admins only; every choice is the signed-in person's own.
    if (a === "br" && ((method === "GET" && !b && ctx.url.searchParams.has("part")) || (b === "act" && ctx.segments.length === 3))) {
      return await handleBr(ctx);
    }
    // Team (people) module: /api/app/people3?part=... (today, scorecards, workload, leaderboard, money, coaching, access, proof, person, handoff, next lead, lists; read only).
    if (a === "people3" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      return await handlePeople3(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // Appointments actions and meetings (slice AB): the panel, preview-then-do changes, bulk, undo, and the private Meetings area (each behind its own flag, checked inside).
    if (a === "appointments" && (b === "act" || b === "meetings") && ctx.segments.length === 3) {
      return await handleApptActions(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    // Pipeline deal actions (slice PB): the deal panel, preview-then-do changes, bulk and undo (flags and the account are checked inside).
    // Clients actions and reports (slice CB): /api/app/clients/act/<part> (weekly receipt, CSV, setup health, quiet marks, reply targets). Agency only by the route policy.
    if (a === "clients" && b === "act" && ctx.segments.length === 3) {
      return await handleClientActions(ctx, { allowed: () => allowedIds(ctx), brand: async () => (await scope(ctx)).settings.brandName ?? null, defaultTarget: async () => (await scope(ctx)).settings.speedTargetMinutes, granted: () => grantedOf(ctx), onboarding: () => clientRoutes.onboardingView(ctx, clientDeps) });
    }
    // Team actions and reports (slice PB): /api/app/people3/act/<part> (coaching notes, targets, away marks, lead moves with undo, the client receipt). Flags, the account and the person are checked inside.
    if (a === "people3" && b === "act" && ctx.segments.length === 3) {
      return await handlePeopleActions(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId), brand: async () => (await scope(ctx)).settings.brandName ?? null });
    }
    // Team roles (Setter, Closer, ...): /api/app/people3/roles/<part>. SubSync-only labels; managers change them, everyone reads the labels they may see. Flag, account and people are checked inside.
    if (a === "people3" && b === "roles" && ctx.segments.length === 3) {
      return await handleTeamRoles(ctx, { allowed: () => allowedIds(ctx) });
    }
    if (a === "pipeline3" && b === "act" && ctx.segments.length === 3) {
      return await handlePipelineActions(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    // The rebuilt Appointments page: the work lists, "See all" and the comparison (read only).
    if (a === "appointments" && method === "GET" && (b === "work" || b === "list" || b === "compare") && !c) {
      return await handleApptWork(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    }
    // The guided duplicate review (reading, setting a group aside, the one-click merge, which is switched off). Deciding and undoing stay below.
    if (a === "duplicates" && (method === "GET" || ["snooze", "unsnooze", "merge", "merge-workflow", "undo-snooze", "arrivals-dismiss"].includes(b ?? ""))) {
      return await handleDuplicates(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    // Clean-up fix lists, Health and bulk runs (stage CU): flags cu_fix, cu_health, cu_bulk, checked inside the handler.
    if (a === "cu") {
      const r = await handleCu(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId), actor: actorOf });
      if (r) return r;
    }
    // Clean-up v2 (stage DQ): duplicate groups, lead intake, quality score and history. Flags dq_*, checked inside the handler.
    if (a === "dq") {
      const r = await handleDq(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId), actor: actorOf });
      if (r) return r;
    }
    // Clean-up v2: rules, data quality, import check, the per-account switch for changing contacts. Anything else under cleanup falls through to the run endpoints below.
    if (a === "cleanup" && ["rules", "quality", "write", "import-check"].includes(b ?? "")) {
      const r = await handleCleanupV2(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, actor: actorOf });
      if (r) return r;
    }
    // The rebuilt Speed to lead screen: its home, lists and comparisons (GET ?part=home|list|compare) and one account's reply target (PUT speed/target).
    const speedHelpers = { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, targetMinutes: async () => (await scope(ctx)).settings.speedTargetMinutes, measuring: async () => { const st = (await scope(ctx)).settings; return { countAutomated: st.countAutomatedTouches, businessHours: st.speedBusinessHours }; } };
    if (a === "speed" && method === "GET" && ["home", "list", "compare", "insights", "insight-list", "race", "coverage", "journey", "journey-list", "proof", "story", "booking", "ladder", "ladder-leads", "pulse", "zones", "digest", "ignored", "ignored-list"].includes(ctx.url.searchParams.get("part") ?? "")) return await handleSpeedPart(ctx, speedHelpers);
    if (a === "speed" && b === "target" && method === "PUT") return await handleSpeedTarget(ctx, speedHelpers);
    if (a === "speed" && b === "ladder" && method === "PUT") return await handleSpeedLadder(ctx);
    if (a === "speed" && b === "digest" && ["PUT", "POST", "GET"].includes(method)) return await handleSpeedDigest(ctx, speedHelpers);
    if (a === "speed" && b === "prefs" && ["PUT", "GET"].includes(method)) return await handleSpeedPrefs(ctx, speedHelpers);
    // The rebuilt Unanswered messages screen: its first screen, the list behind a number and the rankings (GET ?part=home|list|ranks, read only; an unknown part is refused with 400). Without a part the older answer below still serves the exports and the older tests.
    if (a === "inbox" && method === "GET" && !b && ctx.url.searchParams.has("part")) {
      // The new Unanswered v2 parts (home/list/ranks) are always available; per-client SLA is gated separately inside handleUnansweredPart
      const unansweredHelpers = { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, targets: async () => { const st = (await scope(ctx)).settings; return { slaHours: st.slaHours, targetMinutes: st.speedTargetMinutes }; }, owner: () => voterOf(ctx) };
      const round3 = await handleUnansweredPart3(ctx, unansweredHelpers, ctx.url.searchParams.get("part") ?? ""); // round 3: list2, find, views (each behind its own flag)
      if (round3) return round3;
      return await handleUnansweredPart(ctx, unansweredHelpers);
    }
    // Moat and proof (round 3, slice D and E): receipts, the speed-to-outcome curve, scorecards, the peer benchmark, wait clocks, channel mix, the verified reply-time page. Each part has its own flag inside.
    if (a === "moat") return await handleMoat(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, settings: async () => (await scope(ctx)).settings });
    // Unanswered round 3, slice B: hidden people, snooze, claim, assign, note, outcome, clear junk (each behind its own flag, checked inside).
    if (a === "inbox" && b === "act") {
      return await handleUnansweredActions(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links, targets: async () => { const st = (await scope(ctx)).settings; return { slaHours: st.slaHours, targetMinutes: st.speedTargetMinutes }; }, locationToken: (locationId) => locationAccessToken(ctx.session.companyId, locationId) });
    }
    if (a === "inbox" && b === "views3" && method === "POST" && !c) return await handleUnansweredViewSave(ctx, { owner: () => voterOf(ctx) });
    if (a === "inbox" && b === "views3" && method === "DELETE" && c) return await handleUnansweredViewRemove(ctx, { owner: () => voterOf(ctx) }, c);
    if (a === "inbox" && b === "outcome" && method === "POST") {
      if (!ctx.entitlements.features.inbox_breach_alert || ctx.entitlements.locked.includes("inbox_breach_alert")) {
        return json({ error: "Follow-up outcomes are not enabled for this account" }, 404);
      }
      return await handleUnansweredOutcome(ctx, { allowed: () => allowedIds(ctx) });
    }
    // Meeting notes list, detail, follow-up lists, tasks and coaching (flags checked inside; every read is the signed-in person's own calls).
    if (a === "am") return await handleAm(ctx, { allowed: () => allowedIds(ctx) });
    if (a === "meeting-list") return await handleMeetingList(ctx, { allowed: () => allowedIds(ctx), links: async () => (await scope(ctx)).links });
    if (method === "GET") {
      if (a === "overview") return await overview(ctx);
      if (a === "today" && !b) return await todayView(ctx);
      if (a === "today" && b === "growth" && !c) return await growthRead(ctx, growthDeps);
      if (a === "today" && b === "growth" && c === "emails") return await growthEmails(ctx, growthDeps);
      if (a === "today" && b === "lead-flow" && !c) return await leadFlowRead(ctx, growthDeps);
      if (a === "today" && b === "clients-flow" && !c) return await clientsFlowRead(ctx, growthDeps);
      if (a === "today" && b === "brief" && !c) return await todayBrief(ctx, todayDeps);
      if (a === "today" && b === "views" && !c) return await todayViewsList(ctx);
      if (a === "daily" && b === "changes") return await dailyChanges(ctx);
      if (a === "daily") return await dailyView(ctx);
      if (a === "roadmap") return await roadmapView(ctx);
      if (a === "appointments" && b === "breakdown") return await appointmentsBreakdownView(ctx);
      if (a === "appointments" && b && c && LOCATION_ID.test(b) && LOCATION_ID.test(c)) return await appointmentDetailView(ctx, b, c);
      if (a === "appointments") return await appointmentsView(ctx);
      if (a === "audit" && b === "shares") return await auditShares(ctx);
      if (a === "audit" && b === "prefs") return await auditPrefs(ctx);
      if (a === "audit" && b === "clients") return await auditClientsView(ctx);
      if (a === "audit") return await auditV2View(ctx);
      if (a === "speed") return await speedViewData(ctx);
      if (a === "appointment-insights") return await appointmentInsightsView(ctx);
      if (a === "setup-compare") return await setupCompare(ctx);
      if (a === "segments") return await segmentsView(ctx);
      if (a === "meetings") return await meetingsView(ctx);
      if (a === "connections" && !b) return await connectionsView(ctx);
      if (a === "my-connections" && !b) return await myConnectionsView(ctx);
      if (a === "meeting-inbox" && !b) return await meetingInboxView(ctx);
      if (a === "meeting-logged" && !b) return await meetingLoggedView(ctx);
      if (a === "meeting-setup" && !b) return await meetingSetupView(ctx);
      if (a === "meeting-setup" && b === "fields" && !c) return await meetingSetupFieldsView(ctx);
      if (a === "meeting-setup" && b === "account" && !c) return await meetingSetupAccountView(ctx);
      if (a === "meeting-inbox" && b && c === "contacts") return await meetingContactSearch(ctx, b);
      if (a === "team-connections" && !b) return await teamConnectionsView(ctx);
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
      if (a === "inbox" && b === "views") return await inboxViews(ctx);
      if (a === "inbox") return await inboxView(ctx);
      if (a === "pipelines") return await pipelines(ctx);
      if (a === "email" && !b) return await emailHealth(ctx);
      if (a === "alerts") return await alertsView(ctx);
      if (a === "notifications" && !b) return await bellView(ctx);
      if (a === "notification-prefs" && !b) return await prefsView(ctx);
      if (a === "notification-destinations" && !b) return await destinationsView(ctx);
      if (a === "settings" && b === "history") return await settingsHistoryView(ctx);
      if (a === "settings") return await settingsView(ctx);
      if (a === "export" && b) return await exportCsv(ctx, b);
      if (a === "sync-status") return await syncStatusView(ctx);
      if (a === "sync-run") return await syncRunView(ctx);
      if (a === "freshness") return await freshnessView(ctx);
      if (a === "pipeline-intel" && ctx.url.searchParams.get("view") === "board") {
        return await handleBoard(ctx, { allowed: () => allowedIds(ctx), staleDays: async () => (await scope(ctx)).settings.staleDays, stageControls: (allowed, rules) => stageControlsFor(ctx, allowed, rules) });
      }
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
      if (a === "deal-gaps") return await dealGaps(ctx);
      if (a === "clients" && !b && ctx.url.searchParams.get("part")) return await clientsBookPart(ctx);
      if (a === "clients" && !b) return await clientsView(ctx);
      if (a === "clients" && b && LOCATION_ID.test(b) && c === "notes") return await clientRoutes.notesView(ctx, clientDeps, b);
      if (a === "client-onboarding" && !b) return await clientRoutes.onboardingView(ctx, clientDeps);
      if (a === "client-onboarding" && b && LOCATION_ID.test(b) && c === "history") return await clientRoutes.historyView(ctx, clientDeps, b);
      if (a === "client-trends") return await clientRoutes.trendsView(ctx, clientDeps, b && LOCATION_ID.test(b) ? b : undefined);
      if (a === "clients" && b === "compare") return ctx.entitlements.features.reports === false ? json({ error: "This feature is switched off", feature: "reports", off: true }, 404) : await clientsCompare(ctx);
      if (a === "qbr" && b && LOCATION_ID.test(b)) return await qbrView(ctx, b);
      if (a === "digest") return await digestPreview(ctx);
    }
    if (method === "POST") {
      if (a === "email" && b === "check") return await emailCheck(ctx);
      if (a === "clients" && b && LOCATION_ID.test(b) && c === "notes") return await clientRoutes.noteAdd(ctx, clientDeps, b);
      if (a === "client-onboarding" && b === "templates" && c === "starter") return await clientRoutes.templateStarter(ctx);
      if (a === "client-onboarding" && b && b !== "templates" && LOCATION_ID.test(b) && c === "steps") return await clientRoutes.stepAdd(ctx, clientDeps, b);
      if (a === "usage" && !b) return await usagePing(ctx);
      if (a === "today" && b === "growth" && c === "goal") return await growthGoalSave(ctx, growthDeps);
      if (a === "today" && b === "growth" && c === "settings") return await growthSettingsSave(ctx);
      if (a === "today" && b === "action" && !c) return await todayAction(ctx, todayDeps);
      if (a === "today" && b === "views" && !c) return await todayViewSave(ctx);
      if (a === "inbox" && b === "views") return await inboxViewSave(ctx);
      if (a === "audit" && b === "share") return await auditShare(ctx);
      if (a === "audit" && b === "prefs") return await auditPrefs(ctx);
      if (a === "audit" && b === "revoke") return await auditRevoke(ctx);
      if (a === "roadmap" && !b) return await roadmapVote(ctx);
      if (a === "roadmap" && b === "suggest" && !c) return await suggest(ctx, request);
      if (a === "feedback" && !b) return await giveFeedback(ctx, request);
      if (a === "problem" && !b) return await reportProblem(ctx, request);
      if (a === "cleanup" && b === "preview") return await cleanupPreview(ctx);
      if (a === "cleanup" && b && c === "apply") return await cleanupWork(ctx, b, "apply");
      if (a === "cleanup" && b && c === "undo") return await cleanupWork(ctx, b, "undo");
      if (a === "connections" && b && c === "start") return await connectionStart(ctx, b);
      if (a === "my-connections" && b && c === "start") return await myConnectionStart(ctx, b);
      if (a === "my-connections" && b && c === "test") return await myConnectionTest(ctx, b);
      if (a === "meeting-inbox" && b === "confirm") return await meetingConfirm(ctx);
      if (a === "meeting-setup" && b === "preview" && !c) return await meetingSetupPreview(ctx);
      if (a === "meeting-inbox" && b && c === "link") return await meetingLink(ctx, b);
      if (a === "meeting-inbox" && b && c === "dismiss") return await meetingDismiss(ctx, b);
      if (a === "meeting-inbox" && b && c === "ignore") return await meetingIgnore(ctx, b);
      if (a === "team-connections" && b && c === "revoke") return await teamConnectionRevoke(ctx, b);
      if (a === "meetings" && b === "hooks" && !c) return await meetingHookCreate(ctx);
      if (a === "meetings" && b === "hooks" && c && segments[3] === "revoke") return await meetingHookRevoke(ctx, c);
      if (a === "duplicates" && b === "review") return await duplicateReview(ctx);
      if (a === "duplicates" && b === "bulk") return await duplicateBulk(ctx);
      if (a === "duplicates" && b === "undo") return await duplicateUndo(ctx);
      if (a === "notifications" && b === "read-all" && !c) return await bellAction(ctx, "read-all", "");
      if (a === "notifications" && b && c) return await bellAction(ctx, b, c);
      if (a === "notification-prefs" && b && c === "preview") return await copyPreview(ctx, b);
      if (a === "notification-prefs" && b && c === "test") return await prefTest(ctx, b);
      if (a === "notification-destinations" && b === "slack" && c === "start") return await destinationStart(ctx);
      if (a === "notification-destinations" && b === "advanced" && !c) return await destinationAdvanced(ctx);
      if (a === "notification-destinations" && b && c === "test") return await destinationTest(ctx, b);
      if (a === "alerts" && b && c === "dismiss") {
        await dismissAlert(ctx.installationId, b);
        return json({ ok: true });
      }
      if (a === "sync" && b && b !== "work" && b !== "auto" && LOCATION_ID.test(b)) return await resyncOne(ctx, b);
      if (a === "sync" && !b) return await syncStart(ctx);
      if (a === "sync" && b === "work") return await syncWork(ctx);
      if (a === "sync" && b === "auto") return await syncAuto(ctx);
      if (a === "call-lists" && !b) return await callListCreate(ctx);
      if (a === "call-outcomes" && !b) return await callOutcomeCreate(ctx);
      if (a === "settings" && b === "test-slack") return await testSlack(ctx);
      if (a === "settings" && b === "purge") return await purgeData(ctx);
      if (a === "api-keys" && !b) return await keysCreate(ctx);
      if (a === "api-keys" && b && c === "revoke") return await keysRevoke(ctx, b);
    }
    if (method === "DELETE") {
      if (a === "inbox" && b === "views" && c && /^[0-9a-fA-F-]{36}$/.test(c)) return await inboxViewRemove(ctx, c);
      if (a === "today" && b === "views" && c) return await todayViewRemove(ctx, c);
      if (a === "clients" && b && LOCATION_ID.test(b) && c === "notes") return await clientRoutes.noteRemove(ctx, clientDeps, b);
      if (a === "client-onboarding" && b === "templates") return await clientRoutes.templateRemove(ctx);
      if (a === "client-onboarding" && b && LOCATION_ID.test(b) && c === "steps") return await clientRoutes.stepRemove(ctx, clientDeps, b);
      if (a === "connections" && b && !c) return await connectionRemove(ctx, b);
      if (a === "my-connections" && b && !c) return await myConnectionRemove(ctx, b);
      if (a === "notification-prefs" && b && c === "copy") return await copyReset(ctx, b);
      if (a === "notification-destinations" && b && !c) return await destinationRemove(ctx, b);
      if (a === "call-lists" && b && /^[0-9a-fA-F-]{36}$/.test(b)) return await callListDelete(ctx, b);
    }
    if (method === "PUT") {
      if (a === "settings") return await settingsUpdate(ctx);
      if (a === "appointments" && b === "targets") return await appointmentTargetUpdate(ctx);
      if (a === "appointments" && b === "sale-basis") return await handleSaleBasis(ctx);
      if (a === "deal-rules" && b === "test-names") return await handleTestDeals(ctx);
      if (a === "deal-rules" && b === "ownerless") return await handleOwnerlessDeals(ctx);
      if (a === "goals") return await goalsUpdate(ctx);
      if (a === "stage-rules") return await stageRuleSave(ctx);
      if (a === "meeting-policy" && !b) return await policySave(ctx);
      if (a === "meeting-inbox" && b === "settings") return await meetingSettingsSave(ctx);
      if (a === "meeting-setup" && b === "mine" && !c) return await meetingSetupSaveMine(ctx);
      if (a === "meeting-setup" && b === "fields" && !c) return await meetingSetupFieldsSave(ctx);
      if (a === "notification-prefs" && b && !c) return await prefSave(ctx, b);
      if (a === "notification-prefs" && b && c === "copy") return await copySave(ctx, b);
      if (a === "meetings" && b) return await meetingUpdate(ctx, b);
      if (a === "team" && b && LOCATION_ID.test(b)) return await teamName(ctx, b);
      if (a === "clients" && b && LOCATION_ID.test(b)) return await clientUpdate(ctx, b);
      if (a === "client-onboarding" && b === "templates") return await clientRoutes.templateSave(ctx);
      if (a === "client-onboarding" && b && LOCATION_ID.test(b) && c === "steps") return await clientRoutes.stepUpdate(ctx, clientDeps, b);
      if (a === "accounts" && b && LOCATION_ID.test(b) && c === "flags") return await flags(ctx, b);
      if (a === "accounts" && b && LOCATION_ID.test(b) && c === "tasks") return await taskUpdate(ctx, b);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error("API error", { path: segments.join("/"), message: safeError(error) });
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
