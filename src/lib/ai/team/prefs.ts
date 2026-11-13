import { sql } from "../../db";
import { isTone, type Tone } from "./facts";
import { OPT_IN_JOBS, TEAM_JOB_IDS, type TeamJobId } from "./jobs";

// The agency's choices for the team and client jobs. One row per company (location_id '') and optionally one per client account that overrides it. A job is on for an account when its row says
// so, else the company row says so, else its default: coaching notes and meeting summaries are opt-in (default off), the others default on. This sits on top of the connection's own job
// switch and the feature flags: all of them must allow a job before the model is called.

export type TeamPrefsRow = { jobs: Partial<Record<TeamJobId, boolean>>; leadNames: boolean | null; tone: Tone | null };
export type Effective = { jobs: Record<TeamJobId, boolean>; leadNames: boolean; tone: Tone };

const EMPTY: TeamPrefsRow = { jobs: {}, leadNames: null, tone: null };

export function cleanJobs(v: unknown): Partial<Record<TeamJobId, boolean>> {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Partial<Record<TeamJobId, boolean>> = {};
  for (const j of TEAM_JOB_IDS) if (typeof o[j] === "boolean") out[j] = o[j] as boolean;
  return out;
}

/** The effective choices for one account from the company row and the account's own row. Pure. */
export function effective(company: TeamPrefsRow | null, account: TeamPrefsRow | null): Effective {
  const c = company ?? EMPTY, a = account ?? EMPTY;
  const jobs = Object.fromEntries(TEAM_JOB_IDS.map((j) => [j, a.jobs[j] ?? c.jobs[j] ?? !OPT_IN_JOBS.includes(j)])) as Record<TeamJobId, boolean>;
  return { jobs, leadNames: a.leadNames ?? c.leadNames ?? false, tone: a.tone ?? c.tone ?? "plain" };
}

const rowOf = (r: Record<string, unknown>): TeamPrefsRow => ({ jobs: cleanJobs(r.jobs), leadNames: typeof r.lead_names === "boolean" ? r.lead_names : null, tone: isTone(r.tone) ? r.tone : null });

/** The company default row and one account's row, for this company only. */
export async function loadEffective(inst: string, loc: string): Promise<Effective> {
  const rows = await sql()`select location_id, jobs, lead_names, tone from ai_team_prefs where installation_id = ${inst} and location_id in ('', ${loc})`.catch(() => []);
  const by = new Map(rows.map((r) => [r.location_id as string, rowOf(r)]));
  return effective(by.get("") ?? null, loc ? by.get(loc) ?? null : null);
}

export type PrefsPatch = { jobs?: Partial<Record<TeamJobId, boolean | null>>; leadNames?: boolean | null; tone?: Tone | null };

/** Saves a change for the company default ('') or one account. A job set to null goes back to inheriting. Audited. */
export async function savePrefs(inst: string, loc: string, patch: PrefsPatch, by: string | null): Promise<void> {
  const [cur] = await sql()`select jobs, lead_names, tone from ai_team_prefs where installation_id = ${inst} and location_id = ${loc}`;
  const old = cur ? rowOf(cur) : EMPTY;
  const jobs = { ...old.jobs };
  for (const j of TEAM_JOB_IDS) { const v = patch.jobs?.[j]; if (v === null) delete jobs[j]; else if (typeof v === "boolean") jobs[j] = v; }
  const leadNames = patch.leadNames === undefined ? old.leadNames : patch.leadNames;
  const tone = patch.tone === undefined ? old.tone : patch.tone;
  await sql().begin(async (tx) => {
    await tx`insert into ai_team_prefs (installation_id, location_id, jobs, lead_names, tone, updated_by, updated_at)
      values (${inst}, ${loc}, ${tx.json(jobs as never)}, ${leadNames}, ${tone}, ${by}, now())
      on conflict (installation_id, location_id) do update set jobs = excluded.jobs, lead_names = excluded.lead_names, tone = excluded.tone, updated_by = excluded.updated_by, updated_at = now()`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${by ?? "system"}, 'ai.team_prefs', ${tx.json({ scope: loc || "company", jobs: patch.jobs ?? null, leadNames: patch.leadNames ?? null, tone: patch.tone ?? null } as never)})`;
  });
}

export type PrefsListRow = { locationId: string; name: string; jobs: Partial<Record<TeamJobId, boolean>>; effectiveJobs: Record<TeamJobId, boolean>; leadNames: boolean | null };
/** One page of client accounts with their own choices (agency level). `allowed` limits the accounts; a search narrows inside them. */
export async function listPrefs(inst: string, allowed: string[] | null, q: string, page: number, size: number): Promise<{ rows: PrefsListRow[]; total: number; company: TeamPrefsRow }> {
  const db = sql();
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).toLowerCase()}%` : null;
  const where = db`l.installation_id = ${inst} and not l.ignored ${allowed ? db`and l.location_id = any(${allowed}::text[])` : db``} ${like ? db`and lower(coalesce(l.name, '')) like ${like}` : db``}`;
  const [rows, tot, comp] = await Promise.all([
    db`select l.location_id, coalesce(l.name, 'Unnamed account') name, p.jobs, p.lead_names, p.tone from locations l left join ai_team_prefs p on p.installation_id = l.installation_id and p.location_id = l.location_id
       where ${where} order by lower(coalesce(l.name, '')), l.location_id limit ${size} offset ${page * size}`,
    db`select count(*)::int n from locations l where ${where}`,
    db`select jobs, lead_names, tone from ai_team_prefs where installation_id = ${inst} and location_id = ''`,
  ]);
  const company = comp[0] ? rowOf(comp[0]) : EMPTY;
  return {
    total: Number(tot[0]?.n ?? 0), company,
    rows: rows.map((r) => { const own = rowOf(r); return { locationId: r.location_id as string, name: r.name as string, jobs: own.jobs, effectiveJobs: effective(company, own).jobs, leadNames: own.leadNames }; }),
  };
}
