"use client";

import { useState, type ReactNode } from "react";
import { useApiClient, useData } from "../../session";
import { EmptyState, ModuleTabs, SkeletonRows, type ModuleTab } from "../../ds";
import { Btn, ErrorBox } from "../../ui";
import type { GoFn } from "../../nav";
import { BookTab } from "./book";
import { ClientPage } from "./client-page";
import { CompareTab } from "./compare";
import { IndustriesTab } from "./industries";
import { OnboardingTab } from "./onboarding-tab";
import { ReportsTab } from "./reports-tab";
import { ReviewsTab } from "./reviews";
import type { TabId } from "./types";

// The Clients module (stages C1 and CLIENTS): the agency's client book.
//   Clients                the book: who needs you, renewals, fees, health, with the client's own page    (was Health and Details and billing)
//   Onboarding             one checklist per client, templates, who is on each step, who is stuck         (was Setup)
//   Compare                two or more clients against their average, and compare setups
//   Reviews (QBR)          the quarterly review of one client
//   Industries             clients grouped by industry, and the playbooks and reply targets for each
// The old addresses (#accounts, #onboarding, #clients) still work: each opens the module on its tab. Nothing here messages anyone or writes to the CRM.
export type ClientsFeatures = { health: boolean; onboarding: boolean; clients: boolean; reports: boolean; setupCompare: boolean; playbooks: boolean };
const ALL: ClientsFeatures = { health: true, onboarding: true, clients: true, reports: true, setupCompare: true, playbooks: true };

type Names = { clients: Array<{ locationId: string; name: string; score?: number }> };
// Compare and Reviews only need the names to choose from: a light list, never the whole book.
function WithNames({ children }: { children: (accounts: Names["clients"]) => ReactNode }) {
  const { data, error, loading, reload } = useData<Names>("clients?part=names");
  if (loading && !data) return <SkeletonRows rows={4} label="Loading clients..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.clients.length === 0) return <EmptyState title="No clients yet" body="Client accounts appear here once the first sync finishes." />;
  return <>{children(data.clients)}</>;
}

export function ClientsView({ go, initialTab = "health", features = ALL }: { go: GoFn; initialTab?: TabId; features?: ClientsFeatures }) {
  const api = useApiClient();
  const f = features;
  const [openId, setOpenId] = useState<string | null>(null);
  const defs: Array<{ id: TabId; label: string; on: boolean; node: ReactNode }> = [
    { id: "health", label: "Clients", on: f.health || f.clients, node: <BookTab go={go} onOpen={setOpenId} /> },
    { id: "onboarding", label: "Onboarding", on: f.onboarding, node: <OnboardingTab go={go} /> },
    { id: "compare", label: "Compare", on: f.clients && f.reports, node: <WithNames>{(a) => <CompareTab accounts={a} showSetups={f.setupCompare} />}</WithNames> },
    { id: "reviews", label: "Reviews (QBR)", on: f.clients && f.reports, node: <WithNames>{(a) => <ReviewsTab accounts={a} />}</WithNames> },
    { id: "reports", label: "Reports", on: f.clients, node: <ReportsTab /> },
    { id: "details", label: "Industries", on: f.clients, node: <IndustriesTab go={go} showPlaybooks={f.playbooks} /> },
  ];
  const shown = defs.filter((d) => d.on);
  // The old addresses: "details" used to be the fee and renewal tab, which is now the Clients tab.
  const wanted = initialTab === "details" ? "health" : initialTab;
  const start = Math.max(0, shown.findIndex((d) => d.id === wanted));
  const [index, setIndex] = useState(start);
  const tabs: ModuleTab[] = shown.map((d) => ({ label: d.label, node: d.node }));
  if (shown.length === 0) return <EmptyState title="Not available" body="These pages are switched off right now." />;
  if (openId) return <div data-testid="page"><ClientPage key={openId} id={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} go={go} /></div>;
  return (
    <div data-testid="page">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-5 print:hidden">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight">Clients</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground" data-testid="page-subtitle">Which clients may leave, which renewals are coming, and what each client pays you. Health is worked out by SubSync; fees, renewal dates and industries are typed by you.</p>
        </div>
        {f.clients && <div className="flex flex-wrap gap-2"><Btn onClick={() => api.download("export/clients", "subsync-clients.csv")}>Export CSV</Btn></div>}
      </header>
      <ModuleTabs tabs={tabs} value={Math.min(index, tabs.length - 1)} onChange={setIndex} label="Clients" />
    </div>
  );
}
