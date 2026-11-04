import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { forgetPeopleLists } from "@/lib/analytics/people-queue-queries";
import { signSession } from "@/lib/session";

// People, the rebuild (stage PEOPLE), against the real database with fixture companies only (removed afterwards; deleting the installation cascades). Skipped with no database.
//   1. The five lists and their counts are the lists other pages use, and every one is cut to the caller's accounts (an agency its own, a client's staff their one account).
//   2. Search and the panel never cross a company or an account: forged account and company ids answer "not found" or nothing.
//   3. "Mine", "seen" (what changed since you last looked), recent searches and logging a call work per person and only inside the caller's accounts.
//   4. At 150 accounts (and one account of 20,000 contacts) the server sends one page and one short answer, never the whole list, in a bounded time.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const CO_A = "xtest-ppl-a", CO_B = "xtest-ppl-b", CO_S = "xtest-ppl-s", CO_L = "xtest-ppl-l";
const A1 = "xtestPplA1", A2 = "xtestPplA2", B1 = "xtestPplB1", BIG = "xtestPplBig";
const ME = "u-me";
let instA = "", instB = "", instS = "", instL = "";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null, userId = `u-${kind}`) =>
  signSession({ companyId: company, userId, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" } as never);
async function call(token: string, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), p.split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

const MIN = 60_000, DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const contact = (inst: string, loc: string, id: string, first: string, last: string, o: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: last, email: `${id}@x.test`, phone: "+15550100000", tags: [] as string[], date_added: ago(30 * DAY),
  last_activity_at: ago(2 * DAY), dnd: false, assigned_to: null as string | null, source: null as string | null, ...o,
});
const lead = (inst: string, loc: string, id: string, ageMin: number) => sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id, human_touch_at, read_version)
  values (${inst}, ${loc}, ${id}, ${"conv-" + id}, ${ago(ageMin * MIN)}, ${null}, ${null}, ${null}, 1)`;
const deal = (inst: string, loc: string, id: string, contactId: string, value: number, acted: Date) => sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at, created_remote_at)
  values (${inst}, ${loc}, ${id}, 'pipe1', 'stage1', ${contactId}, ${contactId}, ${"Deal " + id}, ${value}, 'open', 'u-owner', ${acted}, ${acted}, ${acted}, ${acted}, ${ago(90 * DAY)})`;

