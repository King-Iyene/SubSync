// Who may open the app, and what each kind of user may call. Pure logic with no database or
// network imports, so it can be unit tested. The data layer enforces the same boundary again
// (every query for a limited session is restricted to its one account); this is the first gate.
//
//   agency   - an agency user. Sees every client account and the agency-only pages.
//   business - the single business that installed the app for its own account. Sees its own
//              account only, with its own settings. Never sees the agency pages.
//   client   - a client's staff opening the app inside their own account because their agency
//              switched it on. A read-only view of that one account.

import type { Identity } from "./identity.ts";

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
  "SubSync is not turned on for your account yet. Ask the company that manages your account to switch it on for you, or install SubSync for your own account from the app marketplace.";

export async function decideAccess(who: Who, lookups: Lookups): Promise<Decision> {
  const type = (who.type ?? "").toLowerCase();
  const company = who.companyId;
  const location = who.activeLocation;

  if (type === "agency") {
    if (!company) return { ok: false, status: 403, installed: false, message: "No company in the user context" };
    if (await lookups.agencyInstalled(company)) return { ok: true, kind: "agency", companyKey: company, locationId: null };
    // An agency user opening a client account that installed the app for itself.
    if (location && (await lookups.businessInstalled(location))) {
      return { ok: true, kind: "business", companyKey: businessKey(location), locationId: location };
    }
    return { ok: false, status: 200, installed: false, message: "SubSync is not installed for this company" };
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

// ---------------- role rules (CLAUDE.md 4.1) ----------------

const STAFF_MESSAGE =
  "Your company administrator needs to give you access to SubSync. Until your access to each client account can be verified, SubSync shows nothing to staff accounts.";

// The decision for a verified identity. Agency staff are refused (default deny: their access to each client account cannot
// be verified yet). An account user is always read-only, even when their business installed the app.
export async function decideForIdentity(identity: Identity, lookups: Lookups): Promise<Decision> {
  if (identity.role === "agency_staff") return { ok: false, status: 403, installed: false, message: STAFF_MESSAGE };
  const decision = await decideAccess({ type: identity.userType, companyId: identity.companyId, activeLocation: identity.activeLocation }, lookups);
  if (decision.ok && identity.role === "account_user" && decision.kind === "business") return { ...decision, kind: "client" };
  return decision;
}

// Who may delete everything SubSync copied ("Delete my data"): the owner of the company that installed it, or, for a business that
// installed it for its own account, that account's administrator. An agency administrator, agency staff and a client's staff may not, and
// neither may an agency person who is only visiting a business that installed it for itself. Decided from the verified identity at sign-in
// and carried in the signed session, never from anything the browser sends.
export function mayDeleteData(identity: Identity, kind: AccessKind): boolean {
  return (kind === "agency" && identity.role === "agency_owner") || (kind === "business" && identity.role === "account_admin");
}

// ---------------- route policy ----------------

type Method = "GET" | "POST" | "PUT" | "DELETE";

// "a" is the first path segment under /api/app/. A rule is a method plus the first segment, and
// optionally the second. Everything not listed is refused for that kind (default deny).
type Rule = [Method, string, string?];

const GET_VIEWS = ["today", "deal-rules", "overview", "accounts", "onboarding", "search", "stale", "hygiene", "inbox", "pipelines", "duplicates", "alerts", "pipeline-intel", "contact-intel", "comms-intel", "deal-gaps", "deal-events", "contact", "people", "start", "appointments", "appointment-insights", "pipeline3", "clients3", "people3", "today3", "cash", "cu", "dq", "payments", "finance", "audit", "speed", "roadmap", "freshness", "client-trends", "workflows", "data-health"];

// Anyone may send feedback, report a problem or suggest something on the roadmap (stage F8): each is stored against the person and account named in the signed
// A person may keep their own saved views of the Unanswered messages page (inbox/views): they hold only filter choices, scoped to the person.
// Connections (stage E0): EVERY role connects its own tools, so my-connections is open to all kinds; it only ever touches the signed-in person's own rows.
// team-connections and meeting-policy are open to the kinds too, but the handler lets only administrators in (a client's account user gets 403) and limits an
// account administrator to the people and the rule of their own account.
const PERSONAL_RULES: Rule[] = [["GET", "ai"], ["POST", "ai", "act"], ["GET", "ai-team"], ["POST", "ai-team", "act"], ["GET", "my-connections"], ["POST", "my-connections"], ["DELETE", "my-connections"], ["GET", "team-connections"], ["POST", "team-connections"], ["PUT", "meeting-policy"], ["GET", "meeting-logged"], ["GET", "meeting-inbox"], ["POST", "meeting-inbox"], ["PUT", "meeting-inbox"], ["GET", "meeting-setup"], ["POST", "meeting-setup"], ["PUT", "meeting-setup"]];

// Notifications (stage F9): the bell is for every kind of person (a client's staff see only their own account's items and only their own marks).
// The preferences, Slack channels and tests are for a business (its administrator, checked inside the handler); a client's staff never reach them.
const BELL_RULES: Rule[] = [["GET", "notifications"], ["POST", "notifications"]];
const NOTIFY_ADMIN_RULES: Rule[] = [
  ["GET", "notification-prefs"], ["PUT", "notification-prefs"], ["POST", "notification-prefs"], ["DELETE", "notification-prefs"],
  ["GET", "notification-destinations"], ["POST", "notification-destinations"], ["DELETE", "notification-destinations"],
];

// People (stage PEOPLE): what a person does while working a list. Each only ever touches the person's own marks (the people they opened, their recent searches) or logs a call on a
// contact inside the accounts they may read (the handler checks the account again); none of them writes to the CRM.
// Appointments actions and meetings (slice AB): the handler checks the flag, the account and the person; a client's staff only touch their own appointments.
const APPT_ACTION_RULES: Rule[] = [["POST", "appointments", "act"], ["POST", "appointments", "meetings"]];
// Pipeline deal actions (slice PB): the handler checks the flag, the account and the person; a client staff member only touches deals assigned to them and never deletes or changes an owner.
const PIPELINE_ACTION_RULES: Rule[] = [["GET", "pipeline3", "act"], ["POST", "pipeline3", "act"]];
// Team actions and reports (slice PB): the handler checks the flag, the account and the person; a client's staff only read their own targets, focus and shared notes and never write.
const PEOPLE3_ACTION_RULES: Rule[] = [["GET", "people3", "act"], ["POST", "people3", "act"], ["GET", "people3", "roles"], ["POST", "people3", "roles"]];
// Today notes (snooze, daily email choice, tap counter): SubSync-only; the handler refuses a team member for the ones that change what the whole business sees.
const TODAY3_ACTION_RULES: Rule[] = [["POST", "today3", "act"]];
// Cash features (save this account, recover, deals): the handler checks the flag, the account and the person; a client staff member only touches rows that are theirs and never sees the save list.
const CASH_ACTION_RULES: Rule[] = [["POST", "cash", "act"]];
const PEOPLE_DAILY_RULES: Rule[] = [["PUT", "people", "seen"], ["POST", "people", "recent"], ["DELETE", "people", "recent"], ["POST", "people", "outcome"]];

// The Lead workbench: reading the thread and context, previewing and doing one action. A client's staff may do it on their own account; deleting is refused inside the handler.
const WORKBENCH_RULES: Rule[] = [["GET", "workbench"], ["POST", "workbench"]];
// Call mode (stage DIAL): the ordered queue, the script, the outcome tap and the stats. A client's staff may read and log (only their own leads, decided in the handler); changing the script is for the business.
const DIAL_RULES: Rule[] = [["GET", "dial"], ["POST", "dial"]];
const CLIENT_RULES: Rule[] = [...WORKBENCH_RULES, ...DIAL_RULES, ...BELL_RULES, ...GET_VIEWS.map((a) => ["GET", a] as Rule), ["POST", "usage"], ["POST", "sync", "auto"], ["POST", "today", "action"], ["POST", "roadmap"], ["POST", "feedback"], ["POST", "problem"], ["POST", "inbox", "views"], ["DELETE", "inbox", "views"], ["POST", "inbox", "outcome"], ["POST", "people", "lists"], ["DELETE", "people", "lists"], ["PUT", "people", "dialer"], ...PEOPLE_DAILY_RULES, ["POST", "duplicates"], ["POST", "dq"], ...PERSONAL_RULES, ...APPT_ACTION_RULES, ...PIPELINE_ACTION_RULES, ...PEOPLE3_ACTION_RULES, ...CASH_ACTION_RULES];

const BUSINESS_RULES: Rule[] = [
  ...WORKBENCH_RULES, ...DIAL_RULES, ["PUT", "dial", "script"], ...GET_VIEWS.map((a) => ["GET", a] as Rule), ...PERSONAL_RULES, ...BELL_RULES, ...NOTIFY_ADMIN_RULES, ...BELL_RULES, ...NOTIFY_ADMIN_RULES,
  ["GET", "email"], ["GET", "sync-run"], ["GET", "daily"], ["GET", "cleanup"], ["POST", "cleanup"], ["GET", "meetings"], ["POST", "meetings"], ["PUT", "meetings"], ["GET", "connections"], ["POST", "connections"], ["DELETE", "connections"], ["GET", "settings"], ["GET", "api-keys"], ["GET", "sync-status"], ["GET", "call-queue"],
  ["GET", "call-lists"], ["GET", "call-outcomes"], ["GET", "goals"], ["GET", "exec-summary"], ["GET", "daily-brief"], ["GET", "digest"],
  ["GET", "export", "stale"], ["GET", "export", "duplicates"], ["GET", "export", "inbox"], ["GET", "export", "deals"], ["GET", "export", "alerts"],
  ["POST", "email", "check"], ["POST", "alerts"], ["POST", "duplicates"], ["POST", "cu"], ["POST", "dq"], ["POST", "usage"], ["POST", "today", "action"], ["POST", "today", "views"], ["POST", "roadmap"], ["POST", "feedback"], ["POST", "problem"], ["POST", "audit", "share"], ["POST", "audit", "revoke"], ["POST", "audit", "prefs"], ["POST", "sync"], ["POST", "call-lists"], ["POST", "call-outcomes"], ["POST", "inbox", "outcome"],
  ["POST", "payments", "act"], ["POST", "workflows"], ["PUT", "workflows"], ["DELETE", "workflows"], ["POST", "data-health"], ["PUT", "data-health"], ["POST", "settings", "test-slack"], ["POST", "settings", "purge"], ["POST", "api-keys"],
  ["DELETE", "call-lists"], ["DELETE", "today", "views"], ["POST", "inbox", "views"], ["DELETE", "inbox", "views"], ["POST", "people", "lists"], ["DELETE", "people", "lists"], ["PUT", "people", "dialer"], ...PEOPLE_DAILY_RULES,
  ...APPT_ACTION_RULES, ...PIPELINE_ACTION_RULES, ...PEOPLE3_ACTION_RULES, ...TODAY3_ACTION_RULES, ...CASH_ACTION_RULES, ["POST", "finance", "dispute"], ["GET", "team"], ["PUT", "team"], ["PUT", "settings"], ["PUT", "goals"], ["PUT", "appointments", "targets"], ["PUT", "appointments", "sale-basis"], ["PUT", "deal-rules", "test-names"], ["PUT", "deal-rules", "ownerless"], ["PUT", "appointments", "exec-target"], ["PUT", "speed", "target"], ["PUT", "accounts"], ["PUT", "stage-rules"],
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
  agency: new Set(["today", "payments", "finance", "workflows", "data-health", "people", "audit", "speed", "overview", "accounts", "clients", "team", "appointments", "meetings", "cleanup", "search", "deals", "pipeline", "leads", "calls", "inbox", "onboarding", "email", "duplicates", "alerts", "settings", "notifications", "connections", "help", "roadmap"]),
  business: new Set(["today", "payments", "finance", "workflows", "data-health", "myday", "people", "audit", "speed", "overview", "team", "appointments", "meetings", "cleanup", "search", "deals", "pipeline", "leads", "calls", "inbox", "onboarding", "email", "duplicates", "alerts", "settings", "notifications", "connections", "help", "roadmap"]),
  client: new Set(["today", "workflows", "data-health", "myday", "people", "audit", "speed", "overview", "team", "appointments", "search", "deals", "pipeline", "leads", "inbox", "duplicates", "onboarding", "alerts", "connections", "help", "roadmap"]),
};
