"use client";

import {
  CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, Hash, Link2, Maximize2, MoreHorizontal, Minimize2, Plus, Search, Tag, Type, DollarSign, X,
  ArrowDown, ArrowUp, Check, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  cellText, emptyFilter, facetValues, filterRecs, NO_VALUE, rangeChoices, sortRecs, toCsv,
  type Cell, type Col, type ColType, type Rec, type RecFilter, type RecordsSpec, type Sort,
} from "@/lib/analytics/today-records";
import { ageWords } from "@/lib/analytics/today-queue";
import { LeadDrawer, type LeadSeed } from "./lead-drawer";

// The records behind a number: one large panel over a dimmed page, the same everywhere on Today (and ready for any other page). Press a number, a slice, a bar, a day
// or a row and this opens with the actual leads, deals, appointments or alerts the number was counted from. It has a title and a sentence saying what is listed, a chip
// for the date and one for each thing you can narrow by (editable), "+ Filter" for more, a search box, sortable typed columns with a header that stays put, 50 rows a
// page (never more than 200 rows are in the page at once), a row button OPEN that shows the lead, a link that opens the record in the CRM, a Maximise button, a menu with
// "Export CSV" (only the columns shown, only the rows left after filtering), and a footer that says "Showing 50 of 183". The count in the heading is the number that was
// pressed; when you narrow the list it says "12 of 183". Esc and the cross close it, focus stays inside it and goes back to where it was when it closes.
// The rows are whatever the page already received for this person, so narrowing or exporting can never reach more than they were sent.

const PAGE = 50;
const ICON: Record<ColType, LucideIcon> = { text: Type, date: CalendarDays, number: Hash, money: DollarSign, duration: Clock, link: Link2, kind: Tag };
const FIRST_CHIPS = ["account", "kind", "state", "what", "owner"];
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function Cellv({ col, v, zone }: { col: Col; v: Cell; zone: string }) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground/70" aria-label="empty">-</span>;
  if (col.type === "link") return typeof v === "string" ? <a href={v} target="_blank" rel="noopener noreferrer" data-testid="records-crm" className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]">Open in CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> (opens in a new tab)</span></a> : null;
  if (col.type === "number") return <span className="tnum">{Number(v).toLocaleString("en-US")}</span>;
  if (col.type === "money") return <span className="tnum">{cellText(col, v)}</span>;
  if (col.type === "duration") return <span className="tnum">{typeof v === "number" ? ageWords(v) : String(v)}</span>;
  if (col.type === "date") return <span className="tnum whitespace-nowrap">{cellText(col, v, zone)}</span>;
  if (col.type === "kind") return <span className="inline-block max-w-full truncate rounded-md border bg-muted/60 px-1.5 py-0.5 text-xs font-medium">{String(v)}</span>;
  return <span className="break-words">{String(v)}</span>;
}

/** A small floating list under a chip. A click outside or Escape closes it. */
function Pop({ onClose, children, label, wide = false }: { onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-pop-anchor]")) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [onClose]);
  return <div ref={ref} role="dialog" aria-label={label} className={`absolute left-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1.5 text-sm shadow-[var(--shadow-lift)] ${wide ? "w-72" : "w-60"}`}>{children}</div>;
}

