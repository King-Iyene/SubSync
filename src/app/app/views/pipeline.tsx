"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { anomalyIndices } from "../../../lib/analytics/client-intel";
import {
  Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, inputClass, Loading, PageHeader, Sparkline, Stat, Table, Td, Th,
} from "../ui";

type DealRow = {
  opportunityId: string; locationId: string; locationName: string | null; pipelineName: string; stageName: string; name: string | null;
  contactName: string | null; value: number; url: string;
};
type Bucket = { label: string; count: number; value: number };
type Data = {
  totals: { open: number; openValue: number; won: number; lost: number; winRate: number | null; avgCycleDays: number | null };
  forecast: { likely: number; best: number; worst: number; winRate: number | null; basis: string; horizons: Array<{ days: number; likely: number }> | null };
  coverage: { target: number; needed: number; openValue: number; gap: number; ratio: number; healthy: boolean } | null;
  stages: Array<{ pipelineName: string; stageName: string; stageOrder: number; open: number; value: number; avgDwellDays: number | null; bottleneck: boolean; overdue: number; conversionToNext: number | null }>;
  aging: { buckets: Bucket[]; valueOlderThan60Pct: number | null };
  distribution: { buckets: Bucket[]; average: number | null; median: number | null; largest: DealRow[] };
  winLoss: Array<{ month: string; won: number; lost: number; winRate: number | null; wonValue: number; lostValue: number }>;
  risky: Array<DealRow & { score: number; reasons: string[] }>;
  abandoned: { total: number; value: number; deals: DealRow[] };
  dead: { total: number; rows: Array<DealRow & { reasons: string[] }> };
  accounts: Array<{ locationId: string; locationName: string | null; openCount: number; openValue: number; winRate: number | null; avgCycleDays: number | null; staleShare: number | null; avgRisk: number | null }>;
  pipelines: Array<{ locationId: string; locationName: string | null; pipelineName: string; openCount: number; openValue: number; winRate: number | null; avgCycleDays: number | null }>;
  trend: Array<{ day: string; openValue: number; openOpps: number }>;
  goals: Partial<Record<string, number>>;
};

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const riskTone = (s: number) => (s >= 70 ? "bad" : s >= 40 ? "warn" : "neutral");

