// Extra listing stills: the appointments flow tree (page and full screen), the bell open, the alert settings and the Slack card.
// Needs the demo server. Usage: SHOTS_OUT=dir BASE=http://localhost:3290 node scripts/listing-shots-views.mjs [only-prefix,...]
import { chromium } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3290";
const OUT = process.env.SHOTS_OUT || "assets/listing/v2";
const only = process.argv[2] ? process.argv[2].split(",") : null;
const LABELS = /demo|sample data|\(sample\)|fictional|gohighlevel|high\s?level|\bghl\b|leadconnector/i;

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
await ctx.addInitScript(() => { try { localStorage.setItem("subsync-theme", "dark"); localStorage.setItem("subsync.speed.tour6", "1"); sessionStorage.setItem("subsync-shots", "1"); } catch { /* ignore */ } });

async function clean(page) {
  await page.evaluate(() => {
    const swaps = [[/Demo Admin/g, "Amara Okafor"], [/Demo Owner/g, "Amara Okafor"], [/Demo Company/g, "Brightpath Growth"], [/-demo./g, "."]];
    const bad = /demo|sample data|\(sample\)|fictional/i;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hide = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      for (const [re, to] of swaps) if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, to);
      if (bad.test(n.nodeValue) && n.parentElement && !n.parentElement.closest("button,a,[role=tab]")) { const blk = n.parentElement.closest("p,li,div"); hide.push(blk && (blk.innerText || "").length < 120 ? blk : n.parentElement); }
    }
    for (const e of hide) e.style.display = "none";
    // Typed values (inputs) are not text nodes: mask the word demo in them too.
    for (const el of document.querySelectorAll("input,textarea")) { if (/demo/i.test(el.value || "")) { const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, el.value.replace(/-demo./gi, ".").replace(/demo/gi, "")); } }
    const tm = [...document.querySelectorAll("div,section,p")].filter((e) => /^Test mode/.test(e.innerText || "") && (e.innerText || "").length < 320);
    if (tm.length) tm[0].style.display = "none";
  });
}
const loading = (page) => page.evaluate(() => [...document.querySelectorAll(".animate-pulse,[aria-busy=true]")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 6 && r.top < innerHeight; }));

