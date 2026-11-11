"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { ApSlot, fixturesOn, useAp, type ApFilters, type ApRows } from "./data";
import { ApTable, csvDownload, Pager } from "./parts";
import type { ApPart, ApRow } from "./types";

/**
 * A server-paged worklist of appointments for one part (the Needs outcome list, the No-show recovery list, and every list a number opens).
 * Paging is by cursor: the server hands back where the next page starts, so page 50 costs the same as page 1. The count in the header is the number of rows behind it.
 * An empty list always says what to do next (clear the filters, or widen the dates), never just "nothing".
 */
export function ApWorklist({ part, filters, extra, onOpen, activeId, showAccount, empty, emptyBody, testId, selectable, onRows, onClear }: {
  part: ApPart; filters: ApFilters; extra?: Record<string, string | number | undefined>; onOpen: (r: ApRow) => void; activeId?: string | null; showAccount: boolean;
  empty: string; emptyBody?: string; testId: string; selectable?: boolean; onRows?: (rows: ApRow[], total: number) => void; onClear?: () => void;
}) {
  const [page, setPage] = useState(1), [size, setSize] = useState(20);
  const [cursors, setCursors] = useState<Record<number, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const key = JSON.stringify(extra ?? {}) + JSON.stringify(filters) + part;
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setPage(1); setCursors({}); setSel(new Set()); }
  const after = !fixturesOn() && page > 1 ? cursors[page] : undefined;
  const { data, error, loading, reload } = useAp<ApRows>(part, filters, { ...extra, ...(after ? { after, page: 1 } : { page }), pageSize: size });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) onRows?.(data.rows, data.total); }, [data]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={6} label="Loading appointments..." />;
  if (data.total === 0) {
    const action: ReactNode = onClear ? <button type="button" className="s6-btn" onClick={onClear} data-testid="ap-empty-clear">Clear filters</button> : undefined;
    return <EmptyState title={empty} body={emptyBody ?? (onClear ? "Nothing matches the filters you chose. Clear them to see everything again." : "Change the dates or filters above to look further back.")} action={action} />;
  }
  const unmarkedHere = data.rows.filter((r) => (r.status === "booked" || r.status === "confirmed") && r.hoursPast !== null && r.hoursPast > 0).length;
  const headline = part === "needs-outcome" ? `${data.total} past appointment${data.total === 1 ? " has" : "s have"} no outcome. Open each one and mark it showed or no-show.` : part === "no-show-recovery" ? `${data.total} no-show${data.total === 1 ? "" : "s"} not booked again. Open each one and win them back.` : `${data.total} appointment${data.total === 1 ? "" : "s"} in this list${unmarkedHere ? `, ${unmarkedHere} on this page still need an outcome` : ""}. Open one to see the person and decide the next step.`;
  const chosen = data.rows.filter((r) => sel.has(r.id));
  const go = (p: number) => {
    if (p > page && data.next) setCursors((c) => ({ ...c, [p]: data.next as string })); // the next page continues after the last row seen
    setPage(p);
  };
  return (
    <div data-testid={testId} aria-busy={loading}>
      {selectable && sel.size > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="ap-bulkbar"><b>{sel.size} selected</b><ApSlot name="BulkActions" rows={chosen} onChanged={reload} filters={filters} /><button type="button" className="ap-link" onClick={() => setSel(new Set())}>Clear</button></div>}
      <p className="ap-headline" data-testid="ap-list-headline">{headline}</p>
      <div className="mb-2 text-right"><button type="button" className="ap-link" onClick={() => csvDownload(data.rows)} data-testid="ap-csv" title="Download the rows on this page as a spreadsheet file">Download CSV</button></div>
      <div className="ap-tablewrap" style={{ opacity: loading ? 0.7 : 1 }}>
        <ApTable rows={data.rows} showAccount={showAccount} onOpen={onOpen} activeId={activeId} selectable={selectable} selected={sel} onChanged={reload} onSelect={(id, on) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; })} />
        <Pager total={data.total} page={page} size={size} onPage={go} onSize={(s) => { setSize(s); setPage(1); setCursors({}); }} />
      </div>
    </div>
  );
}
