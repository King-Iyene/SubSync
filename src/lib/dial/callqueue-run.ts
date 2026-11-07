import { sql } from "../db";
import { isLive } from "../live-flags";
import { writeToCrm } from "../ghl/crm-writes";
import { recordWrite } from "../ghl/crm-gateway";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { locationAccessToken } from "../sync/engine";
import { listWorkflows } from "../workflows/ghl";
import { sourceRows } from "../api/dial-routes";
import { keyOf } from "./dial";
import { clampCfg, cleanQueueTag, DEFAULT_TAG, planQueue, planSend, WORKFLOW_ID_RE, WRITES_PER_MIN, type Cand, type Plan } from "./callqueue";
import { execute, type Done, type Route } from "./callqueue-exec";

// CRM call queue, server side (docs/features/DIALQUEUE.md). SubSync cannot start a call itself: it fills the CRM's own queue (a tag a customer workflow listens for, or a workflow enrolment)
// through the one write gateway (WRITE_GHL_LIVE + the account's opt-in; off, every call is a "WOULD WRITE" line). Tables come from the not-yet-applied migration 20261116090000: until it
// runs, `ready` is false and nothing is read or written.

export type Settings = { locationId: string; route: "tag" | "workflow"; tag: string; workflowId: string | null; autoOn: boolean; paused: boolean; lists: string[]; maxPerRun: number; maxPerDay: number; windowStart: number; windowEnd: number; lastRunAt: number | null; lastAdded: number };
export const DEFAULT_LISTS = ["missed", "new_unanswered", "hot_uncontacted", "noshow_recovery", "redial"];
const missing = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");
const defaults = (locationId: string): Settings => ({ locationId, route: "tag", tag: DEFAULT_TAG, workflowId: null, autoOn: false, paused: false, lists: DEFAULT_LISTS, maxPerRun: 25, maxPerDay: 100, windowStart: 9, windowEnd: 20, lastRunAt: null, lastAdded: 0 });

export async function getSettings(installationId: string, locationId: string): Promise<{ ready: boolean; s: Settings }> {
  try {
    const [r] = await sql()`select * from call_queue_settings where installation_id = ${installationId} and location_id = ${locationId}`;
    if (!r) return { ready: true, s: defaults(locationId) };
    return { ready: true, s: { locationId, route: r.route === "workflow" ? "workflow" : "tag", tag: r.tag as string, workflowId: (r.workflow_id as string | null) ?? null, autoOn: r.auto_on === true, paused: r.paused === true, lists: (r.lists as string[]) ?? DEFAULT_LISTS, maxPerRun: r.max_per_run as number, maxPerDay: r.max_per_day as number, windowStart: r.window_start as number, windowEnd: r.window_end as number, lastRunAt: r.last_run_at ? new Date(r.last_run_at as string).getTime() : null, lastAdded: r.last_added as number } };
  } catch (e) { if (missing(e)) return { ready: false, s: defaults(locationId) }; throw e; }
}

