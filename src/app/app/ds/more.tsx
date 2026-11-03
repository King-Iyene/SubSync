"use client";

import type { ReactNode } from "react";

// Text diet: only the first sentence of a plain-text note is shown. The rest sits behind a small "?" that is closed until opened, so nothing is lost.
export function splitFirst(text: string): { head: string; rest: string } {
  const m = text.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  return m ? { head: m[1], rest: m[2] } : { head: text, rest: "" };
}
export function More({ children, label = "More" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group relative ml-1.5 inline-block align-middle">
      <summary aria-label={label} title={label} className="inline-flex size-5 cursor-pointer list-none items-center justify-center rounded-full border border-foreground/40 text-[11px] font-semibold leading-none text-foreground hover:bg-accent [&::-webkit-details-marker]:hidden">?</summary>
      <div className="absolute left-0 top-7 z-20 w-72 max-w-[80vw] rounded-lg border-2 bg-popover p-3 text-sm font-normal leading-5 text-popover-foreground shadow-lg">{children}</div>
    </details>
  );
}
export function Short({ text }: { text: string }) {
  const { head, rest } = splitFirst(text);
  return <>{head}{rest && <More label="How this is counted">{rest}</More>}</>;
}

