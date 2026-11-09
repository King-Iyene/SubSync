// The dispatcher (stage F9): the ONE place that decides who is told what, when, and through which channel. It has no database and no network of its own:
// the ledger (where every message to every place is recorded) and the transports (in-app, email, Slack) are passed in, so the rules are tested with fakes.
//
//   plan()   one Intent in ("9 new leads are waiting at Sample Dental") -> one ledger row per place it should go: the bell, each email recipient, each Slack
//            channel the person routed this kind of message to. Each row is either "pending" (send now) or "held" (quiet hours, or waiting for the daily time).
//            A row that already exists (same dedupe key, channel and place) is NOT created again: nothing is ever sent twice.
//   drain()  works through the rows that are due: sends them (messages for the same place that are ready together go as ONE message), marks them sent, and
//            for a failure either schedules a retry (1, 5, 15, 60 minutes) or stops (a refusal that cannot be fixed by trying again, or 5 tries).
//
// Rules that are tested: dedupe, retries, quiet hours, time zones and daylight saving, a critical alert is never held, a client's Slack never receives
// another client's data, an unsubscribed address is never emailed, an alert that was fixed while it waited is not sent.

import { CATALOG, typeForAlertKind, type NotificationType, type Severity } from "./catalog.ts";
import { composeEmail, composeSlack, type Item, type Link, type Mail } from "./compose.ts";
import { renderCopy, resolveCopy } from "./copy.ts";
import type { Pref } from "./prefs.ts";
import { eligibleDestinations, type Destination } from "./slack.ts";
import { decide, localDate, zoneOf } from "./timing.ts";

export type Channel = "in_app" | "email" | "slack";
export type Status = "held" | "pending" | "sent" | "dry_run" | "failed" | "skipped";

export const MAX_ATTEMPTS = 5;
/** Minutes to wait after the 1st, 2nd, 3rd and 4th failed try. */
export const RETRY_MINUTES = [1, 5, 15, 60] as const;
/** Most messages put together in one email or Slack post. */
export const MAX_BATCH = 20;
export const IN_APP_TARGET = "bell";

export type Intent = {
  type: NotificationType;
  locationId: string | null;
  severity: Severity;
  /** The verified CRM user who alone should see this bell item. */
  recipientUserKey?: string | null;
  /** Hold the passive bell item during quiet hours too. */
  respectQuietHours?: boolean;
  /** Email may be rehearsed through the real transport but must never leave the server. */
  emailDryRunOnly?: boolean;
  /** Identifies this event for dedupe: the same key never creates a second message to the same place (for example "alert:<id>" or "daily_brief:2026-11-02"). */
  dedupeKey: string;
  /** Values for the {variables} of the wording. */
  values: Record<string, unknown>;
  /** Extra plain lines under the wording (for the daily brief: the lines of the brief). */
  details?: string[];
  alertId?: string | null;
  link?: Link;
};

export type Row = {
  id: string;
  installationId: string;
  locationId: string | null;
  type: NotificationType;
  channel: Channel;
  target: string;
  dedupeKey: string;
  severity: Severity;
  status: Status;
  reason: string | null;
  payload: Item;
  alertId: string | null;
  recipientUserKey?: string | null;
  respectQuietHours?: boolean;
  emailDryRunOnly?: boolean;
  attempts: number;
  nextAttemptAt: number | null;
  createdAt: number;
};
export type NewRow = Omit<Row, "id" | "attempts" | "nextAttemptAt" | "createdAt" | "reason"> & { reason?: string | null };

export type Patch = { status: Status; reason?: string | null; attempts?: number; nextAttemptAt?: number | null; lastErrorCode?: string | null; sentAt?: number | null };

export interface Ledger {
  /** Creates the row unless one with the same (installation, dedupe key, channel, target) exists. Returns it, or null when it already existed. */
  insert(row: NewRow, now: number): Promise<Row | null>;
  /** Rows that are "held" or "pending" and not waiting for a later retry. */
  due(installationId: string, now: number, limit: number): Promise<Row[]>;
  update(id: string, patch: Patch): Promise<void>;
  /** The local date (in `zone`) of the most recent message of this kind to this place that was sent, or null. */
  lastSentDate(installationId: string, type: NotificationType, channel: Channel, target: string, zone: string): Promise<string | null>;
  /** Is the alert behind a message still open? False once it is resolved. */
  alertOpen(alertId: string): Promise<boolean>;
}

export type SendResult = { ok: true; dryRun?: boolean } | { ok: false; permanent: boolean; code: string; needsReconnect?: boolean };

export interface Transports {
  inApp(row: Row): Promise<SendResult>;
  email(to: string, mail: Mail, rows: Row[]): Promise<SendResult>;
  slack(destination: Destination, text: string, rows: Row[]): Promise<SendResult>;
}

