"use client";

import { useState } from "react";
import { barTooltip, KIND_LABEL, KINDS, kindColour, type AccountBar, type Kind, type QueueRow } from "@/lib/analytics/today-queue";

// "Where the work is": ONE stacked bar per client account (agency, all accounts). The bar is split by kind of thing in the chart colours (one colour per kind everywhere), sorted by
// how much there is to do, at most 8 bars and then "N more" (which opens the full list, so 100 accounts look like 8). Every part of a bar is a button that opens exactly its own
// records: a SEGMENT opens that client account's records of that kind, the NAME opens that account's records of every kind, and the number at the end is the sum of the segments.
// The count on a mark is the count of rows in the list it opens. Only drawn for more than one client account: for one account a chart cannot say anything a list does not.
export function AccountBars({ title, bars, rows, more, onSegment, onAccount, onMore }: {
  title: string; bars: AccountBar[]; rows: QueueRow[];
  /** Accounts beyond the bars shown. */
  more: number;
  onSegment: (locationId: string, kind: Kind) => void; onAccount: (locationId: string) => void; onMore: () => void;
}) {
  const [hot, setHot] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const tip = bars.find((b) => b.locationId === hot) ?? null;
  const present = KINDS.filter((k) => bars.some((b) => (b.byKind[k] ?? 0) > 0));
  return (
    <figure className="min-w-0" data-testid="account-bars">
      <figcaption className="mb-2 text-sm font-medium leading-5" data-testid="bars-title">{title}</figcaption>
      <ul className="space-y-0.5">
        {bars.map((b) => (
          <li key={b.locationId} data-testid="account-bar" data-account={b.locationId} data-count={b.count} className="grid min-h-8 grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
            onMouseEnter={() => setHot(b.locationId)} onMouseLeave={() => setHot(null)}>
            <button type="button" onClick={() => onAccount(b.locationId)} onFocus={() => setHot(b.locationId)} data-testid="bar-account" aria-label={`${b.name}, ${b.count.toLocaleString("en-US")} ${b.count === 1 ? "thing" : "things"}. Show everything for this client.`}
              className="ds-press min-h-8 truncate rounded-md px-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={b.name}>{b.name}</button>
            <span className="relative block h-5 border-l border-foreground/30">
              <span className="flex h-full gap-[2px]" style={{ width: `${(b.count / max) * 100}%` }}>
                {KINDS.filter((k) => (b.byKind[k] ?? 0) > 0).map((k, i, all) => (
                  <button key={k} type="button" onClick={() => onSegment(b.locationId, k)} onFocus={() => setHot(b.locationId)} data-testid="bar-segment" data-kind={k} data-count={b.byKind[k]} data-account={b.locationId}
                    aria-label={`${b.name}, ${KIND_LABEL[k].toLowerCase()}, ${b.byKind[k]}. Show them.`} title={`${KIND_LABEL[k]}: ${b.byKind[k]}`}
                    className={`ds-press block h-full min-w-1.5 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] ${i === all.length - 1 ? "rounded-r-[4px]" : ""}`} style={{ flex: b.byKind[k], background: kindColour(k) }} />
                ))}
              </span>
            </span>
            <span className="tnum text-right font-medium" data-testid="bar-total">{b.count.toLocaleString("en-US")}</span>
          </li>
        ))}
        {more > 0 && (
          <li className="grid min-h-8 grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
            <button type="button" onClick={onMore} data-testid="bars-more" className="ds-press col-span-3 min-h-8 w-fit rounded-md px-1.5 text-left font-medium text-primary underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]">+{more.toLocaleString("en-US")} more {more === 1 ? "client" : "clients"}, see all</button>
          </li>
        )}
      </ul>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="What the colours mean">
        {present.map((k) => <li key={k} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: kindColour(k) }} />{KIND_LABEL[k]}</li>)}
      </ul>
      <p className="mt-1 min-h-5 text-sm leading-5" role="status" aria-live="polite" data-testid="bars-tip">{tip ? barTooltip(tip, rows) + "." : ""}</p>
      <div className="sr-only"><table><caption>{title}</caption><thead><tr><th>Client account</th><th>Things to fix</th></tr></thead><tbody>{bars.map((b) => <tr key={b.locationId}><td>{b.name}</td><td>{b.count}</td></tr>)}</tbody></table></div>
    </figure>
  );
}
