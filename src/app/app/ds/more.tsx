"use client";

import { useState, type ReactNode } from "react";

// Text diet: only the first sentence of a plain-text note is shown. The rest sits behind a small "?" that is closed until pressed, so nothing is lost.
// Built from spans so it can sit inside a paragraph without breaking the page.
export function splitFirst(text: string): { head: string; rest: string } {
  const m = text.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  return m ? { head: m[1], rest: m[2] } : { head: text, rest: "" };
}

export function More({ children, label = "What this means" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-1.5 inline-block align-middle">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="inline-flex size-5 items-center justify-center rounded-full border border-foreground/40 text-[11px] font-semibold leading-none text-foreground hover:bg-accent">?</button>
      {open && <span role="note" className="absolute left-0 top-7 z-20 block w-72 max-w-[80vw] rounded-lg border-2 bg-popover p-3 text-left text-sm font-normal leading-5 text-popover-foreground shadow-lg">{children}</span>}
    </span>
  );
}

export function Short({ text }: { text: string }) {
  const { head, rest } = splitFirst(text);
  return <>{head}{rest && <More>{rest}</More>}</>;
}
