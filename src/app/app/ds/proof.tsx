"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { PROOF_NOTE, proofLine, type Proof } from "@/lib/analytics/today-queue";
import { ChartHint, ShowingChip } from "./showing";

// What SubSync caught, for the review with a client: how many alerts it raised in the last 7 days, how many are cleared and how many are still open. The word is
// "cleared" because SubSync can see that a problem went away from the CRM data but not whether a person fixed it, and the line under the numbers says so.
export function ProofStrip({ proof, title = "What SubSync caught", onOpen }: { proof: Proof; title?: string; /** Press a number to open the alerts it counts. */ onOpen?: (k: "raised" | "cleared" | "open") => void }) {
  return (
    <div data-testid="proof-strip">
      <h3 className="text-base font-semibold">{title}</h3>
      <dl className="mt-3 grid grid-cols-3 gap-4">
        {([["Raised", proof.raised, "alerts in 7 days", "raised"], ["Cleared", proof.cleared, "went away", "cleared"], ["Still open", proof.open, "right now", "open"]] as const).map(([k, n, sub, key]) => (
          <div key={k} className="min-w-0 border-l-2 border-border pl-3">
            <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
            <dd className="tnum mt-1 text-[1.7rem] font-semibold leading-none" data-testid={`proof-${k.toLowerCase().replace(" ", "-")}`}>
              {onOpen && n > 0 ? <button type="button" onClick={() => onOpen(key)} aria-label={`${k}: ${n}. Show the alerts.`} data-testid={`proof-open-${key}`} className="ds-press -mx-1 cursor-pointer rounded-md px-1 underline decoration-primary/30 decoration-2 underline-offset-[0.18em] hover:decoration-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{n}</button> : n}
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">{sub}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-5 text-muted-foreground" data-testid="proof-note">{PROOF_NOTE}</p>
    </div>
  );
}

/**
 * The same seven days as small bars: alerts raised go up from the line, alerts cleared go down, so a good week has a bar under the line for each bar above it.
 * Each day is a button that lists that day's alerts; the number on the day is the number of rows in its list.
 */
export function RaisedClearedStrip({ proof, selected, onSelect, onOpenDay }: { proof: Proof; selected: number | null; onSelect: (i: number | null) => void; /** When given, a day opens the records panel instead of a list under the strip. */ onOpenDay?: (i: number) => void }) {
  const [used, setUsed] = useState(false);
  const max = Math.max(1, ...proof.days.map((d) => Math.max(d.raised.length, d.cleared.length)));
  const day = selected === null ? null : proof.days[selected];
  const H = 44;
  return (
    <figure className="min-w-0" data-testid="raised-cleared">
      <figcaption className="text-sm font-semibold leading-5" data-testid="raised-title">{proofLine(proof)}</figcaption>
      <ChartHint used={used}>Click a day to see the alerts raised and cleared that day.</ChartHint>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {proof.days.map((d, i) => {
          const r = d.raised.length, c = d.cleared.length, on = selected === i, empty = r + c === 0;
          return (
            <button key={d.day} type="button" disabled={empty} aria-pressed={on} data-testid="raised-day" data-raised={r} data-cleared={c}
              aria-label={`${d.label}: ${r} raised, ${c} cleared.${empty ? "" : " Show the alerts."}`}
              onClick={() => { setUsed(true); if (onOpenDay) onOpenDay(i); else onSelect(on ? null : i); }} title={empty ? "Nothing was raised or cleared on this day." : `Show the ${r + c} alerts of ${d.label}`}
              className={`ds-press group flex min-w-0 flex-col items-stretch rounded-lg px-1 pb-1 pt-1.5 text-center hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-default disabled:hover:bg-transparent ${on ? "bg-muted outline outline-2 -outline-offset-2 outline-foreground" : ""}`}>
              <span className="tnum min-h-4 text-[11px] font-medium leading-4">{r > 0 ? r : ""}</span>
              <span className="relative mx-auto block w-4/5 max-w-7" style={{ height: H * 2 + 2 }} aria-hidden>
                <span className="ds-grow absolute inset-x-0 rounded-t-[4px] bg-foreground/70" style={{ bottom: H + 1, height: Math.max(r > 0 ? 3 : 0, (r / max) * H), transformOrigin: "bottom" }} />
                <span className="absolute inset-x-[-4px] border-t border-foreground/30" style={{ top: H }} />
                <span className="ds-grow absolute inset-x-0 rounded-b-[4px] bg-primary" style={{ top: H + 2, height: Math.max(c > 0 ? 3 : 0, (c / max) * H), transformOrigin: "top" }} />
              </span>
              <span className="tnum min-h-4 text-[11px] font-medium leading-4">{c > 0 ? c : ""}</span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{d.label}</span>
              {on ? <Check aria-hidden className="mx-auto size-3.5" /> : !empty && <ChevronRight aria-hidden className="mx-auto size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}
            </button>
          );
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label="What the bars mean">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-3 rounded-t-[3px] bg-foreground/70" />Raised, above the line</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-3 rounded-b-[3px] bg-primary" />Cleared, below the line</li>
      </ul>
      {day && !onOpenDay && (
        <section className="mt-4" aria-label={`Alerts on ${day.label}`} data-testid="raised-list">
          <div className="mb-2 flex flex-wrap items-center gap-2"><ShowingChip label={`${day.label}, ${day.day}`} onClear={() => onSelect(null)} /></div>
          {([["Raised", day.raised], ["Cleared", day.cleared]] as const).map(([k, list]) => list.length > 0 && (
            <div key={k} className="mb-3">
              <h4 className="text-sm font-semibold">{k}: <span data-testid={`raised-list-${k.toLowerCase()}-count`}>{list.length}</span></h4>
              <ul className="mt-1 divide-y border-y text-sm">
                {list.map((a) => <li key={a.id + k} className="flex flex-wrap gap-x-3 py-1.5"><span className="font-medium">{a.accountName}</span><span className="min-w-0 break-words text-muted-foreground">{a.title}</span></li>)}
              </ul>
            </div>
          ))}
        </section>
      )}
      <div className="sr-only"><table><caption>Alerts raised and cleared in the last 7 days</caption><thead><tr><th>Day</th><th>Raised</th><th>Cleared</th></tr></thead>
        <tbody>{proof.days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.raised.length}</td><td>{d.cleared.length}</td></tr>)}</tbody></table></div>
      {selected !== null && <button type="button" onClick={() => onSelect(null)} className="sr-only"><X aria-hidden />Close</button>}
    </figure>
  );
}
