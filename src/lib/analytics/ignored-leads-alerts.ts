import { sql } from "../db";
import { dispatchIntents, loadContext } from "../notifications/service";
import type { Intent } from "../notifications/dispatcher";
import { alertTitle, effectivePref, shouldAlert, type AccountCount, type IgnoredPref } from "./ignored-leads-core";
import { ignoredByAccount, loadIgnoredPrefs } from "./ignored-leads-sql";

// "Client is ignoring leads" alert (flag sp_ignored_leads), checked by the hourly job and sent through the SAME notification engine as every other alert: in the bell and the daily brief, held in
// quiet hours, and Slack and email stay in dry run until the live switches are on. One alert per episode: the alert stays open while the account is at or over its threshold (the unique open
// dedupe key means no second one is made), and is closed when the count falls back under it, so the next time it happens is a new episode. It goes to the agency (everyone who sees the
// company feed) or, if the account's own choice says so, to that account's administrator. Nothing is ever sent to a lead.

export const IGNORED_WINDOW_DAYS = 14;
export const IGNORED_ALERTS_PER_RUN = 10;
const DAY = 86_400_000;
export { ignoredDedupeKey } from "./ignored-leads-core";
import { ignoredDedupeKey } from "./ignored-leads-core";

export type Breaching = AccountCount & { pref: IgnoredPref };
/** The accounts at or over their own threshold in the last 14 days (the same people the report lists for that period). */
export async function breachingAccounts(installationId: string, now: number): Promise<{ breaching: Breaching[]; clear: string[] }> {
  const [rows, prefs] = await Promise.all([ignoredByAccount({ installationId, allowed: null, fromMs: now - IGNORED_WINDOW_DAYS * DAY, toMs: now + DAY, now }), loadIgnoredPrefs(installationId)]);
  const breaching: Breaching[] = [], clear: string[] = [];
  for (const a of rows) {
    const pref = effectivePref(prefs.company, prefs.byLoc.get(a.locationId));
    if (shouldAlert(a.people, pref)) breaching.push({ ...a, pref }); else clear.push(a.locationId);
  }
  return { breaching, clear };
}

export async function runIgnoredAlerts(installationId: string, now: number): Promise<{ created: number; closed: number }> {
  const db = sql();
  const { breaching, clear } = await breachingAccounts(installationId, now);
  // An episode ends when the account is back under its threshold (or the alert was switched off for it).
  const closed = clear.length ? await db`update alerts set resolved_at = ${new Date(now)} where installation_id = ${installationId} and kind = 'ignored_leads' and resolved_at is null and location_id = any(${clear}::text[]) returning id` : [];
  const admins = breaching.some((b) => b.pref.to === "account")
    ? await db`select location_id, user_id from location_users where installation_id = ${installationId} and role = 'account_admin'`.catch(() => [])
    : [];
  const adminOf = new Map(admins.map((r) => [r.location_id as string, r.user_id as string]));
  const made: Array<{ id: string; locationId: string; account: string; title: string; recipient: string | null }> = [];
  for (const b of breaching) {
    if (made.length >= IGNORED_ALERTS_PER_RUN) break;
    const recipient = b.pref.to === "account" ? adminOf.get(b.locationId) ?? null : null;
    if (b.pref.to === "account" && !recipient) continue; // no administrator known: nobody to tell, so no alert rather than a wrong recipient
    const oldestHours = b.oldestAt === null ? null : Math.max(0, Math.floor((now - b.oldestAt) / 3_600_000));
    const title = alertTitle(b.name, b.people, oldestHours);
    const detail = { people: b.people, missed: b.missed, never: b.never, replyNobody: b.replyNobody, replyAuto: b.replyAuto, oldestHours, windowDays: IGNORED_WINDOW_DAYS };
    const [row] = await db`
      insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key, recipient_user_key, created_at)
      values (${installationId}, ${b.locationId}, 'ignored_leads', 'warning', ${title}, ${db.json(detail as never)}, ${ignoredDedupeKey(b.locationId)}, ${recipient}, ${new Date(now)})
      on conflict (installation_id, dedupe_key) where resolved_at is null do nothing returning id`;
    if (row) made.push({ id: row.id as string, locationId: b.locationId, account: b.name, title, recipient });
  }
  if (made.length) {
    const loaded = await loadContext(installationId);
    const intents: Intent[] = made.map((m) => ({
      type: "other_alerts", locationId: m.locationId, severity: "warning", recipientUserKey: m.recipient, respectQuietHours: true, emailDryRunOnly: true,
      dedupeKey: `alert:${m.id}`, alertId: m.id, values: { account: m.account, problem: m.title }, link: { view: "speed", locationId: m.locationId },
    }));
    await dispatchIntents(installationId, intents, now, loaded);
  }
  return { created: made.length, closed: closed.length };
}

/** For the 7 am brief: how many accounts are over their line and how many people that is. Null when none. */
export async function briefIgnored(installationId: string, now: number): Promise<{ accounts: number; people: number; names: string[] } | null> {
  const { breaching } = await breachingAccounts(installationId, now);
  if (breaching.length === 0) return null;
  const top = [...breaching].sort((a, b) => b.people - a.people);
  return { accounts: breaching.length, people: breaching.reduce((n, b) => n + b.people, 0), names: top.slice(0, 3).map((b) => b.name) };
}
