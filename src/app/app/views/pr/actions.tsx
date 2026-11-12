"use client";

import { useState } from "react";

// Print or save as PDF, and copy the report as plain text. These are the only scripts on the client's page. Neither is printed. The browser's own print dialog makes the PDF.
export function printReport() {
  const root = document.documentElement;
  root.setAttribute("data-pr-printing", "");
  const done = () => { root.removeAttribute("data-pr-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
  // Some browsers do not fire afterprint; the attribute is harmless on screen, but clear it anyway shortly after the dialog returns.
  setTimeout(done, 1500);
}

export function ReportActions({ text, extra }: { text: string; extra?: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <div className="pr-actions pr-noprint" role="group" aria-label="Report actions">
      <button type="button" className="pr-btn" data-kind="primary" onClick={() => window.print()} data-testid="pr-print">Download or print (PDF)</button>
      <button type="button" className="pr-btn" onClick={copy} data-testid="pr-copy">{state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy as text"}</button>
      {extra}
    </div>
  );
}
