import { randomBytes } from "node:crypto";
import { sql } from "../db";
import { setManualTask } from "./queries";
import { currentSnapshotVersion, snapshotOk } from "./definitions-sql";
import { cleanSteps, dealFigures, validTemplateIndustry, TEMPLATE_NAME_MAX, type AccountFacts, type NoteInput, type QuarterFacts, type StepPatch, type StepState, type TemplateStep } from "./client-success";
import type { Deal } from "./pipeline-intel";

// The database side of the Clients module (stage C1). Every function takes the installation id from the signed session and, for anything about one
// client, the list of client accounts the caller may see (`allowed`, null meaning all of the company's own). A client account that is not in the
// company, or not allowed, is treated as not found: nothing is read or written for it.

const DAY = 86_400_000;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

/** Is this one of the company's own client accounts, and may the caller see it? */
export async function locationVisible(installationId: string, allowed: string[] | null, locationId: string): Promise<boolean> {
  if (allowed && !allowed.includes(locationId)) return false;
  const db = sql();
  const rows = await db`select 1 from locations where installation_id = ${installationId} and location_id = ${locationId} and not ignored`;
  return rows.length > 0;
}

const scopeOf = (allowed: string[] | null) => (allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``);

// ---------------------------------------------------------------- notes: the log of conversations

export type NoteRow = { id: string; kind: string; body: string; author: string | null; occurredOn: string; createdAt: string };
export const MAX_NOTES_PER_CLIENT = 500;

export async function listNotes(installationId: string, allowed: string[] | null, locationId: string, limit = 40): Promise<NoteRow[]> {
  if (!(await locationVisible(installationId, allowed, locationId))) return [];
  const rows = await sql()`select id, kind, body, author, occurred_on::text occurred_on, created_at from client_notes
    where installation_id = ${installationId} and location_id = ${locationId} order by occurred_on desc, created_at desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id as string, kind: r.kind as string, body: r.body as string, author: (r.author as string | null) ?? null, occurredOn: r.occurred_on as string, createdAt: (r.created_at as Date).toISOString() }));
}

export async function addNote(installationId: string, allowed: string[] | null, locationId: string, author: string | null, note: NoteInput): Promise<"ok" | "not_found" | "full"> {
  if (!(await locationVisible(installationId, allowed, locationId))) return "not_found";
  const db = sql();
  const [c] = await db`select count(*)::int n from client_notes where installation_id = ${installationId} and location_id = ${locationId}`;
  if ((c.n as number) >= MAX_NOTES_PER_CLIENT) return "full";
  await db`insert into client_notes (installation_id, location_id, kind, body, author, occurred_on) values (${installationId}, ${locationId}, ${note.kind}, ${note.body}, ${author}, coalesce(${note.occurredOn}::date, current_date))`;
  return "ok";
}

export async function deleteNote(installationId: string, allowed: string[] | null, locationId: string, noteId: string): Promise<boolean> {
  if (!(await locationVisible(installationId, allowed, locationId))) return false;
  const gone = await sql()`delete from client_notes where installation_id = ${installationId} and location_id = ${locationId} and id = ${noteId}::uuid returning id`;
  return gone.length > 0;
}

/** Per client: how many notes there are and the date of the newest logged conversation (for "last spoken"). */
export async function noteSummaries(installationId: string, allowed: string[] | null): Promise<Map<string, { count: number; lastConversationOn: string | null; lastNote: { body: string; author: string | null; on: string } | null }>> {
  const db = sql();
  const rows = await db`select location_id, count(*)::int n, max(occurred_on) filter (where kind = 'conversation')::text last_conversation from client_notes
    where installation_id = ${installationId} ${scopeOf(allowed)} group by location_id`;
  const latest = await db`select distinct on (location_id) location_id, body, author, occurred_on::text occurred_on from client_notes
    where installation_id = ${installationId} ${scopeOf(allowed)} order by location_id, occurred_on desc, created_at desc`;
  const last = new Map(latest.map((r) => [r.location_id as string, { body: r.body as string, author: (r.author as string | null) ?? null, on: r.occurred_on as string }]));
  return new Map(rows.map((r) => [r.location_id as string, { count: r.n as number, lastConversationOn: (r.last_conversation as string | null) ?? null, lastNote: last.get(r.location_id as string) ?? null }]));
}

// ---------------------------------------------------------------- onboarding templates

export type Template = { id: string; name: string; industryKey: string | null; steps: TemplateStep[]; updatedAt: string };
export const MAX_TEMPLATES = 20;
export const newKey = () => randomBytes(5).toString("hex");

export async function listTemplates(installationId: string): Promise<Template[]> {
  const rows = await sql()`select id, name, industry_key, steps, updated_at from onboarding_templates where installation_id = ${installationId} order by name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, industryKey: (r.industry_key as string | null) ?? null, steps: ((r.steps as TemplateStep[] | null) ?? []).filter((s) => s && typeof s.label === "string"), updatedAt: (r.updated_at as Date).toISOString() }));
}

