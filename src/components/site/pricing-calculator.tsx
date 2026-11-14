"use client";

import { useState } from "react";
import { cost, dollars, margin, PRICE_CENTS, revenue } from "@/lib/site/pricing-calc";

/** A small calculator: how many client accounts, what you would pay, and (optionally) what you charge your own clients. Runs in the browser, stores nothing, tracks nothing. */
export function PricingCalculator() {
  const [accounts, setAccounts] = useState(20);
  const [clientPrice, setClientPrice] = useState("23");
  const priceCents = Math.round((Number.parseFloat(clientPrice) || 0) * 100);
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3>Work out your monthly cost</h3>
      <p className="muted" style={{ color: "var(--s-muted)", marginBottom: 14 }}>An example to help you plan, not a promise of what you will earn.</p>
      <label htmlFor="calc-n"><strong>Client accounts: {accounts}</strong></label>
      <input id="calc-n" type="range" min={1} max={200} value={accounts} onChange={(e) => setAccounts(Number(e.target.value))} style={{ width: "100%", margin: "8px 0 16px", minHeight: 32 }} />
      <p>You pay <strong style={{ fontSize: 26 }}>{dollars(cost(accounts))}</strong> a month ({accounts} x {dollars(PRICE_CENTS)}).</p>
      <p style={{ marginTop: 16 }}>
        <label htmlFor="calc-p"><strong>If you resell it to your clients, per client account per month</strong> (optional)</label><br />
        <input id="calc-p" className="search" style={{ maxWidth: 200, marginTop: 6 }} inputMode="decimal" value={clientPrice} onChange={(e) => setClientPrice(e.target.value.replace(/[^0-9.]/g, ""))} aria-describedby="calc-out" />
      </p>
      <p id="calc-out" aria-live="polite" style={{ marginTop: 12 }}>
        {priceCents > 0 ? (
          priceCents > PRICE_CENTS
            ? <>Your clients would pay you {dollars(revenue(accounts, priceCents))} a month, and you would keep <strong>{dollars(margin(accounts, priceCents))}</strong> after paying {dollars(cost(accounts))}.</>
            : <>At or below {dollars(PRICE_CENTS)} there is nothing left over after your cost.</>
        ) : <span className="muted" style={{ color: "var(--s-muted)" }}>Type a price to see what you would keep.</span>}
      </p>
    </div>
  );
}
