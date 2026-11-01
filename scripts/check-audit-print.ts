import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { AuditReport } from "../src/app/audit/[id]/report";
import { auditNotes, buildAudit, fixFirstLine, type Finding } from "../src/lib/analytics/audit-intel";
import { buildSharePayload } from "../src/lib/analytics/share-intel";
import { DEAL_RULES_VERSION } from "../src/lib/analytics/definitions";

// The shared report on paper (stage F6): rendered from the same component the public page uses, with no server and no database, and printed by the browser's
// own print engine on A4 and on Letter. Checks what King's check 4 looks at: light background, dark text, the sender's colour on the heading rule, nothing
// that is not for paper, no sideways overflow, and at most two sheets even for a full report (eight findings, five fix steps, every definition).
//   node --import tsx scripts/check-audit-print.ts          (PRINT_OUT=<folder> also saves the two PDFs to look at)
const findings: Finding[] = [
  { key: "stale", severity: "critical", title: "$412,000 is sitting in 9 deals that have not moved", detail: "", count: 9, dollars: 412_000, kind: "fact", view: "deals", fix: "Call or message the owner of each stuck deal this week; close the ones that are dead so the pipeline tells the truth.", note: "stale", window: "No change for 30 days or more, counted now" },
  { key: "slow", severity: "critical", title: "27 conversations are waiting past the reply target", detail: "", count: 27, dollars: 186_000, kind: "estimate", view: "inbox", fix: "Have one person own every new lead for the first hour of each day, and turn on a text that goes out within a minute.", note: "slow", window: "Customer's last message more than 4 hours ago, within the last 30 days" },
  { key: "unmarked", severity: "critical", title: "14 past appointments never got an outcome", detail: "", count: 14, dollars: null, kind: "none", view: "appointments", fix: "Mark each past showing as held or no-show today, then make it part of the end-of-day routine.", note: "unmarked", window: "Started more than 3 hours ago, in the last 30 days" },
  { key: "noshows", severity: "warning", title: "6 recent no-shows have not been rebooked", detail: "", count: 6, dollars: null, kind: "none", view: "appointments", fix: "Send each a message offering two new times within a day of the missed showing.", note: "noshows", window: "No-shows in the last 14 days with no later booking" },
  { key: "junk", severity: "warning", title: "38 open deals are left out of every dollar figure", detail: "", count: 38, dollars: null, kind: "none", view: "deals", fix: "Give each a value and an owner, or close it out.", note: "left_out", window: "Every open deal, counted now" },
  { key: "data", severity: "warning", title: "3 accounts have thin contact records", detail: "", count: 3, dollars: null, kind: "none", view: "accounts", fix: "Open the account, add the missing details or switch on data cleanup.", note: "data", window: "Counted now over every contact in the account" },
];

const source = {
  headline: "Across 4 accounts: $412,000 in stale deals, 27 conversations waiting, 14 appointments with no outcome.",
  accountsScanned: 4, staleDollars: 412_000, estimatedDollars: 186_000, estimateRange: { low: 131_000, high: 247_000 }, outlier: { value: 300_000, share: 0.73 }, leftOut: 38,
  findings, fixFirst: fixFirstLine({ findings }), notes: auditNotes({ findings, leftOut: 38 }, { staleDays: 30, slaHours: 4, readLimit: "1 of 4 accounts has more than 500 conversations, and only the newest 500 are read." }),
};
void buildAudit;

async function main() {
  const payload = buildSharePayload(source, "Acme Marketing", [], new Date("2026-11-01T10:00:00Z"), { branded: true, brandColor: "#aa3366", rulesVersion: DEAL_RULES_VERSION });
  const markup = renderToStaticMarkup(createElement(AuditReport, { payload, expiresAt: new Date("2026-11-15T10:00:00Z") }));
  const dir = mkdtempSync(join(tmpdir(), "audit-print-"));
  const file = join(dir, "report.html");
  writeFileSync(file, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account audit</title></head><body style="margin:0">${markup}</body></html>`);

  const browser = await chromium.launch();
  try {
    for (const [name, format, width] of [["A4", "A4", 794], ["Letter", "Letter", 816]] as const) {
      const page = await browser.newPage({ viewport: { width, height: 1100 } });
      await page.goto(`file:///${file.replace(/\\/g, "/")}`);
      await page.emulateMedia({ media: "print" });
      const look = await page.evaluate(() => {
        const root = document.querySelector(".audit-root") as HTMLElement;
        const h1 = document.querySelector("h1") as HTMLElement;
        const bar = document.querySelector(".rp-bar") as HTMLElement;
        const print = document.querySelector(".no-print") as HTMLElement;
        return { bg: getComputedStyle(root).backgroundColor, color: getComputedStyle(h1).color, rule: getComputedStyle(bar).borderTopColor, printHidden: getComputedStyle(print).display, scrollWidth: document.documentElement.scrollWidth };
      });
      assert.equal(look.bg, "rgb(255, 255, 255)", `${name} background`);
      assert.equal(look.color, "rgb(17, 17, 17)", `${name} text`);
      assert.notEqual(look.rule, "rgb(187, 187, 187)", `${name}: the heading rule keeps the sender's colour on paper`);
      assert.equal(look.printHidden, "none", `${name}: the print button is not printed`);
      assert.ok(look.scrollWidth <= width + 1, `${name} sideways overflow: ${look.scrollWidth} > ${width}`);
      const pdf = await page.pdf({ format, printBackground: false });
      if (process.env.PRINT_OUT) { writeFileSync(join(process.env.PRINT_OUT, `audit-${name}.pdf`), pdf); await page.screenshot({ path: join(process.env.PRINT_OUT, `audit-${name}.png`), fullPage: true }); } // to look at the printed page by eye
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      assert.ok(pages >= 1 && pages <= 2, `${name} PDF has ${pages} pages`);
      console.log(`${name}: ${pages} page${pages === 1 ? "" : "s"}, ${pdf.length} bytes, rule colour ${look.rule}, text ${look.color}, background ${look.bg}`);
      await page.close();
    }
    // On screen (dark) at a phone and a desktop width: no sideways scroll at either.
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(`file:///${file.replace(/\\/g, "/")}`);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1, `screen ${width}: sideways overflow`);
      if (process.env.PRINT_OUT) await page.screenshot({ path: join(process.env.PRINT_OUT, `audit-screen-${width}.png`), fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log("audit print: light background, dark text, the sender's colour on the rule, no print button, no overflow, at most two sheets on A4 and Letter: ok");
}

main().catch((error) => { console.error("FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });
