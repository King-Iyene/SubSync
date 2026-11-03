/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS helper script run with plain node */
// UI check (stage D1): opens the pilot pages of a running demo app at three widths in light and dark and reports what a reviewer would otherwise
// have to notice by hand: sideways scroll, console errors, failed requests, text below WCAG contrast (4.5:1, 3:1 for large text; disabled controls are
// exempt), a boxed block inside another boxed block, an internal word, and the number of main headings (must be 1). It saves a full-page screenshot
// of each. Read-only; it only uses the demo login, which works with DEMO_MODE=true and never in production.
//
//   DEMO_MODE=true next dev -p 3104        (in another terminal)
//   BASE=http://localhost:3104 node scripts/ui-check.cjs out-folder "today,speed" "390,1440" "light,dark"
//   AS=client or AS=business opens the demo as a client's staff or as a single business.
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:3104";
const fs = require("fs");
const [out, pagesArg, widthsArg, themesArg] = process.argv.slice(2);
const PAGES = (pagesArg || "today,speed,appointments,inbox,audit,clients,people,settings,help,roadmap").split(",");
const WIDTHS = (widthsArg || "390,768,1440").split(",").map(Number);
const THEMES = (themesArg || "light,dark").split(",");
const BANNED = /gohighlevel|highlevel|leadconnector|\bghl\b|sub-?accounts?|\blocations?\b|\bagenc(y|ies)\b/i;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const report = [];
  for (const theme of THEMES) for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : w < 1000 ? 1024 : 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("subsync-theme", t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const id of PAGES) {
      const errors = [], failed = [];
      page.removeAllListeners("pageerror"); page.removeAllListeners("console"); page.removeAllListeners("response");
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
      page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) failed.push(r.status() + " " + new URL(r.url()).pathname); });
      const t0 = Date.now();
      await page.goto(`${BASE}/app${process.env.AS ? "?as=" + process.env.AS : ""}#${id}`, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("main h1").first().waitFor({ timeout: 60000 }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
      const ms = Date.now() - t0;
      const m = await page.evaluate(() => {
        const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        const norm = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bgOf = (el) => {
          const stack = [];
          for (let e = el; e; e = e.parentElement) { const c = norm(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 0.99) break; } }
          let base = [0, 0, 0];
          for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; base = base.map((v, k) => (k < 3 ? c[k] * c[3] + v * (1 - c[3]) : v)); }
          return base.slice(0, 3);
        };
        const low = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        while (walker.nextNode()) {
          const n = walker.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
          const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
          if (el.closest("[class*='sr-only']") || el.closest("button:disabled, [disabled], [aria-disabled='true']")) continue;
          let op = 1; for (let e = el; e; e = e.parentElement) { op *= parseFloat(getComputedStyle(e).opacity); }
          const fg = norm(cs.color); const bg = bgOf(el);
          const a = fg[3] * op; const fgm = fg.slice(0, 3).map((v, k) => v * a + bg[k] * (1 - a));
          const L1 = lum(fgm), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700; const large = size >= 24 || (size >= 18.66 && bold);
          if (ratio < (large ? 3 : 4.5)) low.push({ t: t.slice(0, 40), ratio: +ratio.toFixed(2), size });
        }
        const over = []; document.querySelectorAll("main *").forEach((e) => { const r = e.getBoundingClientRect(); if (r.right > window.innerWidth + 1 && r.width > 0) over.push(e.tagName + "." + String(e.className).slice(0, 40)); });
        // cards inside cards: an element with a border + rounded + bg-card inside another one
        const isCard = (e) => { const s = getComputedStyle(e); return parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderTopLeftRadius) >= 4 && s.borderTopStyle !== "none" && s.backgroundColor !== "rgba(0, 0, 0, 0)" && e.tagName !== "BUTTON" && e.tagName !== "INPUT" && e.tagName !== "SELECT" && e.tagName !== "TEXTAREA" && e.tagName !== "A"; };
        let nested = 0; document.querySelectorAll("main *").forEach((e) => { if (isCard(e)) { const p = e.parentElement && e.parentElement.closest("main *"); let q = e.parentElement; while (q && q.tagName !== "MAIN") { if (isCard(q)) { nested++; break; } q = q.parentElement; } } });
        return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1, text: document.body.innerText, low: low.slice(0, 12), lowCount: low.length, over: over.slice(0, 4), h1: document.querySelectorAll("main h1").length, nested, height: document.documentElement.scrollHeight };
      });
      await page.screenshot({ path: `${out}/${id}-${w}-${theme}.png`, fullPage: true });
      report.push({ id, w, theme, ms, overflow: m.overflow, over: m.over, errors, failed, banned: (m.text.match(BANNED) || [])[0] || null, lowCount: m.lowCount, low: m.low, h1: m.h1, nested: m.nested, height: m.height, chars: m.text.length });
    }
    await ctx.close();
  }
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  for (const r of report) console.log(`${r.id} ${r.w} ${r.theme}: ${r.ms}ms h=${r.height} overflow=${r.overflow} err=${r.errors.length} fail=${r.failed.length} low=${r.lowCount} nested=${r.nested} banned=${r.banned} h1=${r.h1}`);
  await browser.close();
})();
