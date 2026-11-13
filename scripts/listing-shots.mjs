// Regenerates the marketplace listing images from the demo company (npm run shots). See assets/listing/v2/README.md.
// Needs the demo server running (npm run demo:server, after npm run build and npm run demo:fill). Screenshot mode (?shots=1) hides every demo/sample label.
// Usage: BASE=http://localhost:3210 node scripts/listing-shots.mjs [only-file-prefix,...]
import { chromium } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3210";
const OUT = process.env.SHOTS_OUT || "assets/listing/v2";
const MAX = 500 * 1024;
const only = process.argv[2] ? process.argv[2].split(",") : null;

// Ranked by strength: 01 is the hero. `click` runs in order (tab or page-chip names); `scroll` moves the page down by that many pixels; `wait` is extra ms.
const SHOTS = JSON.parse(fs.readFileSync(new URL("./listing-shots.json", import.meta.url), "utf8"));

const VENDOR = /gohighlevel|high\s?level|\bghl\b|leadconnector/i;
const LABELS = /demo mode|sample data|\(sample\)|demo company|fictional company/i;

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
await ctx.addInitScript(() => {
  try { localStorage.setItem("subsync-theme", "dark"); localStorage.setItem("subsync.speed.tour6", "1"); sessionStorage.setItem("subsync-shots", "1"); } catch { /* ignore */ }
});
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "extra"), { recursive: true });
const report = [];
let failed = 0;

for (const s of SHOTS) {
  if (only && !only.some((p) => s.file.startsWith(p))) continue;
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/app?shots=1#${s.hash}`, { waitUntil: "domcontentloaded" });
    const settle = async (ms = 1800) => {
      await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
      await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 500 }).catch(() => undefined);
      await page.waitForTimeout(ms);
    };
    await page.waitForSelector("main", { timeout: 90000 });
    await settle(2500);
    for (const c of s.click || []) {
      const loc = page.getByRole("tab", { name: new RegExp(c, "i") }).or(page.getByRole("button", { name: new RegExp(c, "i") })).or(page.getByRole("link", { name: new RegExp(c, "i") })).first();
      // A tab that is not there is reported, not fatal: the screen is still photographed, and the warning says to fix the name in listing-shots.json.
      const clicked = await loc.click({ timeout: 8000 }).then(() => true, () => false);
      if (!clicked) console.log(`  ${s.file}: no tab or button called "${c}" (check scripts/listing-shots.json)`);
      await settle();
    }
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.scroll) { await page.evaluate((y) => { const m = document.querySelector("main"); const sc = [m, document.scrollingElement].filter(Boolean); for (const e of sc) e.scrollTop = y; window.scrollTo(0, y); }, s.scroll); await page.waitForTimeout(800); }
    const text = await page.locator("body").innerText();
    const bad = [VENDOR.test(text) && "vendor word", LABELS.test(text) && "demo/sample label", /loading|spinner/i.test(text.slice(0, 400)) && "loading?"].filter(Boolean);
    let buf = await page.screenshot({ type: "png" });
    if (buf.length > MAX) buf = await sharp(buf).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
    const dest = path.join(OUT, s.extra ? "extra" : "", s.file);
    fs.writeFileSync(dest, buf);
    const meta = await sharp(buf).metadata();
    report.push({ file: s.file, extra: !!s.extra, size: `${meta.width}x${meta.height}`, kB: Math.round(buf.length / 1024), purpose: s.purpose, warn: bad.join(", ") });
    console.log(`${s.file}  ${meta.width}x${meta.height}  ${Math.round(buf.length / 1024)} kB${bad.length ? "  WARN: " + bad.join(", ") : ""}`);
  } catch (e) {
    failed++;
    console.log(`${s.file}  FAILED ${String(e).slice(0, 140)}`);
  }
  await page.close();
}
fs.writeFileSync(path.join(OUT, "shots-report.json"), JSON.stringify(report, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
