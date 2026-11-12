"use client";

import { useCallback, useState } from "react";
import { EmptyState, ErrorState, LocalAccountPicker, ModuleTabs, Page, SkeletonRows } from "../../ds";
import { timeAgo } from "../../ui";
import { CleanupView } from "../cleanup";
import { FixTab } from "../cu/cu-ui";
import { HistoryTab } from "../history-tab";
import { RulesTab } from "../rules-tab";
import { sampleOn, SAMPLE, useDq, type Opts } from "./dq-data";
import { DupesTab } from "./dq-dupes";
import { IntakeTab } from "./dq-intake";
import { LeadsSheet, type LeadsPick } from "./dq-leads";
import { OverviewTab, type Go } from "./dq-overview";

// CLEAN-UP, rebuilt (stage DQ; docs/research/DATAQUALITY_R1.md). Five tabs: Overview, Duplicates, Fix data, Lead intake, History (and Rules for people who may change them). Real data by default, sample data
// only behind ?cufx and labelled. The account choice and the people-behind-a-number sheet are held here so every tab shares them. Which tabs show follows the feature switches; the server checks again on every call.

export type DqTabId = "overview" | "duplicates" | "fix" | "intake" | "history" | "rules";
const LABEL: Record<DqTabId, string> = { overview: "Overview", duplicates: "Duplicates", fix: "Fix data", intake: "Lead intake", history: "History", rules: "Rules" };

export function dqTabs(o: { kind: "agency" | "business" | "client"; dupes: boolean; intake: boolean; fix: boolean; cleanup: boolean }): DqTabId[] {
  const out: DqTabId[] = ["overview"];
  if (o.dupes) out.push("duplicates");
  if (o.fix) out.push("fix");
  if (o.intake) out.push("intake");
  out.push("history");
  if (o.kind !== "client" && o.cleanup) out.push("rules");
  return out;
}

function EventsLog() {
  const d = useDq<{ rows: Array<{ id: number; at: string; location: string | null; kind: string; detail: Record<string, unknown>; actor: string | null }>; next: number | null }>("dq/events", () => SAMPLE.events);
  const WORD: Record<string, (x: Record<string, unknown>) => string> = {
    dup_decided: (x) => (x.decision === "not_duplicate" ? "Marked not the same" : x.decision === "keep" ? "Kept both" : "Marked merged in the CRM"),
    dup_delete: (x) => `Delete extras: ${x.mode === "live" ? `${x.done} deleted` : "dry run, nothing deleted"}${x.protectedSkipped ? `, ${x.protectedSkipped} protected` : ""}`,
    bulk_merge: (x) => `Merge all certain: ${x.mode === "live" ? `${x.requested} sent` : `${x.ready} planned, dry run`}`,
    scan: (x) => `Scan: ${x.added ?? 0} new groups, ${x.resolved ?? 0} resolved, ${x.open ?? 0} open`,
  };
  if (d.loading && !d.data) return <SkeletonRows rows={3} label="Loading the log..." />;
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  const rows = d.data?.rows ?? [];
  return (
    <section aria-label="Data quality log" data-testid="dq-log">
      <h3 className="mb-2 text-base font-semibold">Data quality log</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet. Every duplicate found, decision and delete is recorded here from now on.</p> : (
        <ul className="divide-y rounded-xl border bg-card text-sm">{rows.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span>{(WORD[r.kind] ?? (() => r.kind))(r.detail)}{r.location ? <span className="text-muted-foreground"> · {r.location}</span> : null}</span><span className="text-xs text-muted-foreground">{r.actor ? `${r.actor} · ` : ""}{timeAgo(r.at)}</span></li>)}</ul>
      )}
    </section>
  );
}

export function DqModule({ kind, start, duplicatesOn, intakeOn, fixOn, cleanupOn, legacyHealth = null }: { kind: "agency" | "business" | "client"; start: DqTabId; duplicatesOn: boolean; intakeOn: boolean; fixOn: boolean; cleanupOn: boolean; legacyHealth?: React.ReactNode }) {
  const o = useDq<Opts>("dq/options", () => SAMPLE.options);
  const ids = dqTabs({ kind, dupes: duplicatesOn, intake: intakeOn, fix: fixOn, cleanup: cleanupOn });
  const [i, setI] = useState(Math.max(0, ids.indexOf(start)));
  const [account, setAccount] = useState<string | null>(null);
  const [sheet, setSheet] = useState<LeadsPick>(null);
  const go: Go = useCallback((tab, acc) => { if (acc !== undefined) setAccount(acc); const n = ids.indexOf(tab); if (n >= 0) setI(n); }, [ids]);
  if (o.loading && !o.data) return <Page title="Clean-up" subtitle="Duplicates, bad data and where your leads come from."><SkeletonRows rows={5} label="Loading Clean-up..." /></Page>;
  if (o.error) return <Page title="Clean-up" subtitle="Duplicates, bad data and where your leads come from."><ErrorState error={o.error} onRetry={o.reload} /></Page>;
  const opts = o.data;
  if (!opts) return null;
  const picker = opts.accounts.length > 1 ? <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="dq-account"><LocalAccountPicker accounts={opts.accounts} picked={account ? [account] : []} onChange={(x) => setAccount(x.length ? x[x.length - 1] : null)} label="Client account" />{account && <button type="button" className="min-h-10 text-sm underline underline-offset-4" onClick={() => setAccount(null)}>All accounts</button>}</div> : null;
  const node: Record<DqTabId, React.ReactNode> = {
    overview: <>{picker}<OverviewTab opts={opts} account={account} go={go} pick={setSheet} /></>,
    duplicates: <DupesTab opts={opts} account={account} setAccount={setAccount} />,
    fix: (
      <div className="space-y-6">
        {sampleOn() && <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" role="status">Sample data: these are not your real contacts.</p>}
        {fixOn ? <FixTab /> : <EmptyState title="Fix lists are switched off" body="They will appear here as soon as they are ready for your account." />}
        {kind !== "client" && <details className="rounded-xl border bg-card p-3" data-testid="dq-tidy"><summary className="cursor-pointer text-sm font-semibold">Tidy phone numbers, names and email typos (preview first)</summary><div className="mt-3"><CleanupView embedded /></div></details>}
        {legacyHealth && <details className="rounded-xl border bg-card p-3"><summary className="cursor-pointer text-sm font-medium">More data health tools (alerts, imports, safe fixes)</summary><div className="mt-3">{legacyHealth}</div></details>}
      </div>
    ),
    intake: <IntakeTab opts={opts} account={account} setAccount={setAccount} pick={setSheet} />,
    history: <div className="space-y-6"><HistoryTab /><EventsLog /></div>,
    rules: <RulesTab canEdit={kind !== "client"} />,
  };
  return (
    <Page title="Clean-up" subtitle="Duplicates, bad data and where your leads come from.">
      <ModuleTabs key={ids.join()} value={i} onChange={setI} tabs={ids.map((id) => ({ id, label: LABEL[id], node: node[id] }))} label="Clean-up sections" />
      <LeadsSheet pick={sheet} onClose={() => setSheet(null)} />
    </Page>
  );
}
