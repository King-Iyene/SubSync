"use client";

import { AlarmClock, CircleAlert, Clock, ExternalLink, MoreHorizontal, TriangleAlert, UserCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ageWords, money, type QueueRow, type Severity } from "@/lib/analytics/today-queue";
import { useNow } from "./live";

// The "Fix first" queue: the most valuable things to do right now, ranked by the rule in docs/METRICS.md (value at risk, then age, then severity). Every row
// has the same parts in the same places: the account and what is wrong, what is at stake, how long it has been wrong, and the buttons. State is in the FORM of the
// row (a stripe, an icon and a word), so the urgent rows are visible at a glance and colour is never the only signal.
// j and k move between rows, Enter opens the highlighted one in the CRM; every button is also reachable with Tab.
//
// Alignment rule (King, 4 Nov): every row, and every table on Today that works the same way, is a CSS grid with FIXED column tracks that all rows share, so the
// amount, the urgency, the buttons and the menu sit at the same x position on every row. The tracks are in rem and never sized by what a row happens to contain.
// On a wide container the columns run in one line; on a narrower one (a laptop with the sidebar open) the title and the amount take the first line and the same fixed
// tracks take the second. A cell a row has nothing for stays in the grid empty, so a track can never slide.

const SEVERITY: Record<Severity, { word: string; stripe: string; text: string; Icon: typeof CircleAlert }> = {
  critical: { word: "Urgent", stripe: "border-destructive", text: "text-destructive", Icon: CircleAlert },
  warning: { word: "Soon", stripe: "border-warning", text: "text-warning", Icon: TriangleAlert },
  info: { word: "When you can", stripe: "border-border", text: "text-muted-foreground", Icon: Clock },
};

/** What is at stake, in words: counted dollars, the existing estimate (labelled), or the count. */
export function stakeOf(r: Pick<QueueRow, "dollars" | "estimate" | "count" | "kind" | "partial">): { main: string; sub: string | null } {
  const n = r.count.toLocaleString("en-US");
  if (r.dollars) return { main: money(r.dollars), sub: `${n} ${r.count === 1 ? "deal" : "deals"}` };
  if (r.estimate) return { main: n, sub: `about ${money(r.estimate)} (estimate)` };
  return { main: n, sub: r.partial ? "first ones only" : r.kind === "leads" ? (r.count === 1 ? "lead" : "leads") : null };
}

const primary = "ds-press inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:translate-y-px";
const quiet = "ds-press inline-flex min-h-9 w-full items-center justify-center rounded-lg px-2 text-sm text-muted-foreground underline-offset-4 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";
const outline = "ds-press inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-lg border bg-card px-2 text-sm font-medium hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";

// Tracks (identical on every row): title and reason | amount | urgency | Open in CRM | Show | Done | menu.
const WIDE = "@4xl:grid-cols-[minmax(0,1fr)_8rem_9rem_9.5rem_4.5rem_5rem_3rem]";
const NARROW_SECOND = "col-span-2 grid grid-cols-[9rem_9.5rem_4.5rem_5rem_3rem] items-center gap-x-2 @4xl:contents";

export type RowAction = "done" | "snooze_day" | "snooze_monday" | "assign";
export type RowWhy = { key: string; text: string; onOpen: () => void };

