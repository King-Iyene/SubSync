import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Z1: the evidence for the buyer and UX review. Opens every page of the menu at the three required widths on the demo tenant, saves a
// screenshot of each, and records what a reviewer would otherwise have to notice by hand: console errors, failed requests, sideways scroll,
// how long the page took to show something, and the platform's name or our internal words in the text. It only runs when REVIEW=1, so the
// normal browser suite is not slowed down:  REVIEW=1 npx playwright test tests/e2e/review-capture.spec.ts
const PAGES = ["today", "audit", "overview", "inbox", "speed", "appointments", "meetings", "search", "pipeline", "leads", "calls", "accounts", "clients", "team", "onboarding", "duplicates", "cleanup", "settings", "help", "roadmap"];
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\blocations?\b|\bagenc(y|ies)\b/i;

test.skip(!process.env.REVIEW, "set REVIEW=1 to capture the review evidence");
test.describe.configure({ mode: "serial" });

const rows: Array<Record<string, unknown>> = [];
mkdirSync("docs/review", { recursive: true });

for (const id of PAGES) {
  test(`capture ${id}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const width = testInfo.project.name.replace(/\D+/g, "") || "0";
    const errors: string[] = [];
    const failed: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    const t0 = Date.now();
    await page.goto(`/app#${id}`);
    await page.reload();
    await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
    await page.locator("main h1").first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    const firstContentMs = Date.now() - t0;
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      text: document.body.innerText,
      heading: (document.querySelector("main h1") as HTMLElement | null)?.innerText ?? null,
      spinners: document.querySelectorAll('[aria-busy="true"], [role="progressbar"]').length,
    }));
    await page.screenshot({ path: `docs/review/z1-${id}-${width}.png`, fullPage: true });
    rows.push({ page: id, width: Number(width), heading: m.heading, firstContentMs, overflow: m.overflow, errors, failed, bannedWord: m.text.match(BANNED)?.[0] ?? null, spinnersLeft: m.spinners, characters: m.text.length });
    writeFileSync(`docs/review/z1-capture-${width}.json`, JSON.stringify(rows, null, 2));
    expect(errors, `${id} at ${width}px logged errors`).toEqual([]);
  });
}
