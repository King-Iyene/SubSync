import { sql } from "../db";
import { fetchForms, fetchFunnels, fetchSubmissions, isPermissionError, type IntakeItem, type SubmissionRow } from "./ghl-data";

// Lead intake reads (stage DQ): the forms, surveys and funnels of each client account and their submissions, read only, at most once every 30 minutes per account and within a time budget.
// The platform sends no event when a form is submitted, so this polls. Without the optional permission (a 401 or 403) the account is marked "needs permission" and is not asked again for a
// day. Submissions store ids and a time only (never an answer, a name or an email). Idempotent: the same submission twice is one row.

const EVERY_MIN = 30;
const RETRY_DENIED_MIN = 24 * 60;
const first = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

type Area = "forms" | "surveys" | "funnels";

async function due(inst: string, loc: string, area: Area): Promise<boolean> {
  const [r] = await sql()`select status, last_at from dq_poll where installation_id = ${inst} and location_id = ${loc} and area = ${area}`;
  if (!r) return true;
  const age = (Date.now() - new Date(r.last_at as string).getTime()) / 60_000;
  return age >= (r.status === "needs_permission" ? RETRY_DENIED_MIN : EVERY_MIN);
}
async function mark(inst: string, loc: string, area: Area, status: "ok" | "needs_permission" | "error"): Promise<void> {
  await sql()`insert into dq_poll (installation_id, location_id, area, status) values (${inst}, ${loc}, ${area}, ${status}) on conflict (installation_id, location_id, area) do update set status = excluded.status, last_at = now()`;
}
async function saveItems(inst: string, loc: string, kind: "form" | "survey" | "funnel", list: IntakeItem[]): Promise<void> {
  const db = sql();
  const rows = list.map((x) => ({ installation_id: inst, location_id: loc, kind, ext_id: x.id, name: x.name, steps: x.steps }));
  for (let i = 0; i < rows.length; i += 300) await db`insert into dq_forms ${db(rows.slice(i, i + 300), "installation_id", "location_id", "kind", "ext_id", "name", "steps")}
    on conflict (installation_id, location_id, kind, ext_id) do update set name = excluded.name, steps = excluded.steps, seen_at = now()`;
}
async function saveSubmissions(inst: string, loc: string, kind: "form" | "survey", list: SubmissionRow[]): Promise<void> {
  const db = sql();
  const rows = list.map((x) => ({ installation_id: inst, location_id: loc, kind, ext_id: x.formId, submission_id: x.id, contact_id: x.contactId, submitted_at: x.at }));
  for (let i = 0; i < rows.length; i += 300) await db`insert into dq_submissions ${db(rows.slice(i, i + 300), "installation_id", "location_id", "kind", "ext_id", "submission_id", "contact_id", "submitted_at")} on conflict do nothing`;
}

/** One account, all three areas. A permission error on one area marks only that area. */
export async function pollAccount(inst: string, loc: string, token: string): Promise<void> {
  for (const area of ["forms", "surveys", "funnels"] as const) {
    if (!(await due(inst, loc, area))) continue;
    try {
      if (area === "funnels") await saveItems(inst, loc, "funnel", await fetchFunnels(token, loc));
      else {
        const kind = area === "forms" ? "form" : "survey";
        await saveItems(inst, loc, kind, await fetchForms(token, loc, area));
        const [last] = await sql()`select max(submitted_at) at from dq_submissions where installation_id = ${inst} and location_id = ${loc} and kind = ${kind}`;
        const since = last?.at ? new Date(new Date(last.at as string).getTime() - 2 * 86_400_000).toISOString().slice(0, 10) : first(90);
        await saveSubmissions(inst, loc, kind, await fetchSubmissions(token, loc, area, since));
      }
      await mark(inst, loc, area, "ok");
    } catch (e) {
      if (isPermissionError(e)) await mark(inst, loc, area, "needs_permission").catch(() => undefined);
      else if ((e as { code?: string })?.code !== "42P01") await mark(inst, loc, area, "error").catch(() => undefined);
      else return; // the tables are not there yet (before the migration)
    }
  }
}

/** Every account of an installation that is due, until the budget is spent. Never throws. */
export async function pollIntake(inst: string, tokenFor: (loc: string) => Promise<string>, budgetMs = 15_000): Promise<{ polled: number }> {
  let polled = 0;
  try {
    const rows = await sql()`select l.location_id from locations l where l.installation_id = ${inst} and not l.ignored order by l.name`;
    const deadline = Date.now() + budgetMs;
    for (const r of rows) {
      if (Date.now() >= deadline) break;
      const loc = r.location_id as string;
      if (!(await due(inst, loc, "forms")) && !(await due(inst, loc, "surveys")) && !(await due(inst, loc, "funnels"))) continue;
      try { await pollAccount(inst, loc, await tokenFor(loc)); polled++; } catch { /* the next run tries again */ }
    }
  } catch { /* never stops the refresh */ }
  return { polled };
}
