import { expect, test, type Page } from "@playwright/test";

// CRM call queue (stage DIALQ) at desktop-1440, with every server answer mocked (nothing is ever written): the card, the preview ("Would add 2 leads"), the confirm, the honest wording, and the
// richer "Ready to call" popup (phone on the row, a Call button, a tick box and "Send selected to CRM call queue"). The rules (guards, caps, 24-hour memory) are unit tested.
const item = (o: Record<string, unknown>) => ({ locationId: "L1", locationName: "Acme Roofing", timeZone: null, openValue: 0, ageHours: 2, priority: 50, reasons: ["Missed call, no callback yet"], url: "https://example.test/contact", dnd: false, phone: "+15550001111", ...o });
const ITEMS = [item({ contactId: "c-ana", name: "Ana Reyes", openValue: 5000 }), item({ contactId: "c-cy", name: "Cy Park", phone: "+15550002222" })];

async function mock(page: Page, sends: Array<Record<string, unknown>>) {
  await page.addInitScript(() => { try { localStorage.setItem("subsync.dial.auto", "false"); localStorage.setItem("subsync.speed.tour6", "1"); } catch { /* none */ } });
  await page.route(/\/api\/app\/dial\/queue\?/, (r) => r.fulfill({ json: { list: "missed", lists: [{ id: "missed", label: "Missed calls, no callback", help: "" }], total: 2, ownOnly: false, me: "Test Agent", items: ITEMS } }));
  await page.route(/\/api\/app\/dial\/stats/, (r) => r.fulfill({ json: { people: [], own: false } }));
  await page.route(/\/api\/app\/dial\/cq-status/, (r) => r.fulfill({ json: { ready: true, accounts: [{ id: "L1", name: "Acme Roofing" }], canEdit: true, queueLinks: { L1: "https://crm.example.test/v2/location/L1/conversations/manual_actions" }, status: [{ locationId: "L1", line: "Auto call queue: ON, 38 leads in queue, last filled 2 min ago", inQueue: 38, autoOn: true, paused: false }] } }));
  await page.route(/\/api\/app\/dial\/cq-preview/, (r) => r.fulfill({ json: { ok: true, ready: true, live: false, route: "tag", message: "Would add 2 leads to your call queue.", inQueue: 0, names: [{ key: "L1:c-ana", name: "Ana Reyes", phone: "+15550001111", list: "missed" }, { key: "L1:c-cy", name: "Cy Park", phone: "+15550002222", list: "missed" }], plan: { skipped: { dnd: 0, noPhone: 0, outsideHours: 0, recent: 0, cap: 0 } } } }));
  await page.route(/\/api\/app\/dial\/cq-send/, (r) => { sends.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true, live: false, message: "Would add 2 leads to your call queue. Nothing was sent: writing to your CRM is switched off here." } }); });
}

test("call queue: honest wording, preview, confirm, status line, and the richer Ready to call popup", async ({ page }) => {
  test.setTimeout(300_000);
  const sends: Array<Record<string, unknown>> = [];
  await mock(page, sends);
  await page.goto("/app#speed");
  await page.reload();
  await expect(page.getByTestId("race-tab")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("tab", { name: /^Call mode/ }).click();
  await expect(page.getByTestId("cq-card")).toContainText("SubSync cannot start a call itself");
  await expect(page.getByTestId("cq-status")).toContainText("38 leads in queue, last filled 2 min ago");
  await expect(page.getByTestId("cq-open")).toHaveAttribute("href", /conversations\/manual_actions$/);
  await page.getByTestId("cq-send").click();
  await expect(page.getByTestId("cq-would")).toContainText("Would add 2 leads to your call queue");
  await expect(page.getByTestId("cq-preview")).toContainText("cannot be undone");
  await page.getByTestId("cq-confirm").click();
  await expect(page.getByTestId("cq-msg")).toContainText("Nothing was sent");
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ locationId: "L1", list: "missed", confirm: true });

  await page.getByTestId("dial-count-open").click();
  await expect(page.getByTestId("people-row")).toHaveCount(2);
  await expect(page.getByTestId("people-phone").first()).toContainText("555");
  await expect(page.getByTestId("dial-button").first()).toContainText(/call/i);
  await expect(page.getByTestId("people-open").first()).toBeVisible();
  await page.getByTestId("people-pick").first().check();
  await page.getByTestId("people-send").click();
  await expect(page.getByTestId("cq-send")).toContainText("Send selected to CRM call queue");
});
