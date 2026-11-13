"use client";

import { useEffect, useState } from "react";
import type { FunnelDrill, FunnelStep, Pl3Funnel, Pl3FunnelDeals, Pl3Stuck } from "@/lib/analytics/pipeline3-funnel-types";
import type { Pl3Row } from "@/lib/analytics/pipeline3-types";
import type { PlDeal } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, OpenLeadButton, SkeletonRows } from "../../ds";
import { useData } from "../../session";
import { dealOf } from "./adapters";
import type { PlFilters } from "./data";
import { moneyShort } from "./format";
import { dealSeed, Pager } from "./parts";

// Pipeline sub-sections "Step history" (the funnel) and "Stuck in a step" (the money list). Both read what SubSync recorded itself, because the CRM keeps only the last move on a deal.
// Every count opens exactly its deals in the shared lead panel; the number and the list come from one query. Switched on by the pl_history_funnel flag.

const PATHS = { funnel: "funnel", deals: "funnel-deals", stuck: "stuck", settings: "funnel-settings" } as const;

function path(part: string, f: PlFilters, extra: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams({ part });
  if (f.from && f.to) { p.set("from", f.from); p.set("to", f.to); if (f.fromTime && f.toTime) { p.set("fromTime", f.fromTime); p.set("toTime", f.toTime); } }
  if (f.locationId) p.set("location", f.locationId);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, String(v));
  return `pipeline3?${p}`;
}

/** True once the history funnel is switched on for this person (the sub-sections only show then). */
export function useHistoryFunnelOn(): boolean {
  const r = useData<{ minSample: number }>(path(PATHS.settings, { locationId: "", pipeline: "", ownerId: "", q: "" }, {}));
  return !!r.data;
}

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

function Frame({ r, label, children }: { r: { data: unknown; error: unknown; reload: () => void }; label: string; children: React.ReactNode }) {
  if (r.error) return <ErrorState error={r.error as never} onRetry={r.reload} />;
  if (!r.data) return <SkeletonRows rows={4} label={label} />;
  return <>{children}</>;
}

