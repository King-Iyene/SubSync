import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mayDeleteData, NAV_FOR, routeAllowed } from "@/lib/access";
import type { Identity, Role } from "@/lib/identity";

// N84: "They see a read-only view of that one account only: never other clients, your fees, notes or settings" is a security claim, so it is
// tested. This file covers the rule itself (what a client's staff may call at all); scripts/check-tenancy.ts proves the answers over real HTTP
// against two real fixture companies with fees, notes, settings, keys and a second client, and that switching client access off removes access
// on the very next request.
const METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

// Everything a client's staff may call. Anything else is refused, whatever it is called.
const CLIENT_GET = new Set(["my-connections", "team-connections", "meeting-inbox", "overview", "accounts", "onboarding", "search", "stale", "hygiene", "inbox", "pipelines", "duplicates", "alerts", "pipeline-intel", "contact-intel", "comms-intel", "deal-gaps", "deal-events", "contact", "start", "appointments", "appointment-insights", "audit", "speed", "roadmap", "freshness", "people", "client-trends"]);
// Stage E0: every role connects its OWN tools, so these doors are open to a client's staff too. They only ever touch the signed-in person's own rows
// (my-connections), or, for an account administrator only, the status of the people of their own account (team-connections) and that account's rule
// (meeting-policy). meeting-inbox (stage E2a) is the signed-in person's OWN inbox: every query names their installation and user id. The handlers refuse an account user for the last two; tests/unit/e0-connections-db.test.ts asks them with real sessions.
const CLIENT_POST = new Set(["usage", "roadmap", "my-connections", "team-connections", "meeting-inbox", "feedback", "problem"]);
const CLIENT_PUT = new Set(["meeting-policy", "meeting-inbox"]);
const CLIENT_DELETE = new Set(["my-connections"]);

// Every first path segment the API handles, read from the router itself, plus names of things that must never reach a client even if they are built later.
const router = readFileSync(join(process.cwd(), "src/lib/api/router.ts"), "utf8");
const handled = [...new Set([...router.matchAll(/\ba === "([a-z-]+)"/g)].map((m) => m[1]))];
const never = ["sync-status", "tickets", "ticket", "fees", "fee", "notes", "billing", "invoices", "settings", "clients", "qbr", "api-keys", "connections", "meetings", "cleanup", "team", "goals", "call-lists", "call-outcomes", "call-queue", "exec-summary", "daily", "daily-brief", "digest", "export", "sync", "health", "segments", "playbooks", "setup-compare", "email", "reports", "members", "users"];

describe("a client's staff can call only the read-only views of their own account", () => {
  it("the router handles a meaningful set of routes (so the loops below are not looping over nothing)", () => {
    expect(handled.length).toBeGreaterThan(35);
    for (const s of ["settings", "clients", "connections", "meetings", "api-keys", "qbr", "cleanup", "my-connections", "team-connections", "meeting-policy"]) expect(handled).toContain(s);
  });

  it("every route the router handles, and every name that must never reach a client, is refused for a client except the listed read-only views", () => {
    for (const segment of [...new Set([...handled, ...never])]) {
      for (const method of METHODS) {
        for (const path of [[segment], [segment, "x"], [segment, "x", "y"]]) {
          // A listed view may take an id after its name (accounts/<id>, contact/<id>/<id>); the handler checks that id against the caller's account.
          const expected = (method === "GET" && CLIENT_GET.has(segment)) || (method === "POST" && CLIENT_POST.has(segment)) || (method === "PUT" && CLIENT_PUT.has(segment)) || (method === "DELETE" && CLIENT_DELETE.has(segment));
          expect(routeAllowed("client", method, path), `${method} /${path.join("/")} for a client`).toBe(expected);
        }
      }
    }
  });

  it("a client may keep their own saved views of the Unanswered messages page, and nothing else under that name", () => {
    expect(routeAllowed("client", "GET", ["inbox", "views"])).toBe(true);
    expect(routeAllowed("client", "POST", ["inbox", "views"])).toBe(true);
    expect(routeAllowed("client", "DELETE", ["inbox", "views", "6f9619ff-8b86-d011-b42d-00c04fc964ff"])).toBe(true);
    for (const method of ["POST", "PUT", "DELETE"] as const) expect(routeAllowed("client", method, ["inbox"]), method + " /inbox").toBe(false);
    expect(routeAllowed("client", "PUT", ["inbox", "views"])).toBe(false);
    expect(routeAllowed("client", "POST", ["inbox", "other"])).toBe(false);
  });

  it("the older shared connections page and its writes stay closed to a client (only the personal and team-status doors above are open)", () => {
    for (const method of METHODS) expect(routeAllowed("client", method, ["connections", "x"]), `${method} connections/x`).toBe(false);
    expect(routeAllowed("client", "POST", ["connections", "slack", "start"])).toBe(false);
    expect(routeAllowed("client", "GET", ["meeting-policy"]), "a client cannot read the rules, only an administrator saves their account's").toBe(false);
    expect(routeAllowed("client", "PUT", ["team-connections", "x", "revoke"]), "revoking is a POST").toBe(false);
  });

  it("a client can never change anything about an account, switch client access, or read the agency controls on one", () => {
    for (const method of ["PUT", "POST", "DELETE"] as const) {
      expect(routeAllowed("client", method, ["accounts", "L1", "flags"]), `${method} accounts/<id>/flags`).toBe(false);
      expect(routeAllowed("client", method, ["accounts", "L1", "tasks"]), `${method} accounts/<id>/tasks`).toBe(false);
    }
    expect(routeAllowed("client", "PUT", ["settings"])).toBe(false);
    expect(routeAllowed("client", "POST", ["settings", "purge"])).toBe(false);
    expect(routeAllowed("client", "POST", ["audit", "share"])).toBe(false);
    expect(routeAllowed("client", "GET", ["export", "stale"])).toBe(false);
  });

  it("the client menu has no page that shows fees, notes, settings, other clients or the company's controls", () => {
    for (const page of ["settings", "clients", "accounts", "team", "meetings", "cleanup", "calls", "email", "today", "roadmap-admin"]) expect(NAV_FOR.client.has(page), `client menu: ${page}`).toBe(false);
    expect(NAV_FOR.business.has("clients")).toBe(false);
  });
});

describe("who may delete all the data (N83)", () => {
  const id = (role: Role, userType: "agency" | "account", owner: boolean): Identity => ({ userId: "u", userName: "U", companyId: "c", activeLocation: userType === "account" ? "L" : null, userType, role, isAgencyOwner: owner, whitelabelDomain: null });

  it("only the agency owner, or the administrator of a business that installed it for itself", () => {
    expect(mayDeleteData(id("agency_owner", "agency", true), "agency")).toBe(true);
    expect(mayDeleteData(id("agency_admin", "agency", false), "agency")).toBe(false);
    expect(mayDeleteData(id("agency_staff", "agency", false), "agency")).toBe(false);
    expect(mayDeleteData(id("account_admin", "account", false), "business")).toBe(true);
    expect(mayDeleteData(id("account_user", "account", false), "business")).toBe(false);
    expect(mayDeleteData(id("account_admin", "account", false), "client")).toBe(false);
    expect(mayDeleteData(id("account_user", "account", false), "client")).toBe(false);
    expect(mayDeleteData(id("agency_owner", "agency", true), "business"), "an agency owner only visiting a business that installed it for itself").toBe(false);
    expect(mayDeleteData(id("agency_owner", "agency", true), "client")).toBe(false);
  });
});
