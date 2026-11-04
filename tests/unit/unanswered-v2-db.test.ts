import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { unansweredHome, unansweredList, unansweredRanks } from "@/lib/analytics/unanswered-v2-queries";
import { waitingState } from "@/lib/analytics/waiting";

// Unanswered messages, rebuilt (stage UNANS), against the real database on two fixture companies that are removed afterwards (no refresh token, so the production cron never
// queues them). Skipped with no database. The fixtures include forged ids: the other company's account asked for through every narrowing parameter must answer nothing.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-unans-co-a", CO_B = "xtest-unans-co-b";
const LOC_1 = "xtestUnLocOne", LOC_2 = "xtestUnLocTwo", LOC_X = "xtestUnLocOther";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const NOW = Date.now();
const H = 3_600_000;
let instA = "", instB = "";

async function conv(inst: string, loc: string, id: string, o: { hoursAgo: number; dir?: string; type?: string; contact?: string | null; name?: string; assigned?: string | null; phone?: string; dnd?: boolean }) {
  const contact = o.contact === undefined ? `ct-${id}` : o.contact;
  if (contact) {
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, assigned_to, phone, dnd, date_added) values (${inst}, ${loc}, ${contact}, ${o.name ?? "pat"}, ${o.assigned ?? null}, ${o.phone ?? null}, ${o.dnd === true}, now())
      on conflict do nothing`;
  }
  await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
    values (${inst}, ${loc}, ${id}, ${contact}, ${o.name ?? null}, ${o.type ?? "TYPE_SMS"}, ${o.dir ?? "inbound"}, ${new Date(NOW - o.hoursAgo * H - 60_000)}, 0)`;
}

