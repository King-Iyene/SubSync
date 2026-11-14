import assert from "node:assert/strict";
import { test } from "node:test";
import { newReportToken } from "../report-token.ts";
import { choiceDays, expiryWords, freezeReport, MAX_BYTES, REPORT_ID, REPORT_SHARE_CHOICES, validReportId, type ReportDocInput } from "../report-share.ts";

const now = new Date("2026-11-13T10:00:00Z");
const doc = (name = "Alpha"): ReportDocInput => ({
  title: "Weekly proof", scope: { pii: `${name} Plumbing`, as: "account" }, period: "week of 2026-11-02", brandName: "Acme Marketing",
  sections: [
    { heading: "Summary", stats: [{ label: "Found", value: "12" }], lines: ["12 problems were found.", { pii: "Jane Doe", as: "person" }] },
    { heading: "By client account", table: { columns: ["Client account", "Found"], rows: [[{ pii: `${name} Plumbing`, as: "account" }, "12"], [{ pii: "Beta Roofing", as: "account" }, "3"], [{ pii: `${name} Plumbing`, as: "account" }, "9"]] } },
  ],
});

test("a link id is 192 random bits written as 32 URL-safe characters, and every one is different", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const t = newReportToken();
    assert.match(t, REPORT_ID);
    assert.equal(Buffer.from(t, "base64url").length, 24, "24 bytes = 192 bits");
    seen.add(t);
  }
  assert.equal(seen.size, 2000, "no repeats");
  // every position takes many values (not a counter or a pattern)
  for (let p = 0; p < 32; p++) assert.ok(new Set([...seen].map((t) => t[p])).size > 20, `position ${p} varies`);
});

test("only a well-formed id is ever looked up", () => {
  assert.equal(validReportId(newReportToken()), true);
  for (const bad of ["", "short", "Z".repeat(31), "Z".repeat(33), `${"a".repeat(31)}!`, `${"a".repeat(30)}../`, undefined, 7, null, "a".repeat(31) + " "]) assert.equal(validReportId(bad), false, String(bad));
});

test("the expiry is 1, 7, 14 or 30 days, and anything else is 14", () => {
  assert.deepEqual([...REPORT_SHARE_CHOICES], [1, 7, 14, 30]);
  for (const d of REPORT_SHARE_CHOICES) assert.equal(choiceDays(d), d);
  for (const bad of [0, 2, 365, -1, "7", null, undefined, NaN]) assert.equal(choiceDays(bad), 14);
  assert.equal(expiryWords(new Date(now.getTime() + 5 * 86_400_000), now), "expires in 5 days");
  assert.equal(expiryWords(new Date(now.getTime() + 3_600_000), now), "expires within a day");
  assert.equal(expiryWords(new Date(now.getTime() - 1000), now), "expired");
});

test("names of people and client accounts are hidden by default: nothing of them is in what is stored", () => {
  const r = freezeReport(doc(), "weekly", false, now);
  assert.ok(r.ok);
  const text = JSON.stringify(r.report);
  for (const secret of ["Alpha", "Plumbing", "Beta", "Roofing", "Jane", "Doe"]) assert.ok(!text.includes(secret), `${secret} must not be stored`);
  assert.equal(r.report.scope, "Client account 1");
  const rows = r.report.sections[1].table!.rows;
  assert.deepEqual(rows.map((x) => x[0]), ["Client account 1", "Client account 2", "Client account 1"], "the same account always has the same number");
  assert.equal(r.report.sections[0].lines[1], "Name hidden");
  assert.equal(r.report.namesIncluded, false);
  assert.equal(r.report.brandName, "Acme Marketing", "the sender's own name stays");
  assert.equal(r.report.takenAt, now.toISOString());
});

test("names are shown only when the owner chose to include them, and the page says so", () => {
  const r = freezeReport(doc(), "weekly", true, now);
  assert.ok(r.ok);
  assert.equal(r.report.scope, "Alpha Plumbing");
  assert.equal(r.report.sections[0].lines[1], "Jane Doe");
  assert.equal(r.report.namesIncluded, true);
});

test("what is stored is plain text of a fixed size: no markup is interpreted, controls are removed, lists are cut", () => {
  const big: ReportDocInput = {
    title: "  <img src=x onerror=alert(1)>\u0000\u0007 title  ", scope: "S",
    sections: Array.from({ length: 30 }, (_, i) => ({ heading: `H${i}`, lines: Array.from({ length: 100 }, (_, j) => "x".repeat(900) + j), table: { columns: Array.from({ length: 20 }, (_, c) => `c${c}`), rows: Array.from({ length: 200 }, () => Array.from({ length: 20 }, () => "v")) } })),
    notes: Array.from({ length: 50 }, (_, i) => `n${i}`),
  };
  const r = freezeReport(big, "other", false, now);
  if (!r.ok) { assert.match(r.error, /too large/); } else {
    assert.ok(r.report.sections.length <= 12);
    assert.ok(r.report.sections.every((s) => s.lines.length <= 40 && s.lines.every((l) => l.length <= 300)));
    assert.ok(r.report.sections.every((s) => (s.table?.columns.length ?? 0) <= 8 && (s.table?.rows.length ?? 0) <= 60));
    assert.ok(r.report.notes.length <= 10);
    assert.ok(JSON.stringify(r.report).length <= MAX_BYTES);
  }
  const small = freezeReport({ title: " <b>x</b>\u0000\n\ttitle ", scope: "S", sections: [{ heading: "H", lines: ["a\u0000b"] }] }, "other", false, now);
  assert.ok(small.ok);
  assert.equal(small.report.title, "<b>x</b> title", "kept as text (the page escapes it), controls and runs of spaces cleaned");
  assert.equal(small.report.sections[0].lines[0], "a b");
});

test("an empty or malformed report is refused, never stored", () => {
  for (const bad of [null, undefined, "x", 5, {}, { title: "T" }, { title: "T", sections: [] }, { title: "", sections: [{ heading: "H", lines: ["a"] }] }, { title: "T", sections: [{}] }, { title: "T", sections: [null] }]) {
    assert.equal(freezeReport(bad, "today", false, now).ok, false, JSON.stringify(bad));
  }
});

test("a hidden-name report cannot be turned back into names by a cell shaped like text", () => {
  const sneaky: ReportDocInput = { title: "T", scope: "S", sections: [{ heading: "H", lines: [{ pii: "Secret Name" } as never, { pii: 5 } as never, { nope: "Secret Name" } as never] }] };
  const r = freezeReport(sneaky, "today", false, now);
  assert.ok(r.ok);
  assert.ok(!JSON.stringify(r.report).includes("Secret Name"));
});
