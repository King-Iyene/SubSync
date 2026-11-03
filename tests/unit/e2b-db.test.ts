import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import type { AuthContext } from "@/lib/api/auth";
import { policySave } from "@/lib/api/connections-api";
import { meetingInboxView, meetingSettingsSave } from "@/lib/api/meetings-api";
import { meetingSetupAccountView, meetingSetupFieldsSave, meetingSetupFieldsView, meetingSetupPreview, meetingSetupSaveMine, meetingSetupView, type DefinitionsReader } from "@/lib/api/meeting-setup-api";
import { deliverNotes, ingestPersonalMeeting } from "@/lib/connections/ingest";
import { pgIngestStore } from "@/lib/connections/ingest-store";
import { pgInboxStore } from "@/lib/connections/inbox-store";
import { parseFathomDelivery } from "@/lib/connections/fathom";
import { matrixFor } from "@/lib/connections/policy";
import type { PlanTarget } from "@/lib/connections/meeting-plan";
import type { Person } from "@/lib/connections/person";
import { claimPart, hasEnabledMapping, loadFieldMappings, saveFieldMappings, saveMyChoices, withFieldLock } from "@/lib/connections/setup-store";
import { isEchoOfOurWrite } from "@/lib/connections/write-log";
import type { Role } from "@/lib/identity";
import type { Session } from "@/lib/session";
import { decideSource } from "@/lib/connections/source-priority";
import { crm, fathomPayload } from "./e2a-support";

// Stage E2b against a REAL database (a throwaway local one; the migration is applied first). Fixture companies only, deleted afterwards. Nothing here
// talks to the CRM or a meeting tool: the CRM transport is `crm()`'s fake, and the contact-field definitions come from a fake reader.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO_A = "xtest-e2b-co-a";
const CO_B = "xtest-e2b-co-b";
const LA1 = "xtestE2bLocA1";
const LA2 = "xtestE2bLocA2";
const LB1 = "xtestE2bLocB1";
let instA = "";
let instB = "";

const person = (userId: string, role: Role, over: Partial<Person> = {}): Person => {
  const agency = role.startsWith("agency");
  return { companyKey: CO_A, userId, name: `Name ${userId}`, role, kind: agency ? "agency" : "client", homeLocationId: agency ? null : LA1, ...over };
};
const USER = person("xte2b-user", "account_user");
const ADMIN = person("xte2b-admin", "account_admin");
const OTHER_ADMIN = person("xte2b-other-admin", "account_admin", { homeLocationId: LA2 });
const OWNER = person("xte2b-owner", "agency_owner");
const B_ADMIN = person("xte2b-b-admin", "account_admin", { companyKey: CO_B, homeLocationId: LB1 });

function ctxFor(p: Person, inst: string, body?: unknown, method = "GET", query = ""): AuthContext & { request: Request; url: URL } {
  const kind = p.role.startsWith("agency") ? "agency" : "client";
  const limitTo = kind === "agency" ? null : p.homeLocationId;
  const session: Session = { companyId: p.companyKey, userId: p.userId, role: p.role.endsWith("admin") || p.role === "agency_owner" ? "admin" : "user", userName: p.name, demo: false, kind, locationId: limitTo, personRole: p.role, exp: Math.floor(Date.now() / 1000) + 600 };
  return { session, installationId: inst, plan: "pro", demo: false, entitlements: { features: { zoom_meet: false } } as never, kind, limitTo, request: new Request("http://localhost/x", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) }), url: new URL(`http://localhost/x${query}`) };
}

/** A stored connection for a person (the meeting row points at it). Fixture only: no token, no webhook. */
async function connectionFor(p: Person): Promise<string> {
  const [r] = await sql()`insert into user_connections (installation_id, company_key, ghl_user_id, provider, status) values (${instA}, ${p.companyKey}, ${p.userId}, 'fathom', 'connected') on conflict (ghl_user_id, provider) do update set status = 'connected' returning id`;
  return r.id as string;
}

const FIELDS = [
  { id: "FLD_date_0001", name: "Last meeting date", dataType: "DATE" },
  { id: "FLD_next_0001", name: "Next steps", dataType: "TEXT" },
  { id: "FLD_sum_00001", name: "Meeting summary", dataType: "LARGE_TEXT" },
  { id: "FLD_num_00001", name: "Deal size", dataType: "NUMERICAL" },
];
const reader: DefinitionsReader = async () => ({ ok: true, fields: FIELDS });
const unreadable: DefinitionsReader = async () => ({ ok: false, reason: "needs_permission" });

