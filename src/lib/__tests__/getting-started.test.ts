import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildSteps, GUIDE_TITLES, guideRoleOf, progressOf, type Facts, type GuideRole } from "../getting-started.ts";
import { isSectionId } from "../settings-sections.ts";

// N87: a guide per role, "Do it now" links, steps that tick from facts and never from a click, no step that reports company settings to a client's staff.
const none: Facts = {
  synced: false, syncDetail: "Looking for your accounts...", seen: new Set(), companyUsage: true, slackBrief: false, emailSet: false, clientViewOn: 0,
  ignoredCount: 0, testLookingCount: 0, changedKeys: new Set(), sharedAudits: 0, feedbackGiven: 0, meetingsPage: false, zoomOn: false,
};
const NAV = readFileSync(join(process.cwd(), "src/app/app/nav.ts"), "utf8");
const navIds = [...NAV.matchAll(/\{ id: "([a-z]+)", label/g)].map((m) => m[1]);
const ROLES: GuideRole[] = ["agency_owner", "agency_staff", "account_admin", "account_user"];

test("the role comes from the session's kind and the platform's own role word, and an unknown word is the least privileged", () => {
  assert.equal(guideRoleOf("agency", "admin"), "agency_owner");
  assert.equal(guideRoleOf("agency", "ADMIN"), "agency_owner");
  assert.equal(guideRoleOf("agency", "user"), "agency_staff");
  assert.equal(guideRoleOf("agency", null), "agency_staff");
  assert.equal(guideRoleOf("business", "admin"), "account_admin");
  assert.equal(guideRoleOf("business", "user"), "account_admin", "a business session is the account's administrator (staff are read-only clients)");
  assert.equal(guideRoleOf("client", "admin"), "account_user", "a read-only view is always the staff guide");
});

test("each of the four roles has its own guide with a title, short steps, and unique ids", () => {
  for (const role of ROLES) {
    const steps = buildSteps(role, none);
    assert.ok(steps.length >= 4 && steps.length <= 14, `${role}: ${steps.length} steps`);
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, `${role}: unique ids`);
    assert.ok(GUIDE_TITLES[role].title && GUIDE_TITLES[role].subtitle);
    for (const s of steps) {
      assert.ok(s.title.length <= 48, `${s.id}: short title`);
      assert.ok(s.body.length >= 30 && s.body.length <= 260, `${s.id}: a short step, not an essay (${s.body.length})`);
      assert.ok(s.art, `${s.id}: has a drawing`);
    }
  }
  assert.notDeepEqual(buildSteps("agency_owner", none).map((s) => s.id), buildSteps("account_user", none).map((s) => s.id));
});

test("every step that opens a page opens one that exists, and a Settings step names a real Settings section", () => {
  for (const role of ROLES) for (const s of buildSteps(role, none)) {
    if (s.view) { assert.ok(navIds.includes(s.view), `${role}/${s.id}: ${s.view} is a menu page`); assert.ok(s.cta, `${s.id}: a button label`); }
    if (s.section) { assert.equal(s.view, "settings"); assert.ok(isSectionId(s.section), `${s.id}: ${s.section}`); }
    if (!s.view) assert.equal(s.id, "connected", "only the first step has nothing to open");
  }
});

test("a client's staff never get a step about what the company set up: no Slack, email, targets, meeting tool, test accounts, shared audit or client access", () => {
  const ids = buildSteps("account_user", { ...none, slackBrief: true, emailSet: true, clientViewOn: 3, sharedAudits: 2, meetingsPage: true, zoomOn: true }).map((s) => s.id);
  for (const hidden of ["brief", "email", "meetings", "clients", "targets", "tests", "share"]) assert.ok(!ids.includes(hidden), hidden);
  for (const s of buildSteps("account_user", { ...none, slackBrief: true, emailSet: true })) assert.doesNotMatch(s.detail ?? "", /Slack|@/);
});

