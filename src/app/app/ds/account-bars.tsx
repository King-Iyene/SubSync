"use client";

import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { barTooltip, KIND_LABEL, KINDS, kindColour, type AccountBar, type QueueRow } from "@/lib/analytics/today-queue";
import { ChartHint } from "./showing";

// "Where it is happening": the client accounts with the most things to fix, one thin bar each, longest first. The bar is split by kind of thing in the same
// colours as the donut, so a colour means the same kind everywhere on the page. Bars start at the same baseline, have a 4 px rounded end and 2 px between their
// parts. The number sits at the end of the bar. Each bar is a button: it narrows Today to that account (the page shows a chip with the way back). The details
// are written out in words in a line under the chart when a bar is hovered or focused.
export function AccountBars({ title, bars, rows, selected, onSelect, used = false, hint = "Click a bar to show only that client account." }: {
  title: string; bars: AccountBar[]; rows: QueueRow[]; selected: string | null; onSelect: (locationId: string) => void; used?: boolean; hint?: string;
}) {
  const [hot, setHot] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const tip = bars.find((b) => b.locationId === hot) ?? null;
  const present = KINDS.filter((k) => bars.some((b) => (b.byKind[k] ?? 0) > 0));
  return (
    <figure className="min-w-0" data-testid="account-bars">
      <figcaption className="mb-1 text-sm font-semibold leading-5" data-testid="bars-title">{title}</figcaption>
      <ChartHint used={used}>{hint}</ChartHint>
      <ul className="mt-2 space-y-0.5">
        {bars.map((b) => {
          const on = selected === b.locationId;
          const dim = selected !== null && !on;
          return (
            <li key={b.locationId}>
              <button type="button" aria-pressed={on} onClick={() => onSelect(b.locationId)} onMouseEnter={() => setHot(b.locationId)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(b.locationId)} onBlur={() => setHot(null)}
                data-testid="account-bar" data-count={b.count} aria-label={`${barTooltip(b, rows)}. Show only this account.`}
                className={`ds-press group grid min-h-10 w-full grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] ${on ? "bg-muted font-semibold" : ""}`}>
                <span className="truncate">{b.name}</span>
                <span className="relative block h-2.5 border-l border-foreground/30" aria-hidden>
                  <span className="ds-grow-x flex h-full gap-[2px]" style={{ width: `${(b.count / max) * 100}%`, opacity: dim ? 0.4 : 1 }}>
                    {KINDS.filter((k) => (b.byKind[k] ?? 0) > 0).map((k, i, all) => (
                      <span key={k} className={`block h-full ${i === all.length - 1 ? "rounded-r-[4px]" : ""}`} style={{ flex: b.byKind[k], background: kindColour(k) }} />
                    ))}
                  </span>
                </span>
                <span className="tnum flex items-center gap-1.5">
                  {b.count.toLocaleString("en-US")}
                  {on ? <Check aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="What the colours mean">
        {present.map((k) => <li key={k} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: kindColour(k) }} />{KIND_LABEL[k]}</li>)}
      </ul>
      <p className="mt-1 min-h-10 text-sm leading-5" role="status" aria-live="polite" data-testid="bars-tip">{tip ? barTooltip(tip, rows) + "." : ""}</p>
      <div className="sr-only"><table><caption>{title}</caption><thead><tr><th>Client account</th><th>Things to fix</th></tr></thead><tbody>{bars.map((b) => <tr key={b.locationId}><td>{b.name}</td><td>{b.count}</td></tr>)}</tbody></table></div>
    </figure>
  );
}
