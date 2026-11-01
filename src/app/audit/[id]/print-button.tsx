"use client";

// Print or save as PDF. It is the only script on the shared page, and it is not printed.
export function PrintButton() {
  return <button type="button" className="no-print rp-print" onClick={() => window.print()}>Print or save as PDF</button>;
}
