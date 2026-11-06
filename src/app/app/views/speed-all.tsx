"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "../session";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { LeadRows, useLeadActions, type LeadRow } from "./speed-rows";

// The full list behind a number, the same for every number on the screen: "See all", a bar of the chart, a figure, a person, a client. The server chooses, searches,
// sorts and pages the leads (50 at most), so 150 clients and thousands of leads cost the same as 6. The count in the heading is the server's total for exactly these
// leads, and it is the number that was pressed (KF-6): both come from one selection (src/lib/analytics/speed-v2.ts selectLeads).

type ListData = {
  total: number; page: number; pages: number; from: number; to: number; rows: LeadRow[]; truncated: boolean;
  facets: { all: number; noOwner: number; mine: number; never: number };
};
const SORTS: Array<{ key: string; label: string }> = [{ key: "wait", label: "Longest wait first" }, { key: "newest", label: "Newest first" }, { key: "name", label: "Name" }, { key: "account", label: "Client account" }];
const field = "min-h-11 rounded-lg border bg-card px-3 text-sm outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-9";
const chip = (on: boolean) => `ds-press min-h-11 rounded-md px-2.5 text-sm font-medium sm:min-h-9 ${on ? "bg-accent text-foreground underline underline-offset-4" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;

export function LeadList({ title, params, showAccount, canMine, noun = "leads", onBack, backLabel = "Back" }: {
  title: string;
  /** What the list is about: status, window, person, account, week, source. The search, sort, chips and page are added here. */
  params: Record<string, string>;
  showAccount: boolean; canMine: boolean; noun?: string; onBack: () => void; backLabel?: string;
}) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(params.status === "waiting" || params.status === "onlyAuto" ? "wait" : "newest");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // A list opened from a number takes the keyboard to its heading, so a screen reader says what opened.
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    timer.current = setTimeout(() => { setQ(text.trim()); setPage(0); }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [text]);

  const sp = new URLSearchParams({ part: "list", ...params, sort, page: String(page), size: "40" });
  if (q) sp.set("q", q);
  if (owner) sp.set("owner", owner);
  const { data, error, loading, reload } = useData<ListData>(`speed?${sp}`);
  const rows = data?.rows ?? [];
  const actions = useLeadActions(rows);
  const head = data ? `${title}: ` : title;

  return (
    <section aria-label={`List: ${title}`} data-testid="speed-list" className="mb-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none" data-testid="speed-list-title">{head}{data && <span data-testid="speed-list-count">{data.total.toLocaleString("en-US")}</span>}{data ? ` ${data.total === 1 ? noun.replace(/s$/, "") : noun}` : ""}</h2>
        <button type="button" onClick={onBack} className="min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline sm:min-h-9" data-testid="speed-list-back">{backLabel}</button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Search and sort this list">
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, client, source, email or phone" aria-label="Search this list" className={`${field} min-w-0 flex-1 sm:max-w-sm`} data-testid="speed-list-search" />
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} aria-label="Sort this list" className={field} data-testid="speed-list-sort">
          {SORTS.filter((s) => showAccount || s.key !== "account").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      {data && (data.facets.noOwner > 0 || data.facets.mine > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Narrow this list">
          <button type="button" className={chip(owner === "")} aria-pressed={owner === ""} onClick={() => { setOwner(""); setPage(0); }}>All {data.facets.all.toLocaleString("en-US")}</button>
          {data.facets.noOwner > 0 && <button type="button" className={chip(owner === "none")} aria-pressed={owner === "none"} onClick={() => { setOwner("none"); setPage(0); }} data-testid="chip-none">No owner {data.facets.noOwner.toLocaleString("en-US")}</button>}
          {canMine && data.facets.mine > 0 && <button type="button" className={chip(owner === "me")} aria-pressed={owner === "me"} onClick={() => { setOwner("me"); setPage(0); }} data-testid="chip-mine">Mine {data.facets.mine.toLocaleString("en-US")}</button>}
        </div>
      )}
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={4} label="Loading the leads..." />
        : rows.length === 0 ? <EmptyState compact title={q || owner ? "No leads match." : "Nothing behind this number."} body={q || owner ? "Clear the search or the chip to see the rest." : undefined} />
        : (
          <div aria-busy={loading} className={loading ? "opacity-70" : ""}>
            <LeadRows rows={rows} showAccount={showAccount} actions={actions} testId="speed-list-rows" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span data-testid="speed-list-range" aria-live="polite">Showing {data.from.toLocaleString("en-US")} to {data.to.toLocaleString("en-US")} of {data.total.toLocaleString("en-US")}</span>
              {data.pages > 1 && (
                <span className="flex items-center gap-1">
                  <button type="button" disabled={data.page === 0} onClick={() => setPage(data.page - 1)} className={`${chip(false)} disabled:opacity-40`}>Previous</button>
                  {pageNumbers(data.page, data.pages).map((n, i) => n === null ? <span key={`g${i}`} aria-hidden>...</span> : <button key={n} type="button" aria-current={n === data.page ? "page" : undefined} aria-label={`Page ${n + 1}`} onClick={() => setPage(n)} className={`${chip(n === data.page)} tabular-nums`} data-testid="speed-list-page">{n + 1}</button>)}
                  <button type="button" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} className={`${chip(false)} disabled:opacity-40`} data-testid="speed-list-next">Next</button>
                </span>
              )}
            </div>
            {data.truncated && <p className="mt-2 text-xs text-muted-foreground">This range holds more leads than SubSync reads at once (20,000, newest first). Choose a shorter range to see the older ones.</p>}
          </div>
        )}
      {actions.drawer}
    </section>
  );
}

/** Page numbers to show: the first, the last, and two either side of the current one, with a gap mark between. */
export function pageNumbers(page: number, pages: number): Array<number | null> {
  const keep = new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 0 && n < pages));
  const out: Array<number | null> = []; let prev = -1;
  for (const n of [...keep].sort((a, b) => a - b)) { if (n - prev > 1) out.push(null); out.push(n); prev = n; }
  return out;
}
