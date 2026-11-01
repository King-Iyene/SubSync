import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// F7: the Accounts page and the account detail page are readable at every width: no clipped text, no jargon, filters that work.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(request: APIRequestContext, path: string): Promise<Json> {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const res = await request.get(`/api/app/${path}`, { headers });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
}

// Text is clipped when an element hides its overflow (or uses an ellipsis) and its content is wider than its box.
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("main *").forEach((el) => {
      const e = el as HTMLElement;
      if (!e.offsetParent && e.tagName !== "BODY") return;
      const cs = getComputedStyle(e);
      const hides = cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.textOverflow === "ellipsis";
      if (hides && e.scrollWidth > e.clientWidth + 1 && (e.textContent ?? "").trim().length > 0 && e.children.length === 0) out.push(`${e.tagName.toLowerCase()}: ${(e.textContent ?? "").trim().slice(0, 40)}`);
    });
    return out;
  });
}

test("the Accounts page has no clipped text and no jargon, and says what its words mean", async ({ page }, testInfo) => {
  await page.goto("/app#accounts");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Contacts" }).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  expect(await clipped(page)).toEqual([]);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/churn|engagement score|dormant/i);
  expect(text).toMatch(/leave risk/i); // the column heading is shown in capitals
  await page.getByText("What do these words mean?").click();
  await expect(page.getByTestId("what-this-means")).toContainText("Likely to leave");
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  if (testInfo.project.name === "desktop-1440") {
    const needsScroll = await page.evaluate(() => { const w = document.querySelector("main table")?.parentElement as HTMLElement; return w.scrollWidth > w.clientWidth + 1; });
    expect(needsScroll, "on a desktop window the table fits without sideways scrolling").toBe(false);
  }
  await page.screenshot({ path: `docs/review/f7-accounts-${testInfo.project.name}.png`, fullPage: true });
});

test("the filters narrow the list and each chip's count equals the rows it shows", async ({ page, request }) => {
  const list = await get(request, "accounts");
  await page.goto("/app#accounts");
  await page.reload();
  await expect(page.getByRole("button", { name: /^All \d+/ })).toBeVisible();
  const total = (list.accounts as Json[]).filter((a) => !a.ignored).length;
  await expect(page.getByRole("button", { name: new RegExp(`^All ${total}`) })).toBeVisible();
  for (const label of ["At risk", "Gone quiet", "Replies waiting"]) {
    const chip = page.getByRole("button", { name: new RegExp(`^${label} \\d+`) });
    const n = Number((await chip.innerText()).match(/(\d+)\s*$/)?.[1]);
    await chip.click();
    await expect(page.locator("main tbody tr")).toHaveCount(n);
  }
  await page.getByRole("button", { name: /^All \d+/ }).click();
  await page.getByLabel("Filter accounts by name").fill("zzzz-nothing");
  await expect(page.getByText("No accounts match")).toBeVisible();
});

test("the counts in the table are the counts the server holds", async ({ page, request }) => {
  const list = await get(request, "accounts");
  const first = (list.accounts as Json[]).filter((a) => !a.ignored)[0];
  await page.goto("/app#accounts");
  await page.reload();
  const row = page.locator("main tbody tr").filter({ hasText: first.name }).first();
  await expect(row).toContainText(first.contacts.toLocaleString("en-US"));
  await expect(row).toContainText(`+${first.new30d} in 30 days`);
  await expect(row).toContainText(`${first.completenessPct}%`);
});

test("the account detail page opens, reads in plain words and has no clipped text", async ({ page, request }, testInfo) => {
  const list = await get(request, "accounts");
  const a = (list.accounts as Json[]).find((x) => !x.ignored && x.contacts > 100) ?? (list.accounts as Json[])[0];
  await page.goto(`/app#account=${a.locationId}`);
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Health score").first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  expect(await clipped(page)).toEqual([]);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/churn|engagement score|dormant|NaN|undefined/i);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  await page.screenshot({ path: `docs/review/f7-account-detail-${testInfo.project.name}.png`, fullPage: true });
});
