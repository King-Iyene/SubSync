import { sql } from "../db";
import { buildGrowth, cleanDomain, signalsOf, classify, type GrowthAccount, type GrowthContact, type GrowthRules } from "../analytics/growth";
import { isMissingTable } from "../analytics/today-store";
import type { AlertDraft } from "../analytics/derive";
import { json, type AuthContext } from "./auth";

// The Growth tab of Today: new email leads, read from the contacts SubSync already holds (src/lib/analytics/growth.ts has every counting rule). Read only, plus two small
// settings that live in SubSync's own tables (a monthly goal per client account, and which addresses are left out). Which accounts a person may read is decided by the
// router from the signed session (`permits`), never from a parameter; an account the caller cannot read is not in any query here. Neither table is sent to the CRM.

type Ctx = AuthContext & { request: Request };
export type GrowthDeps = {
  permits: (ctx: Ctx) => Promise<(locationId: string) => boolean>;
  contactUrl: (ctx: Ctx) => Promise<(locationId: string, contactId: string) => string>;
  accountUrl: (ctx: Ctx) => Promise<(locationId: string) => string>;
};
const ROW_CAP = 150_000;
const DEFAULT_RULES: GrowthRules = { excludeRoleAddresses: true, internalDomains: [] };

export async function loadRules(installationId: string): Promise<{ rules: GrowthRules; ready: boolean }> {
  try {
    const [row] = await sql()`select exclude_role_addresses, internal_domains from growth_settings where installation_id = ${installationId}`;
    return { ready: true, rules: row ? { excludeRoleAddresses: row.exclude_role_addresses as boolean, internalDomains: (row.internal_domains as string[]) ?? [] } : DEFAULT_RULES };
  } catch (e) { if (isMissingTable(e)) return { rules: DEFAULT_RULES, ready: false }; throw e; }
}
export async function loadGoals(installationId: string): Promise<{ goals: Record<string, number>; ready: boolean }> {
  try {
    const rows = await sql()`select location_id, monthly_goal from growth_goals where installation_id = ${installationId}`;
    return { ready: true, goals: Object.fromEntries(rows.map((r) => [r.location_id as string, r.monthly_goal as number])) };
  } catch (e) { if (isMissingTable(e)) return { goals: {}, ready: false }; throw e; }
}

/** Contacts with an email, newest first, for the accounts given. Capped; `partial` says the cap cut the list. */
export async function loadContacts(installationId: string, ids: string[], contactUrl: (l: string, c: string) => string): Promise<{ contacts: GrowthContact[]; partial: boolean }> {
  if (ids.length === 0) return { contacts: [], partial: false };
  const rows = await sql()`
    select contact_id, location_id, first_name, last_name, full_name, email, phone, source, date_added, dnd, tags
    from cached_contacts
    where installation_id = ${installationId} and location_id = any(${ids}::text[]) and email is not null and btrim(email) <> '' and date_added is not null
    order by date_added desc limit ${ROW_CAP + 1}`;
  const partial = rows.length > ROW_CAP;
  const contacts = rows.slice(0, ROW_CAP).map((r): GrowthContact => ({
    id: `${r.location_id}:${r.contact_id}`, locationId: r.location_id as string, name: ((r.full_name as string | null) || (r.email as string)).trim(), email: r.email as string,
    source: (r.source as string | null) ?? null, at: (r.date_added as Date).getTime(), firstName: r.first_name as string | null, lastName: r.last_name as string | null, phone: r.phone as string | null, dnd: r.dnd === true || ((r.tags as string[] | null) ?? []).some((t) => /unsubscrib/i.test(t)),
    url: contactUrl(r.location_id as string, r.contact_id as string),
  }));
  return { contacts, partial };
}

export async function accountsOf(installationId: string, permits: (l: string) => boolean, url: (l: string) => string): Promise<GrowthAccount[]> {
  const rows = await sql()`select location_id, name, timezone from locations where installation_id = ${installationId} and not ignored order by name`;
  return rows.filter((r) => permits(r.location_id as string)).map((r) => ({ id: r.location_id as string, name: (r.name as string | null) ?? "Client", zone: (r.timezone as string | null) || "UTC", url: url(r.location_id as string) }));
}

export async function growthRead(ctx: Ctx, deps: GrowthDeps): Promise<Response> {
  const permits = await deps.permits(ctx);
  const accounts = await accountsOf(ctx.installationId, permits, await deps.accountUrl(ctx));
  const [{ rules, ready: settingsReady }, { goals, ready: goalsReady }, { contacts, partial }] = await Promise.all([
    loadRules(ctx.installationId), loadGoals(ctx.installationId), deps.contactUrl(ctx).then((u) => loadContacts(ctx.installationId, accounts.map((a) => a.id), u)),
  ]);
  const mine = Object.fromEntries(Object.entries(goals).filter(([l]) => permits(l)));
  const data = buildGrowth({ now: Date.now(), accounts, contacts, rules, goals: mine, scope: ctx.kind === "agency" && accounts.length > 1 ? "agency" : "account", partial, setup: { goalsReady, settingsReady } });
  // A client's staff never see which internal addresses the company leaves out.
  return json(ctx.kind === "client" ? { ...data, rules: { ...data.rules, internalDomains: [] } } : data);
}

