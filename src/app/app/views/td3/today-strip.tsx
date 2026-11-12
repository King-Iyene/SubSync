"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import type { Td3ListKind, Td3Module, Td3Money, Td3Today } from "@/lib/analytics/today3-types";
import { changeOf, usdText } from "@/lib/analytics/today3-money-core";
import { looksLikeTestDeal, mainSlots, riskFigure } from "@/lib/analytics/today3-strip";
import { cardLink, setDeepLink } from "@/lib/design/deep-link";
import { useData } from "../../session";
import type { GoFn } from "../../nav";
import { useTd } from "./data";
import { TrustBasis } from "./trust-basis";
import "./strip.css";

// The Today figure strip: ONE editorial strip (hairlines, serif figures, mono small-caps labels, the same language as the headline and the table below it).
// Line one is money (at risk, recovered, open pipeline, monthly revenue); line two is the day's work (no-shows, appointments, done today); under it one "Biggest win today" bar with the page's one solid button.
// "Money at risk" has ONE source here (the money read). The older item-list figure is used only when the money read is hidden for this person. Each figure loads, fails and retries on its own.
// Read only. Nothing here messages a lead or changes the CRM.

type Drill = { title: string; kind: Td3ListKind; location: string | null; count: number };
type Fin = { mrr: Array<{ amount: number; currency: string }>; highRisk: number; highRiskMrr: { amount: number; currency: string } | null; noPrice: number; accounts: number };
type FinOptions = { flags?: Record<string, boolean>; manager?: boolean };
type Tone = "bad" | "warn" | "ok";

const num = (n: number) => n.toLocaleString("en-US");
const cur = (amount: number, currency: string): string => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); } catch { return `${currency} ${num(Math.round(amount))}`; } };
const deals = (n: number) => `${num(n)} ${n === 1 ? "deal" : "deals"}`;

/** One figure: label row (dot, label, info) / number / one line / action at the bottom. Same box in every state, so nothing moves. */
function Fig({ id, label, how, tone, sub, children }: { id: string; label: string; how: string; tone?: Tone; sub?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="td-sfig" data-sub={sub ? "1" : undefined} data-testid={sub ? `td-hero-${id}` : `td-mh-${id}`} ref={box}>
      <div className="td-sk">
        <span className="td-sdot" data-tone={tone ?? "none"} aria-hidden />
        <span className="t-label td-slabel">{label}</span>
        <button type="button" className="td-sinfo" aria-expanded={open} aria-label={`How is "${label}" worked out?`} title="How is this worked out?" onClick={() => setOpen(!open)}><Info size={14} aria-hidden /></button>
      </div>
      {open && <p className="td-spop t-small" role="note" data-testid={`${sub ? `td-hero-${id}` : `td-mh-${id}`}-how`}>{how}</p>}
      {children}
    </div>
  );
}

/** The figure itself: a plain button when there are rows behind it, plain text otherwise. */
function Num({ value, label, rows, muted }: { value: string; label: string; rows: (() => void) | null; muted?: boolean }) {
  const cls = `td-snum${muted ? " td-sunk" : ""}`;
  return rows ? <button type="button" className={cls} onClick={rows} aria-label={`${label}: ${value}. Show the rows`}>{value}</button> : <b className={cls}>{value}</b>;
}
const Line = ({ children }: { children: ReactNode }) => <p className="td-sline t-small t-quiet">{children}</p>;
const Foot = ({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) => (
  <div className="td-sfoot"><button type="button" className="td-slink" onClick={onClick} data-testid={testId}>{label}<span aria-hidden>→</span></button></div>
);
const Unknown = ({ why }: { why: string }) => <><b className="td-snum td-sunk">Not enough data yet</b><Line>{why}</Line></>;
const TestNote = () => <span className="td-stest" data-testid="td-test-deal" title="The value is a round, very large number next to the account's other deals. Check it before relying on the total.">Looks like a test deal</span>;
const Failed = ({ what, retry }: { what: string; retry: () => void }) => <><b className="td-snum td-sunk">Could not load</b><Line>{what}</Line><Foot label="Try again" onClick={retry} testId="td-strip-retry" /></>;

/** The skeleton: the same boxes as the final strip, so the figures fade in without a jump. */
function Skeleton({ n, sub, label }: { n: number; sub?: boolean; label: string }) {
  return (
    <div className="td-srow" data-n={n} data-sub={sub ? "1" : undefined} aria-busy="true" aria-label={label} data-testid={sub ? "td-strip-skel-sub" : "td-strip-skel"}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="td-sfig td-sskel" data-sub={sub ? "1" : undefined} data-testid="td-strip-skel-fig"><span className="td-sbar" style={{ width: "46%" }} /><span className="td-sbar big" style={{ width: "62%" }} /><span className="td-sbar" style={{ width: "78%" }} /></div>
      ))}
    </div>
  );
}

