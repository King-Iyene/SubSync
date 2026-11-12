"use client";

import { ArrowLeft } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// ---- the page template ----
// Every page is: a back link when it was opened from another page, one title, one short sentence, its actions, an optional row of tabs (the module
// sub-navigation), then about six blocks (UX-09, N36). The status line and the filter bar are drawn by the shell, once, above the page.
// A subtitle longer than this is a paragraph in disguise (UX-10): put the detail in a Section hint or a definition tip instead.
export const SUBTITLE_MAX = 120;

// "Section > Page": the shell says which section the open page belongs to (null on a top-level page), so a person always sees where they are.
const TrailContext = createContext<string | null>(null);
export const TrailProvider = TrailContext.Provider;

export function PageTrail({ title }: { title: string }) {
  const section = useContext(TrailContext);
  if (!section || section === title) return null;
  return <p data-testid="trail" className="mb-1 text-xs font-medium text-muted-foreground">{section} <span aria-hidden>&gt;</span><span className="sr-only">then</span> {title}</p>;
}

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid="page" className="ds-enter">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-5">
        <div className="min-w-0">
          
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 line-clamp-3 max-w-2xl sm:line-clamp-2 text-sm leading-6 text-muted-foreground" data-testid="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

// A group of content under one heading, separated by space and a thin rule instead of a box (fewer cards, N10). `hint` is the one line that says what
// the block is for.
export function Section({ title, hint, action, children, id, className = "", level = 2 }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode; id?: string; className?: string; /** Heading level: 3 when the block sits inside another section (for example inside a Settings section). */ level?: 2 | 3 }) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section id={id} className={`mb-8 ${className}`} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <Heading id={id ? `${id}-h` : undefined} className="text-base font-semibold">{title}</Heading>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
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
export type ModuleTab = { id?: string; label: string; /** A hover tip (shown by the page's tip host). */ tip?: string; node: ReactNode; badge?: ReactNode; /** Pill style only: a small icon before the label. */ icon?: ReactNode };

export function ModuleTabs({ tabs, start = 0, value, onChange, label = "Sections of this page", pill = false }: { tabs: ModuleTab[]; start?: number; value?: number; onChange?: (i: number) => void; label?: string; /** A bright segmented bar (Speed to lead) instead of the plain underline row. */ pill?: boolean }) {
  const [own, setOwn] = useState(start);
  const i = Math.min(Math.max(value ?? own, 0), tabs.length - 1);
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // On a phone the row of tabs scrolls inside itself; the open tab is brought into view so a link that opens a far tab never leaves it hidden.
  useEffect(() => { if (pill) refs.current[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [i, pill]);
  const select = (n: number) => { setOwn(n); onChange?.(n); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next !== null) { e.preventDefault(); select(next); }
  };
  return (
    <div>
      <div className={pill ? "spd-tabs mb-5 max-w-full overflow-x-auto py-1 print:hidden" : "mb-5 max-w-full overflow-x-auto border-b print:hidden"}><div className={pill ? "flex min-w-max gap-1.5 rounded-xl border bg-card/60 p-1.5" : "flex min-w-max gap-5"} role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((t, n) => (
          <button key={t.label} ref={(el) => { refs.current[n] = el; }} type="button" role="tab" id={`${base}-t${n}`} aria-selected={n === i} data-tip={t.tip} aria-controls={`${base}-p${n}`} tabIndex={n === i ? 0 : -1} onClick={() => select(n)}
            className={pill ? "spd-tab ds-press inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" : `-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 py-2 text-sm transition-colors ${n === i ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{pill && t.icon}{t.label}{t.badge}</button>
        ))}
      </div></div>
      <div key={i} role="tabpanel" id={`${base}-p${i}`} aria-labelledby={`${base}-t${i}`} className="ds-enter">{tabs[i].node}</div>
    </div>
  );
}
