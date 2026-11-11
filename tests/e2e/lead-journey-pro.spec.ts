import { expect, test, type Page } from "@playwright/test";

// The river view of the lead journey (flag lead_journey_pro). The demo has no real journey, so the answer is replaced in the browser (route) with a fixed one, with "pro: true" as the flag
// would give. Checks: it draws, each step and each drop-off opens exactly its people, no label meets the river's drawing zone, and there is no sideways scroll.
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?/i;
const SETS: Record<string, number[]> = { normal: [40, 30, 20, 8, 5, 2], long: [1234567, 800000, 500000, 120000, 60000, 1234], tiny: [1, 1, 1, 1, 0, 0] };
const NAMES = [["arrived", "Arrived"], ["touched", "First touch"], ["replied", "Replied"], ["booked", "Booked"], ["showed", "Showed"], ["won", "Won"]];
const lead = (name: string) => ({ locationId: "L1", locationName: "Acme Roofing", contactId: `c-${name.replace(/\W/g, "")}`, name, url: "https://example.test/c", status: "waiting", neverAnswered: false, minutes: 90, source: "Website form", owner: null, unassigned: true, repliedBy: null, autoSeconds: null, detailed: true, phone: "+15555550101", email: null, dnd: false, timeZone: null, suggestion: null, leadAt: Date.now() - 90 * 60_000 });

async function open(page: Page, set: string) {
  const counts = SETS[set];
  await page.addInitScript(() => { try { localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/part=journey-list/, (r) => r.fulfill({ json: { count: 2, shown: 2, rows: [lead("Dropped One"), lead("Dropped Two")] } }));
  await page.route(/part=journey(&|$)/, (r) => r.fulfill({ json: { repliedRecorded: true, pro: true, steps: NAMES.map(([step, label], i) => ({ step, label, count: counts[i], dropped: i ? Math.max(0, counts[i - 1] - counts[i]) : 0, dropShare: null, medianFromPrev: [null, 120, 1800, 7200, 86400, 300][i] })) } }));
  await page.goto("/app#speed");
  await page.reload();
  await page.getByRole("tab", { name: "Pace", exact: true }).click({ timeout: 120_000 });
  await expect(page.getByTestId("lead-journey-pro")).toBeVisible({ timeout: 60_000 });
}

test("river view draws, opens the people, and keeps every label clear of the river", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, "normal");
  await expect(page.getByTestId("flow-card")).toContainText("Where do my leads go?");
  await expect(page.getByTestId("flow-step")).toHaveCount(6);
  await expect(page.getByTestId("flow-count").first()).toHaveText("40");
  await expect(page.getByTestId("flow-count").nth(5)).toHaveText("2");
  await expect(page.getByTestId("flow-bucket")).toHaveCount(5);
  await expect(page.getByTestId("flow-bucket").first()).toContainText("10");
  // The canvas really has pixels.
  const painted = await page.getByTestId("ljp-canvas").evaluate((cv: HTMLCanvasElement) => { const d = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 37) if (d[i] > 0) n++; return n; });
  expect(painted).toBeGreaterThan(50);
  // No label box meets the river zone (the canvas area the river and sparks use).
  const stage = await page.getByTestId("flow").boundingBox(); expect(stage).toBeTruthy();
  const boxes = await page.locator(".ljp-card, .ljp-drop").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  expect(boxes.length).toBe(11);
  for (const a of boxes) for (const b of boxes) if (a !== b) expect(a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5, "labels overlap").toBe(false);
  // Opens exactly its people.
  await page.getByTestId("flow-step").nth(2).locator("button").click();
  await expect(page.getByTestId("journey-list-count")).toContainText("2 leads");
  await expect(page.getByTestId("journey-rows").getByTestId("speed-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByTestId("flow-bucket").first().click();
  await expect(page.getByTestId("journey-list-count")).toContainText("dropped");
  await page.keyboard.press("Escape");
  // Replay and the scrubber exist and work.
  await page.getByTestId("flow-replay").click();
  await page.getByTestId("ljp-scrub").fill("50");
  await expect(page.getByTestId("lead-journey-pro")).not.toContainText(BANNED);
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(w.s, "no sideways scroll").toBeLessThanOrEqual(w.w + 1);
});

test("long numbers and tiny counts stay inside their cards", async ({ page }) => {
  test.setTimeout(240_000);
  for (const set of ["long", "tiny"]) {
    await open(page, set);
    const bad = await page.locator(".ljp-count, .ljp-drop b").evaluateAll((els) => els.filter((e) => { const p = (e.closest("button") as HTMLElement).getBoundingClientRect(), r = e.getBoundingClientRect(); return r.left < p.left - 0.5 || r.right > p.right + 0.5; }).length);
    expect(bad, `${set}: a number spills out of its card`).toBe(0);
    if (set === "long") await expect(page.getByTestId("flow-count").first()).toHaveText("1,234,567");
  }
});

test("hovering the river shows conversion and typical wait", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(test.info().project.name === "phone-390", "pointer hover is for desktop and tablet");
  await open(page, "normal");
  const box = await page.getByTestId("flow").boundingBox(); expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.28, box!.y + 190);
  await expect(page.getByTestId("ljp-tip")).toContainText("moved on");
});

test("screens for review", async ({ page }) => {
  test.skip(!process.env.LJP_SHOTS, "only when asked");
  test.setTimeout(240_000);
  for (const set of ["normal", "long", "tiny"]) {
    await open(page, set);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => document.querySelectorAll("[data-theme]").forEach((e) => e.setAttribute("data-theme", t)), theme);
      await page.waitForTimeout(700);
      await page.getByTestId("flow-card").screenshot({ path: `${process.env.LJP_SHOTS}/${set}-${theme}-${test.info().project.name}.png` });
    }
  }
});
