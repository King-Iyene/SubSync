"use client";

import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Appt3Options } from "@/lib/analytics/appointments3-types";
import { DATE_PRESETS, presetRange, previousRange, rangeKey, type DatePreset } from "@/lib/design/appt-filters";
import { useAp, type ApFilters } from "./data";
import { SearchSelect } from "./search-select";

// The one filter system for the whole module: two date axes ("Appointment date" = when it happens, "Booked on" = when it was booked), the manager filters,
// quick filters and the previous-period comparison. Everything is part of ApFilters, so it travels in the address and recomputes every number on every tab.

type Set = (p: Partial<ApFilters>) => void;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => iso(Date.now());
const DAYMS = 86_400_000;
const lastN: Record<string, 7 | 30 | 90> = { last7: 7, last30: 30, last90: 90 };

/** "Appointment date": when the appointment happens. */
export function DateAxis({ filters, set }: { filters: ApFilters; set: Set }) {
  const [now] = useState(() => Date.now());
  const custom = !!filters.from && !!filters.to;
  const key = custom ? rangeKey(filters.from, filters.to, now) : (`last${filters.days}` as DatePreset);
  return (
    <>
      <select className="ap-field" aria-label="Appointment date" value={key} data-testid="ap-days"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") set({ from: iso(Date.now() - 29 * DAYMS), to: today() });
          else if (lastN[v]) set({ days: lastN[v], from: "", to: "" });
          else set(presetRange(v as DatePreset, Date.now()));
        }}>
        {DATE_PRESETS.map(([k, l]) => <option key={k} value={k}>{k === "next7" || lastN[k] ? l : `Happening: ${l.toLowerCase()}`}</option>)}
        <option value="custom">Choose dates</option>
      </select>
      {custom && key === "custom" && <>
        <label className="ap-datef"><span className="sr-only">From</span><input type="date" className="ap-field" value={filters.from} max={filters.to} onChange={(e) => e.target.value && set({ from: e.target.value })} data-testid="ap-from" aria-label="From date" /></label>
        <label className="ap-datef"><span className="sr-only">To</span><input type="date" className="ap-field" value={filters.to} min={filters.from} onChange={(e) => e.target.value && set({ to: e.target.value })} data-testid="ap-to" aria-label="To date" /></label>
      </>}
    </>
  );
}

/** "Booked on": the day the booking was made. Works together with the appointment date ("booked last week, happening next week"). */
export function BookedAxis({ filters, set }: { filters: ApFilters; set: Set }) {
  const [now] = useState(() => Date.now());
  const on = !!filters.bookedFrom && !!filters.bookedTo;
  const key = on ? rangeKey(filters.bookedFrom, filters.bookedTo, now) : "any";
  return (
    <>
      <select className="ap-field" aria-label="Booked on" value={key} data-testid="ap-booked" data-on={on ? "1" : undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "any") set({ bookedFrom: "", bookedTo: "" });
          else if (v === "custom") set({ bookedFrom: iso(Date.now() - 6 * DAYMS), bookedTo: today() });
          else { const r = presetRange(v as DatePreset, Date.now()); set({ bookedFrom: r.from, bookedTo: r.to }); }
        }}>
        <option value="any">Booked any time</option>
        {DATE_PRESETS.filter(([k]) => k !== "next7").map(([k, l]) => <option key={k} value={k}>{lastN[k] ? `Booked in the ${l.toLowerCase()}` : `Booked ${l.toLowerCase()}`}</option>)}
        <option value="custom">Booked between dates</option>
      </select>
      {on && key === "custom" && <>
        <label className="ap-datef"><span className="sr-only">Booked from</span><input type="date" className="ap-field" value={filters.bookedFrom} max={filters.bookedTo} onChange={(e) => e.target.value && set({ bookedFrom: e.target.value })} aria-label="Booked from date" /></label>
        <label className="ap-datef"><span className="sr-only">Booked to</span><input type="date" className="ap-field" value={filters.bookedTo} min={filters.bookedFrom} onChange={(e) => e.target.value && set({ bookedTo: e.target.value })} aria-label="Booked to date" /></label>
      </>}
    </>
  );
}

const OUTCOMES: Array<[ApFilters["outcome"], string]> = [["showed", "Showed"], ["noshow", "No-show"], ["noshow_open", "No-show, not booked again"], ["cancelled", "Cancelled"], ["unmarked", "No outcome yet"]];
const STATUSES: Array<[ApFilters["status"], string]> = [["new", "New, not confirmed"], ["confirmed", "Confirmed"], ["booked", "Booked"]];

