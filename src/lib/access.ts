// Who may open the app, and what each kind of user may call. Pure logic with no database or
// network imports, so it can be unit tested. The data layer enforces the same boundary again
// (every query for a limited session is restricted to its one account); this is the first gate.
//
//   agency   - an agency user. Sees every client account and the agency-only pages.
//   business - the single business that installed the app for its own account. Sees its own
//              account only, with its own settings. Never sees the agency pages.
//   client   - a client's staff opening the app inside their own account because their agency
//              switched it on. A read-only view of that one account.

export type AccessKind = "agency" | "business" | "client";

export const BUSINESS_PREFIX = "loc:";
export const businessKey = (locationId: string) => BUSINESS_PREFIX + locationId;
export const isBusinessKey = (companyKey: string) => companyKey.startsWith(BUSINESS_PREFIX);
export const locationOfBusinessKey = (companyKey: string) => companyKey.slice(BUSINESS_PREFIX.length);

export type Who = {
  type: string | null;
  companyId: string | null;
  activeLocation: string | null;
};

export type Lookups = {
  agencyInstalled: (companyId: string) => Promise<boolean>;
  businessInstalled: (locationId: string) => Promise<boolean>;
  clientViewOn: (companyId: string, locationId: string) => Promise<boolean>;
};

export type Decision =
  | { ok: true; kind: AccessKind; companyKey: string; locationId: string | null }
  | { ok: false; status: 200 | 403; installed: boolean; message: string };

const NOT_ENABLED =
  "SubSync is not turned on for your account yet. Ask your agency to switch it on for you, or install SubSync for your own account from the app marketplace.";

export async function decideAccess(who: Who, lookups: Lookups): Promise<Decision> {
  const type = (who.type ?? "").toLowerCase();
  const company = who.companyId;
  const location = who.activeLocation;

  if (type === "agency") {
    if (!company) return { ok: false, status: 403, installed: false, message: "No agency in the user context" };
    if (await lookups.agencyInstalled(company)) return { ok: true, kind: "agency", companyKey: company, locationId: null };
    // An agency user opening a client account that installed the app for itself.
    if (location && (await lookups.businessInstalled(location))) {
      return { ok: true, kind: "business", companyKey: businessKey(location), locationId: location };
    }
    return { ok: false, status: 200, installed: false, message: "SubSync is not installed for this agency" };
  }

  if (type === "account" || type === "location") {
    if (!location) return { ok: false, status: 403, installed: false, message: "Open SubSync from inside your account." };
    if (await lookups.businessInstalled(location)) {
      return { ok: true, kind: "business", companyKey: businessKey(location), locationId: location };
    }
    if (company && (await lookups.agencyInstalled(company)) && (await lookups.clientViewOn(company, location))) {
      return { ok: true, kind: "client", companyKey: company, locationId: location };
    }
    return { ok: false, status: 403, installed: false, message: NOT_ENABLED };
  }

  return { ok: false, status: 403, installed: false, message: "This user type cannot open SubSync." };
}

// ---------------- route policy ----------------

type Method = "GET" | "POST" | "PUT" | "DELETE";

// "a" is the first path segment under /api/app/. A rule is a method plus the first segment, and
// optionally the second. Everything not listed is refused for that kind (default deny).
type Rule = [Method, string, string?];

const GET_VIEWS = ["overview", "accounts", "onboarding", "search", "stale", "hygiene", "inbox", "pipelines", "duplicates", "alerts", "pipeline-intel", "contact-intel", "comms-intel", "deal-events", "contact", "start", "appointments"];

const CLIENT_RULES: Rule[] = [...GET_VIEWS.map((a) => ["GET", a] as Rule), ["POST", "usage"]];

const BUSINESS_RULES: Rule[] = [
  ...GET_VIEWS.map((a) => ["GET", a] as Rule),
  ["GET", "email"], ["GET", "daily"], ["GET", "cleanup"], ["POST", "cleanup"], ["GET", "meetings"], ["POST", "meetings"], ["PUT", "meetings"], ["GET", "connections"], ["POST", "connections"], ["PUT", "connections"], ["DELETE", "connections"], ["GET", "settings"], ["GET", "api-keys"], ["GET", "sync"], ["GET", "health"], ["GET", "call-queue"],
  ["GET", "call-lists"], ["GET", "call-outcomes"], ["GET", "goals"], ["GET", "exec-summary"], ["GET", "daily-brief"], ["GET", "digest"],
  ["GET", "export", "stale"], ["GET", "export", "duplicates"], ["GET", "export", "inbox"], ["GET", "export", "deals"], ["GET", "export", "alerts"],
  ["POST", "email", "check"], ["POST", "alerts"], ["POST", "duplicates"], ["POST", "usage"], ["POST", "sync"], ["POST", "call-lists"], ["POST", "call-outcomes"],
  ["POST", "settings", "test-slack"], ["POST", "settings", "purge"], ["POST", "api-keys"],
  ["DELETE", "call-lists"],
  ["GET", "team"], ["PUT", "team"], ["PUT", "settings"], ["PUT", "goals"], ["PUT", "accounts"],
];

export function routeAllowed(kind: AccessKind, method: string, segments: string[]): boolean {
  if (kind === "agency") return true;
  const [a, b, c] = segments;
  const rules = kind === "business" ? BUSINESS_RULES : CLIENT_RULES;
  if (!rules.some(([m, ra, rb]) => m === method && ra === a && (rb === undefined || rb === b))) return false;
  // Agency controls on an account (ignore, owner) are never for the account itself.
  if (a === "accounts" && c === "flags") return false;
  // Only a business may change its own checklist; a client view is read-only.
  if (a === "accounts" && method === "PUT" && c !== "tasks") return false;
  return true;
}

// Pages (by nav id) each kind sees. The server enforces the same boundary; this only hides links.
export const NAV_FOR: Record<AccessKind, ReadonlySet<string>> = {
  agency: new Set(["today", "overview", "accounts", "clients", "team", "appointments", "meetings", "cleanup", "search", "deals", "pipeline", "leads", "calls", "inbox", "onboarding", "email", "duplicates", "alerts", "settings", "help"]),
  business: new Set(["today", "overview", "team", "appointments", "meetings", "cleanup", "search", "deals", "pipeline", "leads", "calls", "inbox", "onboarding", "email", "duplicates", "alerts", "settings", "help"]),
  client: new Set(["overview", "appointments", "search", "deals", "pipeline", "leads", "inbox", "duplicates", "onboarding", "alerts", "help"]),
};
