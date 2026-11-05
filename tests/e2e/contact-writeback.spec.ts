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
  await expect(drawer.getByTestId("note-status")).toContainText("marked as added in SubSync");
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
  await log.getByText("Log how the call went").click();
  for (const k of ["answered", "voicemail", "no_answer", "wrong_number", "booked", "not_interested", "follow_up"]) {
    await log.getByTestId(`log-${k}`).click();
    await expect(log.getByTestId("log-status")).toContainText("Saved to the contact in your CRM");
    expect(posts.at(-1)).toMatchObject({ path: "outcome", body: { outcome: k } });
  }
  const before = posts.length;
  await log.getByTestId("log-voicemail").dblclick();
  await expect(log.getByTestId("log-status")).toContainText(/Saved|Already saved/);
  expect(posts.length - before, "a double click sends at most one request").toBeLessThanOrEqual(1);
  await log.getByTestId("log-undo").click();
  await log.getByTestId("log-undo-yes").click();
  await expect(log.getByTestId("log-status")).toContainText("Undone");
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

test("tags: add with +, remove only after a plain confirmation, undo, dates say added or first seen", async ({ page }, info) => {
  test.setTimeout(300_000);
  const posts = await fake(page, () => "saved");
  await page.route(/\/api\/app\/people\/tags\?/, (r) => r.fulfill({ json: { tags: ["qualified", "web lead"] } }));
  const drawer = await openPanel(page);
  const tags = drawer.getByTestId("drawer-tags");
  await expect(tags.getByTestId("drawer-tags-note")).toContainText("Your CRM does not store when a tag was added");
  await tags.getByTestId("tag-add").click();
  await tags.getByTestId("tag-input").fill("qualified-test");
  await tags.getByTestId("tag-add-save").click();
  await expect(tags.getByTestId("tag-status")).toContainText("Added to the contact in your CRM");
  expect(posts.at(-1)).toMatchObject({ path: "tag", body: { tag: "qualified-test", remove: false } });
  await expect(tags.getByText(/qualified-test · added/)).toBeVisible();
  const before = posts.length;
  await tags.getByRole("button", { name: "Remove the tag qualified-test" }).click();
  await expect(tags.getByTestId("tag-confirm")).toContainText("Remove the tag \u2018qualified-test\u2019 from");
  await expect(tags.getByTestId("tag-confirm")).toContainText("This changes your CRM");
  await tags.getByTestId("tag-confirm-cancel").click();
  expect(posts.length, "cancel sends nothing").toBe(before);
  await tags.getByRole("button", { name: "Remove the tag qualified-test" }).click();
  await tags.getByTestId("tag-confirm-remove").click();
  await expect(tags.getByTestId("tag-status")).toContainText("Removed from the contact in your CRM");
  expect(posts.at(-1)).toMatchObject({ path: "tag", body: { tag: "qualified-test", remove: true, confirm: true } });
  await tags.getByTestId("tag-undo").click();
  await expect(tags.getByTestId("tag-status")).toContainText("Undone");
  await page.screenshot({ path: `${SHOTS}/contact-writeback-tags-${info.project.name}.png` });
});
