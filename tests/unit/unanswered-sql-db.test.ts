import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { unansweredList } from "@/lib/analytics/unanswered-v2-queries";
import { sqlFind, sqlList, sqlTabCounts } from "@/lib/analytics/unanswered-sql";
import { readListParams } from "@/lib/analytics/unanswered-params";

// Unanswered round 3 (slices A and C): the SQL-paged list must hold exactly the people the older list holds, and the other company must never appear. Tiny fixtures, ids start with xtest-,
// removed afterwards. Skipped with no database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-u3a-co-a", CO_B = "xtest-u3a-co-b";
const LOC_1 = "xtestU3LocOne", LOC_2 = "xtestU3LocTwo", LOC_X = "xtestU3LocOther";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const NOW = Date.now();
const H = 3_600_000;
let instA = "", instB = "";

async function conv(inst: string, loc: string, id: string, o: { hoursAgo: number; dir?: string; type?: string; contact?: string | null; name?: string; assigned?: string | null; phone?: string; email?: string }) {
  const contact = o.contact === undefined ? `ct-${id}` : o.contact;
  if (contact) {
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, assigned_to, phone, email, date_added) values (${inst}, ${loc}, ${contact}, ${o.name ?? "pat"}, ${o.assigned ?? null}, ${o.phone ?? null}, ${o.email ?? null}, now()) on conflict do nothing`;
  }
  await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
    values (${inst}, ${loc}, ${id}, ${contact}, ${o.name ?? null}, ${o.type ?? "TYPE_SMS"}, ${o.dir ?? "inbound"}, ${new Date(NOW - o.hoursAgo * H - 60_000)}, 0)`;
}

