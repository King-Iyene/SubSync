"use client";

import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { filterProof, PROOF_WORDS, proofHeadline, proofSummary } from "@/lib/analytics/proof-view";
import type { Proof } from "@/lib/analytics/today-queue";
import { specAlerts } from "@/lib/analytics/today-specs";
import { WhatIs } from "../ds/what-is";
import { ModeToggle, TimeChart, useChartMode } from "../ds/time-chart";
import { fmtFull, fmtStat } from "@/lib/analytics/chart-format";
import { ReportFilterBar, useReportFilter } from "./report-filter";
import { TabIntro } from "./today-flow";
import type { TodayModel } from "./today-model";

// The Proof tab for a non-technical reader: one sentence, three numbers with plain names, one chart of the last 7 days (problems found and fixed side by side), and a short
// summary an agency can show its client. Read from the alerts Today already holds, so the dates are fixed at the last 7 days; the client can be chosen.

export function ProofTab({ m, proof, agency, clients, who }: { m: TodayModel; proof: Proof; agency: boolean; clients?: Array<{ id: string; name: string }>; who: string }) {
  const f = useReportFilter("p", "7d");
  const [mode, setMode] = useChartMode("proof");
  const [day, setDay] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const only = f.client && f.client !== "all" ? f.client : null;
  const p = useMemo(() => filterProof(proof, only), [proof, only]);
  const name = only ? (clients?.find((c) => c.id === only)?.name ?? "This client") : who;
  const cards = [
    { k: "found", n: p.raised, open: "raised" as const }, { k: "fixed", n: p.cleared, open: "cleared" as const }, { k: "open", n: p.open, open: "open" as const },
  ] as const;
  const copy = async () => { try { await navigator.clipboard.writeText(proofSummary(p, name)); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); } };
  return (
    <section aria-labelledby="caught-h" data-testid="today-proof" className="max-w-4xl">
      <TabIntro name="Proof" />
      <ReportFilterBar f={f} label="Proof" noDates clients={agency ? clients : undefined} datesNote="This tab always shows the last 7 days of problems SubSync found." />
      <h2 id="caught-h" className="sr-only">What SubSync found</h2>
      <p className="text-[0.9375rem] font-medium" data-testid="proof-headline">{proofHeadline(p)}{p.open > 0 && <> <button type="button" onClick={() => m.open(specAlerts(p, "open"))} data-testid="proof-open-open" className="ds-press cursor-pointer font-normal text-primary underline underline-offset-4">See the {fmtFull(p.open)}</button></>}</p>
      <dl className="mt-4 grid grid-cols-3 items-stretch gap-4" data-testid="proof-strip">
        {cards.map(({ k, n, open }) => (
          <div key={k} className="min-w-0 border-l border-[var(--t-rule2)] pl-3">
            <dt className="t-label flex items-center gap-1 truncate">{PROOF_WORDS[k].label}<WhatIs text={PROOF_WORDS[k].info} /></dt>
            <dd className="t-figure t-num mt-1.5 max-w-full truncate" data-testid={`proof-${k === "found" ? "raised" : k === "fixed" ? "cleared" : "still-open"}`} title={fmtFull(n)}>
              {n > 0 ? <button type="button" onClick={() => m.open(specAlerts(p, open))} aria-label={`${PROOF_WORDS[k].label}: ${n}. See them.`} data-testid={`proof-open-${open}`} className="ds-press -mx-1 cursor-pointer rounded-md px-1 underline decoration-primary/40 decoration-[0.07em] underline-offset-[0.18em] hover:decoration-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{fmtStat(n)}</button> : n}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mb-2 mt-8 flex items-center justify-between gap-3">
        <h3 className="t-title">Problems found and fixed, last 7 days</h3>
        <ModeToggle mode={mode} onChange={setMode} label="Problems found and fixed" />
      </div>
      <TimeChart testId="raised-cleared" mode={mode} selectedId={day} label="Problems found and fixed each day, last 7 days" noun="Day" hint="Select a day to see its problems."
        points={p.days.map((d) => ({ id: d.day, label: `${d.label}, ${d.day}`, short: d.label }))}
        series={[{ key: "found", name: "Found", colour: "var(--t-c1)", values: p.days.map((d) => d.raised.length) }, { key: "fixed", name: "Fixed", colour: "var(--t-c2)", values: p.days.map((d) => d.cleared.length) }]}
        onPick={(i) => { setDay(p.days[i].day); m.open(specAlerts(p, { day: i })); }} />
      {agency && (
        <div className="mt-8 border-t border-[var(--t-rule)] pt-4" data-testid="proof-share">
          <h3 className="t-title">Show this to your client <WhatIs text="A short note you can paste into an email or message. It has numbers only, no names of other clients." /></h3>
          <p className="mt-2 max-w-xl text-sm" data-testid="proof-summary">{proofSummary(p, name)}</p>
          <button type="button" onClick={() => void copy()} data-testid="proof-copy" className="ds-press mt-3 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm font-medium hover:border-primary hover:text-primary"><Copy aria-hidden className="size-4" />{copied ? "Copied" : "Copy summary"}</button>
        </div>
      )}
    </section>
  );
}
