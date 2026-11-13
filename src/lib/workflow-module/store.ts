import { sql } from "../db";
import { deepLinks } from "../links";
import { ACTIONS, BLOCK_KEYS, TRIGGERS, clampThreshold, isTriggerKey, type BlockKey, type Subject, type Subscription, type TriggerKey } from "./core";

// Workflow module, database side. Every query names the installation AND the account; nothing here reads an id from a request.
// Tables come from migration 20261231220000: until it runs, `ready` is false and nothing is read or written.

const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export type BlockRow = { key: BlockKey; name: string; kind: "trigger" | "action"; short: string; enabled: boolean; threshold: number | null; unit: string | null; lastFiredAt: string | null; firedTotal: number; subscribed: boolean };

export async function blocksFor(installationId: string, locationId: string): Promise<{ ready: boolean; blocks: BlockRow[] }> {
  const db = sql();
  try {
    const [rows, subs] = await Promise.all([
      db`select block_key, enabled, threshold, last_fired_at, fired_total from wfm_settings where installation_id = ${installationId} and location_id = ${locationId}`,
      db`select distinct trigger_key from wfm_subscriptions where installation_id = ${installationId} and location_id = ${locationId}`,
    ]);
    const by = new Map(rows.map((r) => [r.block_key as string, r]));
    const subbed = new Set(subs.map((s) => s.trigger_key as string));
    const blocks: BlockRow[] = [
      ...TRIGGERS.map((t) => ({ t, kind: "trigger" as const })), ...ACTIONS.map((a) => ({ t: { ...a, unit: null as string | null, defaultThreshold: null as number | null }, kind: "action" as const })),
    ].map(({ t, kind }) => {
      const r = by.get(t.key);
      return { key: t.key, name: t.name, kind, short: t.short, enabled: r?.enabled === true, threshold: (r?.threshold as number | null) ?? t.defaultThreshold, unit: t.unit, lastFiredAt: r?.last_fired_at ? new Date(r.last_fired_at as string).toISOString() : null, firedTotal: Number(r?.fired_total ?? 0), subscribed: kind === "trigger" && subbed.has(t.key) };
    });
    return { ready: true, blocks };
  } catch (e) { if (missing(e)) return { ready: false, blocks: [] }; throw e; }
}

export async function isEnabled(installationId: string, locationId: string, key: BlockKey): Promise<boolean> {
  try {
    const [r] = await sql()`select enabled from wfm_settings where installation_id = ${installationId} and location_id = ${locationId} and block_key = ${key}`;
    return r?.enabled === true;
  } catch (e) { if (missing(e)) return false; throw e; }
}

export async function setBlock(installationId: string, locationId: string, key: string, p: { enabled?: unknown; threshold?: unknown }, by: string | null): Promise<{ ok: boolean; message?: string }> {
  if (!BLOCK_KEYS.includes(key)) return { ok: false, message: "That block does not exist." };
  const cur = await blocksFor(installationId, locationId);
  if (!cur.ready) return { ok: false, message: "Saving this needs the latest database update, which has not run yet." };
  const row = cur.blocks.find((b) => b.key === key)!;
  const enabled = typeof p.enabled === "boolean" ? p.enabled : row.enabled;
  const threshold = isTriggerKey(key) && TRIGGERS.find((t) => t.key === key)?.unit ? clampThreshold(p.threshold ?? row.threshold, key) : null;
  await sql()`insert into wfm_settings (installation_id, location_id, block_key, enabled, threshold, updated_by, updated_at) values (${installationId}, ${locationId}, ${key}, ${enabled}, ${threshold}, ${by}, now())
    on conflict (installation_id, location_id, block_key) do update set enabled = excluded.enabled, threshold = excluded.threshold, updated_by = excluded.updated_by, updated_at = now()`;
  return { ok: true };
}

/** An installed, not-ignored account: the tenant the action call belongs to. The ONLY way an action call resolves its tenant (from the verified body's locationId). */
export async function tenantOf(locationId: string): Promise<{ installationId: string; companyId: string } | null> {
  try {
    const rows = await sql()`select l.installation_id, i.company_id from locations l join installations i on i.id = l.installation_id where l.location_id = ${locationId} and not l.ignored and i.uninstalled_at is null limit 2`;
    return rows.length === 1 ? { installationId: rows[0]!.installation_id as string, companyId: rows[0]!.company_id as string } : null; // two installs claiming one account is refused, never guessed
  } catch (e) { if (missing(e)) return null; throw e; }
}

export async function saveSubscription(installationId: string, s: Subscription): Promise<boolean> {
  const db = sql();
  try {
    if (s.eventType === "DELETED") {
      await db`delete from wfm_subscriptions where installation_id = ${installationId} and location_id = ${s.locationId} and trigger_key = ${s.triggerKey} and workflow_id = ${s.workflowId} and trigger_id = ${s.triggerId}`;
    } else {
      await db`insert into wfm_subscriptions (installation_id, location_id, trigger_key, target_url, workflow_id, trigger_id, updated_at) values (${installationId}, ${s.locationId}, ${s.triggerKey}, ${s.targetUrl}, ${s.workflowId}, ${s.triggerId}, now())
        on conflict (installation_id, location_id, trigger_key, workflow_id, trigger_id) do update set target_url = excluded.target_url, updated_at = now()`;
    }
    return true;
  } catch (e) { if (missing(e)) return false; throw e; }
}

