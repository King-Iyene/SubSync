"use client";

import { useState } from "react";
import { ChartCard } from "./time-chart";
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
  const avgCount = bars.length ? bars.reduce((t, b) => t + b.count, 0) / bars.length : 0;
  const tipAt = tip ? bars.indexOf(tip) : -1;
  const present = KINDS.filter((k) => bars.some((b) => (b.byKind[k] ?? 0) > 0));
  return (
    <figure className="relative min-w-0" data-testid="account-bars">
      <figcaption className="sr-only" data-testid="bars-title">{title}</figcaption>
      <ul className="space-y-0.5">
        {bars.map((b) => (
          <li key={b.locationId} data-testid="account-bar" data-account={b.locationId} data-count={b.count} style={{ opacity: hot && hot !== b.locationId ? 0.55 : 1, transition: "opacity .15s ease" }} className="grid min-h-8 grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
            onMouseEnter={() => setHot(b.locationId)} onMouseLeave={() => setHot(null)}>
            <button type="button" onClick={() => onAccount(b.locationId)} onFocus={() => setHot(b.locationId)} data-testid="bar-account" aria-label={`${b.name}, ${b.count.toLocaleString("en-US")} ${b.count === 1 ? "thing" : "things"}. See everything for this client.`}
              className="ds-press min-h-8 truncate rounded-[4px] px-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={b.name}>{b.name}</button>
            <span className="relative block h-6 border-l border-[var(--t-rule2)]">
              <span className="flex h-full gap-[2px]" style={{ width: `${(b.count / max) * 100}%` }}>
                {KINDS.filter((k) => (b.byKind[k] ?? 0) > 0).map((k, i, all) => (
                  <button key={k} type="button" onClick={() => onSegment(b.locationId, k)} onFocus={() => setHot(b.locationId)} data-testid="bar-segment" data-kind={k} data-count={b.byKind[k]} data-account={b.locationId}
                    aria-label={`${b.name}, ${KIND_LABEL[k].toLowerCase()}, ${b.byKind[k]}. See them.`} title={`${KIND_LABEL[k]}: ${b.byKind[k]}`}
                    className={`ds-press block h-full min-w-1.5 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] ${i === all.length - 1 ? "rounded-r-[4px]" : ""}`} style={{ flex: b.byKind[k], background: kindColour(k) }} />
                ))}
              </span>
            </span>
            <span className="t-num text-right" data-testid="bar-total">{b.count.toLocaleString("en-US")}</span>
          </li>
        ))}
        {more > 0 && (
          <li className="grid min-h-8 grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
            <button type="button" onClick={onMore} data-testid="bars-more" className="ds-press col-span-3 min-h-8 w-fit rounded-md px-1.5 text-left font-medium text-primary underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]">+{more.toLocaleString("en-US")} more {more === 1 ? "client" : "clients"}. Show all</button>
          </li>
        )}
      </ul>
      {tip && (() => {
        const d = Math.round((tip.count - avgCount) * 10) / 10;
        return <ChartCard testId="bars-card" title={tip.name} left={40} top={Math.min(tipAt * 32 + 30, 200)}
          lines={[...KINDS.filter((k) => (tip.byKind[k] ?? 0) > 0).map((k) => <><span aria-hidden className="size-2 rounded-full" style={{ background: kindColour(k) }} /><span className="t-num font-medium">{tip.byKind[k]}</span> {KIND_LABEL[k].toLowerCase()}</>), <span className="t-num font-medium">{tip.count.toLocaleString("en-US")} in all</span>]}
          compare={bars.length > 1 ? `${d === 0 ? "Same as" : `${d > 0 ? "+" : ""}${d} against`} the average client (${Math.round(avgCount * 10) / 10})` : undefined} hint="Click a colour to see its people" />;
      })()}
      <ul className="t-small t-quiet mt-3 flex flex-wrap gap-x-5 gap-y-1" aria-label="What the colours mean">
        {present.map((k) => <li key={k} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: kindColour(k) }} />{KIND_LABEL[k]}</li>)}
      </ul>
      <p className="mt-1 min-h-5 text-sm leading-5" role="status" aria-live="polite" data-testid="bars-tip">{tip ? barTooltip(tip, rows) + "." : ""}</p>
      <div className="sr-only"><table><caption>{title}</caption><thead><tr><th>Client</th><th>Things to do</th></tr></thead><tbody>{bars.map((b) => <tr key={b.locationId}><td>{b.name}</td><td>{b.count}</td></tr>)}</tbody></table></div>
    </figure>
  );
}