async function open(page, hash, steps) {
  await page.goto(`${BASE}/app?shots=1#${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 120000 });
  await page.getByRole("button", { name: /^skip$/i }).first().click({ timeout: 800 }).catch(() => undefined);
  await page.waitForTimeout(6000);
  // One identity in every picture: wait until the agency name has loaded in the menu.
  await page.waitForFunction(() => /Brightpath Growth/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => undefined);
  await steps(page);
  // A slow section shows "Something went wrong" with Try again: press it and give it time, up to 8 times.
  for (let k = 0; k < 8; k++) {
    const err = await page.evaluate(() => /something went wrong|this is taking too long/i.test(document.body.innerText));
    if (!err) break;
    await page.getByRole("button", { name: /try again/i }).first().click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(20000);
  }
  for (let k = 0; k < 60; k++) { if (!(await loading(page))) break; await page.waitForTimeout(2000); }
  await page.waitForTimeout(2500);
  await clean(page);
}
async function shoot(page, file) {
  const text = await page.locator("body").innerText();
  if (LABELS.test(text)) throw new Error(`${file}: demo, sample or vendor wording on screen`);
  const bad = text.match(/something went wrong|could not be loaded|error id|try again/i);
  if (bad) throw new Error(`${file}: an error is on screen ("${bad[0]}")`);
  if (await loading(page)) throw new Error(`${file}: still loading`);
  const buf = await sharp(await page.screenshot({ type: "png" })).resize(1600, 900).png({ compressionLevel: 9 }).toBuffer();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), buf);
  console.log(file, Math.round(buf.length / 1024), "kB");
}
const want = (f) => !only || only.some((p) => f.startsWith(p));
async function job(file, hash, steps, after) {
  if (!want(file)) return;
  const page = await ctx.newPage();
  try {
    await open(page, hash, steps);
    if (after) await after(page);
    await shoot(page, file);
  } catch (e) { console.log(`${file}  FAILED ${String(e).slice(0, 160)}`); if (process.env.SHOTS_DEBUG) await page.screenshot({ path: path.join(process.env.SHOTS_DEBUG, `fail-${file}`) }).catch(() => undefined); }
  await page.close();
}

const click = (re) => async (page) => { await page.getByRole("tab", { name: re }).or(page.getByRole("button", { name: re })).or(page.getByRole("link", { name: re })).first().click({ timeout: 90000 }); await page.waitForTimeout(3000); };
const scrollTo = (text) => async (page) => { await page.getByText(text, { exact: false }).first().scrollIntoViewIfNeeded().catch(() => undefined); await page.evaluate((t) => { const el = [...document.querySelectorAll("h2,h3,summary,section")].find((e) => e.innerText && e.innerText.includes(t)); el?.scrollIntoView({ block: "start" }); window.scrollBy(0, -80); }, text); await page.waitForTimeout(1200); };
const flowSteps = async (page) => {
  await page.getByRole("tab", { name: /^Flow tree$/i }).click({ timeout: 15000 });
  await page.waitForSelector('[data-testid="ap-tree"]', { timeout: 90000 });
};
const centre = (page) => page.evaluate(() => { document.querySelector('[data-testid="ap-tree"]')?.scrollIntoView({ block: "center" }); });

await job("19-flow-tree-new.png", "appointments", flowSteps, async (page) => { await centre(page); await page.waitForTimeout(1500); });
await job("20-flow-tree-expanded.png", "appointments", flowSteps, async (page) => { await page.getByTestId("ap-expand").click(); await page.waitForTimeout(3500); });
if (want("21-bell-open.png")) {
  const page = await ctx.newPage();
  try {
    await open(page, "audit", async (p) => { await p.locator('[data-testid="bell"] button').first().click({ timeout: 90000 }); await p.waitForSelector('[data-testid="bell-panel"]', { timeout: 60000 }); await p.waitForSelector('[data-testid="bell-item"]', { timeout: 60000 }); });
    // The page behind the bell can be slow on a small database pool, so the dropdown is photographed on its own, centred on a plain dark page.
    const panel = page.locator('[data-testid="bell-panel"]');
    const text = await panel.innerText();
    if (LABELS.test(text)) throw new Error("21-bell-open.png: demo, sample or vendor wording in the list");
    const shot = await panel.screenshot({ type: "png" });
    const meta = await sharp(shot).metadata();
    const scale = Math.min(1500 / meta.width, 820 / meta.height, 1.6);
    const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
    const inner = await sharp(shot).resize(w, h).png().toBuffer();
    const buf = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#131313" } }).composite([{ input: inner, left: Math.round((1600 - w) / 2), top: Math.round((900 - h) / 2) }]).png({ compressionLevel: 9 }).toBuffer();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "21-bell-open.png"), buf);
    console.log("21-bell-open.png", Math.round(buf.length / 1024), "kB");
  } catch (e) { console.log(`21-bell-open.png  FAILED ${String(e).slice(0, 160)}`); }
  await page.close();
}
await job("23-alert-settings.png", "settings", click(/Alerts and notifications/i), scrollTo("What you get"));
await job("24-slack-card.png", "settings", click(/^Connections/i));
await job("25-fathom-connections-card.png", "settings", click(/^Connections/i), scrollTo("Fathom"));
await job("26-settings-team-roles.png", "settings", click(/Team and roles/i));
await job("27-settings-safety-sending-rules.png", "settings", click(/^Safety/i));
await job("28-meetings-inbox.png", "meetings", async () => undefined);
await job("29-getting-started-checklist.png", "help", async () => undefined);
await job("30-whats-new.png", "roadmap", async () => undefined);
await job("31-guide-how-today-works.png", "help", async (page) => { const sm = page.locator("details[data-guide] summary", { hasText: /today/i }).first(); await sm.scrollIntoViewIfNeeded({ timeout: 60000 }); await sm.click({ timeout: 30000 }); await page.waitForTimeout(1500); await sm.evaluate((e) => e.scrollIntoView({ block: "start" })); });
await job("32-guide-how-this-works-connection.png", "settings", async (page) => { await click(/^Connections/i)(page); await click(/How this works/i)(page); });
await job("33-workflows.png", "workflows", async () => undefined);
await job("34-overview.png", "overview", async () => undefined);
await job("35-settings-main.png", "settings", async () => undefined);
await job("36-settings-account.png", "settings", click(/Account and plan/i));
await job("37-settings-connections.png", "settings", click(/Connections/i));
await job("38-settings-permissions.png", "settings", click(/Permissions/i));
await job("39-settings-alerts.png", "settings", click(/Alerts and notifications/i));
await job("40-settings-team.png", "settings", click(/Team and roles/i));
await job("41-settings-targets.png", "settings", click(/Targets/i));
await job("42-settings-data.png", "settings", click(/^Data/i));
await job("43-settings-modules.png", "settings", click(/Modules/i));
await job("44-settings-safety.png", "settings", click(/^Safety/i));
await browser.close();
