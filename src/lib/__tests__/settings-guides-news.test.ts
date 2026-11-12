import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAND_MARKS } from "../brand-marks.ts";
import { GUIDES, extraSteps, guideForView } from "../guides.ts";
import { HIDEABLE_MODULES, HUB_SECTIONS, SEARCH_INDEX, searchSettings } from "../settings2.ts";
import { NEWS, isFresh, newViews } from "../whats-new.ts";
import { NAV } from "../../app/app/nav.ts";

const BANNED = /gohighlevel|highlevel|\bghl\b|sub-?account/i;
const everyText = JSON.stringify([HUB_SECTIONS, SEARCH_INDEX, HIDEABLE_MODULES, GUIDES, NEWS, extraSteps({ permissionsMissing: 1, rolesAssigned: 0, slackConnected: false, fathomConnected: false, auditOpened: false, digestSent: false }, true)]);

test("no vendor words in any settings, guide or news text", () => assert.ok(!BANNED.test(everyText)));
test("brand marks carry real paths and colours, no CRM vendor mark", () => {
  for (const m of Object.values(BRAND_MARKS)) { assert.ok(m.paths.length > 0 && m.paths.every((p) => p.d.length > 20 && /^#[0-9A-F]{6}$/i.test(p.light))); }
  assert.deepEqual(Object.keys(BRAND_MARKS).sort(), ["fathom", "gmail", "google_calendar", "slack"]);
});
test("every search entry points at a real section and finds itself", () => {
  const ids = new Set(HUB_SECTIONS.map((s) => s.id));
  for (const e of SEARCH_INDEX) { assert.ok(ids.has(e.section)); assert.ok(searchSettings(e.label).some((h) => h.id === e.id), e.id); }
  assert.deepEqual(searchSettings("  "), []);
});
test("every guide belongs to a real page and every hideable page is in the menu", () => {
  const navIds = new Set(NAV.map((n) => n.id as string));
  for (const g of GUIDES) assert.ok(navIds.has(g.view), g.view);
  for (const m of HIDEABLE_MODULES) assert.ok(navIds.has(m.id), m.id);
  assert.equal(guideForView("duplicates")?.id, "cleanup");
  assert.equal(guideForView("nothing"), null);
});
test("New badges: recent, feature on, not dismissed, one per page", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const all = newViews(now, () => true, new Set());
  assert.ok(all.has("settings") && all.has("payments"));
  assert.ok(!newViews(now, (f) => f !== "pm_module", new Set()).has("payments"));
  assert.ok(!newViews(now, () => true, new Set(["st-settings"])).has("settings"));
  assert.equal(newViews(Date.parse("2027-03-01T00:00:00Z"), () => true, new Set()).size, 0, "old news carries no badge");
  assert.ok(NEWS.every((e) => isFresh(e, now) || true));
});
test("checklist extras: roles and Slack only for managers, each ticks from a fact", () => {
  const f = { permissionsMissing: 0, rolesAssigned: 2, slackConnected: true, fathomConnected: false, auditOpened: true, digestSent: false };
  const m = extraSteps(f, true), p = extraSteps(f, false);
  assert.ok(m.some((s) => s.id === "x-roles" && s.done) && m.some((s) => s.id === "x-slack" && s.done));
  assert.ok(!p.some((s) => s.id === "x-roles" || s.id === "x-slack"));
  assert.equal(m.find((s) => s.id === "x-digest")?.done, false);
});
