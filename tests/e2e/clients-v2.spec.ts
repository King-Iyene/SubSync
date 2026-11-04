import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The rebuilt Clients screen (docs/CLIENTS_REVIEW.md, docs/features/CLIENTS.md) on the demo company, at the three widths of the projects. The demo is shared, so every change a
// test makes is undone in the same test. Covers: the sentence and the one button, five rows and a server-paged See all whose count equals the headline, fee typed in the row
// and kept, the client's page (reasons, what to say, value, renewal, log), the phone (no sideways scroll, thumb-sized targets), and that a client's staff and a business owner
// never reach a fee, a note or the book (server side).
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function headers(request: APIRequestContext, as?: "business" | "client"): Promise<{ Authorization: string }> {
  const s = await request.post("/api/sso", { data: { demo: true, ...(as ? { as } : {}) } });
  return { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
}
async function api(request: APIRequestContext, method: "get" | "put" | "post" | "delete", path: string, data?: unknown): Promise<Json> {
  const res = await request[method](`/api/app/${path}`, { headers: await headers(request), ...(data !== undefined ? { data } : {}) });
  expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Json;
}
async function noSideScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${label} scrolls sideways`).toBeLessThanOrEqual(innerWidth + 1);
}
const BANNED = /gohighlevel|highlevel|\bghl\b|leadconnector|sub-?account/i;
async function openBook(page: Page) {
  await page.goto("/app#clients");
  await page.reload();
  await expect(page.getByTestId("book")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("who-needs-you").or(page.getByTestId("all-clear"))).toBeVisible({ timeout: 120_000 });
}

test("the sentence is the API's, there is one filled button, and no more than five rows are inline", async ({ page, request }) => {
  const home = await api(request, "get", "clients?part=home");
  await openBook(page);
  await expect(page.getByTestId("today-headline")).toHaveText(home.headline.text.replace(/\s+/g, " "), { useInnerText: true });
  if (home.primary) await expect(page.getByTestId("today-primary-button")).toHaveText(new RegExp(home.primary.label));
  expect(await page.getByTestId("today-primary-button").count()).toBeLessThanOrEqual(1);
  expect(await page.getByTestId("needs-rows").getByTestId("client-row").count()).toBeLessThanOrEqual(5);
  const text = await page.locator("main").innerText();
  expect(text).toContain("You enter this; SubSync does not read it from your CRM.");
  expect(text).not.toMatch(/\bn\/a\b/);
  expect(text).not.toMatch(BANNED);
  await noSideScroll(page, "Clients");
});

test("See all opens the whole book with the headline's own count, searched, ordered and paged on the server", async ({ page, request }) => {
  const home = await api(request, "get", "clients?part=home");
  expect(home.needs.rows.length).toBeLessThanOrEqual(5);
  const list = await api(request, "get", "clients?part=list&filter=needs&size=3&page=0");
  expect(list.total).toBe(home.needs.total);
  expect(list.rows.length).toBeLessThanOrEqual(3);
  expect((await api(request, "get", "clients?part=list&size=500")).rows.length).toBeLessThanOrEqual(50);
  await openBook(page);
  if (home.needs.total > home.needs.rows.length) {
    await page.getByTestId("needs-all").click();
    await expect(page.getByTestId("book-list-count")).toHaveText(String(home.needs.total));
    await expect(page.getByTestId("book-list-rows").getByTestId("client-row")).toHaveCount(Math.min(25, home.needs.total));
  } else {
    await page.getByTestId("count-at_risk").or(page.getByTestId("all-clients")).first().click();
  }
  // The chips carry the server's counts, and the chip count equals the list it opens.
  const chip = page.getByTestId("chip-at_risk");
  if (await chip.count()) {
    const n = Number(/(\d+)\s*$/.exec((await chip.innerText()).trim())?.[1]);
    await chip.click();
    await expect(page.getByTestId("book-list-count")).toHaveText(String(n));
    expect(n).toBe(home.summary.atRisk);
  }
  // Search narrows on the server.
  const first = (await api(request, "get", "clients?part=list&size=1")).rows[0].name as string;
  await page.getByTestId("chip-all").click();
  await page.getByTestId("book-search").fill(first.slice(0, 6));
  await expect(page.getByTestId("book-list-rows").getByTestId("client-row").first()).toContainText(first.slice(0, 6));
  await page.getByTestId("book-list-back").click();
  await expect(page.getByTestId("book-list")).toHaveCount(0);
});

test("the fee is typed in the row, kept, and the money at stake moves with it", async ({ page, request }) => {
  const list = await api(request, "get", "clients?part=list&filter=at_risk&size=1");
  test.skip(list.rows.length === 0, "the demo has no client at risk right now");
  const c = list.rows[0] as Json;
  const oldFee = c.fee as number | null;
  const before = (await api(request, "get", "clients?part=home")).summary.atRiskFee as number;
  await openBook(page);
  await page.getByTestId("needs-all").or(page.getByTestId("all-clients")).first().click();
  await page.getByTestId("book-search").fill(c.name);
  const row = page.getByTestId("book-list-rows").getByTestId("client-row").filter({ hasText: c.name }).first();
  try {
    await row.getByRole("button", { name: /change the fee|^Add fee/ }).click();
    await row.getByLabel(/pays you per month/).fill("3210");
    await row.getByLabel(/pays you per month/).press("Enter");
    await expect(row).toContainText("$3,210");
    const after = await api(request, "get", "clients?part=home");
    expect(after.summary.atRiskFee).toBe(before - (oldFee ?? 0) + 3210);
    // Escape cancels without saving.
    await row.getByRole("button", { name: /change the fee/ }).click();
    await row.getByLabel(/pays you per month/).fill("9999");
    await row.getByLabel(/pays you per month/).press("Escape");
    await expect(row).toContainText("$3,210");
  } finally {
    await api(request, "put", `clients/${c.id}`, { monthlyFee: oldFee === null ? "" : String(oldFee) });
  }
});

test("a client's page: why, what to say (text only), what changed, fee against value, renewal, the log; and a summary with no fee in it", async ({ page, request }) => {
  const home = await api(request, "get", "clients?part=home");
  const id = (home.needs.ids[0] ?? home.firstId) as string;
  const one = await api(request, "get", `clients?part=one&id=${id}`);
  expect(one.summary).not.toMatch(/pay you|monthly fee|\bfee\b/i);
  expect(one.summary).not.toMatch(BANNED);
  for (const t of one.talk as Json[]) expect(t.say).not.toMatch(/SubSync|\bfee\b/i);
  await openBook(page);
  await page.getByTestId("open-client").first().click();
  await expect(page.getByTestId("client-name")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("client-crm")).toHaveAttribute("href", /^https:\/\//);
  await expect(page.getByTestId("what-to-say")).toBeVisible();
  await expect(page.getByTestId("what-changed")).toBeVisible();
  await expect(page.getByTestId("value-sentence")).toContainText("Value created.");
  await page.getByTestId("value-formula-toggle").click();
  await expect(page.getByTestId("value-formula")).toContainText("divided by what the client pays you each month");
  await expect(page.getByTestId("fee-value")).toContainText("You enter this; SubSync does not read it from your CRM.");
  await expect(page.getByTestId("conversations")).toBeVisible();
  expect(await page.locator("a[href^='tel:']").count()).toBe(0);
  expect(await page.locator("main").innerText()).not.toMatch(BANNED);
  // The queue: next goes to the next client who needs you, back returns to the book.
  if (one.queue.next) {
    await page.getByTestId("client-next").click();
    await expect(page.getByTestId("client-name")).not.toHaveText(one.row.name, { timeout: 120_000 });
  }
  await page.getByTestId("client-back").click();
  await expect(page.getByTestId("book")).toBeVisible();
  await noSideScroll(page, "Clients, one client");
});

test("a conversation can be logged on the client's page and removed again", async ({ page }) => {
  await openBook(page);
  await page.getByTestId("open-client").first().click();
  await expect(page.getByTestId("client-name")).toBeVisible({ timeout: 120_000 });
  const log = page.getByTestId("client-log");
  await log.getByLabel("What was said or decided").fill("Playwright check: renewal call booked");
  await log.getByRole("button", { name: "Add to the log" }).click();
  await expect(log).toContainText("Playwright check: renewal call booked");
  await log.getByRole("listitem").filter({ hasText: "Playwright check" }).getByRole("button", { name: "Remove" }).click();
  await expect(log).not.toContainText("Playwright check");
});

test("phone: nothing scrolls sideways and the row buttons are thumb-sized", async ({ page }, info) => {
  await openBook(page);
  await noSideScroll(page, "Clients");
  if (info.project.name !== "phone-390") return;
  const buttons = page.getByTestId("needs-rows").locator("button[data-testid=open-client], button[data-testid=client-more], button[data-testid=add-fee], button[data-testid=fee-value], button[data-testid=add-renewal], button[data-testid=renewal-value]");
  const n = await buttons.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box?.height ?? 0, `target ${i}`).toBeGreaterThanOrEqual(43);
  }
  const primary = await page.getByTestId("today-primary-button").boundingBox();
  if (primary) expect(primary.height).toBeGreaterThanOrEqual(43);
});

test("the demo looks real: fees, renewals, industries and logged conversations, and the money is the fees of the clients at risk", async ({ request }) => {
  const home = await api(request, "get", "clients?part=home");
  expect(home.summary.total).toBeGreaterThanOrEqual(10);
  expect(home.summary.noFees).toBe(false);
  expect(home.summary.feeCount).toBeGreaterThanOrEqual(10);
  expect(home.summary.feeTotal).toBeGreaterThan(10_000);
  expect(home.renewals.total).toBeGreaterThanOrEqual(3);
  const all = await api(request, "get", "clients?part=list&size=50");
  expect((all.rows as Json[]).filter((r) => r.industry).length).toBeGreaterThanOrEqual(10);
  const atRisk = await api(request, "get", "clients?part=list&filter=at_risk&size=50");
  expect(atRisk.total).toBe(home.summary.atRisk);
  expect((atRisk.rows as Json[]).reduce((s, r) => s + (r.fee ?? 0), 0)).toBe(home.summary.atRiskFee);
  // Every client listed as needing you wears a reason in words, and none of them is called Healthy there.
  for (const r of home.needs.rows as Json[]) { expect(r.line.length).toBeGreaterThan(10); expect(r.needs).not.toBeNull(); expect(r.needs.label).not.toBe("Healthy"); }
});

test("a client's staff and a business owner never reach the book, a fee, a renewal or a note", async ({ request }) => {
  const id = ((await api(request, "get", "clients?part=home")).firstId ?? "demo-loc-1") as string;
  for (const as of ["business", "client"] as const) {
    const h = await headers(request, as);
    for (const path of ["clients?part=home", "clients?part=list", "clients?part=names", `clients?part=one&id=${id}`, "clients", `clients/${id}/notes`]) {
      const r = await request.get(`/api/app/${path}`, { headers: h });
      expect(r.status(), `${as} GET ${path}`).toBe(403);
      expect(await r.text(), `${as} ${path}`).not.toMatch(/monthlyFee|renewalDate|"fee"/);
    }
    expect((await request.put(`/api/app/clients/${id}`, { headers: h, data: { monthlyFee: "1" } })).status(), `${as} PUT fee`).toBe(403);
    expect((await request.post(`/api/app/clients/${id}/notes`, { headers: h, data: { body: "x" } })).status(), `${as} POST note`).toBe(403);
  }
});

test("a client's staff opening Clients get a plain 'not available' and no money", async ({ page }) => {
  await page.goto("/app?as=client#clients");
  await page.reload();
  await expect(page.getByText("Not available")).toBeVisible({ timeout: 120_000 });
  expect(await page.locator("main").innerText()).not.toMatch(/\$\d|renew|\bfees?\b/i);
});

test("an id that is not one of the caller's clients is not found, and the page never takes a client from the address", async ({ request }) => {
  const h = await headers(request);
  expect((await request.get("/api/app/clients?part=one&id=not-a-client-of-mine", { headers: h })).status()).toBe(404);
  expect((await request.get("/api/app/clients?part=one&id=..%2F..%2Fetc", { headers: h })).status()).toBe(404);
  expect((await request.get("/api/app/clients?part=bogus", { headers: h })).status()).toBe(400);
  expect((await request.put("/api/app/clients/not-a-client-of-mine", { headers: h, data: { monthlyFee: "5" } })).status()).toBe(404);
});

test("a client's trends sit behind one button and draw lines with axes", async ({ page }) => {
  await openBook(page);
  await page.getByTestId("open-client").first().click();
  await expect(page.getByTestId("client-name")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("client-trends-toggle").click();
  const trends = page.getByTestId("client-trends");
  await expect(trends).toBeVisible({ timeout: 120_000 });
  await expect(trends.getByTestId("line-chart")).toHaveCount(3);
});

test("the industry is chosen in the row from the picker and kept", async ({ page, request }) => {
  const rows = (await api(request, "get", "clients?part=list&size=50")).rows as Json[];
  const c = rows.find((r) => !r.industry) ?? rows[0];
  const old = c.industry as string | null;
  await openBook(page);
  await page.getByTestId("count-healthy").or(page.getByTestId("all-clients")).or(page.getByTestId("needs-all")).first().click();
  await page.getByTestId("chip-all").click();
  await page.getByTestId("book-search").fill(c.name);
  const row = page.getByTestId("book-list-rows").getByTestId("client-row").filter({ hasText: c.name }).first();
  try {
    await row.getByTestId("client-more").click();
    await page.getByTestId("menu-industry").click();
    await row.getByLabel(/kind of business/).selectOption("Real estate");
    await row.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => ((await api(request, "get", "clients?part=list&size=50")).rows as Json[]).find((r) => r.id === c.id)?.industry).toBe("Real estate");
  } finally {
    await api(request, "put", `clients/${c.id}`, { industry: old ?? "" });
  }
});
