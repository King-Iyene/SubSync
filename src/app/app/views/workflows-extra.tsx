"use client";

import { usePageRange } from "./../ds/page-range";
import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import type { RecordsSpec, Rec } from "@/lib/analytics/today-records";
import { BAD, STAT_KEYS, STAT_LABEL, pct, type Camp, type StatKey, type Stats } from "@/lib/workflows/delivery";
import { EmptyState, InlineAlert, RecordsPanel, Section, SkeletonCards } from "../ds";
import { WfBars, WfNumber } from "../ds/workflow-charts";
import { useData } from "../session";
import { ErrorBox } from "../ui";
import { when } from "./workflows-parts";

// The Delivery and Proof tabs of the Workflows page. Delivery works from the totals the platform reports per campaign. It never invents a number: a total the
// platform did not send says "Not available", and the people behind a number are not available from the platform yet, so a number opens the campaigns behind it.

type DCamp = Camp & { account: string; deliveredRate: number | null; normal: { own: number; normal: number; diff: number } | null };
type Delivery = {
  available: boolean; now: number; statsPermitted: boolean; permissionName: string; notAvailable: { people: string; hours: string }; sources: string[]; statuses: string[];
  accounts: Array<{ locationId: string; name: string }>; camps: DCamp[]; totals: Stats; withStats: number;
  flags: Array<{ campaignId: string; locationId: string; kind: string; why: string; next: string; estimate: boolean; campaign: string; account: string }>;
  league: Array<{ locationId: string; name: string; campaigns: number; sent: number; delivered: number; bounced: number; failed: number; unsubscribed: number; queued: number; score: number | null }>;
};
const SOURCE: Record<string, string> = { "campaign:email": "Email", "campaign:bulk": "Bulk send", "campaign:workflow": "Workflow email", "campaign:classic": "Classic" };
const COLOURS: Record<StatKey, string> = { sent: "var(--chart-1)", delivered: "var(--success)", opened: "var(--chart-1)", clicked: "var(--chart-1)", bounced: "var(--destructive)", failed: "var(--destructive)", unsubscribed: "var(--warning)", queued: "var(--warning)" };

function spec(key: string, title: string, subtitle: string, camps: DCamp[], stat: StatKey | null): RecordsSpec {
  const rows: Rec[] = camps.map((c) => ({
    id: `${c.locationId}|${c.campaignId}`, url: null, lead: null,
    cells: { name: c.name, account: c.account, status: c.status, source: SOURCE[c.kind ?? ""] ?? "Campaign", value: stat ? c.stats?.[stat] ?? null : c.stats?.sent ?? null, sent: c.stats?.sent ?? null, rate: pct(c.deliveredRate), created: c.createdAt },
  }));
  return {
    key, title, subtitle, noun: "campaigns", count: rows.length, rows, note: "The people behind these numbers are not available from the platform yet, so this lists the campaigns.", dateKey: "created", preset: {}, exportName: key,
    cols: [
      { key: "name", header: "Campaign", type: "text", primary: true, w: 20 }, { key: "account", header: "Client account", type: "text", facet: true, w: 14 }, { key: "source", header: "Kind", type: "kind", facet: true, w: 10 },
      { key: "status", header: "State", type: "kind", facet: true, w: 9 }, { key: "value", header: stat ? STAT_LABEL[stat] : "Sent", type: "number", w: 9 }, { key: "sent", header: "Sent", type: "number", w: 8 },
      { key: "rate", header: "Delivered share", type: "text", w: 10 }, { key: "created", header: "Created", type: "date", w: 11 },
    ],
  };
}

