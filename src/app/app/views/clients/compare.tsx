"use client";

import { useState } from "react";
import { topSeriesWithOther } from "@/lib/design/column-layout";
import { averageSeries, formatMetric, MAX_COMPARE, pointsIn, type CompareCell, type CompareRow } from "@/lib/analytics/client-success";
import { useData } from "../../session";
import { CardRange, EmptyState, LineChart, Section, SkeletonRows, useCardRange } from "../../ds";
import { Badge, Btn, ErrorBox, Table, Td, Th } from "../../ui";
import { SetupCompareView } from "../setup-compare";
import type { DayPoint } from "./types";

// Two or more clients side by side (N60): each figure against the average of the clients picked, the clients that are far apart highlighted, and the
// trend of each on one chart with the average as a dashed line. A figure SubSync does not have stays empty: nothing is guessed.
type Compared = { clients: Array<{ locationId: string; name: string; values: Record<string, number | null> }>; rows: CompareRow[]; notes: string[] };
type Trends = { clients: Array<{ locationId: string; name: string; days: DayPoint[] }> };
const METRICS = [
  { key: "healthScore", label: "Health score", ceiling: 100, format: (n: number) => String(Math.round(n)) },
  { key: "openValue", label: "Open pipeline", ceiling: undefined, format: (n: number) => (n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`) },
  { key: "newContacts30d", label: "New contacts (30 days before each day)", ceiling: undefined, format: (n: number) => String(Math.round(n)) },
] as const;

export function CompareTab({ accounts, showSetups = true }: { accounts: Array<{ locationId: string; name: string; score?: number }>; showSetups?: boolean }) {
  const [ids, setIds] = useState<string[]>([]);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("healthScore");
  const range = useCardRange("client-compare", { preset: "90d", compare: "none" });
  const ready = ids.length >= 2;
  const key = ids.join(",");
  const cmp = useData<Compared>(ready ? `clients/compare?ids=${key}` : null);
  const trends = useData<Trends>(ready ? `client-trends?ids=${key}` : null);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id]));
  const weakest = [...accounts].sort((a, b) => (a.score ?? 100) - (b.score ?? 100)).slice(0, 3).map((a) => a.locationId);
  const def = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const win = range.resolved;

  const series = (trends.data?.clients ?? []).map((c, i) => ({ label: c.name, points: (win ? pointsIn(c.days, win.current.from, win.current.to) : c.days).map((d) => ({ day: d.day, value: d[metric] })), tone: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5 }));
  // With many clients, one line each is unreadable: the five biggest (by the total of the measure) plus one summed "Other" line. The average still uses every client.
  const top = topSeriesWithOther(series, 5);
  const other = top.other ? [{ label: top.other.label, tone: "muted" as const, dashed: false, points: top.other.points.map((p) => ({ day: p.day, value: p.value === null || def.ceiling === undefined ? p.value : p.value / (top.other?.count ?? 1) })) }] : [];
  const avg = series.length >= 2 ? [{ label: "Average of these clients", tone: "muted" as const, dashed: true, points: averageSeries(series.map((s) => s.points)).map((p) => ({ day: p.day, value: p.value })) }] : [];
  const nameOf = (id: string) => cmp.data?.clients.find((c) => c.locationId === id)?.name ?? "";
  const cell = (r: CompareRow, c: CompareCell) => (
    <Td key={c.locationId} className="text-right tabular-nums">
      {c.value === null ? <span className="text-muted-foreground">not enough data</span> : <span className={c.flag === "best" ? "font-semibold text-success" : c.flag === "worst" ? "font-semibold text-destructive" : ""}>{formatMetric(r.metric, c.value)}</span>}
      {c.flag && <span className="block text-xs"><Badge tone={c.flag === "best" ? "good" : "bad"}>{c.flag === "best" ? "best" : "furthest behind"}</Badge></span>}
      {c.vsAverage && <span className="block text-xs font-normal text-muted-foreground">{c.vsAverage}</span>}
    </Td>
  );

  return (
    <div>
      <Section title="Pick the clients to compare" hint={`Two to ${MAX_COMPARE}. Each is set against the average of the ones you pick.`}
        action={accounts.length >= 3 ? <Btn onClick={() => setIds(weakest)}>Compare the 3 lowest health scores</Btn> : undefined}>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="Clients to compare">
          {accounts.map((a) => {
            const on = ids.includes(a.locationId);
            return (
              <li key={a.locationId}><label className={`flex min-h-9 items-center gap-2 text-sm ${!on && ids.length >= MAX_COMPARE ? "opacity-50" : ""}`}>
                <input type="checkbox" className="size-4" checked={on} disabled={!on && ids.length >= MAX_COMPARE} onChange={() => toggle(a.locationId)} />{a.name}
              </label></li>
            );
          })}
        </ul>
        {ids.length >= MAX_COMPARE && <p className="mt-2 text-xs text-muted-foreground">That is the most that fit on one screen. Remove one to add another.</p>}
      </Section>

      {!ready && <EmptyState title="Pick two or more clients" body="You get their numbers side by side, each against the average, with the biggest differences highlighted and a trend chart for all of them." />}
      {ready && cmp.error && <ErrorBox error={cmp.error} onRetry={cmp.reload} />}
      {ready && cmp.loading && !cmp.data && <SkeletonRows rows={4} label="Comparing..." />}
      {ready && cmp.data && (
        <>
          <Section title="What is different" hint="Only measures where the clients are at least a fifth apart are called out.">
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="compare-notes">{cmp.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Section>
          <Section title="Side by side" hint="The best and the furthest behind are marked when the gap is real. Under each figure: how far it is from the average.">
            <Table head={<tr><Th>{""}</Th>{cmp.data.clients.map((c) => <Th key={c.locationId} className="text-right">{c.name}</Th>)}<Th className="text-right">Average</Th></tr>}>
              {cmp.data.rows.map((r) => (
                <tr key={r.metric.key}>
                  <Td className="font-medium">{r.metric.label}<span className="block text-xs font-normal text-muted-foreground">{r.metric.better === "higher" ? "higher is better" : "lower is better"}</span></Td>
                  {r.cells.map((c) => cell(r, c))}
                  <Td className="text-right tabular-nums text-muted-foreground">{r.average === null ? "n/a" : formatMetric(r.metric, r.average)}</Td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">Win rate and days to win appear only for clients with enough closed deals. {cmp.data.clients.filter((c) => c.values.winRate === null).map((c) => nameOf(c.locationId)).join(", ")}{cmp.data.clients.some((c) => c.values.winRate === null) ? " have too few." : ""}</p>
          </Section>
          <Section title="Trend over time" hint="One line per client; the dashed grey line is their average.">
            <div className="mb-3 flex flex-wrap items-end gap-4">
              <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor="cmp-metric">Measure</label>
                <select id="cmp-metric" className="min-h-9 rounded-lg border bg-card px-2 py-1 text-sm" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
              <CardRange state={range} label="Compare trend" compares={["none"]} maxDays={200} />
            </div>
            {trends.error ? <ErrorBox error={trends.error} onRetry={trends.reload} /> : trends.loading && !trends.data ? <SkeletonRows rows={3} /> : (
              <LineChart title={`${def.label}, by day`} series={[...top.shown, ...other, ...avg]} format={def.format} ceiling={def.ceiling} axisLabel={def.key === "healthScore" ? "0 to 100" : undefined} />
            )}
            <p className="mt-2 text-xs text-muted-foreground">Hover or use the arrow keys to read each day. A day&apos;s figure is not a list of leads, so the lines open nothing.</p>
          </Section>
        </>
      )}

      {showSetups && <div className="mt-10 border-t pt-6">
        <SetupCompareView embedded />
      </div>}
    </div>
  );
}
