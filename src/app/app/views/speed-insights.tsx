"use client";

import { useMemo, useState, type ReactNode } from "react";
import { dayLabel, fmtStat, fullDate } from "@/lib/analytics/chart-format";
import type { GrowthData } from "@/lib/analytics/growth";
import { specDay, specRange } from "@/lib/analytics/growth-records";
import { DAY_NAMES, digestPreview, hourWords, type GapMap, type TrendNormal } from "@/lib/analytics/speed-v3";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { RecordsPanel, EmptyState, ErrorState, SkeletonRows } from "../ds";
import { ModeToggle, TimeChart, useChartMode } from "../ds/time-chart";
import { WhatIs } from "../ds/what-is";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { LeadRows, useLeadActions, type LeadRow } from "./speed-rows";

// The Speed to lead extras, one small card each (stage SPEED3). Every card has one plain line, one number or chart, and the reason it matters in a small "?" tip. Every mark opens
// exactly the leads it counted (the same selection on the server). Small samples say "not enough data" instead of a percentage.

type Row = LeadRow & { dollars?: number; waitedMinutes?: number };
export type Insights = {
  now: number; days: number; gap: GapMap; trend: TrendNormal; seePeople: boolean;
  fastSlow: { fast: { n: number; booked: number; rate: number | null }; slow: { n: number; booked: number; rate: number | null }; multiple: number | null; enough: boolean; line: string };
  sources: Array<{ source: string; leads: number; answered: number; medianSeconds: number | null; hitRate: number | null; booked: number; showed: number; won: number; ranked: boolean }>;
  setters: { teamMedianSeconds: number | null; rows: Array<{ userId: string; name: string; replies: number; medianSeconds: number | null; withinShare: number | null; booked: number; bookedRate: number | null; ranked: boolean }> };
  owners: { noOwner: number; total: number; fairShare: number | null; owners: Array<{ userId: string; name: string; leads: number; overloaded: boolean }> };
  rescue: Row[]; costBySource: Array<{ source: string; missed: number; dollars: number | null; line: string | null }>;
};
type Pick = { title: string; q: Record<string, string> };

const H = ({ title, tip, children }: { title: string; tip: string; children?: ReactNode }) => (
  <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1"><h3 className="t-title">{title} <WhatIs text={tip} /></h3>{children}</div>
);
const Card = ({ children, id }: { children: ReactNode; id: string }) => <section aria-labelledby={id} className="mb-10 border-t border-[var(--t-rule)] pt-5" data-testid={id}>{children}</section>;
const BTN = "ds-press min-h-11 cursor-pointer rounded-md px-2 text-left font-medium text-[var(--t-accent)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-8";
const pct = (x: number | null) => (x === null ? "not enough data" : `${Math.round(x * 100)}%`);

