import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { ignoredByAccount, ignoredPage } from "@/lib/analytics/ignored-leads-sql";

// "Clients ignoring leads" on a real database: the people a client account has not answered, split into new leads never answered, customers with no reply, customers with only an automatic reply
// and missed calls nobody returned. Checks: the human-versus-automatic split (and the setting that counts automatic messages), a person who asked not to be contacted is left out, every count equals
// the rows behind it, and another company's accounts never appear (asking for them by id changes nothing). Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the database is there.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-ig-a", CO_B = "xtest-ig-b", A1 = "xtestIgA1", B1 = "xtestIgB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string) => signSession({ companyId: company, userId: `${company}-u`, role: "admin", userName: "Ig Xtest", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
async function get(company: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method: "GET", headers: { Authorization: `Bearer ${session(company)}` } }), p.split("/"));
  const text = await res.text();
  let body: Json = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body };
}
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
let n = 0;
async function touch(inst: string, loc: string, contact: string, o: { dir: "inbound" | "outbound"; kind?: string; days: number; auto?: boolean }) {
  await sql()`insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated)
    values (${inst}, ${loc}, ${contact}, ${`xtest-ig-${++n}`}, ${o.dir}, ${o.kind === "call" || o.kind === "missed_call" ? "call" : "sms"}, ${o.kind ?? "message"}, ${ago(o.days)}, ${o.auto === true})`;
}
async function contact(inst: string, loc: string, id: string, o: { name: string; created: number; dnd?: boolean; conversation?: boolean }) {
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, tags, date_added, dnd) values (${inst}, ${loc}, ${id}, ${o.name}, 'Xtest', '{}', ${ago(o.created)}, ${o.dnd === true})`;
  if (o.conversation !== false) await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, last_message_at, last_message_direction) values (${inst}, ${loc}, ${"conv-" + id}, ${id}, ${ago(2)}, 'inbound')`;
}
const scope = (inst: string, allowed: string[] | null) => ({ installationId: inst, allowed, fromMs: Date.now() - 30 * 86_400_000, toMs: Date.now() + 86_400_000, now: Date.now() });

