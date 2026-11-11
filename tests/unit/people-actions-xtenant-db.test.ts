import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant regression for every Team action and report route (slice PB): company A's people ask for company B's account, person, note and batch through every parameter of every
// part, and the other kinds of caller (an account administrator, a client's staff, an agency staff member) ask for what they may not read. Nothing of B may come back (data, name, or
// its id echoed), and B's rows must not change. Skips until the slice PB migration is applied. Tiny `xtest-` fixtures, removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";

const CO_A = "xtest-ppact-a", CO_B = "xtest-ppact-b";
const A1 = "xtestPpActA1", A2 = "xtestPpActA2", B1 = "xtestPpActB1";
const UA1 = "xtestPpUserA1", UA2 = "xtestPpUserA2", UB1 = "xtestPpUserB1";
const CA1 = "xtestPpContactA1", CB1 = "xtestPpContactB1";
const NAME_B = "zzTeam Client B", PERSON_B = "zzTeam Person Bee", LEAD_B = "zzTeam Lead Bee";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Kind = "agency" | "business" | "client";
const session = (company: string, kind: Kind, loc: string | null, userId: string, personRole: "agency_owner" | "agency_admin" | "agency_staff" | "account_admin" | "account_user") =>
  signSession({ companyId: company, userId, role: kind === "client" ? "user" : "admin", userName: "T", demo: false, kind, locationId: loc, personRole });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* csv */ }
  return { status: res.status, text: t, body: parsed };
}
const act = (part: string) => `people3/act/${part}`;

