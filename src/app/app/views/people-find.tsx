"use client";

import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeFilter, filterToParams, isEmptyFilter, parseSmartFilter, type SmartFilter } from "@/lib/people/filters";
import { countWords, LIST_IDS, searchTerm, type ListCount, type ListId, type ListInfo } from "@/lib/people/queue";
import { listText } from "@/lib/people/rows";
import type { PersonRowOut } from "@/lib/people/types";
import { DialNote, ErrorState, LeadDrawer, SkeletonRows, useContactActions } from "../ds";
import { remember, remembered, takeHandOff } from "../ds/remember";
import { ApiError, useApiClient, useData } from "../session";
import { Btn, fmtInt, inputClass } from "../ui";
import { FilterBuilder, ManageLists, SaveList, useSavedLists, type Options } from "./people-filters";
import { PersonRows, toSeed } from "./people-rows";
import { BulkBar, useFound } from "./find-more";

// People, the first tab: find a person, or work the call lists. One search box at the top (name, phone or email, across every client account the person may see), then ONE sentence
// about who needs a call and ONE button to start, then the five ready-made lists (each is the list another page already uses) as plain tabs, then the list. Saved filters sit beside
// the lists. Every row has one small Call button and a three-dot menu; every name opens the same lead panel, which steps through the list it was opened from.

type QueuePage = { list: ListId; total: number; mineTotal: number | null; page: number; pages: number; from: number; to: number; capped: boolean; withoutContact: number; rows: PersonRowOut[] };
type Home = {
  counts: ListCount[]; capped: Partial<Record<ListId, boolean>>; start: ListId | null; mine: boolean; staff: boolean; canMine: boolean; staleDays: number;
  say: { head: string; also: string | null; allClear: boolean }; multi: boolean; lists: ListInfo[]; page: QueuePage | null;
};
type SearchPage = { total: number; capped: boolean; page: number; pageSize: number; rows: PersonRowOut[]; description?: string };
type Recent = { queries: string[]; people: PersonRowOut[] };

const PRIMARY = "ds-press inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-10";
const QUIET = "min-h-11 px-1 text-sm font-medium text-primary underline underline-offset-4 hover:no-underline sm:min-h-9";

function Pager({ page, pages, from, to, total, capped, onPage }: { page: number; pages: number; from: number; to: number; total: number; capped: boolean; onPage: (n: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="people-pager">
      <span>{fmtInt(from)} to {fmtInt(to)} of {countWords(total, capped)}</span>
      <span className="flex items-center gap-2">
        <Btn variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} testId="pager-prev">Previous</Btn>
        <span aria-live="polite">Page {page}{capped ? "" : ` of ${fmtInt(pages)}`}</span>
        <Btn variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} testId="pager-next">Next</Btn>
      </span>
    </div>
  );
}

