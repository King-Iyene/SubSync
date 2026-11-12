"use client";

import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { accountButtonText, barMode, recentFirst } from "@/lib/design/global-filter";
import { describeHidden, isFiltered, EMPTY_FILTER, nameList, scopeOf, type FilterOptions, type FilterValue } from "@/lib/design/filters";
import { PRESETS, todayOf, type RangeSpec } from "@/lib/design/range";
import { checkCustom, isDefaultRange } from "@/lib/design/page-range";
import { parseTodayAccounts, withTodayAccounts } from "@/lib/analytics/today-queue";
import { useData, useInflight } from "../session";
import { usePageRange } from "./page-range";
import { RightNowNote } from "./own-window";
import { remember, remembered } from "./remember";

// ONE filter bar for every page that shows numbers (KF-11): always open, never behind a triangle. Left: which client accounts are counted (agency only), a button
// that opens a searchable list with a one-click "Only this client". Right: the date, as plain buttons with the window written out, or "Right now" on a page whose
// numbers are not about a range. The accounts live in the page address (Today keeps its own `ta=`), the range in `r.page=`; both are remembered per person.

type Segments = { total: number; testAccounts?: number; accounts?: Array<{ id: string; name: string; test?: boolean; ignored?: boolean; industry?: string | null; owner?: string | null }>; industries: Array<{ key: string; label: string; accounts: number }>; owners: Array<{ name: string; accounts: number }> };

const TODAY_KEY = "today-accounts";
const RECENT_KEY = "recent-clients";
const btn = "ds-press inline-flex min-h-10 items-center gap-2 rounded-lg border bg-card px-3 text-[0.95rem] hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/40 outline-none";

const subscribeHash = (cb: () => void) => {
  window.addEventListener("popstate", cb); window.addEventListener("hashchange", cb); window.addEventListener("subsync-today-accounts", cb); window.addEventListener("subsync-range", cb);
  return () => { window.removeEventListener("popstate", cb); window.removeEventListener("hashchange", cb); window.removeEventListener("subsync-today-accounts", cb); window.removeEventListener("subsync-range", cb); };
};
const useHash = () => useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");

/** Today keeps its own account choice (ta=); the bar edits it and tells Today. */
function setTodayIds(ids: string[]) {
  try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash || "#today", ids)); } catch { /* the choice still applies */ }
  remember(TODAY_KEY, ids.length ? ids.join(",") : null);
  window.dispatchEvent(new Event("subsync-today-accounts"));
}

function readRecent(): string[] { return (remembered(RECENT_KEY) ?? "").split(",").filter(Boolean).slice(0, 5); }
function noteRecent(ids: string[]) { remember(RECENT_KEY, [...new Set([...ids, ...readRecent()])].slice(0, 5).join(",")); }

/** "Only this client" from anywhere: any row or menu can dispatch this, and the bar narrows the page to that one client. */
export function focusClient(id: string) { window.dispatchEvent(new CustomEvent("subsync-focus-client", { detail: { id } })); }

