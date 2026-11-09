import { sql } from "../db";
import { resolveEntitlements } from "../flags";
import { safeError } from "../safe-log";
import { dispatchIntents, loadContext } from "../notifications/service";
import type { Intent } from "../notifications/dispatcher";
import { pgTextArray } from "./queries";
import { WAITING_WINDOW_DAYS } from "./waiting";
import { BREACH24_DAILY_CAP, BREACH24_HOURS, breachCandidates, breachDedupeKey, type BreachCandidate, type BreachSource } from "./inbox-breach-rules";

export { BREACH24_DAILY_CAP, BREACH24_HOURS, breachCandidates, breachDedupeKey, type BreachCandidate, type BreachSource } from "./inbox-breach-rules";

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
    select c.location_id, l.name location_name, c.conversation_id, c.contact_id,
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
      and c.last_message_at <= ${new Date(now - BREACH24_HOURS * 3_600_000)}
    order by c.location_id, coalesce(c.contact_id, 'conversation-' || c.conversation_id), c.last_message_at asc`;
  return rows.map((r) => ({
    locationId: r.location_id as string,
    locationName: (r.location_name as string | null) ?? null,
    conversationId: r.conversation_id as string,
    contactId: (r.contact_id as string | null) ?? null,
    personName: (r.person_name as string | null) ?? null,
    lastAt: r.last_message_at instanceof Date ? r.last_message_at.getTime() : Date.parse(String(r.last_message_at)),
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
      where installation_id = ${installationId} and kind = 'breach24'
        and recipient_user_key = ${candidate.recipientUserKey} and created_at >= ${midnight}`;
    if (Number(count?.n ?? 0) >= BREACH24_DAILY_CAP) return null;

    const title = `${candidate.locationName ?? "A client account"}: a conversation has waited more than 24 hours for a reply`;
    const [row] = await tx`
      insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key, recipient_user_key, created_at)
      values (${installationId}, ${candidate.locationId}, 'breach24', 'warning', ${title},
        ${tx.json({ conversationId: candidate.conversationId, contactId: candidate.contactId, oldestWaitHours: Math.floor((now - candidate.lastAt) / 3_600_000) } as never)},
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
    update alerts set resolved_at = now()
    where installation_id = ${installationId} and kind = 'breach24' and resolved_at is null
      and not (dedupe_key = any(${pgTextArray(activeKeys)}::text[]))`;
}

export async function raiseInboxBreachForInstallation(installationId: string, now = Date.now()): Promise<{ created: number; capped: number; unroutable: number }> {
  const sources = await waitingRows(installationId, now);
  const candidates = breachCandidates(sources, now);
  const activeKeys = sources
    .filter((r) => r.lastAt <= now - BREACH24_HOURS * 3_600_000 && r.lastAt > now - WAITING_WINDOW_DAYS * 86_400_000)
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

  return {
    created: created.length,
    capped,
    unroutable: new Set(sources.map((r) => `${r.locationId}:${r.contactId ?? `conversation-${r.conversationId}`}`)).size - candidates.length,
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
      const result = await raiseInboxBreachForInstallation(installationId, now);
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
