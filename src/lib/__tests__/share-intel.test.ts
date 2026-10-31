import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSharePayload, scrub } from "../analytics/share-intel.ts";

test("account names are removed from shared text, longest first, ignoring case", () => {
  assert.equal(scrub("Acme Roofing and acme are slow", ["Acme", "Acme Roofing"]), "an account and an account are slow");
  assert.equal(scrub("nothing here", ["x", ""]), "nothing here", "one-letter and empty names are ignored");
});

test("the shared payload carries totals and titles only: no detail, no rows, no names, no info items", () => {
  const p = buildSharePayload({
    headline: "Acme Roofing has $5,000 stuck", accountsScanned: 3, staleDollars: 4999.6, estimatedDollars: null,
    findings: [
      { severity: "critical", title: "12 leads at Acme Roofing waiting", count: 12, dollars: null, kind: "fact" },
      { severity: "info", title: "Good news", count: null, dollars: null, kind: "none" },
    ],
  }, "Our Agency", ["Acme Roofing"], new Date("2026-10-31T00:00:00Z"));
  assert.equal(p.headline, "an account has $5,000 stuck");
  assert.equal(p.staleDollars, 5000);
  assert.deepEqual(p.findings.map((f) => f.title), ["12 leads at an account waiting"]);
  assert.ok(!JSON.stringify(p).includes("Acme"));
  assert.deepEqual(Object.keys(p.findings[0]).sort(), ["count", "dollars", "kind", "severity", "title"]);
});
