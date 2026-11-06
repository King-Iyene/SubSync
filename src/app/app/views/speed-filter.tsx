"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { filterActive, filterQuery, type LeadFilter } from "@/lib/analytics/speed-v4-more";
import { WhatIs } from "../ds/what-is";

// One set of lead filters for the Speed tabs it can change (Race, Pace, Coverage, People). It only narrows; the server still binds every read to the caller's own accounts.
// The bar above the page sets accounts and dates; the dates reach every tab through this context (`query` carries them, `range` names them), so every tab follows the bar.
// Saved filters live in this browser (a per-person convenience). Collapsed by default: a small button with a count, the active filters as removable chips, and the fields under it in three groups.
export type SpeedRange = { from: string; to: string; label: string; sentence: string };
const Ctx = createContext<{ filter: LeadFilter; query: string; range: SpeedRange | null }>({ filter: {}, query: "", range: null });
export const useSpeedFilter = () => useContext(Ctx);
/** The filter as a query-string tail (starts with &), for any speed read. */
export const filterTail = (f: LeadFilter) => { const q = new URLSearchParams(filterQuery(f)).toString(); return q ? `&${q}` : ""; };
const rangeTail = (r: SpeedRange | null) => (r ? `&from=${r.from}&to=${r.to}` : "");

const SEL = "h-9 min-w-0 rounded-md border bg-card px-2 text-sm";
const SAVED = "subsync.speed.filters";
const read = (): Record<string, LeadFilter> => { try { return JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Record<string, LeadFilter>; } catch { return {}; } };
const write = (v: Record<string, LeadFilter>) => { try { localStorage.setItem(SAVED, JSON.stringify(v)); } catch { /* private window: nothing is kept */ } };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STATUS = { within: "Answered in time", late: "Answered late", waiting: "Waiting" } as const;
const BUCKET: Record<string, string> = { "<1m": "Under 1 min", "1-5m": "1 to 5 min", "5-15m": "5 to 15 min", "15-60m": "15 to 60 min", "1-4h": "1 to 4 hours", "4h+": "Over 4 hours", none: "No reply" };
const CHANNEL: Record<string, string> = { sms: "Text", email: "Email", whatsapp: "WhatsApp", call: "Call" };
/** Each active filter as a short phrase, with the key that clears it. */
export function chipsOf(f: LeadFilter): Array<{ key: keyof LeadFilter | "hours"; text: string }> {
  const out: Array<{ key: keyof LeadFilter | "hours"; text: string }> = [];
  if (f.status) out.push({ key: "status", text: STATUS[f.status] });
  if (f.bucket) out.push({ key: "bucket", text: `First reply ${BUCKET[f.bucket] ?? f.bucket}` });
  if (f.dow !== undefined) out.push({ key: "dow", text: DAYS[f.dow] ?? "Weekday" });
  if (f.hourFrom !== undefined || f.hourTo !== undefined) out.push({ key: "hours", text: `Arrived ${f.hourFrom ?? 0}:00 to ${f.hourTo ?? 23}:59` });
  if (f.channel) out.push({ key: "channel", text: CHANNEL[f.channel] ?? f.channel });
  if (f.source) out.push({ key: "source", text: `Source: ${f.source}` });
  if (f.tag) out.push({ key: "tag", text: `Tag: ${f.tag}` });
  return out;
}

