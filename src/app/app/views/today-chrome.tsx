"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PopMenu, type MenuItem, ModuleTabs, type ModuleTab } from "../ds";

// The frame of Today, the same for every role: ONE slim header row (the title, the client-account filter that names its accounts, and one "More" menu that holds everything that is
// not the first action), the one primary button, and a "More detail" block that is closed until it is asked for. Nothing in here counts anything; it only places things.

/** The title row. `filter` is the client-account filter and its "Showing ..." chip (agency only); `more` is the menu items. */
export function TodayHeader({ filter, more }: { filter?: ReactNode; more: MenuItem[] }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden" data-testid="today-header">
      <h1 className="mr-auto text-[1.65rem] font-semibold leading-tight tracking-tight">Today</h1>
      {/* On a phone the title and More are one row, and the client-account filter is the row under it. */}
      {filter && <div className="order-3 w-full sm:order-none sm:w-auto">{filter}</div>}
      <PopMenu label="More" items={more} testId="today-more"
        triggerClassName="ds-press inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm font-medium hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]">
        More<ChevronDown aria-hidden className="size-3.5" />
      </PopMenu>
    </header>
  );
}

/** The one filled button of the page. A link that leaves the app, or a button that stays in it. */
const PRIMARY = "ds-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:translate-y-px sm:h-10 sm:w-auto";
export type Primary = { label: string; sr: string; href?: string; onClick?: () => void };
export function PrimaryButton({ p }: { p: Primary }) {
  return p.href
    ? <a href={p.href} target="_blank" rel="noopener noreferrer" className={PRIMARY} data-testid="today-primary-button">{p.label}<span className="sr-only"> ({p.sr}, opens in a new tab)</span></a>
    : <button type="button" onClick={p.onClick} className={PRIMARY} data-testid="today-primary-button">{p.label}<span className="sr-only"> ({p.sr})</span></button>;
}

/** "More detail": closed until asked for, then the numbers, the people and the rest in tabs. Nothing in it is needed for the first action. */
export function MoreDetail({ open, onToggle, tab, onTab, tabs }: { open: boolean; onToggle: () => void; tab: number; onTab: (i: number) => void; tabs: ModuleTab[] }) {
  const [id] = useState(() => "more-detail");
  return (
    <section className="mb-4 border-t pt-4" aria-label="More detail" data-testid="more-detail" data-open={open}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} data-testid="more-detail-toggle"
        className="ds-press inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] print:hidden">
        More detail<ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={id} className="mt-3"><ModuleTabs label="More detail" value={tab} onChange={onTab} tabs={tabs} /></div>}
    </section>
  );
}
