"use client";

import { useEffect, useRef } from "react";
import { PRINT_CSS, prepareForPrint, printHeading } from "@/lib/design/print-support";
import { usePageRange } from "./page-range";

// Mounted once in the app shell. Makes printing and "Save as PDF" work on every screen: before the browser prints (the Print buttons, Ctrl+P and the browser's own menu all do this) the page
// switches to the light theme and opens collapsed sections; afterwards it switches back. It also draws the heading at the top of every printed page: the screen's name, whose numbers they are,
// the dates from the date bar and the day it was printed. The heading only exists on paper. Nothing in it names the product or the platform: the sender's own name is used when one is set.
export function PrintSupport({ title, scope, brand }: { title: string; scope: string; brand: string | null }) {
  const range = usePageRange();
  const printed = useRef<HTMLParagraphElement>(null);
  const head = useRef<HTMLElement>(null);
  useEffect(() => {
    let restore: (() => void) | null = null;
    const before = () => {
      restore?.();
      // The day is written straight into the page: a state update might not be drawn before the browser prints.
      if (printed.current) printed.current.textContent = printHeading({ title: "", scope: "", range: null, brand: null, printedOn: new Date() }).lines.at(-1) ?? "";
      // A screen that prints its own heading (the audit, the Today report) says so with data-own-print-heading, and this one steps aside.
      if (head.current) head.current.style.display = document.querySelector("[data-own-print-heading]") ? "none" : "";
      restore = prepareForPrint(document);
    };
    const after = () => { restore?.(); restore = null; };
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const change = (e: MediaQueryListEvent) => (e.matches ? before() : after());
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    mq?.addEventListener?.("change", change);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); mq?.removeEventListener?.("change", change); after(); };
  }, []);
  const lines = printHeading({ title, scope, range: range.ready ? range.label : null, brand, printedOn: new Date(0) }).lines.slice(0, -1);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <header ref={head} className="mb-4 hidden border-b-2 border-black pb-2 print:block" data-testid="print-heading" aria-hidden>
        {lines.map((l, i) => <p key={i} className={i === (brand ? 1 : 0) ? "text-xl font-semibold text-black" : "text-sm text-black"}>{l}</p>)}
        <p ref={printed} className="text-sm text-black" suppressHydrationWarning />
      </header>
    </>
  );
}
