// The database side of notifications (stage F9): preferences, Slack destinations, the bell, and the dispatcher's ledger. Every query is scoped by the
// installation id the server took from the signed session; no id from a request is trusted. Secrets (the Slack channel address) are encrypted by the app
// and never selected for a screen. The tables have row level security on and no policy, so only this server code can reach them.

import { decryptSecret, encryptSecret } from "../crypto";
import { sql } from "../db";
import { isSlackWebhook } from "../analytics/derive";
import { NOTIFICATION_TYPES, type NotificationType, type Severity } from "./catalog";
import type { BellItem } from "./bell";
import type { Channel, Ledger, NewRow, Patch, Row, Status } from "./dispatcher";
import { LEGACY_DESTINATION, resolvePref, toStored, type DestinationRef, type Legacy, type Pref } from "./prefs";
import { localDate } from "./timing";
import type { Destination } from "./slack";
import type { Item } from "./compose";

const ms = (v: unknown): number | null => (v instanceof Date ? v.getTime() : null);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

// ---------------- preferences ----------------

type PrefRow = { type: string; enabled: unknown; channels: unknown; recipients: unknown; timing: unknown; copy: unknown };

export async function loadPrefRows(installationId: string): Promise<Map<NotificationType, PrefRow>> {
  const rows = await sql()`select type, enabled, channels, recipients, timing, copy from notification_prefs where installation_id = ${installationId}`;
  const out = new Map<NotificationType, PrefRow>();
  for (const r of rows) if ((NOTIFICATION_TYPES as readonly string[]).includes(r.type as string)) out.set(r.type as NotificationType, r as unknown as PrefRow);
  return out;
}

export function prefsFrom(rows: Map<NotificationType, PrefRow>, legacy: Legacy, destinations: DestinationRef[]): Record<NotificationType, Pref> {
  return Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, resolvePref(t, rows.get(t) ?? null, legacy, destinations)])) as Record<NotificationType, Pref>;
}

export async function savePref(installationId: string, p: Pref, actor: string | null): Promise<void> {
  const db = sql();
  const s = toStored(p);
  await db`
    insert into notification_prefs (installation_id, type, enabled, channels, recipients, timing, copy, updated_by)
    values (${installationId}, ${p.type}, ${s.enabled}, ${db.json(s.channels as never)}, ${db.json(s.recipients as never)}, ${db.json(s.timing as never)}, ${db.json(s.copy as never)}, ${actor})
    on conflict (installation_id, type) do update set enabled = excluded.enabled, channels = excluded.channels, recipients = excluded.recipients,
      timing = excluded.timing, copy = excluded.copy, updated_by = excluded.updated_by, updated_at = now()`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'notifications.prefs_saved', ${db.json({ type: p.type } as never)})`;
}

/** Take an address out of every kind of message (the "stop these emails" link). The address is never stored in the audit line. */
export async function removeRecipientByMatch(installationId: string, matches: (email: string) => boolean): Promise<number> {
  const db = sql();
  const rows = await db`select id, recipients from notification_prefs where installation_id = ${installationId}`;
  let removed = 0;
  for (const r of rows) {
    const list = Array.isArray(r.recipients) ? (r.recipients as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const keep = list.filter((e) => !matches(e));
    if (keep.length !== list.length) {
      removed += list.length - keep.length;
      await db`update notification_prefs set recipients = ${db.json(keep as never)}, updated_at = now() where id = ${r.id}`;
    }
  }
  return removed;
}

// ---------------- destinations (Slack channels) ----------------

export type DestinationView = { id: string; provider: string; label: string | null; locationId: string | null; status: string; pendingSince: number | null; lastOkAt: string | null; lastErrorCode: string | null; connectedBy: string | null; legacy: boolean };

export async function listDestinations(installationId: string): Promise<DestinationView[]> {
  const db = sql();
  const rows = await db`select id, provider, label, location_id, status, pending_since, last_ok_at, last_error_code, connected_by from notification_destinations where installation_id = ${installationId} order by created_at`;
  const out: DestinationView[] = rows.map((r) => ({ id: r.id as string, provider: r.provider as string, label: (r.label as string | null) ?? null, locationId: (r.location_id as string | null) ?? null, status: r.status as string, pendingSince: ms(r.pending_since), lastOkAt: iso(r.last_ok_at), lastErrorCode: (r.last_error_code as string | null) ?? null, connectedBy: (r.connected_by as string | null) ?? null, legacy: false }));
  // The channel set up before destinations existed (the saved address in the settings) is shown, and used, like any other destination.
  const [s] = await db`select slack_webhook_url from settings where installation_id = ${installationId}`;
  if (s?.slack_webhook_url) {
    const [c] = await db`select label from connections where installation_id = ${installationId} and provider = 'slack'`;
    out.unshift({ id: LEGACY_DESTINATION, provider: "slack", label: (c?.label as string | null) ?? "Slack channel (set up earlier)", locationId: null, status: "connected", pendingSince: null, lastOkAt: null, lastErrorCode: null, connectedBy: null, legacy: true });
  }
  return out;
}

export const asDispatchDestinations = (d: DestinationView[]): Destination[] => d.map((x) => ({ id: x.id, label: x.label, locationId: x.locationId, status: x.status, pendingSince: x.pendingSince }));

/** A new "Add to Slack" attempt: a row that waits for the person to finish on Slack. It gives up after two minutes (shown by `shownDestination`). */
export async function createPendingDestination(installationId: string, locationId: string | null, actor: string | null): Promise<string> {
  const [r] = await sql()`insert into notification_destinations (installation_id, provider, location_id, status, pending_since, connected_by) values (${installationId}, 'slack', ${locationId}, 'pending', now(), ${actor}) returning id`;
  return r.id as string;
}

/** Slack handed back a channel. The address is encrypted before it is saved. Returns false when the attempt is unknown, belongs to another install, or is not waiting. */
export async function completeDestination(installationId: string, id: string, p: { webhookUrl: string; label: string }, actor: string | null): Promise<boolean> {
  const db = sql();
  const done = await db`
    update notification_destinations set webhook_url_enc = ${encryptSecret(p.webhookUrl)}, label = ${p.label}, status = 'connected', pending_since = null, last_error_code = null, last_ok_at = now(), updated_at = now()
    where id = ${id} and installation_id = ${installationId} and status = 'pending' returning id`;
  if (done.length === 0) return false;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'notifications.slack_connected', ${db.json({ destination: id } as never)})`;
  return true;
}

