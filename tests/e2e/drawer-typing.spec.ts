import { expect, test } from "@playwright/test";

// Typing in the lead panel must never close it, move focus away, or lose the draft, even while the live read and the list behind it refresh.
// The live answer is mocked in the browser (page.route) and changes on every read, so the panel reloads its parts again and again while the person types.
test("lead panel stays open, keeps focus and the draft while typing and while live refreshes arrive", async ({ page }) => {
  test.setTimeout(240_000);
  let n = 0;
  await page.route("**/workbench/live**", (route) => route.fulfill({ json: { state: "ok", readAt: Date.now(), rev: `r${++n}`, full: true, missing: [], tags: [], calls: [], notes: [], tasks: [] } }));
  await page.goto("/app#people");
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
  const search = page.getByTestId("people-search-input");
  await search.fill("an");
  await expect(page.getByTestId("people-count")).toBeVisible({ timeout: 120_000 }); // the search answer, not the call list that shows first
  const open = page.getByTestId("person-open").first();
  await expect(open).toBeVisible({ timeout: 60_000 });
  const rowText = await page.getByTestId("person-row").first().innerText(); // the same person is opened again later
  await open.click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("wb-work")).toBeVisible({ timeout: 60_000 });
  const box = page.getByTestId("wb-text");
  if (!(await box.isVisible())) await page.getByTestId("wb-composer-open").click();
  await box.click();
  const msg = "Test message: j k / n s m y l, please ignore.";
  const t0 = Date.now();
  await box.pressSequentially(msg, { delay: 0 });
  const perKey = (Date.now() - t0) / msg.length;
  expect(perKey, `typing took ${perKey.toFixed(1)} ms per key`).toBeLessThan(60); // the whole panel must not redraw on every key
  await page.waitForTimeout(8000); // more live reads arrive, the list behind refreshes
  await expect(drawer).toBeVisible();
  await expect(box).toHaveValue(msg);
  await expect(search).toHaveValue("an"); // nothing typed in the panel reached the page's own search box
  expect(n).toBeGreaterThan(1);
  // Closing and opening the same person again shows the unsent words, never somebody else's.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  await page.getByTestId("person-row").filter({ hasText: rowText.split("\n")[1] ?? rowText.split("\n")[0] }).first().getByTestId("person-open").click();
  await expect(page.getByTestId("wb-text")).toHaveValue(msg, { timeout: 90_000 });
  // The send is never silent: with sending off the panel says so and keeps the words.
  await page.getByTestId("wb-preview").click();
  await page.getByTestId("wb-confirm").click();
  await expect(page.getByTestId("wb-result")).toContainText(/Sent\.|Not sent/, { timeout: 60_000 });
  await expect(page.getByTestId("wb-result")).toHaveAttribute("data-tone", /dry|done/);
});
