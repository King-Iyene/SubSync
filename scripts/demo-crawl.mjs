// Opens every module of the demo in a real browser, clicks every tab and page chip, and reports each data call it made plus any "empty" wording on screen.
// Usage: BASE=http://localhost:3210 node scripts/demo-crawl.mjs [view,view] [--shots=dir]   Needs the server in demo mode (docs/DEMO_SCREENSHOTS.md).
import { chromium } from "@playwright/test";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3210";
const VIEWS = (process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2].split(",") : ["today", "speed", "appointments", "clients", "payments", "people", "audit", "cleanup", "team", "pipeline", "meetings", "workflows", "settings", "roadmap", "help"]);
const shots = process.argv.find((a) => a.startsWith("--shots="))?.slice(8);
if (shots) fs.mkdirSync(shots, { recursive: true });
const EMPTY = /needs permission|not available from the platform|no data|nothing (here|to show|yet)|not enough data|no results|nothing found|not set up|connect |sample data|0 of 0|none yet|no .{3,40} yet|could not load|something went wrong|try again/i;
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const out = {};
for (const view of VIEWS) {
  const page = await ctx.newPage();
  const calls = [];
  page.on("response", async (r) => { const u = r.url(); if (!u.includes("/api/app/") || r.request().method() !== "GET") return; calls.push({ url: u.split("/api/app/")[1].replace(/[?&]_r=\w+/, ""), status: r.status() }); });
  const note = [];
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: Number(process.env.CRAWL_WAIT_MS) || 20000 }).catch(() => undefined);
    // The first visit of a module opens a short tour (stored in the browser): skip it, so the screen behind it is what gets read and photographed.
    await page.getByRole("button", { name: /^skip$/i }).or(page.getByRole("link", { name: /^skip$/i })).first().click({ timeout: 800 }).catch(() => undefined);
    await page.waitForTimeout(1500);
  };
  try {
    await page.goto(`${BASE}/app#${view}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Demo mode", { timeout: 90000 }).catch(() => note.push("no demo banner"));
    await settle();
    const look = async (label) => {
      const text = await page.locator("main, body").first().innerText().catch(() => "");
      const hits = [...new Set(text.split(/\r?\n/).filter((l) => EMPTY.test(l) && !/^sample data$/i.test(l.trim())).map((l) => l.trim().slice(0, 110)))].slice(0, 12);
      if (/gohighlevel|high level|\bghl\b/i.test(text)) note.push(`${label}: WARNING the platform's name is visible on screen`);
      note.push(`${label}: ${text.length} chars${hits.length ? ` | ${hits.join(" // ")}` : ""}`);
      if (shots) await page.screenshot({ path: `${shots}/${view}-${label.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}.png`, fullPage: false }).catch(() => undefined);
    };
    await look("first");
    const tabs = await page.locator('[role="tab"]').all();
    const names = [];
    for (const t of tabs) names.push((await t.innerText().catch(() => "")).trim().split("\n")[0]);
    for (let i = 0; i < tabs.length; i++) {
      if (!names[i]) continue;
      await tabs[i].click({ timeout: 5000 }).catch(() => undefined); await settle(); await look(`tab ${names[i]}`);
      const chips = await page.locator('[role="group"][aria-label^="Pages in"] button').all();
      const cn = []; for (const c of chips) cn.push((await c.innerText().catch(() => "")).trim());
      for (let k = 0; k < chips.length; k++) { await chips[k].click({ timeout: 5000 }).catch(() => undefined); await settle(); await look(`  page ${cn[k]}`); }
    }
  } catch (e) { note.push(`ERROR ${String(e).slice(0, 120)}`); }
  const bad = calls.filter((c) => c.status >= 400);
  out[view] = { calls: [...new Set(calls.map((c) => `${c.status} ${c.url}`))], bad: bad.map((c) => `${c.status} ${c.url}`), note };
  console.log(`\n=== ${view}: ${calls.length} data calls, ${bad.length} failed`);
  for (const n of note) console.log("  " + n);
  for (const b of new Set(bad.map((c) => `${c.status} ${c.url}`))) console.log("  BAD " + b);
  await page.close();
}
fs.writeFileSync(process.env.CRAWL_OUT || "demo-crawl.json", JSON.stringify(out, null, 1));
await browser.close();
