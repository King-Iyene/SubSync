import { createHash } from "node:crypto";
import { sql } from "../db";
import { SUMMARY_MAX } from "../ai/team/facts";
import { cleanText, MONTH_SHAPE, TOKEN_SHAPE, textProblem } from "./proof-core";

// The AI-written summary block of a monthly client report (job `report_summary`). Kept apart from proof-queries.ts so the report screens that already work never depend on the new columns:
// every read here answers "nothing yet" if the columns are not there. `summary_draft` is what the AI wrote and is NEVER shown to a client; `summary` is the text the agency read, edited and
// chose to use. Only a draft report can change, like the intro, and every client-facing word passes the same vendor-word and promise check as the rest of the report.

const per = (month: string) => `${month}-01`;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);

export type SummaryState = { draft: string | null; draftAt: string | null; summary: string | null; summaryAt: string | null };
const EMPTY: SummaryState = { draft: null, draftAt: null, summary: null, summaryAt: null };

export async function getSummary(inst: string, loc: string, month: string): Promise<SummaryState> {
  try {
    const [r] = await sql()`select summary, summary_at, summary_draft, summary_draft_at from pr_reports where installation_id = ${inst} and location_id = ${loc} and period = ${per(month)}::date`;
    return r ? { draft: (r.summary_draft as string | null) ?? null, draftAt: iso(r.summary_draft_at), summary: (r.summary as string | null) ?? null, summaryAt: iso(r.summary_at) } : EMPTY;
  } catch { return EMPTY; }
}

/** Keeps what the AI wrote as a draft for the agency to review. A shared report is not touched. */
export async function saveDraft(inst: string, loc: string, month: string, text: string): Promise<boolean> {
  const t = cleanText(text, SUMMARY_MAX);
  if (!t) return false;
  const r = await sql()`update pr_reports set summary_draft = ${t}, summary_draft_at = now() where installation_id = ${inst} and location_id = ${loc} and period = ${per(month)}::date and status = 'draft' returning 1`;
  return r.length > 0;
}

/** The agency's reviewed text. Empty clears it. Refused for a shared report and for words that must never reach a client. */
export async function saveSummary(inst: string, loc: string, month: string, text: unknown, by: string | null): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!MONTH_SHAPE.test(month)) return { ok: false, error: "Choose a month", status: 400 };
  const t = cleanText(text, SUMMARY_MAX);
  const bad = t ? textProblem(t) : null;
  if (bad) return { ok: false, error: bad, status: 400 };
  const [row] = await sql()`select status from pr_reports where installation_id = ${inst} and location_id = ${loc} and period = ${per(month)}::date`;
  if (!row) return { ok: false, error: "Prepare this report first", status: 404 };
  if (row.status === "shared") return { ok: false, error: "This report is shared. Take it back to a draft before editing", status: 409 };
  await sql().begin(async (tx) => {
    await tx`update pr_reports set summary = ${t}, summary_at = ${t ? new Date() : null}, summary_draft = null, summary_draft_at = null where installation_id = ${inst} and location_id = ${loc} and period = ${per(month)}::date and status = 'draft'`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${inst}, ${by ?? "unknown"}, 'proof.summary_saved', ${tx.json({ month, used: Boolean(t) } as never)})`;
  });
  return { ok: true };
}

/** Prepared draft reports of this month that have no summary and no draft yet, for "Draft all reports". Only the accounts given. */
export async function needingDraft(inst: string, allowed: string[] | null, month: string, limit: number): Promise<{ ids: string[]; remaining: number }> {
  try {
    const db = sql();
    const where = db`r.installation_id = ${inst} and r.period = ${per(month)}::date and r.status = 'draft' and r.summary is null and r.summary_draft is null ${allowed ? db`and r.location_id = any(${allowed}::text[])` : db``}`;
    const [rows, tot] = await Promise.all([db`select r.location_id from pr_reports r where ${where} order by r.location_id limit ${limit}`, db`select count(*)::int n from pr_reports r where ${where}`]);
    return { ids: rows.map((r) => r.location_id as string), remaining: Number(tot[0]?.n ?? 0) };
  } catch { return { ids: [], remaining: 0 }; }
}

/** For the public page: the reviewed summary of the shared report the link shows. The link token picks the one account; nothing else is read. */
export async function publicSummary(token: string, month: string | null): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const [k] = await sql()`select installation_id, location_id from pr_links where token_hash = ${hash} and revoked_at is null`;
    if (!k) return null;
    const rows = await sql()`select period::text p, summary from pr_reports where installation_id = ${k.installation_id as string} and location_id = ${k.location_id as string} and status = 'shared' order by period desc limit 12`;
    const chosen = rows.find((r) => month && String(r.p).slice(0, 7) === month) ?? rows[0];
    return (chosen?.summary as string | null) ?? null;
  } catch { return null; }
}
