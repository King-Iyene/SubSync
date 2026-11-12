"use client";

import { Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Finding } from "@/lib/workflows/health";
import type { LabelRow } from "@/lib/workflows/store-types";
import { entityOf, type WfItem } from "@/lib/workflows/model";
import {
  BUCKET_LABEL, bucketOf, decisionOf, failingIds, inAccount, inBucket, inDecision, inRating, itemsSpec, reportLines, type Bucket, type Decision, type Slice,
} from "@/lib/workflows/reports";
import type { RecordsSpec } from "@/lib/analytics/today-records";
import { EmptyState, InlineAlert, LocalAccountPicker, Page, RecordsPanel, Section, SkeletonCards } from "../ds";
import { WfBars, WfDonut, WfNumber, WfTrend, type Mark } from "../ds/workflow-charts";
import { useApiClient, useData } from "../session";
import { Btn, ErrorBox } from "../ui";
import { DeliveryTab, ProofTab } from "./workflows-extra";
import { GapsTab, LibraryTab } from "./workflows-gaps";
import { TidyTab, type TidyData } from "./workflows-tidy";
import { WfPalette, type Command } from "./workflows-palette";
import type { RenameRule } from "@/lib/workflows/rename";
import { ChangeDialog, ItemPanel, keyOf, StateBadge, Tabs, WfTable, when, type Acc, type ChangeKind } from "./workflows-parts";
import type { GoFn } from "../nav";
import type { AccessKind } from "@/lib/access";

// Workflows: every workflow and campaign across the client accounts, how healthy they are, what to do next, and (with permission, after a preview) changing them.
// Every chart mark and every number opens the same records panel as Today, and the number on a mark equals the rows in the panel (pure code in
// src/lib/workflows/reports.ts, tested). The account choice belongs to this page only. Docs: docs/features/WORKFLOWS.md.

type Data = {
  kind: AccessKind; available: boolean; demo: boolean; now: number;
  can: { organise: boolean; change: boolean; health: boolean; sync: boolean };
  needs: { upgradeHealth: boolean; upgradeChange: boolean };
  permissions: { list: boolean; history: boolean; campaigns: boolean; rename: boolean; publish: boolean; delete: boolean; writeLive: boolean };
  accounts: Acc[]; items: WfItem[]; labels: Record<string, LabelRow>; findings: Finding[]; logsKnown: boolean; nextSteps: string[];
  slices: Slice[]; bars: Array<{ locationId: string; name: string; total: number; attention: number }>; top: Array<{ workflowId: string; locationId: string; name: string; failed: number | null; runs: number | null; share: number }>;
  decisions: Array<{ decision: Decision; count: number }>; ratings: Array<{ rating: number; label: string; count: number }>;
  daily: { failing: Array<{ day: string; value: number | null }>; total: Array<{ day: string; value: number | null }>; runs: Array<{ day: string; value: number | null }>; errors: Array<{ day: string; value: number | null }> };
  tidy: TidyData | null; wf?: { gaps: boolean; library: boolean };
  muted: Array<Finding & { why: "fixed" | "snoozed"; until: number; key: string }>; since: { at: number; changes: number } | null;
  coverage: Array<{ locationId: string; have: string[]; missing: string[]; none: boolean }>; standard: string[]; syncedAt: number | null; caps: { deletesToday: number; writesToday: number };
};
type History = { rows: Array<{ id: number; at: number; account: string; name: string; type: string; what: string; source: string; who: string; outcome: string; undone: boolean; undoable: boolean }> };
type Show = "workflow" | "campaign" | "both";
type TabId = "overview" | "list" | "health" | "tidy" | "delivery" | "proof" | "history" | "gaps" | "library";

const COLOUR: Record<Bucket, string> = { failing: "var(--destructive)", never_run: "var(--warning)", running: "var(--success)", draft: "var(--chart-1)", stopped: "var(--muted-foreground)" };
const DEC_COLOUR: Record<Decision, string> = { keep: "var(--success)", review: "var(--warning)", retire: "var(--destructive)", unsorted: "var(--muted-foreground)" };
const DEC_LABEL: Record<Decision, string> = { keep: "Keep", review: "Review", retire: "Retire", unsorted: "Not sorted" };

