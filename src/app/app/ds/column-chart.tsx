"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { columnLayout, topColumns } from "@/lib/design/column-layout";

// ONE chart for every comparison across many client accounts or people: vertical columns side by side that shrink with the count (200 fit the width), stacked
// segments, a sorted order with a Top 20 / Top 50 / All switch, sideways scroll past the fit, a tooltip on hover or focus, labels only for the biggest and for the
// column you point at, a click that opens exactly that column's records, a keyboard (one tab stop, arrows move) and a table view paged 20/50/100.
export type ColumnSegment = { key: string; label: string; value: number; colour: string };
export type ColumnItem = { key: string; label: string; segments: ColumnSegment[]; note?: string };
const total = (i: ColumnItem) => i.segments.reduce((t, s) => t + s.value, 0);
const fmt = (n: number) => n.toLocaleString("en-US");
const LIMITS = [20, 50, null] as const;
type Legend = Array<{ key: string; label: string; colour: string }>;

export function ColumnChart({ title, items, unit = "things", legend, onSelect, testId = "column-chart", height = 320, subject = "client" }: {
  title: string; items: ColumnItem[]; unit?: string; subject?: string;
  /** Segment colours with their names, drawn under the chart. */
  legend?: Legend;
  /** A column was chosen: the whole column (no segment) or one coloured part of it. */
  onSelect: (key: string, segment?: string) => void;
  testId?: string; height?: number;
}) {
  const [limit, setLimit] = useState<number | null>(items.length > 50 ? 50 : null);
  const [asTable, setAsTable] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const [width, setWidth] = useState(1000);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(Math.max(1, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(1, el.clientWidth));
    return () => ro.disconnect();
  }, [asTable]);
  const { shown, hidden } = useMemo(() => topColumns(items.map((i) => ({ ...i, total: total(i) })), limit), [items, limit]);
  const max = Math.max(1, ...shown.map((s) => s.total));
  const lay = columnLayout(shown.length, width);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const plotH = height - 64;
  const cols = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (to: number) => { const n = Math.max(0, Math.min(shown.length - 1, to)); setFocus(n); setHot(n); cols.current[n]?.focus(); };
  const tip = hot !== null ? shown[hot] : null;
  const tipLeft = hot === null ? 0 : Math.min(Math.max(hot * (lay.colWidth + lay.gap) + lay.colWidth / 2, 90), Math.max(90, lay.contentWidth - 90));

  return (
    <figure className="min-w-0" data-testid={testId}>
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="t-small t-quiet" data-testid="bars-title">{title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {items.length > 20 && (
            <span role="group" aria-label={`How many ${subject}s to show`} className="inline-flex overflow-hidden rounded-md border">
              {LIMITS.map((l) => (
                <button key={String(l)} type="button" aria-pressed={limit === l} data-testid={`cols-limit-${l ?? "all"}`} onClick={() => { setLimit(l); setFocus(0); }}
                  className={`min-h-8 px-2.5 text-xs font-medium ${limit === l ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l === null ? "All" : `Top ${l}`}</button>
              ))}
            </span>
          )}
          <button type="button" aria-pressed={asTable} data-testid="cols-table-toggle" onClick={() => setAsTable(!asTable)} className="min-h-8 rounded-md border px-2.5 text-xs font-medium hover:bg-muted">{asTable ? "Show as chart" : "Show as table"}</button>
        </span>
      </figcaption>
      {asTable ? <ColumnTable items={shown} legend={legend} unit={unit} subject={subject} onSelect={onSelect} /> : (
        <div className="flex gap-2">
          <div className="relative w-9 shrink-0 text-right text-[11px] text-muted-foreground" style={{ height: plotH }} aria-hidden>
            {ticks.map((t) => <span key={t} className="absolute right-0 translate-y-1/2 tabular-nums" style={{ bottom: `${(t / max) * 100}%` }}>{fmt(t)}</span>)}
          </div>
          <div ref={box} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden" data-testid="cols-scroll" style={{ minHeight: height }}>
            <div className="relative" style={{ width: Math.max(lay.contentWidth, 1), height }}>
              {ticks.map((t) => <div key={t} aria-hidden className={`absolute inset-x-0 border-t ${t === 0 ? "border-foreground/30" : "border-border"}`} style={{ bottom: height - plotH - 2 + (t / max) * plotH }} />)}
              <div role="group" aria-label={title} className="absolute left-0 top-0 flex items-end" style={{ gap: lay.gap, height: plotH + 2, width: lay.contentWidth }} data-testid="cols-plot" data-col-width={lay.colWidth} data-gap={lay.gap}>
                {shown.map((c, i) => (
                  <button key={c.key} ref={(el) => { cols.current[i] = el; }} type="button" tabIndex={i === focus ? 0 : -1} data-testid="column" data-account={c.key} data-count={c.total}
                    aria-label={`${c.label}, ${fmt(c.total)} ${unit}${c.segments.length > 1 ? `: ${c.segments.filter((s) => s.value > 0).map((s) => `${fmt(s.value)} ${s.label.toLowerCase()}`).join(", ")}` : ""}. Open the records.`}
                    onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => { setHot(i); setFocus(i); }} onBlur={() => setHot(null)}
                    onClick={(e) => { const seg = (e.target as HTMLElement).closest<HTMLElement>("[data-seg]")?.dataset.seg; onSelect(c.key, seg); }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); }
                      else if (e.key === "Home") { e.preventDefault(); move(0); } else if (e.key === "End") { e.preventDefault(); move(shown.length - 1); }
                    }}
                    className="ds-press flex shrink-0 flex-col-reverse justify-start rounded-t-[3px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
                    style={{ width: lay.colWidth, height: `${(c.total / max) * 100}%`, minHeight: c.total > 0 ? 2 : 0, opacity: hot !== null && hot !== i ? 0.55 : 1, transition: "opacity .12s ease" }}>
                    {c.segments.filter((s) => s.value > 0).map((s) => <span key={s.key} aria-hidden data-seg={s.key} data-testid="column-segment" data-count={s.value} style={{ flex: s.value, background: s.colour, minHeight: 1 }} />)}
                  </button>
                ))}
              </div>
              <div aria-hidden className="absolute left-0 flex" style={{ top: plotH + 6, gap: lay.gap, width: lay.contentWidth }}>
                {shown.map((c, i) => {
                  const on = i < lay.labelled || hot === i;
                  return (
                    <span key={c.key} className="relative shrink-0" style={{ width: lay.colWidth, height: 56 }}>
                      {on && <span className={`absolute left-0 top-0 whitespace-nowrap text-[11px] ${hot === i ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                        style={lay.rotate ? { transform: `translateX(${lay.colWidth / 2}px) rotate(55deg)`, transformOrigin: "left top", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" } : { maxWidth: lay.colWidth + lay.gap, overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>}
                    </span>
                  );
                })}
              </div>
              {tip && (
                <div role="tooltip" data-testid="cols-tip" className="pointer-events-none absolute z-20 w-max max-w-[16rem] -translate-x-1/2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-[var(--shadow-lift)]" style={{ left: tipLeft, top: 0 }}>
                  <p className="font-medium">{tip.label}</p>
                  {tip.segments.filter((s) => s.value > 0).map((s) => <p key={s.key} className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: s.colour }} /><span className="font-medium tabular-nums">{fmt(s.value)}</span> {s.label.toLowerCase()}</p>)}
                  <p className="font-medium tabular-nums">{fmt(tip.total)} in all</p>
                  {tip.note && <p className="text-muted-foreground">{tip.note}</p>}
                  <p className="text-primary">Click to see the records</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {hidden > 0 && <p className="t-small t-quiet mt-1" data-testid="cols-hidden">{fmt(hidden)} more {subject}{hidden === 1 ? "" : "s"} not shown. <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setLimit(null)}>Show all</button></p>}
      {legend && legend.length > 0 && (
        <ul className="t-small t-quiet mt-3 flex flex-wrap gap-x-5 gap-y-1" aria-label="What the colours mean">
          {legend.map((k) => <li key={k.key} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: k.colour }} />{k.label}</li>)}
        </ul>
      )}
    </figure>
  );
}

const PAGES = [20, 50, 100] as const;
function ColumnTable({ items, legend, unit, subject, onSelect }: { items: Array<ColumnItem & { total: number }>; legend?: Legend; unit: string; subject: string; onSelect: (key: string, segment?: string) => void }) {
  const [size, setSize] = useState<number>(20);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(page, pages - 1);
  const rows = items.slice(at * size, at * size + size);
  const kinds = legend ?? [];
  return (
    <div data-testid="cols-table">
      <div className="max-h-[320px] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card"><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="px-3 py-2 font-medium capitalize">{subject}</th>{kinds.map((k) => <th key={k.key} scope="col" className="px-2 py-2 text-right font-medium">{k.label}</th>)}<th scope="col" className="px-3 py-2 text-right font-medium">{unit}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className="border-t"><td className="px-3 py-1.5"><button type="button" className="min-h-8 truncate text-left font-medium text-primary underline-offset-4 hover:underline" onClick={() => onSelect(r.key)}>{r.label}</button></td>
              {kinds.map((k) => <td key={k.key} className="px-2 py-1.5 text-right tabular-nums">{fmt(r.segments.find((s) => s.key === k.key)?.value ?? 0)}</td>)}
              <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmt(r.total)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{fmt(items.length)} {subject}{items.length === 1 ? "" : "s"}. Page {at + 1} of {pages}.</span>
        <span className="flex items-center gap-1.5">
          <label className="flex items-center gap-1">Rows <select aria-label="Rows per page" className="min-h-8 rounded-md border bg-card px-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>{PAGES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <button type="button" className="min-h-8 rounded-md border px-2 disabled:opacity-40" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
          <button type="button" className="min-h-8 rounded-md border px-2 disabled:opacity-40" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}
