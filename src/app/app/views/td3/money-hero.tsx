"use client";

import { useState, type ReactNode } from "react";
import { Banknote, Info, Layers, ShieldAlert, Target, Wallet } from "lucide-react";
import type { Td3ListKind, Td3Module, Td3Money, Td3Today } from "@/lib/analytics/today3-types";
import { changeOf, usdText } from "@/lib/analytics/today3-money-core";
import { useData } from "../../session";
import type { GoFn } from "../../nav";
import { useTd } from "./data";

// The money row at the top of Today: "will they buy?" before anything else. Five small cards, each one number, each number opens exactly its rows (the same drill the other Today cards use).
// A figure that cannot be known is never shown as 0: the card says "Not enough data yet" and what unlocks it. Money figures are estimates and say so; the info button says how each is worked out.
// Read only. Nothing here messages a lead or changes the CRM.

type Drill = { title: string; kind: Td3ListKind; location: string | null; count: number };
type Fin = { mrr: Array<{ amount: number; currency: string }>; highRisk: number; highRiskMrr: { amount: number; currency: string } | null; noPrice: number; accounts: number };
type FinOptions = { flags?: Record<string, boolean>; manager?: boolean };

const num = (n: number) => n.toLocaleString("en-US");
const cur = (amount: number, currency: string): string => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); } catch { return `${currency} ${num(Math.round(amount))}`; } };

function Card({ id, icon, label, how, tone, children }: { id: string; icon: ReactNode; label: string; how: string; tone?: "red" | "amber" | "green"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="td-mcard" data-tone={tone} data-testid={`td-mh-${id}`}>
      <div className="td-mtop"><span className="td-micon" aria-hidden>{icon}</span><span className="td-hlabel">{label}</span>
        <button type="button" className="td-minfo" aria-expanded={open} aria-label={`How is "${label}" worked out?`} title="How is this worked out?" onClick={() => setOpen(!open)}><Info size={14} aria-hidden /></button></div>
      {children}
      {open && <p className="td-hnote td-mhow" role="note" data-testid={`td-mh-${id}-how`}>{how}</p>}
    </div>
  );
}

/** One number: a button that opens its rows, or plain text when there is nothing behind it. */
function Num({ value, label, rows }: { value: string; label: string; rows: (() => void) | null }) {
  return rows ? <button type="button" className="td-hnum td-mnum" onClick={rows} aria-label={`${label}: ${value}. Show the rows`}>{value}</button> : <b className="td-hnum td-mnum">{value}</b>;
}

const Unknown = ({ why }: { why: string }) => <><b className="td-hnum td-mnum td-munk">Not enough data yet</b><span className="td-hnote">{why}</span></>;

