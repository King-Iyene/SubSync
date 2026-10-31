import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSsoUser } from "../ghl/sso.ts";
import { crmUrl, deepLinks, DEFAULT_APP_DOMAIN, validDomain } from "../links.ts";

test("links use the agency's own domain and fall back to the default only when none is known", () => {
  assert.equal(deepLinks("crm.brandedagency.com").contact("LOC1", "C1"), "https://crm.brandedagency.com/v2/location/LOC1/contacts/detail/C1");
  assert.equal(deepLinks("crm.brandedagency.com").conversation("LOC1", "X"), "https://crm.brandedagency.com/v2/location/LOC1/conversations/conversations/X");
  assert.ok(deepLinks(null).account("LOC1").startsWith(`https://${DEFAULT_APP_DOMAIN}/`));
  assert.ok(deepLinks("not a domain").account("LOC1").startsWith(`https://${DEFAULT_APP_DOMAIN}/`), "a bad domain never reaches a link");
  assert.ok(deepLinks("evil.com/x?").account("LOC1").startsWith(`https://${DEFAULT_APP_DOMAIN}/`), "paths and queries are refused");
});

test("only a plain host name is accepted as a domain", () => {
  assert.equal(validDomain(" CRM.Agency.com "), "crm.agency.com");
  for (const bad of ["https://crm.agency.com", "crm.agency.com/path", "crm agency.com", "localhost", "crm.agency.com:8080", "", null, 42, "-bad.com", "a".repeat(260) + ".com"]) assert.equal(validDomain(bad), null, String(bad));
});

test("the white-label domain is read from the sign-in details", () => {
  assert.equal(parseSsoUser({ userId: "u", whitelabelDetails: { domain: "app.brand.io", logoUrl: "https://x/y.png" } }).whitelabelDomain, "app.brand.io");
  assert.equal(parseSsoUser({ userId: "u", whitelabelDetails: { domain: "https://app.brand.io/login" } }).whitelabelDomain, null, "a URL is not a domain");
  assert.equal(parseSsoUser({ userId: "u" }).whitelabelDomain, null);
  assert.equal(parseSsoUser(null).whitelabelDomain, null);
});


test("crmUrl builds every CRM link from the signed-in identity, or the saved domain, and only falls back when neither exists", () => {
  const identity = { whitelabelDomain: "app.brand.io" };
  assert.equal(crmUrl(identity, "/v2/location/L1/dashboard"), "https://app.brand.io/v2/location/L1/dashboard");
  assert.equal(crmUrl({ whitelabelDomain: "app.brand.io", appDomain: "crm.typed.com" }, "/x"), "https://crm.typed.com/x", "what the agency typed in Settings wins");
  assert.equal(crmUrl({ whitelabelDomain: null, appDomain: null }, "/x"), `https://${DEFAULT_APP_DOMAIN}/x`);
  assert.equal(crmUrl({ whitelabelDomain: "not a domain" }, "/x"), `https://${DEFAULT_APP_DOMAIN}/x`);
  assert.equal(crmUrl("crm.brand.io", "x"), "https://crm.brand.io/x", "a missing leading slash is added");
  assert.equal(crmUrl("crm.brand.io", "//evil.com/x"), "https://crm.brand.io/evil.com/x", "the path can never change the host");
  assert.equal(crmUrl("crm.brand.io", "/a b"), "https://crm.brand.io/", "a path with spaces is dropped");
  assert.equal(crmUrl(undefined, "/x"), `https://${DEFAULT_APP_DOMAIN}/x`);
});

test("a white-label domain never leaks the default host into any deep link", () => {
  const links = deepLinks({ whitelabelDomain: "crm.fakebrand.test" });
  for (const url of [links.account("L1"), links.contact("L1", "C1"), links.opportunities("L1"), links.conversation("L1", "V1")]) {
    assert.ok(url.startsWith("https://crm.fakebrand.test/"), url);
    assert.ok(!url.includes(DEFAULT_APP_DOMAIN), url);
  }
});