/** The manager filters, in one tidy panel so the bar stays calm. */
export function MoreFilters({ filters, set, opts }: { filters: ApFilters; set: Set; opts: Appt3Options | null }) {
  const n = [filters.outcome, filters.status, filters.deal, filters.stage, filters.leadAge, filters.contact].filter(Boolean).length + (filters.attention ? 1 : 0);
  const [open, setOpen] = useState(n > 0);
  return (
    <div className="ap-more">
      <button type="button" className="s6-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="ap-more"><SlidersHorizontal aria-hidden className="size-4" />More filters{n ? ` (${n})` : ""}</button>
      {open && (
        <div className="ap-more-body" role="group" aria-label="More filters">
          <select className="ap-field" aria-label="What happened" value={filters.outcome} onChange={(e) => set({ outcome: e.target.value as ApFilters["outcome"] })} data-testid="ap-outcome"><option value="">Any outcome</option>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="ap-field" aria-label="Booking status" value={filters.status} onChange={(e) => set({ status: e.target.value as ApFilters["status"] })} data-testid="ap-status-all"><option value="">Any booking status</option>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="ap-field" aria-label="Deal" value={filters.deal} onChange={(e) => set({ deal: e.target.value as ApFilters["deal"] })} data-testid="ap-deal"><option value="">With or without a deal</option><option value="has">Has a deal</option><option value="none">No deal</option></select>
          {(opts?.stages?.length ?? 0) > 0 && <SearchSelect label="Deal stage" value={filters.stage} anyLabel="Any deal stage" options={opts!.stages!.map((s) => ({ value: s, label: s }))} onChange={(v) => set({ stage: v })} testId="ap-stage" />}
          <select className="ap-field" aria-label="How new the lead is" value={filters.leadAge} onChange={(e) => set({ leadAge: e.target.value as ApFilters["leadAge"] })} data-testid="ap-lead"><option value="">Any lead age</option><option value="7">New lead (last 7 days)</option><option value="30">Recent lead (last 30 days)</option><option value="old">Older lead (over 30 days)</option></select>
          <select className="ap-field" aria-label="New or returning" value={filters.contact} onChange={(e) => set({ contact: e.target.value as ApFilters["contact"] })} data-testid="ap-contact"><option value="">New and returning</option><option value="new">First appointment</option><option value="returning">Has been before</option></select>
          <label className="ap-check"><input type="checkbox" checked={filters.attention} onChange={(e) => set({ attention: e.target.checked })} data-testid="ap-attention" />Needs attention</label>
        </div>
      )}
    </div>
  );
}

/** One-tap filters a sales manager actually uses. Each one only sets the filters above, so it can be adjusted or removed like any other. */
export function QuickFilters({ filters, set, people }: { filters: ApFilters; set: Set; people: Array<{ userId: string; name: string }> }) {
  const person = filters.booker || filters.userId, who = people.find((p) => p.userId === person)?.name;
  const [now] = useState(() => Date.now());
  const lastWeek = presetRange("last_week", now), next7 = presetRange("next7", now);
  const items: Array<[string, () => void]> = [
    ["Next 7 days, not confirmed", () => set({ ...next7, outcome: "", status: "new" })],
    ["No-shows not booked again", () => set({ days: 30, from: "", to: "", outcome: "noshow_open", status: "" })],
    ["Needs attention", () => set({ attention: true })],
    ["Booked last week, happening next week", () => set({ bookedFrom: lastWeek.from, bookedTo: lastWeek.to, ...next7 })],
  ];
  if (who) items.push([`${who.split(" ")[0]}'s no-shows`, () => set({ outcome: "noshow" })]);
  return (
    <div className="ap-quick" role="group" aria-label="Quick filters" data-testid="ap-quick"><Sparkles aria-hidden className="size-4" />
      {items.map(([l, fn]) => <button key={l} type="button" className="ap-qbtn" onClick={fn}>{l}</button>)}
    </div>
  );
}

type Head = { headline: { booked: number; trueShowRate: number | null } };
function Before({ filters, n, range }: { filters: ApFilters; n: number; range: { from: string; to: string } }) {
  const b = useAp<Head>("overview", { ...filters, from: range.from, to: range.to });
  const p = b.data?.headline?.booked;
  if (p === undefined) return <span className="ap-fine"> Comparing with the period before...</span>;
  const delta = p === 0 ? (n === 0 ? "no change" : "up from none") : `${n >= p ? "up" : "down"} ${Math.abs(Math.round(((n - p) / p) * 100))}%`;
  return <span className="ap-fine"> The period before ({range.from} to {range.to}) had {p}, so this is {delta}.</span>;
}

/** One line that says how many appointments match, and (when asked) how that compares with the stretch just before. */
export function ResultLine({ filters }: { filters: ApFilters }) {
  const [now] = useState(() => Date.now());
  const cur = filters.from && filters.to ? { from: filters.from, to: filters.to } : { from: iso(now - (filters.days - 1) * DAYMS), to: iso(now) };
  const a = useAp<Head>("overview", filters);
  if (!a.data?.headline) return null;
  const n = a.data.headline.booked, rate = a.data.headline.trueShowRate;
  return (
    <p className="ap-result" data-testid="ap-result">
      <b>{n}</b> appointment{n === 1 ? "" : "s"} match{n === 1 ? "es" : ""}{rate !== null && rate !== undefined ? `, ${Math.round(rate * 100)}% showed` : ""}.
      {filters.compare && <Before filters={filters} n={n} range={previousRange(cur.from, cur.to)} />}
    </p>
  );
}
