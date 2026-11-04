"use client";

import { useState } from "react";
import { shortWords } from "@/lib/analytics/unanswered-v2";
import { useData } from "../session";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";

// The two pictures under the first rows: how long the people have waited (the one chart; each bar opens exactly the people it counts) and who has them (a short ranking of
// clients for an agency, of the people who own the customers inside one account). Every number is a real button that opens its list. Top five and "See all N", searched
// and paged on the server, so 150 clients look like 6.

export type OpenList = (spec: { title: string; params: Record<string, string>; noun?: string }) => void;
export type BucketOut = { key: string; label: string; count: number };
export type AccountRankOut = { id: string; name: string; count: number; oldestHours: number };
export type OwnerRankOut = { key: string; label: string; state: string; count: number; oldestHours: number };

const link = "ds-press min-h-11 rounded-md px-1.5 text-left font-medium text-primary underline underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9";

/** A number that opens its list. A real button, so the keyboard and a screen reader get it. */
export function NumberButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-testid="number-button"
      className="ds-press tnum min-h-11 rounded-md px-1 text-left font-semibold underline decoration-1 underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9">{children}</button>
  );
}

const noun = (n: number) => (n === 1 ? "person" : "people");

/** One bar per wait. The whole row is one button (label, bar and number), at least 44 px high on a phone, and its number is the number of people it opens (KF-6). */
export function WaitedSection({ buckets, open, slaHours }: { buckets: BucketOut[]; open: OpenList; slaHours: number }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <section className="mb-10" aria-labelledby="waited-h" data-testid="wait-picture">
      <h2 id="waited-h" tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">How long they have waited</h2>
      <p className="mb-3 mt-0.5 text-sm text-muted-foreground">Each bar is the people who have waited that long. Press a bar to see them. Only people past your {slaHours}-hour reply target are counted.</p>
      <ul className="space-y-1" data-testid="wait-bars">
        {buckets.map((b) => {
          const tone = b.key === "h24" || b.key === "h48" ? "bg-warning" : "bg-[var(--chart-1)]";
          const inner = (
            <>
              <span className="truncate text-left text-sm">{b.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden><span className={`ds-grow-x block h-full rounded-full ${tone}`} style={{ width: `${(b.count / max) * 100}%`, minWidth: b.count > 0 ? 6 : 0 }} /></span>
              <span className="tnum min-w-8 text-right text-sm font-semibold">{b.count.toLocaleString("en-US")}</span>
            </>
          );
          const cls = "grid min-h-11 w-full grid-cols-[minmax(6rem,9.5rem)_1fr_auto] items-center gap-3 rounded-md px-1 sm:min-h-9";
          return (
            <li key={b.key}>
              {b.count > 0
                ? <button type="button" data-testid="wait-bar" data-bucket={b.key} data-count={b.count} onClick={() => open({ title: `Waiting ${b.label.toLowerCase()}`, params: { bucket: b.key } })} aria-label={`${b.label}: ${b.count} ${noun(b.count)}, open the list`} title="Click to see these people"
                    className={`ds-press ${cls} hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]`}>{inner}</button>
                : <div data-testid="wait-bar" data-bucket={b.key} data-count={0} className={`${cls} text-muted-foreground`}>{inner}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Paged<T> = { by: string; total: number; page: number; pages: number; from: number; to: number; rows: T[] };

function AccountRows({ rows, open }: { rows: AccountRankOut[]; open: OpenList }) {
  return (
    <ul className="divide-y border-y" data-testid="rank-accounts">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2" data-testid="rank-account-row" data-account={a.id}>
          <span className="min-w-0 truncate font-semibold" title={a.name}>{a.name}</span>
          <span className="tnum text-sm text-muted-foreground">
            longest {shortWords(a.oldestHours)} ·{" "}
            <NumberButton label={`${a.name}: ${a.count} ${noun(a.count)} waiting, open the list`} onClick={() => open({ title: a.name, params: { account: a.id } })}>{a.count} {noun(a.count)}</NumberButton>
          </span>
        </li>
      ))}
    </ul>
  );
}

function OwnerRows({ rows, open }: { rows: OwnerRankOut[]; open: OpenList }) {
  return (
    <ul className="divide-y border-y" data-testid="rank-owners">
      {rows.map((o) => (
        <li key={o.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2" data-testid="rank-owner-row">
          <span className="min-w-0 truncate font-semibold" title={o.label}>{o.label}</span>
          <span className="tnum text-sm text-muted-foreground">
            longest {shortWords(o.oldestHours)} ·{" "}
            <NumberButton label={`${o.label}: ${o.count} ${noun(o.count)} waiting, open the list`} onClick={() => open({ title: o.key === "none" ? "Nobody owns them" : `Owned by ${o.label}`, params: { owner: o.key } })}>{o.count} {noun(o.count)}</NumberButton>
          </span>
        </li>
      ))}
    </ul>
  );
}

function RanksPanel({ by, open, onBack }: { by: "account" | "owner"; open: OpenList; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const sp = new URLSearchParams({ part: "ranks", by, page: String(page), size: "25" });
  if (q) sp.set("q", q);
  const { data, error, reload } = useData<Paged<AccountRankOut & OwnerRankOut>>(`inbox?${sp}`);
  return (
    <div className="mt-3" data-testid="rank-all">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={by === "account" ? "Search client accounts" : "Search people"} aria-label="Search this list" className="min-h-11 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm sm:min-h-9 sm:max-w-sm" data-testid="rank-search" />
        <button type="button" onClick={onBack} className={link}>Back to the short list</button>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <SkeletonRows rows={4} label="Loading..." /> : data.rows.length === 0 ? <EmptyState compact title="Nothing matches." /> : (
        <>
          {by === "account" ? <AccountRows rows={data.rows} open={open} /> : <OwnerRows rows={data.rows} open={open} />}
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.from} to {data.to} of {data.total}</span>
            {data.pages > 1 && <span className="flex items-center gap-2"><button type="button" disabled={data.page === 0} onClick={() => setPage(data.page - 1)} className={`${link} disabled:opacity-40`}>Previous</button><button type="button" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} className={`${link} disabled:opacity-40`}>Next</button></span>}
          </div>
        </>
      )}
    </div>
  );
}

/** Where the waiting is: clients for an agency with more than one, the people who own the customers inside one account. A client's staff get neither (the server sends none). */
export function WhereSection({ accounts, owners, open }: { accounts: { total: number; rows: AccountRankOut[] } | null; owners: { total: number; rows: OwnerRankOut[] } | null; open: OpenList }) {
  const [all, setAll] = useState(false);
  const by = accounts ? ("account" as const) : owners ? ("owner" as const) : null;
  if (!by) return null;
  const list = by === "account" ? accounts! : owners!;
  return (
    <section className="mb-10" aria-labelledby="where-h" data-testid="wait-where">
      <h2 id="where-h" className="text-lg font-semibold tracking-tight">{by === "account" ? "Where people are waiting" : "Who has them"}</h2>
      <p className="mb-2 mt-0.5 text-sm text-muted-foreground">{by === "account" ? "Clients with the most people waiting first. Press a number to see them." : "The team member each customer is assigned to in your CRM, most waiting first. A customer nobody owns is listed as No owner."}</p>
      {all ? <RanksPanel by={by} open={open} onBack={() => setAll(false)} /> : (
        <>
          {by === "account" ? <AccountRows rows={accounts!.rows} open={open} /> : <OwnerRows rows={owners!.rows} open={open} />}
          {list.total > list.rows.length && <p className="mt-1 text-right"><button type="button" onClick={() => setAll(true)} className={link} data-testid="rank-see-all">See all {list.total.toLocaleString("en-US")}</button></p>}
        </>
      )}
    </section>
  );
}
