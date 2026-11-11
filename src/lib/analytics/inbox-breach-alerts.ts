import { sql } from "../db";
import { resolveEntitlements } from "../flags";
import { getSettings } from "./queries";
import { ACK_ESCALATION_GRACE_MAX, ACK_ESCALATION_GRACE_MIN, ACK_ESCALATION_GRACE_MINUTES } from "./unanswered-advanced";
import { safeError } from "../safe-log";
import { dispatchIntents, loadContext } from "../notifications/service";
import type { Intent } from "../notifications/dispatcher";
import { pgTextArray } from "./queries";
import { WAITING_WINDOW_DAYS } from "./waiting";
import {
  BREACH24_DAILY_CAP, breachCandidates, breachDedupeKey, isBreachDue, type BreachCandidate, type BreachClock, type BreachSource,
} from "./inbox-breach-rules";
import { isBreachSpike, isHandoffWindow, ownerlessFor, patternCounts, weeklyReceipt, workloadWarnings } from "./unanswered-advanced";

export { BREACH24_DAILY_CAP, BREACH24_HOURS, breachCandidates, breachDedupeKey, isBreachDue, type BreachCandidate, type BreachClock, type BreachSource } from "./inbox-breach-rules";

export type BreachCronReport = { companies: number; accounts: number; alerts: number; capped: number; unroutable: number; failures: number };

type CreatedAlert = {
  id: string;
  locationId: string;
  accountName: string;
  personName: string;
  recipientUserKey: string;
};

async function waitingRows(installationId: string, now: number): Promise<BreachSource[]> {
  const rows = await sql()`
    select c.location_id, l.name location_name, l.timezone, c.conversation_id, c.contact_id, c.unread_count, ct.source,
      coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), 'Unnamed contact') person_name,
      c.last_message_at,
      owner.user_id assigned_user_id, (owner.user_id is not null) assigned_user_verified,
      admin.user_id account_admin_user_id
    from cached_conversations c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    left join location_users owner on owner.installation_id = c.installation_id
      and owner.location_id = c.location_id and owner.user_id = nullif(c.assigned_to, '')
    left join lateral (
      select u.user_id from location_users u
      where u.installation_id = c.installation_id and u.location_id = c.location_id and u.role = 'account_admin'
      order by u.seen_at desc limit 1
    ) admin on true
    where c.installation_id = ${installationId}
      and c.last_message_direction = 'inbound'
      and c.last_message_at > ${new Date(now - WAITING_WINDOW_DAYS * 86_400_000)}
      and c.last_message_at <= ${new Date(now - 60 * 60_000)}
    order by c.location_id, coalesce(c.contact_id, 'conversation-' || c.conversation_id), c.last_message_at asc`;
  return rows.map((r) => ({
    locationId: r.location_id as string,
    locationName: (r.location_name as string | null) ?? null,
    timeZone: (r.timezone as string | null) ?? null,
    conversationId: r.conversation_id as string,
    contactId: (r.contact_id as string | null) ?? null,
    personName: (r.person_name as string | null) ?? null,
    lastAt: r.last_message_at instanceof Date ? r.last_message_at.getTime() : Date.parse(String(r.last_message_at)),
    unreadCount: Number(r.unread_count ?? 0),
    source: (r.source as string | null) ?? null,
    assignedUserId: (r.assigned_user_id as string | null) ?? null,
    assignedUserVerified: r.assigned_user_verified === true,
    accountAdminUserId: (r.account_admin_user_id as string | null) ?? null,
  }));
}

