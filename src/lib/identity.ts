// One place that turns the platform's decrypted user context into who this person is. Pure: it takes the verified
// payload and nothing else (never an id from the browser), so every rule is unit tested. CLAUDE.md section 4.1.
import { parseSsoUser } from "./ghl/sso.ts";

export type Role = "agency_owner" | "agency_admin" | "agency_staff" | "account_admin" | "account_user";

export type Identity = {
  userId: string | null;
  userName: string | null;
  companyId: string | null;
  /** The client account the person has open, when there is one. */
  activeLocation: string | null;
  userType: "agency" | "account";
  role: Role;
  /** True only when the payload says exactly `true`. A string or number never counts. */
  isAgencyOwner: boolean;
  whitelabelDomain: string | null;
};

const norm = (v: string | null) => (v ?? "").trim().toLowerCase();

export function deriveIdentity(payload: unknown): Identity | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const user = parseSsoUser(payload);
  const type = norm(user.type);
  const admin = norm(user.role) === "admin";
  const owner = (payload as Record<string, unknown>).isAgencyOwner === true;

  if (type === "agency") {
    const role: Role = owner ? "agency_owner" : admin ? "agency_admin" : "agency_staff";
    return { userId: user.userId, userName: user.userName, companyId: user.companyId, activeLocation: user.activeLocation, userType: "agency", role, isAgencyOwner: owner, whitelabelDomain: user.whitelabelDomain };
  }
  if (type === "location" || type === "account") {
    // A missing or unknown role is the least privileged one.
    const role: Role = admin ? "account_admin" : "account_user";
    return { userId: user.userId, userName: user.userName, companyId: user.companyId, activeLocation: user.activeLocation, userType: "account", role, isAgencyOwner: false, whitelabelDomain: user.whitelabelDomain };
  }
  return null;
}
