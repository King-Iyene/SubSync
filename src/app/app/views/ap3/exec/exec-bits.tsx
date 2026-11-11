"use client";

import type { Cell } from "@/lib/analytics/appointments-exec-intel";
import { DOW, hourLabel } from "@/lib/analytics/appointments-exec-intel";
import type { Rate } from "@/lib/analytics/appointments3-types";

// Small pieces of the Leadership tab: a trend line, a change badge, the funnel bar, a plain bar row and the weekday by hour heatmap. Flat, one accent, one warning colour.

export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(d)}%`);
export const money = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `$${Math.round(v).toLocaleString("en-US")}`);
export const rateText = (r: Rate) => (r.value === null ? "Not enough data" : pct(r.value));
export const dayLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

export function fmtKpi(v: number | null, display: string): string {
  if (v === null) return "n/a";
  if (display === "percent") return pct(v);
  if (display === "money") return money(v);
  if (display === "minutes") return v < 60 ? `${Math.round(v)} min` : v < 1440 ? `${(v / 60).toFixed(1)} h` : `${(v / 1440).toFixed(1)} d`;
  if (display === "hours") return v < 48 ? `${v} h` : `${(v / 24).toFixed(1)} d`;
  return Math.round(v).toLocaleString("en-US");
}

export function Spark({ points }: { points: number[] }) {
  if (points.length < 2 || Math.max(...points) === Math.min(...points)) return <span className="apx-spark apx-spark-empty" aria-hidden />;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1, w = 84, h = 22;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 2 - ((p - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return <svg className="apx-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** A change against another period. Words, not just colour: "up 12%" or "down 3 points". `good` says which direction is better. */
export function Change({ d, good, label }: { d: { pct: number | null; points: number | null; value: number | null }; good: "up" | "down"; label: string }) {
  if (d.value === null || (d.pct === null && d.points === null)) return <span className="apx-chg apx-chg-na" aria-label={`${label}: no data`} />;
  const v = d.points !== null ? d.points : (d.pct as number), up = v > 0, flat = v === 0;
  const worse = !flat && (good === "up" ? !up : up);
  return <span className="apx-chg" data-tone={flat ? "flat" : worse ? "warn" : "ok"}>{flat ? "no change" : `${up ? "up" : "down"} ${Math.abs(v)}${d.points !== null ? (Math.abs(v) === 1 ? " point" : " points") : "%"}`} <span className="apx-chg-l">{label}</span></span>;
}

export function FunnelBars({ steps, onOpen }: { steps: Array<{ key: string; label: string; count: number | null; dropPct: number | null; lost: number | null; bucket: string | null }>; onOpen: (key: string, bucket: string, label: string) => void }) {
  const top = Math.max(1, ...steps.map((s) => s.count ?? 0));
  return (
    <ol className="apx-funnel">
      {steps.map((s, i) => (
        <li key={s.key} className="apx-fstep">
          <div className="apx-fhead"><span>{s.label}</span>
            {s.count === null ? <span className="apx-fine">Not recorded yet</span>
              : s.bucket ? <button type="button" className="apx-num" onClick={() => onOpen(s.key, s.bucket as string, s.label)} aria-label={`Open the ${s.count} appointments: ${s.label}`}>{s.count.toLocaleString("en-US")}</button>
              : <span className="apx-num apx-num-static">{s.count.toLocaleString("en-US")}</span>}
          </div>
          <div className="apx-track" aria-hidden><div className="apx-fill" style={{ width: `${Math.max(2, ((s.count ?? 0) / top) * 100)}%` }} /></div>
          {i > 0 && s.dropPct !== null && s.lost !== null && <div className="apx-fine">{s.key === "confirmed" ? `${100 - s.dropPct}% were confirmed ahead of time` : `${s.dropPct}% drop (${s.lost.toLocaleString("en-US")} did not continue)`}</div>}
        </li>
      ))}
    </ol>
  );
}

export function BarRow({ name, value, max, text, sub, onClick, flag }: { name: string; value: number; max: number; text: string; sub?: string; onClick?: () => void; flag?: boolean }) {
  const body = (
    <>
      <span className="apx-bname">{name}</span>
      <span className="apx-btrack" aria-hidden><span className="apx-bfill" data-flag={flag ? "1" : undefined} style={{ width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%` }} /></span>
      <span className="apx-bval">{text}</span>
      {sub && <span className="apx-bsub apx-fine">{sub}</span>}
    </>
  );
  return onClick ? <button type="button" className="apx-brow" onClick={onClick} title="Open these appointments">{body}</button> : <div className="apx-brow">{body}</div>;
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 9pm
/** Show rate by weekday and hour. Shade = show rate (darker = more show up); a cell with fewer than 8 counted appointments is left blank, never guessed. Click opens its appointments. */
export function Heatmap({ cells, onOpen }: { cells: Cell[]; onOpen: (dow: number, hour: number) => void }) {
  const by = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c]));
  return (
    <div className="apx-heat" role="grid" aria-label="Show rate by weekday and hour">
      <div className="apx-heat-row apx-heat-head" role="row"><span className="apx-heat-corner" />{HOURS.map((h) => <span key={h} role="columnheader" className="apx-heat-h">{h % 3 === 0 ? hourLabel(h) : ""}</span>)}</div>
      {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
        <div key={dow} className="apx-heat-row" role="row"><span className="apx-heat-d" role="rowheader">{DOW[dow]}</span>
          {HOURS.map((h) => {
            const c = by.get(`${dow}-${h}`), n = c ? c.showed + c.noshow + c.unmarked : 0, ok = n >= 8, r = ok && c ? c.showed / n : null;
            const label = c ? `${DOW[dow]} ${hourLabel(h)}: ${c.booked} appointments${ok ? `, ${Math.round((r as number) * 100)}% showed` : ", not enough to show a rate"}` : `${DOW[dow]} ${hourLabel(h)}: none`;
            return c ? <button key={h} type="button" role="gridcell" className="apx-cell" data-ok={ok ? "1" : undefined} style={ok ? { ["--lv" as never]: String(Math.round((r as number) * 100)) } : undefined} title={label} aria-label={label} onClick={() => onOpen(dow, h)} />
              : <span key={h} role="gridcell" className="apx-cell apx-cell-none" aria-label={label} />;
          })}
        </div>
      ))}
    </div>
  );
}