export function RecordsPanel({ spec, onClose, now, zone = "UTC", canExport = true }: { spec: RecordsSpec; onClose: () => void; now: number; zone?: string; canExport?: boolean }) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<RecFilter>(() => emptyFilter(spec.preset));
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(0);
  const [max, setMax] = useState(false);
  const [searching, setSearching] = useState(false);
  const [menuLeft, setMenuLeft] = useState(false);
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // which chip's list is open
  const [chips, setChips] = useState<string[]>(() => {
    const multi = spec.cols.filter((c) => c.facet && FIRST_CHIPS.includes(c.key) && facetValues(spec.rows, c.key).length >= 2).map((c) => c.key);
    return [...new Set([...Object.keys(spec.preset), ...multi])];
  });
  const [lead, setLead] = useState<number | null>(null);

  const rows = useMemo(() => sortRecs(filterRecs(spec, filter), sort), [spec, filter, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE, at * PAGE + PAGE);
  const narrowed = rows.length !== spec.rows.length || filter.q.trim() !== "";
  const colOf = (k: string) => spec.cols.find((c) => c.key === k);
  const dateCol = spec.dateKey ? colOf(spec.dateKey) : undefined;
  const addable = spec.cols.filter((c) => c.facet && !chips.includes(c.key));
  const change = (f: RecFilter) => { setFilter(f); setPage(0); };

  // Lead panel: only rows that name a lead can open it, and its arrows step through the rows currently listed.
  const leadRows = useMemo(() => rows.filter((r) => r.lead && r.lead.contactId), [rows]);
  const seeds: LeadSeed[] = useMemo(() => leadRows.map((r) => ({ contactId: r.lead!.contactId as string, locationId: r.lead!.locationId, name: r.lead!.name, locationName: r.lead!.account, url: r.url ?? undefined, note: r.lead!.note || undefined })), [leadRows]);

  // Focus and scrolling: focus the panel on open, keep Tab inside it (unless the lead panel is on top), lock the page behind it, give focus back on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    document.body.classList.add("overflow-hidden");
    root.current?.querySelector<HTMLElement>("[data-testid=records-close]")?.focus();
    return () => { document.body.classList.remove("overflow-hidden"); before?.focus?.(); };
  }, []);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (document.querySelector("[data-testid=lead-drawer-root]")) return;
    if (e.key === "Escape") { e.stopPropagation(); if (open || menu) { setOpen(null); setMenu(false); } else onClose(); return; }
    if (e.key !== "Tab") return;
    const f = [...(root.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex='-1'])") ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (f.length === 0) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose, open, menu]);

  const download = () => {
    const blob = new Blob(["﻿" + toCsv(spec.cols, rows, zone)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${spec.exportName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${new Date(now).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMenu(false);
  };

  const facetLabel = (k: string) => { const v = filter.facets[k] ?? []; return v.length === 0 ? "Any" : v.length === 1 ? (v[0] === NO_VALUE ? "Empty" : v[0]) : `${v.length} chosen`; };
  const range = rangeChoices(now);
  const rangeLabel = filter.range ? (range.find((r) => r.from === filter.range!.from && r.to === filter.range!.to)?.label ?? "Custom") : "Any time";
  const sortBy = (k: string) => setSort((s) => (s?.key !== k ? { key: k, dir: "asc" } : s.dir === "asc" ? { key: k, dir: "desc" } : null));
  const totalW = spec.cols.reduce((s, c) => s + (c.w ?? 10), 0);

  const chip = "inline-flex min-h-8 items-center gap-1 rounded-lg border bg-card px-2.5 text-sm hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-[var(--ring)]";
  const iconBtn = "inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

  const node = (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3 sm:p-6 print:hidden" data-testid="records-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKey} data-testid="records-panel" data-maximised={max} data-key={spec.key}
        className={`relative flex flex-col overflow-hidden border bg-card text-card-foreground shadow-2xl ${max ? "h-full w-full rounded-none" : "h-[80vh] w-[min(960px,100%)] rounded-2xl"}`}>
        <header className="flex items-start gap-3 border-b px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="flex flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight" data-testid="records-title">
              <span className="break-words">{spec.title}</span>
              <span className="tnum text-base font-medium text-muted-foreground" data-testid="records-count" data-count={spec.count} data-shown={rows.length}>
                {narrowed ? `${rows.length.toLocaleString("en-US")} of ${spec.count.toLocaleString("en-US")}` : spec.count.toLocaleString("en-US")} {spec.noun}
              </span>
            </h2>
            <p className="mt-0.5 max-w-3xl text-sm leading-5 text-muted-foreground" data-testid="records-subtitle">{spec.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setMax(!max)} data-testid="records-maximise" aria-pressed={max} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
              {max ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}{max ? "Restore" : "Maximise"}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" data-testid="records-close" className={iconBtn}><X aria-hidden className="size-5" /></button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5" data-testid="records-toolbar">
          {dateCol && (
            <div className="relative" data-pop-anchor>
              <button type="button" className={chip} onClick={() => setOpen(open === "range" ? null : "range")} aria-expanded={open === "range"} data-testid="records-chip-range">
                <CalendarDays aria-hidden className="size-3.5 text-muted-foreground" /><span className="text-muted-foreground">{dateCol.header}:</span><span className="font-medium">{rangeLabel}</span><ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
              </button>
              {open === "range" && (
                <Pop onClose={() => setOpen(null)} label={`Filter by ${dateCol.header}`} wide>
                  {range.map((r) => {
                    const on = (filter.range === null && r.id === "any") || (filter.range !== null && filter.range.from === r.from && filter.range.to === r.to);
                    return <button key={r.id} type="button" role="menuitemradio" aria-checked={on} onClick={() => { change({ ...filter, range: r.id === "any" ? null : { from: r.from, to: r.to } }); setOpen(null); }} data-testid={`range-${r.id}`}
                      className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"><span className="inline-flex w-4">{on && <Check aria-hidden className="size-4" />}</span>{r.label}</button>;
                  })}
                  <div className="mt-1 grid grid-cols-2 gap-2 border-t p-2 pt-2.5 text-xs text-muted-foreground">
                    <label>From<input type="date" className="mt-0.5 w-full rounded-md border bg-card px-1.5 py-1 text-sm text-foreground" data-testid="range-from" onChange={(e) => change({ ...filter, range: { from: e.target.value ? Date.parse(`${e.target.value}T00:00:00`) : null, to: filter.range?.to ?? null } })} /></label>
                    <label>To<input type="date" className="mt-0.5 w-full rounded-md border bg-card px-1.5 py-1 text-sm text-foreground" data-testid="range-to" onChange={(e) => change({ ...filter, range: { from: filter.range?.from ?? null, to: e.target.value ? Date.parse(`${e.target.value}T23:59:59`) : null } })} /></label>
                  </div>
                </Pop>
              )}
            </div>
          )}
          {chips.map((k) => {
            const c = colOf(k);
            if (!c) return null;
            const on = (filter.facets[k] ?? []).length > 0;
            return (
              <div key={k} className="relative" data-pop-anchor>
                <span className={`${chip} pr-1 ${on ? "border-primary/50 bg-accent/50" : ""}`}>
                  <button type="button" className="inline-flex min-h-8 items-center gap-1" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} data-testid={`records-chip-${k}`}>
                    {(() => { const I = ICON[c.type]; return <I aria-hidden className="size-3.5 text-muted-foreground" />; })()}<span className="text-muted-foreground">{c.header}:</span><span className="max-w-40 truncate font-medium">{facetLabel(k)}</span><ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
                  </button>
                  <button type="button" aria-label={`Remove the ${c.header} filter`} onClick={() => { change({ ...filter, facets: { ...filter.facets, [k]: [] } }); setChips(chips.filter((x) => x !== k)); if (open === k) setOpen(null); }} className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X aria-hidden className="size-3.5" /></button>
                </span>
                {open === k && (
                  <Pop onClose={() => setOpen(null)} label={`Filter by ${c.header}`} wide>
                    {facetValues(spec.rows, k).map((v) => {
                      const set = filter.facets[k] ?? [];
                      const checked = set.includes(v.value);
                      return (
                        <label key={v.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-accent">
                          <input type="checkbox" className="size-4" checked={checked} data-testid="facet-option" onChange={() => change({ ...filter, facets: { ...filter.facets, [k]: checked ? set.filter((x) => x !== v.value) : [...set, v.value] } })} />
                          <span className="min-w-0 flex-1 truncate">{v.value === NO_VALUE ? "Empty" : v.value}</span><span className="tnum text-xs text-muted-foreground">{v.n}</span>
                        </label>
                      );
                    })}
                  </Pop>
                )}
              </div>
            );
          })}
          {addable.length > 0 && (
            <div className="relative" data-pop-anchor>
              <button type="button" className={`${chip} border-dashed text-muted-foreground`} onClick={() => setOpen(open === "add" ? null : "add")} aria-expanded={open === "add"} data-testid="records-add-filter"><Plus aria-hidden className="size-3.5" />Filter</button>
              {open === "add" && (
                <Pop onClose={() => setOpen(null)} label="Add a filter">
                  {addable.map((c) => { const I = ICON[c.type]; return <button key={c.key} type="button" onClick={() => { setChips([...chips, c.key]); setOpen(c.key); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent" data-testid={`add-filter-${c.key}`}><I aria-hidden className="size-4 text-muted-foreground" />{c.header}</button>; })}
                </Pop>
              )}
            </div>
          )}
          <span className="flex-1" />
          {searching ? (
            <label className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
              <input ref={searchBox} autoFocus type="search" value={filter.q} onChange={(e) => change({ ...filter, q: e.target.value })} placeholder="Search these records" aria-label="Search these records" data-testid="records-search"
                className="min-h-8 w-56 rounded-lg border bg-card py-1 pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
            </label>
          ) : (
            <button type="button" className={iconBtn} aria-label="Search" onClick={() => setSearching(true)} data-testid="records-search-toggle"><Search aria-hidden className="size-4.5" /></button>
          )}
          <div className="relative" data-pop-anchor>
            <button type="button" className={iconBtn} aria-label="More" aria-expanded={menu} aria-haspopup="menu" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(), r = root.current?.getBoundingClientRect(); setMenuLeft(!!r && b.right - r.left < 240); setMenu(!menu); }} data-testid="records-menu"><MoreHorizontal aria-hidden className="size-5" /></button>
            {menu && (
              <div role="menu" className={`absolute ${menuLeft ? "left-0" : "right-0"} top-full z-30 mt-1 w-56 rounded-xl border bg-popover p-1.5 text-sm shadow-[var(--shadow-lift)]`}>
                {canExport ? <button type="button" role="menuitem" onClick={download} data-testid="records-export" className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent"><Download aria-hidden className="size-4" />Export CSV ({rows.length})</button> : null}
                <button type="button" role="menuitem" onClick={() => { change(emptyFilter(spec.preset)); setSort(null); setSearching(false); setMenu(false); }} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-accent" data-testid="records-reset"><X aria-hidden className="size-4" />Clear filters and sorting</button>
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto" data-testid="records-scroll">
          {rows.length === 0 ? (
            <p className="px-5 py-14 text-center text-sm text-muted-foreground" data-testid="records-empty">{spec.rows.length === 0 ? "There is nothing behind this number right now." : "No record matches these filters."}</p>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: `${totalW}rem` }} data-testid="records-table">
              <caption className="sr-only">{spec.title}: {spec.subtitle}</caption>
              <colgroup>{spec.cols.map((c) => <col key={c.key} style={{ width: `${c.w ?? 10}rem` }} />)}</colgroup>
              <thead>
                <tr>
                  {spec.cols.map((c) => {
                    const I = ICON[c.type];
                    const s = sort?.key === c.key ? sort.dir : null;
                    return (
                      <th key={c.key} scope="col" aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"} data-testid="records-th"
                        className="sticky top-0 z-10 border-b bg-muted px-3 py-0 text-left text-xs font-semibold text-muted-foreground first:pl-5">
                        <button type="button" onClick={() => sortBy(c.key)} className="flex min-h-9 w-full items-center gap-1.5 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid={`sort-${c.key}`}>
                          <I aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{c.header}</span>{s === "asc" ? <ArrowUp aria-hidden className="size-3.5 shrink-0" /> : s === "desc" ? <ArrowDown aria-hidden className="size-3.5 shrink-0" /> : null}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} data-testid="records-row" className="group hover:bg-accent/40">
                    {spec.cols.map((c) => (
                      <td key={c.key} className="relative border-b px-3 py-2 align-middle first:pl-5">
                        {c.primary ? (
                          <div className="flex items-center gap-2 pr-1">
                            <span className="min-w-0 flex-1 break-words font-medium"><Cellv col={c} v={r.cells[c.key] ?? null} zone={zone} /></span>
                            <RowOpen rec={r} onLead={() => { const i = leadRows.findIndex((x) => x.id === r.id); if (i >= 0) setLead(i); }} />
                          </div>
                        ) : <Cellv col={c} v={r.cells[c.key] ?? null} zone={zone} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-5 py-2.5 text-sm text-muted-foreground" data-testid="records-footer">
          <span data-testid="records-showing"><span className="tnum">Showing {shown.length.toLocaleString("en-US")} of {rows.length.toLocaleString("en-US")}</span>{spec.note && <span className="ml-3 text-xs" data-testid="records-note">{spec.note}</span>}</span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Previous page" disabled={at <= 0} onClick={() => setPage(at - 1)} data-testid="records-prev" className={`${iconBtn} border disabled:opacity-40`}><ChevronLeft aria-hidden className="size-4" /></button>
            <span aria-live="polite" className="tnum px-1">Page {at + 1} of {pages}</span>
            <button type="button" aria-label="Next page" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} data-testid="records-next" className={`${iconBtn} border disabled:opacity-40`}><ChevronRight aria-hidden className="size-4" /></button>
          </span>
        </footer>
        {lead !== null && seeds.length > 0 && <LeadDrawer leads={seeds} index={lead} onIndex={setLead} onClose={() => setLead(null)} />}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}

/** The OPEN button on a row: shows the lead when the row is a lead, otherwise opens the record in the CRM. Always reachable by keyboard; drawn on hover or focus. */
function RowOpen({ rec, onLead }: { rec: Rec; onLead: () => void }) {
  const cls = "inline-flex min-h-7 shrink-0 items-center rounded-md border bg-card px-2 text-[0.7rem] font-semibold tracking-wide text-foreground opacity-0 shadow-sm hover:bg-accent focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ring)] group-hover:opacity-100";
  if (rec.lead && rec.lead.contactId) return <button type="button" onClick={onLead} className={cls} data-testid="records-open" aria-label={`Show lead: ${rec.lead.name}`}>OPEN</button>;
  if (rec.url) return <a href={rec.url} target="_blank" rel="noopener noreferrer" className={cls} data-testid="records-open">OPEN<span className="sr-only"> in your CRM (opens in a new tab)</span></a>;
  return null;
}

export const recordsPlural = plural;
