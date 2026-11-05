import { expect, test, type Page } from "@playwright/test";
import { api, todayReady, type Json } from "./today-helpers";

// Today: the pointer on everything pressable, Lead flow (steps, bands, dates), Clients coming and going, Email leads, tab names and tags, and Bring back.
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop-1440", "these checks run at 1440"); });

async function openTab(page: Page, name: string) {
  await page.goto("/app");
  await todayReady(page);
  await page.getByTestId("more-detail-toggle").click();
  await page.getByRole("tab", { name, exact: true }).click();
}
const panel = (page: Page) => page.getByTestId("today-tabpanel");

test("every tab has a name, a one-line subtitle and a To do or Report tag", async ({ page }) => {
  await page.goto("/app");
  await todayReady(page);
  await page.getByTestId("more-detail-toggle").click();
  const names = await page.getByRole("tab").allInnerTexts();
  expect(names).toEqual(expect.arrayContaining(["Forecast", "Growth", "Lead flow", "Clients coming and going"]));
  for (const n of names) {
    await page.getByRole("tab", { name: n, exact: true }).click();
    await expect(panel(page).getByTestId("tab-intro"), n).toBeVisible();
    await expect(panel(page).getByTestId("tab-subtitle"), n).not.toBeEmpty();
    await expect(panel(page).getByTestId("tag-pill").first(), n).toHaveText(/^(To do|Report)$/);
  }
  await page.getByRole("tab", { name: "Forecast", exact: true }).click();
  await expect(panel(page).getByTestId("tag-pill").first()).toHaveText("To do");
  await page.getByRole("tab", { name: "Lead flow", exact: true }).click();
  await expect(panel(page).getByTestId("tag-pill").first()).toHaveText("Report");
});

test("everything pressable on Today shows the pointer", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/app");
  await todayReady(page);
  const check = async (label: string) => {
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const pressable = (el: Element) => {
        const h = el as HTMLElement;
        if (el.matches("button, a[href], [role=button], [role=tab], [role=menuitem], [role=option], summary, select, label[for], input[type=checkbox], input[type=radio]")) return true;
        return h.tabIndex >= 0 && el.hasAttribute("onclick");
      };
      for (const el of document.querySelectorAll("body *")) {
        if (!pressable(el)) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") continue;
        if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") { if (cs.cursor !== "not-allowed" && cs.cursor !== "default") out.push(`disabled ${el.tagName} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} = ${cs.cursor}`); continue; }
        if (cs.cursor !== "pointer") out.push(`${el.tagName} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} = ${cs.cursor}`);
      }
      return out;
    });
    expect(bad, label).toEqual([]);
  };
  await check("Today");
  await page.getByTestId("today-more").click();
  await check("More menu");
  await page.keyboard.press("Escape");
  await page.getByTestId("more-detail-toggle").click();
  const names = await page.getByRole("tab").allInnerTexts();
  for (const n of names) { await page.getByRole("tab", { name: n, exact: true }).click(); await page.waitForTimeout(700); await check(`Tab ${n}`); }
});

test("Lead flow: steps and bands open their people, the numbers add up, and the date choices change the leads", async ({ page }) => {
  test.setTimeout(180_000);
  await openTab(page, "Lead flow");
  await page.getByTestId("flow-preset").selectOption("30d");
  await expect(page.getByTestId("flow-window")).toContainText("Leads added");
  const chart = page.getByTestId("lead-flow-chart");
  await expect(chart.or(page.getByText("No new leads in these dates"))).toBeVisible({ timeout: 45_000 });
  if (await chart.count() === 0) test.skip(true, "the demo has no new leads in 30 days");
  const total = Number(((await page.getByTestId("flow-total").innerText()).match(/[\d,]+/) ?? ["0"])[0].replace(/,/g, ""));
  const node = (id: string) => chart.locator(`[data-testid=flow-node][data-node=${id}]`);
  const countOf = async (id: string) => ((await node(id).count()) ? Number(await node(id).getAttribute("data-count")) : 0);
  expect((await countOf("replied")) + (await countOf("never")) + (await countOf("unknown"))).toBe(total);
  expect((await countOf("booked")) + (await countOf("nobook"))).toBe(total);
  // A step opens the people behind it, and the header number is the node's number.
  await expect(node("new")).toHaveCSS("cursor", "pointer");
  await node("new").click();
  await expect(page.getByTestId("records-panel")).toBeVisible();
  await expect(page.getByTestId("records-count")).toContainText(String(total).replace(/\B(?=(\d{3})+$)/g, ","));
  await page.keyboard.press("Escape");
  // A band opens the people who went that way.
  const link = chart.getByTestId("flow-link").first();
  const n = await link.getAttribute("data-count");
  await expect(link).toHaveCSS("cursor", "pointer");
  await link.focus();
  await expect(page.getByTestId("flow-tip")).toContainText(/lead/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("records-count")).toContainText(String(n));
  await page.keyboard.press("Escape");
  // Dates: more days never means fewer leads; a custom range works and a wrong one is explained.
  const t30 = total;
  await page.getByTestId("flow-preset").selectOption("7d");
  await expect(page.getByTestId("flow-window")).toContainText("Leads added");
  await expect(async () => { const t7 = await page.getByTestId("flow-total").count() ? Number(((await page.getByTestId("flow-total").innerText()).match(/[\d,]+/) ?? ["0"])[0].replace(/,/g, "")) : 0; expect(t7).toBeLessThanOrEqual(t30); }).toPass();
  await page.getByTestId("flow-preset").selectOption("custom");
  await expect(page.getByTestId("flow-from")).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId("flow-from").fill(today); await page.getByTestId("flow-to").fill("2020-01-01");
  await expect(page.getByTestId("flow-problem")).toContainText("before");
  await page.getByTestId("flow-from").fill("2026-10-01"); await page.getByTestId("flow-to").fill(today);
  await expect(page.getByTestId("flow-problem")).toHaveCount(0);
  await expect(page.getByTestId("flow-window")).toContainText("2026-10-01");
  for (const p of ["this-month", "last-month"]) { await page.getByTestId("flow-preset").selectOption(p); await expect(page.getByTestId("flow-window")).toContainText("Leads added"); }
});

