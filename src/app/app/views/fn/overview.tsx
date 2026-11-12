"use client";

import { useState } from "react";
import { MRR_FORMULA, WATERFALL_FORMULA, money, type MoveKind } from "@/lib/analytics/finance-core";
import { EmptyState, LineChart } from "../../ds";
import { fnfxOn, useFn, useKeyset } from "./data";
import { How, Load, Money, NOT_FROM_PLATFORM, SampleNote, num } from "./shared";
import type { FnMovement, FnOverview } from "./types";

// Finance, Money overview: monthly recurring revenue from the plans we can see (the platform's price, or the price the agency typed once and labelled "entered by you"), a trend from SubSync's OWN daily
// record (it starts the day recording started, and says so), what moved (new, expansion, contraction, churned), what is at risk (an estimate), and where it comes from. Every count opens its rows.
const KIND_LABEL: Record<MoveKind, string> = { new: "New", expansion: "Expansion", contraction: "Contraction", churned: "Churned" };
const KIND_WORD: Record<MoveKind, string> = { new: "accounts that started paying", expansion: "accounts that pay more", contraction: "accounts that pay less", churned: "accounts that stopped paying" };

export function OverviewTab({ go, goTab }: { go: (v: "account" | "payments", loc?: string) => void; goTab: (t: string, f?: string) => void }) {
  const r = useFn<FnOverview>("overview", {}, { ranged: true });
  const [kind, setKind] = useState<MoveKind | null>(null);
  return (
    <Load r={r} label="Adding up your plans..." empty={(d) => (d.totals.accounts.total === 0 ? "Client accounts appear here after the first sync finishes." : false)}>
      {(d) => {
        const cur = d.primaryCurrency, t = d.totals, usd = (a: number) => money(a, cur ?? "USD");
        const mrr = t.mrr.find((m) => m.currency === cur) ?? null, risk = t.atRisk.find((m) => m.currency === cur) ?? null;
        return (
          <div className="fn-stack" data-testid="fn-overview">
            {fnfxOn() && <SampleNote />}
            <section aria-label="Money tiles" className="fn-tiles">
              <button type="button" className="fn-tile" data-testid="fn-tile-mrr" onClick={() => document.getElementById("fn-mix")?.scrollIntoView({ behavior: "smooth" })}>
                <b>{mrr ? usd(mrr.amount) : "No price yet"}</b><span>Plans a month{mrr ? `, ${num(mrr.accounts)} paid ${mrr.accounts === 1 ? "account" : "accounts"}` : ""}</span>
              </button>
              <button type="button" className="fn-tile" data-hot={risk ? "1" : undefined} data-testid="fn-tile-risk" onClick={() => go("payments")}>
                <b>{risk ? usd(risk.amount) : "Nothing"}</b><span>{risk ? `At risk (estimate): ${num(risk.accounts)} past due` : "At risk: no plan is past due"}</span>
              </button>
              <button type="button" className="fn-tile" data-testid="fn-tile-accounts" onClick={() => goTab("revenue")}>
                <b>{num(t.accounts.paid)}</b><span>Paid up of {num(t.accounts.total)} client {t.accounts.total === 1 ? "account" : "accounts"}</span>
              </button>
              <button type="button" className="fn-tile" data-hot={t.noPrice.accounts ? "1" : undefined} data-testid="fn-tile-noprice" onClick={() => goTab("setup")}>
                <b>{num(t.noPrice.accounts)}</b><span>{t.noPrice.accounts ? "Paid accounts with no price: add it in Setup" : "Every paid account has a price"}</span>
              </button>
            </section>
            {t.mrr.length > 1 && <p className="ap-fine" data-testid="fn-currencies">You have plans in {t.mrr.length} currencies, so each is shown on its own: <Money items={t.mrr} />.</p>}
            {t.usesEntered && <p className="ap-fine" data-testid="fn-entered-note">Some prices are ones you entered, labelled &quot;entered by you&quot;. SubSync keeps them only in SubSync.</p>}
            <How title="How is the monthly total worked out?">{MRR_FORMULA}</How>

            <section className="fn-card" aria-label="Plans over time">
              <h2 className="fn-h">Plans a month, over time</h2>
              {d.trend.enough && cur ? (
                <LineChart title="Plans a month" series={[{ label: cur, points: d.trend.points.map((p) => ({ day: p.day, value: p.amount })), tone: 1 }]} format={(n) => usd(n)} min={7} need="days of record" hideFlat note={d.trend.startsOn ? `From SubSync's own daily record, which started on ${d.trend.startsOn}.` : undefined} />
              ) : (
                <EmptyState compact title="The line is still being drawn" body={d.trend.message || "SubSync records your plans once a day. The line appears after a week."} />
              )}
            </section>

            <section className="fn-card" aria-label="What moved" data-testid="fn-waterfall">
              <h2 className="fn-h">What moved</h2>
              {d.waterfall && d.waterfall.enough ? (
                <>
                  <p className="fn-lead">From {d.waterfall.from} to {d.waterfall.to}: {usd(d.waterfall.start)} became {usd(d.waterfall.end)} a month.</p>
                  <div className="fn-bars" role="list">
                    {(["new", "expansion", "contraction", "churned"] as MoveKind[]).map((k) => {
                      const w = d.waterfall!, amt = w[k], max = Math.max(w.new, w.expansion, w.contraction, w.churned, 1);
                      return (
                        <div className="fn-bar" role="listitem" key={k}>
                          <span className="fn-lab">{KIND_LABEL[k]}</span>
                          <button type="button" className="fn-track" aria-label={`${KIND_LABEL[k]}: ${usd(amt)}, ${w.counts[k]} ${KIND_WORD[k]}. Show them.`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)} data-testid={`fn-move-${k}`}>
                            <span className="fn-fill" data-k={k === "contraction" || k === "churned" ? "down" : undefined} style={{ width: `${Math.max(2, (amt / max) * 100)}%` }} />
                          </button>
                          <span className="fn-amt">{k === "contraction" || k === "churned" ? "-" : "+"}{usd(amt)} <span className="fn-sub">({num(w.counts[k])})</span></span>
                        </div>
                      );
                    })}
                  </div>
                  {kind && <MovePanel kind={kind} go={go} onClose={() => setKind(null)} />}
                  <How title="How is this worked out?">{WATERFALL_FORMULA}</How>
                </>
              ) : (
                <EmptyState compact title="Nothing to compare yet" body={d.waterfall?.note || `SubSync started recording on ${d.trend.startsOn ?? "the next daily check"}. After two days it shows what moved.`} />
              )}
            </section>

            <div className="fn-grid2">
              <section className="fn-card" aria-label="Plans" id="fn-mix" data-testid="fn-mix">
                <h2 className="fn-h">Plans you sell</h2>
                {d.planMix.length === 0 ? <p className="ap-fine">No paid plan found yet.</p> : (
                  <ul className="fn-list">
                    {d.planMix.map((m) => (
                      <li key={m.planKey} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto" }}>
                        <span className="fn-who">{m.planName ?? m.planKey}</span>
                        <span className="fn-sub">{num(m.accounts)} {m.accounts === 1 ? "account" : "accounts"}</span>
                        <span className="fn-amt">{m.priced > 0 && m.currency ? `${money(m.monthly, m.currency)} a month` : "No price"}{m.source === "entered" && m.priced > 0 && <span className="fn-sub"> entered by you</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="ap-fine">{NOT_FROM_PLATFORM}: the next charge date and why a payment failed.</p>
              </section>
              <section className="fn-card" aria-label="By kind of business" data-testid="fn-verticals">
                <h2 className="fn-h">By kind of business</h2>
                {d.verticals.length === 0 ? <p className="ap-fine">Set each client&apos;s kind of business in Clients to see this.</p> : (
                  <div className="fn-bars">
                    {d.verticals.map((v) => (
                      <div className="fn-bar" key={v.key}>
                        <span className="fn-lab">{v.label}</span>
                        <span className="fn-track"><span className="fn-fill" style={{ width: `${Math.max(2, (v.monthly / Math.max(...d.verticals.map((x) => x.monthly), 1)) * 100)}%` }} /></span>
                        <span className="fn-amt">{usd(v.monthly)} <span className="fn-sub">({num(v.accounts)})</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className="fn-card" aria-label="Biggest plans">
              <h2 className="fn-h">Biggest plans</h2>
              {d.topAccounts.length === 0 ? <p className="ap-fine">No account has a price yet.</p> : (
                <ul className="fn-list">
                  {d.topAccounts.map((a) => (
                    <li key={a.locationId} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto" }}>
                      <button type="button" className="ap-link fn-who" style={{ textAlign: "left" }} onClick={() => go("account", a.locationId)}>{a.name}</button>
                      <span className="fn-sub">{a.source === "entered" ? "Price entered by you" : "Price from the platform"}</span>
                      <span className="fn-amt">{usd(a.monthly)} a month</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="ap-fine">Showing {d.range.from} to {d.range.to} (the date bar above). The money record starts on {d.trend.startsOn ?? "the next daily check"}; nothing before that is guessed.</p>
          </div>
        );
      }}
    </Load>
  );
}

function MovePanel({ kind, go, onClose }: { kind: MoveKind; go: (v: "account" | "payments", loc?: string) => void; onClose: () => void }) {
  const k = useKeyset<FnMovement["rows"][number], FnMovement>("movement", { kind }, { ranged: true, size: 10 });
  return (
    <div className="fn-card" style={{ marginTop: 10 }} data-testid="fn-move-panel" role="region" aria-label={`${KIND_LABEL[kind]} accounts`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="fn-h" style={{ margin: 0 }}>{KIND_LABEL[kind]}: {num(k.total)} {KIND_WORD[kind]}</h3><button type="button" className="ap-link" onClick={onClose}>Close</button></div>
      {k.loading ? <p className="ap-fine">Loading...</p> : k.error ? <p className="ap-fine">Could not load this.</p> : k.rows.length === 0 ? <p className="ap-fine">None in this period.</p> : (
        <ul className="fn-list" style={{ marginTop: 8 }}>
          {k.rows.map((m) => (
            <li key={m.locationId} className="fn-row" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) auto" }}>
              <button type="button" className="ap-link fn-who" style={{ textAlign: "left" }} onClick={() => go("account", m.locationId)}>{m.name}</button>
              <span className="fn-sub">{money(m.from, (m as { currency?: string }).currency ?? "USD")} to {money(m.to, (m as { currency?: string }).currency ?? "USD")} a month</span>
              <span className="fn-amt">{m.delta > 0 ? "+" : ""}{money(m.delta, (m as { currency?: string }).currency ?? "USD")}</span>
            </li>
          ))}
        </ul>
      )}
      {k.next && <div className="fn-more"><button type="button" className="s6-btn" onClick={k.showMore} disabled={k.more}>{k.more ? "Loading..." : "Show more"}</button></div>}
    </div>
  );
}
