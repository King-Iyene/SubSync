import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { forgetQueues, callQueueAll } from "@/lib/analytics/call-queries";
import { goingCold, listSavedLists, removeList, saveList, searchPeople, tagDetail, timed } from "@/lib/analytics/people-list-queries";
import { leadExtras } from "@/lib/analytics/people-detail";
import { diffTagEvents } from "@/lib/sync/tag-events";
import { isQueryTimeout } from "@/lib/people/helpers";
import { closeDb, sql } from "@/lib/db";

// People and Call lists on a golden dataset, on the real database with a fixture company (two accounts) removed afterwards. WRITTEN FOR THE LEAD TO RUN (stage F10 was
// built in parallel mode, where database-backed tests are not run). The fixture has no refresh token that the production cron could pick up (its tokens are junk).
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-people-co";
const A = "xtestPplA";
const B = "xtestPplB";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let inst = "";
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const today = () => new Date().toISOString().slice(0, 10);

async function contact(loc: string, id: string, o: { tags?: string[]; owner?: string | null; source?: string | null; active?: Date | null; added?: Date; dnd?: boolean; phone?: string | null } = {}) {
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, source, assigned_to, date_added, last_activity_at, dnd)
    values (${inst}, ${loc}, ${id}, 'Golden', ${id}, ${id + "@example.test"}, ${o.phone === undefined ? "5550100" : o.phone}, ${o.tags ?? []}::text[], ${o.source ?? null}, ${o.owner ?? null}, ${o.added ?? ago(100)}, ${o.active === undefined ? ago(100) : o.active}, ${o.dnd ?? false})`;
}
const tagEvent = (loc: string, id: string, tag: string, kind: "added" | "removed", at: Date) => sql()`insert into contact_tag_events (installation_id, location_id, contact_id, tag, kind, at) values (${inst}, ${loc}, ${id}, ${tag}, ${kind}, ${at})`;
const ids = async (f: Parameters<typeof searchPeople>[2], allowed: string[] | null = null, cold: string[] = []) => (await searchPeople(inst, allowed, f, 1, cold)).rows.map((r) => r.contactId).sort();

describe.skipIf(!HAS_DB)("People: filters, scoping, tags, going cold, saved lists, timeout", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzPeople', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${inst}, ${A}, 'People fixture A', 'America/New_York'), (${inst}, ${B}, 'People fixture B', 'Europe/London')`;
    await contact(A, "vip1", { tags: ["vip", "web"], owner: "userSam", source: "Facebook", active: ago(2) });
    await contact(A, "vip2", { tags: ["vip"], owner: null, source: null, active: ago(60) });
    await contact(A, "cold1", { tags: ["bought list"], active: ago(300), phone: null });
    await contact(A, "dnd1", { tags: ["vip"], dnd: true, active: ago(5) });
    await contact(B, "other1", { tags: ["vip"], owner: "userSam", source: "Facebook", active: ago(1) });
    await contact(B, "other2", { tags: [], active: ago(1) });
    // tag history: vip1 and vip2 and dnd1 were seen tagged today, other1 yesterday; one contact lost the tag.
    await tagEvent(A, "vip1", "vip", "added", new Date()); await tagEvent(A, "vip2", "vip", "added", new Date()); await tagEvent(A, "dnd1", "vip", "added", new Date());
    await tagEvent(B, "other1", "vip", "added", ago(1)); await tagEvent(A, "gone", "vip", "added", new Date()); await tagEvent(A, "gone", "vip", "removed", new Date());
    // a signal for going cold: vip2 wrote last 120 days ago (engaged, then quiet); vip1 wrote yesterday (recent)
    await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
      values (${inst}, ${A}, 'cv1', 'vip2', 'Golden vip2', 'TYPE_SMS', 'inbound', ${ago(120)}, 0), (${inst}, ${A}, 'cv2', 'vip1', 'Golden vip1', 'TYPE_SMS', 'inbound', ${ago(1)}, 0)`;
    await sql()`insert into call_outcomes (installation_id, location_id, contact_id, outcome, created_at) values (${inst}, ${A}, 'vip1', 'no_answer', ${ago(1)}), (${inst}, ${A}, 'vip1', 'voicemail', ${ago(0.75)})`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("each filter narrows the list by its own rule", async () => {
    expect(await ids({ tags: ["vip"] })).toEqual(["dnd1", "other1", "vip1", "vip2"]);
    expect(await ids({ tags: ["vip"], hideDnd: true })).toEqual(["other1", "vip1", "vip2"]);
    expect(await ids({ tags: ["vip", "web"], tagMode: "all" })).toEqual(["vip1"]);
    expect(await ids({ notTag: "vip", location: A })).toEqual(["cold1"]);
    expect(await ids({ owner: "none", location: A })).toEqual(["cold1", "dnd1", "vip2"]);
    expect(await ids({ owner: "userSam" })).toEqual(["other1", "vip1"]);
    expect(await ids({ source: "facebook" })).toEqual(["other1", "vip1"]);
    expect(await ids({ source: "none", location: A })).toEqual(["cold1", "dnd1", "vip2"]);
    expect(await ids({ quietDays: 30, location: A })).toEqual(["cold1", "vip2"]);
    expect(await ids({ hasPhone: true, location: A })).toEqual(["dnd1", "vip1", "vip2"]);
    expect(await ids({ lastCall: "never", location: A })).toEqual(["cold1", "dnd1", "vip2"]);
    expect(await ids({ q: "vip2" })).toEqual(["vip2"]);
    expect(await ids({ cold: "cold" }, null, ["bought list"])).toEqual(["cold1"]);
    expect(await ids({ cold: "working", location: A }, null, ["bought list"])).toEqual(["dnd1", "vip1", "vip2"]);
  });

  it("the call columns count what was logged from SubSync", async () => {
    const r = (await searchPeople(inst, null, { q: "vip1" }, 1, [])).rows[0];
    expect(r.calls).toBe(2);
    expect(r.lastResult).toBe("voicemail");
    expect(r.lastCallAt).not.toBeNull();
  });

  it("a person limited to one account never gets another account's people, even with that account named", async () => {
    expect(await ids({}, [A])).toEqual(["cold1", "dnd1", "vip1", "vip2"]);
    expect(await ids({ location: B }, [A])).toEqual([]);
    expect(await ids({ tags: ["vip"] }, [B])).toEqual(["other1"]);
    expect(await leadExtras(inst, [A], B, "other1")).toBeNull();
    expect(await leadExtras(inst, [B], B, "other1")).not.toBeNull();
    expect((await goingCold(inst, [A], "quiet", [], 1)).rows.every((r) => r.locationId === A)).toBe(true);
  });

  it("the tag chart: the count on a day is exactly the people in its list, and a Search with the same tag and day finds the same people", async () => {
    const d = await tagDetail(inst, null, "vip", ago(5).toISOString().slice(0, 10), today());
    const day = d.days.find((x) => x.day === today());
    expect(day?.count).toBe(3); // vip1, vip2, dnd1 (gone no longer carries the tag; other1 was yesterday)
    expect(day?.members.map((m) => m.contactId).sort()).toEqual(["dnd1", "vip1", "vip2"]);
    const search = await ids({ tags: ["vip"], seenFrom: today(), seenTo: today() });
    expect(search).toEqual(day?.members.map((m) => m.contactId).sort());
    expect(d.tagged).toBe(d.days.reduce((s, x) => s + x.count, 0));
    expect(d.removedInWindow).toBe(1);
    expect(d.since).not.toBeNull();
  });

  it("going cold: engaged-then-quiet, seen recently and nothing seen add up to the working leads", async () => {
    const [q, rec, none] = await Promise.all((["quiet", "recent", "none"] as const).map((b) => goingCold(inst, [A], b, ["bought list"], 1)));
    expect(q.rows.map((r) => r.contactId)).toEqual(["vip2"]);
    expect(rec.rows.map((r) => r.contactId)).toEqual(["vip1"]);
    expect(none.rows.map((r) => r.contactId)).toEqual(["dnd1"]);
    expect(q.total + rec.total + none.total).toBe(3); // 4 contacts in A, one is on the cold list
  });

  it("saved lists are per person, shared lists per company, and nobody else can read or remove them", async () => {
    expect(await saveList(inst, "agency:agency:u1", "team:agency", false, "Mine", { tags: ["vip"] })).toBe("saved");
    expect(await saveList(inst, "agency:agency:u2", "team:agency", true, "Everyone", { owner: "none" })).toBe("saved");
    expect(await saveList(inst, "client:" + A + ":c1", null, true, "Not allowed", {})).toBe("no_team");
    const u1 = await listSavedLists(inst, "agency:agency:u1", "team:agency");
    expect(u1.map((l) => `${l.name}:${l.shared}`).sort()).toEqual(["Everyone:true", "Mine:false"]);
    const u2 = await listSavedLists(inst, "agency:agency:u2", "team:agency");
    expect(u2.map((l) => l.name).sort()).toEqual(["Everyone"]);
    const client = await listSavedLists(inst, "client:" + A + ":c1", null);
    expect(client).toEqual([]);
    const mine = u1.find((l) => l.name === "Mine")!;
    expect(await removeList(inst, "agency:agency:u2", "team:agency", mine.id)).toBe(false);
    expect(await removeList(inst, "agency:agency:u1", "team:agency", mine.id)).toBe(true);
    await sql()`delete from saved_views where installation_id = ${inst}`;
  });

  it("a read that runs too long is stopped by the database with the code the API turns into a friendly message", async () => {
    let code: unknown = null;
    try { await timed((tx) => tx`select pg_sleep(2)`, 300); } catch (e) { code = (e as { code?: string }).code; expect(isQueryTimeout(e)).toBe(true); }
    expect(code).toBe("57014");
    // and the connection is fine afterwards, with no limit left behind
    const [r] = await sql()`select current_setting('statement_timeout') t`;
    expect(String(r.t)).not.toBe("300ms");
  });

  it("the call list is cached for a short time, cleared when a call is logged, and rows carry the last call and tries", async () => {
    const first = await callQueueAll(inst, [A], { preset: "custom", tag: "vip", idleDays: 0 });
    expect(first.cached).toBeUndefined();
    expect((await callQueueAll(inst, [A], { preset: "custom", tag: "vip", idleDays: 0 })).cached).toBe(true);
    forgetQueues(inst);
    expect((await callQueueAll(inst, [A], { preset: "custom", tag: "vip", idleDays: 0 })).cached).toBeUndefined();
    const vip1 = first.rows.find((r) => r.contactId === "vip1");
    expect(vip1?.calls).toBe(2);
    expect(vip1?.timeZone).toBe("America/New_York");
  });

  it("the tag diff the sync uses records what the database will hold", () => {
    expect(diffTagEvents([{ contactId: "x", tags: ["vip"] }], new Map([["x", []]]), true)).toEqual([{ contactId: "x", tag: "vip", kind: "added" }]);
  });
});
