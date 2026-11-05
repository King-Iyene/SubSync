import { expect, type APIRequestContext, type Page } from "@playwright/test";

// Shared by the Today browser specs (today.spec.ts, today3.spec.ts and the second-pass specs).
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function api(request: APIRequestContext, as?: "business" | "client") {
  const s = await request.post("/api/sso", { data: { demo: true, ...(as ? { as } : {}) } });
  const headers = { Authorization: `Bearer ${((await s.json()) as { session: string }).session}` };
  return {
    get: async (path: string): Promise<Json> => {
      const res = await request.get(`/api/app/${path}`, { headers });
      expect(res.ok(), `${path}: ${res.status()}`).toBeTruthy();
      return (await res.json()) as Json;
    },
    post: async (path: string, data: Json): Promise<{ status: number; body: Json }> => {
      const res = await request.post(`/api/app/${path}`, { headers, data });
      return { status: res.status(), body: (await res.json().catch(() => ({}))) as Json };
    },
    status: async (path: string): Promise<number> => (await request.get(`/api/app/${path}`, { headers })).status(),
  };
}

/** A stale deal the page leaves out by default: a test name, or no movement for more than 3 times the stale days. */
export const isJunk = (i: Json, now: number, staleDays: number) =>
  i.kind === "stale" && ((i.at !== null && now - i.at > staleDays * 3 * 86_400_000) || /(^|[^a-z0-9])(test|testing|demo|sample|sandbox|dummy)([^a-z0-9]|$)/i.test(i.name));

/** The items Today counts by default (test and very old deals left out, and anything set aside with Done or Snooze). */
export const counted = (t: Json): Json[] => (t.items as Json[]).filter((i) => !isJunk(i, t.now, t.staleDays) && !(t.holds as Json)[i.id]);

/** Opens "More detail" (closed until asked for) and, if given, one of its tabs. */
export async function openMore(page: Page, tab?: string) {
  const toggle = page.getByTestId("more-detail-toggle");
  await expect(toggle).toBeVisible({ timeout: 90_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  if (tab) await page.getByRole("tab", { name: tab }).click();
}

/** Presses one item of the header's More menu. */
export async function moreMenu(page: Page, key: "brief" | "print" | "share" | "sync" | "views" | "commands") {
  await page.getByTestId("today-more").click();
  await page.getByTestId(`menu-${key}`).click();
}

/** Waits until Today's headline is on screen. */
export async function todayReady(page: Page) {
  await expect(page.getByTestId("today-headline")).toBeVisible({ timeout: 45_000 });
}

/** Puts Today back on every client: opens the shared filter's account list, presses "All client accounts" and closes it. */
export async function clearAccounts(page: Page) {
  await page.getByTestId("account-button").click();
  await page.getByRole("button", { name: "All client accounts" }).click();
  await page.getByTestId("account-list").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("account-list")).toHaveCount(0);
}
