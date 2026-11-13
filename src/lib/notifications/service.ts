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
import { CATALOG, typeForAlertKind, type NotificationType } from "./catalog";
import { composeEmail, composeSlack, type Item } from "./compose";
import { drain, intentFromAlert, plan, targetsFor, type Context, type DrainReport, type Intent, type PlanReport } from "./dispatcher";
import { cleanValue, renderCopy, resolveCopy, sampleValues } from "./copy";
import { resolveEntitlements } from "../flags";
import { aiAlertBody } from "../ai/team/alert-report";
import { decideSend, factsFor, renderFacts, recoveryFor, specificFor, type AlertLink, type Extra, type Meta, type Prev } from "./alert-text";
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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
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
    installationId, mode, company, logoUrl: settings.brandLogoUrl, appUrl: appUrl(), crmDomain: settings.appDomain, fallbackZone, pref: (t) => prefs[t], destinations: asDispatchDestinations(destinations), stopUrl: stopUrlFor(installationId),
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

/** Alert kinds the refresh and the data-health job raise for everyone to see. Private per-person alerts have their own sender and are not touched here. */
const SHARED_KINDS = ["speed", "appointments", "sla", "dormant", "churn", "leadflow", "stale", "quality", "sync", "email"];

type Prior = Prev & { meta: Meta; link: AlertLink; linkLabel: string };

/** The last message told about each problem (30 days back), so a repeat can say what changed and a clearing can be noticed. */
async function priorBySubject(installationId: string): Promise<Map<string, Prior>> {
  const rows = await sql()`
    select distinct on (payload->'meta'->>'subject') payload, created_at from notification_deliveries
    where installation_id = ${installationId} and payload->'meta'->>'subject' is not null and status not in ('skipped', 'failed') and created_at > now() - interval '30 days'
    order by payload->'meta'->>'subject', created_at desc`.catch(() => []);
  const out = new Map<string, Prior>();
  for (const r of rows) {
    const p = r.payload as Item | null;
    const m = p?.meta as Meta | undefined;
    if (!p || !m?.subject) continue;
    const at = r.created_at instanceof Date ? r.created_at.getTime() : Date.parse(String(r.created_at));
    out.set(m.subject, { fp: m.fp, count: m.count ?? null, at, state: m.state, meta: m, link: { view: p.link?.view ?? "alerts", locationId: p.link?.locationId ?? null, query: p.link?.query }, linkLabel: p.linkLabel ?? "Open it" });
  }
  return out;
}

/** The biggest places the waiting leads came from, by count, with no names. Failing to read it only leaves that line out. */
async function speedExtra(installationId: string, locationId: string, targetMinutes: number): Promise<Extra> {
  try {
    const rows = await sql()`
      select coalesce(nullif(btrim(c.source), ''), 'No source recorded') src, count(*)::int n
      from lead_touches t left join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
      where t.installation_id = ${installationId} and t.location_id = ${locationId} and t.touch_at is null and t.excluded is null
        and t.lead_at > now() - interval '2 days' and coalesce(t.clock_start, t.lead_at) < now() - make_interval(mins => ${Math.round(targetMinutes)})
      group by 1 order by 2 desc limit 3`;
    return { sources: rows.map((r) => ({ name: r.src as string, count: Number(r.n) })) };
  } catch { return {}; }
}

/**
 * Tell people about alerts, once per real change. Every open shared alert is looked at (not only the ones created in this refresh): a new one is told at once,
 * a changed one when its band moved, an unchanged one once a day with what changed, and one that cleared gets a single "back to normal" note.
 */
