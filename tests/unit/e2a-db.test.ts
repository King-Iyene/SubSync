import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { purgeInstallation } from "@/lib/ghl/installations";
import { handleFathomDelivery, type HookDeps } from "@/lib/connections/fathom-hook";
import { alwaysIgnore, confirmAndRelease, dismissMeeting, findContacts, linkMeeting } from "@/lib/connections/inbox";
import { pgInboxStore } from "@/lib/connections/inbox-store";
import { crmWriter, findHookConnection, pgDeliveryStore, pgIngestStore } from "@/lib/connections/ingest-store";
import { runMeetingMaintenance } from "@/lib/connections/maintenance";
import { pgRefreshStore, saveConnection } from "@/lib/connections/personal";
import { refreshLocked } from "@/lib/connections/refresh";
import type { Person } from "@/lib/connections/person";
import { refreshTokens } from "@/lib/connections/oauth";
import { fathomPayload, sign, TEST_SECRET } from "./e2a-support";

// Stage E2a against the REAL database (written overnight in parallel mode, NOT RUN there: the lead runs it after the merge).
// Fixture companies only: no real token, no refresh token the production scheduler could pick up, everything deleted afterwards (deleting the
// installation cascades to every table). Nothing talks to Fathom or the CRM: the CRM client is the dry-run client (WRITE_GHL_LIVE off), the Fathom
// token endpoint is a fake, and the delivery payloads are signed with a TEST secret.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO = "xtest-e2a-co";
const CO_B = "xtest-e2a-co-b";
const LA = "xtestE2aLocA";
const LB = "xtestE2aLocB";
const LX = "xtestE2aLocX";
const KEY = "xte2a-delivery-key-0123456789ab";
let inst = "";
let instB = "";

const admin: Person = { companyKey: CO, userId: "xte2a-admin", name: "Rep Seller", role: "agency_admin", kind: "agency", homeLocationId: null };
const staff: Person = { companyKey: CO, userId: "xte2a-staff", name: "Staff", role: "account_user", kind: "client", homeLocationId: LA };
const intruder: Person = { companyKey: CO, userId: "xte2a-intruder", name: "Intruder", role: "agency_owner", kind: "agency", homeLocationId: null };

const connect = (p: Person, installationId: string, key: string | null) =>
  saveConnection({
    person: p, installationId, provider: "fathom", tokens: { accessToken: "xt-access", refreshToken: "xt-refresh", expiresAt: Date.now() + 3_600_000 }, accountEmail: null,
    hook: key ? { id: "xt-hook", secret: TEST_SECRET } : null, publicKey: key,
  });

function deps(): HookDeps {
  return { enabled: async () => true, find: (k) => findHookConnection(k), store: pgIngestStore(), deliveries: pgDeliveryStore(), write: (c) => crmWriter(c.person.companyKey) };
}
const deliver = (payload: unknown, id: string) => {
  const body = JSON.stringify(payload);
  const s = sign(body, id, Math.floor(Date.now() / 1000));
  return handleFathomDelivery({ key: KEY, headers: { id: s.id, timestamp: s.timestamp, signature: s.signature }, body }, deps());
};
const wouldWrites = async () => (await sql()`select detail from audit_log where installation_id = ${inst} and action = 'dry_run.would_write'`).map((r) => r.detail as { ids: Record<string, string> });

