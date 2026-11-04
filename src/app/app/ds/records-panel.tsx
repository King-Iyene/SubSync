"use client";

import { ArrowDown, ArrowUp, Calendar, Clock, DollarSign, ExternalLink, Hash, Link2, Maximize2, Minimize2, Search, Tag, Type, X, Download, ChevronDown } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ageWords } from "@/lib/analytics/today-queue";
import {
  cellText, emptyFilter, facetValues, filterRecs, NO_VALUE, rangeChoices, sortRecs, toCsv,
  type Col, type ColType, type Rec, type RecFilter, type RecordsSpec, type Sort,
} from "@/lib/analytics/today-records";
import { LeadDrawer, type LeadSeed } from "./lead-drawer";

// The list behind any number, bar, slice or day on Today: a database-style table in a large panel over a dimmed page (the same panel for every mark, so a person learns it
// once). The title says what the list is, a chip says what is being shown, a search box and chips narrow it, each column header says what kind of value it holds, the
// header stays in view while the rows scroll, and every row has an Open button that goes to the record in the CRM. Maximise fills the window. Esc, the cross and a click
// outside close it. The rows were already sent to a person allowed to see them (the server limits Today to the accounts of the signed session), so filtering, sorting and
// the CSV here can only ever narrow what the person already has.
//
// The page owns what to show: it wraps itself in <RecordsHost resolve={...}> and any mark calls useRecords().open(key). `resolve` returns the spec for a key (from the
// server, or from rows already in memory), so every mark goes through one place.

const TYPE_ICON: Record<ColType, typeof Type> = { text: Type, date: Calendar, number: Hash, money: DollarSign, duration: Clock, link: Link2, kind: Tag };
const TYPE_WORD: Record<ColType, string> = { text: "Text", date: "Date", number: "Number", money: "Money", duration: "Time", link: "Link", kind: "Kind" };
const RENDER_CAP = 300;

type Ctx = { open: (key: string) => void; close: () => void; openSpec: (spec: RecordsSpec) => void; activeKey: string | null };
const RecordsContext = createContext<Ctx>({ open: () => undefined, close: () => undefined, openSpec: () => undefined, activeKey: null });
export const useRecords = () => useContext(RecordsContext);

/** Holds the one panel of the page and opens it for a key. `extra` adds buttons next to the title (for example "Only this account"). */
export function RecordsHost({ resolve, children, zone, extra, onClosed }: {
  resolve: (key: string) => Promise<RecordsSpec> | RecordsSpec;
  children: ReactNode;
  /** The viewer's time zone for dates in the panel and the CSV (the account's own is not known for a mixed list). */
  zone?: string;
  extra?: (spec: RecordsSpec) => ReactNode;
  onClosed?: () => void;
}) {
  const [state, setState] = useState<{ key: string | null; spec: RecordsSpec | null; loading: boolean; error: string | null }>({ key: null, spec: null, loading: false, error: null });
  const token = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((key: string) => {
    const id = ++token.current;
    opener.current = document.activeElement as HTMLElement | null;
    setState({ key, spec: null, loading: true, error: null });
    Promise.resolve().then(() => resolve(key)).then(
      (spec) => { if (id === token.current) setState({ key, spec, loading: false, error: null }); },
      (e: unknown) => { if (id === token.current) setState({ key, spec: null, loading: false, error: e instanceof Error ? e.message : "The list could not be loaded." }); },
    );
  }, [resolve]);
  const openSpec = useCallback((spec: RecordsSpec) => { token.current += 1; opener.current = document.activeElement as HTMLElement | null; setState({ key: spec.key, spec, loading: false, error: null }); }, []);
  const close = useCallback(() => {
    token.current += 1;
    setState({ key: null, spec: null, loading: false, error: null });
    const back = opener.current;
    opener.current = null;
    if (back && document.contains(back)) setTimeout(() => back.focus(), 0);
    onClosed?.();
  }, [onClosed]);
  const value = useMemo<Ctx>(() => ({ open, close, openSpec, activeKey: state.key }), [open, close, openSpec, state.key]);
  return (
    <RecordsContext.Provider value={value}>
      {children}
      {state.key !== null && <RecordsPanel spec={state.spec} loading={state.loading} error={state.error} onClose={close} zone={zone} extra={state.spec && extra ? extra(state.spec) : null} onRetry={() => open(state.key as string)} />}
    </RecordsContext.Provider>
  );
}

// ---------- cells ----------

