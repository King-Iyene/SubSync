"use client";

import { useMemo } from "react";
import { ladderRows, STEP_SCALE, type LadderRow } from "@/lib/design/leak-ladder";
import { relativeTone, TONE_GLYPH, type Tone } from "@/lib/design/status-tone";
import { fmtInt } from "../../ui";
import { DeltaTag, RateTag, StatusLegend, TONE_TEXT, toneVar } from "../ap3/status-ui";
import { SCALES } from "@/lib/design/status-tone";
import type { StepKey } from "@/lib/analytics/bf-core";
import type { BreakdownRes, SummaryRes } from "./bf-data";
import type { LadderPick } from "./bf-ladder";

// THE LEAK LADDER: the lead-to-customer funnel as rows. Each step shows how many leads are left (the bar), the share that got through (coloured good / watch / bad), a "lost here" button that
// opens exactly the leads that stopped, one plain thing to do, and how the step moved against the period before. Real numbers only; the counts are the server's, never re-counted here.

const LOST_TITLE: Record<string, string> = { answered: "Never got a reply", booked: "Replied, never booked", showed: "Booked, never showed", deal: "Showed, no deal opened", won: "Deal not won yet" };
const money = (v: number | null | undefined) => (v === null || v === undefined ? null : `$${Math.round(v).toLocaleString("en-US")}`);

export function LeakLadder({ sum, prev, sources, onPick, onSource }: {
  sum: SummaryRes; prev: SummaryRes | null; sources: BreakdownRes | null; onPick: (p: LadderPick) => void; onSource: (id: string, name: string, count: number) => void;
}) {
  const rows = useMemo(() => ladderRows(sum.steps, sum.leak?.key ?? null, prev && prev.steps[0].count > 0 ? prev.steps : null), [sum, prev]);
  const biggest = rows.find((r) => r.biggest) ?? null;
  const lostTitle = (r: LadderRow) => `${LOST_TITLE[r.key] ?? `Not at ${r.label.toLowerCase()}`}: ${fmtInt(r.lost)} leads`;
  const avgBooked = sum.steps[0].count > 0 ? sum.steps[2].count / sum.steps[0].count : null;
  const srcRows = (sources?.rows ?? []).filter((x) => x.steps[0].count > 0).sort((a, b) => b.steps[0].count - a.steps[0].count).slice(0, 6);
  return (
    <div className="bf-lad" data-testid="bf-leak-ladder">
      <p className="bf-fine" data-testid="bf-what">This follows each lead through your CRM: came in, first reply, booked, showed up, deal, won. It is not your website traffic.</p>
      {biggest && (
        <div className="bf-lad-big" data-testid="bf-biggest" data-tone={biggest.lostTone}>
          <p className="bf-lad-big-t"><span aria-hidden>{TONE_GLYPH[biggest.lostTone]}</span> Biggest leak: before {biggest.label.toLowerCase()}</p>
          <p className="bf-lad-big-n">{fmtInt(biggest.lost)} leads lost ({biggest.dropPct}%){sum.leak?.dollars !== null && sum.leak?.dollars !== undefined ? <>, about <b>{money(sum.leak.dollars)}</b> of won deals <span className="bf-est">estimate</span></> : null}</p>
          <p className="bf-fine">{biggest.todo}</p>
          <button type="button" className="bf-lad-open" onClick={() => onPick({ step: biggest.key as StepKey, mode: "dropped", title: lostTitle(biggest), count: biggest.lost })} data-testid="bf-biggest-open">Open those {fmtInt(biggest.lost)} leads</button>
        </div>
      )}
      <ol className="bf-lad-rows" aria-label="Leads left at each step">
        {rows.map((r) => (
          <li key={r.key} className="bf-lad-row" data-tone={r.tone} data-key={r.key} data-testid="bf-lad-row">
            <div className="bf-lad-main">
              <span className="bf-lad-label">{r.label}</span>
              <button type="button" className="bf-lad-count" disabled={r.count === 0} onClick={() => onPick({ step: r.key as StepKey, mode: "reached", title: `${r.label}: ${fmtInt(r.count)} leads`, count: r.count })} aria-label={`Open the ${r.count} leads that reached ${r.label}`} data-testid="bf-lad-count">{fmtInt(r.count)}</button>
              <span className="bf-lad-pass">{r.first ? <span className="bf-fine">all leads</span> : <RateTag v={r.pass} scale={STEP_SCALE[r.key] ?? SCALES.show} strong />}</span>
              {r.deltaPoints !== null && <span className="bf-lad-delta" title="Against the period before"><DeltaTag delta={r.deltaPoints / 100} /></span>}
            </div>
            <span className="bf-lad-bar" aria-hidden><i style={{ width: `${r.widthPct}%`, background: toneVar(r.first ? "neutral" : r.tone) }} /></span>
            {!r.first && (
              <div className="bf-lad-foot">
                <button type="button" className="bf-lad-lost" data-tone={r.lostTone} disabled={r.lost === 0} onClick={() => onPick({ step: r.key as StepKey, mode: "dropped", title: lostTitle(r), count: r.lost })} aria-label={`Open the ${r.lost} leads lost before ${r.label}`} data-testid="bf-lad-lost">
                  <span aria-hidden>{TONE_GLYPH[r.lostTone]}</span> {fmtInt(r.lost)} lost here{r.dropPct !== null ? ` (${r.dropPct}%)` : ""}
                </button>
                <span className={`bf-lad-todo ${r.lost === 0 ? "" : TONE_TEXT[r.lostTone]}`}>{r.enough ? r.todo : `${r.todo} Too few leads before this step to judge it.`}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
      <StatusLegend scale={SCALES.show} note="Each step has its own range: first reply 90% and up is good, booked 35%, showed up 80%, deal opened 60%, won 40%. A step with fewer than 10 leads before it is grey." />
      {srcRows.length > 0 && (
        <div className="bf-lad-src" data-testid="bf-lad-sources">
          <h4 className="bf-h">Leads by source</h4>
          <table className="bf-lad-table">
            <thead><tr><th scope="col">Source</th><th scope="col" data-num>Leads</th><th scope="col" data-num>Booked</th><th scope="col" data-num>Won</th></tr></thead>
            <tbody>
              {srcRows.map((x) => {
                const leads = x.steps[0].count, booked = x.steps[2].count / leads;
                const t: Tone = leads >= 20 ? relativeTone(booked, avgBooked) : "neutral";
                return (
                  <tr key={x.id || "none"}>
                    <th scope="row">{x.name}</th>
                    <td data-num><button type="button" className="bf-link" onClick={() => onSource(x.id, x.name, leads)} aria-label={`Open the ${leads} leads from ${x.name}`}>{fmtInt(leads)}</button></td>
                    <td data-num><span className={TONE_TEXT[t]} data-tone={t}>{t !== "neutral" ? <span aria-hidden className="text-[0.65em]">{TONE_GLYPH[t]} </span> : null}{Math.round(booked * 100)}%</span></td>
                    <td data-num>{leads >= 30 ? `${Math.round((x.steps[5].count / leads) * 1000) / 10}%` : "n/a"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="bf-fine">Booked is the share of that source&apos;s leads that booked. Green: 5 or more points better than all sources, red: 5 or more worse, grey: close to average or under 20 leads. Won shows from 30 leads.</p>
        </div>
      )}
    </div>
  );
}
