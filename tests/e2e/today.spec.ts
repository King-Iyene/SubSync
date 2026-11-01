import { expect, test, type APIRequestContext } from "@playwright/test";

// F5: Today is the front door. In five seconds, in plain words: leads waiting, appointments to fix, accounts needing attention.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(request: APIRequestContext) {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  return async (path: string): Promise<Json> => {
    const res = await request.get(`/api/app/${path}`, { headers });
    expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
    return (await res.json()) as Json;
  };
}

test("the first thing on Today is the leads-waiting sentence, in the first screen, within five seconds", async ({ page, request }, testInfo) => {
  const get = await api(request);
  const speed = await get("speed");
  const waiting = Math.max(0, speed.overall.stillWaiting - (speed.neverAnswered ?? 0));
  const never = speed.neverAnswered ?? 0;
  await page.goto("/app");
  const headline = page.getByTestId("leads-headline");
  await expect(headline).toBeVisible({ timeout: 5000 });
  await expect(headline, "the headline is on the first screen, not below the fold").toBeInViewport();
  if (waiting > 0) await expect(headline).toHaveText(new RegExp(`^${waiting} leads? (is|are) waiting for a reply`));
  else await expect(headline).toContainText(never > 0 ? "never answered" : "No leads are waiting");
  if (never > 0) await expect(headline).toContainText(`${never} ${never === 1 ? "was" : "were"} never answered`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `docs/review/f5-today-${testInfo.project.name}.png`, fullPage: true });
});

test("the three lines are the same numbers their own pages show", async ({ page, request }) => {
  const get = await api(request);
  const [daily, appts] = await Promise.all([get("daily"), get("appointments")]);
  await page.goto("/app");
  const door = page.getByTestId("front-door");
  await expect(door).toBeVisible();
  const unmarked = appts.unmarkedTotal as number;
  if (unmarked > 0) await expect(door).toContainText(new RegExp(`${unmarked} past appointments? (has|have) no outcome recorded`));
  else await expect(door).toContainText("Every past appointment has an outcome recorded");
  const attention = daily.attention.length as number;
  if (attention > 0) await expect(door).toContainText(new RegExp(`${attention} client accounts? needs? attention today`));
  else await expect(door).toContainText("No client account needs you today");
});

test("the sync banner is only for a first sync, and the filter sits in a drawer", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("front-door")).toBeVisible();
  await expect(page.getByText("First sync in progress")).toHaveCount(0);
  const drawer = page.getByTestId("filter-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Show only")).toBeHidden(); // closed until it is opened
  await drawer.getByText("Filter accounts").click();
  await expect(drawer.getByText("Show only")).toBeVisible();
});

test("opened from inside a client account, SubSync starts on that account with a way back to all of them", async ({ page, request }) => {
  const get = await api(request);
  const accounts = await get("accounts");
  const loc = (accounts.accounts as Json[]).find((a) => !a.ignored)?.locationId as string;
  await page.route("**/api/sso", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.user = { ...body.user, activeLocation: loc };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/app");
  const note = page.getByRole("note").filter({ hasText: "opened this from inside a client account" });
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "See all client accounts" }).click();
  await expect(page.getByRole("heading", { name: /accounts/i }).first()).toBeVisible();
  await expect(note).toBeHidden();
});

test("the Today screen has no sideways scroll and keeps the one-sentence subtitle", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("What needs you right now, then what changed.")).toBeVisible();
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
});