function Cell({ col, value, zone, now }: { col: Col; value: string | number | null; zone: string; now: number }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground" aria-label="empty">-</span>;
  if (col.type === "date" && typeof value === "number") {
    const when = cellText(col, value, zone);
    const ago = now - value;
    return <span title={when}>{when}{Math.abs(ago) > 60_000 && <span className="ml-1.5 text-xs text-muted-foreground">{ago > 0 ? `${ageWords(ago / 60_000)} ago` : `in ${ageWords(-ago / 60_000)}`}</span>}</span>;
  }
  if (col.type === "duration" && typeof value === "number") return <span className="tnum">{ageWords(value)}</span>;
  if (col.type === "money" && typeof value === "number") return <span className="tnum">{cellText(col, value)}</span>;
  if (col.type === "number" && typeof value === "number") return <span className="tnum">{value.toLocaleString("en-US")}</span>;
  if (col.type === "kind") return <span className="inline-flex rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs">{String(value)}</span>;
  return <span className="break-words">{String(value)}</span>;
}

function FacetMenu({ col, rows, allowed, onChange }: { col: Col; rows: Rec[]; allowed: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const values = useMemo(() => facetValues(rows, col.key), [rows, col.key]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const set = new Set(allowed);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-testid={`facet-${col.key}`}
        className={`ds-press inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-[var(--ring)] ${allowed.length > 0 ? "border-primary/50 bg-accent/40 font-medium" : "bg-card"}`}>
        {col.header}{allowed.length > 0 && <span className="tnum">: {allowed.length}</span>}<ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div role="dialog" aria-label={`Filter by ${col.header.toLowerCase()}`} className="absolute left-0 top-full z-20 mt-1 max-h-64 w-60 overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-[var(--shadow-lift)]">
          {values.map((v) => (
            <label key={v.value} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent">
              <input type="checkbox" className="size-4" checked={set.has(v.value)} onChange={() => onChange(set.has(v.value) ? allowed.filter((x) => x !== v.value) : [...allowed, v.value])} />
              <span className="min-w-0 flex-1 truncate">{v.value}</span><span className="tnum text-xs text-muted-foreground">{v.n}</span>
            </label>
          ))}
          {allowed.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 min-h-8 w-full rounded-lg px-2 text-left text-xs underline underline-offset-4 hover:bg-muted">Clear this filter</button>}
        </div>
      )}
    </div>
  );
}

// ---------- the panel ----------

