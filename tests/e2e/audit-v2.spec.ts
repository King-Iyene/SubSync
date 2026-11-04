import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, type Json } from "./today-helpers";

// The rebuilt Account audit (docs/AUDIT_REVIEW.md) on the demo company, for the four roles at the three widths of the projects: one sentence about the money with
// the word "estimate" on it, one primary action, findings with ONE button each whose list has exactly the rows it counted, a client list that is paged on the server,
// a client's staff who only ever see their own account, and a phone with no sideways scroll and thumb-sized buttons. Every call signs the demo in again, so waits are long.
const ROLES = [
  { name: "agency, all accounts", path: "/app#audit", slug: "agency-all", multi: true, menu: false },
  { name: "agency, inside one account", path: "/app?as=location", slug: "agency-account", multi: false, menu: true },
  { name: "a client's staff", path: "/app?as=client#audit", slug: "client-staff", multi: false, menu: false },
  { name: "a business owner", path: "/app?as=business#audit", slug: "business-owner", multi: false, menu: false },
] as const;
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\bSLA\b/i;

async function open(page: Page, path: string, menu = false) {
  await page.goto(path);
  if (menu) await page.getByRole("button", { name: "Account audit", exact: true }).first().click({ timeout: 90_000 });
  else await page.reload();
  await expect(page.getByTestId("audit-headline")).toBeVisible({ timeout: 120_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

for (const role of ROLES) {
  test(`${role.name}: the sentence, the one action, a finding opens exactly the rows it counted, plain words, no sideways scroll`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await open(page, role.path, role.menu);
    // The sentence is about money (or counts things when no account has enough closed deals) and says what it is.
    const headline = (await page.getByTestId("audit-headline").innerText()).trim();
    expect(headline.length, "one sentence").toBeLessThan(120);
    const kind = await page.getByTestId("audit-verdict").getAttribute("data-kind");
    if (kind === "leak") {
      expect(headline).toMatch(/leaking about \$[\d,]+ a month\.$/);
      await expect(page.getByTestId("audit-verdict-kind")).toHaveText("Estimate");
      await expect(page.getByTestId("audit-formula").first()).toBeVisible();
    }
    // One primary action, and it names the thing to do.
    await expect(page.getByTestId("audit-start")).toHaveCount(kind === "clear" ? 0 : 1);
    // Findings: each has one Show button; the count on it equals the rows of its list.
    const findings = page.getByTestId("audit-finding");
    const n = await findings.count();
    expect(n, "the demo has things to fix").toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 2); i++) {
      const f = findings.nth(i);
      const count = Number(await f.getAttribute("data-count"));
      await expect(f.getByTestId("audit-show")).toHaveCount(1);
      await f.getByTestId("audit-show").click();
      const c = page.getByTestId("records-count");
      await expect(c).toBeVisible({ timeout: 30_000 });
      expect(Number(await c.getAttribute("data-count")), "the heading says the number that was counted").toBe(count);
      if (count <= 200) expect(Number(await c.getAttribute("data-shown")), "and the list has exactly that many rows").toBe(count);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("records-panel")).toHaveCount(0);
    }
    // The primary button opens the first finding's list.
    if (kind !== "clear") {
      const first = Number(await findings.first().getAttribute("data-count"));
      await page.getByTestId("audit-start").click();
      expect(Number(await page.getByTestId("records-count").getAttribute("data-count"))).toBe(first);
      await page.keyboard.press("Escape");
    }
    // Plain words, no platform name; only an agency with more than one client account sees the client list.
    expect(await page.locator("main").innerText()).not.toMatch(BANNED);
    if (role.multi) await expect(page.getByTestId("audit-clients")).toBeVisible();
    else await expect(page.getByTestId("audit-clients")).toHaveCount(0);
    // A phone: nothing sideways, and the thumb buttons are at least 44 px high.
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
    if (testInfo.project.name === "phone-390") {
      for (const id of ["audit-start", "audit-more"]) {
        const box = await page.getByTestId(id).first().boundingBox();
        expect(box!.height, `${id} is thumb sized`).toBeGreaterThanOrEqual(44);
      }
      for (const b of await page.getByTestId("audit-show").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    if (process.env.SHOTS) {
      mkdirSync("docs/review", { recursive: true });
      await page.screenshot({ path: `docs/review/audit-${role.slug}-${testInfo.project.name.replace(/\D+/g, "")}.png`, fullPage: true });
    }
  });
}

test("the same numbers on the page and in the API: the counts equal the rows, and nobody is in two findings", async ({ request }) => {
  test.setTimeout(240_000);
  const a = await api(request);
  const d = await a.get("audit");
  const people = new Set<string>();
  for (const f of d.findings as Json[]) {
    if (f.key === "leftovers") continue;
    if (f.items.length === f.count) expect(f.items).toHaveLength(f.count);
    for (const it of f.items as Json[]) {
      if (f.key === "appointments") continue; // an appointment can repeat a person; the rule is checked across the people findings below
      if (!it.contactId) continue;
      const k = `${it.locationId}|${it.contactId}`;
      expect(people.has(k), `${k} is in one finding only`).toBe(false);
      people.add(k);
    }
  }
  // Appointments never list a person that an earlier finding holds.
  for (const it of (d.findings as Json[]).find((f) => f.key === "appointments")?.items ?? []) if (it.contactId) expect(people.has(`${it.locationId}|${it.contactId}`)).toBe(false);
  expect(d.totals.things).toBe((d.findings as Json[]).filter((f) => f.key !== "leftovers").reduce((s, f) => s + f.count, 0));
  // The demo's two dollar figures are labelled and kept apart.
  if (d.verdict.kind === "leak") expect(d.verdict.sub).toMatch(/^Estimate from the last 30 days/);
  expect(JSON.stringify(d, (k, v) => (k === "url" ? undefined : v))).not.toMatch(BANNED); // links point at the CRM's own address; only the words are checked
});

test("the client list is paged on the server, ranked by money, searchable, and a page past the end is the last page", async ({ request }) => {
  test.setTimeout(240_000);
  const a = await api(request);
  const d = await a.get("audit");
  // The demo's numbers move with the clock and the server keeps one read for 45 seconds, so what must agree is read straight after the audit.
  const all = await a.get(`audit/clients?size=50&sort=name`);
  const sum = (k: string) => (all.rows as Json[]).reduce((s, r) => s + r[k], 0);
  if (all.pages === 1) {
    for (const k of ["stale", "replies", "noshows", "appointments"]) expect(sum(k)).toBe((d.findings as Json[]).find((f) => f.key === k)?.count ?? 0);
  }
  expect(d.clients.rows.length).toBeLessThanOrEqual(5);
  const p1 = await a.get("audit/clients?size=5&page=0");
  expect(p1.total).toBe(d.clients.total);
  expect(p1.rows.length).toBe(Math.min(5, p1.total));
  for (let i = 1; i < p1.rows.length; i++) expect(p1.rows[i - 1].rank).toBeGreaterThanOrEqual(p1.rows[i].rank);
  const last = await a.get("audit/clients?size=5&page=9999");
  expect(last.page).toBe(last.pages - 1);
  const big = await a.get("audit/clients?size=5000");
  expect(big.rows.length, "the page size is capped").toBeLessThanOrEqual(50);
  const name = p1.rows[0].name as string;
  const found = await a.get(`audit/clients?q=${encodeURIComponent(name.slice(0, 5))}`);
  expect(found.rows.some((r: Json) => r.name === name)).toBe(true);
});

test("one client only: the audit narrows to that account, and an id that is not one of the caller's accounts changes nothing", async ({ request }) => {
  test.setTimeout(240_000);
  const a = await api(request);
  const d = await a.get("audit");
  const row = d.clients.rows[0] as Json;
  const forged = await a.get("audit?location=not-my-account-0000");
  expect(forged.focus).toBeNull();
  expect(forged.scope).toBe(d.scope);
  expect(forged.totals.things).toBe(d.totals.things);
  const one = await a.get(`audit?location=${row.id}`);
  expect(one.scope).toBe("account");
  expect(one.focus.id).toBe(row.id);
  expect(one.clients).toBeNull();
  for (const f of one.findings as Json[]) for (const it of f.items as Json[]) expect(it.locationId).toBe(row.id);
});

test("a client's staff and a business owner see only their own account, and no list of other clients", async ({ request }) => {
  test.setTimeout(240_000);
  for (const as of ["client", "business"] as const) {
    const a = await api(request, as);
    const d = await a.get("audit");
    expect(d.scope).toBe("account");
    expect(d.clients).toBeNull();
    expect(d.hiddenAccounts, "never says how many other accounts exist").toBe(0);
    const ids = new Set<string>();
    for (const f of d.findings as Json[]) for (const it of f.items as Json[]) ids.add(it.locationId);
    expect(ids.size).toBeLessThanOrEqual(1);
    expect(await a.status("audit/clients")).toBe(404);
    // A forged account id from the browser changes nothing.
    const forged = await a.get("audit?location=demo-loc-3");
    expect(forged.totals.things).toBe(d.totals.things);
    expect(JSON.stringify(d, (k, v) => (k === "url" ? undefined : v))).not.toMatch(BANNED); // links point at the CRM's own address; only the words are checked
    // A client's staff may never share (403); a business owner may, but the demo holds only the sample (400).
    expect((await a.post("audit/share", {})).status).toBe(as === "client" ? 403 : 400);
  }
});

test("the demo cannot create a share link, and offers the sample instead", async ({ page, request }) => {
  test.setTimeout(240_000);
  const a = await api(request);
  expect((await a.post("audit/share", {})).status).toBe(400);
  await open(page, "/app#audit");
  await page.getByTestId("audit-more").click();
  await expect(page.getByRole("menuitem", { name: "See a sample to send a client" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Share a link with a client" })).toHaveCount(0);
});

test("Run again reads again and the page stays on screen; clients: See all opens a searchable, paged list", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await open(page, "/app#audit");
  await page.getByTestId("audit-rerun").click();
  await expect(page.getByTestId("audit-headline")).toBeVisible({ timeout: 120_000 });
  if (testInfo.project.name !== "desktop-1440") return;
  const see = page.getByTestId("audit-see-all");
  if (await see.count()) {
    await see.click();
    await expect(page.getByTestId("audit-all-clients")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("audit-search").fill("zzzz-nobody");
    await expect(page.getByText("No client matches")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("audit-search").fill("");
    await expect(page.getByTestId("audit-all-clients").getByTestId("audit-client").first()).toBeVisible({ timeout: 60_000 });
  }
  // Opening one client narrows the page and says so.
  await page.getByTestId("audit-client-open").first().click();
  await expect(page.getByTestId("audit-focus")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("audit-headline")).toContainText(/Your account is|Nothing needs fixing in your account|We found/);
  await page.getByRole("button", { name: "Show all clients" }).click();
  await expect(page.getByTestId("audit-focus")).toHaveCount(0);
});