describe.skipIf(!HAS_DB)("Unanswered messages v2, query layer", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const tok = encryptSecret("not-a-real-token");
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, 'zzUn', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await mk(CO_A); instB = await mk(CO_B);
    for (const [inst, loc, nm] of [[instA, LOC_1, "Un one"], [instA, LOC_2, "Un two"], [instB, LOC_X, "Un other company"]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, speed_access, users_access) values (${inst}, ${loc}, ${nm}, 'ok', 'ok')`;
    }
    await sql()`insert into team_names (installation_id, user_id, name, source) values (${instA}, 'uDana', 'Dana Brooks', 'platform'), (${instA}, 'uSam', 'Sam Lee', 'platform')`;
    // Account one: waiting at 5 h (owner Dana), 30 h (nobody, do not disturb), 60 h (Sam, a call), one person with two waiting conversations (10 h and 100 h),
    // and the cases that are NOT waiting: inside the target (2 h), answered (outbound), an internal note, older than the window (40 days).
    await conv(instA, LOC_1, "w1", { hoursAgo: 5, assigned: "uDana", name: "ava stone", phone: "+15555550101" });
    await conv(instA, LOC_1, "w2", { hoursAgo: 30, name: "ben stone", dnd: true, phone: "+15555550102", type: "TYPE_EMAIL" });
    await conv(instA, LOC_1, "w3", { hoursAgo: 60, assigned: "uSam", name: "cy stone", type: "TYPE_CALL" });
    await conv(instA, LOC_1, "w4a", { hoursAgo: 10, assigned: "uSam", name: "di stone", contact: "ct-di" });
    await conv(instA, LOC_1, "w4b", { hoursAgo: 100, assigned: "uSam", name: "di stone", contact: "ct-di", type: "TYPE_WHATSAPP" });
    await conv(instA, LOC_1, "n-inside", { hoursAgo: 2, name: "inside target" });
    await conv(instA, LOC_1, "n-answered", { hoursAgo: 20, dir: "outbound", name: "answered" });
    await conv(instA, LOC_1, "n-note", { hoursAgo: 20, type: "TYPE_INTERNAL_COMMENT", dir: "outbound", name: "note" });
    await conv(instA, LOC_1, "n-dead", { hoursAgo: 40 * 24, name: "dead" });
    await conv(instA, LOC_2, "x1", { hoursAgo: 8, name: "ed stone", assigned: "uSam" });
    await conv(instA, LOC_2, "x2", { hoursAgo: 52, name: "fay stone", contact: null });
    for (let i = 0; i < 5; i++) await conv(instB, LOC_X, `o${i}`, { hoursAgo: 9 + i, name: `other ${i}` });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  const base = { slaHours: 4, targetMinutes: 15, now: NOW, seePeople: true };
  const L = (o: Partial<Parameters<typeof unansweredList>[0]> = {}) => unansweredList({ ...base, installationId: instA, allowed: null, meId: "uSam", bucket: null, channel: null, account: null, owner: null, q: "", sort: "wait", page: 0, size: 25, ...o });

  it("home: a person is counted once, only the waiting ones, the five rows are the longest waits, the other company is never read", async () => {
    const h = await unansweredHome({ ...base, installationId: instA, allowed: null, meId: "uSam" });
    // w1, w2, w3, di (two conversations, one person), x1, x2 (no contact: one per conversation) = 6 people from 7 conversations.
    expect(h.waiting.people).toBe(6);
    expect(h.waiting.conversations).toBe(7);
    expect(h.waiting.accounts).toBe(2);
    expect(h.waiting.rows).toHaveLength(5);
    const hours = h.waiting.rows.map((r) => r.hours);
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    expect(h.waiting.rows[0]).toMatchObject({ name: "Di Stone", conversations: 2, channel: "WhatsApp", hours: 100 });
    expect(h.waiting.rows.every((r) => [LOC_1, LOC_2].includes(r.locationId))).toBe(true);
    expect(h.waiting.headline.text).toMatch(/^6 people are waiting for a reply across 2 clients\. The longest has waited 4 days\.$/);
    expect(h.buckets.reduce((s, b) => s + b.count, 0)).toBe(6);
    expect(h.accounts?.rows.every((a) => a.id !== LOC_X)).toBe(true);
    expect(h.mine).toBe(3); // di, cy, ed are Sam's
    expect(h.conversationsRead).toBeGreaterThan(7);
  });

  it("home: the phone, the do-not-disturb mark and the owner's name come with the row; a call says so", async () => {
    const h = await unansweredHome({ ...base, installationId: instA, allowed: null, meId: null });
    const all = (await L({ size: 50 })).rows;
    const ben = all.find((r) => r.name === "Ben Stone")!;
    expect(ben).toMatchObject({ phone: "+15555550102", dnd: true, unassigned: true, channel: "Email" });
    expect(all.find((r) => r.name === "Ava Stone")!.owner?.label).toBe("Dana Brooks");
    expect(all.find((r) => r.name === "Cy Stone")).toMatchObject({ call: true, channel: "Call" });
    expect(h.waiting.noOwner).toBe(2); // ben, and fay (a conversation with no contact on file)
  });

  it("the list behind a number has exactly the number's rows; Today's rule, the buckets, the clients, the owners all agree", async () => {
    const h = await unansweredHome({ ...base, installationId: instA, allowed: null, meId: "uSam" });
    expect((await L()).total).toBe(h.waiting.people);
    for (const b of h.buckets) expect((await L({ bucket: b.key })).total, b.label).toBe(b.count);
    for (const a of h.accounts!.rows) expect((await L({ allowed: [a.id] })).total, a.name).toBe(a.count);
    expect((await L({ owner: "none" })).total).toBe(h.waiting.noOwner);
    expect((await L({ owner: "me" })).total).toBe(h.mine);
    expect((await L({ owner: "uSam" })).total).toBe(3);
    // The rule is waiting.ts: every listed person's wait is "waiting" by the one function.
    for (const r of (await L({ size: 50 })).rows) expect(waitingState({ direction: "inbound", at: NOW - r.hours * H, type: "TYPE_SMS" }, NOW, 4)).toBe("waiting");
    // Search, paging, channel.
    expect((await L({ q: "stone" })).total).toBe(6);
    expect((await L({ channel: "Email" })).total).toBe(1);
    const paged = await L({ size: 2, page: 1 });
    expect(paged).toMatchObject({ page: 1, pages: 3, total: 6, from: 3, to: 4 });
    expect(paged.rows).toHaveLength(2);
  });

  it("the other company's account and people are never read, whatever is asked for", async () => {
    // Narrowed to an account the caller may not read (the router passes `allowed`): nothing.
    expect((await L({ allowed: [LOC_X] })).total).toBe(0);
    expect((await L({ allowed: [LOC_2], q: "ava" })).total).toBe(0);
    expect((await L({ allowed: [] })).total).toBe(0);
    const other = await unansweredList({ ...base, installationId: instB, allowed: null, meId: null, bucket: null, channel: null, account: null, owner: null, q: "", sort: "wait", page: 0, size: 50 });
    expect(other.total).toBe(5);
    expect(other.rows.every((r) => r.locationId === LOC_X)).toBe(true);
    // Company B asking for company A's account id finds nothing: every query is bound to the installation.
    const forged = await unansweredList({ ...base, installationId: instB, allowed: [LOC_1], meId: null, bucket: null, channel: null, account: null, owner: null, q: "", sort: "wait", page: 0, size: 50 });
    expect(forged.total).toBe(0);
    const forgedHome = await unansweredHome({ ...base, installationId: instB, allowed: [LOC_1, LOC_2], meId: null });
    expect(forgedHome.waiting.people).toBe(0);
    expect(JSON.stringify(forgedHome)).not.toContain("stone");
    const forgedRanks = await unansweredRanks({ ...base, installationId: instB, allowed: [LOC_1], by: "account", q: "", page: 0, size: 25 });
    expect(forgedRanks.total).toBe(0);
  });

  it("a client's staff cannot look at a colleague by person id and get no ranking of people", async () => {
    const asClient = (o: Partial<Parameters<typeof unansweredList>[0]> = {}) => L({ seePeople: false, allowed: [LOC_1], ...o });
    const all = await asClient();
    expect((await asClient({ owner: "uDana" })).total, "a colleague's id does not narrow").toBe(all.total);
    expect((await asClient({ owner: "me" })).total).toBeGreaterThan(0);
    const ranks = await unansweredRanks({ ...base, seePeople: false, installationId: instA, allowed: [LOC_1], by: "owner", q: "", page: 0, size: 25 });
    expect(ranks.total).toBe(0);
    const home = await unansweredHome({ ...base, seePeople: false, installationId: instA, allowed: [LOC_1], meId: "uSam" });
    expect(home.owners).toBeNull();
    expect(home.accounts).toBeNull();
  });

  it("rankings: clients by people waiting, owners with 'No owner', searched and paged; one account ranks owners instead of clients", async () => {
    const accounts = await unansweredRanks({ ...base, installationId: instA, allowed: null, by: "account", q: "", page: 0, size: 1 });
    expect(accounts.total).toBe(2);
    expect(accounts.rows).toHaveLength(1);
    expect((await unansweredRanks({ ...base, installationId: instA, allowed: null, by: "account", q: "two", page: 0, size: 25 })).total).toBe(1);
    const one = await unansweredHome({ ...base, installationId: instA, allowed: [LOC_1], meId: null });
    expect(one.accounts).toBeNull();
    expect(one.owners?.rows.map((o) => o.label)).toContain("No owner");
    expect(one.owners!.rows.reduce((s, o) => s + o.count, 0)).toBe(one.waiting.people);
    const owners = await unansweredRanks({ ...base, installationId: instA, allowed: [LOC_1], by: "owner", q: "", page: 0, size: 25 });
    expect((owners.rows as Array<{ label: string }>).map((o) => o.label)).toContain("Sam Lee");
  });

  it("a longer reply target leaves fewer people, and nothing else changes", async () => {
    const strict = await unansweredHome({ ...base, slaHours: 24, installationId: instA, allowed: null, meId: null });
    expect(strict.waiting.people).toBe(4); // di (100 h), cy (60 h), fay (52 h), ben (30 h)
    expect(strict.buckets.map((b) => b.key)).toEqual(["h24", "h48"]);
  });
});