export async function saveSettings(installationId: string, locationId: string, p: Record<string, unknown>): Promise<{ ok: boolean; message?: string; s?: Settings }> {
  const cur = await getSettings(installationId, locationId);
  if (!cur.ready) return { ok: false, message: "Saving this needs the latest database update, which has not run yet." };
  const c = clampCfg({ maxPerRun: Number(p.maxPerRun ?? cur.s.maxPerRun), maxPerDay: Number(p.maxPerDay ?? cur.s.maxPerDay), windowStart: Number(p.windowStart ?? cur.s.windowStart), windowEnd: Number(p.windowEnd ?? cur.s.windowEnd) });
  const route = p.route === "workflow" ? "workflow" : p.route === "tag" ? "tag" : cur.s.route;
  const tag = p.tag === undefined ? cur.s.tag : cleanQueueTag(p.tag);
  const wf = p.workflowId === undefined ? cur.s.workflowId : typeof p.workflowId === "string" && WORKFLOW_ID_RE.test(p.workflowId.trim()) ? p.workflowId.trim() : null;
  if (route === "workflow" && !wf) return { ok: false, message: "Paste the workflow id first (letters, numbers and dashes)." };
  const lists = Array.isArray(p.lists) ? (p.lists as unknown[]).filter((x): x is string => typeof x === "string" && DEFAULT_LISTS.includes(x)) : cur.s.lists;
  const autoOn = typeof p.autoOn === "boolean" ? p.autoOn : cur.s.autoOn;
  const paused = typeof p.paused === "boolean" ? p.paused : cur.s.paused;
  const db = sql();
  await db`insert into call_queue_settings (installation_id, location_id, route, tag, workflow_id, auto_on, paused, lists, max_per_run, max_per_day, window_start, window_end, updated_at)
    values (${installationId}, ${locationId}, ${route}, ${tag}, ${wf}, ${autoOn}, ${paused}, ${lists}::text[], ${c.maxPerRun}, ${c.maxPerDay}, ${c.window.start}, ${c.window.end}, now())
    on conflict (installation_id, location_id) do update set route = excluded.route, tag = excluded.tag, workflow_id = excluded.workflow_id, auto_on = excluded.auto_on, paused = excluded.paused, lists = excluded.lists,
      max_per_run = excluded.max_per_run, max_per_day = excluded.max_per_day, window_start = excluded.window_start, window_end = excluded.window_end, updated_at = now()`;
  return { ok: true, s: (await getSettings(installationId, locationId)).s };
}

export const modeFor = async (installationId: string, locationId: string, demo = false) => {
  const optedIn = demo ? false : await writeEnabledFor(installationId, locationId);
  return { masterOn: !demo && isLive("WRITE_GHL_LIVE"), optedIn, live: !demo && isLive("WRITE_GHL_LIVE") && optedIn };
};

async function memory(installationId: string, locationId: string) {
  const db = sql();
  const rows = await db`select contact_id, max(at) at, count(*) filter (where at > now() - interval '24 hours' and status = 'saved' and action <> 'remove')::int today from call_queue_log
    where installation_id = ${installationId} and location_id = ${locationId} and at > now() - interval '24 hours' and status = 'saved' and action <> 'remove' group by contact_id`;
  const last = new Map(rows.map((r) => [`${locationId}:${r.contact_id as string}`, new Date(r.at as string).getTime()]));
  return { last, addedToday: rows.length };
}

async function taggedKeys(installationId: string, locationId: string, tag: string): Promise<Set<string>> {
  const rows = await sql()`select contact_id from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and exists (select 1 from unnest(tags) t where lower(t) = ${tag.toLowerCase()}) limit 2000`;
  return new Set(rows.map((r) => `${locationId}:${r.contact_id as string}`));
}

export async function candidates(installationId: string, locationId: string, lists: string[], only?: ReadonlySet<string>): Promise<Cand[]> {
  const out: Cand[] = [];
  for (const list of lists) {
    const rows = await sourceRows({ installationId }, [locationId], list).catch(() => []);
    for (const r of rows) {
      const key = keyOf(r);
      if (only && !only.has(key)) continue;
      out.push({ key, contactId: r.contactId, locationId: r.locationId, name: r.name, phone: r.phone, dnd: r.dnd, timeZone: r.timeZone, openValue: r.openValue, ageHours: r.ageHours, priority: r.priority, list });
    }
  }
  return out;
}

const routeOf = (s: Settings): Route | null => (s.route === "workflow" ? (s.workflowId ? { route: "workflow", workflowId: s.workflowId } : null) : { route: "tag", tag: s.tag });
const cfgOf = (s: Settings, addedToday: number, writeBudget: number) => ({ ...clampCfg({ maxPerRun: s.maxPerRun, maxPerDay: s.maxPerDay, windowStart: s.windowStart, windowEnd: s.windowEnd }), addedToday, writeBudget });

export type Preview = { ok: boolean; ready: boolean; plan: Plan | null; live: boolean; route: "tag" | "workflow"; message: string; inQueue: number; names: Array<{ key: string; name: string; phone: string | null; list: string }> };