async function createAlert(installationId: string, candidate: BreachCandidate, now: number): Promise<CreatedAlert | null> {
  const db = sql();
  const midnight = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()));
  return db.begin(async (tx) => {
    const lock = `${installationId}:${candidate.recipientUserKey}:${midnight.toISOString().slice(0, 10)}`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    const [existing] = await tx`
      select id from alerts
      where installation_id = ${installationId} and dedupe_key = ${candidate.dedupeKey} and resolved_at is null`;
    if (existing) return null;

    const [count] = await tx`
      select count(*)::int n from alerts
      where installation_id = ${installationId}
        and kind in ('breach24', 'breach24_escalation', 'unanswered_ownerless', 'unanswered_workload', 'unanswered_handoff', 'unanswered_spike', 'unanswered_weekly')
        and recipient_user_key = ${candidate.recipientUserKey} and created_at >= ${midnight}`;
    if (Number(count?.n ?? 0) >= BREACH24_DAILY_CAP) return null;

    const waitedHours = Math.floor((now - candidate.lastAt) / 3_600_000);
    const title = `${candidate.locationName ?? "A client account"}: ${candidate.personName ?? "A contact"} has waited ${waitedHours} hours for a reply`;
    const [row] = await tx`
      insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key, recipient_user_key, created_at)
      values (${installationId}, ${candidate.locationId}, 'breach24', 'warning', ${title},
        ${tx.json({
          conversationId: candidate.conversationId,
          contactId: candidate.contactId,
          personName: candidate.personName,
          lastInboundAt: new Date(candidate.lastAt).toISOString(),
          ownerId: candidate.assignedUserVerified ? candidate.assignedUserId : null,
          source: candidate.source ?? null,
          localHour: localHour(candidate.lastAt, candidate.timeZone ?? null),
          oldestWaitHours: waitedHours,
          recipientReason: candidate.assignedUserVerified && candidate.assignedUserId ? "assigned_owner" : "account_admin_fallback",
        } as never)},
        ${candidate.dedupeKey}, ${candidate.recipientUserKey}, ${new Date(now)})
      on conflict (installation_id, dedupe_key) where resolved_at is null do nothing
      returning id`;
    if (!row) return null;
    return {
      id: row.id as string,
      locationId: candidate.locationId,
      accountName: candidate.locationName ?? "A client account",
      personName: candidate.personName ?? "A contact",
      recipientUserKey: candidate.recipientUserKey,
    };
  });
}

async function resolveClearedAlerts(installationId: string, activeKeys: string[]): Promise<void> {
  await sql()`
    with cleared as (
      select a.id, reply.at reply_at, reply.user_id reply_user_id
      from alerts a
      join cached_conversations c on c.installation_id = a.installation_id and c.location_id = a.location_id
        and c.conversation_id = a.detail->>'conversationId'
      left join lateral (
        select t.at, t.user_id from touch_events t
        where t.installation_id = a.installation_id and t.location_id = a.location_id
          and t.conversation_id = c.conversation_id and t.direction = 'outbound' and not t.automated and t.user_id is not null
          and t.at >= (a.detail->>'lastInboundAt')::timestamptz
        order by t.at asc limit 1
      ) reply on true
      where a.installation_id = ${installationId} and a.kind = 'breach24' and a.resolved_at is null
        and not (a.dedupe_key = any(${pgTextArray(activeKeys)}::text[]))
    )
    update alerts a set resolved_at = now(),
      detail = a.detail || jsonb_build_object('recoveryStatus', case when c.reply_at is not null then 'human_reply_observed' else 'reply_unverified' end,
        'replyObservedAt', c.reply_at, 'replyUserId', c.reply_user_id)
    from cleared c where a.id = c.id`;
}

type EscalationAlert = { id: string; locationId: string; recipientUserKey: string; accountName: string; personName: string; conversationId: string };

async function createEscalationAlert(installationId: string, source: EscalationAlert, now: number): Promise<string | null> {
  const db = sql();
  const midnight = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()));
  return db.begin(async (tx) => {
    const dedupeKey = `breach24-escalation:${source.id}`;
    const lock = `${installationId}:${source.recipientUserKey}:${midnight.toISOString().slice(0, 10)}`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    const [existing] = await tx`select id from alerts where installation_id = ${installationId} and dedupe_key = ${dedupeKey} and resolved_at is null`;
    if (existing) return null;
    const [count] = await tx`
      select count(*)::int n from alerts
      where installation_id = ${installationId}
        and kind in ('breach24', 'breach24_escalation', 'unanswered_ownerless', 'unanswered_workload', 'unanswered_handoff', 'unanswered_spike', 'unanswered_weekly')
        and recipient_user_key = ${source.recipientUserKey} and created_at >= ${midnight}`;
    if (Number(count?.n ?? 0) >= BREACH24_DAILY_CAP) return null;
    const [row] = await tx`
      insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key, recipient_user_key, created_at)
      values (${installationId}, ${source.locationId}, 'breach24_escalation', 'warning',
        ${`${source.accountName}: a conversation is still waiting for a reply`},
        ${tx.json({ conversationId: source.conversationId, sourceAlertId: source.id, escalationReason: "owner_alert_not_acknowledged" } as never)},
        ${dedupeKey}, ${source.recipientUserKey}, ${new Date(now)})
      on conflict (installation_id, dedupe_key) where resolved_at is null do nothing
      returning id`;
    return (row?.id as string | undefined) ?? null;
  });
}

