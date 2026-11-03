// The server-side entry points of notifications (stage F9): load one company's context, send what an event or a schedule calls for, work off what is
// waiting, send a test. The rules live in the pure modules next to this file; this file only reads the database and calls them.

import { getSettings } from "../analytics/queries";
import type { AlertRow } from "../analytics/queries";
import { buildDailyDigest } from "../analytics/digest-service";
import { appointmentView } from "../analytics/appointment-queries";
import { speedView } from "../analytics/speed-queries";
import { weekFacts } from "../analytics/weekly-email";
import { isLive } from "../live-flags";
import { sql } from "../db";
import { safeError } from "../safe-log";
import { unsubscribeUrl } from "../unsubscribe";
import { dailyLines, shortDate, weeklyLines } from "./brief-lines";
import { CATALOG, type NotificationType } from "./catalog";
import { composeEmail, composeSlack, type Item } from "./compose";
import { drain, intentFromAlert, plan, targetsFor, type Context, type DrainReport, type Intent, type PlanReport } from "./dispatcher";
import { renderCopy, resolveCopy, sampleValues } from "./copy";
import type { Legacy, Pref } from "./prefs";
import { asDispatchDestinations, dbLedger, listDestinations, loadPrefRows, prefsFrom, type DestinationView } from "./store";
import { sendTestMail, type TestOutcome } from "./test-send";
import { realTransports, testSendDeps } from "./transports";
import { localDate, scheduledDue, zoneOf } from "./timing";

export type Loaded = {
  ctx: Context;
  prefs: Record<NotificationType, Pref>;
  destinations: DestinationView[];
  mode: "agency" | "business";
  company: string;
  fallbackZone: string | null;
  legacy: Legacy;
  lastDailyOn: string | null;
  lastWeeklyOn: string | null;
};

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

function stopUrlFor(installationId: string): (email: string) => string | null {
  return (email) => {
    const base = appUrl();
    if (!base) return null;
    try { return unsubscribeUrl(base, installationId, email); } catch { return null; }
  };
}

/** Everything the dispatcher needs to know about one company: its preferences (over the defaults), its Slack channels, its name and its time zone. */
export async function loadContext(installationId: string): Promise<Loaded> {
  const db = sql();
  const [inst] = await db`select mode, coalesce(company_name, 'Your company') name from installations where id = ${installationId}`;
  const [settings, destinations, rows, zone, last] = await Promise.all([
    getSettings(installationId),
    listDestinations(installationId),
    loadPrefRows(installationId),
    db`select timezone from locations where installation_id = ${installationId} and timezone is not null order by name limit 1`,
    db`select last_daily_digest_on::text d, last_weekly_digest_on::text w from settings where installation_id = ${installationId}`,
  ]);
  const legacy: Legacy = { slackConfigured: Boolean(settings.slackWebhookUrl), digestEnabled: settings.digestEnabled, digestEmail: settings.digestEmail, digestHour: settings.digestHour, digestTimezone: settings.digestTimezone, alertQuietHours: settings.alertQuietHours };
  const connected = destinations.filter((d) => d.status === "connected").map((d) => ({ id: d.id, locationId: d.locationId }));
  const prefs = prefsFrom(rows, legacy, connected);
  const mode = inst?.mode === "business" ? "business" : "agency";
  const company = settings.brandName ?? (inst?.name as string | undefined) ?? "Your company";
  const fallbackZone = (zone[0]?.timezone as string | undefined) ?? null;
  const ctx: Context = {
    installationId, mode, company, logoUrl: settings.brandLogoUrl, appUrl: appUrl(), fallbackZone, pref: (t) => prefs[t], destinations: asDispatchDestinations(destinations), stopUrl: stopUrlFor(installationId),
  };
  return { ctx, prefs, destinations, mode, company, fallbackZone, legacy, lastDailyOn: (last[0]?.d as string | null) ?? null, lastWeeklyOn: (last[0]?.w as string | null) ?? null };
}

export type RunReport = { plan: PlanReport; drain: DrainReport };