/** What an automatic run (`auto`) or a manual send of these people (`keys`) would do right now. Reads only. */
export async function preview(installationId: string, locationId: string, o: { auto: boolean; lists?: string[]; keys?: string[]; limit?: number }, now = Date.now(), demo = false): Promise<Preview> {
  const { ready, s } = await getSettings(installationId, locationId);
  if (!ready) return { ok: false, ready: false, plan: null, live: false, route: s.route, message: "This needs the latest database update, which has not run yet. Nothing was sent.", inQueue: 0, names: [] };
  const route = routeOf(s);
  if (!route) return { ok: false, ready: true, plan: null, live: false, route: s.route, message: "Choose the workflow first (Check setup).", inQueue: 0, names: [] };
  const mode = await modeFor(installationId, locationId, demo);
  const mem = await memory(installationId, locationId);
  const tagged = route.route === "tag" ? await taggedKeys(installationId, locationId, route.tag) : new Set<string>();
  const cands = await candidates(installationId, locationId, o.lists ?? s.lists, o.keys ? new Set(o.keys) : undefined);
  const plan = o.auto ? planQueue(cands, tagged, mem.last, cfgOf(s, mem.addedToday, WRITES_PER_MIN), now) : planSend(cands, tagged, mem.last, cfgOf(s, mem.addedToday, WRITES_PER_MIN), now, o.limit);
  const byKey = new Map(cands.map((c) => [c.key, c]));
  return { ok: true, ready: true, plan, live: mode.live, route: s.route, message: plan.sendNote, inQueue: tagged.size, names: plan.add.slice(0, 50).map((c) => ({ key: c.key, name: byKey.get(c.key)?.name ?? "Lead", phone: c.phone, list: c.list })) };
}

/** Carries a plan out through the one write gateway. Off (switch or opt-in): a dry run, nothing sent, nothing recorded as queued. */
export async function apply(a: { installationId: string; companyId: string; locationId: string; actor: string | null; source: "auto" | "manual"; plan: Plan; settings: Settings; demo?: boolean }): Promise<Done & { live: boolean }> {
  const route = routeOf(a.settings);
  const mode = await modeFor(a.installationId, a.locationId, a.demo);
  const db = sql();
  if (!route) return { added: 0, removed: 0, wouldAdd: 0, wouldRemove: 0, failed: 0, needsPermission: false, stoppedEarly: false, live: mode.live };
  const write = async (request: Parameters<typeof writeToCrm>[0]["request"], contactId: string, op: string) => {
    const r = await writeToCrm({ installationId: a.installationId, locationId: a.locationId, contactId, request, token: () => locationAccessToken(a.companyId, a.locationId) }, mode.optedIn ? {} : { env: {} });
    await recordWrite({ installationId: a.installationId, actor: a.actor, locationId: a.locationId, contactId, op, fields: Object.keys(request.body), result: r.outcome }).catch(() => undefined);
    return r;
  };
  const done = await execute(a.plan, route, write, async (x) => {
    if (x.status === "dry_run") return;
    await db`insert into call_queue_log (installation_id, location_id, contact_id, action, source, status) values (${a.installationId}, ${a.locationId}, ${x.contactId}, ${x.action}, ${a.source}, ${x.status})`.catch(() => undefined);
    if (x.status === "saved" && route.route === "tag") {
      const t = route.tag;
      await (x.action === "remove"
        ? db`update cached_contacts set tags = array_remove(tags, ${t}) where installation_id = ${a.installationId} and location_id = ${a.locationId} and contact_id = ${x.contactId}`
        : db`update cached_contacts set tags = array_append(tags, ${t}) where installation_id = ${a.installationId} and location_id = ${a.locationId} and contact_id = ${x.contactId} and not (${t} = any(coalesce(tags, '{}')))`).catch(() => undefined);
    }
  });
  if (mode.live) await db`update call_queue_settings set last_run_at = now(), last_added = ${done.added} where installation_id = ${a.installationId} and location_id = ${a.locationId}`.catch(() => undefined);
  return { ...done, live: mode.live };
}

