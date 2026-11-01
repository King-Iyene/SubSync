"use client";

import { useState, type ReactNode } from "react";
import { DataList, type Column } from "./data-list";
import { LeadDrawer, type LeadSeed } from "./lead-drawer";

// The list behind a chart mark (KF-6). A chart takes onSelect and the page keeps which mark is chosen with useDrill; this panel then shows exactly the rows
// that make up that mark's number, with the count in its heading. The rows and the number come from the same data, so they cannot disagree; when only part
// of the rows were sent (a cap), the panel says how many there really are. A name opens the lead panel, whose arrows step through THIS list. "Back to the
// chart" closes the list and the mark stays marked, so the person is back where they were; "Show the list" opens it again.
export type DrillState = { selected: number | null; open: boolean; select: (i: number) => void; close: () => void; reopen: () => void; clear: () => void };

export function useDrill(): DrillState {
  const [s, setS] = useState<{ selected: number | null; open: boolean }>({ selected: null, open: false });
  return {
    selected: s.selected, open: s.open,
    // Pressing the chosen mark again closes its list; pressing another one switches to that one.
    select: (i) => setS((cur) => (cur.selected === i && cur.open ? { selected: i, open: false } : { selected: i, open: true })),
    close: () => setS((cur) => ({ ...cur, open: false })),
    reopen: () => setS((cur) => (cur.selected === null ? cur : { ...cur, open: true })),
    clear: () => setS({ selected: null, open: false }),
  };
}

export function DrillPanel<T>({ drill, title, count, noun, rows, columns, rowKey, toLead, empty = "Nothing behind this one.", backLabel = "Back to the chart" }: {
  drill: DrillState; title: string;
  /** The number the chart shows for this mark. */
  count: number; noun: string;
  rows: readonly T[]; columns: Array<Column<T>>; rowKey: (row: T) => string; toLead: (row: T) => LeadSeed;
  empty?: string;
  /** What the way back is called where the list does not sit under a chart (the audit calls it "Back to the audit"). */
  backLabel?: string;
}) {
  const [index, setIndex] = useState<number | null>(null);
  if (drill.selected === null) return null;
  if (!drill.open) {
    return <p className="mt-3 text-xs text-muted-foreground" data-testid="drill-closed">{title}: {count} {noun}. <button type="button" onClick={drill.reopen} className="font-medium text-primary underline">Show the list</button></p>;
  }
  const seeds = rows.map(toLead);
  const heading: ReactNode = <>{title}: <span data-testid="drill-count">{count}</span> {noun}</>;
  return (
    <section className="mt-4" aria-label={`List behind ${title}`} data-testid="drill-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <button type="button" onClick={() => { setIndex(null); drill.close(); }} className="min-h-9 text-xs font-medium text-primary underline" data-testid="drill-back">{backLabel}</button>
      </div>
      <DataList rows={rows} columns={columns} rowKey={rowKey} total={count} empty={empty} onOpen={(_, i) => setIndex(i)} caption={title} />
      <LeadDrawer leads={seeds} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />
    </section>
  );
}
