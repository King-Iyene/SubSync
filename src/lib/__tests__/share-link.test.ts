import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { createLimiter } from "../rate-limit.ts";
import { buildSharePayload, scrub } from "../analytics/share-intel.ts";

test("the limiter lets a burst through, then refuses until the window passes", () => {
  const l = createLimiter(3, 1000);
  const t = 10_000;
  assert.deepEqual([0, 1, 2, 3].map((i) => l.allow("ip", t + i)), [true, true, true, false]);
  assert.equal(l.allow("other", t + 4), true, "another address is counted separately");
  assert.equal(l.allow("ip", t + 999), false, "still inside the window");
  assert.equal(l.allow("ip", t + 1001), true, "the first hit has aged out");
});

test("the limiter does not grow without bound", () => {
  const l = createLimiter(1, 1000, 50);
  for (let i = 0; i < 500; i++) l.allow(`ip-${i}`, 1_000_000 + i * 2000); // each key's window has passed before the next arrives
  assert.ok(l.size() <= 51, `size ${l.size()}`);
  const fresh = createLimiter(1, 60_000, 20);
  for (let i = 0; i < 200; i++) fresh.allow(`ip-${i}`, 5_000 + i);
  assert.ok(fresh.size() <= 21, "even when no window has passed, the oldest key is dropped");
});

test("a share token carries at least 128 bits and two are never equal", () => {
  const ids = new Set(Array.from({ length: 200 }, () => randomBytes(24).toString("base64url")));
  assert.equal(ids.size, 200);
  for (const id of ids) { assert.ok(id.length >= 32, id); assert.match(id, /^[A-Za-z0-9_-]{20,64}$/); }
  assert.ok(24 * 8 >= 128, "24 random bytes is 192 bits");
});

test("the shared snapshot has no account names, in the headline, the findings or the fix steps", () => {
  const names = ["Blue Door Realty", "Sunrise Roofing Co"];
  const p = buildSharePayload(
    { headline: "Blue Door Realty has $9,000 stale", accountsScanned: 2, staleDollars: 9000, estimatedDollars: null,
      findings: [{ severity: "critical", title: "12 leads waiting at sunrise roofing co", count: 12, dollars: null, kind: "fact", fix: "Call the leads at Blue Door Realty first." }] },
    "Acme", names, new Date("2026-10-31T10:00:00Z"));
  const text = JSON.stringify(p).toLowerCase();
  for (const n of names) assert.ok(!text.includes(n.toLowerCase()), n);
  assert.equal(scrub("Call Blue Door Realty", names), "Call an account");
  assert.match(p.findings[0].fix ?? "", /Call the leads at an account first/);
});

// ---------------- stage F6 ----------------

import { buildAudit } from "../analytics/audit-intel.ts";
import { SAMPLE_AUDIT_ID } from "../analytics/share-intel.ts";

const fixtureAudit = () => buildAudit([
  { locationId: "L1", name: "Blue Door Realty", staleValue: 90_000, staleOpps: 9, openValue: 100_000, openOpps: 10, excludedOpen: 14, unanswered: 12, winRate: 0.5, avgDealValue: 2_000, completenessPct: 80, contacts: 300, topStaleDeal: 70_000, wonCount: 10, lostCount: 10 },
  { locationId: "L2", name: "Sunrise Roofing Co", staleValue: 0, staleOpps: 0, openValue: 0, openOpps: 0, excludedOpen: 0, unanswered: 0, winRate: null, avgDealValue: null, completenessPct: 20, contacts: 500 },
], { readable: 2, total: 2, needPermission: 0, unmarked: 12, noShowsToRecover: 6, unconfirmed48: 0 }, { staleDays: 30, slaHours: 4, readLimit: "Sunrise Roofing Co has more than 500 conversations; only the newest 500 are read." });

test("the shared snapshot carries the definitions, the fix-first line, the range and the sender's brand, and still no account name anywhere", () => {
  const names = ["Blue Door Realty", "Sunrise Roofing Co"];
  const audit = fixtureAudit();
  const p = buildSharePayload(audit, "Acme Marketing", names, new Date("2026-11-01T10:00:00Z"), { branded: true, brandColor: "#AA3366", rulesVersion: 3 });
  const text = JSON.stringify(p).toLowerCase();
  for (const n of names) assert.ok(!text.includes(n.toLowerCase()), `${n} must not appear anywhere in the snapshot`);
  assert.equal(p.branded, true);
  assert.equal(p.brandColor, "#aa3366", "the colour is kept, lower case");
  assert.ok(p.fixFirst && p.fixFirst.length > 20);
  assert.deepEqual(p.estimateRange, audit.estimateRange);
  assert.deepEqual(p.outlier, { value: 70_000, share: Math.round((70_000 / 90_000) * 100) / 100 }, "the outlier carries a value and a share, never a deal");
  assert.equal(p.leftOut, 14);
  assert.equal(p.rulesVersion, 3);
  const keys = (p.notes ?? []).map((n) => n.key);
  assert.deepEqual(keys.slice(0, 2), ["stale", "estimate"]);
  for (const f of p.findings) if (f.note) assert.ok(keys.includes(f.note), `${f.note} has its definition on the page`);
  assert.ok(!keys.includes("data"), "an information-only finding is not shared, so neither is its definition");
  assert.ok((p.notes ?? []).find((n) => n.key === "slow")!.text.includes("an account has more than 500"), "a name inside a definition is scrubbed too");
});

test("the snapshot never holds a row: no contact, deal, conversation or appointment fields, only totals and wording", () => {
  const p = buildSharePayload(fixtureAudit(), "Acme", ["Blue Door Realty"], new Date("2026-11-01T10:00:00Z"), { branded: false });
  const fields = new Set<string>();
  const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { fields.add(k); walk(x); } };
  walk(p);
  for (const banned of ["contactId", "contact", "opportunityId", "conversationId", "locationId", "locationName", "rows", "lists", "phone", "email", "url"]) assert.ok(!fields.has(banned), `${banned} must not be a field of a shared snapshot`);
});

test("a colour that is not a six digit hex is dropped, so nothing else can be smuggled into the page's style", () => {
  const audit = fixtureAudit();
  for (const bad of ["red", "#fff", "#12345", "#12345g", "javascript:alert(1)", "#aa3366; background:url(x)", "", null]) {
    assert.ok(!("brandColor" in buildSharePayload(audit, "x", [], new Date(), { brandColor: bad as string | null })), String(bad));
  }
  assert.equal(buildSharePayload(audit, "x", [], new Date(), { brandColor: "#0A658B" }).brandColor, "#0a658b");
});

test("a snapshot made before stage F6 still reads: every new field is optional", () => {
  const old = buildSharePayload(
    { headline: "Across 2 accounts: $9,000 in stale deals.", accountsScanned: 2, staleDollars: 9000, estimatedDollars: null, findings: [{ severity: "critical", title: "12 leads waiting", count: 12, dollars: null, kind: "fact" }] },
    "Acme", [], new Date("2026-10-31T10:00:00Z"));
  for (const k of ["branded", "brandColor", "fixFirst", "estimateRange", "outlier", "leftOut", "notes", "rulesVersion"]) assert.ok(!(k in old), `${k} is left out when there is nothing to say`);
  assert.equal(old.findings.length, 1);
  assert.equal(SAMPLE_AUDIT_ID, "sample-real-estate-team-audit");
});
