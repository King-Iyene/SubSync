"use client";

import { ArrowLeft } from "lucide-react";
import { Short } from "./more";
import { createContext, useContext, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// ---- the page template ----
// Every page is: a back link when it was opened from another page, one title, one short sentence, its actions, an optional row of tabs (the module
// sub-navigation), then about six blocks (UX-09, N36). The status line and the filter bar are drawn by the shell, once, above the page.
// A subtitle longer than this is a paragraph in disguise (UX-10): put the detail in a Section hint or a definition tip instead.
export const SUBTITLE_MAX = 120;

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="page" className="ds-enter">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b-2 pb-5">
        <div className="min-w-0">
          <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-2xl text-base leading-6 text-muted-foreground" data-testid="page-subtitle"><Short text={subtitle} /></p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

// A group of content under one heading, separated by space and a thin rule instead of a box (fewer cards, N10). `hint` is the one line that says what
// the block is for.
export function Section({ title, hint, action, children, id, className = "" }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`mb-8 ${className}`} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id ? `${id}-h` : undefined} className="text-lg font-bold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted-foreground">{typeof hint === "string" ? <Short text={hint} /> : hint}</p>}
        </div>
        {action && <div className="print:hidden">{action}</div>}
      </div>
      {children}
    </section>
  );
}

// ---- back with context (N7) ----
export type BackTarget = { label: string; go: () => void } | null;
const BackContext = createContext<BackTarget>(null);
export const BackProvider = BackContext.Provider;
export const useBack = () => useContext(BackContext);

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid="back-link" className="mb-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg pr-2 text-sm text-muted-foreground hover:text-foreground print:hidden">
      <ArrowLeft aria-hidden className="size-4" />Back to {label}
    </button>
  );
}

// ---- the module sub-navigation ----
// One pattern for every module: a short row of tabs, each a short view. Arrow keys move between tabs. On a phone the row scrolls sideways on its own,
// never the page. Pass `value` and `onChange` to control it from outside, or just `start` to let it keep its own place.
export type ModuleTab = { id?: string; label: string; node: ReactNode; badge?: ReactNode };

export function ModuleTabs({ tabs, start = 0, value, onChange, label = "Sections of this page" }: { tabs: ModuleTab[]; start?: number; value?: number; onChange?: (i: number) => void; label?: string }) {
  const [own, setOwn] = useState(start);
  const i = Math.min(Math.max(value ?? own, 0), tabs.length - 1);
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (n: number) => { setOwn(n); onChange?.(n); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next !== null) { e.preventDefault(); select(next); }
  };
  return (
    <div>
      <div className="mb-5 max-w-full overflow-x-auto border-b print:hidden"><div className="flex min-w-max gap-5" role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, n) => (
          <button key={t.label} ref={(el) => { refs.current[n] = el; }} type="button" role="tab" id={`${base}-t${n}`} aria-selected={n === i} aria-controls={`${base}-p${n}`} tabIndex={n === i ? 0 : -1} onClick={() => select(n)}
            className={`-mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 py-2 text-sm transition-colors ${n === i ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t.label}{t.badge}</button>
        ))}
      </div></div>
      <div key={i} role="tabpanel" id={`${base}-p${i}`} aria-labelledby={`${base}-t${i}`} className="ds-enter">{tabs[i].node}</div>
    </div>
  );
}