/** The exact leads behind one mark. */
function Opened({ pick, multi, onBack }: { pick: Pick; multi: boolean; onBack: () => void }) {
  const { data, error, reload } = useData<{ count: number; shown: number; rows: LeadRow[] }>(`speed?part=insight-list&${new URLSearchParams(pick.q)}`);
  const actions = useLeadActions(data?.rows ?? []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={4} label="Opening the leads..." />;
  return (
    <section aria-label={pick.title} data-testid="insight-list">
      <button type="button" onClick={onBack} className={BTN}>Back</button>
      <h3 className="t-title mt-1" data-testid="insight-list-title">{pick.title}</h3>
      <p className="t-small t-quiet mb-3" data-testid="insight-list-count">{data.count.toLocaleString("en-US")} {data.count === 1 ? "lead" : "leads"}{data.count > data.shown ? `, the first ${data.shown} shown` : ""}</p>
      {data.rows.length === 0 ? <EmptyState title="No leads here" body="Nothing matches this mark right now." /> : <LeadRows rows={data.rows} showAccount={multi} actions={actions} testId="insight-rows" />}
      {actions.drawer}
    </section>
  );
}

function useInsights() { return useData<Insights>("speed?part=insights"); }

// ---------------------------------------------------------------- Pace
export function PaceTab({ multi }: { multi: boolean }) {
  const { data: d, error, reload } = useInsights();
  const [pick, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useChartMode("speed-trend");
  const actions = useLeadActions(d?.rescue ?? []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={5} label="Working out your pace..." />;
  if (pick) return <Opened pick={pick} multi={multi} onBack={() => setPick(null)} />;
  const open = (title: string, q: Record<string, string>) => setPick({ title, q });
  const t = d.trend;
  const max = Math.max(1, ...d.gap.cells.map((c) => c.leads));
  const cell = (dow: number, hour: number) => d.gap.cells.find((c) => c.dow === dow && c.hour === hour);
  return (
    <div data-testid="pace-tab">
      {d.rescue.length > 0 && (
        <Card id="rescue">
          <H title="Worth the most if you reply now" tip="Ranked by the open deals of the people waiting, weighted by how long they have been cooling (half the weight lost every day). Without a deal, the longest wait goes first. A lead that waits a day is far less likely to answer." />
          <LeadRows rows={d.rescue} showAccount={multi} actions={actions} testId="rescue-rows" head={false} />
          {actions.drawer}
        </Card>
      )}

      <Card id="proof">
        <H title="Does answering fast book more?" tip="From this account's own leads in the last 28 days. Fast means a person replied within 5 minutes. It is a pattern in your data, not proof: fast leads may also be the better leads. Your CRM's own reports do not put reply time next to bookings." />
        <p className="text-[0.95rem] font-medium" data-testid="proof-line">{d.fastSlow.line}</p>
        <p className="t-small t-quiet mt-1 flex flex-wrap gap-x-4">
          <button type="button" className={BTN} onClick={() => open("Answered within 5 minutes", { sel: "fast" })}>{d.fastSlow.fast.n} answered within 5 minutes</button>
          <button type="button" className={BTN} onClick={() => open("Answered after 5 minutes", { sel: "slow" })}>{d.fastSlow.slow.n} answered later</button>
        </p>
      </Card>

      <Card id="trend">
        <H title="First reply against your normal" tip="The typical first reply of the last 7 days against the middle of the 7 weeks before it. Needs 5 replies in the week and 3 earlier weeks. A reply time that drifts up is felt by clients long before a report shows it."><ModeToggle mode={mode} onChange={setMode} label="First reply by week" /></H>
        <p className="text-[0.95rem] font-medium" data-testid="trend-line">
          {t.verdict && t.pct !== null && t.current?.medianSeconds != null && t.normalSeconds !== null
            ? `${fmtDuration(t.current.medianSeconds)} this week, ${t.verdict === "steady" ? "about your normal" : `${Math.round(Math.abs(t.pct) * 100)}% ${t.verdict} than your normal`} of ${fmtDuration(t.normalSeconds)}.` : t.note}
        </p>
        <div className="mt-3 max-w-2xl">
          <TimeChart testId="trend-chart" mode={mode} label="Typical first reply in minutes, by week" noun="Week"
            points={t.weeks.map((w) => ({ id: String(w.index), label: `Week of ${fullDate(new Date(w.start).toISOString().slice(0, 10))}`, short: w.index === 0 ? "Now" : `${w.index}w`, partial: w.index === 0 }))}
            series={[{ key: "m", name: "Typical first reply (min)", colour: "var(--t-c1)", values: t.weeks.map((w) => (w.medianSeconds === null ? 0 : Math.round(w.medianSeconds / 6) / 10)) }]}
            onPick={(i) => open(`Leads of ${i === t.weeks.length - 1 ? "the last 7 days" : `${t.weeks[i].index} weeks ago`}`, { sel: "week", index: String(t.weeks[i].index) })} />
        </div>
      </Card>

      <Card id="gap">
        <H title="When leads arrive and nobody answers" tip="Each square is an hour of the week in the account's own clock. Darker means more leads arrived. A red edge means half or more were not answered in time. Weekends and before 8am or after 6pm count as after hours." />
        <p className="text-[0.95rem] font-medium" data-testid="gap-line">{d.gap.line ?? "Not enough leads yet to see a pattern (needs 5 after hours)."}</p>
        <div className="mt-3 max-w-2xl overflow-hidden" data-testid="gap-map" role="group" aria-label="Leads by day and hour">
          {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
            <div key={dow} className="flex items-center gap-1 py-px"><span className="t-small t-quiet w-8 shrink-0">{DAY_NAMES[dow]}</span>
              <div className="flex min-w-0 flex-1 gap-px">{Array.from({ length: 24 }, (_, h) => { const c = cell(dow, h); const bad = c && c.leads >= 3 && c.missed / c.leads >= 0.5; return (
                <button key={h} type="button" disabled={!c} onClick={() => c && open(`${DAY_NAMES[dow]} ${hourWords(h)}`, { sel: "cell", dow: String(dow), hour: String(h) })} aria-label={c ? `${DAY_NAMES[dow]} ${hourWords(h)}: ${c.leads} leads, ${c.missed} not answered in time` : `${DAY_NAMES[dow]} ${hourWords(h)}: no leads`}
                  className={`h-6 min-w-0 flex-1 rounded-[2px] disabled:cursor-default ${bad ? "outline outline-1 outline-[var(--t-bad)]" : ""}`} style={{ background: c ? `color-mix(in srgb, var(--t-c1) ${Math.round(18 + (c.leads / max) * 72)}%, transparent)` : "var(--t-sunk)" }} />
              ); })}</div>
            </div>
          ))}
        </div>
        {d.gap.worst.length > 0 && <p className="t-small t-quiet mt-2 flex flex-wrap gap-x-3">Best hours to have someone there: {d.gap.worst.map((w) => <button key={`${w.dow}${w.hour}`} type="button" className={BTN} onClick={() => open(`${DAY_NAMES[w.dow]} ${hourWords(w.hour)}`, { sel: "cell", dow: String(w.dow), hour: String(w.hour) })}>{DAY_NAMES[w.dow]} {hourWords(w.hour)} ({w.missed} missed)</button>)}</p>}
        <p className="t-small mt-1 flex flex-wrap gap-x-4"><button type="button" className={BTN} onClick={() => open("Arrived after hours or at the weekend", { sel: "after" })}>{d.gap.afterLeads} after hours</button><button type="button" className={BTN} onClick={() => open("Arrived in opening hours", { sel: "open" })}>{d.gap.openLeads} in opening hours</button></p>
      </Card>

      <Card id="sources">
        <H title="By lead source" tip="Reply speed, bookings, shows and wins for each source over the last 28 days, with the dollars slow replies cost it (leads answered late or never, times that account's own average deal and win rate; left out where there are fewer than 20 closed deals). Sources with fewer than 5 answered leads show no typical time." />
        {d.sources.length === 0 ? <p className="t-small t-quiet">No leads in the last 28 days.</p> : (
          <div className="overflow-hidden"><table className="w-full text-sm" data-testid="sources-table"><thead><tr className="t-label text-left"><th className="py-1.5 pr-2 font-normal">Source</th><th className="px-1 text-right font-normal">First reply</th><th className="px-1 text-right font-normal">Leads</th><th className="px-1 text-right font-normal">Booked</th><th className="hidden px-1 text-right font-normal sm:table-cell">Showed</th><th className="hidden px-1 text-right font-normal sm:table-cell">Won</th><th className="pl-1 text-right font-normal">Slow cost</th></tr></thead>
            <tbody className="divide-y divide-[var(--t-rule)]">{d.sources.map((s) => { const c = d.costBySource.find((x) => x.source === s.source); return (
              <tr key={s.source}><th scope="row" className="max-w-[9rem] truncate py-1.5 pr-2 text-left font-medium"><button type="button" className={`${BTN} max-w-full truncate`} title={s.source} onClick={() => open(`Source: ${s.source}`, { sel: "source", source: s.source })}>{s.source}</button></th>
                <td className="t-num px-1 text-right">{s.medianSeconds === null ? `${s.answered} of 5` : fmtDuration(s.medianSeconds)}</td><td className="t-num px-1 text-right">{s.leads}</td><td className="t-num px-1 text-right">{s.booked}</td><td className="t-num hidden px-1 text-right sm:table-cell">{s.showed}</td><td className="t-num hidden px-1 text-right sm:table-cell">{s.won}</td><td className="t-num pl-1 text-right">{c?.line ?? "-"}</td></tr>); })}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- People
export function PeopleTab({ multi }: { multi: boolean }) {
  const { data: d, error, reload } = useInsights();
  const [pick, setPick] = useState<Pick | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={5} label="Counting who replies..." />;
  if (pick) return <Opened pick={pick} multi={multi} onBack={() => setPick(null)} />;
  const open = (title: string, q: Record<string, string>) => setPick({ title, q });
  return (
    <div data-testid="people-tab">
      <Card id="owners">
        <H title="Leads nobody owns" tip="A lead with no owner is a lead everyone assumes someone else will answer. Open the list and give each one to the person who replies fastest." />
        <p className="text-[0.95rem] font-medium" data-testid="owner-line">{d.owners.noOwner === 0 ? "Every lead in the last 28 days has an owner." : <><button type="button" className={BTN} onClick={() => open("Leads with no owner", { sel: "noOwner" })}>{d.owners.noOwner} of {d.owners.total} leads have no owner</button></>}</p>
        {d.seePeople && d.owners.owners.length > 1 && (
          <ul className="mt-2 divide-y divide-[var(--t-rule)] border-y border-[var(--t-rule)] text-sm" data-testid="owner-list">
            {d.owners.owners.map((o) => <li key={o.userId} className="flex items-center justify-between gap-3 py-1"><button type="button" className={`${BTN} truncate`} onClick={() => open(`Leads owned by ${o.name}`, { sel: "owner", user: o.userId })}>{o.name}</button><span className="t-num shrink-0">{o.leads}{o.overloaded ? <span className="ml-2 text-[var(--t-warn)]">more than twice a fair share ({d.owners.fairShare})</span> : ""}</span></li>)}
          </ul>
        )}
      </Card>
      {d.seePeople ? (
        <Card id="setters">
          <H title="Who replies" tip="Each person's first replies over 28 days: how many, the typical time, how many were in time, and how many of those leads booked. A person with fewer than 3 replies is listed last without a time. Compared only with others in this company, never with other companies." />
          {d.setters.rows.length === 0 ? <p className="t-small t-quiet">No first replies in the last 28 days.</p> : (
            <>
              {d.setters.teamMedianSeconds !== null && <p className="t-small t-quiet mb-1">Typical for the whole team: {fmtDuration(d.setters.teamMedianSeconds)}.</p>}
              <table className="w-full text-sm" data-testid="setters-table"><thead><tr className="t-label text-left"><th className="py-1.5 font-normal">Person</th><th className="px-1 text-right font-normal">Typical</th><th className="px-1 text-right font-normal">In time</th><th className="px-1 text-right font-normal">Replies</th><th className="pl-1 text-right font-normal">Booked</th></tr></thead>
                <tbody className="divide-y divide-[var(--t-rule)]">{d.setters.rows.map((s) => (
                  <tr key={s.userId}><th scope="row" className="max-w-[10rem] truncate py-1 text-left"><button type="button" className={`${BTN} max-w-full truncate`} onClick={() => open(`Replies by ${s.name}`, { sel: "person", user: s.userId })}>{s.name}</button></th>
                    <td className="t-num px-1 text-right">{s.medianSeconds === null ? `${s.replies} of 3` : fmtDuration(s.medianSeconds)}</td><td className="t-num px-1 text-right">{s.withinShare === null ? "-" : pct(s.withinShare)}</td><td className="t-num px-1 text-right">{s.replies}</td><td className="t-num pl-1 text-right">{s.bookedRate === null ? "-" : pct(s.bookedRate)}</td></tr>))}</tbody></table>
            </>
          )}
        </Card>
      ) : <p className="t-small t-quiet">Your own queue is on the Replies tab.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Lead capture
export function CaptureTab() {
  const { data: g, error, reload } = useData<GrowthData>("today/growth");
  const [mode, setMode] = useChartMode("speed-capture");
  const [panel, setPanel] = useState<ReturnType<typeof specDay> | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!g) return <SkeletonRows rows={5} label="Counting email leads..." />;
  const rangeWord = g.range.label.toLowerCase();
  const periods = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["all", "All time"]] as const;
  const removed = g.gross.removed.duplicate + g.gross.removed.junk + g.gross.removed.staff + g.gross.removed.role;
  return (
    <div data-testid="capture-tab">
      <Card id="capture-counters">
        <H title="People who gave an email" tip="Unique people with a usable email, counted once. Extra copies, test records and your own staff are taken out. Percent compares with the same stretch just before; under 5 earlier it says too few to compare." />
        <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {periods.map(([k, label]) => { const c = g.changes[k]; return (
            <li key={k} data-testid={`capture-${k}`}><span className="t-label block">{label}</span><span className="t-figure t-num mt-1 block" title={c.count.toLocaleString("en-US")}>{fmtStat(c.count)}</span>
              <span className="t-small t-quiet">{k === "all" ? "" : c.pct === null ? "Too few to compare" : `${c.direction === "up" ? "▲ Up" : c.direction === "down" ? "▼ Down" : "No change"} ${Math.abs(c.pct)}%`}</span></li>); })}
        </ul>
      </Card>
      <Card id="capture-chart">
        <H title={`New email leads each day, ${rangeWord}`} tip="One mark a day, one person once. The dashed line is the 7 day average. Select a day to see its people.">
          <span className="flex items-center gap-3"><ModeToggle mode={mode} onChange={setMode} label="New email leads each day" />
            <span className="t-small" data-testid="capture-badge">{g.badge ? `${g.badge.direction === "up" ? "▲ Rising" : g.badge.direction === "down" ? "▼ Falling" : "Steady"}${g.badge.direction === "same" ? "" : ` ${Math.abs(g.badge.pct)}%`} last 7 days` : "Rate: not enough data yet"}</span></span>
        </H>
        {g.signals.length > 0 && <ul className="mb-2 space-y-1 text-sm" data-testid="capture-signals">{g.signals.slice(0, 3).map((s) => <li key={`${s.locationId}${s.scope}`}>{s.text}</li>)}</ul>}
        <div className="max-w-3xl"><TimeChart testId="capture-series" mode={mode} label={`New email leads a day, ${rangeWord}`} noun="Day"
          points={g.series.map((p) => ({ id: p.day, label: fullDate(p.day), short: dayLabel(p.day, g.range.days), partial: p.partial }))} series={[{ key: "n", name: "New email leads", colour: "var(--t-c1)", values: g.series.map((p) => p.count) }]}
          avg={g.series.map((p) => p.avg7)} onPick={(i) => setPanel(specDay(g, g.series[i].day))} /></div>
        <p className="t-small t-quiet mt-2"><button type="button" className={BTN} onClick={() => setPanel(specRange(g))}>See the {g.range.count.toLocaleString("en-US")} people in these dates</button></p>
      </Card>
      <Card id="capture-gross">
        <H title="Sign ups, then people" tip="Sign ups with an email, minus copies of the same person, test or junk records and staff, is the number of real leads. It stops a form bug or a spam burst looking like growth." />
        <p className="text-sm" data-testid="capture-gross"><span className="t-num">{g.gross.signUps.toLocaleString("en-US")}</span> sign ups, <span className="t-num">{removed.toLocaleString("en-US")}</span> taken out, <span className="t-num font-semibold">{g.gross.unique.toLocaleString("en-US")}</span> counted.</p>
      </Card>
      <Card id="capture-mix">
        <H title="Where they come from" tip="Each source's email leads against the period before. Best grew most, worst fell most (at least 5 leads in one of the two periods)." />
        <p className="text-sm font-medium" data-testid="capture-mix-line">{g.mix.line}</p>
        <ul className="mt-2 divide-y divide-[var(--t-rule)] border-y border-[var(--t-rule)] text-sm">{g.mix.rows.slice(0, 6).map((r) => <li key={r.source} className="flex justify-between gap-3 py-1"><span className="truncate">{r.source}</span><span className="t-num shrink-0">{r.count}</span></li>)}</ul>
      </Card>
      {g.scope === "agency" && g.league.length > 1 && (
        <Card id="capture-league">
          <H title="Client accounts by growth" tip="Each client's new email leads this week against last week. The biggest fallers are first, because a form that broke shows here before the client calls." />
          <ul className="divide-y divide-[var(--t-rule)] border-y border-[var(--t-rule)] text-sm" data-testid="capture-league">{[...g.league].sort((a, b) => (a.week.pct ?? 0) - (b.week.pct ?? 0)).slice(0, 8).map((l) => <li key={l.locationId} className="flex justify-between gap-3 py-1.5"><span className="truncate">{l.name}</span><span className="t-num shrink-0">{l.week.count}{l.week.pct === null ? "" : ` (${l.week.pct > 0 ? "+" : ""}${l.week.pct}%)`}</span></li>)}</ul>
        </Card>
      )}
      {panel && <RecordsPanel key={panel.key} spec={panel} onClose={() => setPanel(null)} now={g.now} zone={g.zone} canExport />}
    </div>
  );
}

// ---------------------------------------------------------------- Alerts and digest
export function AlertsTab({ who, waiting, dollars, typical, canChange, targetMinutes, go }: { who: string; waiting: number; dollars: number | null; typical: string | null; canChange: boolean; targetMinutes: number; go: GoFn }) {
  const { data: d, error, reload } = useInsights();
  const [word, setWord] = useState<"daily" | "weekly">("daily");
  const text = useMemo(() => (d ? digestPreview({ who, waiting, dollars, typical, trend: d.trend, gap: d.gap, word }) : ""), [d, who, waiting, dollars, typical, word]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={4} label="Building the preview..." />;
  return (
    <div data-testid="alerts-tab">
      <Card id="alerts-config">
        <H title="When to be told" tip="Reply target, quiet hours and who gets email or Slack are kept in Settings and Alerts. A late lead raises one alert, not one per sync." />
        <p className="text-sm">Reply target: <span className="t-num font-semibold">{targetMinutes} minutes</span>. {canChange ? <button type="button" className={BTN} onClick={() => go("settings")}>Change the target</button> : "Ask the person who manages your account to change it."}</p>
        <p className="text-sm"><button type="button" className={BTN} onClick={() => go("alerts")}>Choose who is told and when</button></p>
      </Card>
      <Card id="digest">
        <H title="The digest, as a preview" tip="What the daily or weekly email would say right now. This is a preview: nothing is sent from this page.">
          <span className="flex gap-2" role="group" aria-label="Digest rhythm">{(["daily", "weekly"] as const).map((w) => <button key={w} type="button" aria-pressed={word === w} onClick={() => setWord(w)} className={`ds-press min-h-11 rounded-md border px-3 text-sm sm:min-h-9 ${word === w ? "border-primary bg-accent" : "bg-card"}`}>{w === "daily" ? "Daily" : "Weekly"}</button>)}</span>
        </H>
        <pre className="whitespace-pre-wrap rounded-md border border-[var(--t-rule)] bg-[var(--t-raise)] p-3 text-sm leading-6" data-testid="digest-preview">{text}</pre>
        <p className="mt-2 flex gap-4"><button type="button" className={BTN} onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button><button type="button" className={BTN} onClick={() => window.print()}>Print for a client</button></p>
      </Card>
    </div>
  );
}
