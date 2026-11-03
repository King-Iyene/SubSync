import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { purgeInstallation } from "@/lib/ghl/installations";
import type { AuthContext } from "@/lib/api/auth";
import { myConnectionsView, myConnectionStart, policySave, teamConnectionRevoke, teamConnectionsView } from "@/lib/api/connections-api";
import { expireInbox, removeDeactivatedPeople, removePerson, revokeInstallationSubscriptions } from "@/lib/connections/cleanup";
import { ingestPersonalMeeting } from "@/lib/connections/ingest";
import { crmWriter, findPersonalByKey, pgIngestStore } from "@/lib/connections/ingest-store";
import { accessTokenFor, disconnectOwn, listMine, listTeam, pgRefreshStore, revokeByAdmin, saveConnection, secretRowForAdmin, secretRowOf, startPending, SAFE_COLUMNS } from "@/lib/connections/personal";
import { statusScope, type Person } from "@/lib/connections/person";
import { refreshLocked } from "@/lib/connections/refresh";
import { isEchoOfOurWrite, recordCrmWrite } from "@/lib/connections/write-log";
import type { Role } from "@/lib/identity";
import type { Session } from "@/lib/session";
import { hookMeeting } from "../fixtures/meeting-hook";

// Stage E0 against the REAL database (written overnight in parallel mode, NOT RUN there: the lead runs it after the merge).
// Fixture companies only: no tokens, no refresh token (the production scheduler only queues jobs for installs that have one), everything deleted
// afterwards (deleting the installation cascades to every new table). Nothing here talks to a provider or the CRM: the transport is a fake, and the
// CRM writer is the dry-run client.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO_A = "xtest-e0-co-a";
const CO_B = "xtest-e0-co-b";
const LA1 = "xtestE0LocA1";
const LA2 = "xtestE0LocA2";
const LB1 = "xtestE0LocB1";
const SECRET = "fixture-token-value-1234567890";
let instA = "";
let instB = "";

const person = (userId: string, role: Role, over: Partial<Person> = {}): Person => {
  const agency = role.startsWith("agency");
  return { companyKey: CO_A, userId, name: `Name ${userId}`, role, kind: agency ? "agency" : "client", homeLocationId: agency ? null : LA1, ...over };
};
const U1 = person("xte0-u1", "account_user");
const U2 = person("xte0-u2", "account_user");
const U3 = person("xte0-u3", "account_user");
const ADMIN = person("xte0-admin", "account_admin");
const OWNER = person("xte0-owner", "agency_owner");
const STAFF = person("xte0-staff", "agency_staff");
const OTHER_ADMIN = person("xte0-other-admin", "account_admin", { homeLocationId: LA2 });
const B_USER = person("xte0-b-user", "account_user", { companyKey: CO_B, homeLocationId: LB1 });

const tokens = () => ({ accessToken: SECRET + "-access", refreshToken: SECRET + "-refresh", expiresAt: Date.now() + 3_600_000 });
const connect = (p: Person, inst: string, hook: { id: string; secret: string } | null = null, key: string | null = null) =>
  saveConnection({ person: p, installationId: inst, provider: "fathom", tokens: tokens(), accountEmail: `${p.userId}@provider.test`, hook, publicKey: key });

const fakeFetch = (calls: Array<{ url: string; method: string }>) => (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), method: init?.method ?? "GET" });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

