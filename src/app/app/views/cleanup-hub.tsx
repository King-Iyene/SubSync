"use client";

import { ModuleTabs, Page } from "../ds";
import { DuplicatesView } from "./duplicates";
import { HistoryTab } from "./history-tab";
import { QualityTab } from "./quality-tab";
import { RulesTab } from "./rules-tab";

// Clean-up (stage CLEANUP): the one menu entry that holds Duplicates, Data quality, History and Rules. The old addresses #duplicates and #cleanup open the right tab.
// Which tabs a person sees follows what they may do, and the server enforces it again on every call: an agency or a business sees all four; a client's staff see
// Duplicates (their own account) and History. A tab whose feature is switched off is left out, as before.

export type CleanupTabId = "duplicates" | "quality" | "history" | "rules";

export function cleanupTabs(o: { kind: "agency" | "business" | "client"; duplicatesOn: boolean; cleanupOn: boolean }): CleanupTabId[] {
  const out: CleanupTabId[] = [];
  const full = o.kind !== "client";
  if (o.duplicatesOn) out.push("duplicates");
  if (full && o.cleanupOn) out.push("quality");
  if (o.duplicatesOn || (full && o.cleanupOn)) out.push("history");
  if (full && o.cleanupOn) out.push("rules");
  return out;
}

const LABEL: Record<CleanupTabId, string> = { duplicates: "Duplicates", quality: "Data quality", history: "History", rules: "Rules" };

export function CleanupModule({ kind, start, duplicatesOn, cleanupOn }: { kind: "agency" | "business" | "client"; start: CleanupTabId; duplicatesOn: boolean; cleanupOn: boolean }) {
  const ids = cleanupTabs({ kind, duplicatesOn, cleanupOn });
  const node: Record<CleanupTabId, React.ReactNode> = {
    duplicates: <DuplicatesView embedded />,
    quality: <QualityTab canFix={kind !== "client"} />,
    history: <HistoryTab />,
    rules: <RulesTab canEdit={kind !== "client"} />,
  };
  const first = Math.max(0, ids.indexOf(start));
  return (
    <Page title="Clean-up" subtitle="Find duplicates, see how healthy each client's contact list is, and keep a record of every decision.">
      {ids.length === 0 ? <p className="text-sm text-muted-foreground">This page is switched off right now.</p> : <ModuleTabs key={ids.join()} start={first} tabs={ids.map((id) => ({ id, label: LABEL[id], node: node[id] }))} label="Clean-up sections" />}
    </Page>
  );
}
