"use client";

import { useId, useState } from "react";

/** A small "i" that explains something in one or two sentences, on hover, keyboard focus or a tap. Replaces explanatory paragraphs so the panel stays calm. */
export function InfoTip({ text, label = "More information", className = "", testId }: { text: string; label?: string; className?: string; testId?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`group/tip relative inline-flex align-middle ${className}`}>
      <button type="button" aria-label={label} aria-describedby={id} aria-expanded={open} onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full border text-[11px] font-semibold leading-none text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid={testId}>i</button>
      <span id={id} role="tooltip" data-open={open} className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-1.5 w-64 max-w-[80vw] -translate-x-1/2 rounded-md border bg-popover p-2.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100 data-[open=true]:visible data-[open=true]:opacity-100">{text}</span>
    </span>
  );
}
