"use client";

import { useEffect, useState } from "react";
import { REVENUE_FORMULA, money } from "@/lib/analytics/finance-core";
import { EmptyState } from "../../ds";
import { fnfxOn, msg, useKeyset } from "./data";
import { How, NOT_ENOUGH, NOT_FROM_PLATFORM, SampleNote, num } from "./shared";
import { useApiClient } from "../../session";
import type { FnRevenue } from "./types";

// Finance, Client revenue: what each client made through the agency's work (deals won in the date range, matched through the contact, in the account the deal sits in), their pipeline, and ONLY where the
// agency typed in ad spend: cost per lead and return on spend. Win rate needs 10 closed deals, average deal 3 won, cost per lead 10 leads: under that it says "Not enough data", never a made-up figure.
type Row = FnRevenue["rows"][number];

export function RevenueTab({ go, goTab }: { go: (v: "account", loc?: string) => void; goTab: (t: string) => void }) {
  const api = useApiClient();
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [vertical, setVertical] = useState(""), [sort, setSort] = useState("won"), [note, setNote] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const k = useKeyset<Row, FnRevenue>("revenue", { q: dq, vertical, sort }, { ranged: true });
  const d = k.first;
  const cur = d?.currency ?? "USD", usd = (n: number) => money(n, cur);
  const exportCsv = async () => {
    if (fnfxOn()) return setNote("Sample data: nothing is saved.");
    try { await api.download(`finance?part=export&what=revenue&from=${d?.range.from}&to=${d?.range.to}`, "client-revenue.csv"); } catch (e) { setNote(msg(e)); }
  };
  if (k.error && /not switched on/i.test(String((k.error as Error).message))) return <EmptyState title="Not switched on yet" body="This part of Finance is not switched on for your account yet." />;
  return (
    <div className="fn-stack" data-testid="fn-revenue">
      {fnfxOn() && <SampleNote />}
      <section className="fn-card" aria-label="What clients made">
        <h2 className="fn-h">What your clients made through your work</h2>
        {d ? (
          <>
            <p className="fn-sentence" data-testid="fn-revenue-sentence">{d.totals.won ? `${usd(d.totals.wonValue)} won across ${num(d.totals.won)} ${d.totals.won === 1 ? "deal" : "deals"} in ${num(d.total)} client ${d.total === 1 ? "account" : "accounts"}.` : "No won deals in this date range."}</p>
            <div className="fn-tiles" style={{ marginTop: 10 }}>
              <div className="fn-tile" style={{ cursor: "default" }} data-testid="fn-rev-pipeline"><b>{usd(d.totals.pipelineValue)}</b><span>Open pipeline (deals with an amount and an owner)</span></div>
              <div className="fn-tile" style={{ cursor: "default" }} data-testid="fn-rev-winrate"><b>{d.totals.winRate !== null ? `${d.totals.winRate}%` : NOT_ENOUGH}</b><span>{d.totals.winRate !== null ? "Win rate" : d.totals.winRateNote ?? "Win rate needs 10 closed deals"}</span></div>
              <div className="fn-tile" style={{ cursor: "default" }} data-testid="fn-rev-avg"><b>{d.totals.avgDeal !== null ? usd(d.totals.avgDeal) : NOT_ENOUGH}</b><span>{d.totals.avgDeal !== null ? "Average deal" : "Average deal needs 3 won deals"}</span></div>
              <div className="fn-tile" style={{ cursor: "default" }} data-testid="fn-rev-roas"><b>{d.totals.roas !== null ? `${d.totals.roas}x` : "No ad spend"}</b><span>{d.totals.roas !== null ? `Return on ad spend, ${num(d.totals.spendAccounts)} ${d.totals.spendAccounts === 1 ? "account" : "accounts"}${d.totals.cpl !== null ? `, ${usd(d.totals.cpl)} a lead` : ""}` : "Ad spend is entered per client in Setup"}</span></div>
            </div>
            {d.spendNote && <p className="ap-fine" data-testid="fn-spend-note"><b>{NOT_FROM_PLATFORM}:</b> {d.spendNote.replace(/^Not available from the platform yet\.\s*/, "")} <button type="button" className="ap-link" onClick={() => goTab("setup")}>Add ad spend</button></p>}
            <p className="ap-fine">Deal amounts are shown in your payout currency ({cur}); the CRM keeps no currency on a deal. Showing {d.range.from} to {d.range.to}.</p>
            <How>{REVENUE_FORMULA}</How>
          </>
        ) : <p className="ap-fine">Adding up...</p>}
      </section>

      {d && d.verticals.length > 1 && (
        <section className="fn-card" aria-label="By kind of business" data-testid="fn-rev-verticals">
          <h2 className="fn-h">By kind of business</h2>
          <div className="fn-bars">
            {d.verticals.map((v) => (
              <div className="fn-bar" key={v.key}>
                <button type="button" className="ap-link fn-lab" style={{ textAlign: "left" }} onClick={() => setVertical(vertical === v.key ? "" : v.key)} aria-pressed={vertical === v.key}>{v.label}</button>
                <span className="fn-track"><span className="fn-fill" style={{ width: `${Math.max(2, (v.wonValue / Math.max(...d.verticals.map((x) => x.wonValue), 1)) * 100)}%` }} /></span>
                <span className="fn-amt">{usd(v.wonValue)} <span className="fn-sub">({num(v.accounts)})</span></span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="ap-head print:hidden" role="search">
        <label className="ap-search"><span className="sr-only">Search accounts</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" data-testid="fn-rev-search" /></label>
        <select className="ap-field" aria-label="Kind of business" value={vertical} onChange={(e) => setVertical(e.target.value)} data-testid="fn-rev-vertical"><option value="">All kinds of business</option>{(d?.verticals ?? []).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</select>
        <select className="ap-field" aria-label="Order by" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="fn-rev-sort"><option value="won">Most won</option><option value="billed">Biggest plan</option><option value="pipeline">Biggest pipeline</option></select>
        <button type="button" className="s6-btn" onClick={() => void exportCsv()} data-testid="fn-rev-export">Export CSV</button>
      </div>
      {note && <p className="ap-fine" role="status">{note}</p>}
      {k.loading && !d ? <p className="ap-fine">Loading...</p> : k.error ? <EmptyState title="Could not load" body={msg(k.error)} /> : k.rows.length === 0 ? (
        <EmptyState title={d && d.all === 0 ? "No client accounts yet" : "No account matches"} body={d && d.all === 0 ? "Client accounts appear here after the first sync finishes." : "Try another search or kind of business."} />
      ) : (
        <>
          <p className="ap-fine" data-testid="fn-rev-count">{num(k.total)} {k.total === 1 ? "account" : "accounts"}{d && !d.hasDaily ? ". SubSync has no daily counts for these accounts yet, so won and leads show as zero until the next sync." : "."}</p>
          <ul className="fn-list" data-testid="fn-rev-list">
            {k.rows.map((r) => (
              <li key={r.locationId} className="fn-row" data-testid="fn-rev-row">
                <div><button type="button" className="ap-link fn-who" style={{ textAlign: "left" }} onClick={() => go("account", r.locationId)}>{r.name}</button><div className="fn-sub">{r.verticalLabel ?? "Kind of business not set"}{r.billed ? ` · you bill ${money(r.billed.amount, r.billed.currency)} a month${r.billedSource === "entered" ? " (entered by you)" : ""}` : r.pay === "paid" ? " · plan has no price yet" : ""}</div></div>
                <div><span className="fn-amt">{usd(r.wonValue)}</span><div className="fn-sub">{num(r.won)} won · {num(r.lost)} lost</div></div>
                <div className="fn-sub">
                  {num(r.newLeads)} new leads · {num(r.booked)} booked · pipeline {usd(r.pipelineValue)} ({num(r.pipelineCount)})<br />
                  Win rate {r.winRate !== null ? `${r.winRate}%` : r.winRateNote ?? NOT_ENOUGH} · average deal {r.avgDeal !== null ? usd(r.avgDeal) : NOT_ENOUGH}<br />
                  {r.spend !== null ? `Ad spend ${money(r.spend, r.spendCurrency ?? cur)}${r.cpl !== null ? ` · ${usd(r.cpl)} a lead` : ""}${r.roas !== null ? ` · ${r.roas}x return` : ""}` : "Ad spend: not entered"}
                </div>
                <div className="fn-end"><button type="button" className="s6-btn" onClick={() => go("account", r.locationId)}>Open</button></div>
              </li>
            ))}
          </ul>
          {k.next && <div className="fn-more"><span className="ap-fine">Showing {num(k.rows.length)} of {num(k.total)}</span><button type="button" className="s6-btn" onClick={k.showMore} disabled={k.more} data-testid="fn-rev-more">{k.more ? "Loading..." : "Show more"}</button></div>}
        </>
      )}
    </div>
  );
}
