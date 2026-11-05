import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The contact panel writes to the lead in the CRM (docs/features/CONTACT_WRITEBACK.md). The browser talks to SubSync's own API, so the answers of that API are
// mocked here with a small fake that behaves like the real one (idempotent per contact + outcome + minute, a cap, the states of the switch and the permission):
// this checks every button, state and sentence on screen. The real write path (stubbed CRM, idempotency in the database, cross-tenant) is in the unit and database tests.
// The Email button: with an address it opens the contact in the CRM; with none it is disabled and says why.
test.describe.configure({ mode: "serial" });
const SHOTS = "docs/review";

type Mode = "saved" | "off" | "permission" | "failed";
async function fake(page: Page, mode: () => Mode) {
  const seen = new Set<string>();
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route(/\/api\/app\/people\/(note|outcome|write-undo|tag)$/, async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    posts.push({ path, body });
    const key = `${path}:${body.contactId}:${body.outcome ?? body.text}`;
    const m = mode();
    if (path === "tag") return route.fulfill({ json: { ok: true, status: "saved", message: body.remove ? "Removed from the contact in your CRM" : "Added to the contact in your CRM", id: "t1", canUndo: true } });
    if (path === "write-undo") return route.fulfill({ json: { ok: true, status: "saved", message: "Undone. The note, task and tag SubSync added were removed from your CRM." } });
    if (seen.has(key)) return route.fulfill({ json: { ok: true, status: "saved", message: "Already saved a moment ago. Nothing was added twice.", id: "w1", canUndo: true, duplicate: true } });
    seen.add(key);
    const msg = { saved: "Saved to the contact in your CRM", off: "Writing to your CRM is switched off for now. Nothing was sent to your CRM", permission: "Needs permission: reconnect. SubSync is not allowed to change contacts in your CRM yet.", failed: "Your CRM did not accept it (error 422). Nothing was saved there. Try again." }[m];
    return route.fulfill({ json: { ok: m === "saved" || m === "off", status: m === "saved" ? "saved" : m === "off" ? "dry_run" : m === "permission" ? "needs_permission" : "failed", message: msg, id: "w1", canUndo: m === "saved" } });
  });
  return posts;
}

async function openPanel(page: Page) {
  await page.goto("/app#people");
  await expect(page.getByTestId("people-say")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("people-start").click();
  const drawer = page.getByTestId("lead-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drawer-headline")).toHaveText(/\S/, { timeout: 90_000 });
  return drawer;
}

