import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveLogo, emailLogoHtml, validLogoUrl } from "../brand-logo.ts";
import { parseSsoUser } from "../ghl/sso.ts";
import { parseWebhook } from "../ghl/webhook.ts";
import { buildSharePayload } from "../analytics/share-intel.ts";
import { alertEmail } from "../analytics/weekly-email.ts";
import { composeEmail } from "../notifications/compose.ts";

test("only a plain https picture address is accepted as a logo", () => {
  assert.equal(validLogoUrl(" https://cdn.brand.io/logo.png "), "https://cdn.brand.io/logo.png");
  for (const bad of ["http://cdn.brand.io/a.png", "javascript:alert(1)", "data:image/png;base64,AAA", "//cdn.brand.io/a.png", "https://cdn.brand.io/a.png?uid=1", "https://cdn.brand.io/a.png#x",
    "https://user:pw@cdn.brand.io/a.png", "https://127.0.0.1/a.png", "https://localhost/a.png", "https://cdn.brand.io:8443/a.png", "https://cdn.brand.io/a b.png", "", null, 5, "https://x.io/" + "a".repeat(600)]) {
    assert.equal(validLogoUrl(bad), null, String(bad));
  }
});

test("the owner's address wins over the detected one, and a bad one is ignored", () => {
  assert.equal(effectiveLogo("https://a.io/1.png", "https://b.io/2.png"), "https://a.io/1.png");
  assert.equal(effectiveLogo(null, "https://b.io/2.png"), "https://b.io/2.png");
  assert.equal(effectiveLogo("http://a.io/1.png", "https://b.io/2.png"), "https://b.io/2.png");
  assert.equal(effectiveLogo(null, null), null);
});

test("the logo is read from the sign-in and install white-label details", () => {
  assert.equal(parseSsoUser({ userId: "u", whitelabelDetails: { domain: "app.brand.io", logoUrl: "https://cdn.brand.io/l.png" } }).whitelabelLogoUrl, "https://cdn.brand.io/l.png");
  assert.equal(parseSsoUser({ userId: "u", whitelabelDetails: { logoUrl: "http://x.io/l.png" } }).whitelabelLogoUrl, null);
  assert.equal(parseWebhook({ type: "INSTALL", companyId: "c", whitelabelDetails: { logoUrl: "https://cdn.brand.io/l.png" } }).whitelabelLogoUrl, "https://cdn.brand.io/l.png");
  assert.equal(parseWebhook({ type: "INSTALL", companyId: "c", data: { whitelabelDetails: { logoUrl: "https://cdn.brand.io/l.png?x=1" } } }).whitelabelLogoUrl, null);
});

test("the shared audit and the emails carry the logo only when it is valid", () => {
  const src = { headline: "h", accountsScanned: 1, staleDollars: 0, estimatedDollars: null, findings: [] };
  assert.equal(buildSharePayload(src, "Acme", [], new Date(), { branded: true, logoUrl: "https://cdn.brand.io/l.png" }).brandLogoUrl, "https://cdn.brand.io/l.png");
  assert.equal(buildSharePayload(src, "Acme", [], new Date(), { branded: true, logoUrl: "http://cdn.brand.io/l.png" }).brandLogoUrl, undefined);
  const html = emailLogoHtml("https://cdn.brand.io/l.png", 'Ac"me');
  assert.match(html, /<img src="https:\/\/cdn\.brand\.io\/l\.png" alt="Ac&quot;me" height="40"/);
  assert.equal(emailLogoHtml("javascript:x", "A"), "");
  assert.match(alertEmail("Acme", [{ severity: "warning", title: "t" }], "https://x.io", undefined, "https://cdn.brand.io/l.png").html, /<img src="https:\/\/cdn\.brand\.io/);
  assert.doesNotMatch(alertEmail("Acme", [{ severity: "warning", title: "t" }], "https://x.io").html, /<img/);
  const item = { severity: "warning", title: "t", body: "", details: [], link: { view: null, locationId: null } } as never;
  assert.match(composeEmail([item], { company: "Acme", appUrl: "https://x.io", stopUrl: null, logoUrl: "https://cdn.brand.io/l.png" }).html, /<img/);
  assert.doesNotMatch(composeEmail([item], { company: "Acme", appUrl: "https://x.io", stopUrl: null }).html, /<img/);
});
