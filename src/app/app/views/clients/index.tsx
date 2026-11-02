"use client";

import { useState, type ReactNode } from "react";
import { useApiClient, useData } from "../../session";
import { EmptyState, ModuleTabs, SkeletonRows, type ModuleTab } from "../../ds";
import { Btn, ErrorBox } from "../../ui";
import type { GoFn } from "../../nav";
import { AccountsView } from "../accounts";
import { CompareTab } from "./compare";
import { DetailsTab } from "./details";
import { OnboardingTab } from "./onboarding-tab";
import { ReviewsTab } from "./reviews";
import type { ClientsData, TabId } from "./types";

// The Clients module (stage C1, N56 and N63): what used to be the separate Accounts, Clients and Setup pages, as one place with five tabs.
//   Health                 how healthy each client looks, who to call first, each client's trends        (was Accounts)
//   Onboarding             one checklist per client, templates, who is on each step, who is stuck         (was Setup)
//   Details and billing    fee, renewal date, industry, and the log of conversations, typed in the row    (was Clients)
//   Compare                two or more clients against their average, and compare setups                  (was Compare two, Compare setups)
//   Reviews (QBR)          the quarterly review of one client                                             (was Review)
// The old addresses (#accounts, #onboarding, #clients) still work: each opens the module on its tab. Nothing here messages anyone or writes to the CRM.
export type ClientsFeatures = { health: boolean; onboarding: boolean; clients: boolean; reports: boolean; setupCompare: boolean; playbooks: boolean };
const ALL: ClientsFeatures = { health: true, onboarding: true, clients: true, reports: true, setupCompare: true, playbooks: true };

// The tabs that read the clients list share one load, so a change made in one (a fee, an industry) shows in the others.
function WithClients({ children }: { children: (data: ClientsData, reload: () => void) => ReactNode }) {
  const { data, error, loading, reload } = useData<ClientsData>("clients");
  if (loading && !data) return <SkeletonRows rows={6} label="Loading clients..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.clients.length === 0) return <EmptyState title="No clients yet" body="Client accounts appear here once the first sync finishes." />;
  return <>{children(data, reload)}</>;
}

export function ClientsView({ go, initialTab = "health", features = ALL }: { go: GoFn; initialTab?: TabId; features?: ClientsFeatures }) {
  const api = useApiClient();
  const f = features;
  const defs: Array<{ id: TabId; label: string; on: boolean; node: ReactNode }> = [
    { id: "health", label: "Health", on: f.health, node: <AccountsView go={go} embedded /> },
    { id: "onboarding", label: "Onboarding", on: f.onboarding, node: <OnboardingTab go={go} /> },
    { id: "details", label: "Details and billing", on: f.clients, node: <WithClients>{(d, reload) => <DetailsTab data={d} reload={reload} go={go} showPlaybooks={f.playbooks} />}</WithClients> },
    { id: "compare", label: "Compare", on: f.clients && f.reports, node: <WithClients>{(d) => <CompareTab accounts={d.compare} showSetups={f.setupCompare} />}</WithClients> },
    { id: "reviews", label: "Reviews (QBR)", on: f.clients && f.reports, node: <WithClients>{(d) => <ReviewsTab accounts={d.compare} />}</WithClients> },
  ];
  const shown = defs.filter((d) => d.on);
  const start = Math.max(0, shown.findIndex((d) => d.id === initialTab));
  const [index, setIndex] = useState(start);
  const tabs: ModuleTab[] = shown.map((d) => ({ label: d.label, node: d.node }));
  if (shown.length === 0) return <EmptyState title="Not available" body="These pages are switched off right now." />;
  return (
    <div data-testid="page">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-5 print:hidden">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">Clients</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground" data-testid="page-subtitle">Health, onboarding, fees and renewals, comparisons and quarterly reviews, for every client.</p>
        </div>
        {f.clients && <div className="flex flex-wrap gap-2"><Btn onClick={() => api.download("export/clients", "subsync-clients.csv")}>Export CSV</Btn></div>}
      </header>
      <ModuleTabs tabs={tabs} value={Math.min(index, tabs.length - 1)} onChange={setIndex} label="Clients" />
    </div>
  );
}
