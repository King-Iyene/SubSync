import { expect, test, type Page } from "@playwright/test";

// Stage E2a in the real browser (written in parallel mode, NOT RUN there: the lead runs it after the merge). The e2e server has the real default
// switches: the Meeting notes page is OFF, Connections is on, and Zoom and Google Meet are off. All three widths run: nothing may scroll sideways.
const NAMED = /zoom|google meet/i;
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

async function openConnections(page: Page) {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.goto("/app#connections");
  await page.reload();
  // Connections is Settings, Integrations now: the old address opens that section.
  await expect(page.getByTestId("section-integrations")).toBeVisible();
  await expect(page.getByTestId("my-fathom")).toBeVisible();
}

test("the Fathom card says what happens to a call in words, and explains the 'not yet reviewed' notice plainly", async ({ page }) => {
  await openConnections(page);
  const card = page.getByTestId("my-fathom");
  await expect(card).toContainText("finds the contact by exact email");
  await expect(card).toContainText("Nothing is ever saved to a guessed contact");
  const notice = card.getByTestId("fathom-notice");
  await notice.locator("summary").click();
  await expect(notice).toContainText("review program for connected apps is new");
  await expect(notice).toContainText("It does not mean anything is wrong");
  await expect(notice).toContainText("does not keep the transcript");
  expect(flat(await page.locator("body").innerText()), "Connections names Zoom or Google Meet").not.toMatch(NAMED);
});

test("the Meeting notes page stays behind its own switch: it is not in the menu at the default state", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Meeting notes", exact: true })).toHaveCount(0);
  await openConnections(page);
  // With the page off there is no link to an inbox on the card either.
  await expect(page.getByTestId("inbox-waiting")).toHaveCount(0);
});

test("the demo has no 'Needs permission' line (it can always add notes) and nothing is left waiting after Connect", async ({ page }) => {
  await openConnections(page);
  await expect(page.getByTestId("needs-permission")).toHaveCount(0);
  await page.getByTestId("my-fathom").getByRole("button", { name: /Connect|Try again/ }).first().click();
  await expect(page.getByTestId("inline-alert").filter({ hasText: "not available in the demo" })).toBeVisible();
  await expect(page.getByText("Waiting for you...")).toHaveCount(0);
});

test("nothing scrolls sideways at this width", async ({ page }) => {
  await openConnections(page);
  await page.getByTestId("my-fathom").getByTestId("fathom-notice").locator("summary").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page is wider than the screen").toBeLessThanOrEqual(1);
});
