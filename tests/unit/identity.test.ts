import { describe, expect, it } from "vitest";
import { deriveIdentity } from "@/lib/identity";
import { decryptSsoPayload } from "@/lib/ghl/sso";
import { encryptPayload, makePayload } from "../fixtures/sso-payloads";

describe("deriveIdentity: the five roles", () => {
  it("agency owner: isAgencyOwner is true", () => {
    expect(deriveIdentity(makePayload({ type: "agency", role: "user", isAgencyOwner: true }))).toMatchObject({ role: "agency_owner", isAgencyOwner: true, userType: "agency" });
  });
  it("agency admin: role admin, not the owner", () => {
    expect(deriveIdentity(makePayload({ type: "agency", role: "admin", isAgencyOwner: false }))).toMatchObject({ role: "agency_admin", isAgencyOwner: false });
  });
  it("agency staff: role user and not the owner", () => {
    expect(deriveIdentity(makePayload({ type: "agency", role: "user", isAgencyOwner: false }))?.role).toBe("agency_staff");
  });
  it("account admin: user type location with role admin", () => {
    expect(deriveIdentity(makePayload({ type: "location", role: "admin", activeLocation: "L1" }))).toMatchObject({ role: "account_admin", userType: "account", activeLocation: "L1" });
  });
  it("account user: user type location with role user", () => {
    expect(deriveIdentity(makePayload({ type: "location", role: "user", activeLocation: "L1" }))?.role).toBe("account_user");
  });
  it("the word account is accepted as a user type too", () => {
    expect(deriveIdentity(makePayload({ type: "account", role: "admin", activeLocation: "L1" }))?.role).toBe("account_admin");
  });
});

describe("deriveIdentity: strict about what counts", () => {
  it("only the boolean true makes an owner", () => {
    for (const v of ["true", "TRUE", 1, "1", "yes", null, undefined, {}, []]) {
      const id = deriveIdentity(makePayload({ type: "agency", role: "user", isAgencyOwner: v }));
      expect(id?.role, `isAgencyOwner=${JSON.stringify(v)}`).toBe("agency_staff");
      expect(id?.isAgencyOwner).toBe(false);
    }
  });
  it("a missing or unknown role is the least privileged role of that user type", () => {
    for (const r of [undefined, null, "", "superadmin", 7, {}]) {
      expect(deriveIdentity(makePayload({ type: "agency", role: r, isAgencyOwner: false }))?.role, `agency role ${JSON.stringify(r)}`).toBe("agency_staff");
      expect(deriveIdentity(makePayload({ type: "location", role: r, activeLocation: "L1" }))?.role, `account role ${JSON.stringify(r)}`).toBe("account_user");
    }
  });
  it("role is read without regard to case or spaces", () => {
    expect(deriveIdentity(makePayload({ type: "agency", role: " Admin ", isAgencyOwner: false }))?.role).toBe("agency_admin");
    expect(deriveIdentity(makePayload({ type: "LOCATION", role: "ADMIN", activeLocation: "L1" }))?.role).toBe("account_admin");
  });
  it("an unknown or missing user type has no identity", () => {
    for (const t of [undefined, null, "", "superuser", 5, {}]) expect(deriveIdentity(makePayload({ type: t }))).toBeNull();
  });
  it("garbage input has no identity", () => {
    for (const p of [null, undefined, "x", 7, [], true]) expect(deriveIdentity(p)).toBeNull();
  });
  it("copies only the fields it needs, as strings or null", () => {
    const id = deriveIdentity(makePayload({ type: "agency", role: "admin", companyId: 123, userId: ["x"], activeLocation: 5 }));
    expect(id?.companyId).toBeNull();
    expect(id?.userId).toBeNull();
    expect(id?.activeLocation).toBeNull();
    expect(Object.keys(id ?? {}).sort()).toEqual(["activeLocation", "companyId", "isAgencyOwner", "role", "userId", "userName", "userType", "whitelabelDomain"]);
  });
});

describe("the payload generator matches the real decrypt path", () => {
  it("what is encrypted here decrypts and derives the same identity", () => {
    const payload = makePayload({ type: "location", role: "user", activeLocation: "L9", companyId: "c1" });
    const back = decryptSsoPayload(encryptPayload(payload, "shared-secret"), "shared-secret");
    expect(deriveIdentity(back)).toMatchObject({ role: "account_user", activeLocation: "L9", companyId: "c1" });
  });
  it("the wrong key does not decrypt", () => {
    expect(() => decryptSsoPayload(encryptPayload(makePayload(), "right"), "wrong")).toThrow();
  });
});