describe.skipIf(!HAS_DB)("Clients ignoring leads", () => {
  beforeAll(async () => {
    try { await sql()`select dnd from cached_contacts limit 1`; await sql()`select automated from touch_events limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'Ig Agency A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'Ig Agency B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${instA}, ${A1}, 'zzIg Client A1', 'UTC'), (${instB}, ${B1}, 'zzIg Client B1', 'UTC')`;
    // Company A: one new lead nobody answered, one answered by a person, one who is DND, a customer with no reply, one with only an automatic reply, one with a person's reply, one missed call.
    await contact(instA, A1, "ig-never", { name: "Nina", created: 3 });
    await contact(instA, A1, "ig-answered", { name: "Aria", created: 3 });
    await touch(instA, A1, "ig-answered", { dir: "outbound", days: 2.9 });
    await contact(instA, A1, "ig-dnd", { name: "Dora", created: 3, dnd: true });
    await contact(instA, A1, "ig-nobody", { name: "Nora", created: 40 });
    await touch(instA, A1, "ig-nobody", { dir: "inbound", days: 2 });
    await contact(instA, A1, "ig-auto", { name: "Auto", created: 40 });
    await touch(instA, A1, "ig-auto", { dir: "inbound", days: 2 });
    await touch(instA, A1, "ig-auto", { dir: "outbound", days: 1.99, auto: true });
    await contact(instA, A1, "ig-human", { name: "Hugo", created: 40 });
    await touch(instA, A1, "ig-human", { dir: "inbound", days: 2 });
    await touch(instA, A1, "ig-human", { dir: "outbound", days: 1.9 });
    await contact(instA, A1, "ig-missed", { name: "Mia", created: 40, conversation: false });
    await touch(instA, A1, "ig-missed", { dir: "inbound", kind: "missed_call", days: 2 });
    // Company B has its own ignored lead.
    await contact(instB, B1, "ig-b-never", { name: "Zeb", created: 3 });
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("splits people by reason; an automatic reply is not an answer; a person who asked not to be contacted is left out", async () => {
    if (!ready) return;
    const [a] = await ignoredByAccount(scope(instA, null));
    expect(a.locationId).toBe(A1);
    expect({ people: a.people, never: a.never, replyNobody: a.replyNobody, replyAuto: a.replyAuto, missed: a.missed }).toEqual({ people: 4, never: 1, replyNobody: 1, replyAuto: 1, missed: 1 });
    expect(a.oldestAt).not.toBeNull();
    expect(a.dollars).toBe(0); // no deals: unpriced, never an invented figure
    expect(a.unpriced).toBe(4);
  });

  it("every count equals the rows behind it", async () => {
    if (!ready) return;
    const [a] = await ignoredByAccount(scope(instA, null));
    const rows = async (reason: "all" | "never" | "reply_nobody" | "reply_auto" | "missed") => ignoredPage(scope(instA, null), { reason, account: null, page: 0, size: 50 });
    expect((await rows("all")).total).toBe(a.people);
    expect((await rows("never")).total).toBe(a.never);
    expect((await rows("reply_nobody")).total).toBe(a.replyNobody);
    expect((await rows("reply_auto")).total).toBe(a.replyAuto);
    expect((await rows("missed")).total).toBe(a.missed);
    const all = await rows("all");
    expect(all.rows.length).toBe(a.people);
    expect(all.rows.map((r) => r.contactId).sort()).toEqual(["ig-auto", "ig-missed", "ig-never", "ig-nobody"]);
  });

  it("with 'count automatic messages as a reply' on, the automatic reply stops counting", async () => {
    if (!ready) return;
    await sql()`update settings set count_automated_touches = true where installation_id = ${instA}`;
    try {
      const [a] = await ignoredByAccount(scope(instA, null));
      expect(a.replyAuto).toBe(0);
      expect(a.people).toBe(3);
    } finally { await sql()`update settings set count_automated_touches = false where installation_id = ${instA}`; }
  });

  it("an account's own wait changes who counts", async () => {
    if (!ready) return;
    await sql()`insert into speed_prefs (installation_id, scope, key, value) values (${instA}, ${A1}, 'ignored', ${JSON.stringify({ waitHours: 100 })}::text::jsonb) on conflict (installation_id, scope, key) do update set value = excluded.value`;
    try {
      const [a] = await ignoredByAccount(scope(instA, null));
      expect(a.never).toBe(0); // the lead is 3 days (72 hours) old, under the 100 hours this account allows
      expect(a.replyNobody).toBe(0);
    } finally { await sql()`delete from speed_prefs where installation_id = ${instA} and key = 'ignored'`; }
  });

  it("another company never appears, and asking for its account by id changes nothing", async () => {
    if (!ready) return;
    const own = await get(CO_A, "speed?part=ignored");
    expect(own.status).toBe(200);
    expect(own.body.accounts.map((x: Json) => x.locationId)).toEqual([A1]);
    for (const w of ["zzIg Client B1", "Zeb", B1, "ig-b-never"]) expect(own.text).not.toContain(w);
    const spoof = await get(CO_A, `speed?part=ignored&account=${B1}`);
    expect(spoof.body.accounts ?? []).toEqual([]);
    const list = await get(CO_A, `speed?part=ignored-list&reason=all&account=${B1}`);
    expect(list.body.total).toBe(0);
    expect(list.text).not.toContain("Zeb");
    const mine = await get(CO_A, "speed?part=ignored-list&reason=all");
    expect(mine.body.total).toBe(mine.body.rows.length);
    expect(mine.body.total).toBe(4);
    for (const w of ["Zeb", B1, "zzIg Client B1"]) expect(mine.text).not.toContain(w);
    const other = await get(CO_B, "speed?part=ignored-list&reason=all");
    expect(other.body.rows.map((r: Json) => r.contactId)).toEqual(["ig-b-never"]);
    expect(other.text).not.toContain("Nina");
  });
});