export function FilterProvider({ range, children }: { range: SpeedRange | null; children: (bar: ReactNode) => ReactNode }) {
  const [filter, setFilter] = useState<LeadFilter>({});
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Record<string, LeadFilter>>(() => (typeof localStorage === "undefined" ? {} : read()));
  const set = useCallback(<K extends keyof LeadFilter>(k: K, v: LeadFilter[K] | "") => setFilter((f) => { const n = { ...f }; if (v === "" || v === undefined || (typeof v === "number" && Number.isNaN(v))) delete n[k]; else n[k] = v as LeadFilter[K]; return n; }), []);
  const unset = (k: keyof LeadFilter | "hours") => setFilter((f) => { const n = { ...f }; if (k === "hours") { delete n.hourFrom; delete n.hourTo; } else delete n[k]; return n; });
  const num = (s: string) => (s === "" ? "" : Number(s));
  const chips = chipsOf(filter);
  const active = chips.length;
  const value = useMemo(() => ({ filter, query: filterTail(filter) + rangeTail(range), range }), [filter, range]);
  const lab = "text-xs text-muted-foreground";
  const group = "rounded-lg border bg-card p-3";
  const gh = "mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const bar = (
    <div className="mb-4 print:hidden" data-testid="speed-filters">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="filters-toggle" className="ds-press inline-flex min-h-11 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40 sm:min-h-9">
          <SlidersHorizontal aria-hidden className="size-4" />Lead filters{active > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground" data-testid="filters-count" aria-label={`${active} active`}>{active}</span>}
        </button>
        <WhatIs text="Narrow the leads on this page; the bar above sets accounts and dates." testId="filters-tip" />
        {chips.map((c) => (
          <span key={c.key} className="inline-flex min-h-9 items-center gap-1 rounded-full border bg-card pl-3 pr-1 text-sm" data-testid="filter-chip">{c.text}
            <button type="button" onClick={() => unset(c.key)} aria-label={`Remove filter: ${c.text}`} className="ds-press inline-flex size-8 items-center justify-center rounded-full hover:bg-accent"><X aria-hidden className="size-3.5" /></button>
          </span>
        ))}
        {active > 0 && <button type="button" onClick={() => setFilter({})} className="min-h-9 px-2 text-sm font-medium text-primary underline" data-testid="filters-clear">Clear all</button>}
        {Object.keys(saved).length > 0 && (
          <select aria-label="Saved filters" className={SEL} value="" onChange={(e) => { if (e.target.value) setFilter(saved[e.target.value] ?? {}); }} data-testid="filters-saved">
            <option value="">Saved filters</option>{Object.keys(saved).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3" data-testid="filters-panel" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <fieldset className={group}><legend className="sr-only">When</legend><p className={gh}>When</p>
            <div className="grid grid-cols-2 gap-2">
              <label className={lab}>Weekday<select className={`${SEL} mt-0.5 w-full`} value={filter.dow ?? ""} onChange={(e) => set("dow", num(e.target.value) as number | "")}><option value="">Any</option>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
              <span />
              <label className={lab}>Arrived from<select className={`${SEL} mt-0.5 w-full`} value={filter.hourFrom ?? ""} onChange={(e) => set("hourFrom", num(e.target.value) as number | "")}><option value="">Any</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
              <label className={lab}>to<select className={`${SEL} mt-0.5 w-full`} value={filter.hourTo ?? ""} onChange={(e) => set("hourTo", num(e.target.value) as number | "")}><option value="">Any</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:59</option>)}</select></label>
            </div></fieldset>
          <fieldset className={group}><legend className="sr-only">Who</legend><p className={gh}>Who</p>
            <div className="grid grid-cols-2 gap-2">
              <label className={lab}>Source<input className={`${SEL} mt-0.5 w-full`} value={filter.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="Exact name" /></label>
              <label className={lab}>Tag<input className={`${SEL} mt-0.5 w-full`} value={filter.tag ?? ""} onChange={(e) => set("tag", e.target.value.toLowerCase())} placeholder="Exact tag" /></label>
            </div></fieldset>
          <fieldset className={group}><legend className="sr-only">How</legend><p className={gh}>How</p>
            <div className="grid grid-cols-2 gap-2">
              <label className={lab}>Status<select className={`${SEL} mt-0.5 w-full`} value={filter.status ?? ""} onChange={(e) => set("status", e.target.value as LeadFilter["status"] | "")}><option value="">Any</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className={lab}>First reply took<select className={`${SEL} mt-0.5 w-full`} value={filter.bucket ?? ""} onChange={(e) => set("bucket", e.target.value as LeadFilter["bucket"] | "")}><option value="">Any</option>{Object.entries(BUCKET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className={lab}>Channel<select className={`${SEL} mt-0.5 w-full`} value={filter.channel ?? ""} onChange={(e) => set("channel", e.target.value as LeadFilter["channel"] | "")}><option value="">Any</option>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div></fieldset>
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
