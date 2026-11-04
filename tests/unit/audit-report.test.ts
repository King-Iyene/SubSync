import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditReport, REPORT_CSS, reportAccents } from "@/app/audit/[id]/report";
import { DrillPanel, type DrillState } from "@/app/app/ds";
import { PRINT_LIGHT_TOKENS, printAccent, printCss } from "@/lib/design/print";
import { contrast, parseHex } from "@/lib/design/color";
import { auditNotes, buildAudit, fixFirstLine, type Finding } from "@/lib/analytics/audit-intel";
import { buildSharePayload, type SharePayload } from "@/lib/analytics/share-intel";
import { DEAL_RULES_VERSION } from "@/lib/analytics/definitions";

// Stage F6 on the page a client receives and on the printed page. The report is rendered on the server to markup (no browser, no database): what it must say,
// what it must never say, and that every number points at its definition. The browser check on A4 and Letter is scripts/check-audit-print.ts and
// tests/e2e/share-print.spec.ts.
const el = h as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReturnType<typeof h>;
const html = (e: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(e);
const NAMES = ["Blue Door Realty", "Sunrise Roofing Co"];

const audit = () => buildAudit([
  { locationId: "L1", name: NAMES[0], staleValue: 90_000, staleOpps: 9, openValue: 100_000, openOpps: 10, excludedOpen: 14, unanswered: 12, winRate: 0.5, avgDealValue: 2_000, completenessPct: 80, contacts: 300, topStaleDeal: 70_000, wonCount: 10, lostCount: 10 },
  { locationId: "L2", name: NAMES[1], staleValue: 0, staleOpps: 0, openValue: 0, openOpps: 0, excludedOpen: 0, unanswered: 0, winRate: null, avgDealValue: null, completenessPct: 20, contacts: 500 },
], { readable: 2, total: 2, needPermission: 0, unmarked: 12, noShowsToRecover: 6, unconfirmed48: 0 }, { staleDays: 30, slaHours: 4 });

const payload = (extra: Parameters<typeof buildSharePayload>[4] = {}) => buildSharePayload(audit(), "Acme Marketing", NAMES, new Date("2026-11-01T10:00:00Z"), extra);
const page = (p: SharePayload) => html(el(AuditReport, { payload: p, expiresAt: new Date("2026-11-15T10:00:00Z") }));
const text = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the shared report", () => {
  it("is one client-ready page: what to fix first, the two figures apart, what we found, a fix plan, a next step, how each number is counted", () => {
    const m = page(payload({ branded: true, brandColor: "#aa3366", rulesVersion: DEAL_RULES_VERSION }));
    const t = text(m);
    for (const s of ["What to fix first", "Counted from the CRM", "Estimate, not a fact", "What we found", "One-page fix plan", "Next step", "How each number is counted", "Snapshot taken 1 Nov 2026", "This link works until 15 Nov 2026"]) expect(t).toContain(s);
    expect(t).toContain("Most likely between $");
    expect(t).toContain("Start today");
    expect(t).toContain("Ask Acme Marketing to start on step 1");
    expect(t).toContain("Deals are counted with the rules in force from 1 Nov 2026");
    // The counted figure and the estimate are in separate cards and the estimate says it is never added.
    expect(t).toMatch(/never added to the counted figure/);
  });

  it("names nobody: no client account name, no contact fields, no platform name, none of our internal words", () => {
    const m = page(payload({ branded: true }));
    const t = text(m);
    for (const n of NAMES) expect(m.toLowerCase()).not.toContain(n.toLowerCase());
    expect(t).not.toMatch(/gohighlevel|highlevel|leadconnector|\bghl\b/i);
    expect(t).not.toMatch(/\b(agenc(y|ies)|sub-?accounts?|locations?)\b/i);
    expect(m).not.toMatch(/contactId|opportunityId|conversationId/);
  });

  it("every number's note reference points at a definition that is on the page", () => {
    const m = page(payload({ branded: true }));
    const refs = [...m.matchAll(/href="#note-(\d+)"/g)].map((x) => x[1]);
    expect(refs.length).toBeGreaterThanOrEqual(4);
    for (const n of refs) expect(m, `note ${n}`).toContain(`id="note-${n}"`);
    const stated = [...m.matchAll(/id="note-(\d+)"/g)].length;
    expect(stated).toBe(payload().notes!.length);
    // The two headline figures carry a reference each.
    expect(m).toMatch(/Counted from the CRM<sup[^>]*><a href="#note-1"/);
    expect(m).toMatch(/Estimate, not a fact<sup[^>]*><a href="#note-2"/);
  });

  it("carries the sender's colour on the screen and on paper, and nothing else can reach the style", () => {
    const m = page(payload({ branded: true, brandColor: "#aa3366" }));
    const acc = reportAccents("#aa3366");
    expect(m).toContain(`--accent:${acc.screen}`);
    expect(m).toContain(`--accent-print:${acc.print}`);
    expect(contrast(parseHex(acc.print)!, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseHex(acc.screen)!, parseHex("#000c25")!)).toBeGreaterThanOrEqual(4.5);
    // No colour set: the product's own teal; an invalid one never gets through.
    expect(reportAccents(null)).toEqual({ screen: "#4db3dc", print: "#0a658b" });
    expect(reportAccents("red; background:url(x)")).toEqual({ screen: "#4db3dc", print: "#0a658b" });
    expect(page(payload({ branded: true }))).not.toContain("aa3366");
  });

  it("a sender who has set their own name carries only their brand: no sign-up link for the product; an unbranded page keeps it, and it is never printed", () => {
    const branded = page(payload({ branded: true }));
    expect(branded).not.toContain("Run your own free audit");
    expect(text(branded)).toContain("Account audit · Acme Marketing");
    const plain = page(payload({ branded: false }));
    expect(plain).toContain("Run your own free audit");
    expect(plain).toMatch(/class="no-print rp-cta"/);
    expect(text(plain)).not.toContain("Acme Marketing");
    expect(text(plain)).toContain("Start on step 1 of the fix plan");
    // An old link has no `branded` field and keeps showing the name it was made with and the sign-up link.
    const old = { ...payload(), who: "Sample real estate team (fictional data)" } as SharePayload;
    delete old.branded;
    const oldPage = page(old);
    expect(text(oldPage)).toContain("Sample real estate team (fictional data)");
    expect(oldPage).toContain("Run your own free audit");
  });

  it("prints on white with dark text, hides what is not for paper, and offers Print or save as PDF", () => {
    const m = page(payload());
    expect(m).toContain("Print or save as PDF");
    expect(m).toMatch(/class="no-print rp-print"/);
    expect(REPORT_CSS).toMatch(/@media print[\s\S]*\.audit-root\s*\{\s*background:\s*#fff !important;\s*color:\s*#111 !important/);
    expect(REPORT_CSS).toContain(".audit-root .no-print { display: none !important; }");
    expect(REPORT_CSS).toContain("@page { margin: 14mm; }");
    expect(REPORT_CSS).toMatch(/\.rp-list li \{[^}]*break-inside: avoid/);
    expect(REPORT_CSS).toContain("var(--accent-print)");
  });

  it("a report with nothing to fix says so and does not invent a plan", () => {
    const clean = buildSharePayload(buildAudit([], { readable: 1, total: 1, needPermission: 0, unmarked: 0, noShowsToRecover: 0, unconfirmed48: 0 }), "x", [], new Date("2026-11-01T00:00:00Z"), { branded: false });
    const t = text(page(clean));
    expect(t).toContain("Nothing urgent across 0 accounts");
    expect(t).not.toContain("One-page fix plan");
    expect(t).not.toContain("What we found");
    expect(t).toContain("Not enough data");
  });

  it("the sample audit's shape renders: findings that point at definitions and an estimate with a range", () => {
    const findings: Finding[] = [{ key: "slow", severity: "critical", title: "27 leads waited", detail: "", count: 27, dollars: null, kind: "fact", view: "inbox", note: "slow", window: "Customer's last message more than 1 hour ago, within the last 30 days", fix: "Own the first hour." }];
    const p = buildSharePayload({ headline: "Sample.", accountsScanned: 4, staleDollars: 412_000, estimatedDollars: 186_000, estimateRange: { low: 131_000, high: 247_000 }, leftOut: 38, findings, fixFirst: fixFirstLine({ findings }), notes: auditNotes({ findings, leftOut: 38 }, { slaHours: 1 }) }, "Sample real estate team (fictional data)", []);
    const t = text(page(p));
    expect(t).toContain("Most likely between $131,000 and $247,000");
    expect(t).toContain("38 open deals are left out of every dollar figure");
    expect(t).toContain("more than 1 hour,");
    expect(t).toContain("Counted over: Customer's last message more than 1 hour ago");
  });
});

describe("the printed in-app audit", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const root = /:root \{([\s\S]*?)\n\}/.exec(css)![1];
  const token = (name: string) => new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*(#[0-9a-fA-F]+)`).exec(root)?.[1];

  it("uses the light theme's own colours on paper (held equal to globals.css, so they cannot drift)", () => {
    for (const [name, value] of Object.entries(PRINT_LIGHT_TOKENS)) expect(token(name), name).toBe(value);
  });

  it("asks for A4 and Letter margins, light colours on the dark shell, the sender's colour as the accent, and no item split over two sheets", () => {
    const base = printCss(null);
    expect(base).toContain("@page { margin: 14mm; }");
    expect(base).toMatch(/@media print \{ \.dark, \.audit-print \{/);
    expect(base).toContain("--primary: #0a658b;");
    expect(base).toContain("break-inside: avoid");
    const branded = printCss("#aa3366");
    expect(branded).toContain(`--primary: ${printAccent("#aa3366")};`);
    expect(contrast(parseHex(printAccent("#aa3366")!)!, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(4.5);
    expect(printCss("not a colour")).toContain("--primary: #0a658b;");
    // A very light brand colour is darkened until it reads on white; a dark one is left as it is.
    expect(printAccent("#ffee00")).not.toBe("#ffee00");
    expect(printAccent("#003366")).toBe("#003366");
  });

  it("every light token has enough contrast for text on the white page", () => {
    const white = { r: 255, g: 255, b: 255 };
    for (const name of ["--foreground", "--muted-foreground", "--primary", "--destructive", "--success", "--warning"] as const) expect(contrast(parseHex(PRINT_LIGHT_TOKENS[name])!, white), name).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the in-app audit screen", () => {
  const src = readFileSync("src/app/app/views/audit.tsx", "utf8");

  it("never opens the phone's own dialer (KF-3)", () => {
    expect(src).not.toMatch(/tel:/);
  });

  it("offers the shared list behind every finding, with one button each, and says where a link leaves the app", () => {
    const parts = readFileSync("src/app/app/views/audit-parts.tsx", "utf8");
    expect(src).toContain("RecordsPanel");
    expect(src).toContain("specOf(f, data)");
    expect(parts).toContain('data-testid="audit-show"');
    expect(parts).toContain("Show ${num(f.count)}");
    expect(src + parts).not.toMatch(/>\s*Open\s*<\/(Btn|button)>/);
    expect(src + parts).not.toMatch(/gohighlevel|highlevel|leadconnector|\bGHL\b/i);
  });

  it("the list's way back is named by the page, and the chart pages keep their own wording", () => {
    const drill: DrillState = { selected: 0, open: true, select: () => undefined, close: () => undefined, reopen: () => undefined, clear: () => undefined };
    const rows = [{ id: "a", name: "Ann" }];
    const columns = [{ key: "n", header: "Name", primary: true, cell: (r: { name: string }) => r.name }];
    const common = { drill, title: "Deals that stopped moving", count: 1, noun: "deal", rows, columns, rowKey: (r: { id: string }) => r.id, toLead: (r: { id: string; name: string }) => ({ contactId: r.id, locationId: "L", name: r.name }) };
    expect(html(el(DrillPanel, { ...common, backLabel: "Back to the audit" }))).toContain("Back to the audit");
    expect(html(el(DrillPanel, common))).toContain("Back to the chart");
  });
});
