import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { callQueue } from "@/lib/analytics/call-queries";
import { closeDb, sql } from "@/lib/db";

// Golden dataset for the pre-built call lists, on the real database with a fixture company removed afterwards. Every contact below is built
// to be in exactly the lists named in its comment, so a list that takes in the wrong person, or leaves out the right one, fails by name.
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-calllists-co";
const LOC = "xtestCallLoc";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let inst = "";
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function contact(id: string, o: { added?: Date; active?: Date | null; dnd?: boolean } = {}) {
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, date_added, last_activity_at, dnd)
    values (${inst}, ${LOC}, ${id}, 'Golden', ${id}, ${id + "@example.test"}, '5550100', ${o.added ?? ago(120)}, ${o.active === undefined ? ago(120) : o.active}, ${o.dnd ?? false})`;
}
async function deal(contactId: string, status: string, o: { value?: number; statusChanged?: Date; stage?: string; acted?: Date } = {}) {
  await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, last_status_change_at, last_action_at, updated_remote_at, created_remote_at)
    values (${inst}, ${LOC}, ${"o-" + contactId + "-" + status}, 'p1', ${o.stage ?? "s0"}, ${contactId}, ${contactId}, ${"Deal " + contactId}, ${o.value ?? 1000}, ${status}, ${o.statusChanged ?? ago(1)}, ${o.acted ?? ago(120)}, ${o.acted ?? ago(120)}, ${ago(300)})`;
}
const appt = (contactId: string, status: string, start: Date, id: string) => sql()`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, title, status, start_at, end_at)
  values (${inst}, ${LOC}, ${id}, ${contactId}, 'Golden', ${status}, ${start}, ${new Date(start.getTime() + 1_800_000)})`;
const outcome = (contactId: string, kind: string, o: { at?: Date; followUp?: Date } = {}) => sql()`insert into call_outcomes (installation_id, location_id, contact_id, outcome, follow_up_at, created_at)
  values (${inst}, ${LOC}, ${contactId}, ${kind}, ${o.followUp ?? null}, ${o.at ?? ago(2)})`;
const who = async (preset: string) => (await callQueue(inst, null, { preset: preset as never }, 400)).rows.map((r) => r.contactId).sort();

describe.skipIf(!HAS_DB)("pre-built call lists on a golden dataset", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzCallLists', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${LOC}, 'Call lists fixture')`;
    await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst}, ${LOC}, 'p1', 'Sales', ${sql().json([{ id: "s0", name: "New" }, { id: "s1", name: "Proposal Sent" }] as never)})`;

    await contact("hot", { active: ago(5) });                       await deal("hot", "open", { value: 5000 });                    // hot_uncontacted
    await contact("propo", { active: ago(10) });                    await deal("propo", "open", { stage: "s1", acted: ago(10) });  // hot_uncontacted, proposal_stale
    await contact("cust", { active: ago(70) });                     await deal("cust", "won", { statusChanged: ago(100) });        // customers_followup
    await contact("winback", { active: ago(220) });                 await deal("winback", "won", { statusChanged: ago(200) });     // customers_followup, win_back
    await contact("recent", { active: ago(1) });                    await deal("recent", "won", { statusChanged: ago(30) });       // recent_customers
    await contact("fresh", { added: hoursAgo(2), active: null });                                                                  // new_unanswered, lead_recency
    await contact("replied", { added: hoursAgo(2), active: null });                                                                // lead_recency only (we already wrote to them)
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count) values (${inst}, ${LOC}, 'v1', 'replied', 'replied', 'TYPE_SMS', 'outbound', now(), 0)`;
    await contact("dnd", { added: hoursAgo(2), active: null, dnd: true });                                                         // in no list: asked not to be contacted
    await contact("noshow", { active: ago(3) });  await appt("noshow", "noshow", ago(3), "a1");                                    // noshow_recovery
    await contact("rebooked", { active: ago(3) }); await appt("rebooked", "noshow", ago(3), "a2"); await appt("rebooked", "confirmed", ago(-2), "a3"); // none: already rebooked
    await contact("later", { active: ago(30) });  await outcome("later", "follow_up", { at: ago(2), followUp: ago(1) });           // follow_ups_due
    await contact("nope", { active: ago(5) });    await deal("nope", "open");     await outcome("nope", "not_interested");          // none: said not interested
    await contact("justcalled", { active: ago(5) }); await deal("justcalled", "open"); await outcome("justcalled", "no_answer", { at: hoursAgo(1) }); // none: called an hour ago
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("hot leads not contacted in 3 days: open deal, quiet 3+ days; not the one called an hour ago or marked not interested", async () => {
    expect(await who("hot_uncontacted")).toEqual(["hot", "propo"]);
  });
  it("new leads with no reply (4 hours): only the one nobody has written to; not the do-not-contact one", async () => {
    expect(await who("new_unanswered")).toEqual(["fresh"]);
  });
  it("proposal stage quiet for a week: only the stale proposal", async () => {
    expect(await who("proposal_stale")).toEqual(["propo"]);
  });
  it("customers due a check-in: won a deal and quiet for 60+ days", async () => {
    expect(await who("customers_followup")).toEqual(["cust", "winback"]);
  });
  it("newest leads (24 hours): no deal yet, not do-not-contact", async () => {
    expect(await who("lead_recency")).toEqual(["fresh", "replied"]);
  });
  it("win-back: won over 180 days ago and nothing open", async () => {
    expect(await who("win_back")).toEqual(["winback"]);
  });
  it("no-show recovery: no-show in the last 14 days and not booked again", async () => {
    expect(await who("noshow_recovery")).toEqual(["noshow"]);
  });
  it("recent customers: won in the last 90 days", async () => {
    expect(await who("recent_customers")).toEqual(["recent"]);
  });
  it("follow-ups due: a follow-up date that has passed", async () => {
    expect(await who("follow_ups_due")).toEqual(["later"]);
  });
  it("nobody is in a list twice and the total counts what the list holds", async () => {
    const q = await callQueue(inst, null, { preset: "customers_followup" as never }, 400);
    expect(new Set(q.rows.map((r) => r.contactId)).size).toBe(q.rows.length);
    expect(q.total).toBe(q.rows.length);
  });
});
