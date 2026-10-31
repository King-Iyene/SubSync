import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { encryptPayload, makePayload } from "../fixtures/sso-payloads";

// The real sign-in route, end to end, with fixtures in the database: every role, the wrong key, an uninstalled company.
// Fixtures are named xtest-id-* and removed afterwards. Skipped when no database is configured (for example in CI).
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const SECRET = "test-shared-secret-for-roles";
const CO = "xtest-id-co", BIZ = "xtestIdBiz01", BIZ_KEY = "loc:" + BIZ, L_ON = "xtestIdLocOn1", L_OFF = "xtestIdLocOff";
const POST_PATH = "http://x.test/api/sso";

async function signIn(payload: unknown, secret = SECRET) {
  vi.stubEnv("GHL_SSO_KEY", SECRET);
  const { POST } = await import("@/app/api/sso/route");
  const res = await POST(new Request(POST_PATH, { method: "POST", body: JSON.stringify({ payload: encryptPayload(payload, secret) }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const kindOf = (r: { body: Record<string, unknown> }) => (r.body.session ? verifySession(r.body.session as string)?.kind : undefined);

describe.skipIf(!HAS_DB)("the real sign-in: roles", () => {
  let instId = "";
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO}, ${BIZ_KEY})`;
    const tok = encryptSecret("not-a-real-token");
    const [agency] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzIdAgency', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
    instId = agency.id as string;
    await sql()`insert into locations (installation_id, location_id, name, client_view) values (${instId}, ${L_ON}, 'zzIdLocOn', true), (${instId}, ${L_OFF}, 'zzIdLocOff', false)`;
    await sql()`insert into installations (company_id, company_name, plan, mode, location_id, access_token_enc, refresh_token_enc, token_expires_at) values (${BIZ_KEY}, 'zzIdBiz', 'pro', 'business', ${BIZ}, ${tok}, ${tok}, now() + interval '1 hour')`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await sql()`delete from installations where company_id in (${CO}, ${BIZ_KEY})`;
    await closeDb();
  });

  it("agency owner and agency admin: in, agency view", async () => {
    for (const p of [{ type: "agency", role: "user", isAgencyOwner: true }, { type: "agency", role: "admin", isAgencyOwner: false }]) {
      const r = await signIn(makePayload({ companyId: CO, ...p }));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(kindOf(r)).toBe("agency");
    }
  });
  it("agency staff: refused, no session", async () => {
    const r = await signIn(makePayload({ companyId: CO, type: "agency", role: "user", isAgencyOwner: false }));
    expect(r.status).toBe(403);
    expect(r.body.session).toBeUndefined();
  });
  it("a string 'true' is not an owner: staff are refused", async () => {
    const r = await signIn(makePayload({ companyId: CO, type: "agency", role: "user", isAgencyOwner: "true" }));
    expect(r.status).toBe(403);
  });
  it("account admin on a business that installed itself: business view, limited to that account", async () => {
    const r = await signIn(makePayload({ companyId: "any", type: "location", role: "admin", activeLocation: BIZ }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(kindOf(r)).toBe("business");
    expect(verifySession(r.body.session as string)?.locationId).toBe(BIZ);
  });
  it("account user on that business: read-only client view, not the business view", async () => {
    const r = await signIn(makePayload({ companyId: "any", type: "location", role: "user", activeLocation: BIZ }));
    expect(r.status).toBe(200);
    expect(kindOf(r)).toBe("client");
  });
  it("account admin at an account where the agency switched client view on: client view of that one account", async () => {
    const r = await signIn(makePayload({ companyId: CO, type: "location", role: "admin", activeLocation: L_ON }));
    expect(kindOf(r)).toBe("client");
    expect(verifySession(r.body.session as string)?.locationId).toBe(L_ON);
  });
  it("account user at an account with client view off: refused", async () => {
    const r = await signIn(makePayload({ companyId: CO, type: "location", role: "user", activeLocation: L_OFF }));
    expect(r.status).toBe(403);
  });
  it("an account user cannot borrow another agency's account by claiming that company id", async () => {
    const r = await signIn(makePayload({ companyId: "xtest-id-other", type: "location", role: "admin", activeLocation: L_ON }));
    expect(r.status).toBe(403);
  });
  it("an agency user from a company that never installed: told it is not installed, no session", async () => {
    const r = await signIn(makePayload({ companyId: "xtest-id-never", type: "agency", role: "admin" }));
    expect(r.body.installed).toBe(false);
    expect(r.body.session).toBeUndefined();
  });
  it("a payload encrypted with the wrong key is refused", async () => {
    const r = await signIn(makePayload({ companyId: CO }), "some-other-key");
    expect(r.status).toBe(401);
  });
  it("sign-ins are recorded without names, emails or person ids", async () => {
    const cols = (await sql()`select column_name from information_schema.columns where table_name = 'identity_log' order by column_name`).map((c) => c.column_name);
    expect(cols).toEqual(["at", "has_location", "id", "installation_id", "is_agency_owner", "outcome", "role", "user_type"]);
    const [n] = await sql()`select count(*)::int n from identity_log where installation_id = ${instId}`;
    expect(n.n).toBeGreaterThanOrEqual(3);
  });
});
