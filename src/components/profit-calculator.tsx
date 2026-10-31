"use client";

import { useState } from "react";
import { profit, SUBSYNC_PRICE } from "@/lib/profit";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function ProfitCalculator() {
  const [accounts, setAccounts] = useState(20);
  const [price, setPrice] = useState(18);
  const p = profit(accounts, price);
  const field = "mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-lg outline-none focus:border-teal-400";
  return (
    <div className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-2">
      <div className="space-y-4">
        <label className="block text-sm">Client accounts you manage
          <input className={field} type="number" min={1} max={5000} value={accounts} onChange={(e) => setAccounts(Number(e.target.value))} />
        </label>
        <label className="block text-sm">What you charge each client per month
          <input className={field} type="number" min={0} max={999} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </label>
        <p className="text-xs text-white/50">SubSync costs {usd(SUBSYNC_PRICE)} per client account per month. You set your own price.</p>
      </div>
      <div className="space-y-3" aria-live="polite">
        <div className="flex justify-between text-sm"><span className="text-white/60">You pay SubSync</span><span className="tabular-nums">{usd(p.cost)} / month</span></div>
        <div className="flex justify-between text-sm"><span className="text-white/60">Your clients pay you</span><span className="tabular-nums">{usd(p.revenue)} / month</span></div>
        <div className="border-t border-white/10 pt-3">
          <p className="text-sm text-white/60">You keep</p>
          <p className={`text-4xl font-semibold tabular-nums ${p.margin >= 0 ? "text-teal-300" : "text-red-400"}`}>{usd(p.margin)}<span className="text-base font-normal text-white/50"> / month</span></p>
          <p className="text-xs text-white/50">{usd(p.yearlyMargin)} a year</p>
        </div>
      </div>
    </div>
  );
}