type DealRowsProps = { rows: Pl3Row[]; showAccount: boolean; onOpen: (d: PlDeal) => void; activeId: string | null; testId: string };
function Rows({ rows, showAccount, onOpen, activeId, testId }: DealRowsProps) {
  return (
    <div className="ap-scroll">
      <table className="ap-t" data-testid={testId}>
        <thead><tr><th>Deal</th>{showAccount && <th>Account</th>}<th data-num>Value</th><th>Why it is here</th><th className="text-right">Open</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const d = dealOf(r);
            return (
              <tr key={`${r.locationId}-${r.opportunityId}`} data-active={activeId === d.id ? "1" : "0"} onClick={() => onOpen(d)} data-testid="plhf-row">
                <td><span className="ap-name">{d.name}</span> <span className="ap-sub">{d.contactName}</span></td>
                {showAccount && <td>{d.accountName}</td>}
                <td data-num>{d.valueCents > 0 ? moneyShort(d.valueCents) : "No value"}</td>
                <td className="ap-sub">{r.why ?? ""}</td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}><OpenLeadButton seed={dealSeed(d)} crmUrl={d.url} reason="This deal has no person linked, so there is nobody to open." name={d.contactName ?? d.name} showAccount={showAccount} testId="plhf-open" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const OUTCOMES: Array<{ key: Exclude<FunnelDrill, "entered">; label: string; tone: string }> = [
  { key: "advanced", label: "moved on", tone: "green" }, { key: "here", label: "still here", tone: "cyan" },
  { key: "other", label: "went elsewhere", tone: "grey" }, { key: "dropped", label: "lost", tone: "red" },
];

export function HistoryFunnel({ filters, onOpen, activeId, showAccount }: { filters: PlFilters; onOpen: (d: PlDeal) => void; activeId: string | null; showAccount: boolean }) {
  const [pipe, setPipe] = useState("");
  const f = useData<Pl3Funnel>(filters.from ? path(PATHS.funnel, filters, { pipeline: pipe }) : null);
  const [pick, setPick] = useState<{ step: FunnelStep; drill: FunnelDrill } | null>(null);
  const [page, setPage] = useState(0), [size, setSize] = useState(20);
  const key = JSON.stringify([pipe, filters.from, filters.to, filters.locationId]);
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setPick(null); setPage(0); }
  const chosen = f.data?.pipeline ?? "";
  const list = useData<Pl3FunnelDeals>(filters.from && pick && chosen ? path(PATHS.deals, filters, { pipeline: chosen, step: pick.step.key, drill: pick.drill, page, size }) : null);
  useEffect(() => { setPage(0); }, [pick?.step.key, pick?.drill]); // eslint-disable-line react-hooks/set-state-in-effect
  const d = f.data;
  return (
    <div data-testid="plhf">
      <Frame r={f} label="Loading step history...">
        {d && (
          <>
            <section className="s6-card" style={{ padding: 16, marginBottom: 14 }}>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-base font-semibold">How deals moved through your steps</h3>
                {d.pipelines.length > 1 && <select className="ap-field" aria-label="Pipeline" value={chosen} onChange={(e) => setPipe(e.target.value)} data-testid="plhf-pipe">{d.pipelines.map((n) => <option key={n} value={n}>{n}</option>)}</select>}
              </div>
              <p className="ap-fine mt-1" data-testid="plhf-since">
                {d.historySince ? `History starts ${date(d.historySince)}: your CRM keeps only the last move on a deal, so SubSync wrote down every move from then on.` : "SubSync has not recorded a step move yet."}
                {d.windowStartsBeforeHistory ? " Your dates reach back before that, so earlier moves are not counted." : ""}
              </p>
              <p className="ap-fine">Counts are deals that first entered each step in these dates. Pick a number to see exactly those deals.{d.excludedTests ? " Deals that look like tests are left out." : ""}</p>
            </section>
            {d.empty ? (
              <EmptyState title="Not enough data yet" body={d.historySince ? "No deal moved into one of these steps in the dates above. Try a longer range." : "Moves are recorded as they happen. Come back after your team has moved some deals."} />
            ) : (
              <ol className="plhf-steps" data-testid="plhf-steps">
                {d.steps.map((s) => (
                  <li key={s.key} className="plhf-step">
                    <div className="plhf-head">
                      <span className="ap-name">{s.name}</span>
                      <button type="button" className="ap-link" onClick={() => setPick({ step: s, drill: "entered" })} data-testid="plhf-entered">{s.entered.toLocaleString("en-US")} entered</button>
                      <span className="ap-fine" data-testid="plhf-rate">{s.advanceRate === null ? `Not enough data yet (needs ${d.minSample} deals)` : `${Math.round(s.advanceRate * 100)}% moved on`}</span>
                      <span className="ap-fine">{s.medianDays === null ? "Typical stay: not enough data yet" : `Typical stay ${s.medianDays} days`}</span>
                    </div>
                    <div className="plhf-bar" role="group" aria-label={`What became of the ${s.entered} deals that entered ${s.name}`}>
                      {OUTCOMES.map((o) => {
                        const n = s[o.key];
                        return n > 0 ? <button type="button" key={o.key} className="plhf-seg" data-tone={o.tone} style={{ flexGrow: n }} onClick={() => setPick({ step: s, drill: o.key })} aria-label={`${n} ${o.label}`} title={`${n} ${o.label}`} data-testid={`plhf-seg-${o.key}`}>{n}</button> : null;
                      })}
                    </div>
                    <p className="ap-fine plhf-key">{OUTCOMES.filter((o) => s[o.key] > 0).map((o) => `${s[o.key]} ${o.label}`).join(", ")}</p>
                  </li>
                ))}
              </ol>
            )}
            {pick && (
              <div className="mt-5" data-testid="plhf-drill">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <h3 className="text-base font-semibold" data-testid="plhf-drill-title">{pick.step.name}: {pick.drill === "entered" ? "all deals that entered" : OUTCOMES.find((o) => o.key === pick.drill)?.label}</h3>
                  {list.data && <span className="ap-chip" data-tone="cyan" data-testid="plhf-drill-count">{list.data.total.toLocaleString("en-US")}</span>}
                  <button type="button" className="ap-link ml-auto" onClick={() => setPick(null)}>Close list</button>
                </div>
                <Frame r={list} label="Loading deals...">
                  {list.data && (list.data.total === 0 ? <EmptyState title="No deals here" body="Nothing in this group in these dates." /> : (
                    <div className="ap-tablewrap">
                      <Rows rows={list.data.rows} showAccount={showAccount} onOpen={onOpen} activeId={activeId} testId="plhf-drill-rows" />
                      <Pager total={list.data.total} page={page + 1} size={size} onPage={(p) => setPage(p - 1)} onSize={(s) => { setSize(s); setPage(0); }} />
                    </div>
                  ))}
                </Frame>
              </div>
            )}
          </>
        )}
      </Frame>
    </div>
  );
}

export function StuckInStep({ filters, onOpen, activeId, showAccount }: { filters: PlFilters; onOpen: (d: PlDeal) => void; activeId: string | null; showAccount: boolean }) {
  const [page, setPage] = useState(0), [size, setSize] = useState(20);
  const key = JSON.stringify([filters.locationId, filters.pipeline, filters.q]);
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setPage(0); }
  const r = useData<Pl3Stuck>(filters.from ? path(PATHS.stuck, filters, { pipeline: filters.pipeline, q: filters.q.trim() || undefined, page, size }) : null);
  const d = r.data;
  return (
    <div data-testid="plhf-stuck">
      <Frame r={r} label="Finding stuck deals...">
        {d && (
          <>
            <section className="s6-card ap-hero" style={{ padding: 20, marginBottom: 14 }}>
              <span className="ap-fine">Stuck longer than usual for their step</span>
              <p className="ap-sentence" data-testid="plhf-stuck-total">
                {d.total === 0 ? "No deal is past the usual time for its step." : <>About <b className="ap-strong" data-tone="amber">{moneyShort(Math.round(d.totalValue * 100))}</b> in {d.total.toLocaleString("en-US")} deal{d.total === 1 ? "" : "s"} <span className="ap-chip" data-tone="grey">estimate</span></>}
              </p>
              <details className="ap-formula"><summary>How is this worked out?</summary><p className="ap-fine">{d.formula}</p></details>
              {d.notJudged > 0 && <p className="ap-fine mt-1" data-testid="plhf-notjudged">{d.notJudged.toLocaleString("en-US")} open deals sit in steps with fewer than {d.minSample} finished stays, so SubSync does not say whether they are stuck yet.</p>}
              {d.byStage.length > 0 && <p className="ap-fine mt-1">{d.byStage.slice(0, 4).map((s) => `${s.stage}: ${s.count} (${moneyShort(Math.round(s.value * 100))}, usual ${s.usualDays === null ? "?" : Math.ceil(s.usualDays)} days)`).join(" · ")}</p>}
            </section>
            {d.total === 0 ? <EmptyState title="Nothing stuck right now" body="Deals with no value, no owner, or that look like tests are never listed. Steps with too little history are not judged." /> : (
              <div className="ap-tablewrap">
                <Rows rows={d.rows} showAccount={showAccount} onOpen={onOpen} activeId={activeId} testId="plhf-stuck-rows" />
                <Pager total={d.total} page={page + 1} size={size} onPage={(p) => setPage(p - 1)} onSize={(s) => { setSize(s); setPage(0); }} />
              </div>
            )}
          </>
        )}
      </Frame>
    </div>
  );
}
