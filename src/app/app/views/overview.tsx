"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import type { Overview } from "../types";
import {
  Badge, BandBadge, Btn, Card, ChurnBadge, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Loading, PageHeader, Stat, StackedBar, timeAgo,
} from "../ui";
import type { GoFn } from "../nav";
import { ExecSummary } from "./exec-summary";

export function OverviewView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Overview>("overview");
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const k = data.kpis;

  const sync = async () => {
    setSyncing(true);
    setNote(null);
    try {
      await api.post("sync");
      await reload();
      setNote(api.demo ? "Insights refreshed." : "Sync started. It continues in the background and the numbers update as it finishes.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Every client account at a glance: who needs attention, where money is stuck, and what changed."
        actions={
          <>
            <Btn onClick={() => window.print()}>Print summary</Btn>
            <Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : api.demo ? "Refresh insights" : "Sync now"}</Btn>
          </>
        }
      />
      {note && <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm" role="status">{note}</p>}
      {!data.demo && (data.sync.lastFinishedAt === null || data.sync.pending > 0) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-2 text-sm" role="status">
          <span>
            {k.accounts === 0
              ? "Your first sync is running. Client accounts and numbers appear here over the next few minutes."
              : "Still syncing your accounts. Numbers fill in as each one finishes."}
          </span>
          <Btn variant="ghost" onClick={() => go("help")}>New here? Getting started</Btn>
        </div>
      )}
      {data.hiddenAccounts > 0 && (
        <p className="mb-4 rounded-lg border border-sky-500/40 bg-sky-500/5 px-3 py-2 text-sm">
          Your free plan covers {data.entitlements.accountLimit} client accounts. {data.hiddenAccounts} more are hidden until you upgrade.
        </p>
      )}

      <ExecSummary />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Stale deal value" value={fmtMoney(k.staleValue)} tone={k.staleValue > 0 ? "warn" : undefined}
          sub={`${fmtInt(k.staleOpps)} of ${fmtInt(k.openOpps)} open deals have not moved`} />
        <Stat label="Waiting past SLA" value={k.unanswered} tone={k.unanswered > 0 ? "warn" : undefined} sub="inbound, unanswered" />
        <Stat label="Open alerts" value={k.openAlerts} tone={k.criticalAlerts > 0 ? "bad" : undefined} sub={`${k.criticalAlerts} critical`} />
      </div>
      {k.excludedDeals > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {fmtInt(k.excludedDeals)} open deal{k.excludedDeals === 1 ? " is" : "s are"} left out of every dollar figure because {k.excludedDeals === 1 ? "it has" : "they have"} no value or no owner.
        </p>
      )}

      {k.outlier && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          One deal ({fmtMoney(k.outlier.value)}) is {Math.round(k.outlier.share * 100)}% of the open pipeline of {fmtInt(k.outlier.of)} deals, so the dollar figures above move with it. Amounts are as entered in each account; different currencies are not converted.
        </p>
      )}

      <Card title="Estimates" className="mt-4" action={<Badge tone="info">Estimate, not a fact</Badge>}>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Expected revenue from open deals</p>
            <p className="text-2xl font-semibold tabular-nums">{k.expectedRevenue === null ? <span className="text-base font-normal text-muted-foreground">Not enough data</span> : fmtMoney(k.expectedRevenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cost of slow follow-up</p>
            <p className="text-2xl font-semibold tabular-nums">{k.followUpRevenueAtRisk === null ? <span className="text-base font-normal text-muted-foreground">Not enough data</span> : fmtMoney(k.followUpRevenueAtRisk)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {k.estimateAccounts === 0
            ? `No account has ${k.minClosedDeals} closed deals yet, so there is no win rate to base an estimate on.`
            : `Based on ${k.estimateAccounts} of ${k.accounts} accounts that have at least ${k.minClosedDeals} closed deals.`}
        </p>
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none underline">How these are worked out</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Expected revenue: for each account with enough closed deals, its open deal value (deals with a value and an owner) times that account&apos;s own win rate, added up.</li>
            <li>Cost of slow follow-up: conversations waiting past the reply target, times the account&apos;s average deal value, times its win rate. It is a rough size of the problem, not money lost.</li>
            <li>Accounts with fewer than {k.minClosedDeals} closed deals are left out rather than guessed.</li>
          </ul>
        </details>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Needs attention" className="lg:col-span-2" action={<Btn variant="ghost" onClick={() => go("accounts")}>All accounts</Btn>}>
          {data.attention.length === 0 ? (
            <Empty title="Nothing needs attention" body="Every account is active and on track." />
          ) : (
            <ul className="divide-y">
              {data.attention.map((a) => (
                <li key={a.locationId} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <button type="button" onClick={() => go("account", a.locationId)} className="text-left text-sm font-medium hover:underline">{a.name ?? "Unnamed account"}</button>
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{a.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
                  </div>
                  <div className="flex items-center gap-2">
                    <BandBadge band={a.band} />
                    <ChurnBadge level={a.churn} />
                    <ExtLink href={a.url}>Open</ExtLink>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Account health">
            <StackedBar parts={[
              { label: "Thriving", value: data.bands.thriving, className: "bg-emerald-500" },
              { label: "Healthy", value: data.bands.healthy, className: "bg-emerald-300" },
              { label: "Watch", value: data.bands.watch, className: "bg-amber-500" },
              { label: "At risk", value: data.bands.at_risk, className: "bg-red-500" },
            ]} />
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Client accounts</dt><dd>{fmtInt(k.accounts)}{k.ignored ? ` (${k.ignored} ignored)` : ""}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Average health score</dt><dd>{k.avgScore} / 100</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Accounts gone quiet</dt><dd>{k.dormant}</dd></div>
            </dl>
          </Card>
          <Card title="Data sync">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Last completed</dt><dd>{timeAgo(data.sync.lastFinishedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Jobs queued</dt><dd>{data.sync.pending}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Contacts tracked</dt><dd>{fmtInt(k.contacts)}</dd></div>
            </dl>
            {data.sync.failed > 0 && (
              <div className="mt-3 rounded-lg bg-red-500/10 p-2 text-xs">
                <Badge tone="bad">{data.sync.failed} failed</Badge>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">{data.sync.recentFailures.slice(0, 3).map((f, i) => <li key={i}>{f.type}: {f.error ?? "unknown error"}</li>)}</ul>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
