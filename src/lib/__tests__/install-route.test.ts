import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildInstallUrl } from "../ghl/scopes.ts";
import { installTarget, validListingUrl } from "../install-redirect.ts";
import { validDomain } from "../links.ts";
import { PRICING } from "../site/config.ts";
import { cost, margin, PRICE_CENTS } from "../site/pricing-calc.ts";

const ROOT = process.cwd();

test("/install is built from the install URL the app already builds, and a configured listing link wins", () => {
  const t = installTarget({ clientId: "client123", redirectUri: "https://example.test/api/oauth/callback" }, buildInstallUrl);
  assert.equal(t.source, "install-url");
  assert.equal(t.href, buildInstallUrl("client123", "https://example.test/api/oauth/callback"));
  const listing = installTarget({ listingUrl: "https://market.example.com/app/subsync", clientId: "client123", redirectUri: "https://example.test/cb" }, buildInstallUrl);
  assert.equal(listing.source, "listing");
  assert.equal(listing.href, "https://market.example.com/app/subsync");
  assert.equal(installTarget({}, buildInstallUrl).href, "/support#install", "not configured: the Support steps, never a made-up address");
});

test("a bad listing link is ignored, and the domain helper accepts a host only", () => {
  for (const bad of ["http://market.example.com/x", "https://user:pw@market.example.com/", "https://market.example.com:8443/", "javascript:alert(1)", "https://localhost/x", "//evil.example", "https://a b.example/"]) assert.equal(validListingUrl(bad), null, bad);
  for (const bad of ["https://app.agency.example", "app.agency.example/path", "app.agency.example?x=1", "javascript:alert(1)", "agency", "app agency.example", ]) assert.equal(validDomain(bad), null, bad);
  assert.equal(installTarget({ crm: "127.0.0.1" }, buildInstallUrl).crmDomain, null, "no IP address");
  assert.equal(validDomain("app.theiragency.com"), "app.theiragency.com");
  const t = installTarget({ clientId: "c", redirectUri: "https://example.test/cb", crm: "app.theiragency.com/evil" }, buildInstallUrl);
  assert.equal(t.crmDomain, null);
});

test("the /install route never logs, and puts no secret of its own in the address", () => {
  const src = readFileSync(join(ROOT, "src/app/install/route.ts"), "utf8");
  assert.doesNotMatch(src, /console\./);
  assert.doesNotMatch(src, /CLIENT_SECRET|TOKEN|SHARED_SECRET/);
});

test("pricing numbers come from the one source and the examples add up", () => {
  assert.equal(PRICE_CENTS, Math.round(Number(PRICING.amount) * 100));
  assert.equal(PRICING.price, `$${PRICING.amount}`);
  assert.equal(cost(1), 1150);
  assert.equal(cost(20), 23000);
  assert.equal(margin(20, 2300), 23000);
  assert.equal(margin(20, 1000), 0, "below the cost price there is no margin");
  const ent = readFileSync(join(ROOT, "src/lib/entitlements-core.ts"), "utf8");
  assert.match(ent, /\$11\.50 per client account per month/);
  assert.match(ent, /14-day free trial/);
  const page = readFileSync(join(ROOT, "src/app/pricing/page.tsx"), "utf8");
  assert.doesNotMatch(page, /11\.50/, "the price is not typed on the pricing page");
});
