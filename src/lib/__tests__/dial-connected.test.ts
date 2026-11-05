import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplateUrl, dialPlan, parseChoice, validateTemplate } from "../people/dial.ts";

test("a good template is accepted and filled with the encoded number and email", () => {
  const t = "https://dialer.example.com/call?to={phone}&who={email}";
  assert.equal(validateTemplate(t).ok, true);
  assert.equal(buildTemplateUrl(t, { phone: "+1 (555) 010-2030", email: "a+b@x.com" }), "https://dialer.example.com/call?to=%2B15550102030&who=a%2Bb%40x.com");
  assert.equal(buildTemplateUrl("https://d.example.com/{phone}", { phone: null }), null);
  assert.equal(buildTemplateUrl("https://d.example.com/c?e={email}", { phone: "+15550102030", email: "nope" }), null);
});

test("unsafe or odd templates are refused", () => {
  for (const bad of ["http://d.example.com/{phone}", "javascript:alert({phone})", "data:text/html,{phone}", "tel:{phone}", "https://user:pw@d.example.com/{phone}", "https://{phone}.evil.com/", "https://d.example.com/{phone}{name}", "https://d.example.com/call", "https://d example.com/{phone}", "https://localhost/{phone}", "", "https://d.example.com/" + "a".repeat(500) + "{phone}"]) {
    assert.equal(validateTemplate(bad).ok, false, bad);
    assert.equal(buildTemplateUrl(bad, { phone: "+15550102030" }), null, bad);
  }
  assert.equal(validateTemplate(42).ok, false);
});

test("the three ways to call", () => {
  const v = { phone: "+15550102030", contactUrl: "https://crm.example/contacts/1" };
  assert.equal(dialPlan("crm", v).href, v.contactUrl);
  assert.equal(dialPlan({ provider: "phone" }, v).href, "tel:+15550102030");
  const c = dialPlan({ provider: "connected", vendor: "Kixie", template: "https://k.example.com/dial?n={phone}" }, v);
  assert.equal(c.href, "https://k.example.com/dial?n=%2B15550102030");
  assert.equal(c.label, "Call with Kixie");
  assert.match(c.note, /not SubSync/);
  assert.equal(dialPlan({ provider: "connected", template: "http://bad/{phone}" }, v).href, null);
});

test("a stored choice that is not valid falls back to the CRM's dialer", () => {
  assert.deepEqual(parseChoice({ provider: "connected", vendor: "Dialpad", template: "https://x.example.com/{phone}" }), { provider: "connected", vendor: "Dialpad", template: "https://x.example.com/{phone}" });
  assert.deepEqual(parseChoice({ provider: "connected", template: "http://x/{phone}" }), { provider: "crm" });
  assert.deepEqual(parseChoice({ provider: "phone" }), { provider: "phone" });
  assert.deepEqual(parseChoice(null), { provider: "crm" });
  assert.equal((parseChoice({ provider: "connected", vendor: "Evil", template: "https://x.example.com/{phone}" }) as { vendor: string }).vendor, "Other");
});