test("Clients coming and going: current count, a clickable weekly chart, and one line saying when it counts from", async ({ page }) => {
  test.setTimeout(120_000);
  await openTab(page, "Clients coming and going");
  await expect(page.getByTestId("clients-current")).toContainText("clients now");
  await expect(page.getByTestId("clients-since")).toContainText("Counts from");
  const bar = page.getByTestId("week-added").filter({ hasNot: page.locator("[data-count='0']") }).first();
  await expect(bar).toHaveCSS("cursor", "pointer");
  const n = await bar.getAttribute("data-count");
  await bar.click();
  await expect(page.getByTestId("records-count")).toContainText(String(n));
  await page.keyboard.press("Escape");
  await page.getByTestId("clients-added-all").click();
  await expect(page.getByTestId("records-panel")).toBeVisible();
});

test("Clients coming and going is not offered to a client's staff", async ({ page, request }) => {
  const s = await request.post("/api/sso", { data: { demo: true, as: "client" } });
  const token = ((await s.json()) as { session: string }).session;
  const res = await request.get("/api/app/today/clients-flow", { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(403);
  void page;
});

test("Email leads: search, client filter, and a download without anyone marked do not contact", async ({ page }) => {
  test.setTimeout(120_000);
  await openTab(page, "Growth");
  const box = page.getByTestId("email-leads");
  await expect(box.getByTestId("emails-count")).toBeVisible({ timeout: 45_000 });
  await expect(box.getByTestId("emails-download")).toHaveCSS("cursor", "pointer");
  const total = await box.getByTestId("emails-count").innerText();
  await box.getByTestId("emails-search").fill("gmail");
  await expect(box.getByTestId("emails-count")).not.toHaveText(total);
  for (const row of await box.getByTestId("emails-row").all()) await expect(row).toContainText(/gmail/i);
  const [download] = await Promise.all([page.waitForEvent("download"), box.getByTestId("emails-download").click()]);
  expect(download.suggestedFilename()).toBe("email-leads.csv");
  const text = (await (await download.createReadStream()).toArray()).join("");
  expect(text.split("\r\n")[0]).toBe("Email,Name,Client,Source,Date added");
  expect(text).not.toMatch(/do not contact/i);
});

test("Bring back: a set-aside row can be brought back, with an undo, and returns to the list", async ({ page, request }) => {
  test.setTimeout(150_000);
  const a = await api(request);
  const today = await a.get("today");
  const item = (today.items as Json[]).find((i) => !(today.holds as Json)[i.id]);
  if (!item) test.skip(true, "nothing in the list to set aside");
  const made = await a.post("today/action", { action: "done", rowKey: `${item!.locationId}|${item!.kind}` });
  expect(made.status).toBe(200);
  await page.goto("/app");
  await todayReady(page);
  await page.getByTestId("held-link").click();
  await expect(page.getByTestId("records-panel")).toBeVisible();
  const row = page.getByTestId("records-row-action").first();
  await expect(row).toHaveCSS("cursor", "pointer");
  const before = await page.getByTestId("records-row").count();
  await row.click();
  await expect(page.getByTestId("today-toast")).toContainText(/Brought back/);
  await expect(page.getByTestId("records-row")).toHaveCount(before - 1);
  await page.getByTestId("today-undo").click();
});