/** Record where these messages go and send what is ready now. */
export async function dispatchIntents(installationId: string, intents: Intent[], now = Date.now(), loaded?: Loaded): Promise<RunReport> {
  const l = loaded ?? (await loadContext(installationId));
  const ledger = dbLedger();
  const planned = await plan(intents, l.ctx, ledger, now);
  const drained = await drain(l.ctx, ledger, realTransports(installationId, l.ctx.stopUrl), now);
  return { plan: planned, drain: drained };
}

/** Work off what is waiting for one company: held messages whose time has come, and retries. Safe to call as often as you like. */
export async function drainInstallation(installationId: string, now = Date.now()): Promise<DrainReport> {
  const l = await loadContext(installationId);
  return drain(l.ctx, dbLedger(), realTransports(installationId, l.ctx.stopUrl), now);
}

async function accountNames(installationId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await sql()`select location_id, name from locations where installation_id = ${installationId} and location_id = any(${ids}::text[])`;
  return new Map(rows.map((r) => [r.location_id as string, (r.name as string | null) ?? "Unnamed account"]));
}

/** Alerts raised in this refresh. Each becomes a message of the kind its alert type maps to, to everywhere that kind is routed. Info alerts stay in the Alerts page. */
export async function dispatchAlerts(installationId: string, created: AlertRow[], now = Date.now()): Promise<RunReport | null> {
  const worth = created.filter((a) => a.severity !== "info");
  const l = await loadContext(installationId);
  if (worth.length === 0) return { plan: { planned: 0, held: 0, duplicates: 0, skipped: 0 }, drain: await drain(l.ctx, dbLedger(), realTransports(installationId, l.ctx.stopUrl), now) };
  const names = await accountNames(installationId, [...new Set(worth.map((a) => a.locationId).filter((x): x is string => !!x))]);
  const intents = worth.map((a) => {
    const i = intentFromAlert(a, a.locationId ? names.get(a.locationId) ?? null : null);
    const longest = a.detail.oldestWaitMinutes;
    return a.kind === "speed" && typeof longest === "number" && longest > 0 ? { ...i, details: [`The longest wait is ${longest >= 60 ? `${Math.floor(longest / 60)} h ${Math.round(longest % 60)} min` : `${Math.round(longest)} min`}.`] } : i;
  });
  return dispatchIntents(installationId, intents, now, l);
}

/** The refresh's own tidy: also work off what is waiting, so a warning held in quiet hours goes out in the morning. */
export async function afterRefresh(installationId: string, created: AlertRow[]): Promise<void> {
  try {
    await dispatchAlerts(installationId, created);
  } catch (error) {
    // Telling people must never break the refresh itself.
    console.error("Notifications failed after a refresh", safeError(error));
  }
}

/** Raise a message that is not an alert row: the sync alarm. `dedupeKey` decides how often the same problem may be sent again. */
export async function notifySyncProblem(installationId: string, p: { dedupeKey: string; minutes: number | null; problem: string; severity?: "warning" | "critical" }): Promise<RunReport | null> {
  const l = await loadContext(installationId);
  const intent: Intent = { type: "sync_problem", locationId: null, severity: p.severity ?? "warning", dedupeKey: p.dedupeKey, values: { account: l.company, minutes: p.minutes ?? "", problem: p.problem } };
  return dispatchIntents(installationId, [intent], Date.now(), l);
}

// ---------------- scheduled messages ----------------

async function lastPlannedDate(installationId: string, type: NotificationType, zone: string): Promise<string | null> {
  const [r] = await sql()`select max(created_at) at_ from notification_deliveries where installation_id = ${installationId} and type = ${type}`;
  const at = r?.at_ instanceof Date ? r.at_ : null;
  if (!at) return null;
  return localDate(at, zone);
}

const laterOf = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

