"use client";

import { useState } from "react";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { Badge, Btn, Card, Empty, ErrorBox, fmtMoney, Loading, PageHeader, Stat, type Tone } from "../ui";

type Finding = {
  key: string; severity: "critical" | "warning" | "info"; title: string; detail: string; count: number | null; dollars: number | null;
  kind: "fact" | "estimate" | "none"; view: "deals" | "inbox" | "appointments" | "accounts" | "settings"; fix: string;
};
type Data = {
  audit: {
    accountsScanned: number; staleDollars: number; estimatedDollars: number | null; headline: string; findings: Finding[];
    rows: Array<{ locationId: string; name: string; staleValue: number; staleOpps: number; waiting: number; estimated: number | null }>;
  };
  summary: string;
};

const tone: Record<Finding["severity"], Tone> = { critical: "bad", warning: "warn", info: "info" };
const label: Record<Finding["severity"], string> = { critical: "Fix first", warning: "Soon", info: "Good to know" };

// Instant audit: what is wrong across the accounts right now and what it is costing. Money that is counted
// from deals is labelled a fact; money inferred from a win rate is labelled an estimate and kept apart.
export function AuditView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Data>("audit");
  const [copied, setCopied] = useState(false);
  if (loading && !data) return <Loading label="Auditing your accounts..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const a = data.audit;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this summary", data.summary);
    }
  };

  return (
    <div>
      <PageHeader
        title="Account audit"
        subtitle={a.headline}
        actions={<><Btn onClick={() => window.print()}>Print</Btn><Btn variant="primary" onClick={copy}>{copied ? "Copied" : "Copy summary"}</Btn></>}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Stale deal value" value={fmtMoney(a.staleDollars)} tone={a.staleDollars > 0 ? "warn" : undefined} sub="Fact: counted from open deals that have not moved" />
        <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">Cost of slow follow-up</p><Badge tone="info">Estimate</Badge></div>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{a.estimatedDollars === null ? <span className="text-base font-normal text-muted-foreground">Not enough data</span> : fmtMoney(a.estimatedDollars)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Waiting conversations x average deal x each account&apos;s win rate. A rough size of the problem, not money lost. Never added to the figure beside it.</p>
        </div>
      </div>

      <h2 className="mb-3 mt-6 text-base font-semibold">What needs fixing</h2>
      {a.findings.length === 0 ? (
        <Empty title="Nothing urgent" body="No stale deals, waiting conversations or unmarked appointments across the accounts you can see." />
      ) : (
        <ul className="space-y-3">
          {a.findings.map((f) => (
            <li key={f.key} className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={tone[f.severity]}>{label[f.severity]}</Badge>
                    {f.kind === "estimate" && <Badge tone="info">Estimate</Badge>}
                    {f.kind === "fact" && <Badge tone="neutral">Counted</Badge>}
                  </div>
                  <p className="font-medium">{f.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>
                  <p className="mt-2 text-sm"><span className="font-medium">What to do:</span> {f.fix}</p>
                </div>
                <div className="print:hidden"><Btn onClick={() => go(f.view === "deals" ? "deals" : f.view === "settings" ? "settings" : f.view)}>Open</Btn></div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {a.rows.length > 0 && (
        <Card title="Where to start" className="mt-6">
          <ul className="divide-y text-sm">
            {a.rows.map((r) => (
              <li key={r.locationId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <button type="button" className="font-medium hover:underline print:no-underline" onClick={() => go("account", r.locationId)}>{r.name}</button>
                <span className="text-muted-foreground">
                  {fmtMoney(r.staleValue)} stale in {r.staleOpps} {r.staleOpps === 1 ? "deal" : "deals"} · {r.waiting} waiting{r.estimated !== null ? ` · about ${fmtMoney(r.estimated)} (estimate)` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{a.accountsScanned} account{a.accountsScanned === 1 ? "" : "s"} checked just now from the latest sync. Nothing here changes anything in your accounts.</p>
    </div>
  );
}
