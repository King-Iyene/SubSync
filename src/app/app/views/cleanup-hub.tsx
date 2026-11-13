"use client";

import { ModuleTabs, Page } from "../ds";
import { DuplicatesView } from "./duplicates";
import { FixTab, HealthTab } from "./cu/cu-ui";
import { HistoryTab } from "./history-tab";
import { QualityTab } from "./quality-tab";
import { RulesTab } from "./rules-tab";

// Clean-up (stage CLEANUP): the one menu entry that holds Duplicates, Data quality, History and Rules. The old addresses #duplicates and #cleanup open the right tab.
// Which tabs a person sees follows what they may do, and the server enforces it again on every call: an agency or a business sees all four; a client's staff see
// Duplicates (their own account) and History. A tab whose feature is switched off is left out, as before.

export type CleanupTabId = "duplicates" | "fix" | "health" | "quality" | "history" | "rules";

export function cleanupTabs(o: { kind: "agency" | "business" | "client"; duplicatesOn: boolean; cleanupOn: boolean; fixOn?: boolean; healthOn?: boolean }): CleanupTabId[] {
  const out: CleanupTabId[] = [];
  const full = o.kind !== "client";
  if (o.duplicatesOn) out.push("duplicates");
  if (o.fixOn) out.push("fix");
  if (o.healthOn) out.push("health");
  if (full && o.cleanupOn) out.push("quality");
  if (o.duplicatesOn || (full && o.cleanupOn)) out.push("history");
  if (full && o.cleanupOn) out.push("rules");
  return out;
}

const LABEL: Record<CleanupTabId, string> = { duplicates: "Duplicates", fix: "Fix lists", health: "Health", quality: "Data quality", history: "History", rules: "Rules" };

export function CleanupModule({ kind, start, duplicatesOn, cleanupOn, fixOn = false, healthOn = false, legacyHealth = null }: { kind: "agency" | "business" | "client"; start: CleanupTabId; duplicatesOn: boolean; cleanupOn: boolean; fixOn?: boolean; healthOn?: boolean; legacyHealth?: React.ReactNode }) {
  const ids = cleanupTabs({ kind, duplicatesOn, cleanupOn, fixOn, healthOn });
  const node: Record<CleanupTabId, React.ReactNode> = {
    duplicates: <DuplicatesView embedded />,
    fix: <FixTab />,
    health: <><HealthTab />{legacyHealth && <details open className="mt-6 rounded-xl border bg-card p-3"><summary className="cursor-pointer text-sm font-medium">More data health tools (alerts, imports, safe fixes)</summary><div className="mt-3">{legacyHealth}</div></details>}</>,
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
