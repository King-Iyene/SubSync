"use client";

import type { TodayItem } from "@/lib/analytics/today-queue";
import { DrillPanel, type DrillState } from "./drill";
import type { Column } from "./data-list";

// The list behind a chart mark or a queue row on Today: exactly the rows the number counts, with the count in its heading, so the number on a slice or a row and
// the rows listed here are the same number. A name opens the lead panel, whose arrows step through this list. The way back closes it.
const columns: Array<Column<TodayItem>> = [
  { key: "name", header: "What", primary: true, width: "minmax(0,1.6fr)", cell: (i) => i.name },
  { key: "account", header: "Client account", width: "minmax(0,1.2fr)", cell: (i) => <span className="text-muted-foreground">{i.accountName}</span> },
  { key: "detail", header: "Detail", width: "minmax(0,2fr)", cell: (i) => <span className="text-muted-foreground">{i.detail}</span> },
];

export function RowsPanel({ title, count, noun, items, onClose }: { title: string; count: number; noun: string; items: TodayItem[]; onClose: () => void }) {
  const drill: DrillState = { selected: 0, open: true, select: () => undefined, close: onClose, reopen: () => undefined, clear: onClose };
  return (
    <div id="today-list" data-testid="today-list">
      <DrillPanel drill={drill} title={title} count={count} noun={noun} rows={items} columns={columns} rowKey={(i) => i.id} backLabel="Close the list"
        toLead={(i) => ({ contactId: i.contactId ?? "", locationId: i.locationId, name: i.name, locationName: i.accountName, url: i.url, note: i.detail })} />
    </div>
  );
}
