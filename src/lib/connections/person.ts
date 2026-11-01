import type { AccessKind } from "../access.ts";
import type { Role } from "../identity.ts";

// Who a person is, for connections (INTEGRATIONS_SPEC sections 2, 3 and 3.2). Pure: it reads only the verified, signed session and the
// facts the server looked up, never an id or a role sent by the browser. A person is the pair (company key, CRM user id), so an agency
// user who works in many client accounts connects a tool ONCE.

/** The part of the signed session this needs. */
export type SessionLike = { companyId: string; userId: string | null; userName: string | null; role: string | null; personRole?: Role };

export type Person = {
  /** The company or business key the session carries (the installation's company_id). */
  companyKey: string;
  userId: string;
  name: string | null;
  role: Role;
  kind: AccessKind;
  /** The one client account the session is limited to (business and client sessions). Null for company staff. */
  homeLocationId: string | null;
};

/**
 * The role, from what sign-in derived (carried in the session) or, for a session issued before that claim existed, from the two things the
 * session always had: its kind and the raw role. An unknown or missing role is the least privileged one. An old session can never be an
 * owner: ownership is only ever read from the verified payload at sign-in.
 */
export function roleOfSession(s: SessionLike, kind: AccessKind): Role {
  if (s.personRole) return s.personRole;
  const admin = (s.role ?? "").trim().toLowerCase() === "admin";
  if (kind === "agency") return admin ? "agency_admin" : "agency_staff";
  return admin ? "account_admin" : "account_user";
}

/** The signed-in person, or null when the session has no user id (nothing personal can be saved for nobody). */
export function personFromSession(s: SessionLike, kind: AccessKind, limitTo: string | null): Person | null {
  if (!s.userId || !s.companyId) return null;
  if (kind !== "agency" && !limitTo) return null;
  return { companyKey: s.companyId, userId: s.userId, name: s.userName, role: roleOfSession(s, kind), kind, homeLocationId: kind === "agency" ? null : limitTo };
}

export type Action =
  | "connect_own" | "set_own_prefs" | "see_own_meetings"
  | "see_status" | "read_others_content" | "revoke"
  | "connect_workspace" | "set_account_policy" | "set_agency_policy";

const ADMINS: ReadonlySet<Role> = new Set<Role>(["agency_owner", "agency_admin", "agency_staff", "account_admin"]);

/**
 * The table in INTEGRATIONS_SPEC section 3. Nobody, whatever their role, may read another person's meeting content in SubSync
 * (`read_others_content` is false for every role on purpose), and only the company owner sets the company default policy.
 */
export function can(role: Role, action: Action): boolean {
  switch (action) {
    case "connect_own": case "set_own_prefs": case "see_own_meetings": return true;
    case "read_others_content": return false;
    case "see_status": case "revoke": case "connect_workspace": case "set_account_policy": return ADMINS.has(role);
    case "set_agency_policy": return role === "agency_owner";
  }
}

/** Which people's status an administrator may see (names, status, counts: never content). */
export type StatusScope = { kind: "none" } | { kind: "all" } | { kind: "account"; locationId: string } | { kind: "listed"; locationIds: string[] };

/**
 * Company owners and administrators see everyone in their company. A business that installed the app itself is one account, so its
 * administrator sees everyone in it. A client's administrator (their company switched the view on) sees the people of their own account.
 * Company staff see only the accounts the Users list proves they can open, and nothing until it does.
 */
export function statusScope(p: Person, provenAccess: string[] | null = null): StatusScope {
  if (!can(p.role, "see_status")) return { kind: "none" };
  if (p.kind === "business") return { kind: "all" };
  if (p.kind === "client") return p.homeLocationId ? { kind: "account", locationId: p.homeLocationId } : { kind: "none" };
  if (p.role === "agency_owner" || p.role === "agency_admin") return { kind: "all" };
  return provenAccess && provenAccess.length ? { kind: "listed", locationIds: provenAccess } : { kind: "none" };
}

/** May this administrator see (and revoke) the connection of someone whose home account is `home` (null for company staff)? */
export function covers(scope: StatusScope, home: string | null): boolean {
  switch (scope.kind) {
    case "none": return false;
    case "all": return true;
    case "account": return home === scope.locationId;
    case "listed": return home !== null && scope.locationIds.includes(home);
  }
}

export type InstalledAccount = { locationId: string; ignored?: boolean };

/**
 * The client accounts a person may match a meeting against and write into (spec 3.2 rule 2).
 *  - A business or client session: its one account, never another.
 *  - Company owner and administrator: every account of the company that has SubSync.
 *  - Company staff: only accounts the Users list proves they can open. If it cannot prove any, none: the meeting goes to the inbox.
 */
export function accessibleAccounts(p: Person, installed: InstalledAccount[], provenAccess: string[] | null = null): string[] {
  const live = installed.filter((a) => !a.ignored).map((a) => a.locationId);
  if (p.kind !== "agency") return p.homeLocationId && live.includes(p.homeLocationId) ? [p.homeLocationId] : [];
  if (p.role === "agency_owner" || p.role === "agency_admin") return live;
  if (!provenAccess) return [];
  const proven = new Set(provenAccess);
  return live.filter((id) => proven.has(id));
}
