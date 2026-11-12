import { sql } from "../db";
import type { StoredAnswer } from "./read-answers";

export async function readAnswer(installationId: string, key: string): Promise<StoredAnswer | null> {
  const r = await sql()`select body, dirty, extract(epoch from now() - computed_at) * 1000 age_ms from read_answers where installation_id = ${installationId} and answer_key = ${key}`;
  return r.length ? { body: r[0].body as string, dirty: r[0].dirty as boolean, ageMs: Number(r[0].age_ms) } : null;
}

export async function storeAnswer(installationId: string, key: string, body: string): Promise<void> {
  // Bodies are bounded: a very large answer is not worth a round trip to store.
  if (body.length > 1_500_000) return;
  await sql()`
    insert into read_answers (installation_id, answer_key, body, computed_at, dirty) values (${installationId}, ${key}, ${body}, now(), false)
    on conflict (installation_id, answer_key) do update set body = excluded.body, computed_at = excluded.computed_at, dirty = false`;
}
