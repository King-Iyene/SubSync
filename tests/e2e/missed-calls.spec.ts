import { expect, test, type Page } from "@playwright/test";

// Missed calls nobody called back (stage MISSED) at desktop-1440 and phone-390: Speed > Coverage and Speed > Call mode show the SAME people (one count, one list), Call mode lists them first,
// is paged on the server (20, 50 or 100 at a time) and follows the page's date range. The browser talks to SubSync's own API, so the answers are mocked here; the one shared SQL definition,
// tenancy and the 100,000-row speed are tested in tests/unit/missed-calls-db.test.ts and src/lib/__tests__.
test.describe.configure({ mode: "serial" });

const person = (n: number) => ({ contactId: `c${n}`, locationId: "L1", locationName: "KD Squares Test", name: n === 1 ? "(919) 771-6040" : `Caller ${n}`, phone: `+1919771${String(n).padStart(4, "0")}`, dnd: false, timeZone: null, openValue: n === 1 ? 5000 : 0, ageHours: 1, priority: 50, reasons: ["Missed call, no callback yet"], source: null, url: "https://example.test/c" + n });
const row = {
  locationId: "L1", locationName: "KD Squares Test", contactId: "c1", name: "(919) 771-6040", url: "https://example.test/c1", status: "waiting", neverAnswered: false, minutes: 14, source: "Direct", owner: null, unassigned: true, repliedBy: null, autoSeconds: null, personSeconds: null,
  detailed: false, phone: "+19197716040", email: null, dnd: false, timeZone: null, suggestion: null, calledAt: Date.now() - 14 * 60_000, dollars: 5000, callState: "open",
};
const COVERAGE = {
  now: Date.now(), eventsStored: 5,
  missed: { total: 3, recovered15: 2, unrecovered: 1, dollars: 5000, rows: [row], recoveredRows: [], audit: { missed: 3, textedWithin60: 1, share: null, enough: false } },
  night: { rows: [], lost: 0, countedDollars: 0, estimate: null, hoursToCover: [], afterLeads: 0, answeredSameNight: 0, share: null, cover: [] },
  best: { hours: [], best: [], enough: false, tries: 0 }, channels: [], routing: { enough: false, fair: null, noLeads: [], overloaded: [] },
};

async function mock(page: Page, seen: string[], total: number) {
  await page.addInitScript(() => { try { localStorage.setItem("subsync.dial.auto", "false"); localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/\/api\/app\/dial\/queue/, (r) => {
    const u = new URL(r.request().url()); seen.push(u.search);
    const size = Number(u.searchParams.get("size") ?? 50), pageNo = Number(u.searchParams.get("page") ?? 0);
    const from = pageNo * size, n = Math.max(0, Math.min(size, total - from));
    return r.fulfill({ json: { list: "missed", lists: [{ id: "missed", label: "Missed calls, no callback", help: "" }, { id: "new_unanswered", label: "New leads not yet reached", help: "" }], total, page: pageNo, size, dollars: 5000, ownOnly: false, me: "You", items: Array.from({ length: n }, (_, i) => person(from + i + 1)) } });
  });
  await page.route(/\/api\/app\/dial\/stats/, (r) => r.fulfill({ json: { people: [], own: false } }));
  await page.route(/\/api\/app\/dial\/script/, (r) => r.fulfill({ json: { script: null, default: "x", canEdit: true } }));
  await page.route(/\/api\/app\/speed\?part=coverage/, (r) => r.fulfill({ json: COVERAGE }));
}
const open = async (page: Page, tab: RegExp) => {
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: tab }).click();
};
// Nothing a person can see may run past the screen's right edge (an invisible tooltip bubble that is positioned off to the side does not count).
const noSideways = async (page: Page) => expect(await page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const clipped = (e: Element) => { for (let p = e.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true; return false; };
  return [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && getComputedStyle(e).visibility === "visible" && !clipped(e); }).map((e) => e.getAttribute("data-testid") ?? e.tagName);
})).toEqual([]);

test("Coverage and Call mode show the same missed-call callers: one count, one list, Start", async ({ page }) => {
  test.setTimeout(300_000);
  const seen: string[] = [];
  await mock(page, seen, 1);
  await open(page, /^Coverage/);
  // Coverage: one caller is waiting, with the dollars; the count under it opens exactly that person.
  await expect(page.getByTestId("missed-headline")).toContainText("1 caller is still waiting for a callback or text");
  await expect(page.getByTestId("missed-rows").getByTestId("speed-row")).toHaveCount(1);
  await page.getByTestId("count-unrecovered").click();
  await expect(page.getByTestId("count-list-count")).toContainText("1 not called back");
  await expect(page.getByTestId("count-list").getByTestId("speed-row")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Call mode: the first list is the same caller; the clickable count equals the rows; Start is enabled.
  await page.getByRole("tab", { name: /^Call mode/ }).click();
  await expect(page.getByTestId("dial-list-missed")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dial-count")).toContainText("1 person ready to call");
  await expect(page.getByTestId("dial-start")).toBeEnabled();
  await page.getByTestId("dial-count-open").click();
  await expect(page.getByText("(919) 771-6040").first()).toBeVisible();
  // The request carries the page, the size and the date range of the page (the same dates Coverage reads).
  expect(seen.some((s) => /list=missed/.test(s) && /page=0/.test(s) && /size=50/.test(s) && /from=\d{4}-\d{2}-\d{2}/.test(s) && /to=\d{4}-\d{2}-\d{2}/.test(s))).toBe(true);
  await page.keyboard.press("Escape");
  await noSideways(page);
});

test("Call mode pages from the server: 20, 50 or 100 at a time, with the true total", async ({ page }) => {
  test.setTimeout(300_000);
  const seen: string[] = [];
  await mock(page, seen, 120);
  await open(page, /^Call mode/);
  await expect(page.getByTestId("dial-count")).toContainText("50 people ready to call");
  await expect(page.getByTestId("dial-count")).toContainText("showing 1 to 50 of 120");
  await expect(page.getByTestId("dial-page-text")).toHaveText("Page 1 of 3");
  await expect(page.getByTestId("dial-prev")).toBeDisabled();
  for (const id of ["dial-prev", "dial-next", "dial-size"]) expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(page.viewportSize()!.width < 500 ? 40 : 28);
  await page.getByTestId("dial-next").click();
  await expect(page.getByTestId("dial-page-text")).toHaveText("Page 2 of 3");
  expect(seen.some((s) => /page=1/.test(s) && /size=50/.test(s))).toBe(true);
  await page.getByTestId("dial-next").click();
  await expect(page.getByTestId("dial-count")).toContainText("20 people ready to call");
  await expect(page.getByTestId("dial-next")).toBeDisabled();
  await page.getByTestId("dial-size").selectOption("20");
  await expect(page.getByTestId("dial-page-text")).toHaveText("Page 1 of 6");
  expect(seen.some((s) => /page=0/.test(s) && /size=20/.test(s))).toBe(true);
  await page.getByTestId("dial-size").selectOption("100");
  await expect(page.getByTestId("dial-count")).toContainText("showing 1 to 100 of 120");
  await noSideways(page);
});
