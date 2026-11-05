import { expect, test, type Page } from "@playwright/test";

// The MOAT stage (work inside SubSync): the lead panel opens from People, Duplicates and the Pipeline board; composing a message in the demo is a dry run with a preview and a confirm
// (nothing is ever sent); the Pipeline is money first (a headline, a board, the pipelines behind one gear); and no page scrolls sideways on a phone. The demo company has sample data,
// so these read what is on screen. Every call of the demo signs it in again, so a step can take many seconds on a slow machine.
test.beforeEach(() => { test.setTimeout(300_000); });

async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}

test("the lead panel opens from People", async ({ page }) => {
  await page.goto("/app#people");
  await expect(page.getByTestId("person-name").first()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("person-name").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("wb-tab-conversation")).toBeVisible();
  await expect(page.getByTestId("drawer-call")).toBeVisible();
  await noSideScroll(page, "People with the panel open");
});

test("composing a message in the demo is a preview, then a confirmed dry run", async ({ page }) => {
  await page.goto("/app#people");
  await expect(page.getByTestId("person-name").first()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("person-name").first().click();
  await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 120_000 });
  // A person who asked not to be contacted has no composer: step on to one who did not.
  for (let i = 0; i < 8 && (await page.getByTestId("wb-composer").count()) === 0; i++) {
    await page.getByTestId("drawer-next").click();
    await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 120_000 });
  }
  await expect(page.getByTestId("wb-composer")).toBeVisible();
  await page.getByTestId("wb-template").selectOption({ index: 1 });
  await expect(page.getByTestId("wb-text")).not.toHaveValue("");
  await page.getByTestId("wb-preview").click();
  await expect(page.getByTestId("wb-review")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("wb-review-summary")).toContainText("Send this");
  await expect(page.getByTestId("wb-review-quote")).not.toBeEmpty();
  await expect(page.getByTestId("wb-review-dry")).toContainText("nothing is ever sent");
  await page.getByTestId("wb-confirm").click();
  await expect(page.getByTestId("wb-result")).toHaveAttribute("data-tone", "dry", { timeout: 120_000 });
  await expect(page.getByTestId("wb-result")).toContainText("would have happened");
  await noSideScroll(page, "Composer review");
});

test("the Call panel shows the number, says what the CRM cannot do, and offers outcomes", async ({ page }) => {
  await page.goto("/app#people");
  await expect(page.getByTestId("person-name").first()).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("person-name").first().click();
  await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 120_000 });
  for (let i = 0; i < 8 && (await page.getByTestId("drawer-call").isDisabled()); i++) {
    await page.getByTestId("drawer-next").click();
    await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 120_000 });
  }
  await page.getByTestId("drawer-call").click();
  await expect(page.getByTestId("wb-call")).toBeVisible();
  if ((await page.getByTestId("wb-call-dnd").count()) === 0) {
    await expect(page.getByTestId("wb-call-number")).toContainText(/\d/);
    await expect(page.getByTestId("wb-call-crm")).toContainText(/Call in your CRM|Call with your phone app/);
    await expect(page.getByTestId("wb-out-no_answer")).toBeVisible();
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  }
});

test("Duplicates: Show lead opens the shared lead panel", async ({ page }) => {
  await page.goto("/app#duplicates");
  await expect(page.getByTestId("dup-show").first()).toBeVisible({ timeout: 150_000 });
  await page.getByTestId("dup-show").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 120_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lead-drawer")).toHaveCount(0);
  await noSideScroll(page, "Duplicates");
});

test("Pipeline: one headline, one action, a board by stage, pipelines behind a gear, a deal opens in the panel", async ({ page }) => {
  await page.goto("/app#pipeline");
  await expect(page.getByTestId("board-headline")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId("board-total")).toContainText("$");
  await expect(page.getByTestId("board-headline")).toContainText(/open across \d+ deal/);
  await expect(page.getByTestId("board-stage").first()).toBeVisible();
  await expect(page.getByTestId("board-forecast")).toBeVisible();
  // The twenty-five In use dropdowns are not on the page: they live behind the gear.
  await expect(page.getByRole("combobox", { name: /in use or not/ })).toHaveCount(0);
  await noSideScroll(page, "Pipeline");
  await page.getByTestId("pipelines-gear").click();
  await expect(page.getByTestId("pipelines-drawer")).toBeVisible();
  await expect(page.getByTestId("pipelines-search")).toBeVisible();
  await noSideScroll(page, "Pipelines drawer");
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("board-card").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await expect(page.getByTestId("wb-tab-deals")).toHaveAttribute("aria-selected", "true", { timeout: 120_000 });
  await expect(page.getByTestId("wb-deal").first()).toBeVisible();
  await noSideScroll(page, "Deal panel");
});