function AccountControl({ accounts, picked, onChange, options, value, onValue }: { accounts: Array<{ id: string; name: string; ignored?: boolean }>; picked: string[]; onChange: (ids: string[]) => void; options: FilterOptions; value: FilterValue; onValue: (v: FilterValue) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const live = accounts.filter((a) => !a.ignored);
  const set = new Set(picked);
  const ordered = useMemo(() => recentFirst(live, readRecent()), [live, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = ordered.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()));
  const commit = (ids: string[]) => { noteRecent(ids); onChange(ids); };
  const toggle = (id: string) => commit(set.has(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const chosen = live.filter((a) => set.has(a.id));
  const scope = scopeOf({ ...value, accounts: picked }, { ...options, accounts });
  const left = scope.left.filter((a) => a.reason !== "not picked" || picked.length > 0);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="account-control">
      <div ref={box} className="relative">
        <button type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} className={btn} data-testid="account-button">
          <span className="font-medium">{accountButtonText(picked.length, live.length)}</span>
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </button>
        {open && (
          <div role="dialog" aria-label="Choose client accounts" className="absolute left-0 top-full z-40 mt-1.5 w-[22rem] max-w-[92vw] rounded-xl border bg-popover p-2.5 shadow-[var(--shadow-lift)]" data-testid="account-list">
            <label className="relative block">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-3 size-4 text-muted-foreground" />
              <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client account" aria-label="Find a client account" className="min-h-10 w-full rounded-lg border bg-card py-1.5 pl-8 pr-2 text-[0.95rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
            </label>
            <ul className="mt-2 max-h-[min(18rem,calc(100dvh-22rem))] overflow-y-auto">
              {shown.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No client account matches.</li>}
              {shown.map((a) => (
                <li key={a.id} className="group flex items-center rounded-lg hover:bg-accent" data-testid="account-row">
                  <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 text-[0.95rem]">
                    <input type="checkbox" className="size-4" checked={set.has(a.id)} onChange={() => toggle(a.id)} aria-label={a.name} />
                    <span className="truncate">{a.name}</span>
                    {set.has(a.id) && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
                  </label>
                  <button type="button" onClick={() => { commit([a.id]); setOpen(false); }} className="mr-1 min-h-9 shrink-0 rounded-md px-2 text-sm font-medium text-primary hover:underline" aria-label={`Only ${a.name}`}>Only this client</button>
                </li>
              ))}
            </ul>
            {left.length > 0 && (
              <div className="mt-2 border-t pt-2 text-sm" data-testid="account-left-out">
                <p className="font-medium">Left out ({left.length})</p>
                <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-muted-foreground">
                  {left.map((a) => <li key={a.id}><span className="text-foreground">{a.name}</span>: {a.reason}</li>)}
                </ul>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <button type="button" className="min-h-9 text-sm underline" onClick={() => commit([])}>All client accounts</button>
              <button type="button" className="min-h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </div>
      {chosen.length > 0 && chosen.length <= 3 && picked.length <= 3 && chosen.map((a) => (
        <span key={a.id} className="inline-flex min-h-9 items-center gap-1 rounded-lg border bg-muted/50 pl-2.5 pr-1 text-[0.95rem]" data-testid="account-chip">
          {a.name}
          <button type="button" aria-label={`Remove ${a.name}`} onClick={() => commit(picked.filter((x) => x !== a.id))} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></button>
        </span>
      ))}
      {isFiltered({ ...value, accounts: [] }) && <button type="button" className="min-h-9 text-sm underline" onClick={() => onValue({ ...EMPTY_FILTER, accounts: value.accounts })}>Clear other filters</button>}
    </div>
  );
}

function DateControl({ mode }: { mode: "range" | "now" | "dates" }) {
  const pr = usePageRange();
  const inflight = useInflight();
  const { spec } = pr;
  const [today] = useState(() => todayOf(Date.now()));
  // The two typed dates of a custom range are kept here until they are applied, so a half-typed date never reaches a screen and the label always shows what is applied.
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const from = draft?.from ?? spec.from ?? pr.from;
  const to = draft?.to ?? spec.to ?? pr.to;
  const problem = spec.preset === "custom" && today ? checkCustom(from, to, today) : null;
  const dirty = spec.preset === "custom" && (from !== (spec.from ?? "") || to !== (spec.to ?? ""));
  const [pending, setPending] = useState(false);
  const busy = useRef(inflight);
  useEffect(() => { busy.current = inflight; }, [inflight]);
  useEffect(() => { const on = () => setPending(true); window.addEventListener("subsync-range", on); return () => window.removeEventListener("subsync-range", on); }, []);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => { if (busy.current === 0) setPending(false); }, 500);
    return () => clearTimeout(t);
  }, [pending, inflight]);
  const applyPreset = (s: RangeSpec) => { setDraft(null); pr.apply(s); };
  const applyDraft = () => { if (!problem && dirty) { pr.apply({ preset: "custom", from, to, compare: spec.compare }); setDraft(null); } };
  if (mode === "now") return <p className="text-[0.95rem] text-muted-foreground" data-testid="date-now" title="This page shows what is true at this moment, not a date range."><span className="font-medium text-foreground">Live</span>, as of right now</p>;
  const updating = pending && inflight > 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="date-control">
      <div role="group" aria-label="Dates" className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={spec.preset === p.key} onClick={() => applyPreset({ preset: p.key, compare: spec.compare })}
            className={`min-h-11 sm:min-h-10 whitespace-nowrap px-2.5 text-[0.95rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:px-3 ${spec.preset === p.key ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent"}`}>{p.label.startsWith("Last ") ? <><span className="max-sm:sr-only">Last </span>{p.label.slice(5)}</> : p.label}</button>
        ))}
        <button type="button" aria-pressed={spec.preset === "custom"} onClick={() => { setDraft(null); pr.apply({ preset: "custom", from: spec.from ?? pr.from, to: spec.to ?? pr.to, compare: spec.compare }); }}
          className={`min-h-10 border-l px-3 text-[0.95rem] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${spec.preset === "custom" ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent"}`}>Custom</button>
      </div>
      {spec.preset === "custom" && (
        <form className="inline-flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); applyDraft(); }} data-testid="custom-range">
          <input type="date" aria-label="From date" aria-invalid={Boolean(problem)} value={from} max={to || today || undefined} onChange={(e) => setDraft({ from: e.target.value, to })} className="min-h-10 rounded-lg border bg-card px-2 text-[0.95rem]" />
          <span aria-hidden className="text-muted-foreground">to</span>
          <input type="date" aria-label="To date" aria-invalid={Boolean(problem)} value={to} max={today ?? undefined} onChange={(e) => setDraft({ from, to: e.target.value })} className="min-h-10 rounded-lg border bg-card px-2 text-[0.95rem]" />
          <button type="submit" disabled={Boolean(problem) || !dirty} data-testid="apply-range" className="min-h-10 rounded-lg bg-primary px-3 text-[0.95rem] font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50">Apply</button>
        </form>
      )}
      <span className="text-[0.95rem] text-muted-foreground" data-testid="date-window" aria-live="polite">{pr.label}</span>
      <label className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 text-[0.95rem]" title="Show the change against the period just before, where a number has one">
        <input type="checkbox" className="size-4" checked={spec.compare !== "none"} onChange={(e) => applyPreset({ ...spec, compare: e.target.checked ? "previous" : "none" })} data-testid="compare-previous" />
        Compare with the previous period
      </label>
      {!isDefaultRange(spec) && <button type="button" className="min-h-9 text-sm underline" onClick={() => { setDraft(null); pr.apply(null); }} data-testid="reset-range">Reset</button>}
      {updating && <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="range-updating"><Loader2 aria-hidden className="size-4 animate-spin" />Updating the numbers</span>}
      {(problem || pr.problem) && <p role="alert" className="basis-full border-l-2 border-warning pl-2 text-sm text-foreground" data-testid="range-problem">{problem ?? pr.problem}{!problem && pr.problem ? " Showing the last 30 days instead." : ""}</p>}
    </div>
  );
}