describe.skipIf(!HAS_DB)("Fathom per user against the real database (stage E2a)", () => {
  beforeAll(async () => {
    vi.stubEnv("FATHOM_CLIENT_ID", "fixture-id");
    vi.stubEnv("FATHOM_CLIENT_SECRET", "fixture-secret");
    vi.stubEnv("WRITE_GHL_LIVE", "false");
    for (const co of [CO, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: inst }] = await sql()`insert into installations (company_id, company_name, plan, scope) values (${CO}, 'zzE2a A', 'pro', 'contacts.write users.readonly') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzE2a B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const [i, loc, name] of [[inst, LA, "zzE2a Client A"], [inst, LB, "zzE2a Client B"], [instB, LX, "zzE2a Client X"]]) await sql()`insert into locations (installation_id, location_id, name) values (${i}, ${loc}, ${name})`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added) values (${inst}, ${LB}, 'xte2a-lee', 'Lee', 'Client', 'lee@client.test', '{}', now())`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added) values (${inst}, ${LA}, 'xte2a-pat', 'Pat', 'Own', 'pat@own.test', '{}', now())`;
    // A contact with the same email in ANOTHER company: it must never be seen.
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added) values (${instB}, ${LX}, 'xte2a-x', 'Lee', 'Other', 'lee@client.test', '{}', now())`;
    await sql()`insert into meeting_note_settings (installation_id, ghl_user_id, preview_confirmed_at) values (${inst}, ${admin.userId}, now())`;
  });
  afterEach(async () => {
    for (const t of ["meeting_deliveries", "meetings", "crm_writes", "meeting_ignored_emails"]) await sql().unsafe(`delete from ${t} where installation_id in ('${inst}', '${instB}')`);
    await sql()`delete from audit_log where installation_id in (${inst}, ${instB}) and action like 'dry_run.%'`;
    await sql()`delete from user_connections where installation_id in (${inst}, ${instB})`;
    await sql()`update meeting_note_settings set preview_confirmed_at = now(), unmatched_mode = 'inbox', master_switch = true where installation_id = ${inst}`;
  });
  afterAll(async () => { vi.unstubAllEnvs(); for (const co of [CO, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("ACCEPTANCE: a signed delivery writes a meetings row; three simultaneous deliveries of the same webhook leave exactly one meeting, one claimed delivery and one WOULD WRITE line", async () => {
    await connect(admin, inst, KEY);
    const answers = await Promise.all([deliver(fathomPayload(), "msg_1"), deliver(fathomPayload(), "msg_1"), deliver(fathomPayload(), "msg_1")]);
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(answers.filter((a) => a.body.result === "written")).toHaveLength(1);
    expect((await sql()`select count(*)::int n from meetings where installation_id = ${inst}`)[0].n).toBe(1);
    expect((await sql()`select count(*)::int n from meeting_deliveries where installation_id = ${inst}`)[0].n).toBe(1);
    expect((await wouldWrites())).toHaveLength(1);
    const [m] = await sql()`select owner_ghl_user_id, status, reason, summary, transcript_ref from meetings where installation_id = ${inst}`;
    expect(m).toMatchObject({ owner_ghl_user_id: admin.userId, status: "dry_run", reason: "WOULD WRITE", transcript_ref: null });
    // The same recording under a NEW delivery id is still one meeting.
    expect((await deliver(fathomPayload(), "msg_2")).body).toEqual({ ok: true, result: "duplicate" });
    expect((await sql()`select count(*)::int n from meetings where installation_id = ${inst}`)[0].n).toBe(1);
    expect(await wouldWrites()).toHaveLength(1);
  });

  it("the contact with the same email in ANOTHER company is never matched or read", async () => {
    await connect(admin, inst, KEY);
    await deliver(fathomPayload(), "msg_1");
    const w = await wouldWrites();
    expect(w).toHaveLength(1);
    expect(w[0].ids).toMatchObject({ locationId: LB, contactId: "xte2a-lee" });
  });

  it("a call nobody matches waits in the inbox with an expiry, and two attendees at two contacts give two WOULD WRITE lines", async () => {
    await connect(admin, inst, KEY);
    await deliver(fathomPayload({ recording_id: 1 }, [{ name: "Nobody", email: "nobody@nowhere.test", is_external: true }]), "msg_a");
    const [row] = await sql()`select status, reason, expires_at from meetings where installation_id = ${inst} and provider_meeting_id = '1'`;
    expect(row).toMatchObject({ status: "needs_contact", reason: "no_match" });
    expect(row.expires_at.getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    await deliver(fathomPayload({ recording_id: 2 }, [{ name: "Lee", email: "lee@client.test", is_external: true }, { name: "Pat", email: "pat@own.test", is_external: true }]), "msg_b");
    expect((await wouldWrites()).map((w) => w.ids.contactId).sort()).toEqual(["xte2a-lee", "xte2a-pat"]);
  });

  it("a duplicate-contact case lands in the inbox", async () => {
    await connect(admin, inst, KEY);
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added) values (${inst}, ${LB}, 'xte2a-lee-dup', 'Lee', 'Dup', 'lee@client.test', '{}', now())`;
    await deliver(fathomPayload(), "msg_1");
    expect((await sql()`select status, reason from meetings where installation_id = ${inst}`)[0]).toMatchObject({ status: "needs_contact", reason: "duplicate_contact" });
    expect(await wouldWrites()).toEqual([]);
    await sql()`delete from cached_contacts where installation_id = ${inst} and contact_id = 'xte2a-lee-dup'`;
  });

  it("the inbox is private: another person sees, links, dismisses and ignores nothing of it, and a client's staff member cannot link into an account they cannot open", async () => {
    await connect(admin, inst, KEY);
    await deliver(fathomPayload({ recording_id: 5 }, [{ name: "Nobody", email: "nobody@nowhere.test", is_external: true }]), "msg_5");
    const [{ id }] = await sql()`select id from meetings where installation_id = ${inst}` as unknown as Array<{ id: string }>;
    const store = pgInboxStore();
    const dry = crmWriter(CO);
    expect(await store.listWaiting(inst, intruder.userId)).toEqual([]);
    expect(await store.getMeeting(inst, intruder.userId, id)).toBeNull();
    expect(await linkMeeting(store, intruder, inst, id, { locationId: LB, contactId: "xte2a-lee" }, dry)).toMatchObject({ ok: false, code: "not_found" });
    expect(await dismissMeeting(store, intruder, inst, id)).toBe(false);
    expect(await alwaysIgnore(store, intruder, inst, id, "nobody@nowhere.test")).toBe(false);
    expect(await linkMeeting(store, admin, instB, id, { locationId: LX, contactId: "xte2a-x" }, dry), "another company's installation finds nothing").toMatchObject({ ok: false, code: "not_found" });
    expect((await sql()`select status from meetings where id = ${id}`)[0].status).toBe("needs_contact");
    // A client's staff member searches only their own account.
    expect((await findContacts(store, staff, inst, "lee", null))).toEqual([]);
    expect((await findContacts(store, admin, inst, "lee", null)).map((h) => h.contactId)).toEqual(["xte2a-lee"]);
  });

  it("Link writes the note through the dry-run client, handles the call, and Dismiss and Always ignore remove its text", async () => {
    await connect(admin, inst, KEY);
    await deliver(fathomPayload({ recording_id: 6 }, [{ name: "Nobody", email: "nobody@nowhere.test", is_external: true }]), "msg_6");
    await deliver(fathomPayload({ recording_id: 7 }, [{ name: "Other", email: "other@nowhere.test", is_external: true }]), "msg_7");
    await deliver(fathomPayload({ recording_id: 8 }, [{ name: "Third", email: "third@nowhere.test", is_external: true }]), "msg_8");
    const rows = await sql()`select id, provider_meeting_id from meetings where installation_id = ${inst} order by provider_meeting_id` as unknown as Array<{ id: string; provider_meeting_id: string }>;
    const store = pgInboxStore();
    const linked = await linkMeeting(store, admin, inst, rows[0].id, { locationId: LB, contactId: "xte2a-lee" }, crmWriter(CO));
    expect(linked).toEqual({ ok: true, dryRun: true, notes: 0 });
    expect((await sql()`select status, reason from meetings where id = ${rows[0].id}`)[0]).toMatchObject({ status: "dry_run", reason: "WOULD WRITE" });
    expect(await dismissMeeting(store, admin, inst, rows[1].id)).toBe(true);
    expect(await alwaysIgnore(store, admin, inst, rows[2].id, "third@nowhere.test")).toBe(true);
    const gone = await sql()`select title, summary, attendee_emails, action_items, recording_url, status, reason from meetings where id in (${rows[1].id}, ${rows[2].id}) order by provider_meeting_id`;
    for (const g of gone) expect(g).toMatchObject({ title: null, summary: null, attendee_emails: [], action_items: [], recording_url: null, status: "skipped" });
    expect((await sql()`select email from meeting_ignored_emails where installation_id = ${inst}`).map((r) => r.email)).toEqual(["third@nowhere.test"]);
  });

  it("the first-save preview holds a call, and confirming releases it once even when two confirms race", async () => {
    await connect(admin, inst, KEY);
    await sql()`update meeting_note_settings set preview_confirmed_at = null where installation_id = ${inst}`;
    expect((await deliver(fathomPayload(), "msg_1")).body).toEqual({ ok: true, result: "kept" });
    expect(await wouldWrites()).toEqual([]);
    const store = pgInboxStore();
    const [a, b] = await Promise.all([confirmAndRelease(store, admin, inst, crmWriter(CO)), confirmAndRelease(store, admin, inst, crmWriter(CO))]);
    expect(a.released + b.released).toBe(1);
    expect(await wouldWrites()).toHaveLength(1);
  });

  it("Needs permission: without the permission to edit contacts the call waits and nothing is planned", async () => {
    await connect(admin, inst, KEY);
    await sql()`update installations set scope = 'users.readonly' where id = ${inst}`;
    await deliver(fathomPayload(), "msg_1");
    expect((await sql()`select status, reason from meetings where installation_id = ${inst}`)[0]).toMatchObject({ status: "needs_contact", reason: "needs_permission" });
    expect(await wouldWrites()).toEqual([]);
    await sql()`update installations set scope = 'contacts.write users.readonly' where id = ${inst}`;
  });

  it("a revoked or disconnected address answers 404 and stores nothing", async () => {
    const saved = await connect(admin, inst, KEY);
    await sql()`update user_connections set status = 'revoked', webhook_secret_enc = null, public_key = null where id = ${saved.id}`;
    expect((await deliver(fathomPayload(), "msg_1")).status).toBe(404);
    expect((await sql()`select count(*)::int n from meetings where installation_id = ${inst}`)[0].n).toBe(0);
  });

  it("a forced and a concurrent token refresh both work against the real row lock (fake Fathom, single-use refresh tokens)", async () => {
    const saved = await connect(admin, inst, KEY);
    await sql()`update user_connections set access_token_enc = ${encryptSecret("A1")}, refresh_token_enc = ${encryptSecret("R1")}, token_expires_at = now() + interval '1 hour' where id = ${saved.id}`;
    let valid = "R1";
    let calls = 0;
    const fake = (async (_u: string, init: RequestInit) => {
      const p = new URLSearchParams(String(init.body));
      await new Promise((r) => setTimeout(r, 20));
      if (p.get("refresh_token") !== valid) return new Response("{}", { status: 400 });
      calls++;
      valid = `R${calls + 1}`;
      return new Response(JSON.stringify({ access_token: `A${calls + 1}`, refresh_token: valid, expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const refresh = async (rt: string) => { const r = await refreshTokens("fathom", rt, { clientId: "i", clientSecret: "s" }, fake); return r.ok ? { ok: true as const, tokens: r.tokens } : { ok: false as const }; };
    const store = pgRefreshStore();
    const results = await Promise.all([refreshLocked(store, saved.id, refresh, Date.now, "A1"), refreshLocked(store, saved.id, refresh, Date.now, "A1"), refreshLocked(store, saved.id, refresh, Date.now, "A1")]);
    expect(results.every((r) => r.ok && r.accessToken === "A2")).toBe(true);
    expect(calls).toBe(1);
    // Expired and concurrent: one more refresh, shared by all.
    await sql()`update user_connections set token_expires_at = now() - interval '1 minute' where id = ${saved.id}`;
    const again = await Promise.all([refreshLocked(store, saved.id, refresh), refreshLocked(store, saved.id, refresh)]);
    expect(again.every((r) => r.ok && r.accessToken === "A3")).toBe(true);
    expect(calls).toBe(2);
  });

  it("the off switch and uninstall delete everything: tokens, deliveries, calls, ignored emails and settings", async () => {
    await connect(admin, inst, KEY);
    await deliver(fathomPayload(), "msg_1");
    await sql()`insert into meeting_ignored_emails (installation_id, ghl_user_id, email) values (${inst}, ${admin.userId}, 'x@y.test')`;
    await purgeInstallation(inst);
    for (const t of ["user_connections", "meetings", "meeting_deliveries", "meeting_ignored_emails", "meeting_note_settings", "crm_writes"]) {
      expect((await sql().unsafe(`select count(*)::int n from ${t} where installation_id = '${inst}'`))[0].n, t).toBe(0);
    }
  });

  it("the daily clean-up removes calls whose inbox time is up, old handled calls and old delivery ids, and leaves everything else", async () => {
    await connect(admin, inst, KEY);
    const day = 86_400_000;
    await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status, reason, expires_at) values (${inst}, ${admin.userId}, 'fathom', 'old-wait', 'needs_contact', 'no_match', ${new Date(Date.now() - day)})`;
    await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status, reason, expires_at) values (${inst}, ${admin.userId}, 'fathom', 'fresh-wait', 'needs_contact', 'no_match', ${new Date(Date.now() + day)})`;
    await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status, created_at) values (${inst}, ${admin.userId}, 'fathom', 'old-done', 'dry_run', ${new Date(Date.now() - 91 * day)})`;
    await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status, created_at) values (${inst}, ${admin.userId}, 'fathom', 'new-done', 'dry_run', now())`;
    const [{ id: conn }] = await sql()`select id from user_connections where installation_id = ${inst}` as unknown as Array<{ id: string }>;
    await sql()`insert into meeting_deliveries (installation_id, connection_id, webhook_id, created_at) values (${inst}, ${conn}, 'old', ${new Date(Date.now() - 31 * day)}), (${inst}, ${conn}, 'new', now())`;
    // The people step cannot run for this fixture (it has no company token): it must skip, never fail the whole run.
    const result = await runMeetingMaintenance(fetch as typeof fetch);
    expect(result.inboxExpired).toBeGreaterThanOrEqual(1);
    expect((await sql()`select provider_meeting_id from meetings where installation_id = ${inst} order by 1`).map((r) => r.provider_meeting_id)).toEqual(["fresh-wait", "new-done"]);
    expect((await sql()`select webhook_id from meeting_deliveries where installation_id = ${inst}`).map((r) => r.webhook_id)).toEqual(["new"]);
  });

  it("the new tables are closed to the public and signed-in roles", async () => {
    for (const t of ["meeting_deliveries", "meeting_ignored_emails"]) {
      const [r] = await sql()`select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) policies from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = ${t}`;
      expect(r, t).toMatchObject({ rls: true, policies: 0 });
      const [g] = await sql()`select has_table_privilege('anon', ${"public." + t}, 'select') anon, has_table_privilege('authenticated', ${"public." + t}, 'select') authed`;
      expect(g, t).toEqual({ anon: false, authed: false });
    }
  });
});