/** Idempotency for an action call: true when this call is new (and now recorded), false when it was already handled. */
export async function claimCall(installationId: string, locationId: string, actionKey: string, idem: string, contactId: string | null): Promise<boolean> {
  const rows = await sql()`insert into wfm_action_log (installation_id, location_id, action_key, idempotency_key, contact_id, result) values (${installationId}, ${locationId}, ${actionKey}, ${idem}, ${contactId}, 'pending')
    on conflict (installation_id, location_id, action_key, idempotency_key) do nothing returning id`;
  return rows.length === 1;
}
export async function finishCall(installationId: string, locationId: string, actionKey: string, idem: string, result: string): Promise<void> {
  await sql()`update wfm_action_log set result = ${result}, at = now() where installation_id = ${installationId} and location_id = ${locationId} and action_key = ${actionKey} and idempotency_key = ${idem}`;
}
export async function recentCalls(installationId: string, locationId: string, seconds = 60): Promise<number> {
  const [r] = await sql()`select count(*)::int n from wfm_action_log where installation_id = ${installationId} and location_id = ${locationId} and at > now() - make_interval(secs => ${seconds})`;
  return Number(r?.n ?? 0);
}

// ---------------- what the trigger job needs ----------------
export type Target = { installationId: string; locationId: string; tz: string | null; quiet: boolean; appDomain: string | null; subs: Array<{ triggerKey: TriggerKey; url: string }>; enabled: Map<TriggerKey, number | null>; speedTarget: number };

/** Accounts with at least one trigger switched on. */
export async function targets(limit = 200): Promise<Target[]> {
  const db = sql();
  let rows;
  try {
    rows = await db`select s.installation_id, s.location_id, s.block_key, s.threshold, l.timezone, coalesce(l.speed_target_minutes, st.speed_target_minutes, 15) speed_target, coalesce(st.alert_quiet_hours, true) quiet, coalesce(st.detected_app_domain, (select s2.detected_app_domain from installations me join installations i2 on i2.id = me.id or i2.company_id = coalesce(me.agency_company_id, me.company_id) or i2.agency_company_id = coalesce(me.agency_company_id, me.company_id) join settings s2 on s2.installation_id = i2.id where me.id = s.installation_id and s2.detected_app_domain is not null limit 1), st.ghl_app_domain) app_domain
      from wfm_settings s join locations l on l.installation_id = s.installation_id and l.location_id = s.location_id and not l.ignored
      left join settings st on st.installation_id = s.installation_id
      where s.enabled and s.block_key in ('subsync_lead_unanswered', 'subsync_no_show', 'subsync_deal_stuck', 'subsync_account_quiet') limit ${limit * 4}`;
  } catch (e) { if (missing(e)) return []; throw e; }
  const map = new Map<string, Target>();
  for (const r of rows) {
    const id = `${r.installation_id}:${r.location_id}`;
    let t = map.get(id);
    if (!t) { t = { installationId: r.installation_id as string, locationId: r.location_id as string, tz: (r.timezone as string | null) ?? null, quiet: r.quiet !== false, appDomain: (r.app_domain as string | null) ?? null, subs: [], enabled: new Map(), speedTarget: Number(r.speed_target ?? 15) }; map.set(id, t); }
    if (isTriggerKey(r.block_key)) t.enabled.set(r.block_key, (r.threshold as number | null) ?? null);
  }
  const out = [...map.values()].slice(0, limit);
  for (const t of out) {
    const subs = await db`select trigger_key, target_url from wfm_subscriptions where installation_id = ${t.installationId} and location_id = ${t.locationId}`;
    t.subs = subs.filter((s) => isTriggerKey(s.trigger_key)).map((s) => ({ triggerKey: s.trigger_key as TriggerKey, url: s.target_url as string }));
  }
  return out;
}

export async function sentCounts(installationId: string, locationId: string, key: TriggerKey): Promise<{ hour: number; day: number }> {
  const [r] = await sql()`select count(*) filter (where at > now() - interval '1 hour')::int h, count(*)::int d from wfm_fired where installation_id = ${installationId} and location_id = ${locationId} and trigger_key = ${key} and status = 'sent' and at > now() - interval '1 day'`;
  return { hour: Number(r?.h ?? 0), day: Number(r?.d ?? 0) };
}

