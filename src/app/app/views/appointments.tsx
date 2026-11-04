"use client";

import { CircleCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { targetState } from "@/lib/analytics/appointment-f3";
import { headlineOf, OUTCOME_BUCKETS, summaryText, type Compare, type OutcomeBucket, type ShowRate, type WorkKind } from "@/lib/analytics/appointment-work";
import { windowQuery } from "@/lib/design/appt-ui";
import { shareChange } from "@/lib/design/range";
import type { GoFn } from "../nav";
import { useData } from "../session";
import { CardRange, Distribution, EmptyState, ErrorState, HowTo, InlineAlert, Page, PopMenu, SkeletonCards, useCardRange, type MenuItem } from "../ds";
import { CountUp } from "../ds/count-up";
import { fmtInt } from "../ui";
import { Explainer, pct, TargetEditor } from "./appointment-parts";
import { BTN, ComparePanel, FullList, plural, PRIMARY, QUIET, WorkSection, type WorkRowData } from "./appointments-work";

// Appointments, rebuilt (docs/APPOINTMENTS_REVIEW.md). One sentence says what needs a person, one button starts the most valuable job, then three plain lists of five
// rows each (the rest behind "See all"), the true show rate with its plain explanation, and who needs a nudge. SubSync reads appointments and never changes one:
// an outcome is marked in the CRM, one click away. Every number comes from the same rows as the list behind it, and the first three are the numbers Today shows.

type Block = { total: number; value: number; rows: WorkRowData[] };
type Data = {
  now: number;
  access: { total: number; needsPermission: Array<{ locationId: string; name: string | null }>; namesNeedPermission: number };
  several: boolean;
  counts: { record: number; recover: number; upcoming: number; recoverValue: number; value: number };
  target: { showRate: number; isDefault: boolean };
  lists: Record<WorkKind, Block>;
  window: { from: string; to: string; defaulted: boolean; problem: string | null };
  compareWindow: { from: string; to: string } | null;
  rate: ShowRate; rateBefore: ShowRate | null;
  outcomes: { counts: Record<OutcomeBucket, number> };
  historyFrom: string | null;
  people: { total: number; rows: Compare[] }; calendars: { total: number; rows: Compare[] }; accounts: { total: number; rows: Compare[] };
  canSeeAccounts: boolean; canEditTargets: boolean;
};

const INITIAL = { preset: "30d", compare: "previous" } as const;
const TONE: Record<OutcomeBucket, "good" | "bad" | "warn" | "series"> = { showed: "good", noshow: "bad", unmarked: "warn", cancelled: "series" };
const SECTIONS: Array<{ kind: WorkKind; title: string; hint: string; empty: string }> = [
  { kind: "recover", title: "No-shows to recover", hint: "Missed in the last 14 days, not booked again. Most valuable first.", empty: "No no-show is waiting for a call. Nobody who missed an appointment in the last 14 days is still unbooked." },
  { kind: "record", title: "Needs an outcome", hint: "Nobody marked them showed or no-show. Mark them in your CRM so the show rate is true.", empty: "Every past appointment has an outcome. The show rate is as true as it can be." },
  { kind: "upcoming", title: "Coming up that may not show", hint: "Next 7 days: not confirmed, or missed their last one. Soonest first.", empty: "Nothing coming up looks shaky. Everything in the next 7 days is confirmed and nobody has a missed appointment behind them." },
];

export function AppointmentsView({ go }: { go: GoFn }) {
  const range = useCardRange("appointments", INITIAL);
  const wq = windowQuery(range.resolved);
  const { data, error, loading, reload } = useData<Data>(range.resolved ? `appointments/work?${wq}` : null);
  const [drill, setDrill] = useState<{ title: string; kind: "all" | "window"; fixed: Record<string, string>; id: string } | null>(null);
  const [chart, setChart] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); }, [toast]);

  const toList = useCallback((kind: WorkKind) => {
    const el = document.getElementById(`appt-sec-${kind}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, []);

  if (error) return <Page title="Appointments"><ErrorState error={error} onRetry={reload} /></Page>;
  if (!data) return <Page title="Appointments"><SkeletonCards cards={3} label="Loading appointments..." /></Page>;
  const d = data;
  const waiting = d.access.needsPermission.length;
  const h = headlineOf(d.counts);
  const none = d.counts.record + d.counts.recover + d.counts.upcoming === 0 && d.rate.booked === 0 && !d.rateBefore?.booked;
  const r = d.rate;
  // "last 30 days" for a preset, "6 Oct to 4 Nov" for custom dates; the full dates are always under the control.
  const windowWords = range.resolved ? (range.spec.preset === "custom" ? range.resolved.current.label : `the ${range.resolved.current.label.split(",")[0].toLowerCase()}`) : "the dates chosen";
  const before = d.rateBefore;
  const change = before && r.rate !== null && before.outcomes > 0
    ? (before.outcomes >= 10 && r.outcomes >= 10 ? shareChange({ n: r.held, total: r.outcomes }, { n: before.held, total: before.outcomes }).text : `Before that it was ${Math.round((before.held / before.outcomes) * 100)}% of ${before.outcomes}, too few to call a change`)
    : null;
  const target = targetState(r.rate, d.target.showRate);
  const accountsLine = d.accounts.rows.slice(0, 8).map((a) => ({ label: a.label, record: a.record, recover: a.recover }));
  const summary = summaryText({ counts: d.counts, rate: r, windowWords, accounts: d.several ? accountsLine : undefined });
  const copy = async () => { try { await navigator.clipboard.writeText(summary); setToast("Copied. Paste it wherever you need it."); setCopied(null); } catch { setCopied(summary); } };
  const menu: MenuItem[] = [
    { key: "copy", label: "Copy a summary", onSelect: () => void copy() },
    { key: "print", label: "Print this page", onSelect: () => window.print() },
    { key: "insights", label: "See the Insights tab", onSelect: () => document.querySelector<HTMLElement>("[role=tab]:not([aria-selected=true])")?.click() },
    { key: "calls", label: "Open the call lists", onSelect: () => go("calls") },
  ];
  const openBucket = (i: number) => {
    const b = OUTCOME_BUCKETS[i];
    setDrill({ id: b.key, kind: "window", fixed: { bucket: b.key, ...Object.fromEntries(new URLSearchParams(wq)) }, title: `${b.label}, ${windowWords}` });
    setTimeout(() => document.getElementById("appt-drill")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  const openCompare = (by: "person" | "calendar" | "account", c: Compare) => {
    setDrill({ id: `${by}:${c.key}`, kind: "all", fixed: { [by === "person" ? "user" : by === "account" ? "location" : "calendar"]: c.key }, title: `${c.label}, to do` });
    setTimeout(() => document.getElementById("appt-drill")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  return (
    <Page title="Appointments" subtitle="Who missed, who was never marked, and who may not show." actions={<PopMenu label="More" items={menu} testId="appt-more" triggerClassName={`${BTN} px-3`}><span>More</span></PopMenu>}>
      {waiting > 0 && (
        <InlineAlert tone="warning" className="mb-5" title={waiting === d.access.total ? "Needs permission: reconnect. SubSync cannot read appointments yet." : `Needs permission: reconnect. ${plural(waiting, "account", "accounts")} cannot show appointments yet.`}>
          <p>The app needs one more read-only permission. Open the app in the marketplace and choose Reinstall (or ask the account owner), then approve. Nothing else changes.{d.canSeeAccounts && waiting <= 6 ? ` Waiting: ${d.access.needsPermission.map((a) => a.name ?? "Unnamed").join(", ")}.` : ""}</p>
        </InlineAlert>
      )}

      {none ? (
        <EmptyState title="No appointments yet" body={waiting > 0 ? "They will appear after the app is approved again and the next sync finishes." : "Once calendars have bookings, the no-shows to call, the appointments nobody marked and the true show rate appear here. Appointments are read from the last 90 days and the next 60."} action={<button type="button" className={BTN} onClick={() => go("help")}>Open Getting started</button>} />
      ) : (
        <div className={loading ? "opacity-70 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <HowTo id="appointments-v2" title="How this works">Start with the button. Each row has one button and a menu. SubSync only reads: mark outcomes in your CRM.</HowTo>

          <section className="mb-7" aria-label="What needs you" data-testid="appt-headline-block">
            <h2 className="max-w-4xl text-[clamp(1.6rem,3.3vw,2.6rem)] font-semibold leading-[1.06] tracking-tight" data-testid="appt-headline" data-clear={h.total === 0}>
              {h.total === 0 && <CircleCheck aria-hidden className="mr-3 inline-block size-[0.8em] -translate-y-[0.05em] text-success" />}
              {h.total === 0 ? h.title : <><span className="tnum text-primary"><CountUp value={h.total} /></span> {h.total === 1 ? "appointment needs" : "appointments need"} you.</>}
            </h2>
            {h.line && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground" data-testid="appt-headline-line">{h.line}</p>}
            {h.action && (
              <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="appt-primary-block">
                <button type="button" className={PRIMARY} onClick={() => toList(h.action!.kind)} data-testid="appt-primary">{h.action.label}</button>
                <button type="button" className={QUIET} onClick={() => void copy()} data-testid="appt-copy">Copy a summary</button>
              </div>
            )}
            {copied && <textarea readOnly className="mt-3 h-36 w-full max-w-2xl rounded-lg border bg-card p-2 font-mono text-xs" value={copied} aria-label="Summary to copy" onFocus={(e) => e.currentTarget.select()} />}
          </section>

          <section className="mb-8 border-y py-4" aria-labelledby="appt-rate-h" data-testid="appt-rate-card">
            <h2 id="appt-rate-h" className="sr-only">True show rate</h2>
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_16rem] lg:items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground">True show rate</p>
                <p className="tnum mt-1 text-[2.4rem] font-semibold leading-none tracking-tight" data-testid="appt-rate">{r.rate === null ? <span className="text-muted-foreground">n/a</span> : pct(r.rate)}</p>
              </div>
              <div className="min-w-0 text-sm leading-6" data-testid="appt-rate-words">
                <p>
                  {r.rate === null
                    ? <>Not enough marked appointments yet: {r.outcomes} of 5 needed. {r.unmarked > 0 ? `Mark the ${plural(r.unmarked, "past appointment", "past appointments")} below to get a true rate.` : ""}</>
                    : <>Of {plural(r.outcomes, "appointment", "appointments")} someone marked in {windowWords}, {r.held} showed and {r.noShow} did not.{change ? ` ${change}.` : ""}</>}
                </p>
                {r.rate !== null && r.range && <p className="text-muted-foreground" data-testid="appt-rate-range">{plural(r.unmarked, "appointment has", "appointments have")} no outcome yet. Once marked, the rate will land between {pct(r.range.low)} and {pct(r.range.high)}.</p>}
                {r.rate !== null && !r.range && r.unmarked > 0 && <p className="text-muted-foreground">{plural(r.unmarked, "appointment has", "appointments have")} no outcome yet.</p>}
                {r.rate !== null && <p className="text-muted-foreground">{target.text}</p>}
                {range.resolved && d.window.problem && <p className="mt-1 border-l-2 border-warning pl-2 text-xs" role="status">{d.window.problem}</p>}
              </div>
              <div className="md:col-span-2 lg:col-span-1"><CardRange state={range} label="Show rate" /></div>
            </div>
            <details className="mt-3 text-sm" onToggle={(e) => setChart((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="min-h-11 cursor-pointer select-none py-2 text-muted-foreground hover:text-foreground sm:min-h-9" data-testid="appt-chart-toggle">What happened to them, and your target</summary>
              {chart && (
                <div className="mt-2 max-w-2xl" data-testid="appt-outcome-chart">
                  <Distribution title={`What happened to the appointments of ${windowWords}`} noun="appointments" sample={Math.max(1, OUTCOME_BUCKETS.reduce((s, b) => s + d.outcomes.counts[b.key], 0))} min={0} need="appointments"
                    rows={OUTCOME_BUCKETS.map((b) => ({ label: b.label, value: d.outcomes.counts[b.key], count: d.outcomes.counts[b.key], detail: b.hint, tone: TONE[b.key] }))}
                    onSelect={openBucket} selected={drill?.kind === "window" ? OUTCOME_BUCKETS.findIndex((b) => b.key === drill.id) : null} />
                  <Explainer id="status" />
                </div>
              )}
              <div className="mt-3"><TargetEditor key={d.target.showRate} value={d.target.showRate} isDefault={d.target.isDefault} canEdit={d.canEditTargets} onSaved={reload} /></div>
            </details>
            {drill?.kind === "window" && <div id="appt-drill"><FullList key={drill.id + wq} kind="window" fixed={drill.fixed} title={drill.title} empty="Nothing behind this bar." onClose={() => setDrill(null)} testId="appt-drill-list" /></div>}
          </section>

          {SECTIONS.map((s) => <WorkSection key={s.kind} {...s} total={d.lists[s.kind].total} value={d.lists[s.kind].value} rows={d.lists[s.kind].rows} showAccount={d.several && d.canSeeAccounts} />)}

          <ComparePanel windowQuery={wq} canAccounts={d.canSeeAccounts} several={d.several} onOpen={openCompare}
            initial={{ person: d.people, calendar: d.calendars, account: d.accounts }} />
          {drill?.kind === "all" && <div id="appt-drill" className="-mt-4 mb-8"><FullList key={drill.id} kind="all" fixed={drill.fixed} title={drill.title} empty="Nothing to do here." onClose={() => setDrill(null)} testId="appt-drill-list" /></div>}

          <p className="mb-2 text-xs text-muted-foreground">Figures are counted from your CRM&apos;s appointments, last 90 days and next 60{d.historyFrom ? `, from ${d.historyFrom}` : ""}. The three lists use the same rows as Today. {fmtInt(d.counts.record + d.counts.recover + d.counts.upcoming)} in all.</p>
        </div>
      )}

      {toast && <div role="status" className="fixed inset-x-4 bottom-4 z-40 rounded-lg border bg-card px-4 py-3 text-sm shadow-[var(--shadow-lift)] sm:left-auto sm:max-w-sm">{toast}</div>}
    </Page>
  );
}
