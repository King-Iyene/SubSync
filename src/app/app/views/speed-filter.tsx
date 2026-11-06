"use client";

import { SlidersHorizontal } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { filterActive, filterQuery, type LeadFilter } from "@/lib/analytics/speed-v4-more";

// One filter for every Speed screen: source, status, response time, weekday, hours, tag, channel. It only narrows; the server still binds every read to the caller's own accounts.
// Saved filters live in this browser (a per-person convenience). Simple on top: one "Filters" button; the controls open under it.
const Ctx = createContext<{ filter: LeadFilter; query: string }>({ filter: {}, query: "" });
export const useSpeedFilter = () => useContext(Ctx);
/** The filter as a query-string tail (starts with &), for any speed read. */
export const filterTail = (f: LeadFilter) => { const q = new URLSearchParams(filterQuery(f)).toString(); return q ? `&${q}` : ""; };

const SEL = "h-9 min-w-0 rounded-md border bg-card px-2 text-sm";
const SAVED = "subsync.speed.filters";
const read = (): Record<string, LeadFilter> => { try { return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Record<string, LeadFilter>; } catch { return {}; } };
const write = (v: Record<string, LeadFilter>) => { try { localStorage.setItem(SAVED, JSON.stringify(v)); } catch { /* private window: nothing is kept */ } };

export function FilterProvider({ children }: { children: (bar: ReactNode) => ReactNode }) {
  const [filter, setFilter] = useState<LeadFilter>({});
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Record<string, LeadFilter>>(() => (typeof localStorage === "undefined" ? {} : read()));
  const set = useCallback(<K extends keyof LeadFilter>(k: K, v: LeadFilter[K] | "") => setFilter((f) => { const n = { ...f }; if (v === "" || v === undefined || (typeof v === "number" && Number.isNaN(v))) delete n[k]; else n[k] = v as LeadFilter[K]; return n; }), []);
  const num = (s: string) => (s === "" ? "" : Number(s));
  const active = Object.keys(filter).length;
  const value = useMemo(() => ({ filter, query: filterTail(filter) }), [filter]);
  const bar = (
    <div className="mb-4 print:hidden" data-testid="speed-filters">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="filters-toggle" className="ds-press inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40"><SlidersHorizontal aria-hidden className="size-4" />Filters{active ? ` (${active})` : ""}</button>
        {active > 0 && <button type="button" onClick={() => setFilter({})} className="min-h-9 px-2 text-sm font-medium text-primary underline" data-testid="filters-clear">Clear</button>}
        {Object.keys(saved).length > 0 && (
          <select aria-label="Saved filters" className={SEL} value="" onChange={(e) => { if (e.target.value) setFilter(saved[e.target.value] ?? {}); }} data-testid="filters-saved">
            <option value="">Saved filters</option>{Object.keys(saved).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-4" data-testid="filters-panel">
          <label className="text-xs text-muted-foreground">Status<select className={`${SEL} mt-0.5 w-full`} value={filter.status ?? ""} onChange={(e) => set("status", e.target.value as LeadFilter["status"] | "")}><option value="">Any</option><option value="within">Answered in time</option><option value="late">Answered late</option><option value="waiting">Waiting</option></select></label>
          <label className="text-xs text-muted-foreground">First reply took<select className={`${SEL} mt-0.5 w-full`} value={filter.bucket ?? ""} onChange={(e) => set("bucket", e.target.value as LeadFilter["bucket"] | "")}><option value="">Any</option><option value="<1m">Under 1 min</option><option value="1-5m">1 to 5 min</option><option value="5-15m">5 to 15 min</option><option value="15-60m">15 to 60 min</option><option value="1-4h">1 to 4 hours</option><option value="4h+">Over 4 hours</option><option value="none">No reply</option></select></label>
          <label className="text-xs text-muted-foreground">Weekday<select className={`${SEL} mt-0.5 w-full`} value={filter.dow ?? ""} onChange={(e) => set("dow", num(e.target.value) as number | "")}><option value="">Any</option>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Channel used<select className={`${SEL} mt-0.5 w-full`} value={filter.channel ?? ""} onChange={(e) => set("channel", e.target.value as LeadFilter["channel"] | "")}><option value="">Any</option><option value="sms">Text</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="call">Call</option><option value="chat">Chat</option></select></label>
          <label className="text-xs text-muted-foreground">Arrived from hour<select className={`${SEL} mt-0.5 w-full`} value={filter.hourFrom ?? ""} onChange={(e) => set("hourFrom", num(e.target.value) as number | "")}><option value="">Any</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
          <label className="text-xs text-muted-foreground">to hour<select className={`${SEL} mt-0.5 w-full`} value={filter.hourTo ?? ""} onChange={(e) => set("hourTo", num(e.target.value) as number | "")}><option value="">Any</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:59</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Source<input className={`${SEL} mt-0.5 w-full`} value={filter.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="Exact name" /></label>
          <label className="text-xs text-muted-foreground">Tag<input className={`${SEL} mt-0.5 w-full`} value={filter.tag ?? ""} onChange={(e) => set("tag", e.target.value.toLowerCase())} placeholder="Exact tag" /></label>
          <div className="col-span-full flex flex-wrap items-center gap-2">
            <input className={SEL} aria-label="Name this filter" placeholder="Name this filter" id="filter-name" />
            <button type="button" disabled={!filterActive(filter)} className="ds-press min-h-9 rounded-md border bg-card px-3 text-sm font-medium disabled:opacity-50" data-testid="filters-save"
              onClick={() => { const el = document.getElementById("filter-name") as HTMLInputElement | null; const n = el?.value.trim().slice(0, 40); if (!n) return; const next = { ...saved, [n]: filter }; setSaved(next); write(next); if (el) el.value = ""; }}>Save</button>
            <span className="text-xs text-muted-foreground">Saved in this browser.</span>
          </div>
        </div>
      )}
    </div>
  );
  return <Ctx.Provider value={value}>{children(bar)}</Ctx.Provider>;
}