const NEEDS_UPDATE = "Needs the latest database update. Ask the person who manages SubSync to apply it, then try again.";

/** Set or clear one client's monthly goal. Not for a client's staff. The account must be one the caller may read. */
export async function growthGoalSave(ctx: Ctx, deps: GrowthDeps): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in your view", forbidden: true }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { locationId?: unknown; goal?: unknown } | null;
  const loc = typeof body?.locationId === "string" ? body.locationId : "";
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(loc) || !(await deps.permits(ctx))(loc)) return json({ error: "That client is not in your list." }, 404);
  // The account must belong to THIS company: the session's own list of accounts, not just a well formed id.
  const [own] = await sql()`select 1 as ok from locations where installation_id = ${ctx.installationId} and location_id = ${loc} and not ignored`;
  if (!own) return json({ error: "That client is not in your list." }, 404);
  const goal = body?.goal === null ? null : typeof body?.goal === "number" && Number.isInteger(body.goal) ? body.goal : NaN;
  if (goal !== null && !(goal >= 1 && goal <= 1_000_000)) return json({ error: "Type a whole number from 1 to 1,000,000, or leave it empty to remove the goal." }, 400);
  try {
    if (goal === null) await sql()`delete from growth_goals where installation_id = ${ctx.installationId} and location_id = ${loc}`;
    else await sql()`
      insert into growth_goals (installation_id, location_id, monthly_goal, set_by) values (${ctx.installationId}, ${loc}, ${goal}, ${ctx.session.userName ?? ctx.session.userId ?? null})
      on conflict (installation_id, location_id) do update set monthly_goal = excluded.monthly_goal, set_by = excluded.set_by, updated_at = now()`;
  } catch (e) { if (isMissingTable(e)) return json({ error: NEEDS_UPDATE, needsUpdate: true }, 409); throw e; }
  return json({ ok: true, locationId: loc, goal });
}

/** The two settings: leave out shared mailboxes, and the email domains that are the company's own staff. Not for a client's staff. */
export async function growthSettingsSave(ctx: Ctx): Promise<Response> {
  if (ctx.kind === "client") return json({ error: "Not available in your view", forbidden: true }, 403);
  const body = (await ctx.request.json().catch(() => null)) as { excludeRoleAddresses?: unknown; internalDomains?: unknown } | null;
  if (typeof body?.excludeRoleAddresses !== "boolean" || !Array.isArray(body.internalDomains)) return json({ error: "Those settings are not valid." }, 400);
  const domains = [...new Set(body.internalDomains.map((d) => (typeof d === "string" ? cleanDomain(d) : null)).filter((d): d is string => !!d))].slice(0, 20);
  try {
    await sql()`
      insert into growth_settings (installation_id, exclude_role_addresses, internal_domains) values (${ctx.installationId}, ${body.excludeRoleAddresses}, ${domains})
      on conflict (installation_id) do update set exclude_role_addresses = excluded.exclude_role_addresses, internal_domains = excluded.internal_domains, updated_at = now()`;
  } catch (e) { if (isMissingTable(e)) return json({ error: NEEDS_UPDATE, needsUpdate: true }, 409); throw e; }
  return json({ ok: true, excludeRoleAddresses: body.excludeRoleAddresses, internalDomains: domains });
}

/** Alerts for a sudden drop or spike in a client's new email leads, from the same rules as the Growth tab. Used by the refresh that raises every other alert. */
export async function growthAlertDrafts(installationId: string): Promise<AlertDraft[]> {
  const rows = await sql()`select location_id, name, timezone from locations where installation_id = ${installationId} and not ignored`;
  const ids = rows.map((r) => r.location_id as string);
  const [{ rules }, { contacts }] = await Promise.all([loadRules(installationId), loadContacts(installationId, ids, () => "")]);
  const verdicts = classify(contacts, rules);
  const now = Date.now();
  const out: AlertDraft[] = [];
  const byLoc = new Map<string, number[]>();
  for (const c of contacts) if (verdicts.get(c.id) === "counted") { const l = byLoc.get(c.locationId); if (l) l.push(c.at as number); else byLoc.set(c.locationId, [c.at as number]); }
  for (const r of rows) {
    const loc = r.location_id as string;
    const ats = byLoc.get(loc) ?? [];
    for (const s of signalsOf(loc, (r.name as string | null) ?? "A client", ats, (r.timezone as string | null) || "UTC", now)) {
      out.push({ dedupeKey: `growth:${loc}:${s.scope}:${s.direction}`, kind: "growth", severity: s.direction === "drop" ? "warning" : "info", locationId: loc, title: s.text, detail: { scope: s.scope, direction: s.direction, count: s.count, normal: s.normal, pct: s.pct } });
    }
  }
  return out;
}
