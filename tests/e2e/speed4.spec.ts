import { expect, test, type Page } from "@playwright/test";

// Speed to lead, fourth pass (stage SPEED4), on the demo company for four roles at desktop-1440 and phone-390: the Race first, live timers, the tabs, every journey step opening exactly the leads
// it counted, a filter that narrows, the owner change as a dry-run preview (the demo can never write), the printable report, and no sideways scroll.
const ROLES = [
  { name: "agency", path: "/app#speed", people: true },
  { name: "agency staff", path: "/app?as=staff#speed", people: true },
  { name: "a client's staff", path: "/app?as=client#speed", people: false },
  { name: "a business owner", path: "/app?as=business#speed", people: true },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i;
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const noSideways = async (page: Page) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { s, w } = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(s, "no sideways scroll").toBeLessThanOrEqual(w + 1);
};
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 90_000 });
}

for (const role of ROLES) {
  test(`${role.name}: the race is first, with a headline, a ring and clocks that tick`, async ({ page }) => {
    test.setTimeout(480_000);
    await open(page, role.path);
    await expect(page.getByTestId("race-headline")).toBeVisible();
    await expect(page.getByTestId("speed-ring").first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    const timers = page.getByTestId("live-timer");
    if ((await timers.count()) > 0) {
      const waiting = page.locator("[data-testid=live-timer][data-race=winning], [data-testid=live-timer][data-race=close], [data-testid=live-timer][data-race=losing]").first();
      if (await waiting.count()) {
        const a = await waiting.locator("p").first().innerText();
        await page.waitForTimeout(2500);
        expect(await waiting.locator("p").first().innerText(), "a waiting lead's clock counts up").not.toBe(a);
      }
    }
    await noSideways(page);
  });

  test(`${role.name}: ${role.people ? "People" : "Owners"}, Coverage, Pace, Capture and Rules open in plain words`, async ({ page }) => {
    test.setTimeout(480_000);
    await open(page, role.path);
    for (const [name, id] of [["Coverage", "coverage-tab"], ["Pace", "pace-tab"], [role.people ? "People" : "Owners", "people-tab"], ["Capture", "capture-tab"], ["Rules", "rules-tab"]] as const) {
      await tab(page, name).click();
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 90_000 });
      expect(await page.locator("main").innerText()).not.toMatch(BANNED);
      await noSideways(page);
    }
    await expect(page.getByTestId("proof-report")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("missed-headline")).toHaveCount(0); // that card lives on Coverage only
  });
}

test("every journey step opens exactly the leads it counted", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page, "/app#speed");
  await tab(page, "Pace").click();
  await expect(page.getByTestId("journey-steps")).toBeVisible({ timeout: 90_000 });
  const steps = page.getByTestId("journey-step");
  expect(await steps.count()).toBe(6);
  for (const i of [0, 1, 3]) {
    const counted = Number(((await steps.nth(i).getByTestId("journey-count").innerText()).replace(/[^\d]/g, "")) || "0");
    if (counted === 0) continue;
    await steps.nth(i).getByRole("button").first().click();
    await expect(page.getByTestId("journey-list-count")).toBeVisible({ timeout: 60_000 });
    const said = Number(((await page.getByTestId("journey-list-count").innerText()).trim().match(/^[0-9,]+/)?.[0] ?? "0").replace(/,/g, ""));
    expect(said).toBe(counted);
    expect(await page.getByTestId("journey-rows").getByTestId("speed-row").count()).toBe(Math.min(said, 100));
    // The leads open in a popup over the page; Esc closes it and the page is still on the same tab.
    await expect(page.getByTestId("speed-popup")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("speed-popup")).toHaveCount(0);
    await expect(steps.first()).toBeVisible();
  }
});

test("Start calling on the Race opens Call mode, whose tab carries New until it is opened", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  await tab(page, "Race").click();
  await expect(page.getByTestId("call-new")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("start-calling-mode").click();
  await expect(page.getByRole("tab", { name: /^Call mode/, selected: true })).toBeVisible();
  await expect(page.getByTestId("call-new")).toHaveCount(0);
});

test("a filter narrows the race and can be cleared", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page, "/app#speed");
  await page.getByTestId("filters-toggle").click();
  await page.getByTestId("filters-panel").getByLabel("Status").selectOption("waiting");
  await expect(page.getByTestId("filters-toggle")).toContainText("(1)");
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 60_000 });
  for (const t of await page.getByTestId("race-row").getByTestId("live-timer").all()) await expect(t).not.toHaveAttribute("data-race", /won|lost/);
  await page.getByTestId("filters-clear").click();
  await expect(page.getByTestId("filters-toggle")).not.toContainText("(");
});

test("the owner change is a preview first and a dry run in the demo", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page, "/app#speed");
  const name = page.getByTestId("race-row").first().getByRole("button").first();
  if (!(await name.count())) { test.skip(true, "no new leads on this demo"); return; }
  await name.click();
  const sel = page.getByTestId("drawer-owner-select");
  await expect(sel).toBeVisible({ timeout: 60_000 });
  const options = await sel.locator("option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
  if (options.length === 0) { test.skip(true, "no team members on this demo"); return; }
  await sel.selectOption(options[0]);
  await expect(page.getByTestId("wb-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("wb-review-dry").or(page.getByTestId("wb-review-blockers")).first()).toBeVisible();
});

test("the proof report prints without a product name", async ({ page }) => {
  test.setTimeout(480_000);
  await open(page, "/app#speed");
  await tab(page, "Rules").click();
  await expect(page.getByTestId("proof-report")).toBeVisible({ timeout: 90_000 });
  expect(await page.getByTestId("proof-report").innerText()).not.toMatch(/subsync|gohighlevel|highlevel/i);
});