test("steps tick from facts: opened pages, saved settings, connected channels, an audit shared, an account left out; never from a click", () => {
  const done = (role: GuideRole, f: Partial<Facts>, id: string) => buildSteps(role, { ...none, ...f }).find((s) => s.id === id)!.done;
  assert.equal(done("agency_owner", {}, "connected"), true);
  assert.equal(done("agency_owner", {}, "synced"), false);
  assert.equal(done("agency_owner", { synced: true }, "synced"), true);
  assert.equal(done("agency_owner", {}, "today"), false);
  assert.equal(done("agency_owner", { seen: new Set(["today"]) }, "today"), true);
  assert.equal(done("account_user", { seen: new Set(["myday"]) }, "today"), true, "My day counts for the staff's first step");
  assert.equal(done("agency_owner", {}, "speed"), false);
  assert.equal(done("agency_owner", { seen: new Set(["speed"]) }, "speed"), true);
  assert.equal(done("agency_owner", { seen: new Set(["people"]) }, "search"), true, "People holds contact search");
  assert.equal(done("agency_owner", { seen: new Set(["search"]) }, "search"), true);
  assert.equal(done("agency_owner", {}, "targets"), false);
  assert.equal(done("agency_owner", { changedKeys: new Set(["brandName"]) }, "targets"), false, "a brand change is not a target");
  assert.equal(done("agency_owner", { changedKeys: new Set(["slaHours"]) }, "targets"), true);
  assert.equal(done("agency_owner", { slackBrief: true }, "brief"), true);
  assert.equal(done("agency_owner", { emailSet: true }, "email"), true);
  assert.equal(done("agency_owner", { clientViewOn: 1 }, "clients"), true);
  assert.equal(done("agency_owner", {}, "client_fees"), false, "no fee typed yet");
  assert.equal(done("agency_owner", { clientFees: 2 }, "client_fees"), true);
  assert.equal(buildSteps("agency_owner", { ...none, clientsPage: false }).some((s) => s.id === "client_fees"), false, "no step for a page that is switched off");
  assert.equal(buildSteps("account_admin", none).some((s) => s.id === "client_fees"), false, "a business has no clients to bill");
  assert.equal(done("agency_owner", {}, "share"), false);
  assert.equal(done("agency_owner", { sharedAudits: 1 }, "share"), true);
  assert.equal(done("agency_owner", { testLookingCount: 2 }, "tests"), false, "two accounts look like test accounts and nothing is left out yet");
  assert.equal(done("agency_owner", { testLookingCount: 2, ignoredCount: 2 }, "tests"), true);
  assert.equal(done("agency_owner", { testLookingCount: 0 }, "tests"), true, "nothing to do is done");
  assert.equal(done("agency_owner", {}, "feedback"), false);
  assert.equal(done("agency_owner", { feedbackGiven: 1 }, "feedback"), true);
});

test("for a client's staff the company counter is not used (it is the agency's), and the page ticks from this browser instead", () => {
  const f = { ...none, companyUsage: false, seen: new Set(["today", "speed", "appointments", "myday"]) };
  const steps = buildSteps("account_user", f);
  for (const id of ["today", "speed", "appointments"]) assert.equal(steps.find((s) => s.id === id)!.done, false, `${id} is not ticked from the agency's counter`);
  for (const id of ["today", "speed", "appointments"]) assert.ok((steps.find((s) => s.id === id)!.ticksOn ?? []).length > 0, `${id} can be ticked from this browser`);
});

test("the detail lines say what is true: test accounts, shared audits and the sync", () => {
  const t = buildSteps("agency_owner", { ...none, testLookingCount: 1 }).find((s) => s.id === "tests")!;
  assert.match(t.detail ?? "", /1 account looks like a test account/);
  assert.match(buildSteps("agency_owner", { ...none, testLookingCount: 3 }).find((s) => s.id === "tests")!.detail ?? "", /3 accounts look like test accounts/);
  assert.match(buildSteps("agency_owner", { ...none, ignoredCount: 2 }).find((s) => s.id === "tests")!.detail ?? "", /2 accounts are left out/);
  assert.equal(buildSteps("agency_owner", { ...none, syncDetail: "3 accounts read." }).find((s) => s.id === "synced")!.detail, "3 accounts read.");
});

test("the meeting step exists only while the Meeting notes page is on, and names a tool only while it is switched on", () => {
  assert.ok(!buildSteps("agency_owner", none).some((s) => s.id === "meetings"));
  const on = buildSteps("agency_owner", { ...none, meetingsPage: true }).find((s) => s.id === "meetings")!;
  assert.match(on.body, /Fathom/);
  assert.doesNotMatch(on.body, /Zoom/);
  assert.match(buildSteps("agency_owner", { ...none, meetingsPage: true, zoomOn: true }).find((s) => s.id === "meetings")!.body, /Zoom/);
  assert.match(on.body, /exactly one contact|matches one contact|guest matches/i, "says the same true thing about writing to the CRM as every other screen");
});

test("progress counts what is done", () => {
  const steps = buildSteps("agency_owner", { ...none, synced: true, seen: new Set(["today"]) });
  // connected, synced and today, plus the test-account step, which is done because nothing looks like a test account.
  assert.deepEqual(progressOf(steps), { done: 4, total: steps.length });
});
