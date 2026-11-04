"use client";

import { useState } from "react";
import { KIND_LABEL, type HistoryRow, type Kind } from "@/lib/analytics/history-intel";
import { EmptyState, ErrorState, HowTo, InlineAlert, SkeletonRows } from "../ds";
import { useApiClient, useData } from "../session";
import { fmtInt, timeAgo } from "../ui";
import { BTN, FIELD } from "./cleanup-parts";

// The Clean-up history (stage CLEANUP): every decision, set-aside, "merged in your CRM", merge request, clean-up run, rule change and "switched off, nothing sent" line, with
// who and when. A decision that is still in force can be taken back here. Compact rows on one grid (KF-8): one line of what happened, one line of who and when, one small button.

type Data = { rows: HistoryRow[]; page: number; pages: number; total: number; counts: Record<Kind, number> };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function HistoryTab() {
  const api = useApiClient();
  const [kind, setKind] = useState<Kind | "">("");
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useData<Data>(`duplicates/history?page=${page}${kind ? `&kind=${kind}` : ""}`);
  const [busy, setBusy] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const undo = async (r: HistoryRow) => {
    if (!r.undo) return;
    setBusy(r.id); setProblem(null); setDone(null);
    try {
      await api.post(r.undo.kind === "review" ? "duplicates/undo" : "duplicates/undo-snooze", { locationId: r.undo.locationId, key: r.undo.key });
      setDone("Taken back. The group is in the Duplicates list again.");
      await reload();
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(null); }
  };

  if (!data && loading) return <SkeletonRows rows={6} />;
  if (!data) return error ? <ErrorState error={error} onRetry={reload} /> : null;
  const total = Object.values(data.counts).reduce((s, n) => s + n, 0);

  return (
    <div data-testid="history-tab">
      <HowTo id="history" title="Everything that was decided or changed">
        Each line says what happened, who did it and when. A decision that still stands has an Undo button. Merges and changes made in your CRM are not undone from here.
      </HowTo>
      {problem && <div className="mb-3"><InlineAlert tone="danger" onDismiss={() => setProblem(null)}>{problem}</InlineAlert></div>}
      {done && <div className="mb-3" role="status"><InlineAlert tone="info" onDismiss={() => setDone(null)}>{done}</InlineAlert></div>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Show
          <select className={FIELD} value={kind} onChange={(e) => { setKind(e.target.value as Kind | ""); setPage(0); }} aria-label="Kind of event" data-testid="history-kind">
            <option value="">Everything ({fmtInt(total)})</option>
            {(Object.keys(KIND_LABEL) as Kind[]).filter((k) => data.counts[k] > 0).map((k) => <option key={k} value={k}>{KIND_LABEL[k]} ({fmtInt(data.counts[k])})</option>)}
          </select>
        </label>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="Nothing here yet" body="When you decide about a duplicate, tidy contacts or change a rule, it is listed here with who did it and when." />
      ) : (
        <ul data-testid="history-list" className={loading ? "opacity-70" : ""}>
          {data.rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5" data-testid="history-row" data-kind={r.kind}>
              <div className="min-w-0">
                <p className="line-clamp-2 break-words text-sm">{r.text}</p>
                <p className="truncate text-xs text-muted-foreground">{r.who} · {when(r.at)} ({timeAgo(r.at)}){r.dryRun ? " · nothing was sent" : ""}</p>
              </div>
              {r.undo ? <button type="button" className={`${BTN} min-h-11 px-3 sm:min-h-8`} disabled={busy === r.id} onClick={() => void undo(r)} data-testid="history-undo">Undo<span className="sr-only"> this decision</span></button> : <span />}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-xs text-muted-foreground" data-testid="history-range">{data.total === 0 ? "" : `Page ${data.page + 1} of ${data.pages} · ${fmtInt(data.total)} lines`}</span>
        <span className="flex gap-2"><button type="button" className={BTN} disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>Previous</button><button type="button" className={BTN} disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)}>Next</button></span>
      </div>
    </div>
  );
}
