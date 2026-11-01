import type { DerivedAccount } from "../analytics/derive";
import { onboardingChecklist } from "../analytics/derive";
import { allManualTasks, listDomainChecks, metricsTrend, type Settings } from "../analytics/queries";
import {
  buildOnboardingItems, DEFAULT_STUCK_DAYS, historyLine, isStuck, parseStuckDays, starterFromPlaybook, templateFor, validateNote, validateStepPatch,
  type OnboardingItem,
} from "../analytics/client-success";
import { clientExtras } from "../analytics/client-queries";
import {
  accountFacts, addCustomStep, addNote, changeStep, deleteNote, deleteTemplate, historyStart, listHistory, listNotes, listTemplates, lastProgress, loadStates, locationVisible,
  newKey, removeCustomStep, saveTemplate, weeklyAppointments,
} from "../analytics/client-success-queries";
import { MAX_COMPARE } from "../analytics/client-success";
import { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// The routes of the Clients module that are new in stage C1 (onboarding with templates, steps and history; the log of conversations; the trend series
// behind the charts). They live here so the shared router stays small; the router hands each one the same context and its own two helpers, so every
// route is scoped exactly like the rest: the installation comes from the signed session, and the client accounts a caller may see come from allowedIds.
// All of them are agency only except the trends of one client, which a business or a client's staff may read for their own account (the router's
// route policy decides who gets here, and every read below still checks the client account against `allowedIds`).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type Deps = {
  allowedIds: (ctx: Ctx) => Promise<string[] | null>;
  accountsFor: (ctx: Ctx) => Promise<{ settings: Settings; accounts: DerivedAccount[]; links: ReturnType<typeof deepLinks> }>;
  actorOf: (ctx: Ctx) => string | null;
  locationId: RegExp;
};