function Bars({ items, money = true }: { items: Bucket[]; money?: boolean }) {
  const max = Math.max(1, ...items.map((b) => (money ? b.value : b.count)));
  return (
    <ul className="space-y-2 text-sm">
      {items.map((b) => (
        <li key={b.label}>
          <div className="flex justify-between"><span>{b.label}</span><span className="tabular-nums text-muted-foreground">{fmtInt(b.count)} deals{money ? `, ${fmtMoney(b.value)}` : ""}</span></div>
          <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.round(((money ? b.value : b.count) / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function DealTable({ rows, extra }: { rows: Array<DealRow & { reasons?: string[]; score?: number }>; extra?: "risk" | "reasons" }) {
  return (
    <Table head={<tr><Th>Deal</Th><Th>Account</Th><Th>Stage</Th><Th className="text-right">Value</Th>{extra && <Th>{extra === "risk" ? "Risk" : "Why"}</Th>}<Th>{""}</Th></tr>}>
      {rows.map((d) => (
        <tr key={d.opportunityId} className="hover:bg-muted/40">
          <Td className="font-medium">{d.name ?? d.contactName ?? "Untitled deal"}</Td>
          <Td>{d.locationName ?? "Unnamed account"}</Td>
          <Td className="text-muted-foreground">{d.pipelineName}: {d.stageName}</Td>
          <Td className="text-right tabular-nums">{fmtMoney(d.value)}</Td>
          {extra === "risk" && (
            <Td>
              <Badge tone={riskTone(d.score ?? 0)}>{d.score}</Badge>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{(d.reasons ?? []).slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
            </Td>
          )}
          {extra === "reasons" && <Td className="text-xs text-muted-foreground">{(d.reasons ?? []).join(", ")}</Td>}
          <Td><ExtLink href={d.url}>Open</ExtLink></Td>
        </tr>
      ))}
    </Table>
  );
}

export function PipelineView() {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("pipeline-intel");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pipe, setPipe] = useState<string>("");

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.totals.open + data.totals.won + data.totals.lost === 0) {
    return <div><PageHeader title="Pipeline" subtitle="Forecast, bottlenecks and deal risk across every client account." /><Empty title="No deals yet" body="Deals appear here once the first sync finishes." /></div>;
  }

  const names = [...new Set(data.stages.map((s) => s.pipelineName))];
  const chosen = pipe && names.includes(pipe) ? pipe : names[0] ?? "";
  const stages = data.stages.filter((s) => s.pipelineName === chosen).sort((a, b) => a.stageOrder - b.stageOrder);
  const f = data.forecast;

  const saveTarget = async () => {
    setNote(null);
    try {
      await api.put("goals", { metric: "monthly_revenue", target: Number(target) });
      setTarget("");
      await reload();
      setNote("Target saved.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Pipeline" subtitle="Forecast, bottlenecks and deal risk across every client account. Everything here is calculated from deals we have synced." actions={<Btn onClick={() => api.download("export/deals", "subsync-open-deals.csv")}>Export open deals</Btn>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open pipeline" value={fmtMoney(data.totals.openValue)} sub={`${fmtInt(data.totals.open)} open deals`} />
        <Stat label="Win rate" value={pct(data.totals.winRate)} sub={`${data.totals.won} won, ${data.totals.lost} lost`} />
        <Stat label="Average time to win" value={data.totals.avgCycleDays === null ? "n/a" : `${data.totals.avgCycleDays} ${data.totals.avgCycleDays === 1 ? "day" : "days"}`} sub="created to won" />
        <Stat label="Likely revenue" value={f.winRate === null ? "n/a" : fmtMoney(f.likely)} sub="open value x win rate" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Revenue forecast" className="lg:col-span-2">
          {f.winRate === null ? <p className="text-sm text-muted-foreground">{f.basis}</p> : (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-muted-foreground">Worst case</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(f.worst)}</dd></div>
                <div><dt className="text-muted-foreground">Likely</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(f.likely)}</dd></div>
                <div><dt className="text-muted-foreground">Best case</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(f.best)}</dd></div>
              </dl>
              {f.horizons && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Expected to close: {f.horizons.map((h) => `${fmtMoney(h.likely)} within ${h.days} days`).join(", ")}.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{f.basis}</p>
            </>
          )}
        </Card>
        <Card title="Pipeline coverage">
          {data.coverage ? (
            <div className="space-y-1 text-sm">
              <p className="text-lg font-semibold">{data.coverage.ratio}x of your monthly target</p>
              <p className="text-muted-foreground">Target {fmtMoney(data.coverage.target)} a month. A healthy pipeline is 3x ({fmtMoney(data.coverage.needed)}).</p>
              {data.coverage.healthy ? <Badge tone="good">Healthy</Badge> : <p>Gap: <strong>{fmtMoney(data.coverage.gap)}</strong></p>}
            </div>
          ) : <p className="text-sm text-muted-foreground">Set a monthly revenue target to see whether you have enough pipeline.</p>}
          <div className="mt-3 flex gap-2">
            <input className={inputClass} inputMode="numeric" placeholder="Monthly revenue target, e.g. 50000" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Monthly revenue target" />
            <Btn onClick={saveTarget} disabled={!target}>Save</Btn>
          </div>
          {note && <p className="mt-2 text-xs text-muted-foreground" role="status">{note}</p>}
        </Card>
      </div>

      <Card title="Open pipeline over time">
        <Sparkline values={data.trend.map((t) => t.openValue)} label="Open pipeline value" marks={anomalyIndices(data.trend.map((t) => t.openValue))} />
        {data.trend.length >= 2 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {fmtMoney(data.trend[0].openValue)} to {fmtMoney(data.trend[data.trend.length - 1].openValue)} over {data.trend.length} days. Red dots mark days that were unusual for this pipeline.
          </p>
        )}
      </Card>

      <Card title="Stages, bottlenecks and conversion" action={names.length > 1 ? (
        <select className="rounded-lg border bg-background px-2 py-1 text-sm" value={chosen} onChange={(e) => setPipe(e.target.value)} aria-label="Pipeline">
          {names.map((n) => <option key={n}>{n}</option>)}
        </select>
      ) : undefined}>
        <Table head={<tr><Th>Stage</Th><Th className="text-right">Open</Th><Th className="text-right">Value</Th><Th className="text-right">Avg days here</Th><Th className="text-right">Over 2x average</Th><Th className="text-right">To next stage</Th></tr>}>
          {stages.map((s) => (
            <tr key={s.stageName} className="hover:bg-muted/40">
              <Td className="font-medium">{s.stageName} {s.bottleneck && <Badge tone="warn">Bottleneck</Badge>}</Td>
              <Td className="text-right tabular-nums">{fmtInt(s.open)}</Td>
              <Td className="text-right tabular-nums">{fmtMoney(s.value)}</Td>
              <Td className="text-right tabular-nums">{s.avgDwellDays ?? "n/a"}</Td>
              <Td className="text-right tabular-nums">{s.overdue || "0"}</Td>
              <Td className="text-right tabular-nums">{pct(s.conversionToNext)}</Td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">Conversion is estimated from where deals are now, because stage history is not kept. A bottleneck is a stage where deals wait much longer than in the others.</p>
      </Card>

      <Card title="Deals most at risk">
        {data.risky.length === 0 ? <Empty title="No open deals" /> : <DealTable rows={data.risky} extra="risk" />}
        <p className="mt-2 text-xs text-muted-foreground">Risk (0 to 100) adds up four things: days without activity, time stuck in the current stage, how old the deal is compared with deals that were won, and a missing value.</p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="How old is the pipeline">
          <Bars items={data.aging.buckets} />
          {data.aging.valueOlderThan60Pct !== null && <p className="mt-3 text-sm">{data.aging.valueOlderThan60Pct}% of open value is in deals older than 60 days.</p>}
        </Card>
        <Card title="Deal sizes">
          <Bars items={data.distribution.buckets} money={false} />
          <p className="mt-3 text-sm text-muted-foreground">Average {data.distribution.average === null ? "n/a" : fmtMoney(data.distribution.average)}, median {data.distribution.median === null ? "n/a" : fmtMoney(data.distribution.median)}.</p>
        </Card>
      </div>

      <Card title="Wins and losses by month">
        <Table head={<tr><Th>Month</Th><Th className="text-right">Won</Th><Th className="text-right">Lost</Th><Th className="text-right">Win rate</Th><Th className="text-right">Won value</Th><Th className="text-right">Lost value</Th></tr>}>
          {data.winLoss.map((m) => (
            <tr key={m.month}>
              <Td>{m.month}</Td><Td className="text-right tabular-nums">{m.won}</Td><Td className="text-right tabular-nums">{m.lost}</Td>
              <Td className="text-right tabular-nums">{pct(m.winRate)}</Td><Td className="text-right tabular-nums">{fmtMoney(m.wonValue)}</Td><Td className="text-right tabular-nums">{fmtMoney(m.lostValue)}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title={`Abandoned deals worth reopening (${fmtMoney(data.abandoned.value)})`}>
        {data.abandoned.deals.length === 0 ? <p className="text-sm text-muted-foreground">No valuable deals were lost in the last 90 days.</p> : <DealTable rows={data.abandoned.deals} />}
      </Card>

      <Card title={`Dead pipeline to clean up (${fmtInt(data.dead.total)})`}>
        {data.dead.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing looks dead.</p> : <DealTable rows={data.dead.rows} extra="reasons" />}
      </Card>

      {data.accounts.length > 1 && (
        <Card title="Compare client accounts">
          <Table head={<tr><Th>Account</Th><Th className="text-right">Open deals</Th><Th className="text-right">Open value</Th><Th className="text-right">Win rate</Th><Th className="text-right">Days to win</Th><Th className="text-right">Stale share</Th><Th className="text-right">Avg risk</Th></tr>}>
            {data.accounts.map((a) => (
              <tr key={a.locationId} className="hover:bg-muted/40">
                <Td className="font-medium">{a.locationName ?? "Unnamed account"}</Td>
                <Td className="text-right tabular-nums">{fmtInt(a.openCount)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(a.openValue)}</Td>
                <Td className="text-right tabular-nums">{pct(a.winRate)}</Td>
                <Td className="text-right tabular-nums">{a.avgCycleDays ?? "n/a"}</Td>
                <Td className="text-right tabular-nums">{pct(a.staleShare)}</Td>
                <Td className="text-right tabular-nums">{a.avgRisk ?? "n/a"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {data.pipelines.length > 0 && (
        <Card title="Every pipeline">
          <Table head={<tr><Th>Account</Th><Th>Pipeline</Th><Th className="text-right">Open</Th><Th className="text-right">Value</Th><Th className="text-right">Win rate</Th><Th className="text-right">Days to win</Th></tr>}>
            {data.pipelines.map((p) => (
              <tr key={`${p.locationId}-${p.pipelineName}`} className="hover:bg-muted/40">
                <Td>{p.locationName ?? "Unnamed account"}</Td><Td className="font-medium">{p.pipelineName}</Td>
                <Td className="text-right tabular-nums">{fmtInt(p.openCount)}</Td><Td className="text-right tabular-nums">{fmtMoney(p.openValue)}</Td>
                <Td className="text-right tabular-nums">{pct(p.winRate)}</Td><Td className="text-right tabular-nums">{p.avgCycleDays ?? "n/a"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
