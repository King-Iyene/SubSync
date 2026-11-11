import { expect, test } from "@playwright/test";
import { api } from "./today-helpers";

// Unanswered messages, round 3 slice B (actions). Every action is behind its own flag that is OFF by default (the e2e server runs the real defaults), so this proves the safe
// default for all roles: nothing new is offered, every action endpoint is refused as "not switched on", and the existing screen is unchanged. The switched-on behaviour (preview,
// dry run, typed confirmation, protected people kept) is covered by the unit tests (src/lib/__tests__/unanswered-actions.test.ts) and the database test (tests/unit/unanswered-actions-db.test.ts).
const ROLES = [undefined, "business", "client"] as const;
const WRITES: Array<[string, Record<string, unknown>]> = [
  ["inbox/act/snooze", { locationId: "xtestLoc", conversationIds: ["xtest-conv"], reason: "other", duration: "h1" }],
  ["inbox/act/unsnooze", { locationId: "xtestLoc", conversationIds: ["xtest-conv"] }],
  ["inbox/act/claim", { locationId: "xtestLoc", conversationId: "xtest-conv", step: "preview" }],
  ["inbox/act/assign", { locationId: "xtestLoc", conversationIds: ["xtest-conv"], ownerId: "xtest-user", step: "preview" }],
  ["inbox/act/note", { locationId: "xtestLoc", contactId: "xtest-contact", text: "hello", step: "preview" }],
  ["inbox/act/outcome", { locationId: "xtestLoc", conversationId: "xtest-conv", outcome: "not_a_lead" }],
  ["inbox/act/clear", { locationId: "xtestLoc", conversationIds: ["xtest-conv"], step: "preview" }],
];

for (const role of ROLES) {
  test(`${role ?? "agency"}: the new actions are off by default and every action endpoint refuses`, async ({ request }) => {
    test.setTimeout(180_000);
    const a = await api(request, role);
    const caps = await a.get("inbox/act/caps");
    for (const k of ["openLead", "claim", "assign", "note", "outcome", "clearJunk", "snooze", "hide"]) expect(caps[k], k).toBe(false);
    expect(await a.status("inbox/act/hidden")).toBe(404);
    expect(await a.status("inbox/act/team?locationId=xtestLoc")).toBe(404);
    for (const [path, data] of WRITES) {
      const r = await a.post(path, data);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i);
    }
  });
}

test("the Unanswered screen still loads with the actions off and shows no new buttons", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/app#inbox");
  await page.reload();
  await expect(page.getByTestId("wait-headline")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("act-select")).toHaveCount(0);
  await expect(page.getByTestId("hidden-people")).toHaveCount(0);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, "no sideways scroll").toBeLessThanOrEqual(innerWidth + 1);
});
