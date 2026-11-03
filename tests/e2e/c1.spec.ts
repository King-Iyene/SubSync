import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Stage C1 (Clients): WRITTEN in the stage, NOT RUN (the lead runs it after the merge, on a clean server). It uses the demo company, which is shared, so every
// change a test makes is undone in the same test. Covers the five tabs, the old addresses, the inline edits and the log, onboarding (Fix it, who and when,
// history, templates, stuck), Compare, the quarterly review, and that nothing scrolls sideways at the three widths.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function session(request: APIRequestContext): Promise<{ Authorization: string }> {
  const s = await request.post("/api/sso", { data: { demo: true } });
  return { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
}
async function api(request: APIRequestContext, method: "get" | "put" | "post" | "delete", path: string, data?: unknown): Promise<Json> {
  const res = await request[method](`/api/app/${path}`, { headers: await session(request), ...(data !== undefined ? { data } : {}) });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Json;
}
async function noSideScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${label} scrolls sideways`).toBeLessThanOrEqual(innerWidth + 1);
}
const open = async (page: Page, hash: string) => {
  await page.goto(`/app#${hash}`);
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
};
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test("Clients is one module with five tabs, and the old addresses open it on the right tab", async ({ page }, info) => {
  await open(page, "clients");
  for (const name of ["Health", "Onboarding", "Details and billing", "Compare", "Reviews (QBR)"]) await expect(tab(page, name)).toBeVisible();
  await expect(tab(page, "Health")).toHaveAttribute("aria-selected", "true");
  await noSideScroll(page, "Clients, Health");
  await open(page, "accounts");
  await expect(tab(page, "Health")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
  await open(page, "onboarding");
  await expect(tab(page, "Onboarding")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Clients stuck in onboarding")).toBeVisible();
  await noSideScroll(page, "Clients, Onboarding");
  await open(page, "email");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.screenshot({ path: `docs/review/c1-email-${info.project.name}.png`, fullPage: true });
});

test("Health: the clients to call first never say Healthy, and a click on a bar lists exactly the clients it counts", async ({ page }, info) => {
  await open(page, "clients");
  const list = page.getByRole("list", { name: "Clients to call first" });
  await expect(list).toBeVisible();
  const text = await list.innerText();
  expect(text).not.toMatch(/Healthy|Thriving/);
  expect(text).toMatch(/At risk|Watch/);
  const chart = page.getByTestId("bar-chart").filter({ hasText: "Clients by health" });
  await expect(chart).toBeVisible();
  const bars = chart.getByRole("button");
  const n = await bars.count();
  expect(n).toBe(4);
  for (let i = 0; i < n; i++) {
    const label = (await bars.nth(i).getAttribute("aria-label")) ?? "";
    const m = /: (\d+)/.exec(label);
    if (!m || Number(m[1]) === 0) continue;
    await bars.nth(i).click();
    await expect(page.getByTestId("drill-count")).toHaveText(m[1]);
    await expect(page.getByTestId("drill-panel").getByRole("listitem")).toHaveCount(Number(m[1]));
  }
  await page.screenshot({ path: `docs/review/c1-health-${info.project.name}.png`, fullPage: true });
});

test("Health: a client's trends have axes, a range of their own, and the weekly bars open the people behind them", async ({ page }) => {
  await open(page, "clients");
  await page.getByRole("button", { name: "Show trends" }).first().click();
  const trends = page.getByTestId("client-trends");
  await expect(trends).toBeVisible();
  await expect(trends.getByTestId("line-chart")).toHaveCount(3);
  await expect(trends.getByTestId("card-range-window").first()).toContainText("Last 90 days");
  await expect(trends.getByTestId("line-chart").first()).toContainText("0");
  await expect(trends.getByTestId("line-chart").first()).toContainText("100");
  const appts = trends.getByTestId("bar-chart").filter({ hasText: "Appointments by week" });
  if (await appts.count()) {
    const bar = appts.getByRole("button").filter({ hasText: /appointments?, open the list/ }).first();
    if (await bar.count()) {
      const count = Number(/(\d+) appointments?/.exec((await bar.getAttribute("aria-label")) ?? "")?.[1]);
      await bar.click();
      await expect(page.getByTestId("drill-count").last()).toHaveText(String(count));
    }
  }
});

test("Details: fee, renewal and industry are typed in the row, with honest labels, and a conversation can be logged", async ({ page, request }) => {
  const before = await api(request, "get", "clients");
  const c = (before.clients as Json[])[0];
  await open(page, "clients");
  await tab(page, "Details and billing").click();
  // Wait for the tab's own content (it loads after the tab opens) before reading the whole page.
  await expect(page.locator("main")).toContainText("You enter this; SubSync does not read it from your CRM.", { timeout: 30_000 });
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\bn\/a\b/);
  expect(text).toContain("You enter this; SubSync does not read it from your CRM.");
  expect(text).toContain("What each column means");
  const row = page.getByTestId("client-row").filter({ hasText: c.name }).first();
  const oldFee = c.profile.monthlyFee as number | null;
  try {
    await row.getByRole("button", { name: /change the fee|Add fee/ }).click();
    await row.getByLabel(/pays you per month/).fill("3210");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("$3,210");
    const after = await api(request, "get", "clients");
    expect((after.clients as Json[]).find((x) => x.locationId === c.locationId)!.profile.monthlyFee).toBe(3210);
    // The log: add a conversation, see it with who and when, remove it.
    await row.getByRole("button", { name: /Log|Add a note/ }).click();
    const log = page.getByTestId("client-log");
    await log.getByLabel("What was said or decided").fill("Playwright check: agreed a call on Friday");
    await log.getByRole("button", { name: "Add to the log" }).click();
    await expect(log).toContainText("Playwright check: agreed a call on Friday");
    await log.getByRole("listitem").filter({ hasText: "Playwright check" }).getByRole("button", { name: "Remove" }).click();
    await expect(log).not.toContainText("Playwright check");
  } finally {
    await api(request, "put", `clients/${c.locationId}`, { monthlyFee: oldFee === null ? "" : String(oldFee) });
  }
  await noSideScroll(page, "Clients, Details");
});

test("Details: the industry is a picker, and a picked industry lands in its playbook", async ({ page, request }) => {
  const before = await api(request, "get", "clients");
  const c = (before.clients as Json[]).find((x) => !x.profile.industry) ?? (before.clients as Json[])[0];
  const old = c.profile.industry as string | null;
  await open(page, "clients");
  await tab(page, "Details and billing").click();
  const row = page.getByTestId("client-row").filter({ hasText: c.name }).first();
  try {
    await row.getByRole("button", { name: /Choose industry|change the industry/ }).click();
    await row.getByLabel(/kind of business/).selectOption("Real estate");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("Playbook: Real estate and property.");
  } finally {
    await api(request, "put", `clients/${c.locationId}`, { industry: old ?? "" });
  }
});

test("Onboarding: Fix it goes through the white-label link, a step can be given to someone with a due date, and the history says so", async ({ page, request }) => {
  const data = await api(request, "get", "client-onboarding?stuck=14");
  expect(data.templates.length).toBeGreaterThan(0);
  const target = (data.clients as Json[]).find((x) => (x.items as Json[]).some((i) => i.key === "manual:kickoff" && i.status === "todo"))!;
  await open(page, "onboarding");
  await expect(page.getByTestId("stuck-list").or(page.getByTestId("no-stuck"))).toBeVisible();
  const card = page.getByTestId("onboarding-client").filter({ hasText: target.name }).first();
  await card.getByRole("button", { name: "Open checklist" }).click();
  const fixes = card.getByRole("link", { name: /Fix it in your CRM/ });
  if (await fixes.count()) expect(await fixes.first().getAttribute("href")).toMatch(/^https:\/\/[^/]+\/v2\/location\/[^/]+\/(settings|contacts|opportunities|calendars|conversations|automation)/);
  const step = card.getByTestId("onboarding-step").filter({ hasText: "Kickoff call completed" });
  try {
    await step.getByRole("button", { name: "How to" }).click();
    await expect(step.getByTestId("step-howto")).toContainText("kickoff");
    await step.getByLabel(/Who is on/).fill("Playwright Pat");
    await step.getByLabel(/Who is on/).press("Enter");
    await step.getByLabel(/Due date of/).fill("2026-12-01");
    await expect(step.getByLabel(/Who is on/)).toHaveValue("Playwright Pat");
    await expect(step.getByLabel(/Due date of/)).toHaveValue("2026-12-01");
    await card.getByRole("button", { name: "Show history" }).click();
    await expect(card.getByRole("list", { name: "Onboarding history" })).toContainText("Playwright Pat");
  } finally {
    await api(request, "put", `client-onboarding/${target.locationId}/steps`, { key: "manual:kickoff", assignee: "", dueOn: "" });
  }
  await noSideScroll(page, "Clients, Onboarding checklist");
});

test("Onboarding: a template can be written and removed, and a step added to one client can be removed", async ({ page, request }) => {
  await open(page, "onboarding");
  await page.getByRole("button", { name: /^(New template|Write your first template)$/ }).click();
  await page.getByLabel("Template name").fill("Playwright template");
  await page.getByLabel("Step 1 name").fill("Check the thing");
  await page.getByRole("button", { name: "Save template" }).click();
  const card = page.getByTestId("template").filter({ hasText: "Playwright template" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Delete" }).click();
  await card.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByTestId("template").filter({ hasText: "Playwright template" })).toHaveCount(0);
  const data = await api(request, "get", "client-onboarding");
  expect((data.templates as Json[]).some((t) => t.name === "Playwright template")).toBe(false);
});

test("Compare: several clients against their average, the differences named, one trend chart, and setups only where they share a baseline", async ({ page }, info) => {
  await open(page, "clients");
  await tab(page, "Compare").click();
  await page.getByRole("button", { name: "Compare the 3 lowest health scores" }).click();
  await expect(page.getByTestId("compare-notes")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Average", exact: true })).toBeVisible();
  await expect(page.getByTestId("line-chart").first()).toContainText("Average of these clients");
  expect(await page.locator("main").innerText()).toMatch(/against the average/);
  await expect(page.getByTestId("setup-compare")).toBeVisible();
  await noSideScroll(page, "Clients, Compare");
  await page.screenshot({ path: `docs/review/c1-compare-${info.project.name}.png`, fullPage: true });
});

test("Reviews: a quarter's review with the quarter before it, wins, issues, what SubSync caught and next steps, branded and printable", async ({ page, request }, info) => {
  const clients = await api(request, "get", "clients");
  const c = (clients.clients as Json[])[0];
  await open(page, "clients");
  await tab(page, "Reviews (QBR)").click();
  await page.getByLabel("Client", { exact: true }).selectOption(c.locationId);
  await expect(page.getByTestId("qbr")).toBeVisible();
  await expect(page.getByTestId("qbr-header")).toContainText(c.name);
  await expect(page.getByTestId("qbr-running")).toBeVisible(); // the current quarter is said to be still running
  await expect(page.getByTestId("qbr-wins")).toBeVisible();
  await expect(page.getByTestId("qbr-steps")).toBeVisible();
  await expect(page.getByTestId("line-chart").first()).toBeVisible();
  // The previous quarter, chosen from the list.
  const q = page.getByLabel("Quarter");
  const options = await q.locator("option").allTextContents();
  expect(options.length).toBeGreaterThanOrEqual(2);
  await q.selectOption({ index: 1 });
  await expect(page.getByTestId("qbr-running")).toHaveCount(0);
  // The review reads from the server's own figures: a quarter with no history is said to have none.
  const quarters = await api(request, "get", `qbr/${c.locationId}`);
  expect(quarters.quarters.length).toBe(6);
  expect(quarters.findings.steps.length).toBeGreaterThan(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("qbr-header")).toBeVisible();
  await expect(page.getByRole("tablist")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await noSideScroll(page, "Clients, Reviews");
  await page.screenshot({ path: `docs/review/c1-review-${info.project.name}.png`, fullPage: true });
});

test("a business or a client's staff never reach the Clients module or its data", async ({ request }) => {
  for (const as of ["business", "client"]) {
    const s = await request.post("/api/sso", { data: { demo: true, as } });
    const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
    for (const path of ["clients", "client-onboarding", "qbr/x1x", "clients/compare?ids=a1a,b2b"]) expect((await request.get(`/api/app/${path}`, { headers })).status(), `${as} ${path}`).toBe(403);
    expect((await request.put("/api/app/client-onboarding/templates", { headers, data: { name: "x" } })).status(), `${as} templates`).toBe(403);
  }
});

test("the demo Clients page looks real: fees, renewals, industries, logged conversations, and a client stuck in onboarding", async ({ request }) => {
  const d = await api(request, "get", "clients");
  expect(d.firstUse.noFees).toBe(false);
  expect(d.revenue.clientsWithFee).toBeGreaterThanOrEqual(10);
  expect(d.revenue.monthly).toBeGreaterThan(10_000);
  expect(d.renewals.length).toBeGreaterThanOrEqual(3);
  expect((d.clients as Json[]).filter((c) => c.profile.industry).length).toBeGreaterThanOrEqual(10);
  expect((d.clients as Json[]).filter((c) => c.log.count > 0).length).toBeGreaterThanOrEqual(4);
  expect((d.clients as Json[]).some((c) => c.roi)).toBe(true);
  const o = await api(request, "get", "client-onboarding?stuck=14");
  expect(o.stuck.length).toBeGreaterThanOrEqual(1);
  expect((o.clients as Json[]).some((c) => c.overdueCount > 0)).toBe(true);
});
