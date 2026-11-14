// The lead panel with the message box (text and email), for the listing: opens a waiting lead from Find a lead, writes a short draft (nothing is sent), photographs it.
// Needs the demo server (FLAGS_ALL_ON makes the message box available). Usage: BASE=http://localhost:3290 node scripts/listing-shots-lead.mjs
import { chromium } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3290";
const OUT = process.env.SHOTS_OUT || "assets/listing/v2";
const LABELS = /demo|demo mode|sample data|\(sample\)|demo company|demo admin|demo owner|fictional|gohighlevel|high\s?level|\bghl\b|leadconnector/i;

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
await ctx.addInitScript(() => { try { localStorage.setItem("subsync-theme", "dark"); localStorage.setItem("subsync.speed.tour6", "1"); sessionStorage.setItem("subsync-shots", "1"); } catch { /* ignore */ } });
const page = await ctx.newPage();

async function clean() {
  await page.evaluate(() => {
    const swaps = [[/Demo Admin/g, "Amara Okafor"], [/Demo Owner/g, "Amara Okafor"], [/Demo Company/g, "Brightpath Growth"]];
    const bad = /demo|sample data|\(sample\)|fictional/i;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hide = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (const [re, to] of swaps) if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, to);
      if (bad.test(n.nodeValue) && n.parentElement && !n.parentElement.closest("button,a,[role=tab]")) { const blk = n.parentElement.closest("p,li,div"); hide.push(blk && (blk.innerText || "").length < 120 ? blk : n.parentElement); }
    }
    for (const e of hide) e.style.display = "none";
  });
}
async function waitReady(sel, ms = 120000) {
  await page.waitForSelector(sel, { timeout: ms });
  await page.waitForTimeout(2500);
  await clean();
}

await page.goto(`${BASE}/app?shots=1#people`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("main", { timeout: 120000 });
await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 800 }).catch(() => undefined);
// The Waiting list: the first row that says "Never answered".
await page.waitForTimeout(5000);
const open = page.locator("button:text-is(\"Open\")").first();
// The list is slow on a small database pool: press Try again until the rows are there.
for (let k = 0; k < 8; k++) {
  if (await open.waitFor({ timeout: 25000 }).then(() => true, () => false)) break;
  await page.getByRole("button", { name: /try again/i }).first().click({ timeout: 1000 }).catch(() => undefined);
}
await open.waitFor({ timeout: 30000 }).catch(async (e) => { await page.screenshot({ path: "fail-lead.png" }); throw e; });
await page.waitForTimeout(3000);
await open.click();
await waitReady('[data-testid="wb-thread"]');

async function shoot(file, prep) {
  await prep();
  // No grey loading bars may be in the picture: wait (up to 90 s) until the panel has finished loading its tags and details.
  for (let k = 0; k < 90; k++) {
    const loading = await page.evaluate(() => [...document.querySelectorAll(".animate-pulse,[aria-busy=true]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 6 && r.top < innerHeight; }));
    if (!loading) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1200);
  await clean();
  const text = await page.locator("body").innerText();
  if (LABELS.test(text)) throw new Error(`${file}: demo, sample or vendor wording on screen`);
  if (await page.evaluate(() => [...document.querySelectorAll(".animate-pulse,[aria-busy=true]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 6 && r.top < innerHeight; }))) throw new Error(`${file}: still loading`);
  if (/something went wrong|could not be loaded|error id/i.test(text)) throw new Error(`${file}: an error is on screen`);
  const buf = await sharp(await page.screenshot({ type: "png" })).resize(1600, 900).png({ compressionLevel: 9 }).toBuffer();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(file, Math.round(buf.length / 1024), "kB");
}

await shoot("13-lead-messaging-text.png", async () => {
  await page.getByTestId("drawer-message").click();
  const box = page.getByLabel("Message", { exact: true });
  await box.waitFor();
  await box.fill("Hi, thanks for getting in touch. I can see you asked about a quote last week. Would tomorrow at 10am or 2pm suit you for a quick call?");
});
await shoot("14-lead-messaging-email.png", async () => {
  await page.getByTestId("drawer-email").click();
  await page.getByTestId("wb-subject").waitFor();
  await page.getByTestId("wb-subject").fill("Your quote request, and a time to talk");
  await page.getByLabel("Message", { exact: true }).fill("Hi,\nThanks for asking about a quote. Would tomorrow at 10am or 2pm suit you for a short call?\nKind regards,\nAmara");
});
await browser.close();