/** The pasted address (Advanced). Only a real Slack channel address is accepted. */
export async function addAdvancedDestination(installationId: string, p: { webhookUrl: string; label: string; locationId: string | null }, actor: string | null): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSlackWebhook(p.webhookUrl)) return { ok: false, error: "That is not a Slack channel address. It starts with https://hooks.slack.com/services/." };
  const db = sql();
  const [r] = await db`insert into notification_destinations (installation_id, provider, label, location_id, webhook_url_enc, status, connected_by, last_ok_at) values (${installationId}, 'slack', ${p.label.slice(0, 80) || "Slack channel"}, ${p.locationId}, ${encryptSecret(p.webhookUrl)}, 'connected', ${actor}, now()) returning id`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'notifications.slack_added_by_address', ${db.json({ destination: r.id } as never)})`;
  return { ok: true, id: r.id as string };
}

export async function markDestination(installationId: string, id: string, status: "connected" | "needs_reconnect" | "error", code: string | null): Promise<void> {
  if (id === LEGACY_DESTINATION) return;
  await sql()`update notification_destinations set status = ${status}, last_error_code = ${code}, last_ok_at = case when ${status} = 'connected' then now() else last_ok_at end, updated_at = now() where id = ${id} and installation_id = ${installationId}`;
}

/** The channel address, decrypted, only for the moment of sending. Null for an unknown or pending destination. */
export async function webhookOf(installationId: string, id: string): Promise<string | null> {
  const db = sql();
  if (id === LEGACY_DESTINATION) {
    const [s] = await db`select slack_webhook_url from settings where installation_id = ${installationId}`;
    return (s?.slack_webhook_url as string | null) ?? null;
  }
  const [r] = await db`select webhook_url_enc from notification_destinations where id = ${id} and installation_id = ${installationId} and status in ('connected', 'needs_reconnect')`;
  const enc = r?.webhook_url_enc as string | null | undefined;
  return enc ? decryptSecret(enc) : null;
}

/** Disconnect a channel: the saved address is deleted and every message type stops routing to it. */
export async function removeDestination(installationId: string, id: string, actor: string | null): Promise<boolean> {
  const db = sql();
  if (id === LEGACY_DESTINATION) {
    await db`update settings set slack_webhook_url = null where installation_id = ${installationId}`;
    await db`delete from connections where installation_id = ${installationId} and provider = 'slack'`;
  } else {
    const gone = await db`delete from notification_destinations where id = ${id} and installation_id = ${installationId} returning id`;
    if (gone.length === 0) return false;
  }
  const rows = await db`select id, channels from notification_prefs where installation_id = ${installationId}`;
  for (const r of rows) {
    const ch = (r.channels && typeof r.channels === "object" ? r.channels : {}) as { slackDestinations?: unknown };
    const list = Array.isArray(ch.slackDestinations) ? ch.slackDestinations.filter((x): x is string => typeof x === "string") : [];
    if (list.includes(id)) await db`update notification_prefs set channels = ${db.json({ ...ch, slackDestinations: list.filter((x) => x !== id) } as never)}, updated_at = now() where id = ${r.id}`;
  }
  await db`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'notifications.slack_removed', ${db.json({ destination: id } as never)})`;
  return true;
}

// ---------------- the bell ----------------

export type BellScope = { kind: "agency" | "business" | "client"; limitTo: string | null };

export async function insertNotification(n: { installationId: string; locationId: string | null; type: NotificationType; severity: Severity; item: Item; alertId: string | null; dedupeKey: string }): Promise<void> {
  const db = sql();
  await db`
    insert into notifications (installation_id, location_id, type, severity, title, body, link, alert_id, dedupe_key)
    values (${n.installationId}, ${n.locationId}, ${n.type}, ${n.severity}, ${n.item.title}, ${n.item.body || null}, ${db.json({ view: n.item.link.view, locationId: n.item.link.locationId } as never)}, ${n.alertId}, ${n.dedupeKey})
    on conflict (installation_id, dedupe_key) where dedupe_key is not null do nothing`;
}

/** The items a person may see. An agency sees every account's. A business sees its own account and company-wide items. A client's staff see only items about their own account. */
export async function listBell(installationId: string, scope: BellScope, userKey: string, now = Date.now()): Promise<BellItem[]> {
  const db = sql();
  const since = new Date(now - 14 * 86_400_000);
  const only = scope.kind === "agency" ? null : scope.limitTo;
  const includeCompanyWide = scope.kind !== "client";
  const rows = await db`
    select n.id, n.type, n.severity, n.title, n.body, n.link, n.location_id, n.created_at,
      s.read_at, s.dismissed_at, s.snoozed_until, (a.id is not null and a.resolved_at is not null) as resolved
    from notifications n
    left join notification_states s on s.notification_id = n.id and s.user_key = ${userKey}
    left join alerts a on a.id = n.alert_id and a.installation_id = n.installation_id
    where n.installation_id = ${installationId} and n.created_at >= ${since}
      and (${only}::text is null or n.location_id = ${only} or (${includeCompanyWide} and n.location_id is null))
    order by n.created_at desc limit 200`;
  return rows.map((r) => {
    const link = (r.link && typeof r.link === "object" ? r.link : {}) as { view?: unknown; locationId?: unknown };
    return {
      id: r.id as string, type: r.type as string, severity: (r.severity as Severity) ?? "info", title: r.title as string, body: (r.body as string | null) ?? null,
      link: { view: typeof link.view === "string" ? link.view : null, locationId: typeof link.locationId === "string" ? link.locationId : null },
      locationId: (r.location_id as string | null) ?? null, createdAt: ms(r.created_at) ?? now, readAt: ms(r.read_at), dismissedAt: ms(r.dismissed_at), snoozedUntil: ms(r.snoozed_until), resolved: r.resolved === true,
    };
  });
}

export type StatePatch = { read?: true; dismiss?: true; snoozeUntil?: number | null };

/** Save one person's read, dismiss or snooze for one item. False when the item does not exist for this install or is outside the person's own scope. */
export async function setBellState(installationId: string, scope: BellScope, userKey: string, id: string, patch: StatePatch): Promise<boolean> {
  const db = sql();
  const only = scope.kind === "agency" ? null : scope.limitTo;
  const includeCompanyWide = scope.kind !== "client";
  const [n] = await db`select id, location_id from notifications where id = ${id} and installation_id = ${installationId} and (${only}::text is null or location_id = ${only} or (${includeCompanyWide} and location_id is null))`;
  if (!n) return false;
  const read = patch.read === true || patch.dismiss === true;
  await db`
    insert into notification_states (notification_id, user_key, installation_id, location_id, read_at, dismissed_at, snoozed_until)
    values (${id}, ${userKey}, ${installationId}, ${(n.location_id as string | null) ?? null}, ${read ? new Date() : null}, ${patch.dismiss ? new Date() : null}, ${patch.snoozeUntil ? new Date(patch.snoozeUntil) : null})
    on conflict (notification_id, user_key) do update set
      read_at = case when ${read} then coalesce(notification_states.read_at, now()) else notification_states.read_at end,
      dismissed_at = case when ${patch.dismiss === true} then now() else notification_states.dismissed_at end,
      snoozed_until = case when ${patch.snoozeUntil !== undefined} then ${patch.snoozeUntil ? new Date(patch.snoozeUntil) : null} else notification_states.snoozed_until end,
      updated_at = now()`;
  return true;
}

export async function markAllRead(installationId: string, scope: BellScope, userKey: string): Promise<number> {
  const items = await listBell(installationId, scope, userKey);
  let n = 0;
  for (const i of items) if (!i.readAt && !i.dismissedAt) { if (await setBellState(installationId, scope, userKey, i.id, { read: true })) n++; }
  return n;
}

// ---------------- the ledger ----------------

const mapRow = (r: Record<string, unknown>): Row => ({
  id: r.id as string, installationId: r.installation_id as string, locationId: (r.location_id as string | null) ?? null, type: r.type as NotificationType, channel: r.channel as Channel,
  target: r.target as string, dedupeKey: r.dedupe_key as string, severity: (r.severity as Severity) ?? "info", status: r.status as Status, reason: (r.reason as string | null) ?? null,
  payload: r.payload as Item, alertId: (r.alert_id as string | null) ?? null, attempts: (r.attempts as number) ?? 0, nextAttemptAt: ms(r.next_attempt_at), createdAt: ms(r.created_at) ?? 0,
});

export function dbLedger(): Ledger {
  return {
    async insert(row: NewRow, now: number): Promise<Row | null> {
      const db = sql();
      const rows = await db`
        insert into notification_deliveries (installation_id, location_id, type, channel, target, dedupe_key, severity, status, reason, payload, alert_id, created_at)
        values (${row.installationId}, ${row.locationId}, ${row.type}, ${row.channel}, ${row.target}, ${row.dedupeKey}, ${row.severity}, ${row.status}, ${row.reason ?? null}, ${db.json(row.payload as never)}, ${row.alertId}, ${new Date(now)})
        on conflict (installation_id, dedupe_key, channel, target) do nothing returning *`;
      return rows.length ? mapRow(rows[0]) : null;
    },
    async due(installationId: string, now: number, limit: number): Promise<Row[]> {
      const rows = await sql()`
        select * from notification_deliveries
        where installation_id = ${installationId} and status in ('held', 'pending') and (next_attempt_at is null or next_attempt_at <= ${new Date(now)})
        order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at limit ${limit}`;
      return rows.map(mapRow);
    },
    async update(id: string, p: Patch): Promise<void> {
      await sql()`
        update notification_deliveries set status = ${p.status},
          reason = case when ${p.reason !== undefined} then ${p.reason ?? null} else reason end,
          attempts = coalesce(${p.attempts ?? null}::int, attempts),
          next_attempt_at = case when ${p.nextAttemptAt !== undefined} then ${p.nextAttemptAt ? new Date(p.nextAttemptAt) : null}::timestamptz else next_attempt_at end,
          last_error_code = case when ${p.lastErrorCode !== undefined} then ${p.lastErrorCode ?? null} else last_error_code end,
          sent_at = case when ${p.sentAt !== undefined} then ${p.sentAt ? new Date(p.sentAt) : null}::timestamptz else sent_at end
        where id = ${id}`;
    },
    async lastSentDate(installationId, type, channel, target, zone): Promise<string | null> {
      const [r] = await sql()`select max(sent_at) at_ from notification_deliveries where installation_id = ${installationId} and type = ${type} and channel = ${channel} and target = ${target} and status in ('sent', 'dry_run')`;
      const at = ms(r?.at_);
      return at === null ? null : localDate(new Date(at), zone);
    },
    async alertOpen(alertId: string): Promise<boolean> {
      const rows = await sql()`select 1 from alerts where id = ${alertId} and resolved_at is null`;
      return rows.length > 0;
    },
  };
}

/** Recent messages that could not be delivered (after retries), for the screen's "problems" list. Words only, no address. */
export async function recentProblems(installationId: string, limit = 10): Promise<Array<{ id: string; type: string; channel: string; at: string | null; code: string | null; reason: string | null }>> {
  const rows = await sql()`select id, type, channel, created_at, last_error_code, reason from notification_deliveries where installation_id = ${installationId} and status = 'failed' order by created_at desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id as string, type: r.type as string, channel: r.channel as string, at: iso(r.created_at), code: (r.last_error_code as string | null) ?? null, reason: (r.reason as string | null) ?? null }));
}

/** Housekeeping, run with the hourly dispatcher: finished messages are kept 30 days, bell items and their states 60. */
export async function tidy(installationId: string): Promise<void> {
  const db = sql();
  await db`delete from notification_deliveries where installation_id = ${installationId} and status in ('sent', 'dry_run', 'skipped', 'failed') and created_at < now() - interval '30 days'`;
  await db`delete from notification_states where installation_id = ${installationId} and notification_id in (select id from notifications where installation_id = ${installationId} and created_at < now() - interval '60 days')`;
  await db`delete from notifications where installation_id = ${installationId} and created_at < now() - interval '60 days'`;
}
