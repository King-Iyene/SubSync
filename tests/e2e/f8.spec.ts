import { expect, test, type Page } from "@playwright/test";
import { GHL_SCOPES } from "../../src/lib/ghl/scopes";
import { deleteMyDataText, storeLines } from "../../src/lib/data-inventory";

// Stage F8 in the real browser (WRITTEN, NOT RUN in the stage: the lead runs it after the merge). Settings in eight sections, Getting started per role, feedback on every
// page, the roadmap with suggestions and votes, the Trust page. The demo company has sample data; every test puts back what it changed.
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECTIONS = ["Team", "Notifications", "Integrations", "Replies", "Brand", "Data", "Sync status", "Advanced"];

async function noSideScroll(page: Page, where: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${where}: the page is ${sw}px wide in a ${cw}px window`).toBeLessThanOrEqual(cw);
}

async function openSettings(page: Page, section?: string) {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  if (section) await page.evaluate((id) => localStorage.setItem("subsync-settings-section", id), section);
  await page.goto("/app#settings");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
}
const nav = (page: Page) => page.getByTestId("settings-nav");

async function api(page: Page, kind?: "business" | "client") {
  const s = await page.request.post("/api/sso", { data: { demo: true, as: kind } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  return {
    get: async (path: string): Promise<Json> => { const r = await page.request.get(`/api/app/${path}`, { headers }); expect(r.ok(), `${path}: ${r.status()}`).toBeTruthy(); return (await r.json()) as Json; },
    status: async (method: "POST" | "PUT", path: string, data: Json) => (await page.request.fetch(`/api/app/${path}`, { method, headers, data })).status(),
    post: async (path: string, data: Json) => { const r = await page.request.post(`/api/app/${path}`, { headers, data }); expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBeTruthy(); return (await r.json()) as Json; },
    put: async (path: string, data: Json) => { const r = await page.request.put(`/api/app/${path}`, { headers, data }); expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBeTruthy(); },
  };
}

test.describe.configure({ mode: "serial" });

test("Settings is in the eight sections, each opens, nothing scrolls sideways, and the choice is remembered", async ({ page }) => {
  await openSettings(page);
  for (const title of SECTIONS) await expect(nav(page).getByRole("button", { name: title, exact: true })).toBeVisible();
  await expect(nav(page).getByRole("button")).toHaveCount(SECTIONS.length);
  for (const title of SECTIONS) {
    await nav(page).getByRole("button", { name: title, exact: true }).click();
    await expect(nav(page).getByRole("button", { name: title, exact: true })).toHaveAttribute("aria-current", "page");
    // The Sync status panel carries its own heading; every other section has its own title and a one-line hint.
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
    await noSideScroll(page, title);
  }
  await nav(page).getByRole("button", { name: "Brand", exact: true }).click();
  await page.reload();
  await expect(nav(page).getByRole("button", { name: "Brand", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Data shows what is stored and what each button removes, and the demo cannot delete; Integrations lists Slack, Fathom and the permissions", async ({ page }) => {
  await openSettings(page, "privacy");
  const text = (await page.getByTestId("section-privacy").innerText()).replace(/\s+/g, " ");
  for (const l of storeLines({ meetings: false })) expect(text, `What we store lists "${l.title}"`).toContain(`${l.title}: ${l.text}`.replace(/\s+/g, " "));
  expect(text).toContain(deleteMyDataText().replace(/\s+/g, " "));
  await expect(page.getByRole("button", { name: "Delete all synced data" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "the Trust page" })).toHaveAttribute("href", "/trust");
  await openSettings(page, "integrations");
  // The Slack and Fathom cards (My connections, Team connections) are the top of Integrations, above the permissions.
  await expect(page.getByTestId("section-integrations").getByRole("heading", { name: "My connections", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What SubSync can read" })).toBeVisible();
  // The first details in Integrations is now the Fathom notice (My connections is above the permissions): take the first permission group.
  const first = page.getByTestId("permissions-summary").locator("xpath=..").locator("details").first();
  await first.locator("summary").click();
  await expect(first.getByText(/required|optional/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fathom", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Slack/ })).toBeVisible();
});

test("a change in one section is kept while another is open, the page says it is not saved, and a brand change saves and is recorded in the history", async ({ page }) => {
  const c = await api(page);
  const before = (await c.get("settings")).settings.brandName as string | null;
  try {
    await openSettings(page, "brand");
    await page.getByLabel("Business name").fill("Acme Marketing");
    await expect(page.getByTestId("brand-preview")).toContainText("Acme Marketing");
    await nav(page).getByRole("button", { name: "Advanced", exact: true }).click();
    await nav(page).getByRole("button", { name: "Brand", exact: true }).click();
    await expect(page.getByLabel("Business name")).toHaveValue("Acme Marketing");
    await expect(page.getByTestId("unsaved")).toBeVisible();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByTestId("settings-message")).toHaveText("Saved.");
    await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
    await nav(page).getByRole("button", { name: "Advanced", exact: true }).click();
    await expect(page.getByTestId("settings-history")).toContainText("Changed settings");
    await expect(page.getByTestId("settings-history")).toContainText("Brand name");
    expect(await page.getByTestId("settings-history").innerText(), "the history shows names, never values").not.toContain("Acme Marketing");
  } finally { await c.put("settings", { brandName: before }); }
});

test("Test and practice accounts: the owner switches an account out of every number, and back", async ({ page }) => {
  test.setTimeout(240_000);
  const c = await api(page);
  const accounts = (await c.get("settings")).testAccounts as Array<{ locationId: string; name: string; ignored: boolean }>;
  expect(accounts.length).toBeGreaterThan(0);
  const target = accounts.find((a) => !a.ignored)!;
  const counted = async () => (await c.get("segments")).total as number; // the filter bar's count leaves out accounts that are left out
  const start = await counted();
  try {
    await openSettings(page, "team");
    const sw = page.getByRole("switch", { name: `Leave ${target.name} out of every number` });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(page.getByTestId("settings-message")).toContainText("is left out of every number", { timeout: 120_000 });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    expect(await counted(), "the account stopped counting everywhere").toBe(start - 1);
    await sw.click();
    await expect(page.getByTestId("settings-message")).toContainText("counts again", { timeout: 120_000 });
    expect(await counted()).toBe(start);
  } finally { await c.put(`accounts/${target.locationId}/flags`, { ignored: false }); }
});

test("Give feedback and Report a problem are at the bottom of every page and say what was received", async ({ page }) => {
  for (const hash of ["today", "speed", "help", "roadmap"]) {
    await page.goto(`/app#${hash}`);
    await page.reload();
    await expect(page.getByTestId("feedback-box")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("feedback-box").getByRole("button", { name: "Give feedback" })).toBeVisible();
    await expect(page.getByTestId("feedback-box").getByRole("button", { name: "Report a problem" })).toBeVisible();
    await noSideScroll(page, hash);
  }
  const box = page.getByTestId("feedback-box");
  await box.getByRole("button", { name: "Give feedback" }).click();
  await expect(box.getByRole("button", { name: "Send feedback" })).toBeDisabled();
  await box.getByLabel("What should we add, change or fix?").fill("Please add a view by team member.");
  await box.getByLabel("How much does it matter?").selectOption("annoying");
  await box.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByTestId("feedback-done")).toContainText(/Your reference is R-[A-Z0-9]{6}/);
  // A problem report carries the error ID the screen showed (here sent through the same event the error state uses).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("subsync:report-problem", { detail: { errorId: "E-TEST01" } })));
  await expect(box.getByLabel(/Error ID/)).toHaveValue("E-TEST01");
  await box.getByLabel("What went wrong?").fill("The list never loaded.");
  await box.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByTestId("feedback-done")).toContainText(/Your reference is R-[A-Z0-9]{6}/);
});

