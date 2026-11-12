"use client";

import { useState } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { InfoTip } from "../../ds/info-tip";
import { useApiClient } from "../../session";
import { fmtInt, timeAgo } from "../../ui";
import { ScoreRing } from "../cleanup-parts";
import { sampleOn, SAMPLE, useDq, type Opts, type Overview } from "./dq-data";
import type { LeadsPick } from "./dq-leads";
import { SortingGate, type GatePick } from "./sorting-gate";

// OVERVIEW: one headline, four big numbers, the sorting gate (where leads go), the quality score with its four parts, and the accounts that need cleaning first. Numbers first, words last.

export type Go = (tab: "duplicates" | "fix" | "intake" | "history", account?: string | null) => void;
const Q_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-primary";

function Tile({ n, label, onClick, testId, tip }: { n: number | string; label: string; onClick?: () => void; testId: string; tip?: string }) {
  const body = (<><span className="block text-3xl font-semibold tabular-nums leading-tight">{typeof n === "number" ? fmtInt(n) : n}</span><span className="block text-xs text-muted-foreground">{label}</span></>);
  return (
    <div className="rounded-xl border bg-card p-3" data-testid={testId}>
      {onClick ? <button type="button" onClick={onClick} className="ds-press block min-h-12 w-full text-left hover:opacity-80 focus-visible:outline-2 focus-visible:outline-primary">{body}</button> : body}
      {tip && <span className="mt-1 inline-block"><InfoTip text={tip} label={`About ${label}`} /></span>}
    </div>
  );
}

