"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import type { Deal } from "../types";
import { Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, fmtPct, Loading, PageHeader, Stat, Table, Td, Th } from "../ui";

type Pipelines = {
  stages: Array<{ pipeline: string; stage: string; order: number; count: number; value: number }>;
  accounts: Array<{ locationId: string; name: string | null; url: string; open: { count: number; value: number }; won: { count: number; value: number }; lost: { count: number; value: number }; winRate: number | null }>;
  totals: { open: number; won: number; expected: number };
};

export function DealsView() {
  const [tab, setTab] = useState<"stale" | "pipeline" | "hygiene">("stale");
  return (
    <div>
      <PageHeader title="Deals" subtitle="Where money is stuck and where it is flowing, across every client account." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {([["stale", "Stale deals"], ["pipeline", "Pipeline roll-up"], ["hygiene", "Deal hygiene"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
      {tab === "stale" ? <Stale /> : tab === "pipeline" ? <Pipeline /> : <Hygiene />}
    </div>
  );
}

type HygieneData = {
  accounts: Array<{ locationId: string; locationName: string | null; open: number; noValue: number; noContact: number; ancient: number }>;
  totals: { open: number; noValue: number; noContact: number; ancient: number };
};

function Hygiene() {
  const { data, error, loading, reload } = useData<HygieneData>("hygiene");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const cell = (n: number) => (n > 0 ? <span className="text-amber-600 dark:text-amber-400">{fmtInt(n)}</span> : "0");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open deals" value={fmtInt(data.totals.open)} />
        <Stat label="No value set" value={fmtInt(data.totals.noValue)} tone={data.totals.noValue > 0 ? "warn" : undefined} sub="forecasts miss these" />
        <Stat label="No contact attached" value={fmtInt(data.totals.noContact)} tone={data.totals.noContact > 0 ? "warn" : undefined} />
        <Stat label="Open over 90 days" value={fmtInt(data.totals.ancient)} tone={data.totals.ancient > 0 ? "warn" : undefined} />
      </div>
      {data.accounts.length === 0 ? <Empty title="No open deals yet" /> : (
        <Table head={<tr><Th>Account</Th><Th className="text-right">Open</Th><Th className="text-right">No value</Th><Th className="text-right">No contact</Th><Th className="text-right">Over 90 days</Th></tr>}>
          {data.accounts.map((a) => (
            <tr key={a.locationId} className="hover:bg-muted/40">
              <Td className="font-medium">{a.locationName ?? "Unnamed account"}</Td>
              <Td className="text-right tabular-nums">{fmtInt(a.open)}</Td>
              <Td className="text-right tabular-nums">{cell(a.noValue)}</Td>
              <Td className="text-right tabular-nums">{cell(a.noContact)}</Td>
              <Td className="text-right tabular-nums">{cell(a.ancient)}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-xs text-muted-foreground">Deals without a value or a contact make pipeline forecasts and follow-up unreliable. Fix them in the platform.</p>
    </div>
  );
}

function Stale() {
  const api = useApiClient();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useData<{ days: number; totalValue: number; deals: Deal[] }>(`stale?days=${days}`);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">No movement in at least</span>
        {[14, 30, 45, 60, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`rounded-full border px-3 py-1 text-sm ${days === d ? "bg-foreground text-background" : "hover:bg-muted"}`}>{d} days</button>
        ))}
        <span className="ml-auto"><Btn onClick={() => api.download("export/stale", "subsync-stale-deals.csv")}>Export CSV</Btn></span>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data ? null : data.deals.length === 0 ? (
        <Empty title="No stale deals" body={`Every open deal has moved in the last ${days} days.`} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md"><Stat label="Deals" value={fmtInt(data.deals.length)} /><Stat label="Total value" value={fmtMoney(data.totalValue)} tone="warn" /></div>
          <Table head={<tr><Th>Deal</Th><Th>Account</Th><Th>Stage</Th><Th className="text-right">Value</Th><Th className="text-right">Days stale</Th><Th>{" "}</Th></tr>}>
            {data.deals.slice(0, 200).map((d) => (
              <tr key={d.opportunityId} className="hover:bg-muted/40">
                <Td>{d.name ?? "Untitled deal"}<div className="text-xs text-muted-foreground">{d.contactName}</div></Td>
                <Td>{d.locationName ?? "Unnamed account"}</Td>
                <Td>{d.pipelineName ? `${d.pipelineName} · ` : ""}{d.stageName ?? "n/a"}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(d.value)}</Td>
                <Td className="text-right tabular-nums">{d.daysStale}</Td>
                <Td><ExtLink href={d.url}>Open</ExtLink></Td>
              </tr>
            ))}
          </Table>
          {data.deals.length > 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the 200 largest. Export the CSV for the full list.</p>}
        </>
      )}
    </div>
  );
}

function Pipeline() {
  const { data, error, loading, reload } = useData<Pipelines>("pipelines");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const maxStage = Math.max(1, ...data.stages.map((s) => s.value));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 sm:max-w-2xl">
        <Stat label="Open pipeline" value={fmtMoney(data.totals.open)} />
        <Stat label="Expected revenue" value={fmtMoney(data.totals.expected)} sub="weighted by win rate" />
        <Stat label="Won (all time)" value={fmtMoney(data.totals.won)} />
      </div>
      <Card title="Open deals by stage, all accounts">
        {data.stages.length === 0 ? <Empty title="No open deals yet" /> : (
          <ul className="space-y-2">
            {data.stages.map((s) => (
              <li key={`${s.pipeline}|${s.stage}`} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate" title={`${s.pipeline} · ${s.stage}`}>{s.stage}<span className="text-xs text-muted-foreground"> · {s.pipeline}</span></span>
                <span className="h-3 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary/80" style={{ width: `${(s.value / maxStage) * 100}%` }} /></span>
                <span className="tabular-nums text-muted-foreground">{fmtMoney(s.value)} · {fmtInt(s.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Table head={<tr><Th>Account</Th><Th className="text-right">Open</Th><Th className="text-right">Open value</Th><Th className="text-right">Won value</Th><Th className="text-right">Win rate</Th><Th>{" "}</Th></tr>}>
        {data.accounts.map((a) => (
          <tr key={a.locationId} className="hover:bg-muted/40">
            <Td className="font-medium">{a.name ?? "Unnamed account"}</Td>
            <Td className="text-right tabular-nums">{fmtInt(a.open.count)}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(a.open.value)}</Td>
            <Td className="text-right tabular-nums">{fmtMoney(a.won.value)}</Td>
            <Td className="text-right tabular-nums">{fmtPct(a.winRate)}</Td>
            <Td><ExtLink href={a.url}>Open</ExtLink></Td>
          </tr>
        ))}
      </Table>
      <p className="text-xs text-muted-foreground">Win rate needs at least five closed deals. &quot;n/a&quot; means there is not enough history yet.</p>
    </div>
  );
}
