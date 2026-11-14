import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PRINT_CSS, prepareForPrint, printHeading, type PrintDocument, type PrintElement } from "../design/print-support.ts";

// The blank-page bug: printing the dark app produced sheets of near-white text on white paper. These tests hold the fix in place: the light theme is applied for print and put back, collapsed
// sections open, and the print stylesheet never hides the report itself or clips it.
const root = process.cwd();
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

function el(init: { classes?: string[]; theme?: string; open?: boolean } = {}): PrintElement & { classes: Set<string>; theme: string | null } {
  const classes = new Set(init.classes ?? []);
  let theme: string | null = init.theme ?? null;
  const e = {
    classes,
    get theme() { return theme; },
    classList: { add: (c: string) => { classes.add(c); }, remove: (c: string) => { classes.delete(c); } },
    getAttribute: () => theme,
    setAttribute: (_n: string, v: string) => { theme = v; },
    open: init.open,
  };
  return e as never;
}

test("before printing the page goes light and sections open; afterwards everything is put back, once", () => {
  const shell = el({ classes: ["dark", "flex"], theme: "dark" });
  const portal = el({ theme: "dark" });
  const closed = el({ open: false }), opened = el({ open: true });
  const doc: PrintDocument = { querySelectorAll: (sel) => (sel === ".dark" ? [shell] : sel === '[data-theme="dark"]' ? [shell, portal] : sel === "details" ? [closed, opened] : []) };
  const restore = prepareForPrint(doc);
  assert.equal(shell.classes.has("dark"), false, "the dark class is gone while printing");
  assert.equal(shell.theme, "light");
  assert.equal(portal.theme, "light", "a dialog or portal outside the shell goes light too");
  assert.equal(closed.open, true, "a collapsed section prints open");
  assert.equal(opened.open, true);
  restore();
  assert.equal(shell.classes.has("dark"), true);
  assert.equal(shell.theme, "dark");
  assert.equal(portal.theme, "dark");
  assert.equal(closed.open, false, "the section is closed again");
  assert.equal(opened.open, true, "one that was already open stays open");
  restore(); // a second call changes nothing
  assert.equal(shell.theme, "dark");
});

test("a page that is already light is left alone", () => {
  const e = el({ theme: "light" });
  const doc: PrintDocument = { querySelectorAll: () => [] };
  prepareForPrint(doc)();
  assert.equal(e.theme, "light");
});

test("the print stylesheet lives inside @media print and never hides or clips the report", () => {
  const body = PRINT_CSS.replace(/@page[^}]*}/, "");
  assert.ok(/^\s*@media print \{/.test(body), "every rule is inside @media print");
  // every rule that hides something: what is hidden must not be the page, the main content, an article or a section
  for (const m of PRINT_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, sel, decl] = m;
    if (/display:\s*none/.test(decl)) {
      assert.ok(!/(^|[\s,])(html|body|main|article|section|#root|#__next)([\s,.:\[]|$)/.test(sel.replace(/@media print/, "")), `must not hide the report: ${sel.trim()}`);
    }
    assert.ok(!/overflow:\s*hidden/.test(decl), `must not clip content: ${sel.trim()}`);
  }
  assert.match(PRINT_CSS, /\.overflow-auto[^{]*\{[^}]*overflow:\s*visible\s*!important[^}]*max-height:\s*none/, "scroll boxes are opened up");
  assert.match(PRINT_CSS, /background:\s*#ffffff\s*!important/, "white paper");
  assert.match(PRINT_CSS, /print-color-adjust:\s*exact/, "chart colours are kept");
  assert.match(PRINT_CSS, /thead\s*\{\s*display:\s*table-header-group/, "a table's header repeats on every sheet");
  assert.match(PRINT_CSS, /tr[^{]*\{\s*break-inside:\s*avoid/, "a table row is never cut");
});

test("the app shell prints through PrintSupport, and the printed reports are never written in a pale colour", () => {
  assert.match(read("src", "app", "app", "dashboard.tsx"), /<PrintSupport /, "the shell mounts the print support once");
  const support = read("src", "app", "app", "ds", "print-support.tsx");
  assert.match(support, /addEventListener\("beforeprint"/);
  assert.match(support, /addEventListener\("afterprint"/);
  assert.match(read("src", "app", "app", "ds", "print-report.tsx"), /text-black print:block/, "the Today report is black on white");
  const shared = read("src", "app", "r", "[id]", "report.tsx");
  assert.match(shared, /\.sr-root \{ background: #ffffff; color: #1d1c19/, "the shared report is dark text on white by default");
  assert.ok(!/overflow:\s*hidden/.test(shared), "the shared report clips nothing");
  assert.match(shared, /@media print \{[\s\S]*\.no-print \{ display: none/, "only the buttons are left out of print");
  assert.ok(!/@media print \{[^}]*\.sr-(root|sec|wrap|table)[^}]*display:\s*none/.test(shared), "no part of the report is hidden in print");
});

test("every Print button of a report screen reaches the browser's print, so the same fix applies", () => {
  const share = read("src", "app", "app", "ds", "share-report.tsx");
  assert.match(share, /window\.print\(\)/);
  for (const f of [["views", "clients", "reports-tab.tsx"], ["views", "td3", "module.tsx"], ["views", "today-page.tsx"], ["views", "audit.tsx"]]) {
    assert.match(read("src", "app", "app", ...f), /PrintPdfButton/, `${f.join("/")} has the visible Download PDF / Print button`);
  }
});

test("the printed heading is the screen, whose numbers they are, the dates and the day, and names no vendor", () => {
  const h = printHeading({ title: "Speed to lead", scope: "All client accounts", range: "Last 30 days, 15 Oct to 13 Nov", brand: "Acme Marketing", printedOn: new Date("2026-11-13T09:00:00Z") });
  assert.deepEqual(h.lines, ["Acme Marketing", "Speed to lead", "All client accounts, Last 30 days, 15 Oct to 13 Nov", "Printed 13 November 2026"]);
  const none = printHeading({ title: "Today", scope: "Your account", range: null, brand: null, printedOn: new Date("2026-11-13T09:00:00Z") });
  assert.deepEqual(none.lines, ["Today", "Your account", "Printed 13 November 2026"]);
  assert.ok(!/subsync|gohighlevel|highlevel|ghl|leadconnector/i.test(JSON.stringify([h, none, PRINT_CSS])));
  assert.ok(!/subsync|gohighlevel|highlevel|ghl|leadconnector/i.test(read("src", "app", "r", "[id]", "report.tsx").replace(/shared report/gi, "")), "the shared page names no vendor");
});