async function escalateUnacknowledged(installationId: string, now: number, graceMinutes: number): Promise<number> {
  if (!Number.isInteger(graceMinutes) || graceMinutes < ACK_ESCALATION_GRACE_MIN || graceMinutes > ACK_ESCALATION_GRACE_MAX) {
    throw new RangeError(`Alert escalation grace must be ${ACK_ESCALATION_GRACE_MIN}-${ACK_ESCALATION_GRACE_MAX} minutes`);
  }
  const due = await sql()`
    select a.id, a.location_id, a.recipient_user_key, a.detail,
      coalesce(l.name, 'A client account') account_name, coalesce(a.detail->>'personName', 'A contact') person_name,
      a.detail->>'conversationId' conversation_id, admin.user_id admin_user_id
    from alerts a
    join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
    join lateral (
      select u.user_id from location_users u
      where u.installation_id = a.installation_id and u.location_id = a.location_id and u.role = 'account_admin'
      order by u.seen_at desc limit 1
    ) admin on true
    left join lateral (
      select s.read_at from notifications n
      left join notification_states s on s.notification_id = n.id and s.user_key = a.recipient_user_key
      where n.installation_id = a.installation_id and n.alert_id = a.id and n.recipient_user_key = a.recipient_user_key
      order by n.created_at desc limit 1
    ) state on true
    where a.installation_id = ${installationId} and a.kind = 'breach24' and a.resolved_at is null
      and a.created_at <= ${new Date(now - graceMinutes * 60_000)}
      and a.recipient_user_key is not null and admin.user_id <> a.recipient_user_key and state.read_at is null`;
  const created: Array<{ id: string; locationId: string; recipientUserKey: string; accountName: string; personName: string; conversationId: string }> = [];
  for (const row of due) {
    const item: EscalationAlert = {
      id: row.id as string, locationId: row.location_id as string, recipientUserKey: row.admin_user_id as string,
      accountName: row.account_name as string, personName: row.person_name as string, conversationId: row.conversation_id as string,
    };
    const id = await createEscalationAlert(installationId, item, now);
    if (id) created.push({ ...item, id });
  }
  if (created.length) {
    const loaded = await loadContext(installationId);
    await dispatchIntents(installationId, created.map((a) => ({
      type: "other_alerts", locationId: a.locationId, severity: "warning", recipientUserKey: a.recipientUserKey,
      respectQuietHours: true, emailDryRunOnly: true, dedupeKey: `alert:${a.id}`, alertId: a.id,
      values: { account: a.accountName, problem: `${a.personName} is still waiting; the assigned owner has not acknowledged the 24-hour alert` },
      link: { view: "inbox", locationId: a.locationId },
    })), now, loaded);
  }
  return created.length;
}

export type PrivateAlertInput = {
  accountName?: string;
  locationId: string;
  recipientUserKey: string;
  kind: string;
  dedupeKey: string;
  title: string;
  detail: Record<string, unknown>;
};