export async function recordFired(t: Target, key: TriggerKey, dedupe: string, contactId: string | null, status: "sent" | "failed", http: number | null): Promise<boolean> {
  const db = sql();
  const rows = await db`insert into wfm_fired (installation_id, location_id, trigger_key, dedupe_key, contact_id, status, http_status) values (${t.installationId}, ${t.locationId}, ${key}, ${dedupe}, ${contactId}, ${status}, ${http})
    on conflict (installation_id, location_id, dedupe_key) where status = 'sent' do nothing returning id`;
  if (status === "sent" && rows.length === 1) await db`update wfm_settings set last_fired_at = now(), fired_total = fired_total + 1 where installation_id = ${t.installationId} and location_id = ${t.locationId} and block_key = ${key}`;
  return rows.length === 1;
}
export async function alreadySent(t: Target, dedupe: string): Promise<boolean> {
  const [r] = await sql()`select 1 x from wfm_fired where installation_id = ${t.installationId} and location_id = ${t.locationId} and dedupe_key = ${dedupe} and status = 'sent' limit 1`;
  return !!r;
}

// ---------------- who qualifies (read from SubSync's own copies; Do Not Disturb contacts never) ----------------
const mins = (from: unknown, now: number) => (from ? Math.max(0, Math.round((now - new Date(from as string).getTime()) / 60_000)) : null);

export async function candidates(t: Target, key: TriggerKey, now: number, limit: number): Promise<Subject[]> {
  const db = sql(), links = deepLinks(t.appDomain), at = new Date(now), loc = t.locationId, inst = t.installationId;
  if (key === "subsync_lead_unanswered") {
    const wait = t.enabled.get(key) ?? t.speedTarget;
    const rows = await db`select lt.contact_id, lt.conversation_id, coalesce(lt.clock_start, lt.lead_at) since, c.full_name, c.phone, c.source from lead_touches lt join cached_contacts c on c.installation_id = lt.installation_id and c.location_id = lt.location_id and c.contact_id = lt.contact_id
      where lt.installation_id = ${inst} and lt.location_id = ${loc} and lt.touch_at is null and lt.excluded is null and not c.dnd
        and coalesce(lt.clock_start, lt.lead_at) <= ${new Date(now - wait * 60_000)} and coalesce(lt.clock_start, lt.lead_at) >= ${new Date(now - 86_400_000)} order by since asc limit ${limit}`;
    return rows.map((r) => ({ contactId: r.contact_id as string, name: r.full_name as string, phone: r.phone as string | null, source: (r.source as string | null) ?? null, minutesWaiting: mins(r.since, now), pipeline: null, stage: null, owner: null, episode: `${loc}:${r.conversation_id}`, link: links.contact(loc, r.contact_id as string) }));
  }
  if (key === "subsync_no_show") {
    const rows = await db`select a.appointment_id, a.contact_id, a.start_at, a.assigned_to, c.full_name, c.phone, c.source from cached_appointments a join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
      where a.installation_id = ${inst} and a.location_id = ${loc} and lower(regexp_replace(coalesce(a.status, ''), '[ _-]', '', 'g')) = 'noshow' and a.start_at between ${new Date(now - 86_400_000)} and ${at} and not c.dnd order by a.start_at desc limit ${limit}`;
    return rows.map((r) => ({ contactId: r.contact_id as string, name: r.full_name as string, phone: r.phone as string | null, source: (r.source as string | null) ?? null, minutesWaiting: mins(r.start_at, now), pipeline: null, stage: null, owner: (r.assigned_to as string | null) ?? null, episode: `${loc}:${r.appointment_id}`, link: links.contact(loc, r.contact_id as string) }));
  }
  if (key === "subsync_deal_stuck") {
    const days = t.enabled.get(key) ?? 14;
    const rows = await db`select o.opportunity_id, o.stage_id, o.contact_id, o.pipeline_name, o.stage_name, o.last_stage_change_at, c.full_name, c.phone, c.source from cached_opportunities o join cached_contacts c on c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id
      where o.installation_id = ${inst} and o.location_id = ${loc} and o.status = 'open' and coalesce(o.monetary_value, 0) > 0 and o.last_stage_change_at <= ${new Date(now - days * 86_400_000)} and not c.dnd order by o.last_stage_change_at asc limit ${limit}`;
    return rows.map((r) => ({ contactId: r.contact_id as string, name: r.full_name as string, phone: r.phone as string | null, source: (r.source as string | null) ?? null, minutesWaiting: mins(r.last_stage_change_at, now), pipeline: (r.pipeline_name as string | null) ?? null, stage: (r.stage_name as string | null) ?? null, owner: null, episode: `${loc}:${r.opportunity_id}:${r.stage_id ?? ""}`, link: links.opportunities(loc) }));
  }
  // account quiet: no new lead for N days although leads came before (an account that never had any is not "quiet", it is new)
  const days = t.enabled.get(key) ?? 7;
  const [r] = await db`select max(lead_at) last from lead_touches where installation_id = ${inst} and location_id = ${loc}`;
  const last = r?.last ? new Date(r.last as string).getTime() : null;
  if (last === null || now - last < days * 86_400_000 || now - last > 60 * 86_400_000) return [];
  return [{ contactId: null, name: null, phone: null, source: null, minutesWaiting: mins(r!.last, now), pipeline: null, stage: null, owner: null, episode: `${loc}:quiet:${new Date(last).toISOString().slice(0, 10)}`, link: links.account(loc) }];
}