test("a note is saved to the contact, shows each state, can be undone, and Copy note stays", async ({ page }, info) => {
  test.setTimeout(300_000);
  let mode: Mode = "saved";
  const posts = await fake(page, () => mode);
  const drawer = await openPanel(page);
  await drawer.getByText("Add a note to this contact").click();
  await expect(drawer.getByTestId("note-to-self").getByRole("tooltip")).toContainText("marked as added in SubSync");
  await expect(drawer.getByTestId("note-save")).toBeDisabled();
  await drawer.getByTestId("note-text").fill("Wants a quote by Friday");
  await drawer.getByTestId("note-save").click();
  await expect(drawer.getByTestId("note-status")).toContainText("Saved to the contact in your CRM");
  expect(posts.filter((p) => p.path === "note")).toHaveLength(1);
  await expect(drawer.getByTestId("note-text")).toHaveValue("");
  await drawer.getByTestId("note-undo").click();
  await expect(drawer.getByTestId("note-undo-confirm")).toContainText("This changes your CRM");
  await drawer.getByTestId("note-undo-yes").click();
  await expect(drawer.getByTestId("note-status")).toContainText("Undone");
  for (const [m, text] of [["off", "switched off for now"], ["permission", "Needs permission: reconnect"], ["failed", "error 422"]] as const) {
    mode = m;
    await drawer.getByTestId("note-text").fill(`note ${m}`);
    await drawer.getByTestId("note-save").click();
    await expect(drawer.getByTestId("note-status")).toContainText(text);
    await expect(drawer.getByTestId("note-text"), "the typed words are never lost").toHaveValue(`note ${m}`);
  }
  await expect(drawer.getByTestId("note-copy")).toBeEnabled();
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/contact-writeback-note-${info.project.name}.png` });
});

test("each call outcome button writes once, double clicks are one save, Undo works, no CRM brand words", async ({ page }, info) => {
  test.setTimeout(300_000);
  const posts = await fake(page, () => "saved");
  const drawer = await openPanel(page);
  const log = drawer.getByTestId("log-call");
  if (!(await log.count())) test.skip(true, "this contact has no phone number, so the call log is not offered");
  // The panel moves to the next person after each logged call, so what was written stays in the panel's footer (with Undo).
  const open = async () => { for (let i = 0; i < 8 && !(await drawer.getByTestId("log-call").count()); i++) { await drawer.getByRole("button", { name: "Next lead" }).click(); await page.waitForTimeout(400); }
    const l = drawer.getByTestId("log-call"); await l.waitFor({ timeout: 20_000 }); if (!(await l.evaluate((el) => (el as HTMLDetailsElement).open))) await l.getByText("Log how the call went").click(); return l; };
  for (const k of ["answered", "voicemail", "no_answer", "wrong_number", "booked", "not_interested", "follow_up"]) {
    const l = await open();
    await l.getByTestId(`log-${k}`).click();
    await expect(drawer.getByTestId("drawer-saved")).toContainText("Saved to the contact in your CRM");
    expect(posts.at(-1)).toMatchObject({ path: "outcome", body: { outcome: k } });
  }
  const before = posts.length;
  await (await open()).getByTestId("log-voicemail").dblclick();
  await expect(drawer.getByTestId("drawer-saved")).toContainText(/Saved|Already saved/);
  expect(posts.length - before, "a double click sends at most one request").toBeLessThanOrEqual(1);
  await drawer.getByTestId("drawer-saved-undo").click();
  await drawer.getByTestId("drawer-saved-undo-yes").click();
  await expect(drawer.getByTestId("drawer-saved")).toContainText("Undone");
  expect(await drawer.innerText()).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b|does not save|Nothing is sent to your CRM/i);
  await page.screenshot({ path: `${SHOTS}/contact-writeback-call-${info.project.name}.png` });
});

test("Email opens the contact in the CRM; a contact with no address has it disabled with the reason", async ({ page, context }) => {
  test.setTimeout(300_000);
  const drawer = await openPanel(page);
  const email = drawer.getByTestId("drawer-email");
  if (await email.isDisabled()) {
    await expect(drawer.getByTestId("drawer-no-contact-way")).toContainText(/no email address/i);
    return;
  }
  const popup = context.waitForEvent("page", { timeout: 15_000 });
  await email.click();
  const strip = page.getByTestId("dial-warning");
  if (await strip.count()) await page.getByTestId("dial-anyway").click();
  expect((await popup).url(), "a new tab opened").toBeTruthy();
});

test("tags: a clear section under the actions, searchable picker with create, colour chips, date only, confirmed removal, undo, tooltips instead of sentences", async ({ page }, info) => {
  test.setTimeout(300_000);
  const posts = await fake(page, () => "saved");
  const pool = Array.from({ length: 120 }, (_, i) => ({ name: i === 0 ? "qualified" : `tag ${i}`, count: 120 - i }));
  await page.route(/\/api\/app\/people\/tags\?/, (r) => r.fulfill({ json: { tags: pool, source: "crm", needsPermission: false } }));
  const drawer = await openPanel(page);
  const tags = drawer.getByTestId("drawer-tags");
  await expect(tags).toBeVisible();
  await expect(tags.getByTestId("tags-count")).toHaveText(/^\d+$/);
  // Prominence: the section sits above the contact details rows, right under the actions.
  const [ty, dy] = [await tags.boundingBox(), await drawer.locator("dl").first().boundingBox()];
  expect(ty!.y, "Tags are above the details").toBeLessThan(dy!.y);
  // The explanation lives in a tooltip, not in a sentence.
  await expect(tags.getByText("Your CRM does not keep the date a tag was added")).toBeHidden();
  await tags.getByTestId("tags-info").focus();
  await expect(tags.getByRole("tooltip")).toContainText("Your CRM does not keep the date a tag was added");
  await tags.getByTestId("tag-add").click();
  await expect(tags.getByTestId("tag-input")).toBeFocused();
  expect(await tags.getByTestId("tag-option").count(), "long lists are windowed, not all rendered").toBeLessThan(30);
  await tags.getByTestId("tag-input").fill("brand new tag");
  await expect(tags.getByTestId("tag-create")).toContainText("Create tag");
  await tags.getByTestId("tag-input").press("Enter");
  await expect(tags.getByTestId("tag-status")).toContainText(/Tag .brand new tag. added to .+ in your CRM/);
  expect(posts.at(-1)).toMatchObject({ path: "tag", body: { tag: "brand new tag", remove: false } });
  const chip = tags.getByTestId("drawer-tag").filter({ hasText: "brand new tag" });
  await expect(chip.getByTestId("tag-date")).toHaveText(/^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/);
  await expect(chip).not.toContainText(/added|first seen/i);
  const before = posts.length;
  await tags.getByRole("button", { name: "Remove the tag brand new tag" }).click();
  await expect(tags.getByTestId("tag-confirm")).toContainText("This changes your CRM");
  await tags.getByTestId("tag-confirm-cancel").click();
  expect(posts.length, "cancel sends nothing").toBe(before);
  await tags.getByRole("button", { name: "Remove the tag brand new tag" }).click();
  await tags.getByTestId("tag-confirm-remove").click();
  await expect(tags.getByTestId("tag-status")).toContainText("removed from");
  expect(posts.at(-1)).toMatchObject({ path: "tag", body: { tag: "brand new tag", remove: true, confirm: true } });
  await tags.getByTestId("tag-undo").click();
  await expect(tags.getByTestId("tag-status")).toContainText("is back on");
  await tags.getByTestId("tag-add").click();
  await tags.getByTestId("tag-input").fill("qual");
  await expect(tags.getByTestId("tag-option").first()).toContainText("qualified");
  await page.screenshot({ path: `${SHOTS}/contact-writeback-tags-${info.project.name}.png` });
});

test("tags: without the optional permission the picker says so", async ({ page }) => {
  test.setTimeout(300_000);
  await fake(page, () => "saved");
  await page.route(/\/api\/app\/people\/tags\?/, (r) => r.fulfill({ json: { tags: [{ name: "from contacts", count: 2 }], source: "contacts", needsPermission: true } }));
  const drawer = await openPanel(page);
  await drawer.getByTestId("tag-add").click();
  await expect(drawer.getByTestId("tags-needs-permission")).toContainText("Needs permission: reconnect");
});

test("Call with: a connected dialer needs a valid https link and saves only the choice and the link", async ({ page }) => {
  test.setTimeout(300_000);
  let saved: Record<string, unknown> | null = null;
  await page.route(/\/api\/app\/people\/dialer$/, (r) => {
    if (r.request().method() === "PUT") { saved = r.request().postDataJSON(); return r.fulfill({ json: { ok: true, ...saved } }); }
    return r.fulfill({ json: { provider: "phone" } });
  });
  await fake(page, () => "saved");
  await openPanel(page);
  const setting = page.getByTestId("dialer-setting").first();
  if (await setting.count()) {
    await setting.getByTestId("dialer-select").selectOption("connected");
    await setting.getByTestId("dialer-template").fill("http://bad.example.com/{phone}");
    await expect(setting.getByTestId("dialer-template-error")).toContainText("https://");
    await expect(setting.getByTestId("dialer-save")).toBeDisabled();
    await setting.getByTestId("dialer-template").fill("https://dialer.example.com/call?to={phone}");
    await setting.getByTestId("dialer-save").click();
    expect(saved).toMatchObject({ provider: "connected", template: "https://dialer.example.com/call?to={phone}" });
  }
});
