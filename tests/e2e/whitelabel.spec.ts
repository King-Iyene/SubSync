import { expect, test, type Page } from "@playwright/test";

// A white-label customer must never see the platform's name, its host names, or our internal words, on any screen.
// The demo tenant is given a fake white-label domain (as an agency's own domain arrives at sign-in), every screen is
// opened, and everything a person can read or click is checked: visible text, page title, meta tags, every link,
// image, form action, label, placeholder and tooltip.
const DOMAIN = "crm.fakebrand.test";
const DEFAULT_HOST = /app\.gohighlevel\.com/i;
const PLATFORM = /gohighlevel|highlevel|leadconnector|\bghl\b/i;
const INTERNAL = /\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i;

// Every screen in the left menu (src/app/app/nav.ts), plus a client account's own page.
const VIEWS = ["today", "audit", "overview", "inbox", "speed", "appointments", "meetings", "search", "pipeline", "leads", "calls", "accounts", "clients", "team", "onboarding", "duplicates", "cleanup", "settings", "help", "roadmap"];
// Public pages that talk to agencies as their audience may say "agency". Nothing may name the platform.
const PUBLIC = [["/", true], ["/privacy", true], ["/terms", true], ["/support", true], ["/installed", false], ["/installed/error", false], ["/this-page-does-not-exist", false]] as const;

test.beforeEach(async ({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-1440", "content check: the three widths are covered by the layout tests"); });

async function demoSession(page: Page): Promise<string> {
  const res = await page.request.post("/api/sso", { data: { demo: true } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { session: string }).session;
}

// Everything a person can read or click on the page as it is now.
async function surface(page: Page) {
  return page.evaluate(() => {
    const attrs = ["href", "src", "action", "title", "alt", "aria-label", "placeholder", "content", "value"];
    const found: string[] = [document.title, document.body.innerText];
    const links: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      for (const a of attrs) { const v = el.getAttribute(a); if (v) found.push(`${el.tagName.toLowerCase()}[${a}]=${v}`); }
      if (el.tagName === "A") links.push((el as HTMLAnchorElement).href);
    });
    return { text: found.join("\n"), links };
  });
}

function check(where: string, s: { text: string; links: string[] }, agencyAllowed: boolean) {
  // The CRM's own addresses contain its path words (for example /v2/location/); a person reads the text around them.
  const readable = s.text.replace(/https?:[/][/][^\s"']+/g, "");
  const platform = s.text.match(PLATFORM);
  expect(platform, `${where} names the platform: "${platform?.[0]}"`).toBeNull();
  expect(s.text, `${where} links to the platform's default address`).not.toMatch(DEFAULT_HOST);
  if (!agencyAllowed) {
    const internal = readable.match(INTERNAL);
    expect(internal, `${where} uses the internal word "${internal?.[0]}" in: ${internal ? readable.slice(Math.max(0, (internal.index ?? 0) - 60), (internal.index ?? 0) + 60) : ""}`).toBeNull();
  } else {
    const internal = readable.replace(/\bagenc(y|ies)\b/gi, "").match(INTERNAL);
    expect(internal, `${where} uses the internal word "${internal?.[0]}"`).toBeNull();
  }
  for (const l of s.links) expect(l, `${where} has a link to the platform: ${l}`).not.toMatch(PLATFORM);
}

test("the demo tenant carries a white-label domain, and every Open link uses it", async ({ page }) => {
  const token = await demoSession(page);
  const put = await page.request.put("/api/app/settings", { headers: { Authorization: `Bearer ${token}` }, data: { appDomain: DOMAIN } });
  expect(put.ok(), await put.text()).toBeTruthy();
  const accounts = await page.request.get("/api/app/accounts", { headers: { Authorization: `Bearer ${token}` } });
  const body = await accounts.text();
  expect(body).toContain(`https://${DOMAIN}/v2/location/`);
  expect(body).not.toMatch(DEFAULT_HOST);
  expect(body).not.toMatch(PLATFORM);
});

let crmLinks = 0; // links to the white-label domain seen across the screens

for (const view of VIEWS) {
  test(`white-label check: ${view}`, async ({ page }) => {
    await page.goto(`/app#${view}`);
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(1500);
    const s = await surface(page);
    check(`/app#${view}`, s, false);
    for (const l of s.links) {
      const u = new URL(l);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue; // phone and email links
      if (u.hostname === DOMAIN) { crmLinks += 1; continue; }
      if (u.hostname === "localhost") continue;
      expect(["hooks.slack.com", "zoom.us", "marketplace.zoom.us", "api.slack.com", "slack.com", "fathom.video", "app.fathom.video"].some((h) => u.hostname === h || u.hostname.endsWith("." + h)), `${view}: unexpected outside link ${l}`).toBeTruthy();
    }
  });
}

for (const [path, agencyAllowed] of PUBLIC) {
  test(`white-label check: ${path}`, async ({ page }) => {
    await page.goto(path);
    check(path, await surface(page), agencyAllowed);
  });
}

test("the Open links on the screens really point at the white-label domain", () => {
  expect(crmLinks, "no screen showed an Open link to the CRM").toBeGreaterThan(0);
});

// The shared audit page with real data is checked in scripts/check-tenancy.ts (the demo tenant cannot create one).
test("white-label check: an unknown share link", async ({ page }) => {
  await page.goto("/audit/not-a-real-share-id");
  check("unknown share link", await surface(page), false);
});