export async function createPrivateAlert(installationId: string, input: PrivateAlertInput, now: number): Promise<string | null> {
  const db = sql();
  const midnight = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()));
  return db.begin(async (tx) => {
    const lock = `${installationId}:${input.recipientUserKey}:${midnight.toISOString().slice(0, 10)}`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    const [existing] = await tx`select id from alerts where installation_id = ${installationId} and dedupe_key = ${input.dedupeKey} and resolved_at is null`;
    if (existing) return null;
    const [count] = await tx`
      select count(*)::int n from alerts
      where installation_id = ${installationId}
        and kind in ('breach24', 'breach24_escalation', 'unanswered_ownerless', 'unanswered_workload', 'unanswered_handoff', 'unanswered_spike', 'unanswered_weekly')
        and recipient_user_key = ${input.recipientUserKey} and created_at >= ${midnight}`;
    if (Number(count?.n ?? 0) >= BREACH24_DAILY_CAP) return null;
    const [row] = await tx`
      insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key, recipient_user_key, created_at)
      values (${installationId}, ${input.locationId}, ${input.kind}, 'warning', ${input.title}, ${tx.json(input.detail as never)},
        ${input.dedupeKey}, ${input.recipientUserKey}, ${new Date(now)})
      on conflict (installation_id, dedupe_key) where resolved_at is null do nothing
      returning id`;
    return (row?.id as string | undefined) ?? null;
  });
}

export async function sendOperationalAlerts(installationId: string, created: Array<{ id: string; input: PrivateAlertInput }>, now: number): Promise<void> {
  if (!created.length) return;
  const loaded = await loadContext(installationId);
  const intents: Intent[] = created.map(({ id, input }) => ({
    type: "other_alerts",
    locationId: input.locationId,
    severity: "warning",
    recipientUserKey: input.recipientUserKey,
    respectQuietHours: true,
    emailDryRunOnly: true,
    dedupeKey: `alert:${id}`,
    alertId: id,
    values: { account: input.accountName ?? "A client account", problem: input.title },
    link: { view: "inbox", locationId: input.locationId },
  }));
  await dispatchIntents(installationId, intents, now, loaded);
}

async function raiseOwnerlessAndWorkloadAlerts(installationId: string, sources: BreachSource[], now: number, enabled: boolean): Promise<number> {
  if (!enabled) {
    await sql()`update alerts set resolved_at = now()
      where installation_id = ${installationId} and kind in ('unanswered_ownerless', 'unanswered_workload') and resolved_at is null`;
    return 0;
  }
  const created: Array<{ id: string; input: PrivateAlertInput }> = [];
  const ownerless = sources.filter((r) => !r.assignedUserVerified && ownerlessFor(now, r.lastAt, null) && r.accountAdminUserId);
  const ownerlessKeys = ownerless.map((r) => `unanswered-ownerless:${r.locationId}:${r.contactId ?? `conversation-${r.conversationId}`}`);
  await sql()`
    update alerts set resolved_at = now()
    where installation_id = ${installationId} and kind = 'unanswered_ownerless' and resolved_at is null
      and not (dedupe_key = any(${pgTextArray(ownerlessKeys)}::text[]))`;
  for (const row of ownerless) {
    const input: PrivateAlertInput = {
      locationId: row.locationId, recipientUserKey: row.accountAdminUserId as string, kind: "unanswered_ownerless",
      accountName: row.locationName ?? "A client account",
      dedupeKey: `unanswered-ownerless:${row.locationId}:${row.contactId ?? `conversation-${row.conversationId}`}`,
      title: `${row.locationName ?? "A client account"}: an unanswered conversation has no verified owner`,
      detail: { conversationId: row.conversationId, contactId: row.contactId, waitingSince: new Date(row.lastAt).toISOString() },
    };
    const id = await createPrivateAlert(installationId, input, now);
    if (id) created.push({ id, input });
  }

  const ownersByAccount = new Map<string, { accountName: string | null; adminId: string; rows: BreachSource[] }>();
  for (const row of sources) {
    if (!row.assignedUserVerified || !row.assignedUserId || !row.accountAdminUserId) continue;
    const key = `${row.locationId}:${row.assignedUserId}`;
    const prior = ownersByAccount.get(key) ?? { accountName: row.locationName, adminId: row.accountAdminUserId, rows: [] };
    prior.rows.push(row);
    ownersByAccount.set(key, prior);
  }
  const workloadRows = [...ownersByAccount].map(([key, owner]) => {
    const load = workloadWarnings(owner.rows.map((r) => ({ ownerId: r.assignedUserId })))[0];
    const [locationId = "", ownerId = ""] = key.split(":");
    return { key, owner, load, locationId, ownerId };
  });
  const activeWorkloadKeys = workloadRows.filter((r) => r.load).map((r) => `unanswered-workload:${r.locationId}:${r.ownerId}`);
  await sql()`
    update alerts set resolved_at = now()
    where installation_id = ${installationId} and kind = 'unanswered_workload' and resolved_at is null
      and not (dedupe_key = any(${pgTextArray(activeWorkloadKeys)}::text[]))`;
  for (const { owner, load, locationId, ownerId } of workloadRows) {
    if (!load) continue;
    const input: PrivateAlertInput = {
      locationId, recipientUserKey: owner.adminId, kind: "unanswered_workload",
      accountName: owner.accountName ?? "A client account",
      dedupeKey: `unanswered-workload:${locationId}:${ownerId}`,
      title: `${owner.accountName ?? "A client account"}: one setter has ${load.waiting} long-waiting conversations`,
      detail: { ownerId, waiting: load.waiting },
    };
    const id = await createPrivateAlert(installationId, input, now);
    if (id) created.push({ id, input });
  }

  await sendOperationalAlerts(installationId, created, now);
  return created.length;
}

