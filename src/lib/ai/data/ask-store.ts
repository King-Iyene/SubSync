import { decryptSecret, encryptSecret } from "../../crypto";
import { sql } from "../../db";
import type { AskAnswer } from "./ask";

// Each person's own Ask-your-data history. EVERY statement names the company AND the person (user_key), so another person, another account's staff or another company can never read or delete it.
// Question and answer are stored encrypted; the person can delete a question (typed confirmation, enforced by the route) or all of them.

export type Turn = { id: string; at: string; question: string; answer: AskAnswer; window: { from: string | null; to: string | null } };
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);

export async function saveTurn(inst: string, user: string, scope: string, question: string, answer: AskAnswer, runId: string | null, w: { from: string; to: string }): Promise<string> {
  const [r] = await sql()`insert into ai_ask_turns (installation_id, location_id, user_key, question_enc, answer_enc, run_id, window_from, window_to)
    values (${inst}, ${scope}, ${user}, ${encryptSecret(question)}, ${encryptSecret(JSON.stringify(answer))}, ${runId && /^[0-9a-f-]{36}$/i.test(runId) ? runId : null}, ${w.from}, ${w.to}) returning id`;
  return r.id as string;
}

export async function listTurns(inst: string, user: string, limit = 30): Promise<Turn[]> {
  const rows = await sql()`select id, created_at, question_enc, answer_enc, window_from, window_to from ai_ask_turns where installation_id = ${inst} and user_key = ${user} order by created_at desc limit ${Math.min(100, limit)}`;
  const out: Turn[] = [];
  for (const r of rows) {
    try { out.push({ id: r.id as string, at: (r.created_at as Date).toISOString(), question: decryptSecret(r.question_enc as string), answer: JSON.parse(decryptSecret(r.answer_enc as string)) as AskAnswer, window: { from: day(r.window_from), to: day(r.window_to) } }); } catch { /* unreadable: skipped */ }
  }
  return out;
}

export async function deleteTurn(inst: string, user: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return (await sql()`delete from ai_ask_turns where installation_id = ${inst} and user_key = ${user} and id = ${id}::uuid returning 1`).length > 0;
}

export async function deleteAllTurns(inst: string, user: string): Promise<number> {
  return (await sql()`delete from ai_ask_turns where installation_id = ${inst} and user_key = ${user} returning 1`).length;
}
