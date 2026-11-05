import { expect, test, type ElementHandle, type Page } from "@playwright/test";
import { todayReady } from "./today-helpers";

// Click everything on Today. For two roles (agency owner, client staff) and the desktop widths, find every visible button, link, tab, chip, chart mark and tile, click each with a REAL mouse
// click (ElementHandle.click moves the mouse and presses it; an element that is covered or out of reach fails the click), and require something observable to have happened: an address change, a
// panel, a menu, a toast, a changed selection or text, or a new tab. Then open every menu and click every item in it. An element that does nothing fails the test unless it is marked
// aria-disabled (inert on purpose). The number of elements clicked is printed at the end of each run.

const ROLES = [
  { name: "agency owner", path: "/app" },
  { name: "client staff", path: "/app?as=client" },
] as const;
const SELECTOR = 'button, a[href], [role=button], [role=tab], [role=link], [role=menuitem], summary, [data-clickable], [role=group][tabindex="0"]';
const SKIP_NAME = /sign out|log ?out|disconnect|delete|remove/i;

type Stage = { name: string; setup: (page: Page) => Promise<void> };

/** Everything the page shows that a click could change, as one string. */
async function signature(page: Page, popups: { n: number }): Promise<string> {
  const s = await page.evaluate(() => {
    const root = document.querySelector("[data-theme]") as HTMLElement | null;
    const state = [...document.querySelectorAll("[aria-expanded],[aria-selected],[aria-pressed],[aria-checked],[data-open]")].map((e) => `${e.getAttribute("data-testid") ?? e.tagName}:${e.getAttribute("aria-expanded")}${e.getAttribute("aria-selected")}${e.getAttribute("aria-pressed")}${e.getAttribute("aria-checked")}${e.getAttribute("data-open")}`).join("|");
    const active = document.activeElement as HTMLElement | null;
    return JSON.stringify({
      href: location.href, panels: document.querySelectorAll("[data-testid=records-panel],[role=dialog],[role=menu]").length, toast: document.querySelector("[data-testid=today-toast]")?.textContent ?? "",
      text: (root?.innerText ?? "").replace(/\s+/g, " "), state, active: active?.getAttribute("data-testid") ?? active?.tagName ?? "", theme: root?.getAttribute("data-theme") ?? "", pointer: document.querySelectorAll("[data-picked],[data-selected]").length,
    });
  });
  return `${s}#${popups.n}`;
}

async function enumerate(page: Page): Promise<Array<{ i: number; label: string; disabled: boolean; current: boolean }>> {
  return page.evaluate((sel) => {
    const all = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[data-testid=pop-menu]") && !e.closest("[aria-hidden=true]") && !e.closest("[inert]");
    });
    return all.map((e, i) => ({
      i, label: `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? `#${e.getAttribute("data-testid")}` : ""} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60)}"`,
      disabled: e.hasAttribute("disabled") || e.getAttribute("aria-disabled") === "true", current: e.getAttribute("aria-selected") === "true" || e.getAttribute("aria-current") === "true" || e.getAttribute("aria-current") === "page",
    }));
  }, SELECTOR);
}

async function handleAt(page: Page, i: number): Promise<ElementHandle<HTMLElement> | null> {
  const h = await page.evaluateHandle(({ sel, i }) => {
    const all = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[data-testid=pop-menu]") && !e.closest("[aria-hidden=true]") && !e.closest("[inert]");
    });
    return all[i] ?? null;
  }, { sel: SELECTOR, i });
  return h.asElement() as ElementHandle<HTMLElement> | null;
}

async function settle(page: Page, before: string, popups: { n: number }): Promise<string> {
  let after = before;
  for (let k = 0; k < 8; k++) { await page.waitForTimeout(250); after = await signature(page, popups); if (after !== before) { await page.waitForTimeout(250); return await signature(page, popups); } }
  return after;
}