export function GlobalFilterBar({ view, agency, value, onChange, onAllClients }: { view: string; agency: boolean; value: FilterValue; onChange: (v: FilterValue) => void; /** Given while an agency user is inside one client account: a "Back to all clients" button. */ onAllClients?: () => void }) {
  const mode = barMode(view);
  const hash = useHash();
  const pageLabel = usePageRange().label;
  const { data } = useData<Segments>(agency ? "segments" : null);
  const options = useMemo<FilterOptions | null>(() => data ? ({
    accounts: data.accounts ?? [], testAccounts: data.testAccounts ?? 0,
    industries: data.industries.filter((i) => i.key !== "unset" || data.industries.length > 1).map((i) => ({ key: i.key, label: i.label, count: i.accounts })),
    owners: data.owners.map((o) => ({ key: o.name, label: o.name, count: o.accounts })),
  }) : null, [data]);
  const isToday = view === "today";
  const picked = isToday ? parseTodayAccounts(hash) : value.accounts;
  // ONE account choice for the whole app: whichever page it is made on, Today's own choice (ta=) and the shared filter every other page reads are set together,
  // so the client accounts counted never differ from one screen to the next.
  const setPicked = (ids: string[]) => { setTodayIds(ids); onChange({ ...value, accounts: ids }); };
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<{ id: string }>).detail?.id; if (id) { noteRecent([id]); setPicked([id]); } };
    window.addEventListener("subsync-focus-client", on);
    return () => window.removeEventListener("subsync-focus-client", on);
  });
  if (mode === "none") return null;
  const showAccounts = mode !== "dates" && agency && options && (data?.total ?? 0) >= 1; // an agency user always gets the picker, even with one client (it says which client is counted)
  if (!showAccounts && !agency && mode !== "range" && mode !== "dates") return null;
  const notes = options && !isToday ? describeHidden({ ...value, accounts: picked }, options).filter((n) => n.clear.accounts === undefined) : [];
  return (
    <>
      {/* Sticky: it follows on scroll as one compact line and takes its own place in the flow, so it never covers the content under it. */}
      <div className="sticky top-0 z-30 mb-3 rounded-xl border bg-card px-3 py-1.5 shadow-sm print:hidden" data-testid="global-filter-bar" role="region" aria-label="Filters for this page"><div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        {showAccounts ? <AccountControl accounts={options!.accounts!} picked={picked} onChange={setPicked} options={options!} value={isToday ? { ...value, accounts: picked } : value} onValue={onChange} />   : mode !== "dates" && agency && !options ? <span className="h-10 w-48 animate-pulse rounded-lg bg-muted" aria-hidden data-testid="account-skeleton" /> : <span />}
        <div className="flex flex-wrap items-center gap-3">
          {onAllClients && <button type="button" onClick={onAllClients} data-testid="back-to-all-clients" className="ds-press min-h-10 cursor-pointer rounded-lg border bg-card px-3 text-[0.95rem] font-medium text-primary hover:border-primary/40 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 outline-none">Back to all clients</button>}
          <DateControl mode={mode} />
        </div>
      </div></div>
      <div className="mb-4 print:hidden">
      {mode === "now" && <RightNowNote view={view} label={pageLabel} />}
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          {notes.map((n) => <li key={n.text}>{n.text} <button type="button" className="font-medium text-primary underline" onClick={() => onChange({ ...value, ...n.clear })}>{n.clear.hideTest === false ? "Show them" : "Show all"}</button></li>)}
        </ul>
      )}
      {showAccounts && picked.length > 3 && options && <p className="mt-1.5 text-sm text-muted-foreground">Counting {nameList(scopeOf({ ...value, accounts: picked }, options).included.map((a) => a.name))}.</p>}
      </div>
    </>
  );
}
