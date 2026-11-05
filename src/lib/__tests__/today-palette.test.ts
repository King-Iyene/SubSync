import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeTodayView, filterCommands, sanitizeTodayView, todayViewName } from "../analytics/today-palette.ts";

const cmds = [
  { group: "Go to", title: "Fix first", hint: "The queue", keywords: "queue" },
  { group: "Open list", title: "Leads waiting now", hint: "13 leads" },
  { group: "Client", title: "Bright Smile Dental", keywords: "account" },
  { group: "Do", title: "Print the report", keywords: "pdf paper" },
];

describe("the command palette filter", () => {
  it("returns everything in the page's order for an empty query", () => assert.deepEqual(filterCommands(cmds, "  ").map((c) => c.title), cmds.map((c) => c.title)));
  it("needs every typed word somewhere in the line, in any order", () => {
    assert.deepEqual(filterCommands(cmds, "dental bright").map((c) => c.title), ["Bright Smile Dental"]);
    assert.deepEqual(filterCommands(cmds, "bright zzz"), []);
  });
  it("finds by keyword and by group, ignoring case and accents", () => {
    assert.deepEqual(filterCommands(cmds, "PDF").map((c) => c.title), ["Print the report"]);
    assert.deepEqual(filterCommands(cmds, "open list").map((c) => c.title), ["Leads waiting now"]);
    assert.deepEqual(filterCommands([{ group: "x", title: "Café" }], "cafe").length, 1);
  });
  it("puts a title that starts with the word before one that only contains it", () => {
    const r = filterCommands([{ group: "g", title: "Show leads" }, { group: "g", title: "Leads first" }], "leads");
    assert.deepEqual(r.map((c) => c.title), ["Leads first", "Show leads"]);
  });
});

describe("saved views of Today", () => {
  it("keeps only well formed account ids, without repeats, and a real boolean", () => {
    const v = sanitizeTodayView({ accounts: ["abc123", "abc123", "../x", 5, "ok_ok-1", "a"], excludeJunk: "yes", extra: "<script>" });
    assert.deepEqual(v, { accounts: ["abc123", "ok_ok-1"], excludeJunk: false });
    assert.deepEqual(sanitizeTodayView(null), { accounts: [], excludeJunk: false });
    assert.equal(sanitizeTodayView({ excludeJunk: true }).excludeJunk, true);
  });
  it("caps the accounts a view may hold", () => assert.equal(sanitizeTodayView({ accounts: Array.from({ length: 80 }, (_, i) => `acct${i + 100}`) }).accounts.length, 50));
  it("accepts a name of 1 to 40 characters and refuses the rest", () => {
    assert.equal(todayViewName("  Clinics\n only "), "Clinics only");
    assert.equal(todayViewName(""), null);
    assert.equal(todayViewName("x".repeat(41)), null);
    assert.equal(todayViewName(7), null);
  });
  it("describes a view in plain words", () => {
    const names = new Map([["abc123", "Bright Smile Dental"]]);
    assert.equal(describeTodayView({ accounts: [], excludeJunk: false }, names), "All clients");
    assert.equal(describeTodayView({ accounts: ["abc123"], excludeJunk: true }, names), "Bright Smile Dental, leaving out test and very old deals");
    assert.equal(describeTodayView({ accounts: ["a1b2c3", "d4e5f6"], excludeJunk: false }, names), "2 clients");
  });
});