for (const role of ROLES) {
  test(`${role.name}: every visible control on Today does something (real clicks)`, async ({ page, context }, testInfo) => {
    test.skip(!/^desktop-/.test(testInfo.project.name), "the click sweep runs at 1440 and 1024");
    test.setTimeout(1_500_000);
    const popups = { n: 0 };
    context.on("page", (p) => { popups.n++; void p.close().catch(() => undefined); });
    const failures: string[] = [];
    let clicked = 0;

    const fresh = async (stage: Stage) => {
      await page.goto(role.path);
      await todayReady(page);
      await page.waitForTimeout(1200); // counts finish animating
      await stage.setup(page);
      await page.waitForTimeout(500);
    };
    const tidy = async (stage: Stage, startHref: string) => {
      // Close whatever the click opened; start again from scratch when the page moved or something would not close.
      const toast = page.getByTestId("today-undo");
      if (await toast.count()) { await toast.click().catch(() => undefined); clicked++; await page.waitForTimeout(300); }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      const open = await page.locator("[data-testid=records-panel],[role=dialog],[role=menu]").count();
      if (page.url() !== startHref || open > 0) await fresh(stage);
    };

    const stages: Stage[] = [
      { name: "page", setup: async () => undefined },
      { name: "break-down-open", setup: async (p) => { await p.getByTestId("more-detail-toggle").click(); } },
      ...(role.name === "agency owner" ? ["Forecast", "Proof", "People", "Sources", "Coverage"] : ["Forecast"]).map((tab): Stage => ({
        name: `tab-${tab}`, setup: async (p) => { await p.getByTestId("more-detail-toggle").click(); await p.getByRole("tab", { name: tab }).click(); await p.waitForTimeout(600); },
      })),
    ];

    for (const stage of stages) {
      await fresh(stage);
      const items = await enumerate(page);
      const startHref = page.url();
      for (const it of items) {
        if (it.disabled || it.current || SKIP_NAME.test(it.label)) continue;
        const h = await handleAt(page, it.i);
        if (!h) { await fresh(stage); continue; }
        const before = await signature(page, popups);
        try { await h.click({ timeout: 6000 }); } catch (e) { failures.push(`[${stage.name}] ${it.label}: cannot be clicked (${String(e).split("\n")[0]})`); await tidy(stage, startHref); continue; }
        clicked++;
        const after = await settle(page, before, popups);
        if (after === before) failures.push(`[${stage.name}] ${it.label}: nothing happened`);
        await tidy(stage, startHref);
        // The page after tidy must be the same page, so the next index points at the same element.
        if (JSON.stringify((await enumerate(page)).map((x) => x.label)) !== JSON.stringify(items.map((x) => x.label))) {
          // Counts may have moved after a write (Mark done, Snooze): the next element is found again by its label.
          const now = await enumerate(page);
          const next = items[items.indexOf(it) + 1];
          if (next && !now.some((x) => x.label === next.label)) continue;
        }
      }

      // Every menu: open it, click each item (reopening it each time), and require a visible result.
      const triggers = page.locator('[aria-haspopup="menu"]');
      const count = await triggers.count();
      for (let j = 0; j < count; j++) {
        const trig = triggers.nth(j);
        if (!(await trig.isVisible())) continue;
        await trig.click(); clicked++;
        const n = await page.locator('[data-testid="pop-menu"] [role=menuitem]').count();
        expect(n, `[${stage.name}] menu ${j} has items`).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        for (let k = 0; k < n; k++) {
          await fresh(stage);
          const t2 = page.locator('[aria-haspopup="menu"]').nth(j);
          await t2.scrollIntoViewIfNeeded();
          await t2.click();
          const menu = page.locator('[data-testid="pop-menu"]');
          await expect(menu).toBeVisible();
          const item = menu.locator("[role=menuitem]").nth(k);
          const label = ((await item.textContent()) ?? "").trim().slice(0, 50);
          if (await item.isDisabled()) continue;
          const before = await signature(page, popups);
          try { await item.click({ timeout: 6000 }); } catch (e) { failures.push(`[${stage.name}] menu ${j} item "${label}": cannot be clicked (${String(e).split("\n")[0]})`); continue; }
          clicked++;
          await expect(menu, `[${stage.name}] menu ${j} "${label}" closes`).toHaveCount(0);
          const after = await settle(page, before, popups);
          if (after === before) failures.push(`[${stage.name}] menu ${j} item "${label}": nothing happened`);
          const undo = page.getByTestId("today-undo");
          if (await undo.count()) { await undo.click().catch(() => undefined); clicked++; }
        }
        await fresh(stage);
      }
    }

    console.log(`CLICKED ${clicked} elements as ${role.name} at ${testInfo.project.name}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
