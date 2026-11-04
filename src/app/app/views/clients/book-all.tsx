"use client";

import { useEffect, useRef, useState } from "react";
import { FILTER_WORDS, FILTERS, SORT_WORDS, SORTS, type Filter } from "@/lib/analytics/clients-v2";
import { useData } from "../../session";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { ClientRows, type Editing } from "./book-rows";
import type { BookList } from "./types";

// The whole client book, searched, filtered, ordered and paged ON THE SERVER (25 a page), so 6 clients and 150 cost the same and the browser never holds them all. The count in the
// heading and on every chip is the server's own count for exactly these rows: both come from clients-v2.ts `selectClients` (a test walks every page of every filter).

const field = "min-h-11 rounded-lg border bg-card px-3 text-sm outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-9";
const chip = (on: boolean) => `ds-press min-h-11 rounded-md px-2.5 text-sm font-medium sm:min-h-9 ${on ? "bg-accent text-foreground underline underline-offset-4" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;

export function ClientList({ initial, version, autoEditFee, onChanged, onOpen, onCopy, onBack }: {
  initial: Filter; version: number; autoEditFee?: boolean; onChanged: () => void; onOpen: (id: string) => void; onCopy: (id: string) => void; onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>(initial);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initial === "renewing" || initial === "overdue" ? "renewal" : "attention");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [text]);

  const sp = new URLSearchParams({ part: "list", filter, sort, page: String(page), size: "25", v: String(version) });
  if (q) sp.set("q", q);
  const { data, error, loading, reload } = useData<BookList>(`clients?${sp}`);
  // From "Add your first client fee": the first client's fee opens for typing once the list is here.
  useEffect(() => {
    if (autoEditFee && data && data.rows.length > 0 && !opened.current) { opened.current = true; setEditing({ id: data.rows[0].id, field: "fee" }); }
  }, [autoEditFee, data]);

  const facets = data?.facets;
  const shown = FILTERS.filter((f) => f === "all" || f === filter || (facets?.[f] ?? 0) > 0);
  const title = filter === "all" ? "All clients" : FILTER_WORDS[filter];
  return (
    <section aria-label="All clients" data-testid="book-list" className="mb-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none" data-testid="book-list-title">{title}{data && <>: <span data-testid="book-list-count">{data.total.toLocaleString("en-US")}</span> {data.total === 1 ? "client" : "clients"}</>}</h2>
        <button type="button" onClick={onBack} className="min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline sm:min-h-9" data-testid="book-list-back">Back to who needs you</button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Search and order the clients">
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name or industry" aria-label="Search the clients" className={`${field} min-w-0 flex-1 sm:max-w-sm`} data-testid="book-search" />
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} aria-label="Order the clients" className={field} data-testid="book-sort">
          {SORTS.map((s) => <option key={s} value={s}>{SORT_WORDS[s]}</option>)}
        </select>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Narrow the clients">
        {shown.map((f) => (
          <button key={f} type="button" className={chip(filter === f)} aria-pressed={filter === f} onClick={() => { setFilter(f); setPage(0); }} data-testid={`chip-${f}`}>
            {FILTER_WORDS[f]}{facets ? ` ${facets[f].toLocaleString("en-US")}` : ""}
          </button>
        ))}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={5} label="Loading the clients..." />
        : data.rows.length === 0 ? <EmptyState compact title={q ? "No client matches." : "Nobody here."} body={q ? "Clear the search to see the rest." : "Choose another group above."} />
        : (
          <div aria-busy={loading} className={loading ? "opacity-70" : ""}>
            <ClientRows rows={data.rows} choices={data.industryChoices} inNeeds={filter === "needs" || filter === "at_risk" || filter === "watch"} editing={editing} setEditing={setEditing} onChanged={() => { onChanged(); void reload(); }} onOpen={onOpen} onCopy={onCopy} testId="book-list-rows" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span data-testid="book-list-range" aria-live="polite">{data.from.toLocaleString("en-US")} to {data.to.toLocaleString("en-US")} of {data.total.toLocaleString("en-US")}</span>
              {data.pages > 1 && (
                <span className="flex items-center gap-1">
                  <button type="button" disabled={data.page === 0} onClick={() => setPage(data.page - 1)} className={`${chip(false)} disabled:opacity-40`}>Previous</button>
                  <span className="tabular-nums">Page {data.page + 1} of {data.pages}</span>
                  <button type="button" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} className={`${chip(false)} disabled:opacity-40`} data-testid="book-list-next">Next</button>
                </span>
              )}
            </div>
          </div>
        )}
    </section>
  );
}