/** The daily brief or the weekly summary for every real company whose chosen time has come. Called every hour. Returns how many companies it built one for. */
export async function runScheduled(type: "daily_brief" | "weekly_summary", now = Date.now()): Promise<{ checked: number; built: number }> {
  const rows = await sql()`select id from installations where uninstalled_at is null and not is_demo and refresh_token_enc is not null order by created_at`;
  let built = 0;
  for (const r of rows) {
    const id = r.id as string;
    try {
      const l = await loadContext(id);
      const pref = l.prefs[type];
      if (!pref.enabled) continue;
      const probe: Intent = { type, locationId: null, severity: "info", dedupeKey: "probe", values: {} };
      if (targetsFor(probe, pref, l.ctx).length === 0) continue;
      const zone = zoneOf(pref.timing, l.fallbackZone);
      const last = laterOf(await lastPlannedDate(id, type, zone), type === "daily_brief" ? l.lastDailyOn : l.lastWeeklyOn);
      const due = scheduledDue(pref.timing, new Date(now), zone, last);
      if (!due.due || !due.date) continue;
      const intent = await buildScheduled(id, type, l, due.date, new Date(now), zone);
      const report = await dispatchIntents(id, [intent], now, l);
      built++;
      // Keep the older "last sent" date up to date too, so going back to the older version never sends the same brief twice.
      if (report.drain.sent > 0) {
        if (type === "daily_brief") await sql()`update settings set last_daily_digest_on = ${due.date}::date where installation_id = ${id}`;
        else await sql()`update settings set last_weekly_digest_on = ${due.date}::date where installation_id = ${id}`;
      }
    } catch (error) {
      console.error(`Scheduled ${type} failed for one company`, safeError(error));
    }
  }
  return { checked: rows.length, built };
}

async function buildScheduled(installationId: string, type: "daily_brief" | "weekly_summary", l: Loaded, date: string, now: Date, zone: string): Promise<Intent> {
  const d = await buildDailyDigest(installationId);
  const values = { company: l.company, attention_count: d.attention.length, fine_count: d.fine.length, date: shortDate(now, zone) };
  const base = { attention: d.attention, fine: d.fine.length, headlines: d.headlines, freshnessLabel: d.freshness.text };
  if (type === "daily_brief") return { type, locationId: null, severity: "info", dedupeKey: `daily_brief:${date}`, values, details: dailyLines(base) };
  // The weekly summary adds the week's plain facts. If any read fails the summary still goes out without that part.
  const target = (await getSettings(installationId).catch(() => null))?.speedTargetMinutes ?? 15;
  const [sp, ap] = await Promise.all([speedView(installationId, null, target).catch(() => null), appointmentView(installationId, null).catch(() => null)]);
  const facts = weekFacts({
    leads: sp ? sp.overall.leads : 0, withinTarget: sp ? sp.overall.withinTarget : 0, targetMinutes: target, neverAnswered: sp ? sp.neverAnswered : 0,
    noShowsToRecover: ap ? ap.recoverTotal : null, unmarked: ap ? ap.unmarkedTotal : null,
  });
  return { type, locationId: null, severity: "info", dedupeKey: `weekly_summary:${date}`, values, details: weeklyLines({ ...base, facts }) };
}

/** Work off what is waiting for every real company (the hourly job). */
export async function drainAll(now = Date.now()): Promise<{ companies: number; sent: number; failed: number }> {
  const rows = await sql()`select distinct installation_id id from notification_deliveries where status in ('held', 'pending')`;
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      const rep = await drainInstallation(r.id as string, now);
      sent += rep.sent + rep.dryRun; failed += rep.failed;
    } catch (error) {
      console.error("Draining notifications failed for one company", safeError(error));
    }
  }
  return { companies: rows.length, sent, failed };
}

// ---------------- tests from the screen ----------------

/** The message a "send me a test" shows, built from the person's own wording and sample values. */
export function sampleItem(type: NotificationType, pref: Pref): Item {
  const copy = renderCopy(type, resolveCopy(type, pref.copy), sampleValues(type));
  return { title: copy.title, body: copy.body, details: [], severity: CATALOG[type].defaultSeverity, link: { view: CATALOG[type].openView, locationId: null } };
}

export async function sendEmailTest(installationId: string, l: Loaded, type: NotificationType, to: string): Promise<TestOutcome> {
  const pref = l.prefs[type];
  const mail = composeEmail([sampleItem(type, pref)], { company: l.company, logoUrl: l.ctx.logoUrl, appUrl: appUrl(), stopUrl: l.ctx.stopUrl(to), test: true });
  return sendTestMail(to, pref.recipients, mail, testSendDeps(installationId, l.ctx.stopUrl, () => isLive("SEND_EMAIL_LIVE")));
}

export const sampleSlack = (l: Loaded, type: NotificationType) => composeSlack([sampleItem(type, l.prefs[type])], { company: l.company, appUrl: appUrl(), test: true });
