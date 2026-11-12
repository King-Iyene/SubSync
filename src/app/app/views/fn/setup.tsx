"use client";

import { useState } from "react";
import { BASES, BASIS_HELP, BASIS_LABEL, money } from "@/lib/analytics/finance-core";
import { useApiClient } from "../../session";
import { fnfxOn, useFn } from "./data";
import { Load, NOT_FROM_PLATFORM, Picker, SampleNote, Typed, num, useAct } from "./shared";
import type { FnSetup } from "./types";

// Finance, Setup: the few things only the agency can tell SubSync, kept ONLY in SubSync and labelled "entered by you": plan prices where the platform gives none, ad spend per client account and month,
// and the payout choices. Everything else comes from the CRM copies. Nothing here is written to the CRM.
export function SetupTab() {
  const [rev, setRev] = useState(0);
  const r = useFn<FnSetup>("setup", { v: rev });
  const bump = () => setRev((n) => n + 1);
  return (
    <Load r={r} label="Loading setup...">
      {(d) => (
        <div className="fn-stack" data-testid="fn-setup">
          {fnfxOn() && <SampleNote />}
          <PayoutSettings d={d} onSaved={bump} />
          <Prices d={d} onSaved={bump} />
          <Spend d={d} onSaved={bump} />
          <section className="fn-card" aria-label="What we can read">
            <h2 className="fn-h">What SubSync can and cannot read</h2>
            <ul className="fn-ev">
              <li>Plans, their price and payment status: read from the platform when it allows. Where it gives no price, enter it above.</li>
              <li>{NOT_FROM_PLATFORM}: ad spend, the next charge date, why a payment failed, and logins. Ad spend can be typed above for each client account.</li>
              <li>Won and open deals, bookings and leads: read from the CRM copies SubSync keeps, per client account.</li>
            </ul>
          </section>
        </div>
      )}
    </Load>
  );
}

function PayoutSettings({ d, onSaved }: { d: FnSetup; onSaved: () => void }) {
  const api = useApiClient(), { busy, note, run } = useAct(onSaved);
  const [basis, setBasis] = useState(d.settings.payoutBasis), [currency, setCurrency] = useState(d.settings.currency), [days, setDays] = useState(String(d.settings.dealWindowDays));
  return (
    <section className="fn-card" aria-label="Payout choices" data-testid="fn-settings">
      <h2 className="fn-h">Payout choices</h2>
      <div className="fn-form">
        <label>Paid on<select className="ap-field" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} data-testid="fn-set-basis">{BASES.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</select></label>
        <label>Payout currency<input className="ap-field" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} data-testid="fn-set-currency" /></label>
        <label>Days between appointment and win<input className="ap-field" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} data-testid="fn-set-days" /></label>
        <button type="button" className="s6-btn" data-kind="primary" disabled={busy} data-testid="fn-set-save" onClick={() => void run(() => api.put("finance/settings", { payoutBasis: basis, currency, dealWindowDays: Number(days) }), "Saved.")}>Save</button>
      </div>
      <p className="ap-fine">{BASIS_HELP[basis]} A deal counts for an appointment taken up to {days || "30"} days before the win. Deal amounts are shown in the payout currency.</p>
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}

