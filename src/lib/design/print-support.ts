// Printing and "Save as PDF" of any screen in the app (pure, so it is unit tested without a browser).
//
// Why a printed screen used to come out blank: the app is a dark single page app. A browser drops background colours when it prints but KEEPS text colours, so the dark theme's
// near-white text landed on white paper. Every page "printed" as blank sheets of invisible text. The fix has two parts. (1) Just before the browser prints, the page switches to the light theme and
// opens every collapsed section (`prepareForPrint`), and switches back afterwards. (2) A print stylesheet (`PRINT_CSS`) lets the content flow over as many sheets as it needs: it hides the
// navigation, filters and buttons, un-clips scroll boxes, keeps rows and charts whole, and keeps the colours of charts.

/** The parts of an element that `prepareForPrint` touches (a real element has them all; a test passes a small stand-in). */
export type PrintElement = {
  classList: { add(c: string): void; remove(c: string): void };
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
  open?: boolean;
};
export type PrintDocument = { querySelectorAll(sel: string): ArrayLike<PrintElement> };

/** Switches the page to the light theme and opens every collapsed section. Returns the function that puts everything back. */
export function prepareForPrint(doc: PrintDocument): () => void {
  const undo: Array<() => void> = [];
  for (const el of Array.from(doc.querySelectorAll(".dark"))) { el.classList.remove("dark"); undo.push(() => el.classList.add("dark")); }
  for (const el of Array.from(doc.querySelectorAll('[data-theme="dark"]'))) { el.setAttribute("data-theme", "light"); undo.push(() => el.setAttribute("data-theme", "dark")); }
  for (const el of Array.from(doc.querySelectorAll("details"))) { if (el.open === false) { el.open = true; undo.push(() => { el.open = false; }); } }
  let done = false;
  return () => { if (done) return; done = true; for (const u of undo.reverse()) u(); };
}

/** The stylesheet for paper. Every rule is inside @media print, so the screen is never changed. */
export const PRINT_CSS = `
@page { margin: 14mm; }
@media print {
  html, body { background: #ffffff !important; color: #141311 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body { display: block !important; }
  .min-h-screen, .h-screen { min-height: 0 !important; height: auto !important; }
  main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
  [data-noprint], .fixed, [role="dialog"], [aria-modal="true"] { display: none !important; }
  .overflow-auto, .overflow-y-auto, .overflow-x-auto, .overflow-scroll, .overflow-y-scroll, .overflow-x-scroll, [class*="max-h-"] { overflow: visible !important; max-height: none !important; height: auto !important; }
  * { animation: none !important; transition: none !important; content-visibility: visible !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  thead { display: table-header-group; }
  tr, li, svg, img, figure, [data-print-keep] { break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; }
  svg, img, canvas { max-width: 100% !important; }
}
`;

/** The words at the top of a printed page. */
export function printHeading(i: { title: string; scope: string; range: string | null; brand: string | null; printedOn: Date }): { lines: string[] } {
  const day = i.printedOn.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return { lines: [i.brand ?? "", i.title, [i.scope, i.range].filter(Boolean).join(", "), `Printed ${day}`].filter(Boolean) };
}