function localDayParts(now: number, zone: string | null) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone ?? "UTC", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

function localHour(at: number, zone: string | null): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: zone ?? "UTC", hourCycle: "h23", hour: "2-digit" }).format(new Date(at)));
}

async function raiseHandoffSpikeAndWeekly(
  installationId: string,
  sources: BreachSource[],
  candidates: BreachCandidate[],
  now: number,
  clock: BreachClock,
  options: { workload: boolean; digest: boolean },
): Promise<number> {
  if (!options.workload && !options.digest) {
    await sql()`update alerts set resolved_at = now()
      where installation_id = ${installationId} and kind in ('unanswered_handoff', 'unanswered_spike', 'unanswered_weekly') and resolved_at is null`;
    return 0;
  }
  if (!options.workload) {
    await sql()`update alerts set resolved_at = now()
      where installation_id = ${installationId} and kind in ('unanswered_handoff', 'unanswered_spike') and resolved_at is null`;
  }
  if (!options.digest) {
    await sql()`update alerts set resolved_at = now()
      where installation_id = ${installationId} and kind = 'unanswered_weekly' and resolved_at is null`;
  }
  const created: Array<{ id: string; input: PrivateAlertInput }> = [];
  const byLocation = new Map<string, BreachSource[]>();
  for (const row of sources) byLocation.set(row.locationId, [...(byLocation.get(row.locationId) ?? []), row]);
  const byCandidateLocation = new Map<string, BreachCandidate[]>();
  for (const candidate of candidates) byCandidateLocation.set(candidate.locationId, [...(byCandidateLocation.get(candidate.locationId) ?? []), candidate]);

  for (const [locationId, rows] of byLocation) {
    const first = rows[0];
    if (!first?.accountAdminUserId) continue;
    const accountName = first.locationName ?? "A client account";
    const zone = first.timeZone ?? null;
    const day = localDayParts(now, zone);

    if (options.workload && isHandoffWindow(now, zone, clock.closeHour)) {
      const input: PrivateAlertInput = {
        locationId, recipientUserKey: first.accountAdminUserId, accountName, kind: "unanswered_handoff",
        dedupeKey: `unanswered-handoff:${locationId}:${day.date}`,
        title: `${accountName}: ${rows.length} long-waiting conversations need a handoff`,
        detail: { waiting: rows.length, localDate: day.date },
      };
      const id = await createPrivateAlert(installationId, input, now);
      if (id) created.push({ id, input });
    }

    const active = byCandidateLocation.get(locationId) ?? [];
    if (options.workload && active.length >= 5) {
      const history = await sql()`
        select d.day::date::text day, count(a.id)::int n
        from generate_series(date_trunc('day', ${new Date(now)}::timestamptz) - interval '7 days',
          date_trunc('day', ${new Date(now)}::timestamptz) - interval '1 day', interval '1 day') d(day)
        left join alerts a on a.installation_id = ${installationId} and a.location_id = ${locationId}
          and a.kind = 'breach24' and date_trunc('day', a.created_at) = d.day
        group by d.day order by d.day`;
      const counts = history.map((r) => Number(r.n ?? 0));
      if (isBreachSpike(active.length, counts)) {
        const groups = patternCounts(active.map((r) => ({
          ownerId: r.assignedUserVerified ? r.assignedUserId : null,
          source: r.source ?? null,
          localHour: localHour(r.lastAt, r.timeZone ?? null),
        })));
        const input: PrivateAlertInput = {
          locationId, recipientUserKey: first.accountAdminUserId, accountName, kind: "unanswered_spike",
          dedupeKey: `unanswered-spike:${locationId}`,
          title: `${accountName}: unusually many conversations have reached the 24-hour reply mark`,
          detail: { current: active.length, previousDailyCounts: counts, patterns: { byOwner: groups.byOwner.slice(0, 3), bySource: groups.bySource.slice(0, 3), byHour: groups.byHour } },
        };
        const id = await createPrivateAlert(installationId, input, now);
        if (id) created.push({ id, input });
      }
    }

    if (options.digest && day.weekday === "Mon" && day.hour === 9 && day.minute < 30) {
      const [facts] = await sql()`
        select count(*) filter (where kind = 'breach24')::int breached,
          count(*) filter (where kind = 'breach24' and resolved_at is not null and detail->>'recoveryStatus' = 'human_reply_observed')::int recovered,
          count(*) filter (where kind = 'breach24' and resolved_at is null)::int unresolved,
          coalesce(array_agg(extract(epoch from ((detail->>'replyObservedAt')::timestamptz - created_at)) / 60) filter (
            where kind = 'breach24' and resolved_at is not null and detail->>'recoveryStatus' = 'human_reply_observed'), '{}') recovery_minutes
        from alerts where installation_id = ${installationId} and location_id = ${locationId}
          and created_at >= ${new Date(now - 7 * 86_400_000)}`;
      const patterns = await sql()`
        select detail->>'ownerId' owner_id, detail->>'source' source, detail->>'localHour' local_hour, count(*)::int count
        from alerts where installation_id = ${installationId} and location_id = ${locationId} and kind = 'breach24'
          and created_at >= ${new Date(now - 7 * 86_400_000)}
        group by detail->>'ownerId', detail->>'source', detail->>'localHour'
        order by count(*) desc limit 10`;
      const receipt = weeklyReceipt({
        breached: Number(facts?.breached ?? 0), recovered: Number(facts?.recovered ?? 0), unresolved: Number(facts?.unresolved ?? 0),
        recoveryMinutes: Array.isArray(facts?.recovery_minutes) ? (facts.recovery_minutes as unknown[]).map(Number) : [],
      });
      const input: PrivateAlertInput = {
        locationId, recipientUserKey: first.accountAdminUserId, accountName, kind: "unanswered_weekly",
        dedupeKey: `unanswered-weekly:${locationId}:${day.date}`,
        title: `${accountName}: this week's unanswered-message receipt`,
        detail: { ...receipt, patterns: patterns.map((r) => ({ ownerId: r.owner_id, source: r.source, localHour: r.local_hour, breaches: r.count })) },
      };
      const id = await createPrivateAlert(installationId, input, now);
      if (id) created.push({ id, input });
    }
  }
  await sendOperationalAlerts(installationId, created, now);
  return created.length;
}

