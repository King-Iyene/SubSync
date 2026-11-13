// Takes one clean 1920x1080 still of the Today screen (it is the slowest screen, so the hook shot uses a still of it).
// Usage: node scripts/video/today-still.mjs <out.png>
import { launch, sleep, scanText, BASE } from "./lib.mjs";
const { browser, ctx } = await launch();
const page = await ctx.newPage();
await page.goto(`${BASE}/app?shots=1#today`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("main", { timeout: 120000 });
const t0 = Date.now();
let ok = false;
while (Date.now() - t0 < 240000) {
  await sleep(4000);
  const t = await page.locator("main").innerText();
  if (/money at risk/i.test(t) && !/taking longer|taking too long|still not loading|loading/i.test(t.slice(0, 6000))) { ok = true; break; }
  if (Date.now() - t0 > 35000 && Math.floor((Date.now() - t0) / 1000) % 40 < 4) { await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector("main", { timeout: 60000 }).catch(() => undefined); continue; }
  const again = page.getByRole("button", { name: /^try again$/i });
  if (await again.count() && Date.now() - t0 > 30000) await again.first().click().catch(() => undefined);
}
console.log("loaded:", ok, "after", Math.round((Date.now() - t0) / 1000), "s");
if (!ok) { await page.screenshot({ path: process.argv[2].replace(".png", "-fail.png") }); process.exit(1); }
await sleep(2500);
// Put the money tiles near the top of the content area.
const info = await page.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (/money at risk/i.test(n.textContent)) {
      const e = n.parentElement; const els = [document.querySelector("main"), document.scrollingElement].filter(Boolean);
      const sc = els.find((x) => x.scrollHeight > x.clientHeight + 4) || els[1];
      const r = e.getBoundingClientRect(); sc.scrollTop += r.top - 230;
      const r2 = e.getBoundingClientRect(); return { x: r2.left, y: r2.top, tag: e.tagName };
    }
  }
  return null;
});
await sleep(1200);
console.log("tile at", JSON.stringify(info), "banned:", await scanText(page));
await page.screenshot({ path: process.argv[2] });
(await import("node:fs")).writeFileSync(process.argv[2] + ".json", JSON.stringify(info));
await browser.close();
