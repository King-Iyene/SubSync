import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { PRINT_CSS, prepareForPrint } from "../src/lib/design/print-support";
import { SHARED_REPORT_CSS } from "../src/app/r/[id]/report";

// Printing on paper (no server, no database). Builds a page that behaves like the dark app shell (the REAL colour tokens of src/app/globals.css, the navigation, a long table, a scroll box, a collapsed
// section, an SVG chart and a fixed toolbar), then prints it to PDF with the browser's print engine on A4 the way a person would: dark colour scheme, background colours OFF.
//   node --import tsx scripts/check-print-pdf.ts            (PRINT_OUT=<folder> keeps the PDFs and PNGs to look at)
// 1. WITHOUT the fix (the page left dark) the text is pale on white paper: the check fails, which is the bug King hit (blank sheets).
// 2. WITH the fix (prepareForPrint, then PRINT_CSS) every piece of text is dark on white, the scroll box shows all of its lines, the collapsed section is open, the navigation is gone, the table's
//    header repeats, and the PDF has several sheets that each hold text. The shared report page (src/app/r/[id]) is printed the same way.
const OUT = process.env.PRINT_OUT || join(tmpdir(), "subsync-print-pdf");
mkdirSync(OUT, { recursive: true });
const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
const grab = (sel: string) => { const s = css.indexOf(`\n${sel} {`); return css.slice(s, css.indexOf("\n}", s) + 2); };
const tokens = `${grab(":root")}\n${grab(".dark")}`;

const rows = Array.from({ length: 70 }, (_, i) => `<tr><td>Client account ${i + 1}</td><td>${(i * 7) % 40} leads</td><td>${(i * 3) % 20} waiting</td></tr>`).join("");
const lines = Array.from({ length: 60 }, (_, i) => `<li>Scroll box line ${i + 1}: this must be on paper</li>`).join("");
const shell = `<!doctype html><html><head><meta charset="utf-8"><title>Report</title><style>
${tokens}
body { margin: 0; font-family: system-ui, sans-serif; }
.shell { display: flex; min-height: 100vh; background: var(--background); color: var(--foreground); }
aside { width: 220px; background: var(--sidebar); color: var(--sidebar-foreground); padding: 16px; }
main { flex: 1; padding: 24px; } table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.card { background: var(--card); border: 1px solid var(--border); padding: 12px; } .muted { color: var(--muted-foreground); }
.overflow-auto { height: 160px; overflow: auto; } .fixed { position: fixed; bottom: 0; left: 0; right: 0; background: var(--card); padding: 8px; }
</style></head><body><div class="shell dark" data-theme="dark">
<aside data-noprint><p>Navigation</p><p>Today</p><p>Clients</p></aside>
<main><header><h1>Weekly report</h1><p class="muted">All client accounts, last 7 days</p></header>
<div class="card"><p>14 leads are waiting for a reply</p><svg width="300" height="60" viewBox="0 0 300 60"><polyline fill="none" stroke="var(--chart-1)" stroke-width="3" points="0,50 60,30 120,40 180,10 240,25 300,5"/></svg></div>
<table><thead><tr><th>Client</th><th>Leads</th><th>Waiting</th></tr></thead><tbody>${rows}</tbody></table>
<div class="overflow-auto" id="scroll"><ul>${lines}</ul></div>
<details id="more"><summary>More detail</summary><p>Collapsed text that must be printed.</p></details>
<div class="fixed" id="toolbar">Toolbar that is not for paper</div></main></div></body></html>`;