export function TodayStrip({ t, location, level, go, nav, open }: { t: Td3Today; location: string; level: "all" | "account" | "self"; go: (m: Td3Module, loc?: string | null) => void; nav: GoFn; open: (d: Drill) => void }) {
  const r = useTd<Td3Money>("money", { location: location || undefined });
  const finOpt = useData<FinOptions>(level === "all" ? "finance?part=options" : null);
  const finOn = level === "all" && finOpt.data?.flags?.fn_module === true && finOpt.data.manager === true;
  const fin = useData<Fin>(finOn ? "finance?part=headline" : null);
  const m = r.data;
  const loc = location || null;
  const moneyShown = level !== "self" && !(m && m.hidden);
  const drill = (title: string, kind: Td3ListKind, count: number) => () => open({ title, kind, location: loc, count });

  // ---- line two: the day's work (counts equal the rows they open) ----
  const item = (k: string) => t.items.find((i) => i.kind === k) ?? null;
  const nUnmarked = t.counts?.unmarked ?? item("unmarked")?.count ?? 0, nNoshows = t.counts?.noshows ?? item("noshows")?.count ?? 0;
  const cleared = t.done.reduce((s, d) => s + d.cleared, 0);
  const since = t.historyStarts ? `History starts ${t.historyStarts}` : "No earlier record yet";
  const goTo = (kind: string, count: number, view: Parameters<GoFn>[0]) => () => { setDeepLink(cardLink(kind as never, { count, location: loc })); nav(view, loc ?? undefined); };

  // ---- line one: money ----
  const risk = m && !m.hidden ? m.atRisk : null, rec = m?.recovered, pipe = m?.pipeline, big = m?.biggest ?? null;
  const f = fin.data, mrr = f?.mrr[0] ?? null;
  const causes: Array<{ k: "stale" | "waiting" | "noshow"; kind: Td3ListKind; text: string }> = [{ k: "stale", kind: "risk_stale", text: "quiet" }, { k: "waiting", kind: "risk_waiting", text: "waiting over a day" }, { k: "noshow", kind: "risk_noshow", text: "no-show" }];
  const showRevenue = moneyShown && finOn;
  const slots = mainSlots(showRevenue).length;
  const fig = riskFigure(m ?? null, t);
  const retry = () => void r.reload();

  let moneyLine: ReactNode = null;
  if (moneyShown) {
    if (r.loading && !m) moneyLine = <Skeleton n={slots} label="Working out the money" />;
    else if (!m || !m.atRisk || !risk || !rec || !pipe) {
      const label = (id: string, text: string) => <Fig key={id} id={id} label={text} how="This figure could not be read just now."><Failed what="The money figures did not load." retry={retry} /></Fig>;
      moneyLine = <div className="td-srow" data-n={slots} data-testid="td-money-hero" role="group" aria-label="Money at a glance">{[label("risk", "Money at risk"), label("recovered", "Money recovered"), label("pipeline", "Open pipeline")]}</div>;
    } else {
      const delta = changeOf(rec.dollars, rec.previousDollars);
      const testRisk = looksLikeTestDeal(risk.dollars, risk.deals, { dollars: pipe.dollars, deals: pipe.open });
      const samePipe = risk.dollars !== null && pipe.dollars !== null && risk.dollars >= pipe.dollars * 0.99;
      moneyLine = (
        <div className="td-srow" data-n={slots} role="group" aria-label="Money at a glance" data-testid="td-money-hero">
          <Fig id="risk" label="Money at risk" how={risk.formula} tone={risk.dollars ? "bad" : undefined}>
            {risk.dollars === null ? <Unknown why={risk.why ?? "Add deal values in your CRM to see this."} /> : (
              <>
                <Num value={usdText(risk.dollars)} label="Money at risk" rows={risk.deals > 0 ? drill("Deals at risk", "risk_all", risk.deals) : null} />
                <Line>{risk.deals === 0 ? "Nothing priced is at risk." : <>{deals(risk.deals)} at risk, estimate{testRisk && <> <TestNote /></>}</>}</Line>
                {risk.deals > 0 && (
                  <span className="td-scauses" aria-label="Where it comes from">
                    {causes.filter((c) => risk.byCause[c.k].deals > 0).map((c) => <button key={c.k} type="button" className="td-slink td-sinline" onClick={drill(`Deals: ${c.text}`, c.kind, risk.byCause[c.k].deals)} data-testid={`td-mh-cause-${c.k}`}>{num(risk.byCause[c.k].deals)} {c.text}</button>)}
                  </span>
                )}
                {risk.deals > 0 && <Foot label="View deals" onClick={drill("Deals at risk", "risk_all", risk.deals)} />}
              </>
            )}
          </Fig>

          <Fig id="recovered" label="Money recovered" how={rec.formula} tone={rec.dollars ? "ok" : undefined}>
            {rec.why && rec.deals === 0 && rec.dollars === null ? <Unknown why={rec.why} /> : rec.deals === 0 ? (
              <><b className="td-snum td-sunk">None yet</b><Line>{rec.short ? (rec.historyStarts ? `History starts ${rec.historyStarts}.` : "History starts at your next refresh.") : "No deal was won after a reply or a rebooked visit."}</Line></>
            ) : rec.dollars === null ? <Unknown why={`${deals(rec.deals)} won, none with a dollar value.`} /> : (
              <>
                <span className="td-sval"><Num value={usdText(rec.dollars)} label="Money recovered" rows={drill("Deals won after a late reply or a rebooked no-show", "recovered_won", rec.deals)} />
                  {delta && <span className="td-sdelta" data-up={delta.up ? "1" : "0"} data-testid="td-mh-delta" title="Against the 30 days before">{delta.text}</span>}</span>
                <Line>{deals(rec.deals)} won after a reply, {rec.days} days.{rec.short && rec.historyStarts ? ` History starts ${rec.historyStarts}.` : ""}</Line>
                <Foot label="View won deals" onClick={drill("Deals won after a late reply or a rebooked no-show", "recovered_won", rec.deals)} />
              </>
            )}
          </Fig>

          <Fig id="pipeline" label="Open pipeline" how={pipe.formula}>
            {pipe.dollars === null ? <Unknown why="No open deal has a dollar value and an owner yet." /> : (
              <>
                <Num value={usdText(pipe.dollars)} label="Open pipeline" rows={drill("Open deals", "open_deals", pipe.open)} />
                <Line>{samePipe ? `${deals(pipe.open)}, all of it at risk.` : `${deals(pipe.open)}${pipe.expected !== null ? `, about ${usdText(pipe.expected)} likely (estimate)` : ""}.`}{pipe.expected === null && pipe.expectedWhy && !samePipe ? ` ${pipe.expectedWhy}` : ""}</Line>
                <Foot label="View deals" onClick={drill("Open deals", "open_deals", pipe.open)} />
              </>
            )}
          </Fig>

          {showRevenue && (
            <Fig id="revenue" label="Monthly revenue" how="What the plans you sell your client accounts bring in each month, from the plan prices the platform reports or you entered in Money. Who may cancel comes from Money, Plans and churn: quiet accounts and failing payments.">
              {fin.error && !f ? <Failed what="Money did not load." retry={() => void fin.reload()} /> : !f ? <span className="td-sload" aria-busy="true" aria-label="Reading Money"><span className="td-sbar big" style={{ width: "62%" }} /><span className="td-sbar" style={{ width: "78%" }} /></span> : !mrr ? <Unknown why={f.noPrice > 0 ? "Add what each plan costs in Money." : "No client account is on a paid plan yet."} /> : (
                <>
                  <b className="td-snum">{cur(mrr.amount, mrr.currency)}</b>
                  <Line>A month, estimate. {f.highRisk > 0 ? `${num(f.highRisk)} ${f.highRisk === 1 ? "account" : "accounts"} may cancel.` : "Nobody looks likely to cancel."}</Line>
                </>
              )}
              <Foot label="Open Money" onClick={() => nav("finance")} testId="td-mh-open-money" />
            </Fig>
          )}
        </div>
      );
    }
  }

  // The money read is hidden for this person: the older figure stands in (one source, never two).
  const fallbackRisk = !moneyShown ? (
    <Fig id="risk" sub label="Money at risk" how="Open deals that have gone quiet, valued from the deal amount. An estimate." tone={fig.dollars ? "bad" : "ok"}>
      <Num value={fig.dollars ? usdText(fig.dollars) : "None"} label="Money at risk" rows={null} />
      <Line>{fig.dollars ? `Estimate, ${deals(fig.deals)} gone quiet` : "No deal has gone quiet"}</Line>
    </Fig>
  ) : null;

  const subFigs: ReactNode[] = [
    fallbackRisk,
    <Fig key="noshows" id="noshows" sub label="No-shows to rebook" how="People who missed an appointment in the last 7 days and have not booked again." tone={nNoshows > 0 ? "warn" : "ok"}>
      <Num value={num(nNoshows)} label="No-shows to rebook" rows={nNoshows > 0 ? drill("No-shows not booked again", "open_noshows", nNoshows) : null} />
      <Line>{nNoshows > 0 ? "Missed in the last 7 days" : "Nobody to rebook"}</Line>
      {nNoshows > 0 ? <Foot label="View no-shows" onClick={goTo("noshows", nNoshows, "appointments")} /> : <div className="td-sfoot" />}
    </Fig>,
    <Fig key="appts" id="appts" sub label="Appointments to confirm" how="Appointments whose time has passed and nobody marked came or no-show." tone={nUnmarked > 0 ? "warn" : "ok"}>
      <Num value={num(nUnmarked)} label="Appointments to confirm" rows={nUnmarked > 0 ? drill("Appointments with no outcome marked", "all_unmarked", nUnmarked) : null} />
      <Line>{nUnmarked > 0 ? "Past their time, no result marked" : "Every past one is marked"}</Line>
      {nUnmarked > 0 ? <Foot label="View appointments" onClick={goTo("unmarked", nUnmarked, "appointments")} /> : <div className="td-sfoot" />}
    </Fig>,
    <Fig key="done" id="done" sub label="Done today" how="Problems found earlier that were cleared since midnight." tone={cleared > 0 ? "ok" : undefined}>
      <Num value={num(cleared)} label="Done today" rows={() => document.getElementById("td-done")?.scrollIntoView({ block: "nearest", behavior: "smooth" })} />
      <Line>{t.historyStarts ? "Problems cleared since midnight" : since}</Line>
      <div className="td-sfoot" />
    </Fig>,
  ].filter(Boolean);
  const subN = subFigs.length;

  // ---- the biggest-win bar: one sentence, the page's one solid button ----
  const b = t.button;
  let win: ReactNode = null;
  if (moneyShown && m && !m.hidden && big) {
    const part = risk && risk.dollars !== null && big.dollars < risk.dollars ? ` About ${usdText(big.dollars)} of it.` : "";
    const verb = big.cause === "stale" ? "Open these deals" : big.cause === "waiting" ? "Open these people" : "Open these no-shows";
    win = <Win sentence={`${big.label}. ${big.why}${part}`} button={<button type="button" className="s6-btn td-swin-go" data-kind="primary" onClick={drill(big.label, big.list, big.deals)} data-testid="td-mh-go">{verb} ({num(big.deals)})</button>} />;
  } else if (moneyShown && m && !m.hidden && m.atRisk && t.button) {
    win = <Win sentence={risk && risk.deals === 0 && risk.dollars !== null ? "Nothing priced is at risk right now." : "No deal at risk has a dollar value yet."} button={<button type="button" className="s6-btn td-swin-go" data-kind="primary" onClick={() => go(b?.module ?? "speed", b?.locationId ?? null)} data-testid="td-mh-go">{b?.label}</button>} />;
  }

  return (
    <section className="td-strip" data-testid="td-strip" aria-label="Today at a glance">
      {moneyLine}
      {moneyShown && m?.trust && <TrustBasis t={m.trust} onShowLeftOut={drill("Deals left out of the dollar figures", "left_out", m.trust.leftOutDeals)} />}
      <div className="td-srow" data-n={subN} data-sub="1" role="group" aria-label="Today at a glance" data-testid="td-hero">{subFigs}</div>
      {win}
    </section>
  );
}

function Win({ sentence, button }: { sentence: string; button: ReactNode }) {
  return (
    <div className="td-swin" data-testid="td-strip-win">
      <div className="td-swin-text"><p className="t-label">Biggest win today</p><p className="td-swin-line">{sentence}</p></div>
      {button}
    </div>
  );
}
