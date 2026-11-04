import { expect, test, type APIRequestContext } from "@playwright/test";

// F4: unanswered conversations are correct and labelled. The demo tenant carries messy cases on purpose (see ensureInboxDemo).
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(request: APIRequestContext, path: string): Promise<Json> {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const res = await request.get(`/api/app/${path}`, { headers });
  expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Json;
}

test("one window everywhere: the Inbox total equals the number Today and Overview show", async ({ request }) => {
  const [overview, inbox] = await Promise.all([get(request, "overview"), get(request, "inbox")]);
  expect(inbox.windowDays).toBe(30);
  expect(inbox.truncated).toBe(false);
  expect(inbox.waitingTotal).toBe(overview.kpis.unanswered);
  expect(inbox.overSla).toBe(inbox.waitingTotal);
  expect(inbox.items.filter((i: Json) => i.overSla).length).toBe(inbox.waitingTotal);
});

test("nothing waiting is older than the window, and the channel counts add up to the total", async ({ request }) => {
  const inbox = await get(request, "inbox");
  for (const i of inbox.items.filter((x: Json) => x.overSla)) expect(i.waitingHours, "a waiting conversation is inside the 30 day window").toBeLessThanOrEqual(30 * 24);
  const channels = inbox.channels as Array<{ channel: string; count: number }>;
  expect(channels.reduce((s, c) => s + c.count, 0)).toBe(inbox.waitingTotal);
  const names = channels.map((c) => c.channel);
  for (const c of ["Text message", "Email", "Facebook", "Instagram"]) expect(names, `${c} is a channel with a waiting conversation`).toContain(c);
});

test("the messy cases: a dead thread, an automatic reply, an internal note and a conversation inside the target are not waiting", async ({ request }) => {
  const inbox = await get(request, "inbox");
  const sample = (n: number) => inbox.items.find((i: Json) => i.contactName?.startsWith(`Inbox sample: `) && i.contactName.includes(["text, 30 hours", "email, 6 hours", "WhatsApp", "Facebook", "Instagram", "40 days", "automatic reply", "internal note"][n - 1]));
  for (const n of [1, 2, 4, 5]) expect(sample(n)?.overSla, `sample ${n} is waiting`).toBe(true);
  expect(sample(3)?.overSla, "inside the target").toBe(false);
  expect(sample(6), "a 40 day thread is not in the list at all").toBeUndefined();
  expect(sample(7), "an automatic reply is answered").toBeUndefined();
  expect(sample(8), "an internal note is not the customer waiting").toBeUndefined();
});

test("the Inbox screen leads with the number of people waiting in plain words, names the target and the window, and has a channel choice in its list", async ({ page }, testInfo) => {
  await page.goto("/app#inbox");
  await page.reload();
  await expect(page.getByText("Demo mode", { exact: false }).first()).toBeVisible();
  const headline = page.getByTestId("today-headline");
  await expect(headline).toBeVisible({ timeout: 90_000 });
  await expect(headline).toContainText(/(person is|people are) waiting for a reply/);
  await expect(page.getByTestId("wait-proof")).toContainText("in the last 30 days");
  await page.getByTestId("wait-all").click();
  await expect(page.getByLabel("Channel", { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `docs/review/f4-inbox-${testInfo.project.name}.png`, fullPage: true });
});

test("the CSV export carries the channel and matches the waiting total", async ({ request }) => {
  const s = await request.post("/api/sso", { data: { demo: true } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  const res = await request.get("/api/app/export/inbox", { headers });
  expect(res.ok()).toBeTruthy();
  const csv = await res.text();
  expect(csv.split("\n")[0]).toContain("Channel");
  const inbox = await get(request, "inbox");
  const waitingRows = csv.split("\n").slice(1).filter((l) => /,yes,/.test(l)).length;
  expect(waitingRows).toBe(inbox.waitingTotal);
});