function ctxFor(p: Person, inst: string, kind: "agency" | "business" | "client", limitTo: string | null): AuthContext & { request: Request; url: URL } {
  const session: Session = { companyId: p.companyKey, userId: p.userId, role: p.role.endsWith("admin") || p.role === "agency_owner" ? "admin" : "user", userName: p.name, demo: false, kind, locationId: limitTo, personRole: p.role, exp: Math.floor(Date.now() / 1000) + 600 };
  return { session, installationId: inst, plan: "pro", demo: false, entitlements: { features: { zoom_meet: false } } as never, kind, limitTo, request: new Request("http://localhost/x", { method: "GET" }), url: new URL("http://localhost/x") };
}
const withBody = (c: ReturnType<typeof ctxFor>, body: unknown) => ({ ...c, request: new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

describe.skipIf(!HAS_DB)("connections against the real database (stage E0)", () => {
  beforeAll(async () => {
    vi.stubEnv("FATHOM_CLIENT_ID", "fixture-id");
    vi.stubEnv("FATHOM_CLIENT_SECRET", "fixture-secret");
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    // Company A holds the permission to add notes to contacts (without it a matched meeting correctly waits as "needs_permission").
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan, scope) values (${CO_A}, 'zzE0 A', 'pro', 'contacts.write users.readonly') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzE0 B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const [inst, loc, name] of [[instA, LA1, "zzE0 Client A1"], [instA, LA2, "zzE0 Client A2"], [instB, LB1, "zzE0 Client B1"]]) await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, ${name})`;
  });
  afterEach(async () => {
    for (const t of ["meetings", "crm_writes", "user_connections", "meeting_note_settings", "meeting_policies", "connections"]) await sql().unsafe(`delete from ${t} where installation_id in ('${instA}', '${instB}')`);
  });
  afterAll(async () => { vi.unstubAllEnvs(); for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("two users in one account connect separately; a third user cannot read, test, remove or revoke their connections", async () => {
    const a = await connect(U1, instA);
    const b = await connect(U2, instA);
    expect(a.id).not.toBe(b.id);
    expect((await listMine(U1, false)).map((c) => c.id)).toEqual([a.id]);
    expect((await listMine(U2, false)).map((c) => c.id)).toEqual([b.id]);
    expect(await listMine(U3, false), "a third user has nothing of their own, and sees nothing of theirs").toEqual([]);
    expect(await secretRowOf(U3, a.id)).toBeNull();
    expect(await disconnectOwn(U3, a.id, fakeFetch([]))).toBe(false);
    expect(await revokeByAdmin(instA, U3, statusScope(U3), a.id, fakeFetch([])), "an account user has no status scope, so there is nothing to revoke with").toBe(false);
    expect((await sql()`select count(*)::int n from user_connections where installation_id = ${instA}`)[0].n).toBe(2);
    // The same id asked for from another company finds nothing.
    expect(await secretRowOf(B_USER, a.id)).toBeNull();
    expect(await secretRowForAdmin(instB, { kind: "all" }, a.id), "another company's administrator cannot reach it even with full scope").toBeNull();
  });

  it("one connection per person and provider: connecting again replaces it and never makes a second row", async () => {
    await connect(U1, instA);
    await connect(U1, instA);
    expect((await sql()`select count(*)::int n from user_connections where ghl_user_id = ${U1.userId} and provider = 'fathom'`)[0].n).toBe(1);
  });

  it("tokens are stored encrypted, and nothing a screen reads can contain one", async () => {
    await connect(U1, instA, { id: "wh-1", secret: "whsec_FIXTURESECRET" }, "key-fixture-0000000000000000");
    const [raw] = await sql()`select access_token_enc, refresh_token_enc, webhook_secret_enc from user_connections where ghl_user_id = ${U1.userId}`;
    for (const v of Object.values(raw)) { expect(String(v)).toMatch(/^v1\./); expect(String(v)).not.toContain(SECRET); expect(String(v)).not.toContain("FIXTURESECRET"); }
    expect(SAFE_COLUMNS.filter((c) => /_enc$|public_key|secret/.test(c))).toEqual([]);
    const mine = JSON.stringify(await listMine(U1, true));
    const team = JSON.stringify(await listTeam(instA, { kind: "all" }));
    for (const text of [mine, team]) expect(text).not.toMatch(/fixture-token|FIXTURESECRET|key-fixture|v1\.|_enc|webhook_secret|public_key|wh-1/);
  });

  it("an administrator sees status and counts only, within their scope, and can revoke; the revoked person must connect again", async () => {
    const a = await connect(U1, instA);
    await connect(OWNER, instA);
    await sql()`update user_connections set home_location_id = ${LA2} where ghl_user_id = ${U1.userId}`;
    const everyone = await listTeam(instA, statusScope(OWNER));
    expect(everyone.map((r) => r.person).sort()).toEqual([OWNER.name, U1.name].sort());
    expect(Object.keys(everyone[0]).sort()).toEqual(["connectedAt", "homeLocationId", "id", "lastErrorCode", "lastEventAt", "person", "provider", "saved", "skipped", "status", "waiting"].sort());
    expect((await listTeam(instA, statusScope(OTHER_ADMIN))).map((r) => r.id), "an administrator of account A2 sees the person from A2 only").toEqual([a.id]);
    expect(await listTeam(instA, statusScope(ADMIN)), "an administrator of account A1 sees nobody from A2 and not the company team").toEqual([]);
    expect(await listTeam(instA, statusScope(U1))).toEqual([]);
    expect(await listTeam(instA, statusScope(STAFF)), "company staff see nobody until the Users list proves which accounts they can open").toEqual([]);
    expect((await listTeam(instA, statusScope(STAFF, [LA2]))).map((r) => r.id), "and then only people of those accounts").toEqual([a.id]);
    expect(await listTeam(instB, { kind: "all" }), "another company sees none of it").toEqual([]);
    expect(await revokeByAdmin(instA, ADMIN, statusScope(ADMIN), a.id, fakeFetch([])), "out of scope").toBe(false);
    expect(await revokeByAdmin(instA, OTHER_ADMIN, statusScope(OTHER_ADMIN), a.id, fakeFetch([]))).toBe(true);
    const [row] = await sql()`select status, access_token_enc, refresh_token_enc, webhook_secret_enc, public_key, revoked_by from user_connections where id = ${a.id}`;
    expect(row).toMatchObject({ status: "revoked", access_token_enc: null, refresh_token_enc: null, webhook_secret_enc: null, public_key: null, revoked_by: OTHER_ADMIN.userId });
    expect((await listMine(U1, false))[0].status).toBe("revoked");
    const srow = await secretRowOf(U1, a.id);
    expect(await accessTokenFor(srow!, fakeFetch([])), "a revoked connection has no token to use").toBeNull();
    await connect(U1, instA);
    expect((await listMine(U1, false))[0].status).toBe("connected");
  });

  it("a pending connection runs out after 2 minutes, and starting again never disturbs a working connection", async () => {
    await startPending(U1, instA, "fathom");
    expect((await listMine(U1, false))[0].status).toBe("waiting");
    await sql()`update user_connections set pending_since = now() - interval '3 minutes' where ghl_user_id = ${U1.userId}`;
    expect((await listMine(U1, false))[0].status).toBe("expired");
    await connect(U2, instA);
    await startPending(U2, instA, "fathom");
    expect((await listMine(U2, false))[0].status, "starting again does not touch a working connection").toBe("connected");
  });

  it("the public (anon) and signed-in database roles can read nothing from any new table", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["user_connections", "meeting_note_settings", "meeting_policies", "meetings", "crm_writes"]) {
        await expect(sql().begin(async (tx) => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(`select count(*) from public.${t}`); }), `${role} ${t}`).rejects.toThrow(/permission denied|row-level security/i);
      }
    }
  });

  it("two simultaneous deliveries of one meeting leave exactly one meetings row and one dry-run line; five simultaneous inserts give one id", async () => {
    const key = "key-e0-delivery-0000000000000";
    await connect(U1, instA, { id: "wh-9", secret: "whsec_x" }, key);
    const found = await findPersonalByKey(key);
    expect(found).toMatchObject({ installationId: instA, person: { userId: U1.userId, companyKey: CO_A } });
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, date_added) values (${instA}, ${LA1}, 'xte0-c1', 'Lee', 'T', 'lee@e0.test', '{}', now())`;
    await sql()`insert into meeting_note_settings (installation_id, ghl_user_id, preview_confirmed_at) values (${instA}, ${U1.userId}, now())`;
    const m = hookMeeting("E0 kitchen", [{ name: "Lee", email: "lee@e0.test" }]);
    const writer = crmWriter(CO_A);
    const results = await Promise.all([1, 2].map(() => ingestPersonalMeeting(found!, m, "rec-e0-1", pgIngestStore(), writer)));
    expect(results.map((r) => r.kind).sort()).toEqual(["duplicate", "written"]);
    expect((await sql()`select count(*)::int n from meetings where owner_ghl_user_id = ${U1.userId}`)[0].n).toBe(1);
    expect((await sql()`select count(*)::int n from audit_log where installation_id = ${instA} and action = 'dry_run.would_write'`)[0].n, "one WOULD WRITE line, because WRITE_GHL_LIVE is off").toBe(1);
    expect((await sql()`select count(*)::int n from crm_writes where installation_id = ${instA}`)[0].n, "a dry run writes nothing to the write log").toBe(0);
    const store = pgIngestStore();
    const base = { installationId: instA, ownerUserId: U2.userId, connectionId: found!.id, provider: "fathom", providerMeetingId: "rec-e0-2", startedAt: null, title: null, attendeeEmails: [], summary: null, actionItems: [], recordingUrl: null, status: "needs_contact" as const, reason: "no_match", expiresAt: null };
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => store.insertMeeting(base)));
    expect(ids.filter((x) => x !== null)).toHaveLength(1);
  });

  it("two simultaneous refreshes of one connection call the provider once, and the rotated refresh token is the one saved", async () => {
    const a = await connect(U1, instA);
    await sql()`update user_connections set token_expires_at = now() - interval '1 minute' where id = ${a.id}`;
    let calls = 0;
    const refresh = async (rt: string) => { calls++; await new Promise((r) => setTimeout(r, 30)); return rt === SECRET + "-refresh" ? { ok: true as const, tokens: { accessToken: "NEW-ACCESS-1234567890", refreshToken: "NEW-REFRESH-1234567890", expiresAt: Date.now() + 3_600_000 } } : { ok: false as const }; };
    const out = await Promise.all([1, 2, 3, 4].map(() => refreshLocked(pgRefreshStore(), a.id, refresh)));
    expect(calls).toBe(1);
    expect(out.every((o) => o.ok && o.accessToken === "NEW-ACCESS-1234567890")).toBe(true);
    const [row] = await sql()`select status, refresh_token_enc from user_connections where id = ${a.id}`;
    expect(row.status).toBe("connected");
    expect(row.refresh_token_enc).toMatch(/^v1\./);
    // A forced refresh (the token is expired again) also works, once more with the rotated token.
    await sql()`update user_connections set token_expires_at = now() - interval '1 minute' where id = ${a.id}`;
    const again = await refreshLocked(pgRefreshStore(), a.id, async (rt) => (rt === "NEW-REFRESH-1234567890" ? { ok: true, tokens: { accessToken: "NEWER-ACCESS-1234567890", refreshToken: "NEWER-REFRESH-123456789", expiresAt: Date.now() + 3_600_000 } } : { ok: false }));
    expect(again).toMatchObject({ ok: true, accessToken: "NEWER-ACCESS-1234567890", refreshed: true });
  });

  it("the write log is idempotent per part and recognises the id of our own write, only inside its own installation", async () => {
    const [m] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status) values (${instA}, ${U1.userId}, 'fathom', 'rec-log', 'saved') returning id`;
    const rec = { installationId: instA, meetingId: m.id as string, locationId: LA1, contactId: "xte0-c1", kind: "note" as const, ghlId: "NOTEID-ECHO-123", authoredBy: U1.userId };
    expect(await recordCrmWrite(rec)).toBe(true);
    expect(await recordCrmWrite(rec), "the same part twice").toBe(false);
    expect(await recordCrmWrite({ ...rec, partNo: 2, ghlId: "NOTEID-ECHO-456" })).toBe(true);
    expect(await isEchoOfOurWrite(instA, { type: "OutboundMessage", messageId: "NOTEID-ECHO-123" })).toBe(true);
    expect(await isEchoOfOurWrite(instA, { type: "NoteCreate", data: { id: "NOTEID-ECHO-456" } })).toBe(true);
    expect(await isEchoOfOurWrite(instA, { messageId: "SOMEONE-ELSES-MSG-1" })).toBe(false);
    expect(await isEchoOfOurWrite(instB, { messageId: "NOTEID-ECHO-123" }), "another installation's webhook never matches").toBe(false);
  });

  it("leaving: a person who is gone loses connection, choices and meetings; an empty list removes nobody; the others stay", async () => {
    await connect(U1, instA, { id: "wh-1", secret: "whsec_a" }, "key-e0-gone-000000000000000");
    await connect(U2, instA);
    await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status) values (${instA}, ${U1.userId}, 'fathom', 'rec-gone', 'needs_contact'), (${instA}, ${U2.userId}, 'fathom', 'rec-stays', 'needs_contact')`;
    await sql()`insert into meeting_note_settings (installation_id, ghl_user_id) values (${instA}, ${U1.userId}), (${instA}, ${U2.userId})`;
    expect(await removeDeactivatedPeople(instA, [], fakeFetch([]))).toEqual({ removed: 0, refused: "empty_list" });
    expect((await sql()`select count(*)::int n from user_connections where installation_id = ${instA}`)[0].n).toBe(2);
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubEnv("FATHOM_WEBHOOK_LIVE", "true");
    expect(await removeDeactivatedPeople(instA, [U2.userId], fakeFetch(calls))).toEqual({ removed: 1 });
    vi.unstubAllEnvs(); vi.stubEnv("FATHOM_CLIENT_ID", "fixture-id"); vi.stubEnv("FATHOM_CLIENT_SECRET", "fixture-secret");
    expect(calls, "the person's subscription was deleted at the provider first").toEqual([{ url: "https://api.fathom.ai/external/v1/webhooks/wh-1", method: "DELETE" }]);
    expect((await sql()`select owner_ghl_user_id from meetings where installation_id = ${instA}`).map((r) => r.owner_ghl_user_id)).toEqual([U2.userId]);
    expect((await sql()`select ghl_user_id from meeting_note_settings where installation_id = ${instA}`).map((r) => r.ghl_user_id)).toEqual([U2.userId]);
    expect((await sql()`select ghl_user_id from user_connections where installation_id = ${instA}`).map((r) => r.ghl_user_id)).toEqual([U2.userId]);
    expect((await removePerson(instA, "xte0-nobody", fakeFetch([]))).removed).toBe(false);
  });

  it("the Meeting inbox removes only what waited past its time: an unmatched meeting past expiry goes, a fresh one and a saved one stay", async () => {
    await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status, expires_at) values
      (${instA}, ${U1.userId}, 'fathom', 'rec-old', 'needs_contact', now() - interval '1 day'),
      (${instA}, ${U1.userId}, 'fathom', 'rec-fresh', 'needs_contact', now() + interval '7 days'),
      (${instA}, ${U1.userId}, 'fathom', 'rec-saved', 'saved', now() - interval '1 day')`;
    expect(await expireInbox()).toBeGreaterThanOrEqual(1);
    expect((await sql()`select provider_meeting_id from meetings where installation_id = ${instA} order by 1`).map((r) => r.provider_meeting_id)).toEqual(["rec-fresh", "rec-saved"]);
  });

  it("uninstall: subscriptions are deleted at the provider (or only recorded as WOULD lines while the switch is off), then every token and stored meeting is gone", async () => {
    const co = "xtest-e0-uninstall";
    await sql()`delete from installations where company_id = ${co}`;
    const [{ id: inst }] = await sql()`insert into installations (company_id, company_name, plan) values (${co}, 'zzE0 U', 'pro') returning id` as unknown as Array<{ id: string }>;
    const p = person("xte0-un-1", "account_user", { companyKey: co });
    const seed = async () => {
      await connect(p, inst, { id: "wh-un-1", secret: "whsec_u" }, "key-e0-uninstall-00000000000");
      await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, status) values (${inst}, ${p.userId}, 'fathom', 'rec-un', 'needs_contact')`;
      await sql()`insert into meeting_note_settings (installation_id, ghl_user_id) values (${inst}, ${p.userId}) on conflict do nothing`;
    };
    try {
      // Switch off (the committed default): the calls are recorded, nothing is sent.
      await seed();
      const off: Array<{ url: string; method: string }> = [];
      const dry = await revokeInstallationSubscriptions(inst, fakeFetch(off));
      expect(off).toEqual([]);
      expect(dry).toMatchObject({ attempted: 1, dryRun: 1, done: 0 });
      expect((await sql()`select detail from audit_log where installation_id = ${inst} and action = 'dry_run.would_write'`)[0].detail).toMatchObject({ what: "fathom.webhook.delete", ids: { webhookId: "wh-un-1" } });
      // Switch on: the real call goes to the provider, with the person's own access.
      vi.stubEnv("FATHOM_WEBHOOK_LIVE", "true");
      const on: Array<{ url: string; method: string }> = [];
      const live = await revokeInstallationSubscriptions(inst, fakeFetch(on));
      expect(on).toEqual([{ url: "https://api.fathom.ai/external/v1/webhooks/wh-un-1", method: "DELETE" }]);
      expect(live).toMatchObject({ attempted: 1, done: 1 });
      // And the uninstall itself erases everything, tokens included.
      vi.stubGlobal("fetch", fakeFetch([]));
      await purgeInstallation(co);
      vi.unstubAllGlobals();
      for (const t of ["user_connections", "meetings", "meeting_note_settings", "meeting_policies", "crm_writes", "connections"]) expect((await sql().unsafe(`select count(*)::int n from ${t} where installation_id = '${inst}'`))[0].n, t).toBe(0);
      const [row] = await sql()`select access_token_enc, refresh_token_enc, uninstalled_at from installations where id = ${inst}`;
      expect(row.access_token_enc).toBeNull();
      expect(row.uninstalled_at).not.toBeNull();
    } finally {
      vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.stubEnv("FATHOM_CLIENT_ID", "fixture-id"); vi.stubEnv("FATHOM_CLIENT_SECRET", "fixture-secret");
      await sql()`delete from installations where company_id = ${co}`;
    }
  });

  it("the endpoints: each role sees exactly its own part, and no answer contains a token or a secret", async () => {
    const a = await connect(U1, instA, { id: "wh-api", secret: "whsec_api" }, "key-e0-api-0000000000000000");
    await connect(OWNER, instA);
    await sql()`update user_connections set home_location_id = ${LA1} where id = ${a.id}`;
    const body = async (r: Response) => ({ status: r.status, text: await r.text() });

    // Everyone sees their own connections and nobody else's.
    const mine = await body(await myConnectionsView(ctxFor(U1, instA, "client", LA1)));
    expect(mine.status).toBe(200);
    expect(JSON.parse(mine.text).connections.map((c: { id: string }) => c.id)).toEqual([a.id]);
    const third = await body(await myConnectionsView(ctxFor(U3, instA, "client", LA1)));
    expect(JSON.parse(third.text).connections).toEqual([]);
    expect(JSON.parse(third.text).canAdmin).toBe(false);

    // An account user is refused the team page; the account's administrator sees the people of that account only, and no Slack or older shared connections.
    expect((await body(await teamConnectionsView(ctxFor(U1, instA, "client", LA1)))).status).toBe(403);
    const adminView = await body(await teamConnectionsView(ctxFor(ADMIN, instA, "client", LA1)));
    const parsed = JSON.parse(adminView.text);
    expect(adminView.status).toBe(200);
    expect(parsed.team.map((t: { id: string }) => t.id)).toEqual([a.id]);
    expect(parsed.slack).toEqual([]);
    expect(parsed.legacy).toEqual([]);
    const ownerView = JSON.parse((await body(await teamConnectionsView(ctxFor(OWNER, instA, "agency", null)))).text);
    expect(ownerView.team).toHaveLength(2);
    expect(ownerView.policy.canSetCompany).toBe(true);

    // No answer holds a token, a secret, an encrypted value or a delivery address.
    for (const text of [mine.text, third.text, adminView.text, JSON.stringify(ownerView)]) expect(text).not.toMatch(/fixture-token|whsec_|key-e0-api|v1\.[A-Za-z0-9_-]{8}|_enc|webhook_secret|public_key/);

    // Revoking: an account user cannot; the administrator of another account cannot; the administrator of the person's own account can.
    expect((await teamConnectionRevoke(ctxFor(U2, instA, "client", LA1), a.id)).status).toBe(403);
    expect((await teamConnectionRevoke(ctxFor(OTHER_ADMIN, instA, "client", LA2), a.id)).status).toBe(404);
    expect((await teamConnectionRevoke(ctxFor(ADMIN, instA, "client", LA1), a.id)).status).toBe(200);

    // Starting a connection for a provider that is not offered, or the demo, is refused plainly.
    expect((await myConnectionStart(ctxFor(U1, instA, "client", LA1), "slack")).status).toBe(404);
    expect((await myConnectionStart(ctxFor(U1, instA, "client", LA1), "zoom")).status, "Zoom is hidden while its switch is off").toBe(404);
  });

  it("rules: only the company owner saves the company rule; an account's administrator saves only their own account's rule, and it can only tighten", async () => {
    const save = async (p: Person, kind: "agency" | "client", limitTo: string | null, body: unknown) => (await policySave(withBody(ctxFor(p, instA, kind, limitTo), body))).status;
    expect(await save(person("xte0-adm2", "agency_admin"), "agency", null, { scope: "agency", flags: { allowTranscripts: true } })).toBe(403);
    expect(await save(OWNER, "agency", null, { scope: "agency", flags: { allowTranscripts: false, inboxRetentionDays: 7 } })).toBe(200);
    expect(await save(U1, "client", LA1, { scope: "account", flags: {} })).toBe(403);
    expect(await save(ADMIN, "client", LA1, { scope: "account", flags: { allowTranscripts: true, inboxRetentionDays: 30 } })).toBe(200);
    expect(await save(ADMIN, "client", LA1, { scope: "account", locationId: LA2, flags: {} }), "another account").toBe(404);
    expect(await save(ADMIN, "client", LA1, { scope: "agency", flags: {} })).toBe(403);
    const view = JSON.parse(await (await teamConnectionsView(ctxFor(ADMIN, instA, "client", LA1))).text());
    expect(view.policy.effectiveOwn).toMatchObject({ allowTranscripts: false, inboxRetentionDays: 7 });
  });
});