export async function saveTemplate(installationId: string, input: { id?: string | null; name?: unknown; industryKey?: unknown; steps?: unknown }): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Give the template a name", status: 400 };
  if (name.length > TEMPLATE_NAME_MAX) return { ok: false, error: `A name can be at most ${TEMPLATE_NAME_MAX} characters`, status: 400 };
  const industry = validTemplateIndustry(input.industryKey);
  if (industry === undefined) return { ok: false, error: "Pick one of the listed kinds of business, or leave it for every client", status: 400 };
  const cleaned = cleanSteps(input.steps ?? [], newKey);
  if (!cleaned.ok) return { ok: false, error: cleaned.error, status: 400 };
  const db = sql();
  const json = db.json(cleaned.steps as never);
  if (input.id) {
    const done = await db`update onboarding_templates set name = ${name}, industry_key = ${industry}, steps = ${json}, updated_at = now() where installation_id = ${installationId} and id = ${input.id}::uuid returning id`.catch(() => null);
    if (done === null) return { ok: false, error: "A template with that name already exists", status: 409 };
    return done.length ? { ok: true, id: done[0].id as string } : { ok: false, error: "Template not found", status: 404 };
  }
  const [c] = await db`select count(*)::int n from onboarding_templates where installation_id = ${installationId}`;
  if ((c.n as number) >= MAX_TEMPLATES) return { ok: false, error: `You can keep at most ${MAX_TEMPLATES} templates`, status: 400 };
  const made = await db`insert into onboarding_templates (installation_id, name, industry_key, steps) values (${installationId}, ${name}, ${industry}, ${json}) returning id`.catch(() => null);
  return made ? { ok: true, id: made[0].id as string } : { ok: false, error: "A template with that name already exists", status: 409 };
}

export async function deleteTemplate(installationId: string, id: string): Promise<boolean> {
  const gone = await sql()`delete from onboarding_templates where installation_id = ${installationId} and id = ${id}::uuid returning id`;
  return gone.length > 0;
}

// ---------------------------------------------------------------- step state and history

export async function loadStates(installationId: string, allowed: string[] | null): Promise<Map<string, StepState[]>> {
  const rows = await sql()`select location_id, step_key, is_custom, label, assignee, due_on::text due_on, done_at, done_by from client_steps
    where installation_id = ${installationId} ${scopeOf(allowed)} order by created_at`;
  const out = new Map<string, StepState[]>();
  for (const r of rows) {
    const list = out.get(r.location_id as string) ?? [];
    list.push({ stepKey: r.step_key as string, isCustom: r.is_custom === true, label: (r.label as string | null) ?? null, assignee: (r.assignee as string | null) ?? null, dueOn: (r.due_on as string | null) ?? null, doneAt: r.done_at instanceof Date ? r.done_at.toISOString() : null, doneBy: (r.done_by as string | null) ?? null });
    out.set(r.location_id as string, list);
  }
  return out;
}