function Trend({ pts }: { pts: Array<{ day: string; score: number | null }> }) {
  const p = pts.filter((x) => x.score !== null) as Array<{ day: string; score: number }>;
  if (p.length < 2) return <p className="text-xs text-muted-foreground" data-testid="dq-trend-empty">The trend starts after two daily scores. SubSync keeps this record from now on.</p>;
  const w = 280, h = 56, lo = Math.min(...p.map((x) => x.score)) - 4, hi = Math.max(...p.map((x) => x.score)) + 4;
  const d = p.map((x, i) => `${i ? "L" : "M"}${((i / (p.length - 1)) * w).toFixed(1)},${(h - ((x.score - lo) / (hi - lo || 1)) * h).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full max-w-xs text-primary" role="img" aria-label={`Quality score from ${p[0].score} to ${p[p.length - 1].score} over ${p.length} days`}><path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function OverviewTab({ opts, account, go, pick }: { opts: Opts; account: string | null; go: Go; pick: (p: LeadsPick) => void }) {
  const api = useApiClient();
  const d = useDq<Overview>(`dq/overview${account ? `?account=${account}` : ""}`, () => SAMPLE.overview);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  if (d.loading && !d.data) return <SkeletonRows rows={6} label="Loading Clean-up..." />;
  if (d.error) return <ErrorState error={d.error} onRetry={d.reload} />;
  const o = d.data;
  if (!o) return null;
  const scan = async () => { setBusy(true); setMsg(null); try { const r = await api.post<{ scanned: number; pending: number }>("dq/scan", {}); setMsg(`Scanned ${r.scanned} account${r.scanned === 1 ? "" : "s"}${r.pending ? `, ${r.pending} left for the next run` : ""}.`); d.reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const onGate = (g: GatePick) => pick({ title: g.title, sub: "Last 30 days", query: `${g.src ? `src=${encodeURIComponent(g.src)}&` : ""}flag=${g.flag}&range=30${account ? `&account=${account}` : ""}` });
  const empty = o.accounts === null;
  return (
    <div className="space-y-6" data-testid="dq-overview">
      {sampleOn() && <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground" role="status" data-testid="dq-sample">Sample data: these are not your real contacts.</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 basis-80 text-lg font-medium" data-testid="dq-headline">{o.headline ?? "The first scan has not run yet."} {o.headline && <InfoTip text={`${o.formula}`} label="How this is worked out" />}</p>
        <div className="flex items-center gap-2">
          {o.asOf && <span className="text-xs text-muted-foreground">Updated {timeAgo(o.asOf)}</span>}
          {opts.canChange && !sampleOn() && <button type="button" className={Q_BTN} disabled={busy} onClick={() => void scan()} data-testid="dq-scan">{busy ? "Scanning..." : "Scan now"}</button>}
        </div>
      </div>
      {msg && <p className="text-sm text-muted-foreground" role="status">{msg}</p>}
      {empty && <EmptyState title="Nothing scanned yet" body="Press Scan now, or wait for tonight. The first scan finds duplicates, bad numbers and where your leads come from." />}

      {!empty && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile n={o.numbers.groups} label="duplicate groups" onClick={() => go("duplicates")} testId="dq-tile-groups" tip="Groups of records that look like one person. Certain, likely and possible are shown on the Duplicates tab." />
          <Tile n={o.numbers.badPhones} label="bad numbers" onClick={() => go("fix")} testId="dq-tile-phones" tip="Phone numbers too short or too long to work. They waste dial attempts." />
          <Tile n={o.numbers.junk} label="junk contacts" onClick={() => go("fix")} testId="dq-tile-junk" tip="Names or emails like test, asdf or example.com." />
          {o.quality && <Tile n={o.quality.score ?? "n/a"} label={o.quality.word ? `quality · ${o.quality.word.toLowerCase()}` : "quality score"} testId="dq-tile-score" tip={o.quality.why} />}
        </div>
      )}

      {o.gate && (
        <section aria-label="Where do my leads go?" data-testid="dq-gate-section">
          <h3 className="mb-2 text-base font-semibold">Where do my leads go?</h3>
          <div className="rounded-xl border bg-card p-3"><SortingGate lanes={o.gate.lanes} groups={o.gate.groups} days={o.gate.days} onPick={onGate} /></div>
          {o.best && <p className="mt-2 text-sm" data-testid="dq-bestworst">{o.best.line || <span className="text-muted-foreground">{o.best.note}</span>} <button type="button" className="ml-1 min-h-8 text-sm underline underline-offset-4" onClick={() => go("intake")}>Lead intake</button></p>}
        </section>
      )}

      {o.alerts.length > 0 && (
        <section aria-label="Alerts" data-testid="dq-overview-alerts"><h3 className="mb-2 text-base font-semibold">Needs a look <span className="text-sm font-normal text-muted-foreground">{o.alertCount}</span></h3>
          <ul className="divide-y rounded-xl border bg-card">{o.alerts.map((a) => <li key={a.locationId + a.key + a.kind} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span className="min-w-0"><span className="block truncate">{a.title}</span><span className="text-xs text-muted-foreground">{a.account}</span></span><button type="button" className={Q_BTN} onClick={() => go("intake", a.locationId)}>Open</button></li>)}</ul></section>
      )}

      {o.quality && o.quality.score !== null && (
        <section className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-[auto_1fr]" aria-label="Quality score" data-testid="dq-quality">
          <ScoreRing score={o.quality.score} word={o.quality.word} label="Data quality" testId="dq-score" />
          <div className="space-y-3">
            <p className="text-base" data-testid="dq-why">{o.quality.why}</p>
            <ul className="space-y-1.5 text-sm" data-testid="dq-parts">{o.quality.parts.map((p) => (
              <li key={p.id} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2"><span>{p.label}</span><span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, 100 - Math.min(100, (p.lost / p.weight) * 100))}%` }} /></span><span className="text-xs text-muted-foreground" title={p.line}>{p.lost > 0 ? `-${p.lost}` : "0"} pts</span></li>))}</ul>
            <Trend pts={o.trend} />
            <p className="text-xs text-muted-foreground">Four parts: duplicates, completeness, validity and new leads. Each loses points as more records are affected. {o.quality.note ?? ""}</p>
          </div>
        </section>
      )}

      {o.worst.length > 0 && (
        <section aria-label="Accounts to clean first" data-testid="dq-worst"><h3 className="mb-2 text-base font-semibold">Clean these first <span className="text-sm font-normal text-muted-foreground">worst score first</span></h3>
          <ul className="divide-y rounded-xl border bg-card">{o.worst.map((w) => <li key={w.locationId}><button type="button" onClick={() => go("fix", w.locationId)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50"><span className="min-w-0 truncate font-medium">{w.name ?? "Unnamed account"}</span><span className="whitespace-nowrap tabular-nums text-muted-foreground">{w.contacts ? `${fmtInt(w.contacts)} contacts · ` : ""}<b className="text-foreground">{w.score ?? "n/a"}</b></span></button></li>)}</ul>
          {o.worstTotal > o.worst.length && <p className="mt-1 text-xs text-muted-foreground">Showing {o.worst.length} of {o.worstTotal}. Pick an account above to look at one.</p>}</section>
      )}
    </div>
  );
}