describe.skipIf(!HAS_DB)("Unanswered round 3, SQL list", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const tok = encryptSecret("not-a-real-token");
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, 'zzU3', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await mk(CO_A); instB = await mk(CO_B);
    for (const [inst, loc, nm] of [[instA, LOC_1, "U3 one"], [instA, LOC_2, "U3 two"], [instB, LOC_X, "U3 other company"]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, speed_access, users_access) values (${inst}, ${loc}, ${nm}, 'ok', 'ok')`;
    }
    await conv(instA, LOC_1, "w1", { hoursAgo: 5, assigned: "uDana", name: "ava stone", phone: "+15555550101", email: "ava@example.test" });
    await conv(instA, LOC_1, "w2", { hoursAgo: 30, name: "ben stone", phone: "+15555550102", type: "TYPE_EMAIL" });
    await conv(instA, LOC_1, "w4a", { hoursAgo: 10, assigned: "uSam", name: "di stone", contact: "ct-di" });
    await conv(instA, LOC_1, "w4b", { hoursAgo: 100, assigned: "uSam", name: "di stone", contact: "ct-di", type: "TYPE_WHATSAPP" });
    await conv(instA, LOC_1, "n-inside", { hoursAgo: 2, name: "inside target" });
    await conv(instA, LOC_1, "n-note", { hoursAgo: 40, type: "TYPE_INTERNAL_COMMENT", dir: "outbound", name: "note" });
    await conv(instA, LOC_1, "q1", { hoursAgo: 48, dir: "outbound", name: "quiet one", phone: "+15555550177" });
    await conv(instA, LOC_1, "q2", { hoursAgo: 2, dir: "outbound", name: "just replied" });
    await conv(instA, LOC_2, "x1", { hoursAgo: 8, name: "ed stone", assigned: "uSam" });
    await conv(instA, LOC_2, "x2", { hoursAgo: 52, name: "fay stone", contact: null });
    for (let i = 0; i < 3; i++) await conv(instB, LOC_X, `o${i}`, { hoursAgo: 9 + i, name: `other ${i}`, phone: "+15555550177" });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  const scope = { slaHours: 4, targetMinutes: 15, now: NOW, seePeople: true, meId: "uSam" };
  const P = (q = "") => { const r = readListParams(new URLSearchParams(q), { seePeople: true }); if (!r.ok) throw new Error(r.error); return r.p; };
  const L = (q: string) => sqlList({ ...scope, installationId: instA, allowed: null }, P(q));

  it("holds exactly the people the older list holds, and every chip's number is its list", async () => {
    const old = await unansweredList({ ...scope, installationId: instA, allowed: null, bucket: null, channel: null, account: null, owner: null, q: "", sort: "wait", page: 0, size: 50 });
    const now = await L("size=50");
    expect(now.total).toBe(old.total);
    expect(now.rows.map((r) => r.key).sort()).toEqual(old.rows.map((r) => r.key).sort());
    expect(now.rows[0]).toMatchObject({ name: "Di Stone", conversations: 2, channel: "WhatsApp", hours: 100 });
    for (const b of ["h4", "h24", "h48"] as const) expect((await L(`bucket=${b}`)).total, b).toBe(now.facets.buckets[b]);
    expect((await L("owner=none")).total).toBe(now.facets.owner.none);
    expect((await L("owner=me")).total).toBe(now.facets.owner.mine);
    expect((await L("owner=mine_free")).total).toBe(now.facets.owner.mineFree);
    const email = now.facets.channels.find((c) => c.label === "Email");
    expect((await L("channel=Email")).total).toBe(email?.count);
  });

  it("with snooze and hide switched on, the default list is everyone: its total, the tab number, every bar and chip and every segment equal the rows they open", async () => {
    // A person with no outcome gave NULL in the hide rule, and `not (NULL)` dropped EVERYONE: the page said 23 waiting and the list said nobody. Every number is checked against its own list.
    const s = { ...scope, installationId: instA, allowed: null, hook: { snooze: true, hide: true } };
    const keys = [`${LOC_1}:ct-w1`, `${LOC_1}:ct-w2`];
    const withKeys = { ...s, newLeadKeys: keys };
    const plain = await sqlList({ ...scope, installationId: instA, allowed: null }, P("size=50"));
    const all = await sqlList(withKeys, P("size=50"));
    expect(all.total).toBeGreaterThan(0);
    expect(all.total).toBe(plain.total);
    expect((await sqlTabCounts(s, 24)).us, "the tab number is the number of rows").toBe(all.total);
    expect(all.rows.length).toBe(all.total);
    for (const b of ["h1", "h4", "h24", "h48"] as const) expect((await sqlList(withKeys, P(`bucket=${b}&size=50`))).total, `bar ${b}`).toBe(all.facets.buckets[b]);
    expect(all.facets.buckets.all).toBe(all.total);
    expect((await sqlList(withKeys, P("owner=none&size=50"))).total, "No owner").toBe(all.facets.owner.none);
    expect((await sqlList(withKeys, P("owner=me&size=50"))).total, "Mine").toBe(all.facets.owner.mine);
    for (const c of all.facets.channels) expect((await sqlList(withKeys, P(`channel=${encodeURIComponent(c.key)}&size=50`))).total, `channel ${c.key}`).toBe(c.count);
    const lead = all.facets.lead!;
    expect(lead.all).toBe(all.total);
    expect(lead.new + lead.existing).toBe(lead.all);
    expect((await sqlList(withKeys, P("lead=new&size=50"))).total, "New leads").toBe(lead.new);
    expect((await sqlList(withKeys, P("lead=existing&size=50"))).total, "Existing customers").toBe(lead.existing);
    expect(lead.new).toBe(2);
    expect((await sqlList(withKeys, P("lead=new&size=50"))).rows.every((r) => r.newLead)).toBe(true);
  });

  it("a page past the end answers the last page, with exact totals", async () => {
    const a = await L("size=20");
    expect(a.total).toBe(5);
    const beyond = await sqlList({ ...scope, installationId: instA, allowed: null }, { ...P(), page: 9 });
    expect(beyond.rows.length).toBe(5);
    expect(beyond.page).toBe(0);
  });

  it("searches name, phone and email, and treats a percent sign as a letter", async () => {
    const run = (q: string) => sqlList({ ...scope, installationId: instA, allowed: null }, { ...P(), q });
    expect((await run("ava")).total).toBe(1);
    expect((await run("0101")).total).toBe(1);
    expect((await run("ava@example")).total).toBe(1);
    expect((await run("%")).total).toBe(0);
    expect((await run("stone")).total).toBe(5);
  });

  it("the waiting-on-them tab lists who went quiet, never internal notes, never the other company", async () => {
    const them = await L("tab=them");
    expect(them.rows.map((r) => r.name)).toEqual(["Quiet One"]);
    expect(them.rows[0].hours).toBeGreaterThanOrEqual(48);
    const counts = await sqlTabCounts({ ...scope, installationId: instA, allowed: null }, 24);
    expect(counts).toEqual({ us: 5, them: 1 });
  });

  it("the search across accounts finds a phone number only inside the company's own accounts", async () => {
    const mine = await sqlFind({ ...scope, installationId: instA, allowed: null }, { q: "5550177", page: 0, size: 20 });
    expect(mine.rows.map((r) => r.name)).toEqual(["Quiet One"]);
    expect(mine.rows[0].state).toBe("quiet");
    expect((await sqlFind({ ...scope, installationId: instA, allowed: [LOC_2] }, { q: "5550177", page: 0, size: 20 })).total).toBe(0);
    expect((await sqlFind({ ...scope, installationId: instA, allowed: [LOC_X] }, { q: "other", page: 0, size: 20 })).total).toBe(0);
    expect((await sqlFind({ ...scope, installationId: instA, allowed: null }, { q: "a", page: 0, size: 20 })).total).toBe(0);
  });
});