export type HistoryRow = { event: "done" | "reopened" | "assigned" | "due" | "added" | "removed"; stepKey: string; stepLabel: string | null; detail: string | null; actor: string | null; at: string };
export async function listHistory(installationId: string, allowed: string[] | null, locationId: string, limit = 30): Promise<HistoryRow[]> {
  if (!(await locationVisible(installationId, allowed, locationId))) return [];
  const rows = await sql()`select event, step_key, step_label, detail, actor, at from client_step_history where installation_id = ${installationId} and location_id = ${locationId} order by at desc, id desc limit ${limit}`;
  return rows.map((r) => ({ event: r.event as HistoryRow["event"], stepKey: r.step_key as string, stepLabel: (r.step_label as string | null) ?? null, detail: (r.detail as string | null) ?? null, actor: (r.actor as string | null) ?? null, at: (r.at as Date).toISOString() }));
}

/** When each client last had a step finished (for "no progress for N days"). */
export async function lastProgress(installationId: string, allowed: string[] | null): Promise<Map<string, number>> {
  const rows = await sql()`select location_id, max(at) at from client_step_history where installation_id = ${installationId} and event = 'done' ${scopeOf(allowed)} group by location_id`;
  return new Map(rows.map((r) => [r.location_id as string, ms(r.at) ?? 0]));
}

/** Change one step of one client: who is on it, when it is due, whether it is done. Writes the history in the same go. `label` is the step's name as the
 *  caller worked it out from the client's own checklist (the caller has already checked the step exists and may be ticked). */
export async function changeStep(installationId: string, allowed: string[] | null, locationId: string, stepKey: string, label: string, patch: StepPatch, actor: string | null, isCustom = false): Promise<boolean> {
  if (!(await locationVisible(installationId, allowed, locationId))) return false;
  const db = sql();
  const [cur] = await db`select assignee, due_on::text due_on, done_at from client_steps where installation_id = ${installationId} and location_id = ${locationId} and step_key = ${stepKey}`;
  const was = { assignee: (cur?.assignee as string | null) ?? null, dueOn: (cur?.due_on as string | null) ?? null, done: Boolean(cur?.done_at) };
  const next = { assignee: "assignee" in patch ? patch.assignee ?? null : was.assignee, dueOn: "dueOn" in patch ? patch.dueOn ?? null : was.dueOn, done: "done" in patch ? patch.done === true : was.done };
  const events: Array<{ event: HistoryRow["event"]; detail: string | null }> = [];
  if (next.done !== was.done) events.push({ event: next.done ? "done" : "reopened", detail: null });
  if (next.assignee !== was.assignee) events.push({ event: "assigned", detail: next.assignee });
  if (next.dueOn !== was.dueOn) events.push({ event: "due", detail: next.dueOn });
  if (events.length === 0) return true;
  await db`
    insert into client_steps (installation_id, location_id, step_key, is_custom, label, assignee, due_on, done_at, done_by)
    values (${installationId}, ${locationId}, ${stepKey}, ${isCustom}, ${isCustom ? label : null}, ${next.assignee}, ${next.dueOn}::date, ${next.done ? new Date() : null}, ${next.done ? actor : null})
    on conflict (installation_id, location_id, step_key) do update set assignee = excluded.assignee, due_on = excluded.due_on,
      done_at = case when ${next.done}::boolean then coalesce(client_steps.done_at, excluded.done_at) else null end, done_by = case when ${next.done}::boolean then coalesce(client_steps.done_by, excluded.done_by) else null end, updated_at = now()`;
  // The older checklist keeps its done flag for these two kinds of step, so the business view and the account page keep agreeing with this one.
  if ((stepKey.startsWith("manual:") || stepKey.startsWith("custom:")) && next.done !== was.done) await setManualTask(installationId, locationId, stepKey, next.done);
  for (const e of events) await db`insert into client_step_history (installation_id, location_id, step_key, step_label, event, detail, actor) values (${installationId}, ${locationId}, ${stepKey}, ${label}, ${e.event}, ${e.detail}, ${actor})`;
  return true;
}

/** Names to pick from when giving a step to someone: the team members SubSync knows by name, and anyone already given a step. */
export async function listPeople(installationId: string): Promise<string[]> {
  const rows = await sql()`
    select name from team_names where installation_id = ${installationId} and nullif(trim(name), '') is not null
    union select assignee from client_steps where installation_id = ${installationId} and nullif(trim(assignee), '') is not null
    order by 1 limit 60`;
  return rows.map((r) => r.name as string);
}

