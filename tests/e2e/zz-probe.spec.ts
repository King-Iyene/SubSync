import { test } from "@playwright/test";
import { api, openMore } from "./today-helpers";
const OUT = "/tmp/claude-0/-home-user-SubSync/c8eab323-3216-5ad8-8bf4-c3219503215b/scratchpad/";
test("probe", async ({ page, request }, ti) => {
  test.skip(ti.project.name !== "desktop-1440");
  const a = await api(request);
  const g = await a.get("today/growth");
  console.log(JSON.stringify({ changes: g.changes, gross: g.gross, badge: g.badge, goal: g.goal, mix: g.mix.line, signals: g.signals, league: g.league.slice(0, 3).map((l: any) => [l.name, l.week.count, l.week.pct, l.month]), recs: g.records.length }));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/app");
    await page.getByTestId("today-headline").waitFor({ timeout: 90000 });
    await openMore(page, "Growth");
    await page.waitForTimeout(1200);
    await page.getByTestId("growth-tab").screenshot({ path: OUT + `growth-${scheme}.png` });
    await page.screenshot({ path: OUT + `page-${scheme}.png` });
  }
});