export function QueueRowView({ row, now, active, onShow, single = false, assignedTo = null, why = [], onAct, canAssign = false, busy = false }: {
  row: QueueRow; now: number; active: boolean; onShow: (r: QueueRow) => void; single?: boolean; assignedTo?: string | null; why?: RowWhy[];
  /** Done, Snooze and Assign are SubSync-side marks. Without this the row has only Open in CRM and Show. */
  onAct?: (r: QueueRow, a: RowAction) => void; canAssign?: boolean; busy?: boolean;
}) {
  const s = SEVERITY[row.severity];
  const stake = stakeOf(row);
  const age = row.since === null ? null : ageWords(Math.max(0, (now - row.since) / 60_000));
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [menu]);
  const items = `${row.count.toLocaleString("en-US")} ${row.count === 1 ? "item" : "items"}`;
  return (
    <li id={`queue-${row.key}`} data-testid="queue-row" data-kind={row.kind} data-severity={row.severity} aria-current={active ? "true" : undefined}
      className={`ds-row grid grid-cols-[minmax(0,1fr)_8rem] items-start gap-x-3 gap-y-2 border-l-[3px] py-3 pl-4 pr-2 ${WIDE} ${s.stripe} ${active ? "bg-accent/50 outline outline-2 -outline-offset-2 outline-[var(--ring)]" : ""}`}>
      <div className="min-w-0" data-col="title">
        {single ? <p className="break-words font-semibold">{row.text}</p> : <><p className="break-words font-semibold">{row.accountName}</p>
        <p className="mt-0.5 break-words text-sm text-muted-foreground">{row.text}</p></>}
        {assignedTo && <p className="mt-1 text-xs font-medium text-muted-foreground" data-testid="queue-assigned">Assigned to {assignedTo}</p>}
        {why.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground" data-testid="queue-why">
            <span className="font-medium">What they share:</span>
            {why.map((w, n) => <span key={w.key}>{n > 0 && <span aria-hidden>, </span>}<button type="button" onClick={w.onOpen} className="rounded px-0.5 underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="queue-why-item">{w.text}</button></span>)}
          </p>
        )}
      </div>
      <div className="tnum text-right" data-col="amount">
        <button type="button" onClick={() => onShow(row)} aria-label={`${stake.main}${stake.sub ? `, ${stake.sub}` : ""}. Show the ${items} behind it.`} data-testid="queue-amount"
          className="ds-press w-full rounded-lg px-1 py-0.5 text-right hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
          <span className="block text-lg font-semibold leading-6">{stake.main}</span>
          {stake.sub && <span className="block break-words text-xs text-muted-foreground">{stake.sub}</span>}
        </button>
      </div>
      <div className={NARROW_SECOND}>
        <div className="min-w-0 text-sm" data-col="urgency">
          <p className={`flex items-center gap-1.5 font-medium ${s.text}`}><s.Icon aria-hidden className="size-4 shrink-0" />{s.word}</p>
          {age && <p className="text-xs text-muted-foreground">Wrong for {age}</p>}
        </div>
        <div data-col="crm"><a href={row.url} target="_blank" rel="noopener noreferrer" className={primary} data-testid="queue-open">Open in CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({row.accountName}, opens in a new tab)</span></a></div>
        <div data-col="show"><button type="button" onClick={() => onShow(row)} className={quiet} data-testid="queue-show" aria-label={`Show the ${items} behind this row`}>Show</button></div>
        <div data-col="done">{onAct ? <button type="button" onClick={() => onAct(row, "done")} disabled={busy} className={outline} data-testid="queue-done" aria-label={`Mark done: ${row.accountName}, ${row.text}`}>Done</button> : null}</div>
        <div className="relative" data-col="more" ref={menuRef}>
          {onAct ? (
            <>
              <button type="button" aria-label="Snooze or assign" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={busy} data-testid="queue-more" className={`${outline} px-0`}><MoreHorizontal aria-hidden className="size-4" /></button>
              {menu && (
                <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border bg-popover p-1.5 text-sm shadow-[var(--shadow-lift)]" data-testid="queue-menu">
                  <button type="button" role="menuitem" data-testid="queue-snooze-day" onClick={() => { setMenu(false); onAct(row, "snooze_day"); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"><AlarmClock aria-hidden className="size-4 text-muted-foreground" />Snooze 1 day</button>
                  <button type="button" role="menuitem" data-testid="queue-snooze-monday" onClick={() => { setMenu(false); onAct(row, "snooze_monday"); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"><AlarmClock aria-hidden className="size-4 text-muted-foreground" />Snooze until Monday</button>
                  {canAssign && <button type="button" role="menuitem" data-testid="queue-assign" onClick={() => { setMenu(false); onAct(row, "assign"); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"><UserCheck aria-hidden className="size-4 text-muted-foreground" />Assign to me</button>}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** The column names above the rows, on a wide container only. They line up with the rows because both use the same tracks. */
function QueueHeader({ actions }: { actions: boolean }) {
  return (
    <li aria-hidden className={`hidden gap-x-3 border-l-[3px] border-transparent py-1.5 pl-4 pr-2 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @4xl:grid ${WIDE}`} data-testid="queue-header">
      <span>What is wrong</span><span className="text-right">At stake</span><span>How urgent</span><span>Go to it</span><span>Records</span><span>{actions ? "Set aside" : ""}</span><span />
    </li>
  );
}

export function FixFirstQueue({ rows, max = 7, onShow, empty, title = "Fix first", hint, single = false, assigned = {}, whyOf, onAct, canAssign = false, busyKey = null, footer }: {
  rows: QueueRow[]; max?: number; onShow: (r: QueueRow) => void; empty: string; title?: string; hint?: string; /** One account only: the row leads with what is wrong, not the account name. */ single?: boolean;
  assigned?: Record<string, string | null>; whyOf?: (r: QueueRow) => RowWhy[]; onAct?: (r: QueueRow, a: RowAction) => void; canAssign?: boolean; busyKey?: string | null; footer?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const [at, setAt] = useState(0);
  const now = useNow();
  const shown = all ? rows.slice(0, 50) : rows.slice(0, max);
  const active = Math.min(at, Math.max(0, shown.length - 1));
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || shown.length === 0) return;
      if (document.querySelector("[data-testid=records-panel]")) return;
      if (e.key === "j") setAt((n) => Math.min(shown.length - 1, n + 1));
      else if (e.key === "k") setAt((n) => Math.max(0, n - 1));
      else if (e.key === "Enter" && !el?.closest("a,button,summary,[role=tab]")) { const r = shown[active]; if (r) window.open(r.url, "_blank", "noopener,noreferrer"); }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [shown, active]);
  useEffect(() => { document.getElementById(`queue-${shown[active]?.key}`)?.scrollIntoView({ block: "nearest" }); }, [active, shown]);
  return (
    <section className="mb-9" aria-labelledby="fix-first-h" data-testid="fix-first">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id="fix-first-h" className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint ?? "Ranked by money at stake, then by how long it has been wrong. Press j and k to move, Enter to open."}</p>
        </div>
        <div className="flex items-center gap-2">
          {footer}
          {rows.length > max && <button type="button" onClick={() => setAll(!all)} className="ds-press min-h-9 rounded-lg px-2.5 text-sm text-muted-foreground underline-offset-4 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="queue-all">{all ? `Show the top ${max}` : `See all ${rows.length}`}</button>}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="border-y py-6 text-center text-sm text-muted-foreground" data-testid="queue-empty">{empty}</p>
      ) : (
        <ul className="@container divide-y border-y" data-testid="queue-list">
          <QueueHeader actions={!!onAct} />
          {shown.map((r, n) => <QueueRowView key={r.key} row={r} now={now} active={n === active} onShow={onShow} single={single} assignedTo={assigned[r.key] ?? null} why={whyOf?.(r) ?? []} onAct={onAct} canAssign={canAssign} busy={busyKey === r.key} />)}
        </ul>
      )}
      {rows.length > shown.length && <p className="mt-2 text-xs text-muted-foreground">Showing {shown.length} of {rows.length}.{!all && " The rest follow in the same order."}</p>}
    </section>
  );
}
