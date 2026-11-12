"use client";

import { ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Headline, HeadlineAction } from "@/lib/analytics/today-queue";
import { LeadDrawer, PopMenu, type LeadSeed, type MenuItem, type ModuleTab } from "../ds";
import { CountUp } from "../ds/count-up";
import { TagPill } from "../ds/what-is";
import type { TabTag } from "@/lib/analytics/today-tabs";

// The frame of Today, the same for every role. Top to bottom: a small title row (the page name, the date, one "More" menu), ONE plain sentence with the number that matters most,
// the one primary button, then the sections. Nothing in here counts anything; it only places things. Type roles and colours come from today-theme.css.

/** The title row: a quiet label and the date on the left, the "More" menu on the right. `filter` is the client filter chip (agency only). */
export function TodayHeader({ more, dateText, hideTitle = false }: { more: MenuItem[]; dateText?: string; hideTitle?: boolean }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden" data-testid="today-header">
      {hideTitle ? <p className="t-label mr-auto" data-testid="today-date">{dateText}</p> : <h1 className="t-label mr-auto flex items-baseline gap-3"><span className="text-[var(--t-ink)]">Today</span>{dateText && <span className="font-normal normal-case tracking-normal">{dateText}</span>}</h1>}
      <PopMenu label="More" items={more} testId="today-more"
        triggerClassName="ds-press t-small inline-flex h-8 items-center gap-1 rounded-[4px] border border-[var(--t-rule2)] px-2.5 font-medium hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]">
        More<ChevronDown aria-hidden className="size-3.5" />
      </PopMenu>
    </header>
  );
}

/** The one sentence. Numbers in it open the records they are counted from. With nothing to do it says so in words, never colour alone. */
export function TodayHeadline({ headline, onPart, action, children }: { headline: Headline; onPart?: (a: HeadlineAction) => void; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="mb-8 max-w-3xl" aria-label="Today in one sentence" data-testid="today-headline-block">
      <h2 className="t-display" data-testid="today-headline" data-clear={headline.allClear}>
        {headline.parts.map((p, n) => {
          if (!p.strong) return <span key={n}>{p.t}</span>;
          const num = <span className="text-primary"><CountUp value={p.t} /></span>;
          return onPart && p.action
            ? <button key={n} type="button" onClick={() => onPart(p.action as HeadlineAction)} data-testid={`headline-${p.action}`} title="See who and what this counts"
                className="ds-press cursor-pointer rounded-[3px] underline decoration-primary/40 decoration-[0.07em] underline-offset-[0.16em] hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{num}</button>
            : <span key={n}>{num}</span>;
        })}
      </h2>
      {headline.split && (
        <p className="t-small t-quiet mt-2" data-testid="today-split">
          {headline.split.total.toLocaleString("en-US")} ={" "}
          {onPart ? <button type="button" onClick={() => onPart("replies")} className="underline underline-offset-2 hover:text-primary">{headline.split.waiting.toLocaleString("en-US")} {headline.split.waiting === 1 ? "person who wrote is" : "people who wrote are"} waiting</button> : <span>{headline.split.waiting.toLocaleString("en-US")} waiting</span>}
          {" + "}
          {onPart ? <button type="button" onClick={() => onPart("replies")} className="underline underline-offset-2 hover:text-primary">{headline.split.never.toLocaleString("en-US")} new {headline.split.never === 1 ? "lead" : "leads"} never answered</button> : <span>{headline.split.never.toLocaleString("en-US")} new leads never answered</span>}
        </p>
      )}
      {headline.breakdown && <p className="t-small t-quiet mt-2" data-testid="today-breakdown">{headline.breakdown}</p>}
      {headline.note && <p className="t-small t-quiet mt-1" data-testid="today-outlier">{headline.note} Check it is a real deal before relying on the total.</p>}
      {action && <div className="mt-4" data-testid="today-primary">{action}</div>}
      {children}
    </section>
  );
}

