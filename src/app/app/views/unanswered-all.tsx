"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "../session";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { PersonRows, usePersonActions, type WaitRow } from "./unanswered-rows";

// The full list behind a number, the same for every number on the screen: "See all", a bar of the chart, a client, an owner. The server chooses, searches, sorts, filters and
// pages the people (50 at most), so 150 clients and thousands of people cost the same as 6. The count in the heading is the server's total for exactly these people, and it is
// the number that was pressed (KF-6): both come from one selection (src/lib/analytics/unanswered-v2.ts selectPeople). A person who owns several waiting conversations is one row.

export type Facets = {
  buckets: Record<"all" | "h1" | "h4" | "h24" | "h48", number>; owner: { all: number; none: number; mine: number };
  channels: Array<{ key: string; label: string; count: number }>; visibleBuckets: Array<{ key: string; label: string }>;
};
type ListData = { total: number; page: number; pages: number; from: number; to: number; rows: WaitRow[]; truncated: boolean; facets: Facets };

const SORTS: Array<{ key: string; label: string }> = [{ key: "wait", label: "Longest wait first" }, { key: "newest", label: "Newest first" }, { key: "name", label: "Name" }, { key: "account", label: "Client account" }];
const field = "min-h-11 rounded-lg border bg-card px-3 text-sm outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-9";
const chip = (on: boolean) => `ds-press min-h-11 rounded-md px-2.5 text-sm font-medium sm:min-h-9 ${on ? "bg-accent text-foreground underline underline-offset-4" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;

export function WaitList({ title, params, showAccount, canMine, noun = "people", onBack, backLabel = "Back" }: {
  title: string;
  /** What the list is about: bucket, account, owner. The search, sort, chips, channel and page are added here. */
  params: Record<string, string>;
  showAccount: boolean; canMine: boolean; noun?: string; onBack: () => void; backLabel?: string;
}) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("wait");
  const [bucket, setBucket] = useState(params.bucket ?? "all");
  const [owner, setOwner] = useState(params.owner ?? "");
  const [channel, setChannel] = useState("");
  const [page, setPage] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // A list opened from a number takes the keyboard to its heading, so a screen reader says what opened.
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    timer.current = setTimeout(() => { setQ(text.trim()); setPage(0); }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [text]);

  const sp = new URLSearchParams({ part: "list", sort, page: String(page), size: "25" });
  if (params.account) sp.set("account", params.account);
  if (bucket !== "all") sp.set("bucket", bucket);
  if (owner) sp.set("owner", owner);
  if (channel) sp.set("channel", channel);
  if (q) sp.set("q", q);
  const { data, error, loading, reload } = useData<ListData>(`inbox?${sp}`);
  const rows = data?.rows ?? [];
  const actions = usePersonActions(rows);
  const f = data?.facets;
  const narrowed = bucket !== "all" || owner !== "" || channel !== "" || q !== "";

  return (
    <section aria-label={`List: ${title}`} data-testid="wait-list" className="mb-8">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none" data-testid="wait-list-title">{data ? `${title}: ` : title}{data && <span data-testid="wait-list-count">{data.total.toLocaleString("en-US")}</span>}{data ? ` ${data.total === 1 ? noun.replace(/people$/, "person") : noun}` : ""}</h2>
        <button type="button" onClick={onBack} className="min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline sm:min-h-9" data-testid="wait-list-back">{backLabel}</button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Search and sort this list">
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, client, channel, email or phone" aria-label="Search this list" className={`${field} min-w-0 flex-1 sm:max-w-sm`} data-testid="wait-list-search" />
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} aria-label="Sort this list" className={field} data-testid="wait-list-sort">
          {SORTS.filter((s) => showAccount || s.key !== "account").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {f && f.channels.length > 1 && (
          <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(0); }} aria-label="Channel" className={field} data-testid="wait-list-channel">
            <option value="">All channels</option>
            {f.channels.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
          </select>
        )}
      </div>
      {f && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0" role="group" aria-label="How long they have waited">
          <button type="button" className={chip(bucket === "all")} aria-pressed={bucket === "all"} onClick={() => { setBucket("all"); setPage(0); }} data-testid="chip-all">Any wait {f.buckets.all.toLocaleString("en-US")}</button>
          {f.visibleBuckets.map((b) => (
            <button key={b.key} type="button" className={chip(bucket === b.key)} aria-pressed={bucket === b.key} disabled={f.buckets[b.key as "h1"] === 0 && bucket !== b.key} onClick={() => { setBucket(b.key); setPage(0); }} data-testid={`chip-${b.key}`}>
              {b.label} {f.buckets[b.key as "h1"].toLocaleString("en-US")}
            </button>
          ))}
        </div>
      )}
      {f && (f.owner.none > 0 || f.owner.mine > 0 || owner !== "") && (
        <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Who has them">
          {owner !== "none" && owner !== "me" && owner !== "" && <button type="button" className={chip(true)} aria-pressed onClick={() => { setOwner(""); setPage(0); }} data-testid="chip-owner-picked">One owner (clear)</button>}
          <button type="button" className={chip(owner === "")} aria-pressed={owner === ""} onClick={() => { setOwner(""); setPage(0); }}>Everyone {f.owner.all.toLocaleString("en-US")}</button>
          {f.owner.none > 0 && <button type="button" className={chip(owner === "none")} aria-pressed={owner === "none"} onClick={() => { setOwner("none"); setPage(0); }} data-testid="chip-none">No owner {f.owner.none.toLocaleString("en-US")}</button>}
          {canMine && f.owner.mine > 0 && <button type="button" className={chip(owner === "me")} aria-pressed={owner === "me"} onClick={() => { setOwner("me"); setPage(0); }} data-testid="chip-mine">Mine {f.owner.mine.toLocaleString("en-US")}</button>}
        </div>
      )}
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={4} label="Loading the people..." />
        : rows.length === 0 ? <EmptyState compact title={narrowed ? "Nobody matches." : "No one is behind this number."} body={narrowed ? "Clear the search or a choice above to see the rest." : undefined} />
        : (
          <div aria-busy={loading} className={loading ? "opacity-70" : ""}>
            <PersonRows rows={rows} showAccount={showAccount} actions={actions} testId="wait-list-rows" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span data-testid="wait-list-range" aria-live="polite">{data.from.toLocaleString("en-US")} to {data.to.toLocaleString("en-US")} of {data.total.toLocaleString("en-US")}</span>
              {data.pages > 1 && (
                <span className="flex items-center gap-1">
                  <button type="button" disabled={data.page === 0} onClick={() => setPage(data.page - 1)} className={`${chip(false)} disabled:opacity-40`}>Previous</button>
                  <span className="tabular-nums">Page {data.page + 1} of {data.pages}</span>
                  <button type="button" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} className={`${chip(false)} disabled:opacity-40`} data-testid="wait-list-next">Next</button>
                </span>
              )}
            </div>
            {data.truncated && <p className="mt-2 text-xs text-muted-foreground">SubSync reads the 20,000 conversations that have waited longest. Newer ones are not in this list.</p>}
          </div>
        )}
      {actions.drawer}
    </section>
  );
}