describe.skipIf(!HAS_DB)("People: the call lists, the panel and the search", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B, CO_S, CO_L]) await sql()`delete from installations where company_id = ${co}`;
    const mk = async (co: string, name: string) => (await sql()`insert into installations (company_id, company_name, plan) values (${co}, ${name}, 'pro') returning id`)[0].id as string;
    instA = await mk(CO_A, "zzPpl A"); instB = await mk(CO_B, "zzPpl B"); instS = await mk(CO_S, "zzPpl S"); instL = await mk(CO_L, "zzPpl L");
    for (const inst of [instA, instB, instS, instL]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzPpl Client A1"], [instA, A2, "zzPpl Client A2"], [instB, B1, "zzPpl Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, speed_access, appointments_access, users_access) values (${inst}, ${loc}, ${name}, 'UTC', true, 'ok', 'ok', 'ok')`;
    }
    await sql()`insert into team_names (installation_id, user_id, name) values (${instA}, ${ME}, 'Mia Me'), (${instA}, 'u-owner', 'Olive Owner')`;
    await sql()`insert into cached_contacts ${sql()([
      // A1: two waiting leads (one mine, one asked not to be contacted), a no-show, a hot lead, a stale deal, a follow-up, and a quiet customer with tags
      contact(instA, A1, "a1-wait1", "Ada", "Lovelace", { assigned_to: ME, tags: ["vip"] }), contact(instA, A1, "a1-wait2", "Grace", "Hopper", { dnd: true }),
      contact(instA, A1, "a1-noshow", "Linus", "Torvalds", { assigned_to: ME }), contact(instA, A1, "a1-hot", "Hedy", "Lamarr", { last_activity_at: ago(6 * DAY) }),
      contact(instA, A1, "a1-stale", "Alan", "Turing", { assigned_to: "u-owner" }), contact(instA, A1, "a1-follow", "Katherine", "Johnson", { last_activity_at: ago(8 * DAY) }),
      contact(instA, A1, "a1-quiet", "Dennis", "Ritchie", { last_activity_at: ago(200 * DAY), tags: ["vip", "cold"] }),
      // A2 belongs to the same company; B1 is another company with a person of the same name
      contact(instA, A2, "a2-wait1", "Barbara", "Liskov", { assigned_to: ME }), contact(instB, B1, "b1-ada", "Ada", "Lovelace"), contact(instB, B1, "b1-wait", "Zed", "Zeta"),
    ] as never)}`;
    await lead(instA, A1, "a1-wait1", 100); await lead(instA, A1, "a1-wait2", 300); await lead(instA, A2, "a2-wait1", 200); await lead(instB, B1, "b1-wait", 500);
    await sql()`insert into cached_appointments ${sql()([
      { installation_id: instA, location_id: A1, appointment_id: "ap1", calendar_id: "cal", calendar_name: "Consult", contact_id: "a1-noshow", title: "Appointment", status: "noshow", start_at: ago(3 * DAY), end_at: ago(3 * DAY - 1_800_000), assigned_to: ME, created_remote_at: ago(6 * DAY) },
      { installation_id: instA, location_id: A1, appointment_id: "ap2", calendar_id: "cal", calendar_name: "Consult", contact_id: "a1-hot", title: "Appointment", status: "showed", start_at: ago(2 * DAY), end_at: ago(2 * DAY - 1_800_000), assigned_to: ME, created_remote_at: ago(5 * DAY) },
    ] as never)}`;
    await deal(instA, A1, "d-hot", "a1-hot", 5000, ago(5 * DAY)); // open deal, nothing for 5 days: hot
    await deal(instA, A1, "d-stale", "a1-stale", 9000, ago(60 * DAY)); // open deal, no movement for 60 days: stale
    await sql()`insert into call_outcomes (installation_id, location_id, contact_id, outcome, follow_up_at, created_at) values (${instA}, ${A1}, 'a1-follow', 'follow_up', ${ago(DAY)}, ${ago(3 * DAY)})`;
    await sql()`insert into contact_tag_events (installation_id, location_id, contact_id, tag, kind, at) values (${instA}, ${A1}, 'a1-wait1', 'vip', 'added', ${ago(2 * DAY)})`;
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
      values (${instA}, ${A1}, 'conv-a1-wait1', 'a1-wait1', 'Ada Lovelace', 'TYPE_SMS', 'inbound', ${ago(100 * MIN)}, 1)`;
    forgetPeopleLists(instA);

    // Scale: 150 accounts, each with a few people, 40 of whom are waiting for a reply; and one account holding 20,000 contacts.
    const locs = Array.from({ length: 150 }, (_, i) => ({ installation_id: instS, location_id: `xtestPplS${String(i).padStart(3, "0")}`, name: `zzPpl Scale ${String(i).padStart(3, "0")}`, timezone: "UTC", client_view: true, speed_access: "ok" }));
    await sql()`insert into locations ${sql()(locs as never)}`;
    const people = locs.flatMap((l, i) => Array.from({ length: 6 }, (_, k) => contact(instS, l.location_id, `${l.location_id}-p${k}`, "Person", `${i}x${k}`)));
    for (let at = 0; at < people.length; at += 500) await sql()`insert into cached_contacts ${sql()(people.slice(at, at + 500) as never)}`;
    const waiting = locs.slice(0, 40).map((l) => ({ installation_id: instS, location_id: l.location_id, contact_id: `${l.location_id}-p0`, conversation_id: `c-${l.location_id}`, lead_at: ago(120 * MIN), read_version: 1 }));
    await sql()`insert into lead_touches ${sql()(waiting as never)}`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, speed_access) values (${instL}, ${BIG}, 'zzPpl Big', 'UTC', true, 'ok')`;
    const big = Array.from({ length: 20_000 }, (_, i) => contact(instL, BIG, `big-${String(i).padStart(5, "0")}`, "Casey", `Number${i}`, { email: `casey${i}@big.test`, phone: `+1555${String(i).padStart(7, "0")}` }));
    for (let at = 0; at < big.length; at += 1000) await sql()`insert into cached_contacts ${sql()(big.slice(at, at + 1000) as never)}`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B, CO_S, CO_L]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  const agency = () => session(CO_A, "agency", null);
  const client = () => session(CO_A, "client", A1, ME);

  it("the five lists hold the people their own pages hold, and the counts on the chips equal the rows", async () => {
    const home = await call(agency(), "GET", "people/home");
    expect(home.status).toBe(200);
    const count = (id: string) => (home.body.counts as Json[]).find((c) => c.id === id)!.total as number;
    expect([count("waiting"), count("noshows"), count("hot"), count("stale"), count("followups")]).toEqual([3, 1, 1, 1, 1]);
    expect(home.body.start).toBe("waiting");
    expect(home.body.say.head).toBe("3 new leads are waiting for a reply.");
    for (const id of ["waiting", "noshows", "hot", "stale", "followups"]) {
      const q = await call(agency(), "GET", `people/queue?list=${id}`);
      expect(q.status, id).toBe(200);
      expect(q.body.total, `${id}: the chip and the list count the same people`).toBe(count(id));
      expect((q.body.rows as Json[]).length, id).toBe(count(id));
      expect((q.body.rows as Json[]).every((r) => [A1, A2].includes(r.locationId as string)), `${id}: only this company's accounts`).toBe(true);
    }
    const waiting = (await call(agency(), "GET", "people/queue?list=waiting")).body.rows as Json[];
    expect(waiting.map((r) => r.contactId)).toEqual(["a1-wait2", "a2-wait1", "a1-wait1"]); // the longest wait first
    expect(waiting[0]).toMatchObject({ dnd: true, name: "Grace Hopper" });
    expect(waiting[2].why).toMatch(/^Waiting 1 h \d+ min/);
    expect(waiting[2].url).toMatch(/\/contacts\/detail\/a1-wait1$/);
    const stale = (await call(agency(), "GET", "people/queue?list=stale")).body.rows as Json[];
    expect(stale[0].why).toMatch(/\$9,000/);
    const noshow = (await call(agency(), "GET", "people/queue?list=noshows")).body.rows as Json[];
    expect(noshow[0]).toMatchObject({ contactId: "a1-noshow", ownerName: "Mia Me" });
    expect(noshow[0].why).toMatch(/^Missed 3 days ago/);
    expect(JSON.stringify(home.body)).not.toContain("b1-");
    expect(JSON.stringify(home.body)).not.toContain("Zed Zeta");
  });

  it("a client's staff see only their one account, whatever account the address names", async () => {
    const home = await call(client(), "GET", "people/home");
    expect(home.status).toBe(200);
    expect(home.body.multi).toBe(false);
    expect((home.body.counts as Json[]).find((c) => c.id === "waiting")!.total).toBe(2);
    for (const forged of [`&location=${A2}`, `&account=${A2}`, `&accounts=${A2}`]) {
      const q = await call(client(), "GET", `people/queue?list=waiting${forged}`);
      expect((q.body.rows as Json[]).every((r) => r.locationId === A1), `forged ${forged}`).toBe(true);
    }
    const s = await call(client(), "GET", `people/search?q=Liskov&location=${A2}`);
    expect(s.body.total).toBe(0);
    const other = await call(agency(), "GET", `people/search?q=Zeta`);
    expect(other.body.total).toBe(0);
  });

  it("'Mine' keeps the people assigned to the asker, and a client's staff start on their own queue when it is not empty", async () => {
    const home = await call(client(), "GET", "people/home");
    expect(home.body.staff).toBe(true);
    expect(home.body.mine).toBe(true);
    expect(home.body.page.rows.map((r: Json) => r.contactId)).toEqual(["a1-wait1"]);
    expect((home.body.counts as Json[]).find((c) => c.id === "waiting")).toMatchObject({ total: 2, mine: 1 });
    const mineNoShows = await call(client(), "GET", "people/queue?list=noshows&mine=1");
    expect(mineNoShows.body.total).toBe(1);
    const mineHot = await call(client(), "GET", "people/queue?list=hot&mine=1");
    expect(mineHot.body.total).toBe(0);
    const everyone = await call(client(), "GET", "people/queue?list=hot&mine=0");
    expect(everyone.body.total).toBe(1);
    // A client's staff with nothing assigned see everyone, not an empty queue.
    const nobody = await call(session(CO_A, "client", A1, "u-nobody"), "GET", "people/home");
    expect(nobody.body.mine).toBe(false);
    expect(nobody.body.page.total).toBe(2);
    // The agency owner starts on everyone.
    expect((await call(agency(), "GET", "people/home")).body.mine).toBe(false);
  });

  it("a person of another account or company answers 'not found' in the panel, and nothing is remembered about them", async () => {
    for (const [tok, loc, id] of [[agency(), B1, "b1-ada"], [client(), A2, "a2-wait1"], [client(), B1, "b1-ada"], [agency(), A1, "nobody-here"]] as const) {
      expect((await call(tok, "GET", `people/person/${loc}/${id}`)).status, `${loc}/${id}`).toBe(404);
      expect((await call(tok, "PUT", "people/seen", { locationId: loc, contactId: id })).status, `seen ${loc}/${id}`).toBe(404);
    }
    const recent = await call(agency(), "GET", "people/recent");
    expect(JSON.stringify(recent.body)).not.toContain("b1-ada");
    expect((await call(agency(), "GET", "people/person/bad id/x")).status).toBe(404);
  });

  it("the panel gives one headline, the tag with the day SubSync saw it, and a timeline from the event store", async () => {
    const p = await call(agency(), "GET", `people/person/${A1}/a1-wait1`);
    expect(p.status).toBe(200);
    expect(p.body.headline.tone).toBe("act");
    expect(p.body.headline.line).toMatch(/^Never answered\. Waiting|^Waiting for a reply for/);
    expect(p.body.contact.tags).toEqual(["vip"]);
    expect(Object.keys(p.body.tagDates)).toEqual(["vip"]);
    expect(p.body.ownerName).toBe("Mia Me");
    const kinds = (p.body.timeline as Json[]).map((t) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(["contact", "message", "tag", "touch"]));
    const times = (p.body.timeline as Json[]).map((t) => Date.parse(t.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(p.body.url).toMatch(/\/contacts\/detail\/a1-wait1$/);
    expect(p.body.conversationId, "the conversation id stays on the server").toBeUndefined();
    const dnd = await call(agency(), "GET", `people/person/${A1}/a1-wait2`);
    expect(dnd.body.headline.tone).toBe("stop");
    const noshow = await call(agency(), "GET", `people/person/${A1}/a1-noshow`);
    expect(noshow.body.headline.line).toMatch(/^Missed their appointment on/);
    const stale = await call(agency(), "GET", `people/person/${A1}/a1-stale`);
    expect(stale.body.headline.line).toMatch(/^An open deal worth \$9,000 has not moved in 60 days\./);
    expect(stale.body.deals[0]).toMatchObject({ value: 9000, stale: true });
    const follow = await call(agency(), "GET", `people/person/${A1}/a1-follow`);
    expect(follow.body.headline.line).toMatch(/^A follow-up was due/);
  });

  it("what changed since the person last looked: nothing the first time, then only what is newer", async () => {
    const tok = session(CO_A, "agency", null, "u-looker");
    const first = await call(tok, "GET", `people/person/${A1}/a1-wait1`);
    expect(first.body.lastSeenAt).toBeNull();
    expect(first.body.changed).toBeNull();
    const seen = await call(tok, "PUT", "people/seen", { locationId: A1, contactId: "a1-wait1" });
    expect(seen.body).toMatchObject({ ok: true, previous: null });
    // Something happens after they looked: a call is logged by a colleague.
    await sql()`insert into call_outcomes (installation_id, location_id, contact_id, outcome, created_at) values (${instA}, ${A1}, 'a1-wait1', 'voicemail', now() + interval '1 second')`;
    const second = await call(tok, "GET", `people/person/${A1}/a1-wait1`);
    expect(second.body.lastSeenAt).not.toBeNull();
    expect(second.body.changed.count).toBeGreaterThanOrEqual(1);
    expect(second.body.changed.line).toMatch(/Call logged: Voicemail/);
    // Another person has their own memory.
    const other = await call(session(CO_A, "agency", null, "u-other"), "GET", `people/person/${A1}/a1-wait1`);
    expect(other.body.lastSeenAt).toBeNull();
    // The person now shows under Recently opened, for the one who opened them.
    expect(((await call(tok, "GET", "people/recent")).body.people as Json[]).map((r) => r.contactId)).toEqual(["a1-wait1"]);
    expect(((await call(session(CO_A, "agency", null, "u-other"), "GET", "people/recent")).body.people as Json[])).toHaveLength(0);
  });

  it("recent searches are kept per person, newest first, without repeats, and can be cleared; a one-letter search is refused", async () => {
    const tok = session(CO_A, "agency", null, "u-searcher");
    for (const q of ["lovelace", "hopper", "LOVELACE"]) expect((await call(tok, "POST", "people/recent", { q })).status).toBe(200);
    expect((await call(tok, "GET", "people/recent")).body.queries).toEqual(["LOVELACE", "hopper"]);
    expect((await call(tok, "POST", "people/recent", { q: "a" })).status).toBe(400);
    expect((await call(session(CO_A, "agency", null, "u-else"), "GET", "people/recent")).body.queries).toEqual([]);
    expect((await call(tok, "DELETE", "people/recent")).status).toBe(200);
    expect((await call(tok, "GET", "people/recent")).body.queries).toEqual([]);
  });

  it("logging a call works for a person in the caller's accounts only, and moves the list", async () => {
    expect((await call(client(), "POST", "people/outcome", { locationId: A2, contactId: "a2-wait1", outcome: "answered" })).status).toBe(404);
    expect((await call(client(), "POST", "people/outcome", { locationId: B1, contactId: "b1-ada", outcome: "answered" })).status).toBe(404);
    expect((await call(client(), "POST", "people/outcome", { locationId: A1, contactId: "a1-hot", outcome: "nonsense" })).status).toBe(400);
    const before = (await call(client(), "GET", "people/queue?list=hot&mine=0")).body.total;
    expect(before).toBe(1);
    expect((await call(client(), "POST", "people/outcome", { locationId: A1, contactId: "a1-hot", outcome: "voicemail" })).status).toBe(200);
    expect((await call(client(), "GET", "people/queue?list=hot&mine=0")).body.total, "a person just called leaves the hot list").toBe(0);
    const rows = await sql()`select count(*)::int n from call_outcomes where installation_id = ${instA} and contact_id = 'a1-hot'`;
    expect(rows[0].n).toBe(1);
    const none = await sql()`select count(*)::int n from call_outcomes where installation_id = ${instB}`;
    expect(none[0].n).toBe(0);
  });

  it("search finds a person by part of the name, the email or the last digits of the phone, inside the caller's accounts", async () => {
    const byName = await call(agency(), "GET", "people/search?q=lovel");
    expect((byName.body.rows as Json[]).map((r) => r.contactId)).toEqual(["a1-wait1"]);
    expect((await call(agency(), "GET", "people/search?q=a2-wait1%40x")).body.total).toBe(1);
    expect((await call(agency(), "GET", "people/search?q=555%20010")).body.total).toBeGreaterThan(5);
    const row = (byName.body.rows as Json[])[0];
    expect(row).toMatchObject({ rowId: `${A1}:a1-wait1`, why: "", ownerName: "Mia Me" });
    expect(byName.body.capped).toBe(false);
  });

  it("150 accounts: one page and one short answer, bounded in time, the counts equal Speed's own, and the list pages", async () => {
    const tok = session(CO_S, "agency", null);
    const t0 = Date.now();
    const home = await call(tok, "GET", "people/home");
    const took = Date.now() - t0;
    expect(home.status).toBe(200);
    expect((home.body.counts as Json[]).find((c) => c.id === "waiting")!.total).toBe(40);
    expect(home.body.page.rows.length).toBe(25);
    expect(home.body.page.pages).toBe(2);
    expect(JSON.stringify(home.body).length, "the answer does not grow with the accounts").toBeLessThan(80_000);
    expect(took).toBeLessThan(30_000);
    const p2 = await call(tok, "GET", "people/queue?list=waiting&page=2");
    expect(p2.body.rows.length).toBe(15);
    const keys = new Set([...home.body.page.rows, ...p2.body.rows].map((r: Json) => r.rowId));
    expect(keys.size, "no person twice across the pages").toBe(40);
    const s = await call(tok, "GET", "people/search?q=Person");
    expect(s.body.rows.length).toBe(50);
    expect(s.body.total).toBe(900);
    expect((await call(tok, "GET", `people/search?q=Person&page=19`)).body.rows.length).toBe(0);
  });

  it("one account of 20,000 contacts: a search answers one page quickly, an everyone list counts past the cap without counting it all", async () => {
    const tok = session(CO_L, "agency", null);
    const t0 = Date.now();
    const one = await call(tok, "GET", "people/search?q=casey1999%40big");
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(one.body.total).toBe(1);
    const part = await call(tok, "GET", "people/search?q=Number1999");
    expect(part.body.total).toBe(11); // Number1999 and Number19990 to Number19999
    const phone = await call(tok, "GET", "people/search?q=0019999");
    expect(phone.body.rows.length).toBeGreaterThanOrEqual(1);
    const all = await call(tok, "GET", "people/search?q=Casey");
    expect(all.body.rows.length).toBe(50);
    expect(all.body.total).toBe(10_000);
    expect(all.body.capped, "two letters of 20,000 stop counting at 10,000").toBe(true);
    expect(JSON.stringify(all.body).length).toBeLessThan(60_000);
  });
});
