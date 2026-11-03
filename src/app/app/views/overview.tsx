"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import type { Overview } from "../types";
import { DataList, InlineAlert, Page, SkeletonCards } from "../ds";
import {
  BandBadge, Btn, Card, ChurnBadge, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Stat, StackedBar,
} from "../ui";
import type { GoFn } from "../nav";
import { ExecSummary } from "./exec-summary";

export function OverviewView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<Overview>("overview");
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (loading && !data) return <Page title="Overview"><SkeletonCards cards={3} label="Loading the overview..." /></Page>;
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
    <Page
        title="Overview"
        subtitle="Who needs attention, where money is stuck, what changed."
        actions={
          <>
            <Btn onClick={() => window.print()}>Print summary</Btn>
            <Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : api.demo ? "Refresh insights" : "Sync now"}</Btn>
          </>
        }
    >
      {note && <InlineAlert tone="info" className="mb-4">{note}</InlineAlert>}
      {data.hiddenAccounts > 0 && (
        <InlineAlert tone="info" className="mb-4">
          Your free plan covers {data.entitlements.accountLimit} client accounts. {data.hiddenAccounts} more are hidden until you upgrade.
        </InlineAlert>
      )}

      <ExecSummary />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Stale deal value" value={fmtMoney(k.staleValue)} tone={k.staleValue > 0 ? "warn" : undefined}
          sub={`${fmtInt(k.staleOpps)} of ${fmtInt(k.openOpps)} open deals have not moved`} />
        <Stat label="Waiting past your reply target" value={k.unanswered} tone={k.unanswered > 0 ? "warn" : undefined} sub="customer wrote last, no reply" />
      </div>
      {k.excludedDeals > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {fmtInt(k.excludedDeals)} open deal{k.excludedDeals === 1 ? " is" : "s are"} left out of every dollar figure: {(k.excludedByStage ?? 0) > 0 ? `${fmtInt(k.excludedByStage ?? 0)} in a closed-out stage or a pipeline not in use, and ${fmtInt(k.excludedDeals - (k.excludedByStage ?? 0))} with` : "they have"} no value or no owner.
        </p>
      )}

      {k.readLimit && <div className="mt-2" data-testid="read-limit"><InlineAlert tone="info">{k.readLimit}</InlineAlert></div>}

      {k.outlier && (
        <InlineAlert tone="warning" className="mt-2">
          One deal ({fmtMoney(k.outlier.value)}) is {Math.round(k.outlier.share * 100)}% of the open pipeline of {fmtInt(k.outlier.of)} deals, so the dollar figures above move with it. Amounts are as entered in each account; different currencies are not converted.
        </InlineAlert>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Needs attention" className="lg:col-span-2" action={<Btn variant="ghost" onClick={() => go("accounts")}>All accounts</Btn>}>
          {data.attention.length === 0 ? (
            <Empty title="Nothing needs attention" body="Every account is active and on track." />
          ) : (
            <DataList rows={data.attention} rowKey={(a) => a.locationId} caption="Accounts that need attention"
              columns={[
                { key: "name", header: "Client account", primary: true, width: "minmax(0,2fr)", cell: (a) => (
                  <span className="block">
                    <button type="button" onClick={() => go("account", a.locationId)} className="min-h-9 text-left text-sm font-medium hover:underline">{a.name ?? "Unnamed account"}</button>
                    <span className="block text-xs font-normal text-muted-foreground">{a.reasons.slice(0, 3).join(" · ")}{a.bandNote ? ` · ${a.bandNote}` : ""}</span>
                  </span>) },
                { key: "health", header: "Health", width: "9rem", cell: (a) => <span className="flex flex-wrap items-center gap-1.5"><BandBadge band={a.band} /><ChurnBadge level={a.churn} /></span> },
                { key: "open", header: "", width: "5rem", align: "right", cell: (a) => <ExtLink href={a.url}>Open</ExtLink> },
              ]} />
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
          </Card>
        </div>
      </div>
    </Page>
  );
}
