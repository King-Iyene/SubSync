import { expect, test, type Page } from "@playwright/test";
import { deleteMyDataText, storeLines, uninstallText } from "../../src/lib/data-inventory";

// Stage S0.2b in the real browser, at the server's real default switches (the e2e server removes FLAGS_ALL_ON): Zoom and Google Meet are off and
// the Meeting notes page is off. Desktop width only; the three widths are covered by the layout tests.
// Each page is its own test: opening a page here costs 10 to 25 seconds on this machine's database link, and a settings save also loads every account.
test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "content check"); });

const NAMED = /zoom|google meet/i;
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

// Open a page and wait until its own heading is there (the menu also holds the page names, so the heading is what proves the page itself loaded).
async function open(page: Page, hash: string, heading: string) {
  await page.goto("/app");
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  await page.goto(`/app#${hash}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

const bodyText = async (page: Page) => flat(await page.locator("body").innerText());

test("Settings names neither Zoom nor Google Meet, and points to Connections", async ({ page }) => {
  await open(page, "settings", "Settings");
  await expect(page.getByText("Delete my data").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Connections", exact: true })).toBeVisible();
  expect(await bodyText(page), "Settings names Zoom or Google Meet").not.toMatch(NAMED);
});

// Stage E0 moved the connections out of Settings into their own page: Slack and Fathom stay visible, Zoom and Google Meet stay hidden.
test("Connections names neither Zoom nor Google Meet, and Slack and Fathom stay on it", async ({ page }) => {
  await open(page, "connections", "Connections");
  await expect(page.getByRole("heading", { name: "Fathom", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Slack/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /zoom/i })).toHaveCount(0);
  expect(await bodyText(page), "Connections names Zoom or Google Meet").not.toMatch(NAMED);
});

for (const [hash, heading] of [["help", "Getting started"], ["roadmap", "What's new and next"], ["today", "Today"], ["accounts", "Accounts"], ["duplicates", "Duplicate contacts"]] as const) {
  test(`the ${hash} page names neither Zoom nor Google Meet`, async ({ page }) => {
    await open(page, hash, heading);
    expect(await bodyText(page), `the ${hash} page names Zoom or Google Meet`).not.toMatch(NAMED);
    if (hash === "help") {
      // Getting started has no meeting-tool step while the Meeting notes page is off
      await expect(page.getByText("See what needs you today")).toBeVisible();
      const text = await bodyText(page);
      expect(text).not.toContain("Connect a meeting tool");
      expect(text).not.toContain("Open Meeting notes");
    }
  });
}

test("the Meeting notes page is off: not in the menu, and an address typed by hand says it is switched off", async ({ page }) => {
  await open(page, "settings", "Settings");
  await expect(page.getByRole("complementary").getByRole("button", { name: "Meeting notes", exact: true })).toHaveCount(0);
  await expect(page.getByText("Meeting notes privacy")).toHaveCount(0); // nothing is connected, so its switches are not shown either
  await page.goto("/app#meetings");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Not available" })).toBeVisible();
  expect(await bodyText(page)).toMatch(/This page is switched off right now/);
});

test("the privacy page names Slack and Fathom but not Zoom or Google Meet, and is produced from the same list as Settings", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("What we read and store")).toBeVisible();
  const text = flat(await page.locator("main").innerText());
  expect(text).not.toMatch(NAMED);
  expect(text).toContain("If you connect Slack or Fathom");
  for (const l of storeLines({ meetings: true })) expect(text, `the privacy page lists "${l.title}"`).toContain(flat(`${l.title}: ${l.text}`));
  expect(text).toContain(flat(deleteMyDataText()));
  expect(text).toContain(flat(uninstallText()));
  expect(text).toContain("only the owner of the company account");
  await page.goto("/support");
  expect(flat(await page.locator("main").innerText())).not.toMatch(NAMED);
});

test("Settings shows what is stored and what each button removes, produced from the schema's list, and the demo cannot delete", async ({ page }) => {
  await open(page, "settings", "Settings");
  await expect(page.getByText("What we store").first()).toBeVisible();
  const text = await bodyText(page);
  for (const l of storeLines({ meetings: false })) expect(text, `What we store lists "${l.title}"`).toContain(flat(`${l.title}: ${l.text}`));
  expect(text).toContain(flat(deleteMyDataText()));
  expect(text).toContain(flat(uninstallText()));
  expect(text).toContain("birth date"); // the old hand-written card did not mention it
  await expect(page.getByRole("button", { name: "Delete all synced data" })).toBeDisabled();
  await expect(page.getByLabel("Type DELETE to confirm")).toBeDisabled();
});

test("Links: the address is found by itself, saving other settings keeps it that way, and a typed address is only an override that can be taken off", async ({ page, request }) => {
  // Every settings call also loads every account, which is slow on this machine's database link, so there are few of them and the limit is long.
  test.setTimeout(300_000);
  const res = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await res.json()) as { session: string }).session}` };
  type S = { settings: { appDomain: string; appDomainSource: string; detectedDomain: string | null } };
  const put = async (data: Record<string, unknown>) => { const r = await request.put("/api/app/settings", { headers, data, timeout: 120_000 }); expect(r.ok(), await r.text()).toBeTruthy(); return ((await r.json()) as S).settings; };
  const start = await put({ appDomainOverride: null });
  expect(start.appDomainSource).not.toBe("manual");
  try {
    // An older screen sends the domain on every save: when it is what the links already use, it must not become a typed one.
    // (Only settings that change no number are sent along: a reply-target save recalculates every account, which takes many seconds.)
    const same = await put({ brandName: "Zz Check", appDomain: start.appDomain });
    expect(same.appDomainSource, "saving the form with the address unchanged does not freeze it as typed").toBe(start.appDomainSource);
    // Typing an address is an override and wins.
    await put({ brandName: null, appDomainOverride: "crm.override.test" });
    await open(page, "settings", "Settings");
    await expect(page.getByText("You set this address yourself below.")).toBeVisible();
    expect(await bodyText(page)).toContain("crm.override.test");
    await expect(page.getByRole("button", { name: "Stop using my address" })).toBeVisible();
    // A value that is not a domain is refused before anything is loaded or saved.
    expect((await request.put("/api/app/settings", { headers, data: { appDomainOverride: "not a domain" } })).status()).toBe(400);
    // Taking the override off goes back to what was found (nothing, for the demo).
    const back = await put({ appDomainOverride: null });
    expect([back.appDomain, back.appDomainSource]).toEqual([start.appDomain, start.appDomainSource]);
    await open(page, "settings", "Settings");
    await expect(page.getByTestId("domain-source")).toContainText(/found this address by itself|has not seen your own login address yet/);
  } finally {
    await put({ appDomainOverride: null, brandName: null });
  }
});
