import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import {
  assignedBatch, contactFacts, createSnooze, hiddenPage, hiddenSummary, logActions, markNotALead, notHidden, releaseSnoozes, waitingConversationsOf,
} from "@/lib/analytics/unanswered-actions-queries";
import { DEFAULT_HIDE } from "@/lib/analytics/unanswered-actions";

// Written to run only where the round 3 slice B migration (20261120090000_unanswered_actions.sql) is already applied; it skips otherwise. Tiny fixtures, ids prefixed xtest-, always cleaned up.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-ua-actions-a";
const CO_B = "xtest-ua-actions-b";
const LOC_A = "xtestActLocA";
const LOC_B = "xtestActLocB";
let instA = "", instB = "";
let ready = false;
const NOW = Date.now();
const H = 3_600_000;

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!HAS_DB)("Unanswered actions (database)", () => {
  beforeAll(async () => {
    const [t] = await sql()`select to_regclass('public.unanswered_snoozes') s, to_regclass('public.unanswered_actions') a`;
    ready = Boolean(t?.s && t?.a);
    if (!ready) return;
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const token = encryptSecret("not-a-real-token");
    const create = async (company: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${company}, ${company}, 'pro', ${token}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await create(CO_A); instB = await create(CO_B);
    await sql()`insert into locations (installation_id, location_id, name, email, phone) values (${instA}, ${LOC_A}, 'Act A', 'front@a.test', '+15550009999'), (${instB}, ${LOC_B}, 'Act B', null, null)`;
    const ago = (h: number) => new Date(NOW - h * H);
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, email, phone, tags, assigned_to, dnd) values
      (${instA}, ${LOC_A}, 'xc-plain', 'Plain', 'plain@x.test', '+15550001111', '{}', null, false),
      (${instA}, ${LOC_A}, 'xc-spam', 'Spam', 'spam@x.test', '+15550002222', '{Spam}', null, false),
      (${instA}, ${LOC_A}, 'xc-own', 'Own', 'front@a.test', '+15550003333', '{}', null, false),
      (${instA}, ${LOC_A}, 'xc-dnd', 'Dnd', 'dnd@x.test', '+15550004444', '{}', null, true),
      (${instB}, ${LOC_B}, 'xc-b', 'Other', 'b@x.test', '+15550005555', '{}', null, false)`;
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, last_message_direction, last_message_at, last_message_type) values
      (${instA}, ${LOC_A}, 'xv-plain', 'xc-plain', 'inbound', ${ago(5)}, 'TYPE_SMS'), (${instA}, ${LOC_A}, 'xv-spam', 'xc-spam', 'inbound', ${ago(6)}, 'TYPE_SMS'),
      (${instA}, ${LOC_A}, 'xv-own', 'xc-own', 'inbound', ${ago(7)}, 'TYPE_SMS'), (${instA}, ${LOC_A}, 'xv-dnd', 'xc-dnd', 'inbound', ${ago(8)}, 'TYPE_SMS'),
      (${instB}, ${LOC_B}, 'xv-b', 'xc-b', 'inbound', ${ago(9)}, 'TYPE_SMS')`;
  });
  afterAll(async () => {
    if (ready) await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  const base = () => ({ installationId: instA, allowed: [LOC_A], now: NOW, slaHours: 1 });

  it("counts and pages the hidden people by reason, only in the allowed account", async () => {
    if (!ready) return;
    const s = await hiddenSummary(base(), DEFAULT_HIDE);
    expect(s.internal).toBe(2); // the spam tag and the business's own address
    expect(s.total).toBe(2);
    const other = await hiddenSummary({ ...base(), allowed: [LOC_B] }, DEFAULT_HIDE);
    expect(other.total, "another installation's account is never counted for this one").toBe(0);
    const page = await hiddenPage({ ...base(), reason: "internal", page: 0, size: 25 }, DEFAULT_HIDE);
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.conversationId).sort()).toEqual(["xv-own", "xv-spam"]);
    const none = await hiddenSummary({ ...base(), allowed: [] }, DEFAULT_HIDE);
    expect(none.total).toBe(0);
  });

  it("a snooze hides until released, one active snooze per conversation, scoped to the installation", async () => {
    if (!ready) return;
    await createSnooze({ installationId: instA, locationId: LOC_A, conversationId: "xv-plain", contactId: "xc-plain", reason: "call_back_later", until: NOW + 4 * H, by: "u1" });
    await createSnooze({ installationId: instA, locationId: LOC_A, conversationId: "xv-plain", contactId: "xc-plain", reason: "other", until: NOW + 8 * H, by: "u1" });
    const [{ n }] = await sql()`select count(*)::int n from unanswered_snoozes where installation_id = ${instA} and conversation_id = 'xv-plain' and released_at is null`;
    expect(n).toBe(1);
    expect((await hiddenSummary(base(), DEFAULT_HIDE)).snoozed).toBe(1);
    const db = sql();
    const visible = await db`select c.conversation_id from cached_conversations c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id where c.installation_id = ${instA} ${notHidden(db, DEFAULT_HIDE)} order by 1`;
    expect(visible.map((r) => r.conversation_id)).toEqual(["xv-dnd"]);
    expect(await releaseSnoozes({ installationId: instB, locationId: LOC_A, conversationIds: ["xv-plain"], by: "u2" }), "another installation cannot release it").toBe(0);
    expect(await releaseSnoozes({ installationId: instA, locationId: LOC_A, conversationIds: ["xv-plain"], by: "u1" })).toBe(1);
    expect((await hiddenSummary(base(), DEFAULT_HIDE)).snoozed).toBe(0);
  });

  it("not a lead hides the person; a later follow-up brings them back", async () => {
    if (!ready) return;
    await markNotALead(instA, [{ locationId: LOC_A, conversationId: "xv-plain", contactId: "xc-plain" }], "u1");
    expect((await hiddenSummary(base(), DEFAULT_HIDE)).not_a_lead).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    await sql()`insert into unanswered_outcomes (installation_id, location_id, conversation_id, contact_id, outcome, recorded_by) values (${instA}, ${LOC_A}, 'xv-plain', 'xc-plain', 'needs_follow_up', 'u1')`;
    expect((await hiddenSummary(base(), DEFAULT_HIDE)).not_a_lead).toBe(0);
  });

  it("only conversations of the named account are returned, with protection facts and the batch log", async () => {
    if (!ready) return;
    expect((await waitingConversationsOf(instA, LOC_A, ["xv-b"])).length, "a conversation of another account is never found").toBe(0);
    expect((await waitingConversationsOf(instA, LOC_A, ["xv-plain", "xv-dnd"])).length).toBe(2);
    const f = await contactFacts(instA, LOC_A, ["xc-dnd", "xc-plain", "xc-b"]);
    expect(f.get("xc-dnd")?.dnd).toBe(true);
    expect(f.has("xc-b"), "a contact of another account is never found").toBe(false);
    const batchId = "00000000-0000-4000-8000-0000000000aa";
    await logActions(instA, [{ locationId: LOC_A, batchId, action: "assign", conversationId: "xv-plain", contactId: "xc-plain", beforeOwner: "u-old", afterOwner: "u-new", result: "done", actor: "u1" }, { locationId: LOC_A, batchId, action: "assign", conversationId: "xv-spam", contactId: "xc-spam", beforeOwner: null, afterOwner: "u-new", result: "dry_run", actor: "u1" }]);
    expect(await assignedBatch(instA, batchId)).toEqual([{ locationId: LOC_A, contactId: "xc-plain", before: "u-old", after: "u-new" }]);
    expect(await assignedBatch(instB, batchId), "another installation cannot undo this batch").toEqual([]);
  });
});
