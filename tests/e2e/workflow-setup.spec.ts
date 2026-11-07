import { expect, test, type Page } from "@playwright/test";

// Workflow setup card (stage WFSETUP) at desktop-1440, every server answer mocked: nothing is ever created. Covers the dry run ("Would create ..."), the calm fallback with the
// five-step guide and copy buttons, "I did it", and that no product or platform name appears on the card.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "Desktop 1440 is the gate"); }); // eslint-disable-line no-empty-pattern
const item = { locationId: "L1", locationName: "Acme Roofing", timeZone: null, openValue: 0, ageHours: 2, priority: 50, reasons: ["Missed call, no callback yet"], url: "https://example.test/contact", dnd: false, phone: "+15550001111", contactId: "c-ana", name: "Ana Reyes" };
const VIEW = { ready: true, state: "none", workflowId: null, updateAvailable: false, lastError: null, live: false, tag: "call-now", folderDefault: "Lead Response Automations", users: [{ id: "u-1", name: "Sam Lee" }], canEdit: true, settings: { folderName: "Lead Response Automations", autoSetup: false, assignMode: "round_robin", assignUserId: null } };

async function mock(page: Page, setup: Record<string, unknown>, calls: string[]) {
  await page.addInitScript(() => { try { localStorage.setItem("subsync.dial.auto", "false"); localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/\/api\/app\/dial\/queue\?/, (r) => r.fulfill({ json: { list: "missed", lists: [{ id: "missed", label: "Missed calls, no callback", help: "" }], total: 1, ownOnly: false, me: "Test Agent", items: [item] } }));
  await page.route(/\/api\/app\/dial\/stats/, (r) => r.fulfill({ json: { people: [], own: false } }));
  await page.route(/\/api\/app\/dial\/cq-status/, (r) => r.fulfill({ json: { ready: true, accounts: [{ id: "L1", name: "Acme Roofing" }], canEdit: true, queueLinks: {}, status: [] } }));
  await page.route(/\/api\/app\/dial\/cq-setup/, (r) => r.fulfill({ json: { ready: true, canEdit: true, settings: { route: "tag", tag: "call-now", workflowId: null, autoOn: false, paused: false, maxPerRun: 25, maxPerDay: 100, windowStart: 9, windowEnd: 20 } } }));
  await page.route(/\/api\/app\/dial\/cq-wf\?/, (r) => r.fulfill({ json: VIEW }));
  await page.route(/\/api\/app\/dial\/cq-wf-setup/, (r) => { calls.push("setup"); return r.fulfill({ json: setup }); });
  await page.route(/\/api\/app\/dial\/cq-wf-check/, (r) => { calls.push("check"); return r.fulfill({ json: { state: "ready", message: 'Found "Call queue" and it is published.' } }); });
}
async function open(page: Page) {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: /^Call mode/ }).click();
  await page.getByTestId("cq-setup-open").click();
  await expect(page.getByTestId("wf-setup")).toBeVisible();
}

test("dry run: Set up call queue answers 'Would create folder ... and workflow ...'", async ({ page }) => {
  test.setTimeout(300_000);
  const calls: string[] = [];
  await mock(page, { state: "would_create", message: 'Would create folder "Lead Response Automations" and workflow "Call queue". Nothing was sent: automatic setup is switched off for this account.', lines: [] }, calls);
  await open(page);
  await expect(page.getByTestId("wf-setup-state")).toContainText("not set up yet");
  await expect(page.getByTestId("wf-folder")).toHaveValue("Lead Response Automations");
  await page.getByTestId("wf-setup-run").click();
  await expect(page.getByTestId("wf-setup-msg")).toContainText('Would create folder "Lead Response Automations" and workflow "Call queue"');
  expect(calls).toEqual(["setup"]);
  await expect(page.getByTestId("wf-guide")).toBeHidden();
  const text = (await page.getByTestId("wf-setup").innerText()).toLowerCase();
  expect(text).not.toMatch(/subsync|high ?level|\bghl\b|leadconnector/);
  await page.screenshot({ path: "docs/review/workflow-setup-dryrun-desktop-1440.png" });
});

test("not enabled: a calm message, the five-step guide with copy buttons, and 'I did it' runs the read-only check", async ({ page }) => {
  test.setTimeout(300_000);
  const calls: string[] = [];
  await mock(page, { state: "unavailable", code: "not_enabled", message: "Your CRM has not turned on automatic workflow setup for this account yet. The steps below take about five minutes.", lines: [] }, calls);
  await open(page);
  await page.getByTestId("wf-setup-run").click();
  await expect(page.getByTestId("wf-setup-msg")).toContainText("not turned on automatic workflow setup");
  const guide = page.getByTestId("wf-guide");
  await expect(guide).toBeVisible();
  await expect(guide.locator("li")).toHaveCount(5);
  await expect(guide).toContainText("call-now");
  await expect(guide.getByRole("button", { name: "Copy tag" })).toBeVisible();
  await page.getByTestId("wf-did-it").click();
  await expect(page.getByTestId("wf-setup-msg")).toContainText("published");
  expect(calls).toEqual(["setup", "check"]);
  const text = (await page.getByTestId("wf-setup").innerText()).toLowerCase();
  expect(text).not.toMatch(/subsync|high ?level|\bghl\b|leadconnector/);
  await page.screenshot({ path: "docs/review/workflow-setup-guide-desktop-1440.png" });
});
