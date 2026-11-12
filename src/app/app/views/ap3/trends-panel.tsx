"use client";

import { useState } from "react";
import type { Appt3Trends } from "@/lib/analytics/appointments3-types";
import { useApiClient, useData } from "../../session";
import { queryOf, type ApFilters } from "./data";
import { shortDay } from "./parts";

// Week-over-week and month-over-month bookings per person or calendar, from start time and status only (SQL aggregate). Small sparkline and the change.

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="ap-sub">-</span>;
  const w = 72, h = 20, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  return <svg width={w} height={h} role="img" aria-label={`Bookings, last ${values.length} periods`}><polyline points={pts} fill="none" stroke="var(--s6-cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function TrendsPanel({ filters, by, onOpen }: { filters: ApFilters; by: "person" | "calendar"; onOpen: (title: string, count: number, extra: Record<string, string | number>) => void }) {
  const [grain, setGrain] = useState<"week" | "month">("week");
  const res = useData<Appt3Trends>(`${queryOf("trends" as never, filters)}&by=${by}&grain=${grain}`);
  const unit = grain === "week" ? "week" : "month";
  return (
    <div className="s6-card mt-4" data-testid={`ap-trends-${by}`}>
      <div className="flex flex-wrap items-center gap-3"><h3 className="s6-q">{by === "person" ? "Bookings per person" : "Bookings per calendar"}, {unit} over {unit}</h3>
        <span className="ml-auto inline-flex gap-2"><button type="button" className="s6-btn" aria-pressed={grain === "week"} onClick={() => setGrain("week")}>Weekly</button><button type="button" className="s6-btn" aria-pressed={grain === "month"} onClick={() => setGrain("month")}>Monthly</button></span></div>
      {!res.data ? <p className="ap-fine" role="status">{res.error ? "Could not load trends." : "Loading..."}</p> : !res.data.rows.length ? <p className="ap-fine">No bookings in the last 8 {unit}s.</p> : (
        <div className="ap-scroll"><table className="ap-t"><thead><tr><th>{by === "person" ? "Person" : "Calendar"}</th><th data-num>This {unit}</th><th data-num>Last {unit}</th><th data-num>Change</th><th>Last 8 {unit}s</th></tr></thead><tbody>
          {res.data.rows.slice(0, 30).map((r) => (
            <tr key={r.id}><td><span className="ap-name">{r.name}</span></td>
              <td data-num>{r.current ? <button type="button" className="ap-link tnum" onClick={() => onOpen(`${r.name}, ${unit === "week" ? "this week" : "this month"} (${shortDay(res.data!.currentFrom)} to ${shortDay(res.data!.currentTo)})`, r.current, { [by === "person" ? "owner" : "calendar"]: r.id, from: res.data!.currentFrom, to: res.data!.currentTo, local: 1, outcome: "booked", expect: r.current })}>{r.current}</button> : 0}</td>
              <td data-num>{r.previous}</td><td data-num style={{ color: r.delta < 0 ? "var(--s6-red)" : r.delta > 0 ? "var(--s6-green)" : undefined }}>{r.delta > 0 ? "+" : ""}{r.delta}</td><td><Spark values={r.series} /></td></tr>
          ))}
        </tbody></table></div>
      )}
      <p className="ap-fine mt-2" data-testid="ap-trends-window">{res.data ? `This ${unit} is ${shortDay(res.data.currentFrom)} to ${shortDay(res.data.currentTo)}, last ${unit} ${shortDay(res.data.previousFrom)} to ${shortDay(res.data.previousTo)} (${grain === "month" ? "calendar months" : "Monday to Sunday"}, ${res.data.timeZone.replace(/_/g, " ")} time). This table always covers the last 8 ${unit}s up to now; the figures above follow your date range. ` : ""}Counts of appointments by their start time, not counting invalid ones.</p>
    </div>
  );
}

/** Downloads the whole filtered list (up to 100,000 rows) through the guarded export route. */
export function ExportAll({ filters }: { filters: ApFilters }) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(false);
  return <button type="button" className="ap-link" disabled={busy} data-testid="ap-export-all" title="Download every appointment in these filters as a spreadsheet file (up to 100,000 rows)"
    onClick={async () => { setBusy(true); setErr(false); try { await api.download(queryOf("export" as never, filters), "appointments.csv"); } catch { setErr(true); } setBusy(false); }}>{busy ? "Preparing..." : err ? "Download failed, try again" : "Download all as CSV"}</button>;
}