export async function dispatchAlerts(installationId: string, created: AlertRow[], now = Date.now()): Promise<RunReport | null> {
  const l = await loadContext(installationId);
  const open = await sql()`select id, location_id, kind, severity, title, detail from alerts
    where installation_id = ${installationId} and resolved_at is null and recipient_user_key is null and severity <> 'info' and kind = any(${SHARED_KINDS}::text[])`.catch(() => []);
  const cand = new Map<string, { id: string; kind: string; severity: AlertRow["severity"]; title: string; locationId: string | null; detail: Record<string, unknown> }>();
  for (const r of open) cand.set(r.id as string, { id: r.id as string, kind: r.kind as string, severity: r.severity as AlertRow["severity"], title: r.title as string, locationId: (r.location_id as string | null) ?? null, detail: (r.detail ?? {}) as Record<string, unknown> });
  for (const a of created) if (a.severity !== "info" && !cand.has(a.id)) cand.set(a.id, { id: a.id, kind: a.kind, severity: a.severity, title: a.title, locationId: a.locationId, detail: a.detail });
  const names = await accountNames(installationId, [...new Set([...cand.values()].map((a) => a.locationId).filter((x): x is string => !!x))]);
  const prior = await priorBySubject(installationId);
  const targetMinutes = (await getSettings(installationId).catch(() => null))?.speedTargetMinutes ?? 15;
  const intents: Intent[] = [];
  const seen = new Set<string>();
  const [instRow] = await sql()`select plan from installations where id = ${installationId}`.catch(() => []);
  const ent = await resolveEntitlements((instRow?.plan as never) ?? "pro", installationId).catch(() => null);
  const aiOn = ent?.features.ai_byo === true && ent.features.ai_slack_reports === true;
  let aiCalls = 0;
  const day = new Date(now).toISOString().slice(0, 10);
  for (const a of cand.values()) {
    const account = a.locationId ? names.get(a.locationId) ?? null : null;
    // Read the extra facts only for a message that will really be sent.
    let facts = factsFor(a, account);
    let d = renderFacts(facts);
    seen.add(d.subject);
    const prev = prior.get(d.subject) ?? null;
    const dec = decideSend(prev, d, now);
    if (!dec.send) continue;
    if (a.kind === "speed" && a.locationId) { facts = factsFor(a, account, await speedExtra(installationId, a.locationId, num(a.detail.targetMinutes) ?? targetMinutes)); d = renderFacts(facts); }
    const specific = specificFor(d, cleanValue(account ?? "A client account"), dec.state, prev, now);
    // When the account has AI connected and switched on for alert reports, the AI words the sentence under the headline from the same facts (number guard, caps and tenant pinning in the
    // gateway). Off, failed or rejected: the data-specific template stays. At most 5 AI calls per refresh.
    if (aiOn && aiCalls < 5 && a.locationId) { aiCalls++; const written = await aiAlertBody({ inst: installationId, locationId: a.locationId, featureOn: true }, facts); if (written) specific.body = written; }
    intents.push({ ...intentFromAlert(a, account), dedupeKey: `alertfp:${d.subject}:${d.fp}:${dec.state}:${dec.state === "reminder" ? day : a.id}`, specific });
  }
  for (const [subject, p] of prior) {
    const kind = subject.split(":")[0];
    if (seen.has(subject) || p.state === "recovered" || !SHARED_KINDS.includes(kind)) continue;
    const loc = subject.split(":")[1];
    const rec = recoveryFor(p, now, p.at);
    intents.push({ type: typeForAlertKind(kind), locationId: loc && loc !== "all" ? loc : null, severity: "info", dedupeKey: `alertfp:${subject}:recovered:${p.at}`, alertId: null, values: { account: p.meta.account, problem: rec.title }, specific: rec });
  }
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
  if (type === "daily_brief") {
    // The brief says what Today says: the same headline, the same ranking of what to fix first, and how many items are set aside. If the Today read fails the brief
    // still goes out with the older lines. Real sending stays behind the existing dry-run switches; nothing here changes them.
    try {
      const [inst] = await sql()`select plan, company_id from installations where id = ${installationId}`;
      const { todayBriefForInstallation } = await import("../api/router");
      const t = await todayBriefForInstallation(installationId, inst.plan as never, inst.company_id as string);
      // On Monday the brief also carries the team lines (who answered how many new leads in time last week), when the Team module is on.
      const team = now.getUTCDay() === 1 ? await (await import("../analytics/people-alerts")).weeklyTeamLines(installationId, now.getTime()) : [];
      return { type, locationId: null, severity: "info", dedupeKey: `daily_brief:${date}`, values, details: [...t.lines, ...team, `${d.freshness.text}.`] };
    } catch (error) {
      console.error("The daily brief could not use Today's ranking; using the older lines", safeError(error));
      return { type, locationId: null, severity: "info", dedupeKey: `daily_brief:${date}`, values, details: dailyLines(base) };
    }
  }
  // The weekly summary adds the week's plain facts. If any read fails the summary still goes out without that part.
  const target = (await getSettings(installationId).catch(() => null))?.speedTargetMinutes ?? 15;
  const [sp, ap] = await Promise.all([speedView(installationId, null, target).catch(() => null), appointmentView(installationId, null).catch(() => null)]);
  const facts = weekFacts({
    leads: sp ? sp.overall.leads : 0, withinTarget: sp ? sp.overall.withinTarget : 0, targetMinutes: target, neverAnswered: sp ? sp.neverAnswered : 0,
    noShowsToRecover: ap ? ap.recoverTotal : null, unmarked: ap ? ap.unmarkedTotal : null,
  });
  const team = await (await import("../analytics/people-alerts")).weeklyTeamLines(installationId, now.getTime());
  const one = await (await import("../ai/team/digest")).oneThingLines(installationId, now.getTime());
  return { type, locationId: null, severity: "info", dedupeKey: `weekly_summary:${date}`, values, details: weeklyLines({ ...base, facts: [...facts, ...team, ...one] }) };
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

export const sampleSlack = (l: Loaded, type: NotificationType) => composeSlack([sampleItem(type, l.prefs[type])], { company: l.company, appUrl: appUrl(), crmDomain: l.ctx.crmDomain, test: true });
