// Regenerates the marketplace listing images from the demo company (npm run shots). See assets/listing/v2/README.md.
// Needs the demo server running (npm run demo:server, after npm run build and npm run demo:fill). Screenshot mode (?shots=1) hides the demo banner and badges.
// Usage: BASE=http://localhost:3210 node scripts/listing-shots.mjs [only-file-prefix,...]
// Every screen must be fully loaded and free of error, empty and loading states before it is photographed; a screen that is not ready is retried, and rejected (no file) after the last try.
import { chromium } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3210";
const OUT = process.env.SHOTS_OUT || "assets/listing/v2";
const MAX = 500 * 1024;
const TRIES = Number(process.env.SHOTS_TRIES) || 3;
const only = process.argv[2] ? process.argv[2].split(",") : null;

// Ranked by strength: 01 is the hero. `click` runs in order (tab or page-chip names); `scroll` moves the page down by that many pixels; `wait` is extra ms.
const SHOTS = JSON.parse(fs.readFileSync(new URL("./listing-shots.json", import.meta.url), "utf8"));

const VENDOR = /gohighlevel|high\s?level|\bghl\b|leadconnector/i;
const LABELS = /demo mode|sample data|\(sample\)|demo company|demo admin|demo owner|fictional/i;
// Anything that says a screen is loading, failed or empty. A listing image must show none of these.
const NOT_READY = /still not loading|something went wrong|taking (too )?long|trying again|error id|could not load|try again|(^|\n)\s*loading/i;

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "dark" });
await ctx.addInitScript(() => {
  try { localStorage.setItem("subsync-theme", "dark"); localStorage.setItem("subsync.speed.tour6", "1"); sessionStorage.setItem("subsync-shots", "1"); } catch { /* ignore */ }
});
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "extra"), { recursive: true });

// Screenshot-only tidy-up (the page data is untouched): one fictional identity for the demo sign-in, and any leftover demo or sample line is hidden.
async function clean(page) {
  await page.evaluate(() => {
    const swaps = [[/Demo Admin/g, "Amara Okafor"], [/Demo Owner/g, "Amara Okafor"], [/Demo Company/g, "Brightpath Growth"]];
    const bad = /demo mode|sample data|\(sample\)|fictional/i;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hide = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (const [re, to] of swaps) if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, to);
      if (bad.test(n.nodeValue) && n.parentElement && !n.parentElement.closest("button,a,[role=tab]")) hide.push(n.parentElement);
    }
    for (const e of hide) e.style.display = "none";
    // The "Ask your data" card says it is switched off for this account: left out of the picture.
    const cards = [...document.querySelectorAll("section,div")].filter((e) => /^Ask your data/.test(e.innerText || "") && /is off for this account/.test(e.innerText) && e.innerText.length < 500);
    if (cards.length) cards[0].style.display = "none";
  });
}

// Why the screen is not ready to photograph (empty list when it is).
async function problems(page) {
  return page.evaluate((src) => {
    const re = new RegExp(src.re, "i");
    const out = [];
    const text = document.body.innerText || "";
    const m = text.match(re);
    if (m) out.push(`text "${m[0].trim().slice(0, 40)}"`);
    const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 20 && r.height > 8 && st.visibility !== "hidden" && st.display !== "none" && r.top < innerHeight; };
    const sk = [...document.querySelectorAll(".animate-pulse,[aria-busy=true],[role=progressbar]")].filter(vis);
    if (sk.length) out.push(`${sk.length} loading placeholder(s)`);
    const main = document.querySelector("main");
    if ((main?.innerText || "").length < 500) out.push("almost no content");
    return out;
  }, { re: NOT_READY.source });
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
  await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 500 }).catch(() => undefined);
  for (let k = 0; k < 24; k++) {
    await clean(page);
    if ((await problems(page)).length === 0) break;
    if (k % 3 === 2) await page.getByRole("button", { name: /try again/i }).first().click({ timeout: 800 }).catch(() => undefined);
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(ms);
  await clean(page);
}

async function attempt(s) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/app?shots=1#${s.hash}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 120000 });
    await settle(page, 2500);
    for (const c of s.click || []) {
      const loc = page.getByRole("tab", { name: new RegExp(c, "i") }).or(page.getByRole("button", { name: new RegExp(c, "i") })).or(page.getByRole("link", { name: new RegExp(c, "i") })).first();
      const clicked = await loc.click({ timeout: 8000 }).then(() => true, () => false);
      if (!clicked) console.log(`  ${s.file}: no tab or button called "${c}" (check scripts/listing-shots.json)`);
      await settle(page);
    }
    if (s.wait) await page.waitForTimeout(s.wait);
    await page.evaluate(() => { for (const e of [document.querySelector("main"), document.scrollingElement, document.body]) if (e) e.scrollTop = 0; window.scrollTo(0, 0); });
    if (s.scroll) { await page.evaluate((y) => { for (const e of [document.querySelector("main"), document.scrollingElement]) if (e) e.scrollTop = y; window.scrollTo(0, y); }, s.scroll); await page.waitForTimeout(800); }
    const why = await problems(page);
    const text = await page.locator("body").innerText();
    const warn = [VENDOR.test(text) && "vendor word", LABELS.test(text) && "demo/sample label"].filter(Boolean);
    if (why.length || warn.length) return { rejected: [...why, ...warn] };
    return { buf: await page.screenshot({ type: "png" }) };
  } catch (e) {
    return { rejected: [String(e).slice(0, 100)] };
  } finally {
    await page.close();
  }
}

const report = [];
let failed = 0;
const todo = SHOTS.filter((s) => !only || only.some((p) => s.file.startsWith(p)));
async function runShot(s) {
  const dest = path.join(OUT, s.extra ? "extra" : "", s.file);
  let res;
  for (let t = 1; t <= TRIES; t++) {
    res = await attempt(s);
    if (res.buf) break;
    console.log(`  ${s.file}: try ${t} not ready: ${res.rejected.join("; ")}`);
  }
  if (!res.buf) {
    failed++;
    fs.rmSync(dest, { force: true });
    report.push({ file: s.file, rejected: res.rejected, purpose: s.purpose });
    console.log(`${s.file}  REJECTED (not written)`);
    return;
  }
  // Taken at 1920x1080 (more of the screen fits) and shrunk to the 1600x900 the portal wants.
  let buf = await sharp(res.buf).resize(1600, 900).png({ compressionLevel: 9 }).toBuffer();
  if (buf.length > MAX) buf = await sharp(buf).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
  fs.writeFileSync(dest, buf);
  const meta = await sharp(buf).metadata();
  report.push({ file: s.file, extra: !!s.extra, size: `${meta.width}x${meta.height}`, kB: Math.round(buf.length / 1024), purpose: s.purpose, note: s.note });
  console.log(`${s.file}  ${meta.width}x${meta.height}  ${Math.round(buf.length / 1024)} kB${s.note ? "  (" + s.note + ")" : ""}`);
}
// A few screens at once (SHOTS_PARALLEL, default 3): the first one to load also warms the server for the rest.
const queue = [...todo];
await Promise.all(Array.from({ length: Number(process.env.SHOTS_PARALLEL) || 3 }, async () => { for (let s = queue.shift(); s; s = queue.shift()) await runShot(s); }));
const reportFile = path.join(OUT, "shots-report.json");
let old = [];
try { old = JSON.parse(fs.readFileSync(reportFile, "utf8")); } catch { /* first run */ }
const merged = [...old.filter((o) => !report.some((r) => r.file === o.file)), ...report].sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(reportFile, JSON.stringify(merged, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
