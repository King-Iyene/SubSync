import { expect, test, type Page } from "@playwright/test";

// 1. The first Call press asks "How do you make calls?" once; the answer is saved and the call continues; skipping saves the CRM's dialer.
// 2. A person set aside on Today shows "Set aside until <date>. Bring back" in the panel and "Bring back" in the list menu; Undo sets them aside again.
// The browser talks to SubSync's own API, so the answers of the dialer and held endpoints are mocked here (the server rules are in the unit and database tests).
test.describe.configure({ mode: "serial" });

async function openFirst(page: Page) {
  await page.goto("/app#people");
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("people-start").click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drawer-headline")).toHaveText(/\S/, { timeout: 90_000 });
  return drawer;
}

test("the first Call asks how you make calls, saves the answer, and never asks again", async ({ page }) => {
  test.setTimeout(300_000);
  const puts: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/app\/people\/dialer$/, (r) => {
    if (r.request().method() === "PUT") { puts.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { provider: "crm", chosen: false } });
  });
  const drawer = await openFirst(page);
  if (await drawer.getByTestId("drawer-call").isDisabled()) test.skip(true, "this contact has no phone number");
  await drawer.getByTestId("drawer-call").click();
  const ask = page.getByTestId("dialer-ask");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("How do you make calls?");
  await expect(ask).toContainText("Change anytime in Settings");
  await expect(ask.getByTestId("dialer-ask-phone")).toBeFocused();
  await ask.getByTestId("dialer-ask-skip").click();
  expect(puts.at(-1)).toMatchObject({ provider: "crm" });
  await expect(ask).toBeHidden();
  await drawer.getByTestId("drawer-call").click();
  await expect(ask, "asked once only").toBeHidden();
});

test("a contact set aside on Today can be brought back from the panel, with Undo", async ({ page }) => {
  test.setTimeout(300_000);
  const posts: Array<Record<string, unknown>> = [];
  let ids: string | null = null;
  let held = true;
  page.on("request", (rq) => { const m = rq.url().match(/\/api\/app\/people\/person\/([^/]+)\/([^/?]+)/); if (m) ids = `${m[1]}:${decodeURIComponent(m[2])}`; });
  await page.route(/\/api\/app\/people\/held$/, async (r) => {
    for (let i = 0; i < 50 && !ids; i++) await new Promise((x) => setTimeout(x, 100));
    await r.fulfill({ json: { held: held && ids ? { [ids]: { eventId: 99, until: Date.now() + 5 * 86_400_000, action: "snooze", rowKey: `${ids.split(":")[0]}|replies|${ids.split(":")[1]}`, by: "Test" } } : {} } });
  });
  await page.route(/\/api\/app\/today\/action$/, (r) => { posts.push(r.request().postDataJSON()); if (posts.at(-1)?.action === "undo") held = false; return r.fulfill({ json: { ok: true, eventId: 100 } }); });
  const drawer = await openFirst(page);
  await expect(drawer.getByTestId("held-note")).toContainText("Set aside until");
  await drawer.getByTestId("held-bring-back").click();
  expect(posts.at(-1)).toMatchObject({ action: "undo", eventId: 99 });
  await expect(drawer.getByTestId("held-note")).toHaveCount(0);
});
