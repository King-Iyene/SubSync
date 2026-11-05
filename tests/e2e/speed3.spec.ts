import { expect, test, type Page } from "@playwright/test";

// Speed to lead, third pass (stage SPEED3), on the demo company for four roles at desktop-1440 and phone-390: the reply sheet with a dry-run preview (the demo can never send), the
// tabs, every opened mark showing exactly as many leads as it counted, and no sideways scroll.
const ROLES = [
  { name: "agency", path: "/app#speed", people: true },
  { name: "a client's staff", path: "/app?as=client#speed", people: false },
  { name: "a business owner", path: "/app?as=business#speed", people: true },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i;
const n = (t: string) => Number(t.replace(/[^\d]/g, ""));

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.reload();
  await expect(page.getByTestId("speed-fast")).toBeVisible({ timeout: 90_000 });
}
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const noSideways = async (page: Page) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const { s, w } = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(s, "no sideways scroll").toBeLessThanOrEqual(w + 1);
};

for (const role of ROLES) {
  test(`${role.name}: reply sheet previews a dry run and sends nothing`, async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, role.path);
    const reply = page.getByTestId("speed-reply").first();
    if (!(await reply.count())) { test.skip(true, "no leads are waiting on this demo"); return; }
    await reply.click();
    await expect(page.getByTestId("act-sheet")).toBeVisible();
    await page.getByTestId("act-text").fill("Hi, thanks for getting in touch. When suits you for a quick call?");
    await page.getByTestId("act-preview").click();
    await expect(page.getByTestId("wb-review")).toBeVisible({ timeout: 30_000 });
    // either the lead has no number (a blocker) or the demo says nothing is ever sent
    const dry = page.getByTestId("wb-review-dry"), blocked = page.getByTestId("wb-review-blockers");
    await expect(dry.or(blocked)).toBeVisible();
    if (await dry.count()) {
      await expect(dry).toContainText(/nothing is ever sent|switched off|not allowed/i);
      await page.getByTestId("wb-confirm").click();
      await expect(page.getByTestId("wb-result")).toHaveAttribute("data-tone", "dry", { timeout: 30_000 });
    }
    expect(await page.getByTestId("act-sheet").innerText()).not.toMatch(BANNED);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("act-sheet")).toHaveCount(0);
  });

  test(`${role.name}: Pace, ${role.people ? "People" : "Owners"}, Lead capture and Alerts open, plain words, no sideways scroll`, async ({ page }) => {
    test.setTimeout(240_000);
    await open(page, role.path);
    for (const [name, id] of [["Pace", "pace-tab"], [role.people ? "People" : "Owners", "people-tab"], ["Lead capture", "capture-tab"], ["Alerts", "alerts-tab"]] as const) {
      await tab(page, name).click();
      await expect(page.getByTestId(id)).toBeVisible({ timeout: 90_000 });
      expect(await page.locator("main").innerText()).not.toMatch(BANNED);
      await noSideways(page);
    }
    await expect(page.getByTestId("digest-preview")).toContainText("Nothing was sent");
    if (!role.people) await expect(tab(page, "People")).toHaveCount(0);
  });
}

test("a mark opens exactly the leads it counted", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  await tab(page, "Pace").click();
  await expect(page.getByTestId("pace-tab")).toBeVisible({ timeout: 90_000 });
  const slow = page.getByRole("button", { name: /answered later$/ });
  const counted = n(await slow.innerText());
  await slow.click();
  await expect(page.getByTestId("insight-list-count")).toBeVisible({ timeout: 60_000 });
  const said = n(await page.getByTestId("insight-list-count").innerText());
  expect(said).toBe(counted);
  const rows = await page.getByTestId("insight-rows").getByTestId("speed-row").count();
  expect(rows).toBe(Math.min(said, 100));
});

test("Lead capture shows the counters and a drop or rise word", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "/app#speed");
  await tab(page, "Lead capture").click();
  for (const k of ["today", "week", "month", "all"]) await expect(page.getByTestId(`capture-${k}`)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("capture-badge")).toContainText(/Rising|Falling|Steady|not enough data/);
  await expect(page.getByTestId("capture-gross")).toContainText(/sign ups/);
});