/** The scheduled path (the existing sync cron): every account with Auto switched on and not paused, each held to 30 writes a run. */
export async function runAutoCallQueues(now = Date.now()): Promise<{ accounts: number; added: number; removed: number }> {
  let rows: Array<{ installation_id: string; location_id: string; company_id: string }> = [];
  try {
    rows = (await sql()`select s.installation_id, s.location_id, i.company_id from call_queue_settings s join installations i on i.id = s.installation_id join locations l on l.installation_id = s.installation_id and l.location_id = s.location_id and not l.ignored where s.auto_on and not s.paused limit 200`) as never;
  } catch (e) { if (missing(e)) return { accounts: 0, added: 0, removed: 0 }; throw e; }
  let added = 0, removed = 0;
  for (const r of rows) {
    try {
      const { s } = await getSettings(r.installation_id, r.location_id);
      const p = await preview(r.installation_id, r.location_id, { auto: true }, now);
      if (!p.ok || !p.plan || !p.live) continue; // preview only while writes are off: nothing is sent and nothing is recorded
      const d = await apply({ installationId: r.installation_id, companyId: r.company_id, locationId: r.location_id, actor: null, source: "auto", plan: p.plan, settings: s });
      added += d.added; removed += d.removed;
    } catch (e) { console.error("call queue run", e instanceof Error ? e.message : "failed"); }
  }
  return { accounts: rows.length, added, removed };
}

/** Read-only validation of a pasted workflow id (workflows.readonly). When the list cannot be read the id is kept unverified and the answer says so. */
export async function checkSetup(installationId: string, companyId: string, locationId: string, s: Settings): Promise<{ ok: boolean; verified: boolean; message: string; workflows: Array<{ id: string; name: string }> }> {
  if (s.route === "tag") return { ok: true, verified: false, workflows: [], message: `Nothing to check on SubSync's side. In your CRM, create a workflow that starts when a contact is tagged “${s.tag}” and has a Manual Action: Call step. SubSync cannot see inside your workflow.` };
  if (!s.workflowId) return { ok: false, verified: false, workflows: [], message: "Paste the workflow id first." };
  const r = await listWorkflows({ token: await locationAccessToken(companyId, locationId), locationId }, 300).catch(() => null);
  if (!r || !r.ok) return { ok: true, verified: false, workflows: [], message: "SubSync cannot read your workflow list (the permission is optional or the CRM refused). The id is kept, but it is not checked." };
  const list = r.value.map((w) => ({ id: w.workflowId, name: w.name, status: w.status }));
  const hit = list.find((w) => w.id === s.workflowId);
  const pick = list.slice(0, 100).map((w) => ({ id: w.id, name: w.name }));
  if (!hit) return { ok: false, verified: true, workflows: pick, message: "That id is not one of this account's workflows." };
  const live = String(hit.status).toLowerCase().includes("publish") || String(hit.status).toLowerCase() === "active";
  return { ok: live, verified: true, workflows: pick, message: live ? `Found “${hit.name}” and it is published. SubSync cannot see whether it has a Manual Action: Call step, so check that in your CRM.` : `Found “${hit.name}” but it is not published. Publish it in your CRM first.` };
}

export async function status(installationId: string, locationIds: string[]) {
  try {
    const db = sql();
    const rows = await db`select location_id, auto_on, paused, tag, route, last_run_at from call_queue_settings where installation_id = ${installationId} and location_id = any(${locationIds}::text[])`;
    const out = [];
    for (const r of rows) {
      const inQueue = r.route === "tag" ? (await taggedKeys(installationId, r.location_id as string, r.tag as string)).size : 0;
      out.push({ locationId: r.location_id as string, autoOn: r.auto_on === true, paused: r.paused === true, inQueue, lastRunAt: r.last_run_at ? new Date(r.last_run_at as string).getTime() : null, tag: r.tag as string });
    }
    return { ready: true, accounts: out };
  } catch (e) { if (missing(e)) return { ready: false, accounts: [] }; throw e; }
}
