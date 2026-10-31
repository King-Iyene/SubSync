import { describe, expect, it } from "vitest";
import { decideForIdentity, type Lookups } from "@/lib/access";
import { deriveIdentity } from "@/lib/identity";
import { makePayload } from "../fixtures/sso-payloads";

const lookups = (over: Partial<{ agencies: string[]; businesses: string[]; clientView: string[] }> = {}): Lookups => ({
  agencyInstalled: async (c) => (over.agencies ?? ["co"]).includes(c),
  businessInstalled: async (l) => (over.businesses ?? []).includes(l),
  clientViewOn: async (_c, l) => (over.clientView ?? []).includes(l),
});
const who = (over: Parameters<typeof makePayload>[0]) => { const id = deriveIdentity(makePayload({ companyId: "co", ...over })); if (!id) throw new Error("no identity"); return id; };

describe("role rules (CLAUDE.md 4.1)", () => {
  it("agency owner and agency admin get the agency view", async () => {
    for (const p of [{ type: "agency", role: "user", isAgencyOwner: true }, { type: "agency", role: "admin" }]) {
      expect(await decideForIdentity(who(p), lookups())).toMatchObject({ ok: true, kind: "agency", locationId: null });
    }
  });
  it("agency staff are refused (default deny until their access can be verified)", async () => {
    const d = await decideForIdentity(who({ type: "agency", role: "user", isAgencyOwner: false }), lookups());
    expect(d).toMatchObject({ ok: false, status: 403 });
    expect(d.ok === false && d.message).toMatch(/administrator|owner|access/i);
  });
  it("agency staff are refused even inside a business that installed the app itself", async () => {
    const d = await decideForIdentity(who({ type: "agency", role: "user", activeLocation: "L1" }), lookups({ agencies: [], businesses: ["L1"] }));
    expect(d.ok).toBe(false);
  });
  it("an account admin gets full tools on their own business", async () => {
    expect(await decideForIdentity(who({ type: "location", role: "admin", activeLocation: "L1" }), lookups({ businesses: ["L1"] }))).toMatchObject({ ok: true, kind: "business", locationId: "L1" });
  });
  it("an account user on a business that installed the app is read-only (client kind), never business", async () => {
    expect(await decideForIdentity(who({ type: "location", role: "user", activeLocation: "L1" }), lookups({ businesses: ["L1"] }))).toMatchObject({ ok: true, kind: "client", locationId: "L1" });
  });
  it("an account user whose agency switched client view on gets the read-only view of that one account", async () => {
    expect(await decideForIdentity(who({ type: "location", role: "user", activeLocation: "L2" }), lookups({ clientView: ["L2"] }))).toMatchObject({ ok: true, kind: "client", locationId: "L2" });
  });
  it("an account user at an account with client view off is refused", async () => {
    expect((await decideForIdentity(who({ type: "location", role: "user", activeLocation: "L3" }), lookups())).ok).toBe(false);
  });
  it("an agency user from a company that never installed gets the not-installed state, not data", async () => {
    expect(await decideForIdentity(who({ type: "agency", role: "admin", companyId: "other" }), lookups())).toMatchObject({ ok: false, status: 200, installed: false });
  });
  it("an account payload without a location is refused", async () => {
    expect((await decideForIdentity(who({ type: "location", role: "admin", activeLocation: undefined }), lookups())).ok).toBe(false);
  });
});
