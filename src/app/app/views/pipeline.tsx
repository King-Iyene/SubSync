"use client";

import { useState, type ReactNode } from "react";
import { useApiClient, useData } from "../session";
import { DataList, LeadDrawer, LineChart, ModuleTabs, type Column, type LeadSeed } from "../ds";
import {
  Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, inputClass, Loading, PageHeader, Stat, Table, Td, Th,
} from "../ui";
import { DealHygiene, PipelineRollup, StaleDeals } from "./deals";
import { ForecastCard, type ForecastData } from "./forecast-card";
import { QuietDeals } from "./quiet-deals";
import { StageRulesCard, type StageControls } from "./stage-rules-card";

// The Pipeline module (stage P1, N36): five tabs, at most four blocks on each, one line under each block title. Every number is the one the page always
// showed (counted deals, stage rules, forecast method); only where it sits has changed.

type DealRow = {
  opportunityId: string; locationId: string; locationName: string | null; pipelineName: string; stageName: string; name: string | null;
  contactId?: string | null; contactName: string | null; value: number; url: string;
};
type Bucket = { label: string; count: number; value: number };
type Data = {
  excluded: { count: number; closedOut?: number; noValue: number; noOwner: number };
  stageControls?: StageControls | null;
  trendNote?: string | null;
  outlier: { value: number; share: number; of: number } | null;
  minClosedDeals: number;
  totals: { open: number; openValue: number; won: number; lost: number; winRate: number | null; avgCycleDays: number | null };
  forecast: ForecastData;
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
const moneyShort = (n: number) => (n >= 1_000_000 ? `$${Math.round(n / 100_000) / 10}m` : n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`);

/** A block: a title, one line under it, then the content. */
function Block({ title, line, action, className, children }: { title: string; line: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card title={title} action={action} className={className}>
      <p className="-mt-3 mb-3 text-sm text-muted-foreground">{line}</p>
      {children}
    </Card>
  );
}

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

type ListRow = DealRow & { reasons?: string[]; score?: number };

/** Deals as one list. A row opens the lead panel when the deal has a contact, otherwise the deal in your CRM. */
function DealList({ rows, extra, caption }: { rows: ListRow[]; extra?: "risk" | "reasons"; caption: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const withContact = rows.filter((d) => d.contactId);
  const seeds: LeadSeed[] = withContact.map((d) => ({ contactId: d.contactId as string, locationId: d.locationId, name: d.contactName ?? d.name ?? "Contact", locationName: d.locationName, url: d.url, note: `${d.name ?? "Untitled deal"}, ${fmtMoney(d.value)}, ${d.pipelineName}: ${d.stageName}.` }));
  const columns: Array<Column<ListRow>> = [
    { key: "deal", header: "Deal", primary: true, width: "minmax(0,1.8fr)", cell: (d) => d.name ?? d.contactName ?? "Untitled deal" },
    { key: "acct", header: "Client account", width: "minmax(0,1.3fr)", cell: (d) => <span className="text-muted-foreground">{d.locationName ?? "Unnamed account"}</span> },
    { key: "stage", header: "Stage", width: "minmax(0,1.4fr)", cell: (d) => <span className="text-muted-foreground">{d.pipelineName}: {d.stageName}</span> },
    { key: "value", header: "Value", width: "7rem", align: "right", cell: (d) => <span className="tabular-nums">{fmtMoney(d.value)}</span> },
    ...(extra === "risk" ? [{ key: "risk", header: "Risk", width: "minmax(0,1.8fr)", cell: (d: ListRow) => (
      <span><Badge tone={riskTone(d.score ?? 0)}>{d.score}</Badge><span className="mt-1 block text-xs text-muted-foreground">{(d.reasons ?? []).slice(0, 3).join(", ")}</span></span>
    ) }] : []),
    ...(extra === "reasons" ? [{ key: "why", header: "Why", width: "minmax(0,1.6fr)", cell: (d: ListRow) => <span className="text-xs text-muted-foreground">{(d.reasons ?? []).join(", ")}</span> }] : []),
    { key: "open", header: "", width: "5rem", align: "right" as const, cell: (d: ListRow) => <ExtLink href={d.url}>Open</ExtLink> },
  ];
  return (
    <>
      <DataList rows={rows} columns={columns} rowKey={(d) => d.opportunityId} caption={caption}
        onOpen={(d) => { const at = withContact.findIndex((x) => x.opportunityId === d.opportunityId); if (at >= 0) setOpen(at); else window.open(d.url, "_blank", "noopener,noreferrer"); }} />
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </>
  );
}

export function PipelineView({ initialTab = 0 }: { initialTab?: number }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Data>("pipeline-intel");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pipe, setPipe] = useState<string>("");

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.totals.open + data.totals.won + data.totals.lost === 0) {
    return <div><PageHeader title="Pipeline" subtitle="Deals appear here after the first sync." /><Empty title="No deals yet" body="Deals appear here once the first sync finishes." /></div>;
  }

  const names = [...new Set(data.stages.map((s) => s.pipelineName))];
  const chosen = pipe && names.includes(pipe) ? pipe : names[0] ?? "";
  const stages = data.stages.filter((s) => s.pipelineName === chosen).sort((a, b) => a.stageOrder - b.stageOrder);
  const f = data.forecast;
  const range = f.range;

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

  const overview = (
    <div className="space-y-6">
      <Block title="Numbers" line="Counted deals across your client accounts.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open pipeline" value={fmtMoney(data.totals.openValue)} sub={<>{fmtInt(data.totals.open)} open deals{data.outlier && <span className="mt-1 block text-warning">One deal ({fmtMoney(data.outlier.value)}) is {Math.round(data.outlier.share * 100)}% of this.</span>}</>} />
          <Stat label="Win rate" value={pct(data.totals.winRate)} sub={data.totals.winRate === null ? `${data.totals.won + data.totals.lost} closed so far. A win rate needs ${data.minClosedDeals}.` : `${data.totals.won} won, ${data.totals.lost} lost`} />
          <Stat label="Time to win" value={data.totals.avgCycleDays === null ? "n/a" : `${data.totals.avgCycleDays} ${data.totals.avgCycleDays === 1 ? "day" : "days"}`} sub="created to won" />
          <Stat label="Likely revenue (estimate)" value={range === null ? "Not enough data" : fmtMoney(range.likely)} sub={<>{range ? <span className="block">Range {fmtMoney(range.low)} to {fmtMoney(range.high)}</span> : <span className="block">{f.method === "none" ? `Needs ${data.minClosedDeals} closed deals or stage chances you set.` : ""}</span>}<span className="block">An estimate. The method is on the Forecast tab.</span></>} />
        </div>
        {data.excluded.count > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {fmtInt(data.excluded.count)} open {data.excluded.count === 1 ? "deal is" : "deals are"} left out: {fmtInt(data.excluded.closedOut ?? 0)} in a closed out stage or an unused pipeline, {fmtInt(data.excluded.noValue)} with no value, {fmtInt(data.excluded.noOwner)} with no owner. Amounts are as entered in each account. Currencies are not converted.
          </p>
        )}
      </Block>

      <Block title="Pipeline over time" line="Open pipeline value, one point a day.">
        <LineChart title="Open pipeline" series={[{ label: "Open pipeline", tone: 1, points: data.trend.map((t) => ({ day: t.day, value: t.openValue })) }]} format={moneyShort} axisLabel="deals with a value and an owner" />
        {data.trendNote && <p className="mt-2 text-xs text-muted-foreground" data-testid="trend-note">{data.trendNote}</p>}
      </Block>

      <Block title="Deals at risk" line="Score 0 to 100 from quiet days, time in stage, deal age and missing value.">
        {data.risky.length === 0 ? <Empty title="No open deals" /> : <DealList rows={data.risky} extra="risk" caption="Deals most at risk" />}
      </Block>

      <Block title="Pipeline age" line="How long open deals have been open.">
        <Bars items={data.aging.buckets} />
        {data.aging.valueOlderThan60Pct !== null && <p className="mt-3 text-sm">{data.aging.valueOlderThan60Pct}% of open value is in deals older than 60 days.</p>}
      </Block>
    </div>
  );

  const stagesTab = (
    <div className="space-y-6">
      <Block title="Stages" line="Where deals wait and how many move on." action={names.length > 1 ? (
        <select className="rounded-lg border bg-background px-2 py-1 text-sm" value={chosen} onChange={(e) => setPipe(e.target.value)} aria-label="Pipeline">
          {names.map((n) => <option key={n}>{n}</option>)}
        </select>
      ) : undefined}>
        <Table head={<tr><Th>Stage</Th><Th className="text-right">Open</Th><Th className="text-right">Value</Th><Th className="text-right">Days here</Th><Th className="text-right">Over 2x average</Th><Th className="text-right">To next stage</Th></tr>}>
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
        <p className="mt-2 text-xs text-muted-foreground">Moving on is estimated from where deals sit now, because stage history is not kept. A bottleneck is a stage where deals wait much longer than in the others.</p>
      </Block>

      {data.stageControls?.canEdit && <StageRulesCard controls={data.stageControls} onChanged={reload} />}

      <Block title="Wins and losses" line="Closed deals by month.">
        <Table head={<tr><Th>Month</Th><Th className="text-right">Won</Th><Th className="text-right">Lost</Th><Th className="text-right">Win rate</Th><Th className="text-right">Won value</Th><Th className="text-right">Lost value</Th></tr>}>
          {data.winLoss.map((m) => (
            <tr key={m.month}>
              <Td>{m.month}</Td><Td className="text-right tabular-nums">{m.won}</Td><Td className="text-right tabular-nums">{m.lost}</Td>
              <Td className="text-right tabular-nums">{pct(m.winRate)}</Td><Td className="text-right tabular-nums">{fmtMoney(m.wonValue)}</Td><Td className="text-right tabular-nums">{fmtMoney(m.lostValue)}</Td>
            </tr>
          ))}
        </Table>
      </Block>
    </div>
  );

  const staleTab = (
    <div className="space-y-6">
      <Block title="Stale deals" line="Open deals with no movement. Pick a row to see the contact.">
        <StaleDeals />
      </Block>
      <Block title="Quiet contacts" line="Open deals where nobody has been in touch lately.">
        <QuietDeals />
      </Block>
      <Block title={`Worth reopening (${fmtMoney(data.abandoned.value)})`} line="Valuable deals lost in the last 90 days.">
        {data.abandoned.deals.length === 0 ? <p className="text-sm text-muted-foreground">No valuable deals were lost in the last 90 days.</p> : <DealList rows={data.abandoned.deals} caption="Abandoned deals worth reopening" />}
      </Block>
      <Block title={`Dead deals (${fmtInt(data.dead.total)})`} line="Deals that look finished and can be cleaned up.">
        {data.dead.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing looks dead.</p> : <DealList rows={data.dead.rows} extra="reasons" caption="Dead pipeline to clean up" />}
      </Block>
    </div>
  );

  const forecastTab = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ForecastCard f={f} />
        <Block title="Coverage" line="Open pipeline against your monthly target.">
          {data.coverage ? (
            <div className="space-y-1 text-sm">
              <p className="text-lg font-semibold">{data.coverage.ratio}x of your monthly target</p>
              <p className="text-muted-foreground">Target {fmtMoney(data.coverage.target)} a month. A healthy pipeline is 3x ({fmtMoney(data.coverage.needed)}).</p>
              {data.coverage.healthy ? <Badge tone="good">Healthy</Badge> : <p>Gap: <strong>{fmtMoney(data.coverage.gap)}</strong></p>}
            </div>
          ) : <p className="text-sm text-muted-foreground">Set a monthly revenue target to see if you have enough pipeline.</p>}
          <div className="mt-3 flex gap-2">
            <input className={inputClass} inputMode="numeric" placeholder="Monthly target, for example 50000" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Monthly revenue target" />
            <Btn onClick={saveTarget} disabled={!target}>Save</Btn>
          </div>
          {note && <p className="mt-2 text-xs text-muted-foreground" role="status">{note}</p>}
        </Block>
      </div>
    </div>
  );

  const compareTab = (
    <div className="space-y-6">
      {data.accounts.length > 1 && (
        <Block title="Client accounts" line="Each account side by side.">
          <Table head={<tr><Th>Account</Th><Th className="text-right">Open deals</Th><Th className="text-right">Open value</Th><Th className="text-right">Win rate</Th><Th className="text-right">Days to win</Th><Th className="text-right">Stale share</Th><Th className="text-right">Average risk</Th></tr>}>
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
        </Block>
      )}
      {data.pipelines.length > 0 && (
        <Block title="Every pipeline" line="One row for each pipeline in each account.">
          <Table head={<tr><Th>Account</Th><Th>Pipeline</Th><Th className="text-right">Open</Th><Th className="text-right">Value</Th><Th className="text-right">Win rate</Th><Th className="text-right">Days to win</Th></tr>}>
            {data.pipelines.map((p) => (
              <tr key={`${p.locationId}-${p.pipelineName}`} className="hover:bg-muted/40">
                <Td>{p.locationName ?? "Unnamed account"}</Td><Td className="font-medium">{p.pipelineName}</Td>
                <Td className="text-right tabular-nums">{fmtInt(p.openCount)}</Td><Td className="text-right tabular-nums">{fmtMoney(p.openValue)}</Td>
                <Td className="text-right tabular-nums">{pct(p.winRate)}</Td><Td className="text-right tabular-nums">{p.avgCycleDays ?? "n/a"}</Td>
              </tr>
            ))}
          </Table>
        </Block>
      )}
      <Block title="Roll up" line="Open deals by stage, and each account's wins.">
        <PipelineRollup />
      </Block>
      <Block title="Deal hygiene" line="Deals with no value, no contact, or a long wait.">
        <DealHygiene />
      </Block>
    </div>
  );

  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Deals across your client accounts, counted the same way everywhere." actions={<Btn onClick={() => api.download("export/deals", "subsync-open-deals.csv")}>Export open deals</Btn>} />
      <ModuleTabs label="Pipeline sections" start={initialTab} tabs={[
        { label: "Overview", node: overview },
        { label: "Stages and bottlenecks", node: stagesTab },
        { label: "Stale deals", node: staleTab },
        { label: "Forecast", node: forecastTab },
        { label: "Compare", node: compareTab },
      ]} />
    </div>
  );
}
