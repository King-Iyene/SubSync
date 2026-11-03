"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import type { Deal } from "../types";
import { DataList, LeadDrawer, type Column, type LeadSeed } from "../ds";
import { Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, fmtPct, Loading, PageHeader, Stat, Table, Td, Th } from "../ui";
import { QuietDeals } from "./quiet-deals";

type Pipelines = {
  stages: Array<{ pipeline: string; stage: string; order: number; count: number; value: number }>;
  accounts: Array<{ locationId: string; name: string | null; url: string; open: { count: number; value: number }; won: { count: number; value: number }; lost: { count: number; value: number }; winRate: number | null }>;
  totals: { open: number; won: number; expected: number };
};

export function DealsView() {
  const [tab, setTab] = useState<"stale" | "quiet" | "pipeline" | "hygiene">("stale");
  return (
    <div>
      <PageHeader title="Deals" subtitle="Where money is stuck and where it is flowing, across every client account." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {([["stale", "Stale deals"], ["quiet", "No recent contact"], ["pipeline", "Pipeline roll-up"], ["hygiene", "Deal hygiene"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
      {tab === "stale" ? <StaleDeals /> : tab === "quiet" ? <QuietDeals /> : tab === "pipeline" ? <PipelineRollup /> : <DealHygiene />}
    </div>
  );
}

type HygieneData = {
  accounts: Array<{ locationId: string; locationName: string | null; open: number; noValue: number; noContact: number; ancient: number }>;
  totals: { open: number; noValue: number; noContact: number; ancient: number };
};

export function DealHygiene() {
  const { data, error, loading, reload } = useData<HygieneData>("hygiene");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const cell = (n: number) => (n > 0 ? <span className="text-warning">{fmtInt(n)}</span> : "0");
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

const staleColumns: Array<Column<Deal>> = [
  { key: "deal", header: "Deal", primary: true, width: "minmax(0,2fr)", cell: (d) => <span>{d.name ?? "Untitled deal"}{d.contactName ? <span className="block truncate text-xs font-normal text-muted-foreground">{d.contactName}</span> : null}</span> },
  { key: "account", header: "Client account", width: "minmax(0,1.4fr)", cell: (d) => <span className="text-muted-foreground">{d.locationName ?? "Unnamed account"}</span> },
  { key: "stage", header: "Stage", width: "minmax(0,1.5fr)", cell: (d) => <span className="text-muted-foreground">{d.pipelineName ? `${d.pipelineName}: ` : ""}{d.stageName ?? "No stage"}</span> },
  { key: "value", header: "Value", width: "7rem", align: "right", cell: (d) => <span className="tabular-nums">{fmtMoney(d.value)}</span> },
  { key: "stale", header: "Days stale", width: "6rem", align: "right", cell: (d) => <span className="tabular-nums">{d.daysStale}</span> },
  { key: "open", header: "", width: "7rem", align: "right", cell: (d) => <ExtLink href={d.url}>Open</ExtLink> },
];

/** Deals with no movement for a number of days. A row opens the lead panel when the deal has a contact, otherwise the deal in your CRM. */
export function StaleDeals() {
  const api = useApiClient();
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading, reload } = useData<{ days: number; totalValue: number; deals: Deal[] }>(`stale?days=${days}`);
  const withContact = (data?.deals ?? []).filter((d) => d.contactId);
  const seeds: LeadSeed[] = withContact.map((d) => ({ contactId: d.contactId as string, locationId: d.locationId, name: d.contactName ?? d.name ?? "Contact", locationName: d.locationName, url: d.url, note: `${d.name ?? "Untitled deal"}, ${fmtMoney(d.value)}. No movement for ${d.daysStale} days.` }));
  return (
    <div data-testid="stale-deals">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">No movement in at least</span>
        {[14, 30, 45, 60, 90].map((d) => (
          <button key={d} type="button" onClick={() => { setDays(d); setOpen(null); }} aria-pressed={days === d} className={`rounded-full border px-3 py-1 text-sm ${days === d ? "bg-foreground text-background" : "hover:bg-muted"}`}>{d} days</button>
        ))}
        <span className="ml-auto"><Btn onClick={() => api.download("export/stale", "subsync-stale-deals.csv")}>Export CSV</Btn></span>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data ? null : data.deals.length === 0 ? (
        <Empty title="No stale deals" body={`Every open deal has moved in the last ${days} days.`} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md"><Stat label="Deals" value={fmtInt(data.deals.length)} /><Stat label="Total value" value={fmtMoney(data.totalValue)} tone="warn" /></div>
          <DataList rows={data.deals.slice(0, 200)} columns={staleColumns} rowKey={(d) => d.opportunityId} caption="Stale deals" total={data.deals.length}
            onOpen={(d) => { const at = withContact.findIndex((x) => x.opportunityId === d.opportunityId); if (at >= 0) setOpen(at); else window.open(d.url, "_blank", "noopener,noreferrer"); }} />
          {data.deals.length > 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the 200 largest. Export the CSV for the full list.</p>}
          <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
        </>
      )}
    </div>
  );
}

export function PipelineRollup() {
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