export function MoneyHero({ t, location, level, go, nav, open }: { t: Td3Today; location: string; level: "all" | "account" | "self"; go: (m: Td3Module, loc?: string | null) => void; nav: GoFn; open: (d: Drill) => void }) {
  const r = useTd<Td3Money>("money", { location: location || undefined });
  const finOpt = useData<FinOptions>(level === "all" ? "finance?part=options" : null);
  const finOn = level === "all" && finOpt.data?.flags?.fn_module === true && finOpt.data.manager === true;
  const fin = useData<Fin>(finOn ? "finance?part=headline" : null);
  const m = r.data;
  if (level === "self" || (m && m.hidden)) return null;
  if (r.loading && !m) return <div className="td-mhero td-mskel" data-testid="td-money-hero" aria-busy="true" aria-label="Working out the money" />;
  if (!m || !m.atRisk) return null;
  const loc = location || null;
  const risk = m.atRisk, rec = m.recovered, pipe = m.pipeline, big = m.biggest;
  const drill = (title: string, kind: Td3ListKind, count: number) => () => open({ title, kind, location: loc, count });
  const delta = changeOf(rec.dollars, rec.previousDollars);
  const f = fin.data;
  const mrr = f?.mrr[0] ?? null;
  const causes: Array<{ k: "stale" | "waiting" | "noshow"; kind: Td3ListKind; text: string }> = [
    { k: "stale", kind: "risk_stale", text: "quiet" }, { k: "waiting", kind: "risk_waiting", text: "waiting over a day" }, { k: "noshow", kind: "risk_noshow", text: "no-show" },
  ];
  return (
    <div className="td-mhero" data-testid="td-money-hero" role="group" aria-label="Money at a glance">
      <Card id="risk" icon={<ShieldAlert size={16} />} label="Money at risk now" how={risk.formula} tone={risk.dollars ? "red" : undefined}>
        {risk.dollars === null ? <Unknown why={risk.why ?? "Add deal values in your CRM to see this."} /> : (
          <>
            <Num value={usdText(risk.dollars)} label="Money at risk now" rows={risk.deals > 0 ? drill("Deals at risk", "risk_all", risk.deals) : null} />
            <span className="td-hnote">{risk.deals === 0 ? "Nothing priced is at risk right now." : `Estimate, ${num(risk.deals)} ${risk.deals === 1 ? "deal" : "deals"}. Each deal counted once.`}</span>
            <span className="td-mcauses" aria-label="Where it comes from">
              {causes.filter((c) => risk.byCause[c.k].deals > 0).map((c) => <button key={c.k} type="button" className="ap-link" onClick={drill(`Deals: ${c.text}`, c.kind, risk.byCause[c.k].deals)} data-testid={`td-mh-cause-${c.k}`}>{num(risk.byCause[c.k].deals)} {c.text}{risk.byCause[c.k].dollars ? ` (${usdText(risk.byCause[c.k].dollars as number)})` : ""}</button>)}
            </span>
          </>
        )}
      </Card>

      <Card id="recovered" icon={<Banknote size={16} />} label={`Money recovered, ${rec.days} days`} how={rec.formula} tone={rec.dollars ? "green" : undefined}>
        {rec.why && rec.deals === 0 && rec.dollars === null ? <Unknown why={rec.why} /> : rec.deals === 0 ? (
          <>
            <b className="td-hnum td-mnum td-munk">None yet</b>
            <span className="td-hnote">{rec.short ? (rec.historyStarts ? `History starts ${rec.historyStarts}, so there is little to count yet.` : "History starts at your next refresh.") : "No deal was won after a reply or a rebooked visit in these days."}</span>
          </>
        ) : rec.dollars === null ? <Unknown why={`${num(rec.deals)} won ${rec.deals === 1 ? "deal has" : "deals have"} no dollar value, so there is nothing to add up.`} /> : (
          <>
            <span className="td-mval"><Num value={usdText(rec.dollars)} label="Money recovered" rows={drill("Deals won after a late reply or a rebooked no-show", "recovered_won", rec.deals)} />
              {delta && <span className="td-mdelta" data-up={delta.up ? "1" : "0"} data-testid="td-mh-delta" title="Against the 30 days before">{delta.text}</span>}</span>
            <span className="td-hnote">{num(rec.deals)} {rec.deals === 1 ? "deal" : "deals"} won after we saw the person answered.{rec.short && rec.historyStarts ? ` History starts ${rec.historyStarts}.` : ""}</span>
          </>
        )}
      </Card>

      <Card id="pipeline" icon={<Layers size={16} />} label="Open pipeline" how={pipe.formula}>
        {pipe.dollars === null ? <Unknown why="No open deal has a dollar value and an owner yet." /> : (
          <>
            <Num value={usdText(pipe.dollars)} label="Open pipeline" rows={drill("Open deals", "open_deals", pipe.open)} />
            <span className="td-hnote">{num(pipe.open)} open {pipe.open === 1 ? "deal" : "deals"}. {pipe.expected !== null ? `Expected about ${usdText(pipe.expected)} (estimate).` : pipe.expectedWhy ?? ""}</span>
            {pipe.expected !== null && pipe.expectedWhy && <span className="td-hnote">{pipe.expectedWhy}</span>}
          </>
        )}
      </Card>

      {finOn && (
        <Card id="revenue" icon={<Wallet size={16} />} label="Your monthly revenue" how="What the plans you sell your client accounts bring in each month, from the plan prices the platform reports or you entered in Money. Who may cancel comes from Money, Plans and churn: quiet accounts and failing payments.">
          {!f ? <span className="td-hnote">Reading Money...</span> : !mrr ? <Unknown why={f.noPrice > 0 ? "Add what each plan costs in Money." : "No client account is on a paid plan yet."} /> : (
            <>
              <b className="td-hnum td-mnum">{cur(mrr.amount, mrr.currency)}</b>
              <span className="td-hnote">A month, estimate. {f.highRisk > 0 ? `${num(f.highRisk)} ${f.highRisk === 1 ? "account" : "accounts"} may cancel${f.highRiskMrr ? ` (${cur(f.highRiskMrr.amount, f.highRiskMrr.currency)} a month)` : ""}.` : "Nobody looks likely to cancel."}</span>
            </>
          )}
          <button type="button" className="ap-link td-hgo" onClick={() => nav("finance")} data-testid="td-mh-open-money">Open Money</button>
        </Card>
      )}

      <Card id="action" icon={<Target size={16} />} label="Money you can save today" how={`The single action that protects the most dollars today: ${risk.formula}`} tone={big ? "amber" : undefined}>
        {big ? (
          <>
            <b className="td-hnum td-mnum">About {usdText(big.dollars)}</b>
            <span className="td-hnote">{big.label}. {big.why} Estimate.</span>
            <button type="button" className="s6-btn td-mgo" data-kind="primary" onClick={drill(big.label, big.list, big.deals)} data-testid="td-mh-go">{big.cause === "stale" ? "Open these deals" : big.cause === "waiting" ? "Open these people" : "Open these no-shows"} ({num(big.deals)})</button>
          </>
        ) : (
          <>
            <Unknown why={risk.deals === 0 && risk.dollars !== null ? "Nothing priced is at risk right now." : "No deal at risk has a dollar value yet."} />
            {t.button && <button type="button" className="s6-btn td-mgo" data-kind="primary" onClick={() => go(t.button?.module ?? "speed", t.button?.locationId ?? null)} data-testid="td-mh-go">{t.button.label}</button>}
          </>
        )}
      </Card>
    </div>
  );
}