export function WorkflowsView({ go, kind }: { go: GoFn; kind: AccessKind }) {
  void go;
  const api = useApiClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [show, setShow] = useState<Show>("workflow");
  const [tab, setTab] = useState<TabId>("overview");
  const q = picked.length ? `?wa=${picked.join(",")}` : "";
  const { data, error, loading, reload } = useData<Data>(`workflows${q}`);
  const history = useData<History>(tab === "history" ? `workflows/history${q}` : null);
  const [panel, setPanel] = useState<RecordsSpec | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<WfItem | null>(null);
  const [dialog, setDialog] = useState<ChangeKind | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [mark, setMark] = useState<string | null>(null);
  const [preset, setPreset] = useState<RenameRule | undefined>(undefined);
  const [fixItems, setFixItems] = useState<WfItem[] | null>(null);
  const [palette, setPalette] = useState(false);
  const views = useData<{ views: Array<{ name: string; filters: { show: Show; tab: TabId; picked: string[] } }> }>(kind === "client" ? null : "workflows/views");
  const [viewName, setViewName] = useState("");
  const [saving, setSaving] = useState(false);

  const items = useMemo(() => (data?.items ?? []).filter((w) => show === "both" || entityOf(w.workflowId) === show), [data, show]);
  const failing = useMemo(() => failingIds(data?.findings ?? []), [data]);
  const labels = useMemo(() => new Map(Object.entries(data?.labels ?? {})), [data]);
  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const slices: Slice[] = useMemo(() => {
    const n = new Map<Bucket, number>();
    for (const w of items) n.set(bucketOf(w, failing), (n.get(bucketOf(w, failing)) ?? 0) + 1);
    return (["failing", "never_run", "running", "draft", "stopped"] as Bucket[]).map((b) => ({ bucket: b, label: BUCKET_LABEL[b], count: n.get(b) ?? 0 })).filter((s) => s.count > 0);
  }, [items, failing]);

  const open_ = useCallback((key: string, title: string, subtitle: string, list: WfItem[]) => {
    if (!data) return;
    setMark(key);
    setPanel(itemsSpec({ key, title, subtitle, items: list, accounts, failing, labels, exportName: `workflows-${key}` }));
  }, [data, accounts, failing, labels]);
  const close = () => { setPanel(null); setMark(null); };
  useEffect(() => {
    // Ctrl or Cmd + Shift + K opens the palette on this page only (Ctrl K stays the people search).
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); setPalette((p) => !p); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  const saveView = async () => {
    if (!viewName.trim()) return;
    setSaving(true);
    try { await api.post("workflows/views", { name: viewName, filters: { show, tab, picked } }); setViewName(""); await views.reload(); setNote({ ok: true, text: "View saved." }); } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setSaving(false); }
  };
  const applyView = (v: { filters: { show: Show; tab: TabId; picked: string[] } }) => { setShow(v.filters.show ?? "workflow"); setTab(v.filters.tab ?? "overview"); setPicked(v.filters.picked ?? []); setSel(new Set()); };
  const markIt = async (locationId: string, workflowId: string, b: Record<string, unknown>) => {
    try { await api.post("workflows/mark", { locationId, workflowId, ...b }); await reload(); } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };

  const syncNow = async () => {
    setSyncing(true); setNote(null);
    try {
      const r = await api.post<{ accounts: Array<{ name: string; workflows: string; campaigns: string }> }>(`workflows/sync${q}`, {});
      const refused = r.accounts.filter((a) => a.workflows === "needs_permission").length;
      setNote(refused ? { ok: false, text: `Needs permission: reconnect. ${refused} client account${refused === 1 ? "" : "s"} did not allow SubSync to read workflows (workflows.readonly).` } : { ok: true, text: "Updated." });
      await reload();
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setSyncing(false); }
  };

  if (loading && !data) return <Page title="Workflows" subtitle="Your automations and campaigns, and how they are doing."><SkeletonCards cards={4} label="Loading workflows..." /></Page>;
  if (error) return <Page title="Workflows"><ErrorBox error={error} onRetry={reload} /></Page>;
  if (!data) return null;

  const staff = kind !== "client";
  const picks = items.filter((w) => sel.has(keyOf(w)));
  const needAttention = (data.slices.find((s) => s.bucket === "failing")?.count ?? 0);
  const total = items.length;
  const noList = !data.permissions.list;
  const headline = total === 0 ? "No workflows yet" : needAttention > 0 ? `${needAttention} need${needAttention === 1 ? "s" : ""} fixing` : "Nothing is failing";
  const actions = (
    <>
      <Btn onClick={() => window.print()} testId="wf-print"><span className="inline-flex items-center gap-1.5"><Printer aria-hidden className="size-4" />Print report</span></Btn>
      {data.can.sync ? <Btn variant="primary" onClick={syncNow} disabled={syncing} testId="wf-sync"><span className="inline-flex items-center gap-1.5"><RefreshCw aria-hidden className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Updating..." : "Update now"}</span></Btn> : null}
    </>
  );

  return (
    <Page title="Workflows" subtitle="Every automation and campaign in your client accounts, how healthy they are, and what to do next." actions={actions}>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <div role="group" aria-label="Show" className="inline-flex overflow-hidden rounded-lg border text-sm" data-testid="wf-show">
          {([["workflow", "Workflows"], ["campaign", "Campaigns"], ["both", "Both"]] as Array<[Show, string]>).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={show === id} onClick={() => { setShow(id); setSel(new Set()); }} data-testid={`wf-show-${id}`} className={`min-h-9 px-3 ${show === id ? "bg-accent font-semibold" : "hover:bg-accent/50"}`}>{label}</button>
          ))}
        </div>
        {kind === "agency" && accounts.length >= 2 ? <LocalAccountPicker accounts={accounts.map((a) => ({ id: a.locationId, name: a.name }))} picked={picked} onChange={(ids) => { setPicked(ids); setSel(new Set()); }} /> : null}
        {staff ? (
          <span className="flex flex-wrap items-center gap-2" data-testid="wf-views">
            {views.data?.views.length ? (
              <label className="text-sm"><span className="sr-only">Saved views</span>
                <select value="" onChange={(e) => { const v = views.data?.views.find((x) => x.name === e.target.value); if (v) applyView(v); }} data-testid="wf-view-pick" className="h-9 rounded-lg border bg-background px-2 text-sm"><option value="">Saved views</option>{views.data.views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select>
              </label>
            ) : null}
            {data.can.organise ? (
              <>
                <label className="text-sm"><span className="sr-only">Name this view</span><input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={40} placeholder="Name this view" data-testid="wf-view-name" className="h-9 w-36 rounded-lg border bg-background px-2 text-sm" /></label>
                <button type="button" onClick={saveView} disabled={saving || !viewName.trim()} data-testid="wf-view-save" className="min-h-9 rounded-lg border px-3 text-sm hover:bg-accent disabled:opacity-50">Save view</button>
              </>
            ) : null}
            <button type="button" onClick={() => setPalette(true)} data-testid="wf-palette-open" className="min-h-9 rounded-lg border px-3 text-sm text-muted-foreground hover:bg-accent" title="Ctrl Shift K">Search and commands</button>
          </span>
        ) : null}
        <span className="text-sm text-muted-foreground" data-testid="wf-updated">{data.syncedAt ? `Last read ${when(data.syncedAt, data.now).toLowerCase()}` : "Not read yet"}</span>
      </div>
      {data.since && data.since.changes > 0 ? <InlineAlert tone="info" className="mb-4"><span data-testid="wf-since">Since your last visit ({when(data.since.at, data.now).toLowerCase()}): {data.since.changes} change{data.since.changes === 1 ? "" : "s"} to your workflows and campaigns.</span> <button type="button" className="font-medium text-primary hover:underline" onClick={() => setTab("history")}>See them</button></InlineAlert> : null}
      {note ? <InlineAlert tone={note.ok ? "success" : "warning"} onDismiss={() => setNote(null)} className="mb-4">{note.text}</InlineAlert> : null}
      {noList ? <InlineAlert tone="warning" title="Needs permission: reconnect" className="mb-4">SubSync needs <code>workflows.readonly</code> to list workflows, and <code>workflows.logs</code> to see which ones fail or never run. Open SubSync again from your CRM&apos;s app list and accept it. Campaigns need <code>campaigns.readonly</code>.</InlineAlert> : null}
      {!data.available ? <InlineAlert tone="info" title="Needs the latest database update" className="mb-4">Ask the person who manages SubSync to apply the newest update. Until then this page stays empty.</InlineAlert> : null}
      {!data.permissions.history && !noList ? <InlineAlert tone="info" title="Needs permission: reconnect" className="mb-4">Allow <code>workflows.logs</code> to see failing and idle workflows. Until then those checks are not shown, and nothing is guessed.</InlineAlert> : null}
      <Tabs tabs={[{ id: "overview", label: "Overview" }, { id: "list", label: `List (${total})` }, { id: "health", label: `Health${data.findings.length ? ` (${data.findings.length})` : ""}` }, { id: "tidy", label: "Tidy up" }, { id: "delivery", label: "Campaign delivery" }, { id: "proof", label: "Proof" }, { id: "history", label: "History" }, ...(data.wf?.gaps ? [{ id: "gaps" as const, label: "Gaps" }] : []), ...(data.wf?.library && data.can.change ? [{ id: "library" as const, label: "Library" }] : [])]} value={tab} onChange={(t) => { setTab(t); setSel(new Set()); }} />

      {tab === "overview" ? (
        total === 0 ? (
          <EmptyState title={noList ? "SubSync cannot read workflows yet" : "No workflows found yet"} body={noList ? "Allow the workflow permission, then press Update now." : data.can.sync ? "Press Update now to read them from your client accounts." : "Your team has not updated this page yet."} />
        ) : (
          <div data-testid="wf-overview">
            <p className="mb-4 text-sm text-muted-foreground" data-testid="wf-own-window">The step counts here are the platform&apos;s own last 30 days, so the dates in the bar do not change them. The dates set the Proof tab.</p>
            <section className="mb-8" aria-label="What to do next" data-testid="wf-next">
              <h2 className="text-base font-semibold">{headline}</h2>
              {data.nextSteps.length ? <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{data.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol> : <p className="mt-1 text-sm text-muted-foreground">Nothing needs you right now. SubSync keeps checking.</p>}
              {data.findings.length ? <button type="button" onClick={() => setTab("health")} className="mt-2 min-h-9 text-sm font-medium text-primary hover:underline" data-testid="wf-see-health">See all {data.findings.length} checks</button> : null}
            </section>
            <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              <WfNumber label="In total" value={total} onClick={() => open_("all", "Everything", "Every item in the list.", items)} testId="wf-n-total" />
              <WfNumber label="Failing" value={slices.find((s) => s.bucket === "failing")?.count ?? 0} tone="bad" onClick={() => open_("failing", "Failing", "Steps are failing in the last 30 days.", inBucket(items, failing, "failing"))} testId="wf-n-failing" />
              <WfNumber label="Never ran (30 days)" value={slices.find((s) => s.bucket === "never_run")?.count ?? 0} tone="warn" hint="Estimate" onClick={() => open_("never_run", "Never ran in 30 days", "Published, but nothing ran. This is an estimate: a rare trigger can be quiet on purpose.", inBucket(items, failing, "never_run"))} testId="wf-n-never" />
              <WfNumber label="Drafts" value={slices.find((s) => s.bucket === "draft")?.count ?? 0} onClick={() => open_("draft", "Drafts", "Not published, so they do nothing.", inBucket(items, failing, "draft"))} testId="wf-n-draft" />
            </div>
            <div className="mb-8 grid gap-x-10 gap-y-8 lg:grid-cols-2">
              <WfDonut title="What state are they in?" marks={slices.map((s): Mark => ({ key: s.bucket, label: s.label, count: s.count, colour: COLOUR[s.bucket] }))} selected={mark}
                onSelect={(k) => open_(k, BUCKET_LABEL[k as Bucket], "The items in this state.", inBucket(items, failing, k as Bucket))} centre="items" />
              <WfBars columns title="Which client accounts need a look?" rows={data.bars.map((b) => ({ key: b.locationId, label: b.name, value: b.total, flag: b.attention }))} selected={mark}
                onSelect={(k) => open_(k, accounts.find((a) => a.locationId === k)?.name ?? "Client account", "Everything in this client account. The red part is failing or never ran.", inAccount(items, k))} />
              <WfTrend title="How many were failing, day by day" points={data.daily.failing} unit=" failing" colour="var(--destructive)" onPoint={(day) => open_(`day-${day}`, `Failing today`, `SubSync's own record shows ${data.daily.failing.find((p) => p.day === day)?.value ?? 0} failing on ${day}. The list below is the failing ones now.`, inBucket(items, failing, "failing"))} />
              <WfTrend title="Steps run in the last 30 days, as counted each day" points={data.daily.runs} colour="var(--chart-1)" onPoint={(day) => open_(`runs-${day}`, "Items that ran", `Counted on ${day}. Showing items with runs now.`, items.filter((w) => (w.runs30d ?? 0) > 0))} />
              <WfBars title="Which fail most?" colour="var(--destructive)" rows={data.top.filter((t) => items.some((w) => w.workflowId === t.workflowId && w.locationId === t.locationId)).map((t) => ({ key: `${t.locationId}|${t.workflowId}`, label: `${t.name} (${accounts.find((a) => a.locationId === t.locationId)?.name ?? ""})`, value: t.failed ?? 0 }))} selected={mark}
                onSelect={(k) => open_(`top-${k}`, "Failing steps", "The one you pressed.", items.filter((w) => keyOf(w) === k))} empty="Nothing is failing." />
              {staff && data.can.health ? (
                <WfDonut title="Your decisions" marks={data.decisions.map((d): Mark => ({ key: d.decision, label: DEC_LABEL[d.decision], count: d.count, colour: DEC_COLOUR[d.decision] }))} selected={mark} centre="sorted by you"
                  onSelect={(k) => open_(`dec-${k}`, DEC_LABEL[k as Decision], "What you decided about these.", inDecision(items, labels, k as Decision))} empty="Open an item in the list to mark it Keep, Review or Retire." />
              ) : null}
              {staff && data.can.health ? (
                <WfBars title="Your ratings" colour="var(--chart-2)" rows={data.ratings.filter((r) => r.count > 0).map((r) => ({ key: `r${r.rating}`, label: r.label, value: r.count }))} selected={mark}
                  onSelect={(k) => open_(`rate-${k}`, "Rated items", "Items with this rating.", inRating(items, labels, Number(k.slice(1))))} empty="Rate an item from the list to see this." />
              ) : null}
            </div>
            {staff && !data.can.health ? <InlineAlert tone="info" title="More with the paid plan" className="mb-6">Health alerts, labels, ratings and decisions are part of the paid plan.</InlineAlert> : null}
          </div>
        )
      ) : null}

      {tab === "list" ? (
        <Section title="Everything" hint={staff ? "Pick rows to rename, publish, pause, copy or delete them. Press a name to organise it." : "Press a name to see more."}>
          {sel.size > 0 && staff ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-accent/30 px-3 py-2" role="toolbar" aria-label="Actions for the picked items" data-testid="wf-actions">
              <span className="mr-1 text-sm font-medium" data-testid="wf-picked">{sel.size} picked</span>
              {data.can.change ? (["rename", "publish", "unpublish", "clone", "delete"] as ChangeKind[]).map((k) => (
                <Btn key={k} variant={k === "delete" ? "ghost" : "secondary"} onClick={() => setDialog(k)} testId={`wf-do-${k}`} disabled={picks.some((w) => entityOf(w.workflowId) === "campaign")}>{{ rename: "Rename", publish: "Publish", unpublish: "Pause", clone: "Copy", delete: "Delete" }[k]}</Btn>
              )) : <span className="text-sm text-muted-foreground">{data.needs.upgradeChange ? "Changing workflows is part of the paid plan." : "Changing workflows is for administrators."}</span>}
              <Btn variant="ghost" onClick={() => setSel(new Set())} testId="wf-clear">Clear</Btn>
            </div>
          ) : null}
          {total === 0 ? <EmptyState title="Nothing here yet" body={noList ? "Allow the workflow permission first." : "Press Update now to read your client accounts."} /> : (
            <WfTable items={items} accounts={accounts} labels={data.labels} failing={failing} now={data.now} selected={sel} canSelect={staff && (data.can.change || data.can.organise)}
              onToggle={(k) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
              onToggleAll={(keys, on) => setSel((s) => { const n = new Set(s); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; })} onOpen={setOpen} />
          )}
        </Section>
      ) : null}

      {tab === "health" ? (
        <div data-testid="wf-health">
          {!data.can.health ? <InlineAlert tone="info" title="Part of the paid plan">The checks and alerts below are part of the paid plan. The free plan shows the list.</InlineAlert> : (
            <>
              <Section title="Things to check" hint="Each one says why and what to do. Items marked estimate are found by name or from quiet history, so treat them as a prompt, not a fact.">
                {data.findings.filter((f) => show === "both" || (f.workflowId ? entityOf(f.workflowId) === show : show === "workflow")).length === 0 ? <EmptyState compact title="Nothing to check" body="No failing, idle or stuck items were found." /> : (
                  <ul className="divide-y rounded-xl border" data-testid="wf-findings">
                    {data.findings.filter((f) => show === "both" || (f.workflowId ? entityOf(f.workflowId) === show : show === "workflow")).map((f) => (
                      <li key={f.key} className="grid gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[6rem_1fr_auto]" data-testid="wf-finding">
                        <span><span className={`inline-block border-l-2 pl-2 text-xs font-semibold uppercase ${f.severity === "critical" ? "border-destructive text-destructive" : f.severity === "warning" ? "border-warning text-warning" : "border-muted-foreground text-muted-foreground"}`}>{f.severity === "critical" ? "Fix now" : f.severity === "warning" ? "Check" : "Tidy"}</span></span>
                        <span className="min-w-0"><span className="block font-medium">{f.title}{f.estimate ? " (estimate)" : ""}</span><span className="block text-muted-foreground">{f.why}</span><span className="block">{f.next}</span><span className="block text-xs text-muted-foreground">{accounts.find((a) => a.locationId === f.locationId)?.name}</span></span>
                        <span className="flex flex-wrap items-start gap-x-3 self-start">
                          {f.workflowId ? <button type="button" className="min-h-9 text-sm font-medium text-primary hover:underline" data-testid="wf-finding-open" onClick={() => { const w = items.find((x) => x.workflowId === f.workflowId && x.locationId === f.locationId); if (w) setOpen(w); }}>Details</button> : null}
                          {data.can.organise ? <><button type="button" className="min-h-9 text-sm hover:underline" data-testid="wf-fixed" onClick={() => markIt(f.locationId, f.workflowId ?? "coverage", { action: "fixed" })}>Mark fixed</button>
                            <button type="button" className="min-h-9 text-sm hover:underline" data-testid="wf-snooze" onClick={() => markIt(f.locationId, f.workflowId ?? "coverage", { action: "snooze", choice: "week" })}>Snooze a week</button></> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              {data.muted.length ? (
                <Section title="Set aside" hint="Marked fixed or snoozed. They come back by themselves if the problem is still there.">
                  <ul className="divide-y rounded-xl border text-sm" data-testid="wf-muted">{data.muted.map((m) => <li key={m.key} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2"><span className="min-w-0 truncate">{m.title} <span className="text-muted-foreground">({m.why === "fixed" ? "marked fixed" : "snoozed"}, until {new Date(m.until).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})</span></span>
                    {data.can.organise ? <button type="button" className="min-h-8 text-sm font-medium text-primary hover:underline" data-testid="wf-reopen" onClick={() => markIt(m.locationId, m.workflowId ?? "coverage", { action: "reopen" })}>Bring back</button> : null}</li>)}</ul>
                </Section>
              ) : null}
              {show !== "campaign" ? (
                <Section title="Do the basics exist?" hint="Found by workflow names only, so this is an estimate. A workflow with an unusual name is not recognised.">
                  {data.coverage.length === 0 ? <p className="text-sm text-muted-foreground">Update the list first.</p> : (
                    <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[40rem] text-sm" data-testid="wf-coverage"><thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Client account</th>{data.standard.map((s) => <th key={s} className="px-3 py-2 font-medium">{s}</th>)}</tr></thead>
                      <tbody>{data.coverage.map((c) => <tr key={c.locationId} className="border-b last:border-b-0"><td className="px-3 py-2 font-medium">{accounts.find((a) => a.locationId === c.locationId)?.name}</td>{data.standard.map((s) => <td key={s} className="px-3 py-2">{c.have.includes(s) ? <span className="text-success">Looks covered</span> : <span className="text-warning">Not found</span>}</td>)}</tr>)}</tbody></table></div>
                  )}
                </Section>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === "tidy" ? (data.tidy ? <TidyTab tidy={data.tidy} items={items} accounts={accounts} canChange={data.can.change}
        onFix={(rule, list) => { setPreset(rule); setFixItems(list); setDialog("rename"); }} onShow={(key, title, sub, list) => open_(key, title, sub, list)} /> : <EmptyState title="Not available in this view" body="Tidying is for administrators." />) : null}
      {tab === "delivery" ? <DeliveryTab q={q} now={data.now} /> : null}
      {tab === "proof" ? <ProofTab q={q} /> : null}
      {tab === "gaps" ? <GapsTab q={q} onLibrary={() => setTab("library")} /> : null}
      {tab === "library" ? <LibraryTab q={q} accounts={accounts} onDone={reload} /> : null}

      {tab === "history" ? (
        <Section title="What changed" hint="What SubSync did, and what it noticed changed in your CRM between two updates.">
          {history.loading && !history.data ? <SkeletonCards cards={2} label="Loading history..." /> : history.error ? <ErrorBox error={history.error} onRetry={history.reload} /> : !history.data || history.data.rows.length === 0 ? <EmptyState compact title="Nothing yet" body="Changes appear here after the second update, or after you change something." /> : (
            <div className="overflow-x-auto rounded-xl border"><div className="min-w-[48rem]" data-testid="wf-history">
              {history.data.rows.filter((r) => show === "both" || (show === "campaign") === (r.type === "Campaign")).map((r) => (
                <div key={r.id} className="grid grid-cols-[7.5rem_minmax(10rem,1.3fr)_minmax(10rem,1.6fr)_9rem_6rem] items-center gap-x-3 border-b px-3 py-2 text-sm last:border-b-0" data-testid="wf-history-row">
                  <span className="text-muted-foreground">{when(r.at, data.now)}</span>
                  <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-xs text-muted-foreground">{r.account} · {r.type}</span></span>
                  <span className="min-w-0 truncate">{r.what}{r.outcome === "dry_run" ? " (rehearsal)" : r.outcome === "started" ? " (unfinished)" : r.outcome !== "done" ? ` (${r.outcome})` : ""}{r.undone ? " · undone" : ""}</span>
                  <span className="truncate text-muted-foreground">{r.who}</span>
                  <span>{r.undoable && data.can.change ? <UndoButton id={r.id} onDone={() => { history.reload(); reload(); }} /> : null}</span>
                </div>
              ))}
            </div></div>
          )}
        </Section>
      ) : null}

      {palette ? <WfPalette onClose={() => setPalette(false)}
        commands={[
          ...([["overview", "Overview"], ["list", "List"], ["health", "Health"], ["tidy", "Tidy up"], ["delivery", "Campaign delivery"], ["proof", "Proof"], ["history", "History"]] as Array<[TabId, string]>).map(([id, label]): Command => ({ id: `go-${id}`, group: "Go to", label, run: () => setTab(id) })),
          ...([["workflow", "Show workflows"], ["campaign", "Show campaigns"], ["both", "Show both"]] as Array<[Show, string]>).map(([id, label]): Command => ({ id: `show-${id}`, group: "Do", label, run: () => setShow(id) })),
          ...(data.can.sync ? [{ id: "sync", group: "Do" as const, label: "Update now", run: () => { void syncNow(); } }] : []),
          { id: "print", group: "Do", label: "Print report", run: () => window.print() },
          ...(views.data?.views ?? []).map((v): Command => ({ id: `view-${v.name}`, group: "Saved views", label: v.name, run: () => applyView(v) })),
        ]}
        items={items.map((w): Command => ({ id: keyOf(w), group: "Items", label: w.name, hint: accounts.find((a) => a.locationId === w.locationId)?.name, run: () => setOpen(w) }))} /> : null}
      {panel ? <RecordsPanel spec={panel} onClose={close} now={data.now} canExport={staff} /> : null}
      {open ? <ItemPanel item={open} account={accounts.find((a) => a.locationId === open.locationId)?.name ?? "Client account"} label={data.labels[keyOf(open)]} bucket={bucketOf(open, failing)} now={data.now} canOrganise={data.can.organise} onClose={() => setOpen(null)} onSaved={reload} /> : null}
      {dialog ? <ChangeDialog kind={dialog} items={dialog === "rename" && fixItems ? fixItems : picks} accounts={accounts} preset={dialog === "rename" ? preset : undefined} permitted={dialog === "rename" || dialog === "clone" ? data.permissions.rename : dialog === "delete" ? data.permissions.delete : data.permissions.publish}
        onClose={() => { setDialog(null); setPreset(undefined); setFixItems(null); }} onChanged={() => { setSel(new Set()); reload(); }} /> : null}

      <article className="hidden print:block" data-testid="wf-print-area" aria-hidden>
        <h1 className="text-xl font-bold">Workflows report</h1>
        <p className="text-sm">{new Date(data.now).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
        <ul className="mt-3 list-disc pl-5 text-sm">{reportLines(slices, data.findings, accounts.length).map((l) => <li key={l}>{l}</li>)}</ul>
        <table className="mt-4 w-full text-xs"><thead><tr className="text-left"><th>Name</th><th>Client account</th><th>State</th><th>Errors</th></tr></thead><tbody>
          {items.filter((w) => bucketOf(w, failing) === "failing" || bucketOf(w, failing) === "never_run").slice(0, 40).map((w) => <tr key={keyOf(w)}><td>{w.name}</td><td>{accounts.find((a) => a.locationId === w.locationId)?.name}</td><td>{BUCKET_LABEL[bucketOf(w, failing)]}</td><td>{w.failed30d ?? ""}</td></tr>)}
        </tbody></table>
      </article>
      <span className="hidden">{decisionOf(undefined)}<StateBadge bucket="running" /></span>
    </Page>
  );
}

function UndoButton({ id, onDone }: { id: number; onDone: () => void }) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span>
      <button type="button" disabled={busy} data-testid="wf-undo" className="min-h-8 text-sm font-medium text-primary hover:underline disabled:opacity-50" onClick={async () => {
        setBusy(true); setMsg(null);
        try { const r = await api.post<{ message: string }>("workflows/undo", { changeId: id }); setMsg(r.message); onDone(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "Undoing..." : "Undo"}</button>
      {msg ? <span className="sr-only" role="status">{msg}</span> : null}
    </span>
  );
}