function Prices({ d, onSaved }: { d: FnSetup; onSaved: () => void }) {
  const api = useApiClient(), { busy, note, run } = useAct(onSaved);
  const [edit, setEdit] = useState<string | null>(null), [amount, setAmount] = useState(""), [cur, setCur] = useState("USD"), [per, setPer] = useState("month"), [rm, setRm] = useState<FnSetup["plans"][number] | null>(null);
  return (
    <section className="fn-card" aria-label="Plan prices" data-testid="fn-prices">
      <h2 className="fn-h">Plan prices</h2>
      <p className="ap-fine">Where the platform does not tell SubSync a plan&apos;s price, enter it once. It is kept only in SubSync and shown as &quot;entered by you&quot;.</p>
      {d.plans.length === 0 ? <p className="ap-fine">No plan found on your client accounts yet.</p> : (
        <ul className="fn-list">
          {d.plans.map((p) => (
            <li key={p.planKey} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1.4fr) auto" }} data-testid="fn-price-row">
              <div><span className="fn-who">{p.planName ?? p.planKey}</span><div className="fn-sub">{num(p.accounts)} {p.accounts === 1 ? "account" : "accounts"}</div></div>
              <div className="fn-sub">{p.platformPrice !== null && p.currency ? `Price from the platform: ${money(p.platformPrice, p.currency)} a month` : p.entered ? `Entered by you: ${money(p.entered.amount, p.entered.currency)} a ${p.entered.billingInterval}` : "No price yet"}</div>
              <div className="fn-end"><button type="button" className="s6-btn" onClick={() => { setEdit(p.planKey); setAmount(p.entered ? String(p.entered.amount) : ""); setCur(p.entered?.currency ?? p.currency ?? "USD"); setPer(p.entered?.billingInterval ?? "month"); }} data-testid="fn-price-edit">{p.entered ? "Change" : "Enter the price"}</button>{p.entered && <button type="button" className="ap-link" onClick={() => setRm(p)}>Remove</button>}</div>
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <div className="fn-form" style={{ marginTop: 10 }}>
          <label>Price<input className="ap-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="fn-price-amount" /></label>
          <label>Currency<input className="ap-field" value={cur} maxLength={3} onChange={(e) => setCur(e.target.value.toUpperCase())} /></label>
          <label>Billed every<select className="ap-field" value={per} onChange={(e) => setPer(e.target.value)}><option value="month">Month</option><option value="year">Year</option></select></label>
          <span className="fn-end" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="s6-btn" data-kind="primary" disabled={busy} data-testid="fn-price-save" onClick={() => void run(() => api.put("finance/plan-price", { planKey: edit, planName: d.plans.find((x) => x.planKey === edit)?.planName ?? null, amount: amount === "" ? undefined : Number(amount), currency: cur, billingInterval: per }), "Price saved.").then(() => setEdit(null))}>Save price</button>
            <button type="button" className="s6-btn" onClick={() => setEdit(null)}>Cancel</button>
          </span>
        </div>
      )}
      {rm && <Typed name={rm.planName ?? rm.planKey} verb="remove this price" busy={busy} onCancel={() => setRm(null)} onConfirm={(t) => void run(() => api.post("finance/plan-price/remove", { planKey: rm.planKey, confirm: t }), "Price removed.").then(() => setRm(null))} />}
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}

function Spend({ d, onSaved }: { d: FnSetup; onSaved: () => void }) {
  const api = useApiClient(), { busy, note, run } = useAct(onSaved);
  const [acct, setAcct] = useState<{ id: string; name: string } | null>(null), [month, setMonth] = useState(new Date().toISOString().slice(0, 7)), [amount, setAmount] = useState(""), [cur, setCur] = useState(d.settings.currency), [rm, setRm] = useState<FnSetup["spend"][number] | null>(null);
  return (
    <section className="fn-card" aria-label="Ad spend" data-testid="fn-spend">
      <h2 className="fn-h">Ad spend per client account</h2>
      <p className="ap-fine">{NOT_FROM_PLATFORM}. Type what each client spent on ads each month to see cost per lead and return on spend in Client revenue. Kept only in SubSync.</p>
      <div className="fn-form">
        <Picker what="account" label="Client account" value={acct} onPick={setAcct} testId="fn-spend-account" />
        <label>Month<input className="ap-field" type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="fn-spend-month" /></label>
        <label>Amount spent<input className="ap-field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="fn-spend-amount" /></label>
        <label>Currency<input className="ap-field" value={cur} maxLength={3} onChange={(e) => setCur(e.target.value.toUpperCase())} /></label>
        <button type="button" className="s6-btn" data-kind="primary" disabled={busy || !acct} data-testid="fn-spend-save" onClick={() => void run(() => api.put("finance/spend", { locationId: acct?.id, month, amount: amount === "" ? undefined : Number(amount), currency: cur }), "Ad spend saved.").then(() => setAmount(""))}>Save ad spend</button>
      </div>
      {d.spend.length > 0 && (
        <ul className="fn-list" style={{ marginTop: 10 }}>
          {d.spend.map((s) => (
            <li key={`${s.locationId}${s.month}`} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto" }} data-testid="fn-spend-row">
              <span className="fn-who">{s.account}</span><span className="fn-sub">{s.month} · {money(s.amount, s.currency)}</span>
              <span className="fn-end"><button type="button" className="ap-link" onClick={() => setRm(s)}>Remove</button></span>
            </li>
          ))}
        </ul>
      )}
      {rm && <Typed name={rm.account} verb="remove this ad spend" busy={busy} onCancel={() => setRm(null)} onConfirm={(t) => void run(() => api.post("finance/spend/remove", { locationId: rm.locationId, month: rm.month, confirm: t }), "Ad spend removed.").then(() => setRm(null))} />}
      {note && <p className="ap-fine" role="status">{note}</p>}
    </section>
  );
}