describe.skipIf(!HAS_DB)("team actions cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from coaching_notes limit 1`; await sql()`select 1 from people_write_log limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzTeam A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzTeam B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${instA}, ${A1}, 'zzTeam Client A1', 'UTC'), (${instA}, ${A2}, 'zzTeam Client A2', 'UTC'), (${instB}, ${B1}, ${NAME_B}, 'UTC')`;
    await sql()`insert into location_users (installation_id, location_id, user_id, name) values (${instA}, ${A1}, ${UA1}, 'Ann Alpha'), (${instA}, ${A2}, ${UA2}, 'Al Second'), (${instB}, ${B1}, ${UB1}, ${PERSON_B})`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, assigned_to) values (${instA}, ${A1}, ${CA1}, 'Lead', 'Aye', ${UA1}), (${instB}, ${B1}, ${CB1}, 'zzTeam', 'Lead Bee', ${UB1})`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("reads: another company's account or person is not found on every part, never echoed, and the CSV is guarded the same", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "xtest-boss-a", "agency_owner");
    for (const part of ["meta", "suggest", "log", "away", "proof", "proof-csv", "proof-prefs", "rebalance"]) {
      const r = await call(t, "GET", `${act(part)}?locationId=${B1}&userId=${UB1}`);
      expect(r.status, part).toBe(404);
      for (const leak of [B1, NAME_B, PERSON_B, UB1, CB1]) expect(r.text, `${part} ${leak}`).not.toContain(leak);
    }
    for (const part of ["notes", "targets", "focus"]) {
      const r = await call(t, "GET", `${act(part)}?userId=${UB1}`);
      expect(r.status, part).toBe(404);
      for (const leak of [B1, NAME_B, PERSON_B, UB1]) expect(r.text, `${part} ${leak}`).not.toContain(leak);
      expect((await call(t, "GET", `${act(part)}?userId=${UA1}`)).status, `own ${part}`).toBe(200);
    }
    for (const part of ["away", "log"]) {
      const all = await call(t, "GET", act(part));
      expect(all.status, part).toBe(200);
      for (const leak of [B1, NAME_B, PERSON_B, UB1, CB1]) expect(all.text, `${part} all ${leak}`).not.toContain(leak);
    }
    for (const bad of ["../x", "a'; select 1;--", "x", "", `${A1}/../${B1}`]) {
      expect((await call(t, "GET", `${act("proof-csv")}?locationId=${encodeURIComponent(bad)}`)).status, bad).toBeGreaterThanOrEqual(404);
      expect((await call(t, "GET", `${act("notes")}?userId=${encodeURIComponent(bad)}`)).status, bad).toBeGreaterThanOrEqual(404);
    }
    expect((await call(t, "GET", `${act("proof")}?locationId=${A1}&days=7`)).status).toBe(200);
    expect((await call(t, "GET", `${act("proof")}?locationId=${A1}&days=91`)).status, "more than 90 days is refused").toBe(400);
    const caps = await call(t, "GET", act("caps"));
    expect(caps.status).toBe(200); expect(caps.body.role).toBe("manager");
  });

  it("writes: notes, targets, away marks and proof choices on B's people and accounts change nothing and name nothing", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "xtest-boss-a", "agency_owner");
    const before = async () => ({
      notes: (await sql()`select count(*)::int n from coaching_notes where installation_id = ${instB}`)[0].n,
      targets: (await sql()`select count(*)::int n from user_targets where installation_id = ${instB}`)[0].n,
      away: (await sql()`select count(*)::int n from user_away where installation_id = ${instB}`)[0].n,
      prefs: (await sql()`select count(*)::int n from people_proof_prefs where installation_id = ${instB}`)[0].n,
    });
    const b0 = await before();
    const posts: Array<[string, unknown]> = [
      ["note", { op: "add", userId: UB1, title: "x", body: "y", step: "do" }],
      ["target", { userId: UB1, metric: "reply_minutes", value: 5, step: "do" }],
      ["target", { userId: UA1, metric: "reply_minutes", value: 5, locationId: B1, step: "do" }],
      ["away", { userId: UB1, until: new Date(Date.now() + 86_400_000 * 3).toISOString(), step: "do" }],
      ["away", { userId: UB1, kind: "idle_snooze", hours: 24, step: "do" }],
      ["proof-prefs", { locationId: B1, nameStaff: true, step: "do" }],
    ];
    for (const [part, body] of posts) {
      const r = await call(t, "POST", act(part), body);
      expect(r.status, `${part} ${JSON.stringify(body).slice(0, 40)}`).toBe(404);
      for (const leak of [B1, NAME_B, PERSON_B, UB1]) expect(r.text).not.toContain(leak);
    }
    expect(await before()).toEqual(b0);
  });

  it("notes by id: B cannot read, edit or remove A's note, and a person's note is not shared with a client's staff unless marked", async () => {
    if (!ok) return;
    const boss = session(CO_A, "agency", null, "xtest-boss-a", "agency_owner");
    const priv = await call(boss, "POST", act("note"), { op: "add", userId: UA1, title: "Private chat", body: "Reply slower in the evening", step: "do" });
    expect(priv.status, priv.text).toBe(200);
    const shared = await call(boss, "POST", act("note"), { op: "add", userId: UA1, title: "Shared goal", body: "Aim for 10 minutes", shared: true, step: "do" });
    expect(shared.status, shared.text).toBe(200);
    const bossB = session(CO_B, "agency", null, "xtest-boss-b", "agency_owner");
    for (const op of [{ op: "edit", title: "hacked", step: "do" }, { op: "remove", typed: "DELETE", step: "do" }]) {
      expect((await call(bossB, "POST", act("note"), { ...op, id: priv.body.id })).status).toBe(404);
    }
    expect((await call(bossB, "GET", `${act("notes")}?userId=${UA1}`)).status).toBe(404);
    const [{ n }] = await sql()`select count(*)::int n from coaching_notes where installation_id = ${instA} and removed_at is null and title = 'Private chat'`;
    expect(n).toBe(1);
    // The person reads only what is shared with them, and cannot write.
    const self = session(CO_A, "client", A1, UA1, "account_user");
    const mine = await call(self, "GET", `${act("notes")}?userId=${UA1}`);
    expect(mine.status).toBe(200);
    expect(mine.body.notes.map((x: Json) => x.title)).toEqual(["Shared goal"]);
    expect(mine.text).not.toContain("Private chat");
    expect((await call(self, "POST", act("note"), { op: "add", userId: UA1, title: "x", body: "y", step: "do" })).status).toBe(403);
    // An account administrator never reads the agency's private notes, but reads their own.
    const admin = session(CO_A, "business", A1, "xtest-admin-a1", "account_admin");
    const seen = await call(admin, "GET", `${act("notes")}?userId=${UA1}`);
    expect(seen.status).toBe(200);
    expect(seen.text).not.toContain("Private chat");
    const own = await call(admin, "POST", act("note"), { op: "add", userId: UA1, title: "Admin note", body: "Welcome", step: "do" });
    expect(own.status, own.text).toBe(200);
    expect((await call(admin, "GET", `${act("notes")}?userId=${UA1}`)).body.notes.map((x: Json) => x.title)).toContain("Admin note");
    // The note's title must be typed before it is removed.
    expect((await call(boss, "POST", act("note"), { op: "remove", id: priv.body.id, step: "do", typed: "no" })).status).toBe(422);
    expect((await call(boss, "POST", act("note"), { op: "remove", id: priv.body.id, step: "do", typed: "private chat" })).status).toBe(200);
  });

  it("people outside the caller's accounts, and people asking about others, are refused", async () => {
    if (!ok) return;
    const admin = session(CO_A, "business", A1, "xtest-admin-a1", "account_admin");
    for (const part of ["notes", "targets", "focus"]) expect((await call(admin, "GET", `${act(part)}?userId=${UA2}`)).status, `${part} a person of another account of the same company`).toBe(404);
    expect((await call(admin, "GET", `${act("meta")}?locationId=${A2}`)).status).toBe(404);
    const self = session(CO_A, "client", A1, UA1, "account_user");
    for (const part of ["notes", "targets", "focus"]) {
      expect((await call(self, "GET", `${act(part)}?userId=${UA2}`)).status, `${part} another person`).toBe(404);
      expect((await call(self, "GET", `${act(part)}?userId=${UA1}`)).status, `${part} themself`).toBe(200);
    }
    for (const part of ["meta", "suggest", "log", "away", "proof", "proof-csv", "proof-prefs", "rebalance"]) expect((await call(self, "GET", `${act(part)}?locationId=${A1}&userId=${UA1}`)).status, part).toBe(403);
    const staff = session(CO_A, "agency", null, UA2, "agency_staff");
    expect((await call(staff, "GET", `${act("notes")}?userId=${UA1}`)).status, "agency staff read only themselves").toBe(404);
    expect((await call(staff, "GET", `${act("notes")}?userId=${UA2}`)).status).toBe(200);
    expect((await call(staff, "POST", act("reassign"), { locationId: A1, contactIds: [CA1], toUserId: UA1 })).status).toBe(403);
  });

  it("moving leads: a foreign account, contact or person changes nothing and is never named; an own lead is previewed, protected, logged and put back", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "xtest-boss-a", "agency_owner");
    expect((await call(t, "POST", act("reassign"), { locationId: B1, contactIds: [CB1], toUserId: UB1 })).status).toBe(404);
    expect((await call(t, "POST", act("reassign"), { locationId: B1, contactIds: [CB1], toUserId: UB1, step: "do" })).status).toBe(404);
    // A's account with B's contact id mixed in: counted as unknown, never named.
    const prev = await call(t, "POST", act("reassign"), { locationId: A1, contactIds: [CA1, CB1], toUserId: UA1 });
    expect(prev.status, prev.text).toBe(200);
    expect(prev.text).not.toContain(CB1); expect(prev.text).not.toContain(LEAD_B); expect(prev.text).not.toContain(PERSON_B);
    expect(prev.body.plan.unknown).toBe(1);
    // Only B's contact: not found at all.
    expect((await call(t, "POST", act("reassign"), { locationId: A1, contactIds: [CB1], toUserId: UA1 })).status).toBe(404);
    // A foreign person as the new owner is a blocker (not on this account's team), and nothing is sent.
    const bad = await call(t, "POST", act("reassign"), { locationId: A1, contactIds: [CA1], toUserId: UB1, step: "do" });
    expect(bad.status).toBe(422);
    expect(bad.text).not.toContain(PERSON_B);
    const [b] = await sql()`select assigned_to from cached_contacts where installation_id = ${instB} and contact_id = ${CB1}`;
    expect(b.assigned_to).toBe(UB1);
    // The writing switch is off in tests: a practice run, the log records it, the lead keeps its owner, and the batch cannot be put back (nothing was done).
    await sql()`update cached_contacts set assigned_to = ${UA2} where installation_id = ${instA} and contact_id = ${CA1}`;
    await sql()`insert into location_users (installation_id, location_id, user_id, name) values (${instA}, ${A1}, ${UA2}, 'Al Second') on conflict do nothing`;
    const run = await call(t, "POST", act("reassign"), { locationId: A1, contactIds: [CA1], toUserId: UA1, step: "do" });
    expect(run.status, run.text).toBe(200);
    expect(run.body.dryRun).toBe(1); expect(run.body.done).toBe(0);
    const [a] = await sql()`select assigned_to from cached_contacts where installation_id = ${instA} and contact_id = ${CA1}`;
    expect(a.assigned_to).toBe(UA2);
    const logged = await sql()`select result, location_id from people_write_log where installation_id = ${instA} and batch_id = ${run.body.batchId}`;
    expect(logged.length).toBe(1); expect(logged[0].result).toBe("dry_run");
    const none = await sql()`select count(*)::int n from people_write_log where installation_id = ${instB}`;
    expect(none[0].n).toBe(0);
    // B cannot put A's batch back, and A's own undo of a practice run has nothing to put back.
    const tb = session(CO_B, "agency", null, "xtest-boss-b", "agency_owner");
    expect((await call(tb, "POST", act("undo"), { locationId: B1, batchId: run.body.batchId })).status).toBeGreaterThanOrEqual(400);
    expect((await call(t, "POST", act("undo"), { locationId: A1, batchId: run.body.batchId })).status).toBe(410);
    // A lead with an open deal is protected in a batch of two and named with a reason.
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, assigned_to, dnd) values (${instA}, ${A1}, 'xtestPpContactA2', 'Dnd', 'Person', ${UA2}, true) on conflict do nothing`;
    const batch = await call(t, "POST", act("reassign"), { locationId: A1, contactIds: [CA1, "xtestPpContactA2"], toUserId: UA1 });
    expect(batch.body.plan.protected.length).toBe(1); expect(batch.body.plan.change.length).toBe(1);
  });

  it("targets, away marks and the receipt work for one's own people, with typed confirmation to clear, and end by their own id only", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "xtest-boss-a", "agency_owner");
    const prev = await call(t, "POST", act("target"), { userId: UA1, metric: "reply_minutes", value: 10, locationId: A1 });
    expect(prev.status, prev.text).toBe(200); expect(prev.body.preview.changes[0].to).toBe("10 minutes");
    expect((await call(t, "POST", act("target"), { userId: UA1, metric: "reply_minutes", value: 10, locationId: A1, step: "do" })).status).toBe(200);
    expect((await call(t, "GET", `${act("targets")}?userId=${UA1}`)).body.targets.length).toBe(1);
    expect((await call(t, "POST", act("target"), { userId: UA1, metric: "reply_minutes", value: null, locationId: A1, step: "do", typed: "nope" })).status).toBe(422);
    expect((await call(t, "POST", act("target"), { userId: UA1, metric: "reply_minutes", value: null, locationId: A1, step: "do", typed: "DELETE" })).status).toBe(200);
    const away = await call(t, "POST", act("away"), { userId: UA1, until: new Date(Date.now() + 86_400_000 * 2).toISOString(), reason: "holiday", step: "do" });
    expect(away.status, away.text).toBe(200);
    expect((await call(t, "GET", act("away"))).body.marks.length).toBe(1);
    const tb = session(CO_B, "agency", null, "xtest-boss-b", "agency_owner");
    expect((await call(tb, "POST", act("away-end"), { id: away.body.id })).status).toBe(404);
    expect((await call(t, "POST", act("away-end"), { id: away.body.id })).status).toBe(200);
    expect((await call(t, "GET", act("away"))).body.marks.length).toBe(0);
    const proof = await call(t, "GET", `${act("proof")}?locationId=${A1}&days=7`);
    expect(proof.status).toBe(200); expect(proof.body.proof.named).toBe(false);
    const csv = await call(t, "GET", `${act("proof-csv")}?locationId=${A1}&days=30`);
    expect(csv.status).toBe(200); expect(csv.text.startsWith("Receipt,")).toBe(true);
  });
});
