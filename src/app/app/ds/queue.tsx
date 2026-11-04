"use client";

import { CircleAlert, ExternalLink, TriangleAlert, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { ageWords, money, type Kind, type QueueRow, type Severity } from "@/lib/analytics/today-queue";
import { useNow } from "./live";

// The "Fix first" queue: the most valuable things to do right now, ranked by the rule in docs/METRICS.md (value at risk, then age, then severity). Every row
// has the same four parts in the same places: the account and what is wrong, what is at stake, how long it has been wrong, and one main button. State is in
// the FORM of the row (a stripe, an icon and a word), so the urgent rows are visible at a glance and colour is never the only signal.
// j and k move between rows, Enter opens the highlighted one in the CRM; the same two buttons are reachable with Tab.

const SEVERITY: Record<Severity, { word: string; stripe: string; text: string; Icon: typeof CircleAlert }> = {
  critical: { word: "Urgent", stripe: "border-destructive", text: "text-destructive", Icon: CircleAlert },
  warning: { word: "Soon", stripe: "border-warning", text: "text-warning", Icon: TriangleAlert },
  info: { word: "When you can", stripe: "border-border", text: "text-muted-foreground", Icon: Clock },
};
const SHOW: Record<Kind, string> = { leads: "Show the leads", appointments: "Show the appointments", noshows: "Show the no-shows", stale: "Show the deals", unanswered: "Show the conversations" };

/** What is at stake, in words: counted dollars, the existing estimate (labelled), or the count. */
export function stakeOf(r: Pick<QueueRow, "dollars" | "estimate" | "count" | "kind" | "partial">): { main: string; sub: string | null } {
  const n = r.count.toLocaleString("en-US");
  if (r.dollars) return { main: money(r.dollars), sub: `${n} ${r.count === 1 ? "deal" : "deals"}` };
  if (r.estimate) return { main: n, sub: `about ${money(r.estimate)} (estimate)` };
  return { main: n, sub: r.partial ? "first ones only" : r.kind === "leads" ? (r.count === 1 ? "lead" : "leads") : null };
}

const primary = "ds-press inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:translate-y-px";
const quiet = "ds-press min-h-9 rounded-lg px-2.5 text-sm text-muted-foreground underline-offset-4 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";

export function QueueRowView({ row, now, active, onShow, single = false }: { row: QueueRow; now: number; active: boolean; onShow: (r: QueueRow) => void; single?: boolean }) {
  const s = SEVERITY[row.severity];
  const stake = stakeOf(row);
  const age = row.since === null ? null : ageWords(Math.max(0, (now - row.since) / 60_000));
  return (
    <li id={`queue-${row.key}`} data-testid="queue-row" data-kind={row.kind} data-severity={row.severity} aria-current={active ? "true" : undefined}
      className={`ds-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-l-[3px] py-3 pl-4 pr-2 @4xl:grid-cols-[minmax(0,1fr)_8.5rem_9rem_auto] ${s.stripe} ${active ? "bg-accent/50 outline outline-2 -outline-offset-2 outline-[var(--ring)]" : ""}`}>
      <div className="min-w-0">
        {single ? <p className="break-words font-semibold">{row.text}</p> : <><p className="break-words font-semibold">{row.accountName}</p>
        <p className="mt-0.5 break-words text-sm text-muted-foreground">{row.text}</p></>}
      </div>
      <div className="tnum text-right">
        <p className="text-lg font-semibold leading-6">{stake.main}</p>
        {stake.sub && <p className="text-xs text-muted-foreground">{stake.sub}</p>}
      </div>
      <div className="min-w-0 text-sm">
        <p className={`flex items-center gap-1.5 font-medium ${s.text}`}><s.Icon aria-hidden className="size-4 shrink-0" />{s.word}</p>
        {age && <p className="text-xs text-muted-foreground">Wrong for {age}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
        <a href={row.url} target="_blank" rel="noopener noreferrer" className={primary} data-testid="queue-open">Open in CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({row.accountName}, opens in a new tab)</span></a>
        <button type="button" onClick={() => onShow(row)} className={quiet} data-testid="queue-show">{SHOW[row.kind]}</button>
      </div>
    </li>
  );
}

export function FixFirstQueue({ rows, max = 7, onShow, empty, title = "Fix first", hint, single = false }: {
  rows: QueueRow[]; max?: number; onShow: (r: QueueRow) => void; empty: string; title?: string; hint?: string; /** One account only: the row leads with what is wrong, not the account name. */ single?: boolean;
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
        {rows.length > max && <button type="button" onClick={() => setAll(!all)} className={`${quiet} -mr-2`} data-testid="queue-all">{all ? `Show the top ${max}` : `See all ${rows.length}`}</button>}
      </div>
      {rows.length === 0 ? (
        <p className="border-y py-6 text-center text-sm text-muted-foreground" data-testid="queue-empty">{empty}</p>
      ) : (
        <ul className="@container divide-y border-y" data-testid="queue-list">
          {shown.map((r, n) => <QueueRowView key={r.key} row={r} now={now} active={n === active} onShow={onShow} single={single} />)}
        </ul>
      )}
      {rows.length > shown.length && <p className="mt-2 text-xs text-muted-foreground">Showing {shown.length} of {rows.length}.{!all && " The rest follow in the same order."}</p>}
    </section>
  );
}