export const MAX_CUSTOM_STEPS = 25;
export async function addCustomStep(installationId: string, allowed: string[] | null, locationId: string, label: string, actor: string | null): Promise<{ ok: true; key: string } | { ok: false; error: string; status: number }> {
  if (!(await locationVisible(installationId, allowed, locationId))) return { ok: false, error: "Client not found", status: 404 };
  const text = label.trim();
  if (!text || text.length > 120) return { ok: false, error: "Give the step a name of up to 120 characters", status: 400 };
  const db = sql();
  const [c] = await db`select count(*)::int n from client_steps where installation_id = ${installationId} and location_id = ${locationId} and is_custom`;
  if ((c.n as number) >= MAX_CUSTOM_STEPS) return { ok: false, error: `A client can have at most ${MAX_CUSTOM_STEPS} extra steps`, status: 400 };
  const key = `step:${randomBytes(4).toString("hex")}`;
  await db`insert into client_steps (installation_id, location_id, step_key, is_custom, label) values (${installationId}, ${locationId}, ${key}, true, ${text})`;
  await db`insert into client_step_history (installation_id, location_id, step_key, step_label, event, actor) values (${installationId}, ${locationId}, ${key}, ${text}, 'added', ${actor})`;
  return { ok: true, key };
}

export async function removeCustomStep(installationId: string, allowed: string[] | null, locationId: string, stepKey: string, actor: string | null): Promise<boolean> {
  if (!(await locationVisible(installationId, allowed, locationId))) return false;
  const db = sql();
  const gone = await db`delete from client_steps where installation_id = ${installationId} and location_id = ${locationId} and step_key = ${stepKey} and is_custom returning label`;
  if (gone.length === 0) return false;
  await db`insert into client_step_history (installation_id, location_id, step_key, step_label, event, actor) values (${installationId}, ${locationId}, ${stepKey}, ${gone[0].label as string | null}, 'removed', ${actor})`;
  return true;
}

// ---------------------------------------------------------------- facts the automatic checks use

export type OnboardingFacts = AccountFacts & { installedAt: number | null };
export async function accountFacts(installationId: string, allowed: string[] | null): Promise<Map<string, OnboardingFacts>> {
  const rows = await sql()`
    select l.location_id, l.website, l.timezone, l.address, l.appointments_access, l.installed_at,
      (select count(*)::int from cached_appointments a where a.installation_id = l.installation_id and a.location_id = l.location_id) appointments
    from locations l where l.installation_id = ${installationId} and not l.ignored ${allowed ? sql()`and l.location_id = any(${allowed}::text[])` : sql()``}`;
  return new Map(rows.map((r) => [r.location_id as string, {
    website: (r.website as string | null) ?? null, timezone: (r.timezone as string | null) ?? null, address: (r.address as string | null) ?? null,
    appointments: r.appointments as number, appointmentsAccess: (r.appointments_access as string | null) ?? null, installedAt: ms(r.installed_at),
  }]));
}

// ---------------------------------------------------------------- trends

/** One client's weeks of appointments: how many, how many were attended or missed, and the appointments themselves (the list behind each bar). */
export type ApptWeek = { weekStart: number; count: number; showed: number; noShow: number; members: Array<{ contactId: string; name: string; status: string; startAt: number }> };
export const APPT_MEMBER_CAP = 40;
export async function weeklyAppointments(installationId: string, locationId: string, now: number, weeks = 14): Promise<ApptWeek[]> {
  const WEEK = 7 * DAY;
  const from = now - weeks * WEEK;
  const rows = await sql()`
    select a.contact_id, a.status, a.start_at, coalesce(nullif(c.full_name, ''), nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.email, 'Unnamed contact') name
    from cached_appointments a
    left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
    where a.installation_id = ${installationId} and a.location_id = ${locationId} and a.start_at >= ${new Date(from)} and a.start_at < ${new Date(now)}
      and coalesce(a.status, 'new') not in ('cancelled', 'invalid') order by a.start_at desc limit 5000`;
  const out: ApptWeek[] = Array.from({ length: weeks }, (_, k) => ({ weekStart: now - (weeks - k) * WEEK, count: 0, showed: 0, noShow: 0, members: [] }));
  for (const r of rows) {
    const t = ms(r.start_at) ?? 0;
    const k = Math.min(weeks - 1, Math.max(0, Math.floor((t - from) / WEEK)));
    const w = out[k];
    w.count += 1;
    if (r.status === "showed") w.showed += 1;
    if (r.status === "noshow") w.noShow += 1;
    if (w.members.length < APPT_MEMBER_CAP) w.members.push({ contactId: (r.contact_id as string | null) ?? "", name: r.name as string, status: (r.status as string | null) ?? "new", startAt: t });
  }
  return out;
}