/** `plus`: the Find a lead search (typed pickers, Load more that keeps its place, the Open button on every row). `bulk`: tick boxes, add a tag or a note to several people, export. Both are switched on per account. */
export function FindTab({ plus = false, bulk = false }: { plus?: boolean; bulk?: boolean }) {
  const api = useApiClient();
  const actions = useContactActions();
  const opts = useData<Options>("people/options");
  const home = useData<Home>("people/home");
  const recent = useData<Recent>("people/recent");
  const { lists: saved, names } = useSavedLists();

  // ---- the search box and the filters ----
  const [typed, setTyped] = useState(() => (takeHandOff("people-q") ?? "").slice(0, 100));
  const [debounced, setDebounced] = useState(typed);
  useEffect(() => { const t = setTimeout(() => setDebounced(typed), 300); return () => clearTimeout(t); }, [typed]);
  const [filter, setFilterState] = useState<SmartFilter>(() => {
    const raw = remembered("people-filter");
    // The remembered choices never hold the typed search (a name, an email or a phone number is customer data and stays out of browser storage).
    if (raw) { try { const p = parseSmartFilter(JSON.parse(raw)); if (p.ok) { const rest: SmartFilter = { ...p.filter }; delete rest.q; return rest; } } catch { /* a damaged value is ignored */ } }
    return {};
  });
  const [version, setVersion] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(() => !isEmptyFilter(filter));
  const setFilter = (f: SmartFilter) => { setFilterState(f); remember("people-filter", isEmptyFilter(f) ? null : JSON.stringify(f)); };
  const replaceFilter = (f: SmartFilter) => { setFilter(f); setVersion((v) => v + 1); };
  const term = useMemo(() => searchTerm(debounced), [debounced]);
  const effective: SmartFilter = useMemo(() => ({ ...filter, ...(term.ok ? { q: term.q } : {}) }), [filter, term]);
  const searching = !isEmptyFilter(effective);

  const fk = JSON.stringify(effective);
  const [sp, setSp] = useState({ fk, n: 1 });
  const searchNo = sp.fk === fk ? sp.n : 1;
  const searchPath = searching ? `people/search?${(() => { const p = filterToParams(effective); p.set("page", String(searchNo)); return p.toString(); })()}` : null;
  const plain = useData<SearchPage>(plus ? null : searchPath);
  const fnd = useFound(plus && searching ? effective : null);
  const results = plus
    ? { data: fnd.key ? ({ total: fnd.total ?? fnd.rows.length, capped: fnd.capped, page: 1, pageSize: Math.max(1, fnd.rows.length), rows: fnd.rows } as SearchPage) : null, loading: fnd.loading, error: fnd.error ? new ApiError(0, { error: fnd.error }) : null, reload: fnd.reload }
    : plain;
  // Ticked people belong to the search they were ticked in: a new search starts with nobody ticked.
  const [tick, setTick] = useState<{ fk: string; ids: ReadonlySet<string> }>({ fk, ids: new Set() });
  const ticked = tick.fk === fk ? tick.ids : new Set<string>();
  const toggle = (id: string) => { const n = new Set(ticked); if (n.has(id)) n.delete(id); else n.add(id); setTick({ fk, ids: n }); };

  // ---- the call lists ----
  const [picked, setPicked] = useState<{ list: ListId; mine: boolean | null } | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const h = home.data;
  const list: ListId = picked?.list ?? h?.start ?? "waiting";
  const mine = picked ? (picked.mine ?? false) : h?.mine ?? false;
  const first = !!h && h.page !== null && list === h.start && mine === h.mine && pageNo === 1;
  const queuePath = !searching && h && !first ? `people/queue?list=${list}&mine=${mine ? 1 : 0}&page=${pageNo}` : null;
  const queue = useData<QueuePage>(queuePath);
  const page: QueuePage | null = first ? h!.page : queue.data;
  const pickList = (id: ListId) => { setPicked({ list: id, mine: picked?.mine ?? null }); setPageNo(1); };
  const pickMine = (m: boolean) => { setPicked({ list, mine: m }); setPageNo(1); };

  // ---- the panel ----
  const [open, setOpen] = useState<{ src: "list" | "search" | "recent"; i: number } | null>(null);
  const dirty = useRef(false);
  const rowsOf = (src: "list" | "search" | "recent") => (src === "list" ? page?.rows : src === "search" ? results.data?.rows : recent.data?.people) ?? [];
  const drawerRows = open ? rowsOf(open.src) : [];
  const reloadAll = useCallback(() => { void home.reload(); void queue.reload(); void recent.reload(); }, [home, queue, recent]);
  const remember_ = useCallback((q: string) => { const t = searchTerm(q); if (t.ok) void api.post("people/recent", { q: t.q }).then(() => recent.reload()).catch(() => undefined); }, [api, recent]);
  const close = () => { setOpen(null); if (dirty.current) { dirty.current = false; reloadAll(); } else void recent.reload(); };
  const openFrom = (src: "list" | "search" | "recent", i: number) => { if (src === "search" && term.ok) remember_(term.q); setOpen({ src, i }); };

  const showAccount = !(opts.data?.singleAccount ?? (h ? !h.multi : false));
  const info = h?.lists.find((l) => l.id === list);
  const count = h?.counts.find((c) => c.id === list);

  return (
    <div className="space-y-6" data-testid="people-find">
      {/* ---- the search box ---- */}
      <div>
        <label htmlFor="people-q" className="sr-only">Search people by name, phone or email</label>
        <div className="relative max-w-2xl">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id="people-q" type="search" role="searchbox" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={100} autoComplete="off" spellCheck={false} placeholder="Search by name, phone or email"
            onKeyDown={(e) => { if (e.key === "Enter") remember_(typed); if (e.key === "Escape" && typed) { e.preventDefault(); setTyped(""); setDebounced(""); } }}
            className={`${inputClass} min-h-12 py-3 pl-10 pr-11 text-base`} data-testid="people-search-input" />
          {typed && <button type="button" aria-label="Clear the search" onClick={() => { setTyped(""); setDebounced(""); }} className="absolute right-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"><X aria-hidden className="size-4" /></button>}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {term.ok || typed.trim().length === 0 ? (showAccount ? "Across every client account. The start of a name or email, or the last digits of a phone, is enough." : "The start of a name or email, or the last digits of a phone, is enough.") : "Type at least two letters, or three digits of a phone number."}
        </p>
        {!searching && (recent.data?.queries.length ?? 0) > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="recent-searches">
            <span className="text-xs text-muted-foreground">Recent searches</span>
            {recent.data!.queries.slice(0, 5).map((q) => <button key={q} type="button" onClick={() => { setTyped(q); setDebounced(q); }} className="min-h-9 border-b border-transparent px-1 font-medium hover:border-primary">{q}</button>)}
            <button type="button" onClick={() => void api.del("people/recent").then(() => recent.reload())} className="min-h-9 px-1 text-xs text-muted-foreground underline">Clear</button>
          </p>
        )}
        <div className="mt-2">
          <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} className={QUIET} data-testid="filters-toggle">{filtersOpen ? "Hide filters" : `Filters${isEmptyFilter(filter) ? "" : ` (${Object.keys(filter).length})`}`}</button>
        </div>
        {filtersOpen && (
          <div className="mt-2 space-y-3 border-t pt-3">
            <FilterBuilder key={version} opts={opts.data} value={filter} onChange={setFilter} onClear={() => replaceFilter({})} plus={plus} />
          </div>
        )}
      </div>

      {/* ---- search results ---- */}
      {searching ? (
        <section aria-label="Search results" data-testid="people-results">
          {results.loading && !results.data ? <SkeletonRows rows={6} label="Finding people..." /> : results.error ? <ErrorState error={results.error} onRetry={results.reload} /> : results.data ? (
            <>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold" aria-live="polite" data-testid="people-count">{countWords(results.data.total, results.data.capped)} {results.data.total === 1 && !results.data.capped ? "person" : "people"}</h2>
                  <p className="text-xs text-muted-foreground">{describeFilter(effective, { owner: (id) => names.owner(id), account: (id) => names.account(id) })}</p>
                </div>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(listText(results.data!.rows, showAccount)).catch(() => undefined); }} className={QUIET}>Copy this page</button>
              </div>
              {bulk && <BulkBar picked={results.data.rows.filter((r) => ticked.has(r.rowId))} filter={effective} canExport owners={opts.data?.owners ?? []} canOwner onClear={() => setTick({ fk, ids: new Set() })} onDone={() => { setTick({ fk, ids: new Set() }); fnd.reload(); }} />}
              <PersonRows rows={results.data.rows} showAccount={showAccount} actions={actions} onOpen={(i) => openFrom("search", i)} testId="people-list" plus={plus} select={bulk ? { picked: ticked, toggle } : undefined}
                empty="Nobody matches. Check the spelling, try part of the email or the last digits of the phone number, or clear a filter." />
              {plus ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="people-more">
                  <span>Showing {fmtInt(results.data.rows.length)} of {countWords(results.data.total, results.data.capped)}</span>
                  {fnd.next && <Btn variant="secondary" onClick={fnd.more} disabled={fnd.busy} testId="load-more">{fnd.busy ? "Loading..." : "Load more"}</Btn>}
                </div>
              ) : <Pager page={results.data.page} pages={Math.ceil(results.data.total / results.data.pageSize)} from={(results.data.page - 1) * results.data.pageSize + 1} to={Math.min(results.data.total, results.data.page * results.data.pageSize)} total={results.data.total} capped={results.data.capped} onPage={(n) => setSp({ fk, n })} />}
              {results.data.total > 0 && !isEmptyFilter(filter) && (
                <div className="mt-4 border-t pt-3"><SaveList filter={effective} canShare={opts.data?.canShareLists ?? false} onSaved={() => void saved.reload()} /></div>
              )}
              {results.data.total > 0 && <div className="mt-3 space-y-1"><DialNote /></div>}
            </>
          ) : null}
        </section>
      ) : (
        <>
          {home.loading && !h ? <SkeletonRows rows={6} label="Loading your lists..." /> : home.error ? <ErrorState error={home.error} onRetry={home.reload} /> : h ? (
            <>
              {/* ---- the one sentence and the one button ---- */}
              <section aria-label="Who to call" data-testid="people-headline">
                <h2 className="text-xl font-semibold leading-snug" data-testid="people-say">{h.say.head}</h2>
                {h.say.also && <p className="mt-1 text-sm text-muted-foreground">{h.say.also}</p>}
                {h.say.allClear
                  ? <p className="mt-1 text-sm text-muted-foreground" data-testid="people-clear">Search for someone above, or open Going cold to see who has gone quiet{h.multi ? " across your clients" : ""}.</p>
                  : h.page && h.page.rows.length > 0 && list === h.start && !picked ? <p className="mt-3"><button type="button" onClick={() => setOpen({ src: "list", i: 0 })} className={PRIMARY} data-testid="people-start">Start with {h.page.rows[0].name}</button></p> : null}
              </section>

              {/* ---- the lists ---- */}
              <section aria-label="Call lists">
                <div role="group" aria-label="Choose a list" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b" data-testid="people-lists">
                  {LIST_IDS.map((id) => {
                    const c = h.counts.find((x) => x.id === id);
                    const li = h.lists.find((l) => l.id === id)!;
                    const on = id === list;
                    return (
                      <button key={id} type="button" aria-pressed={on} onClick={() => pickList(id)} data-testid={`list-${id}`}
                        className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 py-1 text-sm transition-colors sm:min-h-10 ${on ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                        {li.chip} <span className="tabular-nums text-xs">{countWords(c?.total ?? 0, !!h.capped[id])}</span>
                      </button>
                    );
                  })}
                </div>
                {(saved.data?.lists ?? []).length > 0 && (
                  <p className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm" data-testid="saved-chips">
                    <span className="mr-1 text-xs text-muted-foreground">Your lists</span>
                    {saved.data!.lists.map((l) => <button key={l.id} type="button" onClick={() => { replaceFilter(l.filter); setFiltersOpen(true); }} className="min-h-9 border-b border-transparent px-1.5 font-medium hover:border-primary" data-testid="saved-chip">{l.name}</button>)}
                  </p>
                )}
                {info && <p className="mb-2 text-sm text-muted-foreground" data-testid="list-help">{info.help} <span className="text-xs">{info.same}</span></p>}
                {(h.canMine && (count?.mine ?? 0) > 0) || (h.staff && mine) ? (
                  <div role="group" aria-label="Whose people" className="mb-3 flex gap-1 text-sm" data-testid="mine-switch">
                    <button type="button" aria-pressed={mine} onClick={() => pickMine(true)} className={`min-h-11 rounded-md border px-3 sm:min-h-9 ${mine ? "border-primary font-medium" : "text-muted-foreground"}`}>Mine {fmtInt(count?.mine ?? 0)}</button>
                    <button type="button" aria-pressed={!mine} onClick={() => pickMine(false)} className={`min-h-11 rounded-md border px-3 sm:min-h-9 ${!mine ? "border-primary font-medium" : "text-muted-foreground"}`}>Everyone {fmtInt(count?.total ?? 0)}</button>
                  </div>
                ) : h.staff && (count?.mine ?? 0) === 0 && (count?.total ?? 0) > 0 ? <p className="mb-3 text-xs text-muted-foreground" data-testid="mine-none">Nobody is assigned to you in this list, so it shows everyone.</p> : null}

                {!first && queue.loading && !queue.data ? <SkeletonRows rows={5} label="Loading this list..." /> : !first && queue.error ? <ErrorState error={queue.error} onRetry={queue.reload} /> : page ? (
                  <>
                    <PersonRows rows={page.rows} showAccount={showAccount} actions={actions} onOpen={(i) => setOpen({ src: "list", i })} testId="people-rows" plus={plus}
                      empty={mine ? "Nobody assigned to you is on this list. Choose Everyone to see the rest." : "Nobody is on this list right now. That is good news."} />
                    <Pager page={page.page} pages={page.pages} from={page.from} to={page.to} total={page.total} capped={page.capped} onPage={setPageNo} />
                    {page.withoutContact > 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="no-contact-note">{page.withoutContact} {list === "stale" ? (page.withoutContact === 1 ? "deal has" : "deals have") : (page.withoutContact === 1 ? "booking has" : "bookings have")} no contact attached, so there is nobody to call. They are not listed.</p>}
                    {page.capped && <p className="mt-2 text-xs text-muted-foreground">This list is cut at its first {list === "stale" ? "100 deals" : "400 people"}; the number above says how many there are.</p>}
                    {page.rows.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <DialNote className="max-w-md" />
                        <span className="flex items-center gap-4"><button type="button" onClick={() => { void navigator.clipboard?.writeText(listText(page.rows, showAccount)).catch(() => undefined); }} className={QUIET}>Copy this page</button></span>
                      </div>
                    )}
                  </>
                ) : null}
              </section>

              {/* ---- recently opened ---- */}
              {(recent.data?.people.length ?? 0) > 0 && (
                <section aria-label="Recently opened" data-testid="recent-people">
                  <div className="mb-1 flex items-end justify-between gap-2"><h2 className="text-base font-semibold">Recently opened</h2><button type="button" onClick={() => void api.del("people/recent?what=opened").then(() => recent.reload())} className={QUIET} data-testid="clear-opened">Clear</button></div>
                  <PersonRows rows={recent.data!.people.slice(0, 5)} showAccount={showAccount} actions={actions} onOpen={(i) => setOpen({ src: "recent", i })} testId="recent-rows" />
                </section>
              )}

              {(saved.data?.lists ?? []).length > 0 && (
                <details className="text-sm" data-testid="manage-lists">
                  <summary className="min-h-9 cursor-pointer text-muted-foreground">Manage your saved lists</summary>
                  <div className="mt-2"><ManageLists lists={saved.data!.lists} names={names} onOpen={(f) => { replaceFilter(f); setFiltersOpen(true); }} onChanged={() => void saved.reload()} /></div>
                </details>
              )}
            </>
          ) : null}
        </>
      )}

      {open && <LeadDrawer leads={drawerRows.map(toSeed)} index={open.i} onIndex={(i) => setOpen({ src: open.src, i })} onClose={close} showAccount={showAccount} onLogged={() => { dirty.current = true; }} />}
    </div>
  );
}
