import assert from "node:assert/strict";
import { test } from "node:test";
import { businessKey, decideAccess, isBusinessKey, locationOfBusinessKey, NAV_FOR, routeAllowed, type Lookups } from "../access.ts";

const lookups = (o: { agency?: string[]; business?: string[]; clientView?: string[] } = {}): Lookups => ({
  agencyInstalled: async (c) => (o.agency ?? []).includes(c),
  businessInstalled: async (l) => (o.business ?? []).includes(l),
  clientViewOn: async (_c, l) => (o.clientView ?? []).includes(l),
});

test("business keys round trip", () => {
  assert.equal(businessKey("L1"), "loc:L1");
  assert.equal(isBusinessKey("loc:L1"), true);
  assert.equal(isBusinessKey("company-9"), false);
  assert.equal(locationOfBusinessKey("loc:L1"), "L1");
});

test("an agency user of an installed agency gets the agency view", async () => {
  const d = await decideAccess({ type: "agency", companyId: "C1", activeLocation: "L1" }, lookups({ agency: ["C1"] }));
  assert.deepEqual(d, { ok: true, kind: "agency", companyKey: "C1", locationId: null });
});

test("an agency user without an agency install falls back to a business install of that account", async () => {
  const d = await decideAccess({ type: "agency", companyId: "C1", activeLocation: "L1" }, lookups({ business: ["L1"] }));
  assert.deepEqual(d, { ok: true, kind: "business", companyKey: "loc:L1", locationId: "L1" });
});

test("an agency user with nothing installed is told it is not installed", async () => {
  const d = await decideAccess({ type: "agency", companyId: "C1", activeLocation: null }, lookups());
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.installed, false);
});

test("a client's staff get their own business install first", async () => {
  const d = await decideAccess({ type: "account", companyId: "C1", activeLocation: "L1" }, lookups({ agency: ["C1"], business: ["L1"], clientView: ["L1"] }));
  assert.deepEqual(d, { ok: true, kind: "business", companyKey: "loc:L1", locationId: "L1" });
});

test("a client's staff get the read-only view only when the agency switched it on", async () => {
  const on = await decideAccess({ type: "account", companyId: "C1", activeLocation: "L1" }, lookups({ agency: ["C1"], clientView: ["L1"] }));
  assert.deepEqual(on, { ok: true, kind: "client", companyKey: "C1", locationId: "L1" });
  const off = await decideAccess({ type: "account", companyId: "C1", activeLocation: "L1" }, lookups({ agency: ["C1"] }));
  assert.equal(off.ok, false);
  const other = await decideAccess({ type: "account", companyId: "C1", activeLocation: "L2" }, lookups({ agency: ["C1"], clientView: ["L1"] }));
  assert.equal(other.ok, false);
});

test("a client's staff cannot borrow another agency's switch", async () => {
  const d = await decideAccess({ type: "account", companyId: "C2", activeLocation: "L1" }, lookups({ agency: ["C1"], clientView: ["L1"] }));
  assert.equal(d.ok, false);
});

test("unknown user types and a missing location are refused", async () => {
  assert.equal((await decideAccess({ type: "bot", companyId: "C1", activeLocation: "L1" }, lookups({ agency: ["C1"] }))).ok, false);
  assert.equal((await decideAccess({ type: "account", companyId: "C1", activeLocation: null }, lookups({ agency: ["C1"] }))).ok, false);
  assert.equal((await decideAccess({ type: null, companyId: null, activeLocation: null }, lookups())).ok, false);
});

test("agency routes are open to agencies only", () => {
  for (const seg of [["clients"], ["qbr", "L1"], ["export", "clients"], ["accounts", "L1", "flags"]]) {
    assert.equal(routeAllowed("agency", "GET", seg), true);
    assert.equal(routeAllowed("business", seg[0] === "accounts" ? "PUT" : "GET", seg), false, seg.join("/"));
    assert.equal(routeAllowed("client", seg[0] === "accounts" ? "PUT" : "GET", seg), false, seg.join("/"));
  }
});

test("a client view is read-only and cannot reach settings, exports, keys or call logging", () => {
  assert.equal(routeAllowed("client", "GET", ["overview"]), true);
  assert.equal(routeAllowed("client", "GET", ["accounts", "L1"]), true);
  assert.equal(routeAllowed("client", "GET", ["pipeline-intel"]), true);
  for (const [m, seg] of [
    ["GET", ["settings"]], ["PUT", ["settings"]], ["GET", ["export", "stale"]], ["GET", ["api-keys"]], ["POST", ["api-keys"]],
    ["GET", ["call-queue"]], ["POST", ["call-outcomes"]], ["POST", ["sync"]], ["POST", ["settings", "purge"]], ["PUT", ["goals"]],
    ["GET", ["goals"]], ["GET", ["exec-summary"]], ["GET", ["daily-brief"]], ["GET", ["health"]], ["PUT", ["accounts", "L1", "tasks"]],
    ["DELETE", ["call-lists", "x"]], ["POST", ["alerts", "a1", "dismiss"]],
  ] as Array<[string, string[]]>) {
    assert.equal(routeAllowed("client", m, seg), false, `${m} ${seg.join("/")}`);
  }
});

test("a business has its own tools but never the agency pages or agency controls", () => {
  assert.equal(routeAllowed("business", "GET", ["call-queue"]), true);
  assert.equal(routeAllowed("business", "POST", ["call-outcomes"]), true);
  assert.equal(routeAllowed("business", "PUT", ["settings"]), true);
  assert.equal(routeAllowed("business", "POST", ["settings", "purge"]), true);
  assert.equal(routeAllowed("business", "PUT", ["accounts", "L1", "tasks"]), true);
  assert.equal(routeAllowed("business", "PUT", ["accounts", "L1", "flags"]), false);
  assert.equal(routeAllowed("business", "GET", ["clients"]), false);
  assert.equal(routeAllowed("business", "PUT", ["clients", "L1"]), false);
  assert.equal(routeAllowed("business", "GET", ["qbr", "L1"]), false);
  assert.equal(routeAllowed("business", "GET", ["export", "clients"]), false);
  assert.equal(routeAllowed("business", "GET", ["nope"]), false);
});

test("the menu hides agency pages from businesses and clients", () => {
  assert.equal(NAV_FOR.agency.has("clients"), true);
  assert.equal(NAV_FOR.business.has("clients"), false);
  assert.equal(NAV_FOR.business.has("accounts"), false);
  assert.equal(NAV_FOR.client.has("settings"), false);
  assert.equal(NAV_FOR.client.has("calls"), false);
});