// ---------------------------------------------------------------- reviews: one quarter of one client

export async function quarterFacts(installationId: string, locationId: string, q: { from: string; to: string }, deals: ReadonlyArray<Deal>): Promise<QuarterFacts> {
  const db = sql();
  const from = new Date(`${q.from}T00:00:00Z`);
  const toExclusive = new Date(new Date(`${q.to}T00:00:00Z`).getTime() + DAY);
  const version = await currentSnapshotVersion(installationId);
  const [[contacts], health, [appts], alerts] = await Promise.all([
    db`select count(*)::int n from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and date_added >= ${from} and date_added < ${toExclusive}`,
    db`select m.day, m.engagement_score from account_metrics_daily m where m.installation_id = ${installationId} and m.location_id = ${locationId} and m.day >= ${q.from}::date and m.day <= ${q.to}::date and ${snapshotOk("m", version)} order by m.day`,
    db`select count(*) filter (where status in ('showed', 'noshow'))::int with_outcome, count(*) filter (where status = 'showed')::int showed from cached_appointments
       where installation_id = ${installationId} and location_id = ${locationId} and start_at >= ${from} and start_at < ${toExclusive}`,
    db`select count(*)::int raised, count(*) filter (where resolved_at is not null)::int resolved from alerts where installation_id = ${installationId} and location_id = ${locationId} and recipient_user_key is null and kind <> 'sync' and created_at >= ${from} and created_at < ${toExclusive}`,
  ]);
  const money = dealFigures(deals.filter((d) => d.locationId === locationId), from.getTime(), toExclusive.getTime()).get(locationId) ?? { pipelineCreated: 0, wonValue: 0, wonCount: 0 };
  const scores = health.map((h) => h.engagement_score as number);
  return {
    contactsAdded: contacts.n as number, healthStart: scores.length ? scores[0] : null, healthEnd: scores.length ? scores[scores.length - 1] : null, healthDays: scores.length,
    pipelineCreated: Math.round(money.pipelineCreated), wonCount: money.wonCount, wonValue: Math.round(money.wonValue), openValueEnd: null,
    apptWithOutcome: appts.with_outcome as number, apptShowed: appts.showed as number, alertsRaised: alerts[0].raised as number, alertsResolved: alerts[0].resolved as number,
  };
}

/** Every alert of one client with its dates, for the "what SubSync caught" section of a review. */
export async function alertsOf(installationId: string, locationId: string, limit = 500): Promise<Array<{ kind: string; title: string; createdAt: string; resolvedAt: string | null }>> {
  const rows = await sql()`select kind, title, created_at, resolved_at from alerts where installation_id = ${installationId} and location_id = ${locationId} and recipient_user_key is null order by created_at desc limit ${limit}`;
  return rows.map((r) => ({ kind: r.kind as string, title: r.title as string, createdAt: (r.created_at as Date).toISOString(), resolvedAt: r.resolved_at instanceof Date ? r.resolved_at.toISOString() : null }));
}

/** When SubSync's own record of a client starts (the first daily snapshot), so a review can say "history starts on ...". */
export async function historyStart(installationId: string, locationId: string): Promise<string | null> {
  const [r] = await sql()`select min(day)::text d from account_metrics_daily where installation_id = ${installationId} and location_id = ${locationId}`;
  return (r?.d as string | null) ?? null;
}