export type Context = {
  installationId: string;
  mode: "agency" | "business";
  company: string;
  /** The company's logo web address for the email header. */
  logoUrl?: string | null;
  appUrl: string;
  /** The zone of the first client account, for a preference with no zone of its own. */
  fallbackZone: string | null;
  pref: (type: NotificationType) => Pref;
  destinations: Destination[];
  /** The one-click "stop these emails" address for one recipient, or null when it cannot be made. */
  stopUrl: (email: string) => string | null;
  /** Called when a channel needs to be connected again (Slack refused it for good). */
  onDestinationFailed?: (destinationId: string, code: string) => Promise<void>;
};

export type PlanReport = { planned: number; held: number; duplicates: number; skipped: number };

/** The words of one message, from the person's wording (or the default) and the values. */
export function itemFor(intent: Intent, pref: Pref): Item {
  const copy = renderCopy(intent.type, resolveCopy(intent.type, pref.copy), intent.values);
  return { title: copy.title, body: copy.body, details: (intent.details ?? []).slice(0, 16), severity: intent.severity, link: intent.link ?? { view: CATALOG[intent.type].openView, locationId: intent.locationId } };
}

type Target = { channel: Channel; target: string };

/** Everywhere a message of this kind should go, from the person's choices. */
export function targetsFor(intent: Intent, pref: Pref, ctx: Pick<Context, "destinations" | "mode">): Target[] {
  const out: Target[] = [];
  if (pref.inApp || intent.recipientUserKey) out.push({ channel: "in_app", target: intent.recipientUserKey ? `user:${intent.recipientUserKey}` : IN_APP_TARGET });
  if (pref.email) for (const e of pref.recipients) out.push({ channel: "email", target: e });
  if (!intent.recipientUserKey) for (const d of eligibleDestinations(ctx.destinations, pref.slackDestinations, intent, ctx.mode)) out.push({ channel: "slack", target: d.id });
  return out;
}

/** Record where each message should go and whether it goes now or waits. Sends nothing: `drain` does. */
export async function plan(intents: Intent[], ctx: Context, ledger: Ledger, now: number): Promise<PlanReport> {
  const report: PlanReport = { planned: 0, held: 0, duplicates: 0, skipped: 0 };
  for (const intent of intents) {
    const info = CATALOG[intent.type];
    const pref = ctx.pref(intent.type);
    if (!info.active || !pref.enabled) { report.skipped++; continue; }
    const item = itemFor(intent, pref);
    const zone = zoneOf(pref.timing, ctx.fallbackZone);
    for (const t of targetsFor(intent, pref, ctx)) {
      let status: Status = "pending";
      let reason: string | null = null;
      // The bell is passive and always immediate. Email and Slack follow the person's time rules; a scheduled kind (a brief) is built at its time, so it is never held.
      if (info.kind === "event" && (t.channel !== "in_app" || intent.respectQuietHours)) {
        const timing = t.channel === "in_app" && intent.respectQuietHours ? { ...pref.timing, frequency: "immediate" as const } : pref.timing;
        const d = decide({ timing, severity: intent.severity, now: new Date(now), zone, lastBatchDate: timing.frequency === "immediate" ? null : await ledger.lastSentDate(ctx.installationId, intent.type, t.channel, t.target, zone) });
        if (d.action === "hold") { status = "held"; reason = d.reason; }
      }
      const row = await ledger.insert({ installationId: ctx.installationId, locationId: intent.locationId, type: intent.type, channel: t.channel, target: t.target, dedupeKey: intent.dedupeKey, severity: intent.severity, status, reason, payload: item, alertId: intent.alertId ?? null, recipientUserKey: intent.recipientUserKey ?? null, respectQuietHours: intent.respectQuietHours ?? false, emailDryRunOnly: intent.emailDryRunOnly ?? false }, now);
      if (!row) { report.duplicates++; continue; }
      report.planned++;
      if (status === "held") report.held++;
    }
  }
  return report;
}

export type DrainReport = { sent: number; dryRun: number; retried: number; failed: number; skipped: number; stillHeld: number };

const minutes = (n: number) => n * 60_000;

type Ready = { row: Row };