test("feedback is validated on the server and a client's staff may send it too", async ({ page }) => {
  const agency = await api(page);
  expect(await agency.status("POST", "feedback", { message: "   " })).toBe(400);
  expect(await agency.status("POST", "problem", {})).toBe(400);
  expect(await agency.status("POST", "roadmap/suggest", { title: "" })).toBe(400);
  const client = await api(page, "client");
  expect(await client.status("POST", "feedback", { message: "From a client's staff member", page: "myday" })).toBe(200);
  expect(await client.status("PUT", "settings", { brandName: "x" }), "a client still cannot change settings").toBe(403);
});

test("the roadmap: status words with their meaning, one vote per person that can be taken back, a suggestion box, and the promise is reworded", async ({ page }) => {
  const c = await api(page);
  await page.goto("/app#roadmap");
  await page.reload();
  await expect(page.getByRole("heading", { name: "What's new and next", level: 1 })).toBeVisible();
  await expect(page.getByText("Votes help us decide what to build next.")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("We build in the order people ask");
  for (const label of ["Planned", "Considering", "Shipped"]) await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await expect(page.getByTestId("meaning-considering")).toContainText("Parked");
  // Vote, see it counted once, take it back.
  const first = (await c.get("roadmap")).items.find((i: Json) => i.status === "planned") as Json;
  const row = page.getByTestId("items-planned").locator("li").filter({ hasText: first.title });
  await row.getByRole("button", { name: /^Vote/ }).click();
  await expect(row.getByRole("button", { name: /^Voted/ })).toBeVisible();
  await row.getByRole("button", { name: /^Voted/ }).click();
  await expect(row.getByRole("button", { name: /^Vote/ })).toBeVisible();
  // Nothing shipped can be voted for.
  await expect(page.getByTestId("items-shipped").getByRole("button")).toHaveCount(0);
  const shipped = (await c.get("roadmap")).items.find((i: Json) => i.status === "shipped") as Json;
  expect(await c.status("POST", "roadmap", { key: shipped.key })).toBe(400);
  // Suggest something.
  await page.getByLabel("What would help?").fill("A weekly summary per team member");
  await page.getByLabel("How much does it matter to you?").selectOption("important");
  await page.getByRole("button", { name: "Send suggestion" }).click();
  await expect(page.getByTestId("suggest-done")).toContainText(/R-[A-Z0-9]{6}/);
  await expect(page.getByTestId("my-suggestions")).toContainText("A weekly summary per team member");
});

test("Getting started has a guide for each role, with Do it now links that open the right place and steps that tick from facts", async ({ page }) => {
  await page.goto("/app#help");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Getting started", level: 1 })).toBeVisible({ timeout: 60_000 });
  const owner = page.getByTestId("guide-steps");
  await expect(owner.locator("[data-step=targets]")).toContainText("Set your reply targets");
  await expect(owner.locator("[data-step=share]")).toContainText("Share an audit with a prospect");
  await expect(owner.locator("[data-step=connected]")).toHaveAttribute("data-done", "true");
  const targets = owner.locator("[data-step=targets]");
  // A step that has already ticked (for example when reply targets were saved earlier) offers a small link to the same place instead of "Do it now".
  await targets.getByRole("button", { name: "Do it now" }).or(targets.getByRole("button").last()).click();
  await expect(page.getByRole("heading", { name: "Replies", level: 2 })).toBeVisible();
  await expect(nav(page).getByRole("button", { name: "Replies" })).toHaveAttribute("aria-current", "page");

  await page.goto("/app?as=business#help");
  await page.reload();
  const biz = page.getByTestId("guide-steps");
  await expect(biz.locator("[data-step=targets]")).toBeVisible({ timeout: 60_000 });
  await expect(biz.locator("[data-step=share]")).toHaveCount(0);
  await expect(biz.locator("[data-step=clients]")).toHaveCount(0);

  await page.goto("/app?as=client#help");
  await page.reload();
  const staff = page.getByTestId("guide-steps");
  await expect(staff.locator("[data-step=today]")).toBeVisible({ timeout: 60_000 });
  for (const hidden of ["targets", "brief", "email", "clients", "share", "tests"]) await expect(staff.locator(`[data-step=${hidden}]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  await noSideScroll(page, "Getting started for a client's staff");
});

test("the Trust page is public, lists every permission and what is stored, names no platform or switched-off tool, and does not scroll sideways", async ({ page }) => {
  await page.goto("/trust");
  await expect(page.getByRole("heading", { level: 1, name: "Trust" })).toBeVisible();
  for (const id of ["read", "store", "how-long", "delete", "services", "security", "incidents", "status", "fathom", "company"]) await expect(page.locator(`#${id}`)).toBeAttached();
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const scope of GHL_SCOPES) expect(text, `the page says why ${scope} is asked`).toContain(scope);
  for (const l of storeLines({ meetings: true })) expect(text).toContain(`${l.title}: ${l.text}`.replace(/\s+/g, " "));
  expect(text).not.toMatch(/zoom|google meet|gohighlevel|highlevel/i);
  expect(text).toContain("has not been reviewed by Fathom yet");
  expect(text).toContain("What we promise");
  await expect(page.getByRole("link", { name: "Trust", exact: true }).first()).toHaveAttribute("href", "/trust");
  await noSideScroll(page, "/trust");
});
