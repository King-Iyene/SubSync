import { describe, expect, it } from "vitest";
import { NAV_FOR, routeAllowed } from "@/lib/access";
import { NAV } from "@/app/app/nav";

// Stage C1: who may call the routes of the Clients module. The whole module is for the company that manages the clients: a business and a client's staff
// never reach the fees, notes, onboarding steps, templates, comparisons or reviews of anyone. The one exception is the read-only trend of their OWN account
// (client-trends), which the router then checks against their single account like every other read.
const AGENCY_ONLY: Array<[string, string[]]> = [
  ["GET", ["clients"]], ["GET", ["clients", "compare"]], ["PUT", ["clients", "L1"]], ["GET", ["clients", "L1", "notes"]], ["POST", ["clients", "L1", "notes"]], ["DELETE", ["clients", "L1", "notes"]],
  ["GET", ["client-onboarding"]], ["GET", ["client-onboarding", "L1", "history"]], ["PUT", ["client-onboarding", "L1", "steps"]], ["POST", ["client-onboarding", "L1", "steps"]],
  ["DELETE", ["client-onboarding", "L1", "steps"]], ["PUT", ["client-onboarding", "templates"]], ["POST", ["client-onboarding", "templates", "starter"]], ["DELETE", ["client-onboarding", "templates"]],
  ["GET", ["qbr", "L1"]], ["GET", ["setup-compare"]], ["GET", ["playbooks"]], ["GET", ["export", "clients"]],
];

describe("the Clients module's routes", () => {
  it("are open to the company that manages the clients", () => {
    for (const [m, p] of AGENCY_ONLY) expect(routeAllowed("agency", m, p), `${m} /${p.join("/")}`).toBe(true);
  });
  it("are refused for a business and for a client's staff, for every method", () => {
    for (const kind of ["business", "client"] as const) for (const [m, p] of AGENCY_ONLY) expect(routeAllowed(kind, m, p), `${kind} ${m} /${p.join("/")}`).toBe(false);
  });
  it("the trend of one account is a read for each kind, and nothing under that name can be written", () => {
    for (const kind of ["agency", "business", "client"] as const) expect(routeAllowed(kind, "GET", ["client-trends", "L1"]), kind).toBe(true);
    for (const kind of ["business", "client"] as const) for (const m of ["POST", "PUT", "DELETE"]) expect(routeAllowed(kind, m, ["client-trends", "L1"]), `${kind} ${m}`).toBe(false);
  });
  it("the Clients menu entry and its tabs' old addresses: a business and a client see neither Clients nor Accounts, and only their own Setup", () => {
    for (const kind of ["business", "client"] as const) {
      expect(NAV_FOR[kind].has("clients"), `${kind} clients`).toBe(false);
      expect(NAV_FOR[kind].has("accounts"), `${kind} accounts`).toBe(false);
    }
    expect(NAV_FOR.agency.has("clients") && NAV_FOR.agency.has("accounts") && NAV_FOR.agency.has("onboarding")).toBe(true);
    const own = NAV.filter((n) => n.parent && n.showWhenLimited).map((n) => n.id);
    // Duplicates became a tab of Clean-up (C2), and a client's staff already had it before; the Clean-up writes stay closed to them (see access.ts).
    expect(own).toEqual(["onboarding", "duplicates"]);
    for (const id of own) expect(NAV_FOR.business.has(id) && NAV_FOR.client.has(id)).toBe(true);
  });
});