describe.skipIf(!HAS_DB)("meeting notes setup against the real database (stage E2b)", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan, scope) values (${CO_A}, 'zzE2b A', 'pro', 'contacts.write locations/customFields.readonly conversations/message.write') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan, scope) values (${CO_B}, 'zzE2b B', 'pro', 'contacts.write locations/customFields.readonly') returning id` as unknown as Array<{ id: string }>;
    for (const [inst, loc, name] of [[instA, LA1, "zzE2b Client A1"], [instA, LA2, "zzE2b Client A2"], [instB, LB1, "zzE2b Client B1"]]) await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, ${name})`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, email) values (${instA}, ${LA1}, 'xte2bContact1', 'lee@client.test')`;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const t of ["field_write_state", "crm_writes", "meetings", "user_connections", "field_mappings", "meeting_note_settings", "meeting_policies", "audit_log"]) await sql().unsafe(`delete from ${t} where installation_id in ('${instA}', '${instB}')`);
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("the migration is additive and the new tables are closed to the public roles (row level security, no policy)", async () => {
    const rows = await sql()`select c.relname, c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) policies from pg_class c where c.relname in ('field_mappings', 'field_write_state')`;
    expect(rows.map((r) => [r.relname, r.relrowsecurity, r.policies]).sort()).toEqual([["field_mappings", true, 0], ["field_write_state", true, 0]]);
    const cols = (await sql()`select column_name from information_schema.columns where table_name = 'meeting_note_settings' and column_name in ('custom_template', 'preset_chosen')`).map((r) => r.column_name);
    expect(cols.sort()).toEqual(["custom_template", "preset_chosen"]);
  });

  // ---------------- the write log: each part once ----------------

  it("two simultaneous claims of one part give exactly one winner (the write log's unique rule), and a released part can be taken again", async () => {
    const [m] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id) values (${instA}, 'xte2b-u', 'fathom', 'xte2b-m1') returning id`;
    const ref = { installationId: instA, meetingId: m.id as string, locationId: LA1, contactId: "xte2bContact1", kind: "note" as const, partNo: 1, authoredBy: "xte2b-u" };
    const results = await Promise.all(Array.from({ length: 8 }, () => claimPart(ref)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await sql()`select count(*)::int n from crm_writes where meeting_id = ${ref.meetingId}`)[0].n).toBe(1);
    const store = pgIngestStore();
    await store.releasePart!(ref);
    expect(await claimPart(ref)).toBe(true);
    await store.finishPart!(ref, "NOTEabc123");
    expect(await isEchoOfOurWrite(instA, { id: "NOTEabc123" }), "the id the CRM gave it is in the log, so its own webhook is dropped").toBe(true);
    expect(await isEchoOfOurWrite(instB, { id: "NOTEabc123" }), "another company's webhook is not an echo of ours").toBe(false);
  });

  it("a long delivery through the real store writes each part once even when run twice at once, numbered 1 to N in the write log", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const [m] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id) values (${instA}, ${ADMIN.userId}, 'fathom', 'xte2b-m2') returning id`;
    const out = crm();
    const store = pgIngestStore();
    const target: PlanTarget = { locationId: LA1, contactId: "xte2bContact1", email: "lee@client.test", allowed: true, blockedBecause: null, clips: [], template: null, mappings: [], items: matrixFor("recommended", null) };
    const summary = Array.from({ length: 20 }, (_, i) => `Point ${i + 1}. ${"detail ".repeat(36)}`.trim()).join("\n\n");
    const args = {
      conn: { id: "c", installationId: instA, provider: "fathom" as const, person: ADMIN, accountEmail: null }, meetingId: m.id as string, targets: [target], store, write: out.writer, sentToday: 0, capFor: () => 50,
      input: { title: "Kitchen quote", startedAt: "2026-11-02T09:01:00.000Z", durationMinutes: 30, attendeeNames: ["Lee"], rep: "Rep", tool: "Fathom", summary, actionItems: [], recordingUrl: null },
    };
    await Promise.all([deliverNotes(args), deliverNotes(args)]);
    const parts = (await sql()`select part_no, ghl_id from crm_writes where meeting_id = ${m.id as string} and kind = 'note' order by part_no`).map((r) => [r.part_no, r.ghl_id !== null]);
    expect(out.fetched.length).toBeGreaterThan(1);
    expect(parts.map((p) => p[0])).toEqual(out.fetched.map((_, i) => i + 1));
    expect(parts.every((p) => p[1]), "every part has the id the CRM gave it").toBe(true);
    // the daily count is one delivery to one contact, not one per part
    const per = await store.writesToday(instA, ADMIN.userId, [LA1]);
    expect(per.byAccount[LA1]).toBe(1);
  });

  // ---------------- the ordering rule on the real tables ----------------

  it("an older meeting never moves a field's date back, even when two writers arrive out of order; the lock runs them one at a time", async () => {
    const [m1] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id) values (${instA}, 'u', 'fathom', 'xte2b-f1') returning id`;
    const [m2] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id) values (${instA}, 'u', 'fathom', 'xte2b-f2') returning id`;
    const newer = Date.parse("2026-11-05T09:00:00Z");
    const older = Date.parse("2026-11-02T09:00:00Z");
    const order: string[] = [];
    await Promise.all([
      withFieldLock(instA, LA1, "xte2bContact1", async (s) => { order.push("newer-start"); await new Promise((r) => setTimeout(r, 120)); await s.record({ item: "next_steps", meetingStartedAt: newer, meetingId: m1.id as string, partNo: 3, authoredBy: "u" }); order.push("newer-end"); }),
      (async () => { await new Promise((r) => setTimeout(r, 30)); await withFieldLock(instA, LA1, "xte2bContact1", async (s) => { order.push("older-start"); expect((await s.previous(["next_steps"])).next_steps, "the second one sees what the first recorded").toBe(newer); await s.record({ item: "next_steps", meetingStartedAt: older, meetingId: m2.id as string, partNo: 3, authoredBy: "u" }); order.push("older-end"); }); })(),
    ]);
    expect(order).toEqual(["newer-start", "newer-end", "older-start", "older-end"]);
    const [row] = await sql()`select meeting_started_at, meeting_id from field_write_state where installation_id = ${instA} and contact_id = 'xte2bContact1' and item = 'next_steps'`;
    expect(row.meeting_started_at.getTime()).toBe(newer);
    expect(row.meeting_id).toBe(m1.id);
    // the write log has one row per field and meeting (no content, no value)
    expect((await sql()`select count(*)::int n from crm_writes where installation_id = ${instA} and kind = 'field'`)[0].n).toBe(2);
  });

  it("the real store keeps a field's state per account: another company's contact id is a different row", async () => {
    const [m] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id) values (${instA}, 'u', 'fathom', 'xte2b-f9') returning id`;
    await withFieldLock(instA, LA1, "sameContactId", async (s) => s.record({ item: "next_steps", meetingStartedAt: 5, meetingId: m.id as string, partNo: 3, authoredBy: "u" }));
    await withFieldLock(instB, LB1, "sameContactId", async (s) => expect(await s.previous(["next_steps"])).toEqual({}));
  });

  // ---------------- the admin's mapping ----------------

  it("the mapping is saved per account, read back, and an account with no enabled mapping reports none", async () => {
    expect(await hasEnabledMapping(instA, LA1)).toBe(false);
    await saveFieldMappings(instA, LA1, [{ item: "next_steps", customFieldId: "FLD_next_0001", fieldName: "Next steps", fieldType: "text", enabled: true }, { item: "rep", customFieldId: "FLD_sum_00001", fieldName: "Who", fieldType: "large_text", enabled: false }], ADMIN.userId);
    expect(await hasEnabledMapping(instA, LA1)).toBe(true);
    expect(await hasEnabledMapping(instA, LA2), "another account of the same company has none").toBe(false);
    expect(await hasEnabledMapping(instB, LA1), "another company has none").toBe(false);
    const m = await loadFieldMappings(instA, [LA1, LA2]);
    expect(m[LA1].map((x) => [x.item, x.enabled])).toEqual([["next_steps", true], ["rep", false]]);
    expect(m[LA2]).toBeUndefined();
    await saveFieldMappings(instA, LA1, [{ item: "next_steps", customFieldId: null, fieldName: "", fieldType: "text", enabled: false }], ADMIN.userId);
    expect((await loadFieldMappings(instA, [LA1]))[LA1].map((x) => x.item)).toEqual(["rep"]);
  });

  it("only an administrator of that account maps its fields; another account's administrator, another company's administrator and a plain user are refused", async () => {
    const body = { locationId: LA1, acknowledged: true, mappings: [{ item: "next_steps", customFieldId: "FLD_next_0001", enabled: true }] };
    expect((await meetingSetupFieldsSave(ctxFor(USER, instA, body, "PUT"), reader)).status, "a plain user").toBe(403);
    expect((await meetingSetupFieldsSave(ctxFor(OTHER_ADMIN, instA, body, "PUT"), reader)).status, "an administrator of another account").toBe(404);
    expect((await meetingSetupFieldsSave(ctxFor(B_ADMIN, instB, body, "PUT"), reader)).status, "an administrator of another company").toBe(404);
    expect((await meetingSetupFieldsSave(ctxFor(B_ADMIN, instB, { ...body, locationId: LA1 }, "PUT"), reader)).status).toBe(404);
    expect((await sql()`select count(*)::int n from field_mappings`)[0].n).toBe(0);
    expect((await meetingSetupFieldsSave(ctxFor(ADMIN, instA, body, "PUT"), reader)).status).toBe(200);
    expect((await loadFieldMappings(instA, [LA1]))[LA1][0]).toMatchObject({ item: "next_steps", customFieldId: "FLD_next_0001", fieldType: "text", enabled: true });
    expect((await meetingSetupFieldsView(ctxFor(USER, instA), reader)).status).toBe(403);
  });

  it("the type is read from the account, never taken from the request; a wrong type, an unknown field and a missing acknowledgement are refused with plain words", async () => {
    const put = (mappings: unknown[], extra: Record<string, unknown> = {}) => meetingSetupFieldsSave(ctxFor(ADMIN, instA, { locationId: LA1, acknowledged: true, mappings, ...extra }, "PUT"), reader);
    const wrongType = await put([{ item: "next_steps", customFieldId: "FLD_num_00001", enabled: true }]);
    expect(wrongType.status).toBe(400);
    expect((await wrongType.json()).error).toMatch(/Next steps: "Deal size" cannot be used\. This field is not a text field/);
    expect((await put([{ item: "last_meeting_date", customFieldId: "FLD_num_00001", enabled: true }])).status).toBe(400);
    const unknown = await put([{ item: "next_steps", customFieldId: "FLD_nope_00001", enabled: true }]);
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain("not found in this account");
    expect((await put([{ item: "next_steps", customFieldId: "FLD_next_0001", enabled: true }], { acknowledged: false })).status, "the two warnings must be read first").toBe(400);
    expect((await put([{ item: "next_steps", customFieldId: "bad id!", enabled: true }])).status).toBe(400);
    expect((await put([{ item: "not_a_field", customFieldId: "FLD_next_0001", enabled: true }])).status).toBe(400);
    // a date goes into a date field and also into a text field; the type that was saved is the account's own
    expect((await put([{ item: "last_meeting_date", customFieldId: "FLD_date_0001", enabled: true }])).status).toBe(200);
    expect((await loadFieldMappings(instA, [LA1]))[LA1][0].fieldType).toBe("date");
    expect((await meetingSetupFieldsSave(ctxFor(ADMIN, instA, { locationId: LA1, acknowledged: true, mappings: [{ item: "next_steps", customFieldId: "FLD_next_0001", enabled: true }] }, "PUT"), unreadable)).status).toBe(403);
  });

  it("without the permission to read fields, the admin is told in plain words and nothing is saved", async () => {
    await sql()`update installations set scope = 'contacts.write' where id = ${instA}`;
    try {
      const view = await (await meetingSetupFieldsView(ctxFor(ADMIN, instA), reader)).json();
      expect(view.definitions).toMatchObject({ ok: false });
      expect(view.definitions.message).toContain("Needs permission: reconnect");
      const save = await meetingSetupFieldsSave(ctxFor(ADMIN, instA, { locationId: LA1, acknowledged: true, mappings: [{ item: "next_steps", customFieldId: "FLD_next_0001", enabled: true }] }, "PUT"), reader);
      expect(save.status).toBe(403);
      expect(await hasEnabledMapping(instA, LA1)).toBe(false);
    } finally {
      await sql()`update installations set scope = 'contacts.write locations/customFields.readonly conversations/message.write' where id = ${instA}`;
    }
  });

  it("allowing Contact fields for an account needs a mapped field, and removing the last mapping takes the place away again", async () => {
    const put = (flags: unknown) => policySave(ctxFor(ADMIN, instA, { scope: "account", locationId: LA1, flags }, "PUT"));
    const first = await put({ destinations: ["note", "comment", "field"] });
    const f1 = await first.json();
    expect(f1.notes.join(" ")).toContain("Contact fields stay off until a field is mapped");
    expect((await sql()`select flags from meeting_policies where installation_id = ${instA} and scope = 'account'`)[0].flags.destinations).toEqual(["note", "comment"]);
    await meetingSetupFieldsSave(ctxFor(ADMIN, instA, { locationId: LA1, acknowledged: true, mappings: [{ item: "next_steps", customFieldId: "FLD_next_0001", enabled: true }] }, "PUT"), reader);
    await put({ destinations: ["note", "comment", "field"] });
    expect((await sql()`select flags from meeting_policies where installation_id = ${instA} and scope = 'account'`)[0].flags.destinations).toEqual(["note", "comment", "field"]);
    await meetingSetupFieldsSave(ctxFor(ADMIN, instA, { locationId: LA1, mappings: [{ item: "next_steps", customFieldId: null }] }, "PUT"), reader);
    expect((await sql()`select flags from meeting_policies where installation_id = ${instA} and scope = 'account'`)[0].flags.destinations).toEqual(["note", "comment"]);
  });

  // ---------------- locks and defaults, through the API ----------------

  it("a locked setting cannot be changed by a user: Set by your admin, and nothing is saved", async () => {
    await sql()`insert into meeting_policies (installation_id, scope, location_id, flags) values (${instA}, 'account', ${LA1}, ${sql().json({ locked: ["preset", "sourcePriority", "unmatchedMode"], defaults: { preset: "summary_only", unmatchedMode: "discard" } } as never)})`;
    const view = await (await meetingSetupView(ctxFor(USER, instA))).json();
    expect(view.locked).toMatchObject({ preset: true, sourcePriority: true, unmatchedMode: true, destinations: false });
    expect(view.mine.preset, "the user sees the admin's layout, not their own").toBe("summary_only");
    for (const body of [{ preset: "full_record" }, { custom: { summary: "off" } }, { template: "{summary}" }, { sourcePriority: ["zoom", "fathom"] }, { unmatchedMode: "inbox" }]) {
      const res = await meetingSetupSaveMine(ctxFor(USER, instA, body, "PUT"));
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await res.json()).error).toContain("Set by your admin");
    }
    expect((await sql()`select count(*)::int n from meeting_note_settings where installation_id = ${instA}`)[0].n, "nothing was saved").toBe(0);
    // asking for what it already is is not a change
    expect((await meetingSetupSaveMine(ctxFor(USER, instA, { preset: "summary_only", unmatchedMode: "discard" }, "PUT"))).status).toBe(200);
  });

  it("the Meeting inbox choice for calls nobody matches follows the lock too, and the inbox says so", async () => {
    await sql()`insert into meeting_policies (installation_id, scope, location_id, flags) values (${instA}, 'account', ${LA1}, ${sql().json({ locked: ["unmatchedMode"], defaults: { unmatchedMode: "discard" } } as never)})`;
    const refused = await meetingSettingsSave(ctxFor(USER, instA, { unmatchedMode: "inbox" }, "PUT"));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("Set by your admin.");
    expect((await meetingSettingsSave(ctxFor(USER, instA, { unmatchedMode: "discard" }, "PUT"))).status).toBe(200);
    const view = await (await meetingInboxView(ctxFor(USER, instA))).json();
    expect(view.settings).toMatchObject({ unmatchedMode: "discard", unmatchedLocked: true });
    // a person with no lock still chooses freely
    expect((await meetingSettingsSave(ctxFor(B_ADMIN, instB, { unmatchedMode: "discard" }, "PUT"))).status).toBe(200);
  });

  it("the company owner's defaults sit above an account's: a lock set by the company shows the account's admin 'set by your company' and cannot be undone below", async () => {
    // only the company owner may save the company rule
    const body = { scope: "agency", flags: { locked: ["preset"], defaults: { preset: "summary_only" } } };
    expect((await policySave(ctxFor(ADMIN, instA, body, "PUT"))).status, "an account admin cannot").toBe(403);
    expect((await policySave(ctxFor(OWNER, instA, body, "PUT"))).status).toBe(200);
    // the account's admin tries to set their own default and unlock it
    await policySave(ctxFor(ADMIN, instA, { scope: "account", flags: { locked: [], defaults: { preset: "full_record" } } }, "PUT"));
    const view = await (await meetingSetupView(ctxFor(USER, instA))).json();
    expect(view.locked.preset).toBe(true);
    expect(view.mine.preset, "the company's layout wins").toBe("summary_only");
    const account = await (await meetingSetupAccountView(ctxFor(ADMIN, instA))).json();
    expect(account.companyLocked).toContain("preset");
    // the owner's editor is sent the company rule; nobody else is
    const owner = await (await meetingSetupView(ctxFor(OWNER, instA))).json();
    expect(owner.admin.company.defaults.preset).toBe("summary_only");
    expect(owner.admin.companySaved).toBe(true);
    expect((await (await meetingSetupView(ctxFor(ADMIN, instA))).json()).admin.company ?? null).toBeNull();
  });

  it("locking only the table keeps the ready-made layouts open and refuses Custom", async () => {
    await sql()`insert into meeting_policies (installation_id, scope, location_id, flags) values (${instA}, 'account', ${LA1}, ${sql().json({ locked: ["destinations"] } as never)})`;
    expect((await meetingSetupSaveMine(ctxFor(USER, instA, { preset: "custom" }, "PUT"))).status).toBe(409);
    expect((await meetingSetupSaveMine(ctxFor(USER, instA, { preset: "full_record" }, "PUT"))).status).toBe(200);
    expect(await (await meetingSetupView(ctxFor(USER, instA))).json()).toMatchObject({ mine: { preset: "full_record" } });
  });

  it("a user saves their own choices; a layout with an unknown word is refused with the word named; other users and other companies see none of it", async () => {
    const bad = await meetingSetupSaveMine(ctxFor(USER, instA, { preset: "custom", template: "{summary} {nope}" }, "PUT"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("{nope} is not something SubSync can fill in");
    expect((await meetingSetupSaveMine(ctxFor(USER, instA, { preset: "custom", custom: { summary: "comment", action_items: "note", transcript: "evil", recording_link: "off", attendees_and_date: "note" }, template: "Call {title}\n{summary}" }, "PUT"))).status).toBe(200);
    const mine = await (await meetingSetupView(ctxFor(USER, instA))).json();
    expect(mine.mine).toMatchObject({ preset: "custom", chosen: true, template: "Call {title}\n{summary}" });
    expect(mine.mine.custom).toMatchObject({ summary: "comment", action_items: "note" });
    expect(mine.mine.custom.transcript, "a made-up place is replaced by the safe default").toBe("off");
    const [row] = await sql()`select preset, preset_chosen, custom_template from meeting_note_settings where ghl_user_id = ${USER.userId}`;
    expect(row).toMatchObject({ preset: "custom", preset_chosen: true, custom_template: "Call {title}\n{summary}" });
    expect((await (await meetingSetupView(ctxFor(ADMIN, instA))).json()).mine.preset, "another user of the account has their own").toBe("recommended");
    expect((await (await meetingSetupView(ctxFor(B_ADMIN, instB))).json()).mine.preset).toBe("recommended");
    expect((await meetingSetupSaveMine(ctxFor(USER, instA, { preset: "nope" }, "PUT"))).status).toBe(400);
    expect((await meetingSetupSaveMine(ctxFor(USER, instA, {}, "PUT"))).status).toBe(400);
  });

  it("the account setup is for administrators of that account only", async () => {
    expect((await meetingSetupAccountView(ctxFor(USER, instA))).status, "a plain user").toBe(403);
    expect((await meetingSetupAccountView(ctxFor(OTHER_ADMIN, instA, undefined, "GET", `?account=${LA1}`))).status, "another account's administrator").toBe(404);
    expect((await meetingSetupAccountView(ctxFor(B_ADMIN, instB, undefined, "GET", `?account=${LA1}`))).status, "another company").toBe(404);
    const own = await meetingSetupAccountView(ctxFor(ADMIN, instA));
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ locationId: LA1, accountName: "zzE2b Client A1", hasMapping: false });
    // the company owner reaches any account of the company
    expect((await meetingSetupAccountView(ctxFor(OWNER, instA, undefined, "GET", `?account=${LA2}`))).status).toBe(200);
    // the view tells an administrator which accounts they can set up
    const view = await (await meetingSetupView(ctxFor(OWNER, instA))).json();
    expect(view.admin).toMatchObject({ can: true, canSetCompany: true });
    expect(view.admin.accounts.map((a: { locationId: string }) => a.locationId).sort()).toEqual([LA1, LA2]);
    expect((await (await meetingSetupView(ctxFor(USER, instA))).json()).admin).toMatchObject({ can: false, accounts: [] });
  });

  it("the preview shows what a sample call becomes, refuses an unknown word, and never leaves the account's rules", async () => {
    await sql()`insert into meeting_policies (installation_id, scope, location_id, flags) values (${instA}, 'account', ${LA1}, ${sql().json({ destinations: ["note"] } as never)})`;
    const ok = await (await meetingSetupPreview(ctxFor(USER, instA, { preset: "custom", custom: { summary: "comment", action_items: "note", recording_link: "note", attendees_and_date: "note", transcript: "off" }, template: null }, "POST"))).json();
    expect(ok.ok).toBe(true);
    expect(ok.sections.map((s: { label: string }) => s.label)).toEqual(["Contact note"]);
    expect(ok.clips.join(" ")).toContain("conversation comments are not allowed by your admin");
    const bad = await (await meetingSetupPreview(ctxFor(USER, instA, { preset: "custom", template: "{summary} {oops}" }, "POST"))).json();
    expect(bad).toMatchObject({ ok: false });
    expect(bad.problems.join(" ")).toContain("{oops}");
  });

  // ---------------- the full path through the real database ----------------

  it("a Fathom call becomes a note, a comment and a field for a person with a mapping, on the real tables, in test mode first and then live; the transcript never reaches the tables", async () => {
    await sql()`insert into meeting_policies (installation_id, scope, location_id, flags) values (${instA}, 'account', ${LA1}, ${sql().json({ destinations: ["note", "comment", "field"], allowTranscripts: true } as never)})`;
    await saveFieldMappings(instA, LA1, [{ item: "next_steps", customFieldId: "FLD_next_0001", fieldName: "Next steps", fieldType: "text", enabled: true }], ADMIN.userId);
    await saveMyChoices(instA, ADMIN, { preset: "custom", custom: { summary: "comment", action_items: "field", recording_link: "note", attendees_and_date: "note", transcript: "comment" } });
    await sql()`update meeting_note_settings set preview_confirmed_at = now() where ghl_user_id = ${ADMIN.userId}`;
    const conn = { id: await connectionFor(ADMIN), installationId: instA, provider: "fathom" as const, person: ADMIN, accountEmail: null };
    const d = parseFathomDelivery(fathomPayload({ recording_id: 987001 }), { transcript: true })!;
    const store = pgIngestStore();
    const run = (writer: ReturnType<typeof crm>["writer"]) => ingestPersonalMeeting(conn, d.meeting, d.recordingId, store, writer, { rep: d.recordedByName, withNames: d.withNames, transcript: d.transcriptText, callUrl: d.callUrl });

    // test mode (the committed default): planned, nothing sent, nothing claimed
    const dry = crm();
    expect(await run(dry.writer)).toMatchObject({ kind: "written" });
    expect(dry.fetched).toEqual([]);
    expect((await sql()`select count(*)::int n from crm_writes where installation_id = ${instA}`)[0].n).toBe(0);
    expect((await sql()`select count(*)::int n from field_write_state where installation_id = ${instA}`)[0].n).toBe(0);
    expect((await sql()`select status from meetings where installation_id = ${instA}`)[0].status).toBe("dry_run");

    // live (fake transport): a second meeting from the same person
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const live = crm();
    const d2 = parseFathomDelivery(fathomPayload({ recording_id: 987002, recording_start_time: "2026-11-04T09:00:00Z" }), { transcript: true })!;
    expect(await ingestPersonalMeeting(conn, d2.meeting, d2.recordingId, store, live.writer, { rep: d2.recordedByName, withNames: d2.withNames, transcript: d2.transcriptText, callUrl: d2.callUrl })).toMatchObject({ kind: "written" });
    const kinds = live.fetched.map((f) => f.url.replace("https://services.leadconnectorhq.com", ""));
    expect(kinds.sort()).toEqual(["/contacts/xte2bContact1", "/contacts/xte2bContact1/notes", "/conversations/messages", "/conversations/messages"].sort());
    const writes = (await sql()`select kind, part_no from crm_writes where installation_id = ${instA} order by kind, part_no`).map((r) => `${r.kind}:${r.part_no}`);
    expect(writes).toEqual(["comment:1", "comment:2", "field:3", "note:1"]);
    expect((await sql()`select item, meeting_started_at from field_write_state where installation_id = ${instA}`)[0].item).toBe("next_steps");
    // an older meeting arriving afterwards changes no field
    const before = live.fetched.length;
    const d3 = parseFathomDelivery(fathomPayload({ recording_id: 987003, recording_start_time: "2026-11-01T09:00:00Z" }), { transcript: true })!;
    await ingestPersonalMeeting(conn, d3.meeting, d3.recordingId, store, live.writer, { rep: d3.recordedByName, withNames: d3.withNames, transcript: d3.transcriptText, callUrl: d3.callUrl });
    expect(live.fetched.slice(before).filter((f) => f.url.endsWith("/contacts/xte2bContact1")), "the older call wrote no field").toEqual([]);
    // the field's own log line says why, with item names and reasons only
    const [entry] = await sql()`select detail from audit_log where installation_id = ${instA} and action = 'meeting_fields.delivered' order by id desc limit 1`;
    expect(JSON.stringify(entry.detail)).toContain("older_meeting");
    expect(JSON.stringify(entry.detail)).not.toMatch(/Send the quote|fathom\.video/);
    // the transcript was written to the CRM (fake) but is not in any SubSync table
    const stored = JSON.stringify(await sql()`select * from meetings where installation_id = ${instA}`);
    expect(stored).not.toContain("FULL TRANSCRIPT");
    const everyAudit = JSON.stringify(await sql()`select detail from audit_log where installation_id = ${instA}`);
    expect(everyAudit).not.toContain("FULL TRANSCRIPT");
  });

  it("the same meeting from two tools writes one note: the real store finds the other tool's copy and marks the loser a duplicate", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    await saveMyChoices(instA, ADMIN, { preset: "recommended" });
    await sql()`update meeting_note_settings set preview_confirmed_at = now() where ghl_user_id = ${ADMIN.userId}`;
    // a copy recorded by Zoom for the same call, still waiting for a contact
    const [z] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, started_at, attendee_emails, title, status, reason, summary)
      values (${instA}, ${ADMIN.userId}, 'zoom', 'z-1', '2026-11-02T09:01:00Z', ${sql().json(["rep@agency.test", "lee@client.test"] as never)}, 'Kitchen quote', 'needs_contact', 'no_match', 'Zoom summary') returning id`;
    const conn = { id: await connectionFor(ADMIN), installationId: instA, provider: "fathom" as const, person: ADMIN, accountEmail: null };
    const d = parseFathomDelivery(fathomPayload({ recording_id: 987010 }))!;
    const out = crm();
    expect(await ingestPersonalMeeting(conn, d.meeting, d.recordingId, pgIngestStore(), out.writer, { internalEmails: d.internalEmails })).toMatchObject({ kind: "written" });
    expect(out.fetched).toHaveLength(1);
    expect((await sql()`select status, summary, title from meetings where id = ${z.id as string}`)[0]).toMatchObject({ status: "duplicate", summary: null, title: null });
    // a Zoom copy arriving now is a duplicate of the note that is already in the CRM
    const again = await pgInboxStore().recentMeetings!(instA, ADMIN.userId, "2026-11-02T09:01:00Z");
    expect(again.some((m) => m.provider === "fathom" && m.status === "saved")).toBe(true);
    expect(decideSource({ provider: "google_meet", startedAt: "2026-11-02T09:02:00Z", attendeeEmails: ["rep@agency.test", "lee@client.test"], title: "Kitchen quote" }, again, ["fathom", "zoom", "google_meet"], ["rep@agency.test"])).toMatchObject({ action: "duplicate", reason: "already_in_crm" });
  });
});
