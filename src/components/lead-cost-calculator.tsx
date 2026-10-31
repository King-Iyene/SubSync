"use client";

import { useState } from "react";
import { leadCost } from "@/lib/lead-cost";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function LeadCostCalculator() {
  const [leads, setLeads] = useState(200);
  const [close, setClose] = useState(20);
  const [value, setValue] = useState(2000);
  const [slow, setSlow] = useState(30);
  const r = leadCost(leads, close, value, slow);
  const field = "mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-lg outline-none focus:border-teal-400";
  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value));
  return (
    <div className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-2">
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">New leads per month<input className={field} type="number" min={0} value={leads} onChange={num(setLeads)} /></label>
        <label className="block text-sm">Close rate (%)<input className={field} type="number" min={0} max={100} value={close} onChange={num(setClose)} /></label>
        <label className="block text-sm">Average deal value ($)<input className={field} type="number" min={0} value={value} onChange={num(setValue)} /></label>
        <label className="block text-sm">Leads answered too slowly (%)<input className={field} type="number" min={0} max={100} value={slow} onChange={num(setSlow)} /></label>
      </div>
      <div className="space-y-2" aria-live="polite">
        <p className="text-sm text-white/60">Slow replies could be costing</p>
        <p className="text-4xl font-semibold tabular-nums text-red-300">{usd(r.lostPerMonth)}<span className="text-base font-normal text-white/50"> / month</span></p>
        <p className="text-xs text-white/50">{r.lostLeads.toLocaleString("en-US")} leads a month, {usd(r.lostPerYear)} a year. This is your own estimate from the numbers you entered.</p>
      </div>
    </div>
  );
}
