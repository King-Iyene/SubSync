import { expect, test } from "@playwright/test";
import { api } from "./today-helpers";

// Speed to lead close-out (docs/features/SPEED_CLOSEOUT.md): one regression test per defect found in the final walk.

test("Rules: the escalation step lists answer (they used to be refused with 'Unknown part of this screen')", async ({ request }) => {
  test.setTimeout(120_000);
  const agency = await api(request);
  const body = await agency.get("speed?part=ladder-leads&step=0&page=0&size=20&accPage=0&accSize=5");
  expect(body.error).toBeUndefined();
  expect(Array.isArray(body.leads)).toBe(true);
  // A client's staff still may not see the people on the ladder.
  const client = await api(request, "client");
  expect(await client.status("speed?part=ladder-leads&step=0&page=0&size=20")).toBe(403);
});

test("phone: the page header buttons and the sync popup controls are at least 44 px", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("phone"), "phone only");
  test.setTimeout(240_000);
  await page.goto("/app#speed");
  await page.reload();
  await page.getByRole("tab", { name: /^Race/ }).waitFor({ timeout: 120_000 });
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  if (await skip.count()) await skip.first().click();
  for (const name of ["Sync now", "Give feedback", "Report a problem"]) {
    const b = page.getByRole(name === "Sync now" ? "button" : "button", { name: new RegExp(`^${name}`) }).first();
    await b.scrollIntoViewIfNeeded();
    const box = await b.boundingBox();
    expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(43.5);
  }
});

test("a client's staff open Rules without any refused request or error card", async ({ page }) => {
  test.setTimeout(240_000);
  const refused: string[] = [];
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/app/")) refused.push(`${r.status()} ${r.url()}`); });
  await page.goto("/app?as=client#speed");
  await page.reload();
  await page.getByRole("tab", { name: /^Race/ }).waitFor({ timeout: 120_000 });
  const skip = page.getByRole("button", { name: "Skip", exact: true }); if (await skip.count()) await skip.first().click();
  await page.getByRole("tab", { name: /^Rules/ }).click({ timeout: 120_000 });
  await expect(page.getByTestId("rules-tab")).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(3000);
  expect(refused).toEqual([]);
});

test("a business owner's Log tab has no invalid HTML nesting (a form inside a paragraph)", async ({ page }) => {
  test.setTimeout(240_000);
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && /cannot be a descendant|cannot contain a nested/.test(m.text())) errs.push(m.text().slice(0, 120)); });
  await page.goto("/app?as=business#speed");
  await page.reload();
  await page.getByRole("tab", { name: /^Race/ }).waitFor({ timeout: 120_000 });
  const skip = page.getByRole("button", { name: "Skip", exact: true }); if (await skip.count()) await skip.first().click();
  await page.getByRole("tab", { name: /^Log/ }).click({ timeout: 120_000 });
  await expect(page.getByTestId("speed-target")).toBeVisible({ timeout: 90_000 });
  expect(errs).toEqual([]);
});
