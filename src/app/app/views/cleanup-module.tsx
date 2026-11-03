"use client";

import { useState } from "react";
import { ModuleTabs, Page as PageShell, type ModuleTab } from "../ds";
import { CleanupLeads } from "./cleanup-leads";
import { CleanupView } from "./cleanup";
import { DuplicatesView } from "./duplicates";

// The Clean-up module (stage C2): Duplicates, Formatting, Tags, and Invalid and old leads in one place. The old Duplicates and Data cleanup
// addresses open it. A client's staff see Duplicates only (read only); changing contacts is for the account owner and the agency.
export function CleanupModule({ canClean }: { canClean: boolean }) {
  const [tab, setTab] = useState(0);
  const tabs: ModuleTab[] = [{ label: "Duplicates", node: <DuplicatesView /> }];
  if (canClean) {
    tabs.push(
      { label: "Formatting", node: <CleanupView mode="formatting" /> },
      { label: "Tags", node: <CleanupView mode="tags" /> },
      { label: "Invalid and old leads", node: <CleanupLeads onTag={() => setTab(2)} /> },
    );
  }
  return (
    <PageShell title={canClean ? "Clean-up" : "Duplicates"} subtitle="Find duplicates and tidy your contacts. SubSync never merges or deletes anything for you.">
      <ModuleTabs tabs={tabs} value={tab} onChange={setTab} label="Clean-up sections" />
    </PageShell>
  );
}