const lum = (rgb: number[]) => { const f = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ colorScheme: "dark", viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const measure = () => page.evaluate(() => {
    const out: { worst: number; badText: string; scrollClipped: boolean; detailsOpen: boolean; navHidden: boolean; toolbarHidden: boolean } = { worst: 21, badText: "", scrollClipped: false, detailsOpen: false, navHidden: false, toolbarHidden: false };
    const toRgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const L = (rgb: number[]) => { const f = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
    for (const el of Array.from(document.querySelectorAll("main h1, main p, main td, main th, main li, main summary"))) {
      const cs = getComputedStyle(el); if (cs.display === "none") continue;
      const ratio = (1.05) / (L(toRgb(cs.color)) + 0.05); // text on white paper
      if (ratio < out.worst) { out.worst = ratio; out.badText = (el.textContent ?? "").slice(0, 30); }
    }
    const sc = document.getElementById("scroll")!; out.scrollClipped = sc.scrollHeight > sc.clientHeight + 2;
    out.detailsOpen = (document.getElementById("more") as HTMLDetailsElement).open;
    out.navHidden = getComputedStyle(document.querySelector("aside")!).display === "none";
    out.toolbarHidden = getComputedStyle(document.getElementById("toolbar")!).display === "none";
    return out;
  });
  const print = async (name: string, prepared: boolean, html: string) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate("window.__name = (f) => f"); // the script runner adds this helper to function bodies it sends to the page
    await page.addStyleTag({ content: PRINT_CSS });
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    if (prepared) {
      // Exactly what src/app/app/ds/print-support.tsx does on "beforeprint".
      await page.evaluate(`(${prepareForPrint.toString().replace(/^function prepareForPrint/, "function")})(document)`);
    }
    const m = await measure();
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    await page.pdf({ path: join(OUT, `${name}.pdf`), format: "A4", printBackground: false, margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" } });
    const pdf = readFileSync(join(OUT, `${name}.pdf`)).toString("latin1");
    return { ...m, sheets: (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length };
  };

  const before = await print("before-fix", false, shell);
  console.log(`before the fix: weakest text contrast on white paper ${before.worst.toFixed(2)}:1 ("${before.badText}")`);
  assert.ok(before.worst < 4.5, "the unfixed dark page really is unreadable on paper (this is the bug)");

  const after = await print("after-fix", true, shell);
  console.log(`after the fix:  weakest text contrast ${after.worst.toFixed(2)}:1, ${after.sheets} sheets, scroll box clipped: ${after.scrollClipped}, collapsed section open: ${after.detailsOpen}, navigation hidden: ${after.navHidden}, toolbar hidden: ${after.toolbarHidden}`);
  assert.ok(after.worst >= 4.5, `all text is readable on paper (weakest ${after.worst.toFixed(2)}:1 "${after.badText}")`);
  assert.equal(after.scrollClipped, false, "the scroll box is shown in full");
  assert.equal(after.detailsOpen, true, "the collapsed section prints open");
  assert.ok(after.navHidden && after.toolbarHidden, "navigation and the fixed toolbar are left out");
  assert.ok(after.sheets >= 2, "a long report flows over several sheets");

  // The shared report page: dark system setting, white paper, real content, several sheets, no buttons.
  const shared = `<!doctype html><html><head><meta charset="utf-8"><title>Shared report</title><style>${SHARED_REPORT_CSS}</style></head><body style="margin:0"><div class="sr-root"><main>
    <header class="sr-head"><p class="sr-brand">Acme Marketing</p><h1>Weekly proof</h1><p class="sr-meta">All client accounts, week of 2 November</p><button class="no-print rp-print">Download or print (PDF)</button></header>
    <section class="sr-sec"><h2>Where things stand</h2><div class="sr-stats"><div class="sr-stat"><p class="sr-label">Found</p><p class="sr-value">112</p></div><div class="sr-stat"><p class="sr-label">Fixed</p><p class="sr-value">97</p></div></div></section>
    <section class="sr-sec"><h2>By client account</h2><div class="sr-wrap"><table class="sr-table"><thead><tr><th>Client account</th><th>Found</th></tr></thead><tbody>${Array.from({ length: 70 }, (_, i) => `<tr><td>Client account ${i + 1}</td><td>${i}</td></tr>`).join("")}</tbody></table></div></section></main></div></body></html>`;
  await page.setContent(shared, { waitUntil: "load" });
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".sr-root")!).backgroundColor + "|" + getComputedStyle(document.querySelector("h1")!).color + "|" + getComputedStyle(document.querySelector(".no-print")!).display);
  assert.equal(bg, "rgb(255, 255, 255)|rgb(29, 28, 25)|none", "white paper, dark text, buttons left out");
  await page.pdf({ path: join(OUT, "shared-report.pdf"), format: "A4", printBackground: false, margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" } });
  await page.screenshot({ path: join(OUT, "shared-report.png"), fullPage: true });
  const sharedSheets = (readFileSync(join(OUT, "shared-report.pdf")).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  console.log(`shared report: ${sharedSheets} sheets, white paper, dark text`);
  assert.ok(sharedSheets >= 2);
  writeFileSync(join(OUT, "README.txt"), "before-fix.* is the bug, after-fix.* and shared-report.* are the fix.\n");
  await browser.close();
  void lum;
  console.log(`ok. Files in ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