export async function raiseInboxBreachForInstallation(
  installationId: string,
  now = Date.now(),
  clock?: BreachClock,
  options: { workingHours?: boolean; workload?: boolean; digest?: boolean; ackGraceMinutes?: number } = {},
): Promise<{ created: number; capped: number; unroutable: number }> {
  const activeClock = { businessHours: clock?.businessHours === true && options.workingHours === true, openHour: clock?.openHour ?? 9, closeHour: clock?.closeHour ?? 17 };
  const sources = await waitingRows(installationId, now);
  const candidates = breachCandidates(sources, now, activeClock);
  const activeKeys = sources
    .filter((r) => isBreachDue(r, now, activeClock))
    .map((r) => {
      const owner = r.assignedUserVerified && r.assignedUserId ? r.assignedUserId : r.accountAdminUserId;
      return owner ? breachDedupeKey(r.locationId, r.contactId, r.conversationId, owner) : null;
    })
    .filter((k): k is string => k !== null);
  await resolveClearedAlerts(installationId, activeKeys);

  const created: CreatedAlert[] = [];
  let capped = 0;
  for (const candidate of candidates) {
    const alert = await createAlert(installationId, candidate, now);
    if (alert) created.push(alert);
    else {
      const [existing] = await sql()`
        select 1 from alerts where installation_id = ${installationId} and dedupe_key = ${candidate.dedupeKey} and resolved_at is null`;
      if (!existing) capped++;
    }
  }

  if (created.length) {
    const loaded = await loadContext(installationId);
    const intents: Intent[] = created.map((a) => ({
      type: "other_alerts",
      locationId: a.locationId,
      severity: "warning",
      recipientUserKey: a.recipientUserKey,
      respectQuietHours: true,
      emailDryRunOnly: true,
      dedupeKey: `alert:${a.id}`,
      alertId: a.id,
      values: { account: a.accountName, problem: `${a.personName} has waited more than 24 hours for a reply` },
      link: { view: "inbox", locationId: a.locationId },
    }));
    await dispatchIntents(installationId, intents, now, loaded);
  }
  const escalated = await escalateUnacknowledged(installationId, now, options.ackGraceMinutes ?? ACK_ESCALATION_GRACE_MINUTES);
  const operational = await raiseOwnerlessAndWorkloadAlerts(installationId, sources, now, options.workload === true);
  const reportAlerts = await raiseHandoffSpikeAndWeekly(installationId, sources, candidates, now, activeClock, {
    workload: options.workload === true,
    digest: options.digest === true,
  });
  const duePeople = new Set(sources.filter((r) => isBreachDue(r, now, activeClock)).map((r) => `${r.locationId}:${r.contactId ?? `conversation-${r.conversationId}`}`));

  return {
    created: created.length + escalated + operational + reportAlerts,
    capped,
    unroutable: duePeople.size - candidates.length,
  };
}