/** Send what is due. Returns what happened. */
export async function drain(ctx: Context, ledger: Ledger, transports: Transports, now: number, limit = 200): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, dryRun: 0, retried: 0, failed: 0, skipped: 0, stillHeld: 0 };
  const rows = await ledger.due(ctx.installationId, now, limit);
  const ready: Ready[] = [];
  const skip = async (r: Row, reason: string) => { await ledger.update(r.id, { status: "skipped", reason }); report.skipped++; };

  for (const r of rows) {
    const info = CATALOG[r.type];
    const pref = ctx.pref(r.type);
    // Things that changed while the message waited: the kind was switched off, the alert was fixed, the address was removed, the channel was disconnected.
    if (!info.active || !pref.enabled) { await skip(r, "switched_off"); continue; }
    if (r.alertId && !(await ledger.alertOpen(r.alertId))) { await skip(r, "resolved"); continue; }
    if (r.channel === "in_app" && !pref.inApp && !r.recipientUserKey) { await skip(r, "switched_off"); continue; }
    if (r.channel === "email" && (!pref.email || !pref.recipients.includes(r.target))) { await skip(r, "unsubscribed"); continue; }
    if (r.channel === "slack") {
      const ok = eligibleDestinations(ctx.destinations, pref.slackDestinations, { locationId: r.locationId }, ctx.mode).some((d) => d.id === r.target);
      if (!ok) { await skip(r, "channel_not_available"); continue; }
    }
    if (r.status === "held" && (r.channel !== "in_app" || r.respectQuietHours)) {
      const zone = zoneOf(pref.timing, ctx.fallbackZone);
      const timing = r.channel === "in_app" && r.respectQuietHours ? { ...pref.timing, frequency: "immediate" as const } : pref.timing;
      const d = decide({ timing, severity: r.severity, now: new Date(now), zone, lastBatchDate: timing.frequency === "immediate" ? null : await ledger.lastSentDate(ctx.installationId, r.type, r.channel, r.target, zone) });
      if (d.action === "hold") { report.stillHeld++; continue; }
    }
    ready.push({ row: r });
  }

  // Put together what is ready for the same place. Briefs are never merged with alerts, and the bell is one item per row.
  const groups = new Map<string, Row[]>();
  for (const { row } of ready) {
    const merge = row.channel !== "in_app" && CATALOG[row.type].kind === "event";
    const key = merge ? `${row.channel}|${row.target}|events|dry:${row.emailDryRunOnly}` : `solo|${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += MAX_BATCH) {
      const batch = list.slice(i, i + MAX_BATCH);
      const first = batch[0];
      let result: SendResult;
      try {
        if (first.channel === "in_app") result = await transports.inApp(first);
        else if (first.channel === "email") result = await transports.email(first.target, composeEmail(batch.map((b) => b.payload), { company: ctx.company, logoUrl: ctx.logoUrl, appUrl: ctx.appUrl, stopUrl: ctx.stopUrl(first.target) }), batch);
        else {
          const dest = ctx.destinations.find((d) => d.id === first.target);
          result = dest ? await transports.slack(dest, composeSlack(batch.map((b) => b.payload), { company: ctx.company, appUrl: ctx.appUrl }), batch) : { ok: false, permanent: true, code: "channel_not_available" };
        }
      } catch {
        result = { ok: false, permanent: false, code: "transport_error" };
      }
      for (const r of batch) {
        if (result.ok) {
          await ledger.update(r.id, { status: result.dryRun ? "dry_run" : "sent", sentAt: now, nextAttemptAt: null, attempts: r.attempts + 1 });
          if (result.dryRun) report.dryRun++; else report.sent++;
          continue;
        }
        const attempts = r.attempts + 1;
        if (result.permanent || attempts >= MAX_ATTEMPTS) {
          await ledger.update(r.id, { status: "failed", reason: result.permanent ? "refused" : "gave_up", attempts, nextAttemptAt: null, lastErrorCode: result.code });
          report.failed++;
        } else {
          await ledger.update(r.id, { status: "pending", reason: "retry", attempts, nextAttemptAt: now + minutes(RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)]), lastErrorCode: result.code });
          report.retried++;
        }
      }
      if (!result.ok && result.needsReconnect && first.channel === "slack") await ctx.onDestinationFailed?.(first.target, result.code);
    }
  }
  return report;
}

/** One alert becomes one intent. The variables come from the alert's own details, so the wording can name the account and the numbers. */
export function intentFromAlert(a: { id: string; kind: string; severity: Severity; title: string; locationId: string | null; detail: Record<string, unknown> }, accountName: string | null): Intent {
  const type = typeForAlertKind(a.kind);
  const d = a.detail;
  const num = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  const account = accountName ?? "A client account";
  // What looks wrong, in a short phrase: the alert's own title with the account name taken off the front, so the wording reads "{account}: {problem}".
  const problem = a.title.startsWith(account) ? a.title.slice(account.length).replace(/^[:,\s]+/, "") : a.title;
  const longest = num("oldestWaitMinutes");
  return {
    type, locationId: a.locationId, severity: a.severity, dedupeKey: `alert:${a.id}`, alertId: a.id,
    values: {
      account, problem, count: num("waiting") ?? num("unmarked") ?? num("unanswered") ?? num("staleOpps") ?? "", target: num("targetMinutes") ?? "",
      longest: longest ? (longest >= 60 ? `${Math.floor(longest / 60)} h ${Math.round(longest % 60)} min` : `${Math.round(longest)} min`) : "", minutes: num("ageMinutes") ?? "",
    },
  };
}

export { localDate };