const DAY = 86_400_000;
const body = async (ctx: Ctx) => (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;

// ---------------------------------------------------------------- onboarding

async function onboardingRows(ctx: Ctx, deps: Deps, only?: string) {
  const allowed = await deps.allowedIds(ctx);
  const now = Date.now();
  const [{ settings, accounts }, manual, domains, templates, states, facts, progress, extras] = await Promise.all([
    deps.accountsFor(ctx), allManualTasks(ctx.installationId), listDomainChecks(ctx.installationId), listTemplates(ctx.installationId), loadStates(ctx.installationId, allowed),
    accountFacts(ctx.installationId, allowed), lastProgress(ctx.installationId, allowed), clientExtras(ctx.installationId, allowed),
  ]);
  const links = deepLinks(settings.appDomain);
  const rows = accounts.filter((a) => !a.ignored && (!only || a.locationId === only)).map((a) => {
    const mine = domains.filter((d) => d.locationId === a.locationId);
    const worst = mine.find((d) => d.status === "critical") ?? mine.find((d) => d.status === "warning") ?? mine[0] ?? null;
    const base = onboardingChecklist(a, { domainStatus: worst?.status ?? null, manual: manual.get(a.locationId) ?? {}, custom: settings.customChecklist });
    const f = facts.get(a.locationId);
    const e = extras.get(a.locationId);
    const industry = e?.industry ?? null;
    const tpl = templateFor(templates, industry);
    const built = buildOnboardingItems({
      base: base.items, facts: f ?? { website: a.website, timezone: null, address: null, appointments: 0, appointmentsAccess: null }, templateSteps: tpl?.steps ?? [], states: states.get(a.locationId) ?? [],
      manualDone: manual.get(a.locationId) ?? {}, locationId: a.locationId, links: settings.appDomain, nowMs: now,
    });
    const installedAt = f?.installedAt ?? e?.installedAt ?? null;
    const daysIn = installedAt === null ? null : Math.max(0, Math.floor((now - installedAt) / DAY));
    return {
      locationId: a.locationId, name: a.name, owner: a.owner, url: links.account(a.locationId), industry, template: tpl ? { id: tpl.id, name: tpl.name } : null,
      completionPct: built.completionPct, daysIn, lastProgressAt: progress.get(a.locationId) ? new Date(progress.get(a.locationId) as number).toISOString() : null, items: built.items,
    };
  });
  return { rows, templates, settings, now };
}

export async function onboardingView(ctx: Ctx, deps: Deps) {
  const stuckDays = parseStuckDays(ctx.url.searchParams.get("stuck"));
  const { rows, templates } = await onboardingRows(ctx, deps);
  const clients = rows.map((r) => {
    const open = r.items.filter((i) => i.status === "todo");
    return { ...r, stuck: isStuck(r, stuckDays), openCount: open.length, overdueCount: open.filter((i) => i.due === "overdue").length };
  }).sort((a, b) => Number(b.stuck) - Number(a.stuck) || a.completionPct - b.completionPct);
  return json({
    stuckDays, defaultStuckDays: DEFAULT_STUCK_DAYS, templates,
    stuck: clients.filter((c) => c.stuck).map((c) => ({ locationId: c.locationId, name: c.name, daysIn: c.daysIn, completionPct: c.completionPct, next: c.items.filter((i) => i.status === "todo").slice(0, 3).map((i) => i.label) })),
    clients,
  });
}

async function itemOf(ctx: Ctx, deps: Deps, locationId: string, key: string): Promise<OnboardingItem | null> {
  const { rows } = await onboardingRows(ctx, deps, locationId);
  return rows[0]?.items.find((i) => i.key === key) ?? null;
}

export async function stepUpdate(ctx: Ctx, deps: Deps, locationId: string) {
  const raw = await body(ctx);
  const key = typeof raw?.key === "string" ? raw.key : "";
  if (!key || key.length > 100) return json({ error: "Which step?" }, 400);
  const checked = validateStepPatch(raw);
  if (!checked.ok) return json({ error: checked.error }, 400);
  const item = await itemOf(ctx, deps, locationId, key);
  if (!item) return json({ error: "Step not found" }, 404);
  if ("done" in checked.patch && !item.canTick) return json({ error: "This step is checked automatically. Fix it in the CRM and it ticks itself." }, 400);
  const ok = await changeStep(ctx.installationId, await deps.allowedIds(ctx), locationId, key, item.label, checked.patch, deps.actorOf(ctx), key.startsWith("step:"));
  return ok ? json({ ok: true }) : json({ error: "Client not found" }, 404);
}

export async function stepAdd(ctx: Ctx, deps: Deps, locationId: string) {
  const raw = await body(ctx);
  const made = await addCustomStep(ctx.installationId, await deps.allowedIds(ctx), locationId, typeof raw?.label === "string" ? raw.label : "", deps.actorOf(ctx));
  if (!made.ok) return json({ error: made.error }, made.status);
  const extra = { assignee: raw?.assignee, dueOn: raw?.dueOn };
  if ((extra.assignee !== undefined && extra.assignee !== "") || (extra.dueOn !== undefined && extra.dueOn !== "")) {
    const checked = validateStepPatch(extra);
    if (checked.ok) await changeStep(ctx.installationId, await deps.allowedIds(ctx), locationId, made.key, String(raw?.label ?? "").trim(), checked.patch, deps.actorOf(ctx), true);
  }
  return json({ ok: true, key: made.key });
}

export async function stepRemove(ctx: Ctx, deps: Deps, locationId: string) {
  const key = ctx.url.searchParams.get("key") ?? "";
  if (!key.startsWith("step:")) return json({ error: "Only steps you added to one client can be removed" }, 400);
  return (await removeCustomStep(ctx.installationId, await deps.allowedIds(ctx), locationId, key, deps.actorOf(ctx))) ? json({ ok: true }) : json({ error: "Step not found" }, 404);
}

export async function historyView(ctx: Ctx, deps: Deps, locationId: string) {
  const rows = await listHistory(ctx.installationId, await deps.allowedIds(ctx), locationId);
  return json({ history: rows.map((r) => ({ ...r, text: historyLine({ event: r.event, stepLabel: r.stepLabel, detail: r.detail, actor: r.actor }) })) });
}

export async function templateSave(ctx: Ctx) {
  const raw = await body(ctx);
  if (!raw) return json({ error: "Send a JSON body" }, 400);
  const r = await saveTemplate(ctx.installationId, { id: typeof raw.id === "string" ? raw.id : null, name: raw.name, industryKey: raw.industryKey, steps: raw.steps });
  return r.ok ? json({ ok: true, id: r.id }) : json({ error: r.error }, r.status);
}

export async function templateStarter(ctx: Ctx) {
  const raw = await body(ctx);
  const s = starterFromPlaybook(typeof raw?.playbook === "string" ? raw.playbook : "", newKey);
  if (!s) return json({ error: "Pick one of the industry playbooks" }, 400);
  const r = await saveTemplate(ctx.installationId, s);
  return r.ok ? json({ ok: true, id: r.id }) : json({ error: r.status === 409 ? "You already have a template with this name" : r.error }, r.status);
}

export async function templateRemove(ctx: Ctx) {
  const id = ctx.url.searchParams.get("id") ?? "";
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json({ error: "Template not found" }, 404);
  return (await deleteTemplate(ctx.installationId, id)) ? json({ ok: true }) : json({ error: "Template not found" }, 404);
}

// ---------------------------------------------------------------- notes

export async function notesView(ctx: Ctx, deps: Deps, locationId: string) {
  return json({ notes: await listNotes(ctx.installationId, await deps.allowedIds(ctx), locationId) });
}

export async function noteAdd(ctx: Ctx, deps: Deps, locationId: string) {
  const checked = validateNote(await body(ctx), new Date().toISOString().slice(0, 10));
  if (!checked.ok) return json({ error: checked.error }, 400);
  const r = await addNote(ctx.installationId, await deps.allowedIds(ctx), locationId, deps.actorOf(ctx), checked.note);
  return r === "ok" ? json({ ok: true }) : r === "full" ? json({ error: "This client's log is full (500 entries). Delete old ones first." }, 400) : json({ error: "Client not found" }, 404);
}

export async function noteRemove(ctx: Ctx, deps: Deps, locationId: string) {
  const id = ctx.url.searchParams.get("id") ?? "";
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json({ error: "Note not found" }, 404);
  return (await deleteNote(ctx.installationId, await deps.allowedIds(ctx), locationId, id)) ? json({ ok: true }) : json({ error: "Note not found" }, 404);
}

// ---------------------------------------------------------------- trends

const TREND_DAYS = 200;
const dayPoints = (rows: Awaited<ReturnType<typeof metricsTrend>>) => rows.map((d) => ({
  day: d.day,
  // Health and open pipeline are drawn only for days counted under today's rules for deals (a line that mixed two ways of counting would show a change that never happened).
  healthScore: d.dealsOk ? d.engagementScore : null, openValue: d.dealsOk ? d.openValue : null,
  contacts: d.contacts, newContacts30d: d.newContacts30d, completenessPct: d.completenessPct,
}));

/** The daily series of one client for the last `days` days (shared by the trends route and the review). */
export async function trendDays(installationId: string, locationId: string, days = TREND_DAYS) {
  return dayPoints(await metricsTrend(installationId, locationId, days));
}

/** The daily series of one client (and its appointment weeks), or of several for the Compare tab (`ids`, only the days). */
export async function trendsView(ctx: Ctx, deps: Deps, locationId?: string) {
  const allowed = await deps.allowedIds(ctx);
  const { accounts, settings } = await deps.accountsFor(ctx);
  const links = deepLinks(settings.appDomain);
  const nameOf = (id: string) => accounts.find((a) => a.locationId === id)?.name ?? "Unnamed account";
  if (!locationId) {
    const ids: string[] = [];
    for (const x of (ctx.url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim())) if (x && deps.locationId.test(x) && !ids.includes(x) && ids.length < MAX_COMPARE) ids.push(x);
    const clients = [];
    for (const id of ids) {
      if (!(await locationVisible(ctx.installationId, allowed, id))) continue;
      clients.push({ locationId: id, name: nameOf(id), days: dayPoints(await metricsTrend(ctx.installationId, id, TREND_DAYS)) });
    }
    return json({ clients });
  }
  if (!(await locationVisible(ctx.installationId, allowed, locationId))) return json({ error: "Account not found" }, 404);
  const now = Date.now();
  const [days, weeks, start] = await Promise.all([metricsTrend(ctx.installationId, locationId, TREND_DAYS), weeklyAppointments(ctx.installationId, locationId, now), historyStart(ctx.installationId, locationId)]);
  return json({
    locationId, name: nameOf(locationId), days: dayPoints(days), historyStartsOn: start,
    weeks: weeks.map((w) => ({ ...w, members: w.members.map((m) => ({ ...m, url: m.contactId ? links.contact(locationId, m.contactId) : links.account(locationId) })) })),
  });
}
