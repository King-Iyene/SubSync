import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";

const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-unanswered-outcome-a";
const CO_B = "xtest-unanswered-outcome-b";
const LOC_A = "xtestOutcomeLocA";
const LOC_B = "xtestOutcomeLocB";
let instA = "";
let instB = "";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!HAS_DB)("Unanswered follow-up outcomes", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const token = encryptSecret("not-a-real-token");
    const create = async (company: string) => (await sql()`
      insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at)
      values (${company}, ${company}, 'pro', ${token}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await create(CO_A);
    instB = await create(CO_B);
    await sql()`insert into locations (installation_id, location_id, name) values
      (${instA}, ${LOC_A}, 'Outcome A'), (${instB}, ${LOC_B}, 'Outcome B')`;
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, last_message_direction, last_message_at)
      values (${instA}, ${LOC_A}, 'conversation-a', 'inbound', now()), (${instB}, ${LOC_B}, 'conversation-b', 'inbound', now())`;
    await sql()`insert into unanswered_outcomes (installation_id, location_id, conversation_id, outcome, recorded_by)
      values (${instA}, ${LOC_A}, 'conversation-a', 'replied', 'setter-a'),
        (${instB}, ${LOC_B}, 'conversation-b', 'needs_follow_up', 'setter-b')`;
  });

  afterAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  it("stores an outcome within its installation and account only", async () => {
    const own = await sql()`select location_id, conversation_id, outcome from unanswered_outcomes where installation_id = ${instA}`;
    expect(own).toEqual([{ location_id: LOC_A, conversation_id: "conversation-a", outcome: "replied" }]);
    const other = await sql()`select location_id, conversation_id, outcome from unanswered_outcomes where installation_id = ${instB}`;
    expect(other).toEqual([{ location_id: LOC_B, conversation_id: "conversation-b", outcome: "needs_follow_up" }]);
  });
});
