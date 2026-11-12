import { expect, test, type Page } from "@playwright/test";

// Regression: "1 person ready to call", Start calling, "Session ended, 0 calls". The ready count must only hold people who can be called NOW (their own calling hours),
// waiting people are shown apart with the reason, and Start is off (never a session that ends at once) when nobody can be called.
const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()).replace(/\D/g, "")) % 24;
const ZONES = ["Pacific/Honolulu", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Dubai", "Asia/Tokyo", "Pacific/Auckland"];
const closedZone = ZONES.find((z) => hourIn(z) < 9 || hourIn(z) >= 20) ?? "Pacific/Auckland";
const openZone = ZONES.find((z) => hourIn(z) >= 10 && hourIn(z) < 19) ?? "Europe/London";
const item = (o: Record<string, unknown>) => ({ locationId: "L1", locationName: "Acme Roofing", timeZone: openZone, openValue: 0, ageHours: 2, priority: 50, reasons: ["Missed call, no callback yet"], url: "https://crm.example/c", dnd: false, phone: "+15550001111", ...o });

async function mock(page: Page, items: unknown[]) {
  await page.addInitScript(() => { try { localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/\/api\/app\/dial\/queue/, (r) => r.fulfill({ json: { list: "missed", lists: [{ id: "missed", label: "Missed calls, no callback", help: "" }], total: items.length, ownOnly: false, me: "Test Agent", items } }));
  await page.route(/\/api\/app\/dial\/stats/, (r) => r.fulfill({ json: { people: [], own: false } }));
  await page.route(/\/api\/app\/dial\/script/, (r) => r.fulfill({ json: { script: null, default: "x", canEdit: true } }));
}
async function open(page: Page) {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: /^Call mode/ }).click();
}

test("only person is outside calling hours: 0 ready, waiting line with the reason, Start is off", async ({ page }) => {
  test.setTimeout(300_000);
  await mock(page, [item({ contactId: "c-unk", name: "Unknown caller", timeZone: closedZone })]);
  await open(page);
  await expect(page.getByTestId("dial-count")).toContainText("Nobody to call right now");
  await expect(page.getByTestId("dial-next-step")).toContainText("1 person can be called from 9:00 (their time). We'll show them here then.");
  await expect(page.getByTestId("dial-waiting")).toBeVisible();
  // Never a dead button: the main button is live and says what it does; Power hour answers in one line.
  await expect(page.getByTestId("cq-send")).toBeEnabled();
  await expect(page.getByTestId("cq-send")).toContainText("Send the 1 waiting to my CRM call queue");
  await expect(page.getByTestId("dial-start-power")).toBeEnabled();
  await page.getByTestId("dial-start-power").click();
  await expect(page.getByTestId("dial-notice")).toContainText("Power hour starts when someone can be called");
  await expect(page.getByText(/Start is off|switches on by itself|every 30 seconds/)).toHaveCount(0);
});

test("one callable, one after hours, one unknown with no number: 1 ready, Start opens a session of exactly that person", async ({ page }) => {
  test.setTimeout(300_000);
  await mock(page, [item({ contactId: "c-ok", name: "Ana Reyes" }), item({ contactId: "c-late", name: "Late Lee", timeZone: closedZone }), item({ contactId: "c-ghost", name: "Unknown caller", phone: null, noRecord: true })]);
  await open(page);
  await expect(page.getByTestId("dial-count")).toContainText("1 person ready to call now");
  await expect(page.getByTestId("dial-waiting")).toBeVisible();
  await expect(page.getByTestId("dial-blocked-open")).toContainText("1 will be skipped");
  await page.getByTestId("dial-start").click();
  await expect(page.getByTestId("dial-progress-text")).toHaveText("1 of 1");
  await expect(page.getByTestId("dial-name")).toHaveText("Ana Reyes");
});
