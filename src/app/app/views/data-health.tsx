"use client";

import { Printer, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { RecordsSpec } from "@/lib/analytics/today-records";
import { EmptyState, InlineAlert, LocalAccountPicker, Page, RecordsPanel, Section, SkeletonCards } from "../ds";
import { WfNumber, WfTrend } from "../ds/workflow-charts";
import { useApiClient, useData } from "../session";
import { Btn, ErrorBox } from "../ui";
import { Tabs } from "./workflows-parts";
import { FixTab, ImportsTab, ProofTab, QueueTab, RulesTab } from "./data-health-parts";
import type { GoFn } from "../nav";
import type { AccessKind } from "@/lib/access";

// Data health: a 0 to 100 score per client account, why, how it moved, and the records behind every number. Docs: docs/features/DATA_HEALTH.md.
// Every number opens the same records panel as Today. The account choice belongs to this page only (like Today and Workflows).

export type Comp = { id: string; label: string; plain: string; count: number; penalty: number; weight: number };
export type Acct = { locationId: string; name: string; score: number | null; total: number; day: string | null; weekAgo: number | null; bucket: string | null; components: Comp[]; series: Array<{ day: string; score: number | null }> };
export type DhData = {
  kind: AccessKind; demo: boolean; now: number; today: string;
  can: { rules: boolean; mark: boolean; fix: boolean; pro: boolean; league: boolean }; needs: { upgradePro: boolean; upgradeFix: boolean };
  permissions: { fix: boolean; writeLive: boolean; scope: string };
  accounts: Acct[]; league: Array<{ locationId: string; name: string; score: number | null; weekAgo: number | null; total: number }>; average: number | null;
  since: { since: string; first: number; now: number; found: number; fixed: number } | null;
  outcomes: { raised: number; fixed: number; avgHoursToFix: number | null };
  benchmark: { line: string | null; bucket: string | null; optedOut: boolean; shown: boolean } | null;
  settings: { junkWords: string[]; staleDays: number; phoneRegion: string; spikeMin: number; optOut: boolean };
  weights: Array<{ id: string; label: string; plain: string; weight: number }>;
};
type TabId = "overview" | "imports" | "queue" | "fix" | "rules" | "proof";
const TONE = (s: number | null) => (s === null ? "text-muted-foreground" : s >= 85 ? "text-success" : s >= 65 ? "text-warning" : "text-destructive");

export function DataHealthView({ go, kind }: { go: GoFn; kind: AccessKind }) {
  void go;
  const api = useApiClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [tab, setTab] = useState<TabId>("overview");
  const q = picked.length ? `?wa=${picked.join(",")}` : "";
  const { data, error, loading, reload } = useData<DhData>(`data-health${q}`);
  const [panel, setPanel] = useState<RecordsSpec | null>(null);
  const [mark, setMark] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const openRecords = async (loc: string, rule: string | null, when: string | null = null, extra = "") => {
    setMark(`${loc}|${rule ?? "all"}|${when ?? "now"}${extra}`);
    try {
      const r = await api.get<{ spec: RecordsSpec }>(`data-health/records?loc=${encodeURIComponent(loc)}${rule ? `&rule=${rule}` : ""}${when ? `&day=${when}` : ""}${extra}`);
      setPanel(r.spec);
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const close = () => { setPanel(null); setMark(null); };
  const refresh = async (loc: string) => {
    setBusy(true); setNote(null);
    try { await api.post("data-health/refresh", { locationId: loc }); await reload(); setNote({ ok: true, text: "Updated." }); } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (loading && !data) return <Page title="Data health" subtitle="How clean the contacts in each client account are."><SkeletonCards cards={4} label="Scoring your contacts..." /></Page>;
  if (error) return <Page title="Data health"><ErrorBox error={error} onRetry={reload} /></Page>;
  if (!data) return null;

  const staff = kind !== "client";
  const one = data.accounts.length === 1 ? data.accounts[0] : null;
  const pickable = data.accounts.map((a) => ({ id: a.locationId, name: a.name }));
  const target = one ?? (picked.length === 1 ? data.accounts.find((a) => a.locationId === picked[0]) ?? null : null);
  const sel = day !== null && one ? one.series.filter((s) => s.score !== null)[day] ?? null : null;
  const actions = (
    <>
      <Btn onClick={() => window.print()} testId="dh-print"><span className="inline-flex items-center gap-1.5"><Printer aria-hidden className="size-4" />Print</span></Btn>
      {one && staff ? <Btn variant="primary" onClick={() => refresh(one.locationId)} disabled={busy} testId="dh-refresh"><span className="inline-flex items-center gap-1.5"><RefreshCw aria-hidden className={`size-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Updating..." : "Update now"}</span></Btn> : null}
    </>
  );
  const tabs: Array<{ id: TabId; label: string }> = [{ id: "overview", label: "Overview" }, ...(staff ? [{ id: "imports" as TabId, label: "Imports" }, { id: "queue" as TabId, label: "Finders" }, { id: "fix" as TabId, label: "Fix" }, { id: "rules" as TabId, label: "Rules" }] : []), { id: "proof", label: "Proof" }];

  return (
    <Page title="Data health" subtitle="A score out of 100 for the contacts in each client account, why it is what it is, and the records behind every number." actions={actions}>
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        {kind === "agency" && pickable.length >= 2 ? <LocalAccountPicker accounts={pickable} picked={picked} onChange={(ids) => { setPicked(ids); setDay(null); }} /> : null}
        {kind === "agency" && pickable.length === 1 && data.needs.upgradePro ? <span className="text-sm text-muted-foreground" data-testid="dh-free-one">The free plan shows one client account.</span> : null}
      </div>
      {note ? <InlineAlert tone={note.ok ? "success" : "warning"} onDismiss={() => setNote(null)} className="mb-4">{note.text}</InlineAlert> : null}
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); close(); }} />

      {tab === "overview" ? (
        data.accounts.length === 0 ? <EmptyState title="No client accounts yet" body="Once a client account is connected and its contacts are read, its score appears here." /> : (
          <div data-testid="dh-overview">
            {one ? (
              <section className="mb-8" aria-label="Score" data-testid="dh-score">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <p className={`text-6xl font-semibold tabular-nums ${TONE((sel?.score ?? one.score))}`} data-testid="dh-score-number">{sel?.score ?? one.score ?? "Not enough data"}</p>
                  <div className="min-w-0 flex-1"><p className="text-sm" data-testid="dh-why">{day === null ? whyOf(one) : `On ${sel?.day}.`}</p>
                    <p className="text-xs text-muted-foreground">{one.total} contacts. Each problem takes points off according to what share of your contacts has it. Open a number to see the records.</p></div>
                </div>
                {data.since ? <p className="mt-3 text-sm" data-testid="dh-since"><strong>Your record since you installed ({data.since.since}):</strong> {data.since.found} problems found, {data.since.fixed} fixed, score {data.since.first} to {data.since.now}.</p> : null}
                {data.benchmark?.line ? <p className="mt-1 text-sm text-muted-foreground" data-testid="dh-benchmark">{data.benchmark.line}</p> : data.benchmark ? <p className="mt-1 text-xs text-muted-foreground" data-testid="dh-benchmark-none">{data.benchmark.optedOut ? "You chose not to take part in anonymous comparisons." : "Comparisons appear once at least 10 similar accounts from at least 3 companies take part."}</p> : null}
              </section>
            ) : (
              <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
                <WfNumber label="Average score" value={data.average ?? "Not enough data"} tone={data.average === null ? "neutral" : data.average >= 85 ? "good" : data.average >= 65 ? "warn" : "bad"} testId="dh-n-average" />
                <WfNumber label="Client accounts" value={data.accounts.length} testId="dh-n-accounts" />
                <WfNumber label="Problems found since install" value={data.since?.found ?? 0} testId="dh-n-found" />
                <WfNumber label="Fixed since install" value={data.since?.fixed ?? 0} tone="good" testId="dh-n-fixed" />
              </section>
            )}
            {one ? (
              <>
                <Section title="Time slider" hint="Move it to see the score on a past day. Press the button to see that day's records.">
                  <div className="flex flex-wrap items-center gap-3 print:hidden">
                    <input type="range" aria-label="Day" min={0} max={Math.max(0, one.series.filter((s) => s.score !== null).length - 1)} value={day ?? Math.max(0, one.series.filter((s) => s.score !== null).length - 1)} onChange={(e) => setDay(Number(e.target.value))} data-testid="dh-slider" className="w-64 max-w-full" />
                    <span className="text-sm tabular-nums" data-testid="dh-slider-day">{sel ? `${sel.day}: ${sel.score}` : "Today"}</span>
                    <Btn onClick={() => openRecords(one.locationId, null, sel?.day ?? null)} testId="dh-slider-open">Records of that day</Btn>
                  </div>
                </Section>
                <div className="mb-8 max-w-xl"><WfTrend title="Score, day by day" points={one.series.map((s) => ({ day: s.day, value: s.score }))} colour="var(--chart-1)" onPoint={(d) => openRecords(one.locationId, null, d)} need={2} /></div>
                <Section title="What counts against the score" hint="Fewest problems first is best. Each number opens its records.">
                  <div role="table" aria-label="Problems" className="text-sm" data-testid="dh-components">
                    <div role="row" className="grid grid-cols-[minmax(0,2fr)_6rem_6rem_minmax(0,3fr)] gap-3 border-b py-2 text-xs font-semibold text-muted-foreground"><span role="columnheader">Problem</span><span role="columnheader" className="text-right">Records</span><span role="columnheader" className="text-right">Points lost</span><span role="columnheader">What it means</span></div>
                    {[...one.components].sort((a, b) => b.penalty - a.penalty || b.count - a.count).map((c) => (
                      <div role="row" key={c.id} className="grid grid-cols-[minmax(0,2fr)_6rem_6rem_minmax(0,3fr)] items-center gap-3 border-b py-2">
                        <span role="cell" className="font-medium">{c.label}</span>
                        <span role="cell" className="text-right">{c.count > 0 ? <button type="button" onClick={() => openRecords(one.locationId, c.id, sel?.day ?? null)} data-testid={`dh-c-${c.id}`} className="min-h-9 font-semibold tabular-nums text-primary hover:underline">{c.count}</button> : <span className="tabular-nums" data-testid={`dh-c-${c.id}`}>0</span>}</span>
                        <span role="cell" className="text-right tabular-nums">{c.penalty}</span>
                        <span role="cell" className="text-muted-foreground">{c.plain}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            ) : (
              <Section title="League table" hint="Every client account, best score first. Press an account to open it.">
                <div role="table" aria-label="Accounts" className="text-sm" data-testid="dh-league">
                  <div role="row" className="grid grid-cols-[minmax(0,3fr)_6rem_7rem_6rem] gap-3 border-b py-2 text-xs font-semibold text-muted-foreground"><span role="columnheader">Client account</span><span role="columnheader" className="text-right">Score</span><span role="columnheader" className="text-right">A week ago</span><span role="columnheader" className="text-right">Contacts</span></div>
                  {data.league.map((r) => (
                    <div role="row" key={r.locationId} className="grid grid-cols-[minmax(0,3fr)_6rem_7rem_6rem] items-center gap-3 border-b py-2" data-testid="dh-league-row">
                      <span role="cell"><button type="button" onClick={() => { setPicked([r.locationId]); setDay(null); }} className="min-h-9 text-left font-medium hover:underline" data-testid="dh-open-account">{r.name}</button></span>
                      <span role="cell" className={`text-right font-semibold tabular-nums ${TONE(r.score)}`}>{r.score ?? "Not enough data"}</span>
                      <span role="cell" className="text-right tabular-nums text-muted-foreground">{r.weekAgo ?? "None yet"}</span>
                      <span role="cell" className="text-right tabular-nums">{r.total}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {data.needs.upgradePro && staff ? <InlineAlert tone="info" title="More with the paid plan" className="mt-6">All your client accounts, quality alerts when an import goes wrong, the weekly digest, the finder lists and safe fixes are part of the paid plan.</InlineAlert> : null}
          </div>
        )
      ) : null}
      {tab === "imports" ? <ImportsTab data={data} target={target} openRecords={openRecords} /> : null}
      {tab === "queue" ? <QueueTab data={data} target={target} openRecords={openRecords} reload={reload} /> : null}
      {tab === "fix" ? <FixTab data={data} target={target} reload={reload} /> : null}
      {tab === "rules" ? <RulesTab data={data} target={target} reload={reload} /> : null}
      {tab === "proof" ? <ProofTab data={data} target={target} /> : null}
      {panel ? <RecordsPanel spec={panel} onClose={close} now={data.now} /> : null}
      <span hidden data-testid="dh-mark">{mark}</span>
    </Page>
  );
}

function whyOf(a: Acct): string {
  if (a.score === null) return `Not enough data yet: this account has ${a.total} contacts and a score needs at least 50.`;
  const top = [...a.components].filter((c) => c.penalty > 0).sort((x, y) => y.penalty - x.penalty).slice(0, 2);
  return top.length ? `${a.score} out of 100. Most points were lost to ${top.map((c) => `${c.label.toLowerCase()} (${c.count})`).join(" and ")}.` : `${a.score} out of 100. Nothing to fix right now.`;
}