/** The one filled button of the page. A link that leaves the app, or a button that stays in it. */
const PRIMARY = "ds-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-[4px] bg-primary px-5 text-[0.9375rem] font-medium text-primary-foreground hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:translate-y-px sm:h-10 sm:w-auto";
export type Primary = { label: string; sr: string; href?: string; onClick?: () => void; /** A person: the button opens them inside SubSync (the panel keeps a smaller "Open in your CRM" link). */ seed?: LeadSeed | null };
export function PrimaryButton({ p }: { p: Primary }) {
  const [open, setOpen] = useState(false);
  if (p.seed) return (<><button type="button" onClick={() => setOpen(true)} className={PRIMARY} data-testid="today-primary-button">{p.label}<span className="sr-only"> ({p.sr})</span></button>{open && <LeadDrawer leads={[p.seed]} index={0} onIndex={() => undefined} onClose={() => setOpen(false)} />}</>);
  return p.href
    ? <a href={p.href} target="_blank" rel="noopener noreferrer" className={PRIMARY} data-testid="today-primary-button">{p.label}<span className="sr-only"> ({p.sr}, opens in a new tab)</span></a>
    : <button type="button" onClick={p.onClick} className={PRIMARY} data-testid="today-primary-button">{p.label}<span className="sr-only"> ({p.sr})</span></button>;
}

/** A titled block with a hairline above it instead of a box. */
export function Block({ id, title, hint, children, testId, className = "", tag }: { id: string; title: string; hint?: ReactNode; children: ReactNode; testId?: string; className?: string; tag?: TabTag }) {
  return (
    <section className={`mb-12 border-t border-[var(--t-rule)] pt-5 ${className}`} aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="t-title">{title}{tag && <> <TagPill tag={tag} /></>}</h2>
      {hint && <p className="t-small t-quiet mt-1">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Today's own tab row: a hairline, an accent underline on the open tab, no scroll bar (the row wraps instead of scrolling), arrow keys move between tabs. */
export function TodayTabs({ tabs, value, onChange, label }: { tabs: ModuleTab[]; value: number; onChange: (i: number) => void; label: string }) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const i = Math.min(Math.max(value, 0), tabs.length - 1);
  const select = (n: number) => { onChange(n); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next !== null) { e.preventDefault(); select(next); }
  };
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-x-6 border-b border-[var(--t-rule)] print:hidden" role="tablist" aria-label={label} onKeyDown={onKey} data-testid="today-tabs">
        {tabs.map((t, n) => (
          <button key={t.label} ref={(el) => { refs.current[n] = el; }} type="button" role="tab" id={`${base}-t${n}`} aria-selected={n === i} aria-controls={`${base}-p${n}`} tabIndex={n === i ? 0 : -1}
            onClick={() => select(n)} data-testid={`today-tab-${t.label.toLowerCase()}`}
            className={`ds-press -mb-px inline-flex h-10 items-center border-b-2 text-[0.9375rem] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] ${n === i ? "border-[var(--t-accent)] font-medium text-[var(--t-ink)]" : "border-transparent text-[var(--t-ink2)] hover:text-[var(--t-ink)]"}`}>{t.label}{t.badge}</button>
        ))}
      </div>
      <div key={i} role="tabpanel" id={`${base}-p${i}`} aria-labelledby={`${base}-t${i}`} className="ds-enter" data-testid="today-tabpanel">{tabs[i].node}</div>
    </div>
  );
}

/** The detail under tabs: closed until asked for. Nothing in it is needed for the first action. */
export function MoreDetail({ open, onToggle, tab, onTab, tabs }: { open: boolean; onToggle: () => void; tab: number; onTab: (i: number) => void; tabs: ModuleTab[] }) {
  const id = "more-detail";
  return (
    <section className="mb-6 border-t border-[var(--t-rule)] pt-4" aria-label="Break it down" data-testid="more-detail" data-open={open}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} data-testid="more-detail-toggle"
        className="ds-press t-label inline-flex h-9 items-center gap-1.5 rounded-[4px] px-1 hover:text-[var(--t-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] print:hidden">
        Break it down<ChevronDown aria-hidden className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={id} className="mt-3"><TodayTabs label="Break it down" value={tab} onChange={onTab} tabs={tabs} /></div>}
    </section>
  );
}