export function DeliveryTab({ q, now }: { q: string; now: number }) {
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState("all");
  const [source, setSource] = useState("all");
  const [cmp, setCmp] = useState<string[]>([]);
  const [panel, setPanel] = useState<RecordsSpec | null>(null);
  const qs = new URLSearchParams(q.replace(/^\?/, ""));
  qs.set("status", status); qs.set("range", range); qs.set("source", source);
  const { data, error, loading, reload } = useData<Delivery>(`workflows/delivery?${qs}`);
  const withStats = useMemo(() => (data?.camps ?? []).filter((c) => c.stats), [data]);
  if (loading && !data) return <SkeletonCards cards={3} label="Loading delivery..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const open = (key: string, title: string, sub: string, list: DCamp[], stat: StatKey | null = null) => setPanel(spec(key, title, sub, list, stat));
  const t = data.totals;
  const funnel = (["sent", "delivered", "opened", "clicked"] as StatKey[]).filter((k) => t[k] !== null).map((k) => ({ key: k, label: STAT_LABEL[k], value: t[k] as number }));
  const bad = (["bounced", "failed", "unsubscribed", "queued"] as StatKey[]).filter((k) => t[k] !== null).map((k) => ({ key: k, label: STAT_LABEL[k], value: t[k] as number }));
  const picked = withStats.filter((c) => cmp.includes(`${c.locationId}|${c.campaignId}`)).slice(0, 4);
  return (
    <div data-testid="wf-delivery">
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Narrow the campaigns">
        <label className="text-sm"><span className="sr-only">State</span><select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="wf-d-status" className="h-10 rounded-lg border bg-background px-2"><option value="all">Every state</option>{data.statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="text-sm"><span className="sr-only">Created</span><select value={range} onChange={(e) => setRange(e.target.value)} data-testid="wf-d-range" className="h-10 rounded-lg border bg-background px-2"><option value="all">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
        <label className="text-sm"><span className="sr-only">Kind</span><select value={source} onChange={(e) => setSource(e.target.value)} data-testid="wf-d-source" className="h-10 rounded-lg border bg-background px-2"><option value="all">Every kind</option>{data.sources.map((s) => <option key={s} value={s}>{SOURCE[s] ?? s}</option>)}</select></label>
        <span className="text-sm text-muted-foreground">{data.camps.length} campaigns, {data.withStats} with delivery figures</span>
      </div>
      {!data.statsPermitted ? <InlineAlert tone="warning" title="Needs permission: reconnect" className="mb-4">SubSync needs <code>{data.permissionName}</code> to read how many messages were delivered. Until then no delivery figure is shown.</InlineAlert> : null}
      {data.camps.length === 0 ? <EmptyState title="No campaigns yet" body="Press Update now on the Overview. Campaigns need the campaign permission." /> : data.withStats === 0 ? <EmptyState title="Delivery figures not read yet" body="Press Update now to read how many messages of each campaign were delivered." /> : (
        <>
          {data.flags.length ? (
            <Section title="Campaigns that need a look" hint="Each says why, in words. Items marked estimate come from quiet history.">
              <ul className="divide-y rounded-xl border" data-testid="wf-d-flags">{data.flags.map((f) => (
                <li key={f.kind + f.campaignId + f.locationId} className="px-4 py-3 text-sm"><span className="block font-medium">{f.campaign} <span className="font-normal text-muted-foreground">in {f.account}</span>{f.estimate ? " (estimate)" : ""}</span><span className="block">{f.why}</span><span className="block text-muted-foreground">{f.next}</span></li>
              ))}</ul>
            </Section>
          ) : <p className="mb-6 text-sm text-muted-foreground" data-testid="wf-d-ok">No campaign looks sent but undelivered.</p>}
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="wf-d-numbers">
            {STAT_KEYS.map((k) => <WfNumber key={k} label={STAT_LABEL[k]} value={t[k] === null ? "Not available" : t[k]!.toLocaleString("en-US")} tone={BAD.has(k) && (t[k] ?? 0) > 0 ? (k === "unsubscribed" || k === "queued" ? "warn" : "bad") : "neutral"} testId={`wf-d-n-${k}`}
              hint={k === "delivered" && t.sent ? pct(t.delivered === null ? null : t.delivered / t.sent) : undefined} onClick={t[k] === null ? undefined : () => open(`d-${k}`, STAT_LABEL[k], `${STAT_LABEL[k]} across the campaigns shown.`, withStats.filter((c) => (c.stats?.[k] ?? 0) > 0), k)} />)}
          </div>
          <div className="mb-8 grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <WfBars title="From sent to clicked" rows={funnel} selected={null} onSelect={(k) => open(`f-${k}`, STAT_LABEL[k as StatKey], "Campaigns that reported this.", withStats.filter((c) => c.stats?.[k as StatKey] !== null), k as StatKey)} />
            <WfBars title="What went wrong" colour="var(--destructive)" rows={bad} selected={null} empty="Nothing went wrong." onSelect={(k) => open(`b-${k}`, STAT_LABEL[k as StatKey], "Campaigns with this problem.", withStats.filter((c) => (c.stats?.[k as StatKey] ?? 0) > 0), k as StatKey)} />
            <WfBars columns title="Delivery health by client account (0 to 100)" colour="var(--success)" rows={data.league.filter((a) => a.score !== null).map((a) => ({ key: a.locationId, label: a.name, value: a.score as number }))} selected={null} empty="Needs at least 50 messages sent in a client account."
              onSelect={(k) => open(`a-${k}`, data.league.find((a) => a.locationId === k)?.name ?? "Client account", "This client account's campaigns.", withStats.filter((c) => c.locationId === k))} />
            <WfBars columns title="Waiting to send, by client account" colour="var(--warning)" rows={data.league.filter((a) => a.queued > 0).map((a) => ({ key: a.locationId, label: a.name, value: a.queued }))} selected={null} empty="Nothing is waiting."
              onSelect={(k) => open(`q-${k}`, "Waiting to send", "Campaigns with messages waiting.", withStats.filter((c) => c.locationId === k && (c.stats?.queued ?? 0) > 0), "queued")} />
          </div>
          <Section title="League table" hint="Score = delivered share, minus a penalty for bounces, failures and unsubscribes. Shown from 50 messages sent.">
            <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[40rem] text-sm" data-testid="wf-d-league"><thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Client account</th><th className="px-3 py-2 text-right font-medium">Campaigns</th><th className="px-3 py-2 text-right font-medium">Sent</th><th className="px-3 py-2 text-right font-medium">Delivered</th><th className="px-3 py-2 text-right font-medium">Bounced</th><th className="px-3 py-2 text-right font-medium">Score</th></tr></thead>
              <tbody>{data.league.map((a) => <tr key={a.locationId} className="border-b last:border-b-0"><td className="px-3 py-2 font-medium">{a.name}</td><td className="px-3 py-2 text-right">{a.campaigns}</td><td className="px-3 py-2 text-right">{a.sent.toLocaleString("en-US")}</td><td className="px-3 py-2 text-right">{a.delivered.toLocaleString("en-US")}</td><td className="px-3 py-2 text-right">{a.bounced.toLocaleString("en-US")}</td><td className="px-3 py-2 text-right font-semibold">{a.score === null ? "Not enough data" : a.score}</td></tr>)}</tbody></table></div>
          </Section>
          <Section title="Compare campaigns" hint="Tick up to four to put them side by side.">
            <div className="overflow-x-auto rounded-xl border"><div className="min-w-[46rem]" data-testid="wf-d-campaigns">
              {withStats.slice(0, 60).map((c) => { const k = `${c.locationId}|${c.campaignId}`; return (
                <div key={k} className="grid grid-cols-[2rem_minmax(10rem,1.6fr)_minmax(8rem,1fr)_6rem_6rem_9rem] items-center gap-x-3 border-b px-3 py-1.5 text-sm last:border-b-0">
                  <input type="checkbox" aria-label={`Compare ${c.name}`} checked={cmp.includes(k)} disabled={!cmp.includes(k) && cmp.length >= 4} onChange={() => setCmp((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} data-testid="wf-d-pick" className="size-4" />
                  <span className="truncate font-medium">{c.name}</span><span className="truncate text-muted-foreground">{c.account}</span>
                  <span className="text-right">{c.stats?.sent?.toLocaleString("en-US") ?? ""}</span><span className="text-right">{pct(c.deliveredRate)}</span>
                  <span className="truncate text-xs text-muted-foreground">{c.normal ? `${c.normal.diff >= 0 ? "+" : ""}${Math.round(c.normal.diff * 100)} points vs its usual` : "Not enough history"}</span>
                </div>); })}
            </div></div>
            {picked.length >= 2 ? (
              <div className="mt-4 overflow-x-auto rounded-xl border"><table className="w-full min-w-[30rem] text-sm" data-testid="wf-d-compare"><thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium" />{picked.map((c) => <th key={c.campaignId + c.locationId} className="px-3 py-2 font-medium">{c.name}</th>)}</tr></thead>
                <tbody>{STAT_KEYS.map((k) => <tr key={k} className="border-b last:border-b-0"><td className="px-3 py-2 text-muted-foreground">{STAT_LABEL[k]}</td>{picked.map((c) => <td key={c.campaignId + c.locationId} className="px-3 py-2">{c.stats?.[k] ?? "Not available"}</td>)}</tr>)}</tbody></table></div>
            ) : null}
          </Section>
          <p className="text-xs text-muted-foreground" data-testid="wf-d-na">{data.notAvailable.people} {data.notAvailable.hours} Figures were read {when(Math.max(0, ...withStats.map((c) => c.takenAt ?? 0)), now).toLowerCase()}.</p>
        </>
      )}
      <span className="sr-only" aria-hidden>{Object.keys(COLOURS).length}</span>
      {panel ? <RecordsPanel spec={panel} onClose={() => setPanel(null)} now={data.now} canExport /> : null}
    </div>
  );
}

type Proof = { days: number; from?: string; to?: string; now: number; raised: Row[]; cleared: Row[]; open: Row[]; note: string };
type Row = { title: string; kind: string; account: string; at: number; clearedAt: number | null };

export function ProofTab({ q }: { q: string }) {
  const bar = usePageRange();
  const [panel, setPanel] = useState<RecordsSpec | null>(null);
  const sep = q ? "&" : "?";
  // The dates are the date bar's: what was caught and what cleared inside exactly those dates.
  const { data, error, loading, reload } = useData<Proof>(bar.ready ? `workflows/proof${q}${sep}${bar.qs}` : null);
  if (loading && !data) return <SkeletonCards cards={2} label="Loading..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const open = (key: string, title: string, rows: Row[]) => setPanel({
    key, title, subtitle: "What SubSync caught.", noun: "alerts", count: rows.length, note: data.note, dateKey: "at", preset: {}, exportName: key,
    cols: [{ key: "title", header: "What", type: "text", primary: true, w: 30 }, { key: "account", header: "Client account", type: "text", facet: true, w: 14 }, { key: "at", header: "Raised", type: "date", w: 12 }, { key: "cleared", header: "Cleared", type: "date", w: 12 }],
    rows: rows.map((r, i) => ({ id: `${key}-${i}`, url: null, lead: null, cells: { title: r.title, account: r.account, at: r.at, cleared: r.clearedAt } })),
  });
  return (
    <div data-testid="wf-proof">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-sm text-muted-foreground" data-testid="wf-proof-dates">Dates: {bar.label}, from the bar above.</span>
        <button type="button" onClick={() => window.print()} data-testid="wf-proof-print" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-accent"><Printer aria-hidden className="size-4" />Print or save as PDF</button>
      </div>
      <h2 className="mb-1 text-base font-semibold">What SubSync watched over for you</h2>
      <p className="mb-4 text-sm text-muted-foreground">A page you can show your clients: what was caught, what cleared, and what is still open{data.from && data.to ? `, for ${data.from} to ${data.to}` : ""}.</p>
      <div className="mb-6 grid grid-cols-3 gap-3">
        <WfNumber label="Caught" value={data.raised.length} onClick={() => open("raised", "Caught", data.raised)} testId="wf-proof-raised" />
        <WfNumber label="Cleared" value={data.cleared.length} tone="good" onClick={() => open("cleared", "Cleared", data.cleared)} testId="wf-proof-cleared" />
        <WfNumber label="Still open" value={data.open.length} tone={data.open.length ? "warn" : "good"} onClick={() => open("open", "Still open", data.open)} testId="wf-proof-open" />
      </div>
      {data.raised.length === 0 && data.open.length === 0 ? <EmptyState compact title="Nothing was caught" body="Either everything is healthy, or SubSync has not updated yet." /> : (
        <ul className="divide-y rounded-xl border text-sm" data-testid="wf-proof-list">{[...data.raised.slice(0, 15)].map((r, i) => <li key={i} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2"><span className="min-w-0"><span className="block truncate font-medium">{r.title}</span><span className="block text-xs text-muted-foreground">{r.account}</span></span><span className="text-xs">{r.clearedAt ? "Cleared" : "Open"}</span></li>)}</ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{data.note}</p>
      {panel ? <RecordsPanel spec={panel} onClose={() => setPanel(null)} now={data.now} canExport /> : null}
    </div>
  );
}
