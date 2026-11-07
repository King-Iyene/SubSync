"use client";

import { ColumnChart, type ColumnItem } from "./column-chart";
import { barTooltip, KIND_LABEL, KINDS, kindColour, type AccountBar, type Kind, type QueueRow } from "@/lib/analytics/today-queue";

// "Where the work sits": ONE stacked vertical column per client account (agency, all accounts), drawn by the shared ColumnChart so 200 clients fit the width.
// Segments are the kinds of thing in the chart colours (one colour per kind everywhere); a click on a colour opens that client's records of that kind, a click on
// the column opens that client's records of every kind. Sorting, Top 20 / 50 / All, the table view and the keyboard come from ColumnChart.
export function AccountBars({ title, bars, rows, onSegment, onAccount }: {
  title: string; bars: AccountBar[]; rows: QueueRow[];
  onSegment: (locationId: string, kind: Kind) => void; onAccount: (locationId: string) => void;
  /** Kept so older callers compile; every account is now a column, so there is no "more" link. */
  more?: number; onMore?: () => void;
}) {
  const present = KINDS.filter((k) => bars.some((b) => (b.byKind[k] ?? 0) > 0));
  const items: ColumnItem[] = bars.map((b) => ({
    key: b.locationId, label: b.name, note: barTooltip(b, rows).replace(`${b.name}: `, ""),
    segments: KINDS.filter((k) => (b.byKind[k] ?? 0) > 0).map((k) => ({ key: k, label: KIND_LABEL[k], value: b.byKind[k] ?? 0, colour: kindColour(k) })),
  }));
  return (
    <ColumnChart testId="account-bars" title={title} items={items} unit="things" subject="client"
      legend={present.map((k) => ({ key: k, label: KIND_LABEL[k], colour: kindColour(k) }))}
      onSelect={(id, seg) => (seg ? onSegment(id, seg as Kind) : onAccount(id))} />
  );
}