export function RecordsPanel({ spec, loading = false, error = null, onClose, zone, extra, onRetry }: {
  spec: RecordsSpec | null; loading?: boolean; error?: string | null; onClose: () => void; zone?: string; extra?: ReactNode; onRetry?: () => void;
}) {
  const tz = zone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
  const [full, setFull] = useState(false);
  const [filter, setFilter] = useState<RecFilter>(() => emptyFilter(spec?.preset ?? {}));
  const [rangeId, setRangeId] = useState("any");
  const [sort, setSort] = useState<Sort>(null);
  const [more, setMore] = useState(false);
  const [lead, setLead] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const dialog = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const key = spec?.key ?? "";

  // A new list starts from its own preset filters and the top of the table.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilter(emptyFilter(spec?.preset ?? {})); setRangeId("any"); setSort(null); setMore(false); setLead(null);
  }, [key, spec?.preset]);

  useEffect(() => {
    dialog.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && lead === null && !e.defaultPrevented) { e.preventDefault(); onClose(); return; }
      if (e.key === "Tab" && dialog.current) {
        const f = [...dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [onClose, lead]);

  const ranges = useMemo(() => rangeChoices(now), [now]);
  const effective = useMemo<RecFilter>(() => {
    const r = ranges.find((x) => x.id === rangeId);
    return { ...filter, range: r && r.id !== "any" ? { from: r.from, to: r.to } : null };
  }, [filter, rangeId, ranges]);
  const rows = useMemo(() => (spec ? sortRecs(filterRecs(spec, effective), sort) : []), [spec, effective, sort]);
  const shown = more ? rows : rows.slice(0, RENDER_CAP);
  const facetCols = spec?.cols.filter((c) => c.facet) ?? [];
  const activeChips = Object.entries(filter.facets).flatMap(([k, vs]) => vs.map((v) => ({ k, v, header: spec?.cols.find((c) => c.key === k)?.header ?? k })));
  const narrowed = activeChips.length > 0 || filter.q.trim() !== "" || rangeId !== "any";

  const seeds = useMemo<LeadSeed[]>(() => shown.map((r) => ({
    contactId: r.lead?.contactId ?? "", locationId: r.lead?.locationId ?? "", name: r.lead?.name ?? "", locationName: r.lead?.account ?? null, url: r.url ?? undefined, note: r.lead?.note ?? undefined,
  })), [shown]);

  const exportCsv = () => {
    if (!spec) return;
    const csv = toCsv(spec.cols, rows, tz);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${spec.exportName}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const sortBy = (c: Col) => setSort((s) => (s?.key !== c.key ? { key: c.key, dir: c.type === "text" || c.type === "kind" ? "asc" : "desc" } : s.dir === "asc" ? { key: c.key, dir: "desc" } : null));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 print:hidden" data-testid="records-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="records-panel" data-full={full ? "true" : "false"}
        className={`flex min-h-0 flex-col overflow-hidden border bg-popover text-popover-foreground shadow-[var(--shadow-lift)] outline-none ${full ? "h-full w-full rounded-none" : "h-[min(88vh,54rem)] w-[min(96vw,84rem)] rounded-2xl"}`}>
        <header className="flex items-start gap-3 border-b px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight" data-testid="records-title">{spec?.title ?? (error ? "This list could not be loaded" : "Loading the list")}</h2>
            {spec && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground" data-testid="records-subtitle">{spec.subtitle}</p>}
          </div>
          {extra}
          <button type="button" onClick={() => setFull(!full)} aria-pressed={full} aria-label={full ? "Make the list smaller" : "Make the list fill the window"} title={full ? "Smaller" : "Maximise"} data-testid="records-maximise"
            className="ds-press inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{full ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}</button>
          <button type="button" onClick={onClose} aria-label="Close the list" data-testid="records-close"
            className="ds-press inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><X aria-hidden className="size-5" /></button>
        </header>

        {loading && <div className="flex-1 p-6" role="status" aria-busy="true" data-testid="records-loading"><div className="h-6 w-2/3 animate-pulse rounded bg-muted" /><div className="mt-3 h-6 w-1/2 animate-pulse rounded bg-muted" /><div className="mt-3 h-6 w-3/4 animate-pulse rounded bg-muted" /><span className="sr-only">Loading the list</span></div>}
        {error && !loading && (
          <div className="flex-1 p-6" role="alert" data-testid="records-error"><p className="text-sm">{error}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-3 min-h-9 rounded-lg border px-3 text-sm font-medium hover:bg-muted">Try again</button>}</div>
        )}

        {spec && !loading && (
          <>
            <div className="space-y-2 border-b px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm" data-testid="records-count-line"><span className="font-semibold tnum" data-testid="records-count">{spec.count.toLocaleString("en-US")}</span> {spec.noun}{narrowed && <span className="text-muted-foreground"> ({rows.length.toLocaleString("en-US")} match what you picked)</span>}</p>
                <label className="relative ml-auto block w-full sm:w-72">
                  <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <input ref={searchBox} type="search" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Search this list" aria-label="Search this list" data-testid="records-search"
                    className="min-h-9 w-full rounded-lg border bg-card py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2" data-testid="records-filters">
                <span className="text-xs font-medium text-muted-foreground">Showing</span>
                {activeChips.length === 0 && rangeId === "any" && <span className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground" data-testid="records-chip-all">Everything in this list</span>}
                {activeChips.map((c) => (
                  <span key={`${c.k}:${c.v}`} className="inline-flex items-center gap-1 rounded-full border bg-accent/40 py-0.5 pl-2.5 pr-1 text-xs" data-testid="records-chip">
                    <span className="text-muted-foreground">{c.header}:</span> <span className="font-medium">{c.v === NO_VALUE ? "(none)" : c.v}</span>
                    <button type="button" aria-label={`Remove the filter ${c.header}: ${c.v}`} onClick={() => setFilter({ ...filter, facets: { ...filter.facets, [c.k]: (filter.facets[c.k] ?? []).filter((x) => x !== c.v) } })} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-muted"><X aria-hidden className="size-3" /></button>
                  </span>
                ))}
                {rangeId !== "any" && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-accent/40 py-0.5 pl-2.5 pr-1 text-xs" data-testid="records-chip">
                    <span className="font-medium">{ranges.find((r) => r.id === rangeId)?.label}</span>
                    <button type="button" aria-label="Remove the date filter" onClick={() => setRangeId("any")} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-muted"><X aria-hidden className="size-3" /></button>
                  </span>
                )}
                <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
                {facetCols.map((c) => <FacetMenu key={c.key} col={c} rows={spec.rows} allowed={filter.facets[c.key] ?? []} onChange={(v) => setFilter({ ...filter, facets: { ...filter.facets, [c.key]: v } })} />)}
                {spec.dateKey && (
                  <select value={rangeId} onChange={(e) => setRangeId(e.target.value)} aria-label="Date range" data-testid="records-range" className="min-h-8 rounded-lg border bg-card px-2 text-xs">
                    {ranges.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                )}
                {narrowed && <button type="button" onClick={() => { setFilter(emptyFilter(spec.preset)); setRangeId("any"); }} className="min-h-8 rounded-lg px-2 text-xs underline underline-offset-4 hover:bg-muted" data-testid="records-reset">Reset</button>}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto" data-testid="records-scroll">
              {rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground" data-testid="records-empty">{spec.rows.length === 0 ? "Nothing is in this list." : "Nothing matches what you picked. Reset the filters to see all of them."}</p>
              ) : (
                <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm" data-testid="records-table">
                  <caption className="sr-only">{spec.title}: {spec.count} {spec.noun}</caption>
                  <thead>
                    <tr>
                      {spec.cols.map((c) => {
                        const Icon = TYPE_ICON[c.type];
                        const on = sort?.key === c.key;
                        const link = c.type === "link";
                        return (
                          <th key={c.key} scope="col" aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"} data-col={c.key} data-type={c.type} style={c.w ? { minWidth: `${c.w}rem` } : undefined}
                            className={`sticky top-0 z-10 border-b bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>
                            {link ? <span className="inline-flex items-center gap-1.5"><Icon aria-hidden className="size-3.5" />Open</span> : (
                              <button type="button" onClick={() => sortBy(c)} className="inline-flex items-center gap-1.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={`${TYPE_WORD[c.type]}. Sort by ${c.header.toLowerCase()}.`}>
                                <Icon aria-hidden className="size-3.5" /><span>{c.header}</span><span className="sr-only"> ({TYPE_WORD[c.type]})</span>
                                {on && (sort?.dir === "asc" ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />)}
                              </button>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={r.id} className="group hover:bg-accent/30" data-testid="records-row">
                        {spec.cols.map((c) => (
                          <td key={c.key} className={`border-b px-3 py-2 align-top ${c.type === "money" || c.type === "number" ? "text-right" : ""} ${c.primary ? "font-medium" : ""}`}>
                            {c.type === "link" ? (
                              r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" data-testid="records-open" className="ds-press inline-flex min-h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-[var(--ring)]">Open<ExternalLink aria-hidden className="size-3" /><span className="sr-only"> {r.cells[spec.cols.find((x) => x.primary)?.key ?? ""] ?? "record"} in your CRM, opens in a new tab</span></a> : null
                            ) : c.primary && r.lead?.contactId ? (
                              <button type="button" onClick={() => setLead(i)} className="text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="records-name"><Cell col={c} value={r.cells[c.key] ?? null} zone={tz} now={now} /></button>
                            ) : <Cell col={c} value={r.cells[c.key] ?? null} zone={tz} now={now} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2.5 text-xs text-muted-foreground">
              <span data-testid="records-shown">{shown.length < rows.length ? `Showing the first ${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}. ` : ""}{spec.note ?? ""}</span>
              {shown.length < rows.length && <button type="button" onClick={() => setMore(true)} className="min-h-8 rounded-lg px-2 font-medium text-primary underline underline-offset-4">Show all {rows.length.toLocaleString("en-US")}</button>}
              <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="ds-press ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 font-medium text-foreground hover:border-primary/40 disabled:opacity-50" data-testid="records-export"><Download aria-hidden className="size-3.5" />Download as a spreadsheet</button>
            </footer>
            <LeadDrawer leads={seeds.filter((s) => s.contactId !== "")} index={lead === null || !seeds[lead] || seeds[lead].contactId === "" ? null : seeds.filter((s) => s.contactId !== "").findIndex((s) => s === seeds[lead])} onIndex={(n) => { const list = seeds.filter((s) => s.contactId !== ""); const s = n === null ? null : list[n]; setLead(s ? seeds.indexOf(s) : null); }} onClose={() => setLead(null)} />
          </>
        )}
      </div>
    </div>
  );
}