export async function runInboxBreachCron(now = Date.now()): Promise<BreachCronReport> {
  const rep: BreachCronReport = { companies: 0, accounts: 0, alerts: 0, capped: 0, unroutable: 0, failures: 0 };
  const rows = await sql()`select id, plan from installations where uninstalled_at is null and not is_demo order by id`;
  for (const row of rows) {
    const installationId = row.id as string;
    try {
      const ent = await resolveEntitlements((row.plan as "free" | "starter" | "pro") ?? "pro", installationId);
      if (!ent.features.inbox_breach_alert || ent.locked.includes("inbox_breach_alert") || !ent.features.inbox) continue;
      rep.companies++;
      const settings = await getSettings(installationId);
      const result = await raiseInboxBreachForInstallation(installationId, now, {
        businessHours: settings.speedBusinessHours && ent.features.inbox_working_hours,
        openHour: settings.speedOpenHour,
        closeHour: settings.speedCloseHour,
      }, {
        workingHours: ent.features.inbox_working_hours && !ent.locked.includes("inbox_working_hours"),
        workload: ent.features.inbox_workload && !ent.locked.includes("inbox_workload"),
        digest: ent.features.inbox_digest && !ent.locked.includes("inbox_digest"),
        ackGraceMinutes: settings.inboxAckGraceMinutes,
      });
      rep.alerts += result.created;
      rep.capped += result.capped;
      rep.unroutable += result.unroutable;
      rep.accounts += result.created > 0 ? new Set((await waitingRows(installationId, now)).map((r) => r.locationId)).size : 0;
    } catch (error) {
      rep.failures++;
      console.error("Inbox breach refresh failed for one company", safeError(error));
    }
  }
  return rep;
}
