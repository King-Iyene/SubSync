"use client";

import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "../ds/portal-root";
import { money } from "@/lib/analytics/today-queue";
import { accountSpeeds, fastestSlowest, hourStats, hourTitle, sourceStats, sourceTitle, workload } from "@/lib/analytics/today-smart";
import { specAccountReplies, specHour, specJunk, specPerson, specSource } from "@/lib/analytics/today-specs";
import { heldSpec } from "@/lib/analytics/today-state";
import type { TodayData } from "@/lib/analytics/today-types";
import { useData } from "../session";
import { CompareList, EmptyState, HourStrip, SourceBars, WorkloadList } from "../ds";
import type { TodayModel } from "./today-model";

// Pieces of Today shared by the agency page and the one-account page: the controls by the headline, and the People, Sources and Coverage tabs. Each tab is worked out
// from the lead ledger (the last 14 days of leads, the same rows as Speed to lead) with the rules in docs/METRICS.md, and every number in it opens its records.

/** "Exclude test and very old deals" and the link to what it left out. It sits with the deal numbers under More detail, not by the headline. */
export function JunkControl({ m, staleCount }: { m: TodayModel; staleCount: number }) {
  const left = m.view.junk.items.length;
  if (staleCount === 0) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" data-testid="headline-controls">
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-2">
        <input type="checkbox" className="size-4" checked={m.excludeJunk} onChange={(e) => m.setExcludeJunk(e.target.checked)} data-testid="junk-toggle" />
        <span>Exclude test and very old deals</span>
      </label>
      {m.excludeJunk && left > 0 && (
        <button type="button" onClick={() => m.open(specJunk(m.env))} className="min-h-9 rounded-lg px-1.5 text-muted-foreground underline underline-offset-4 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="junk-left-out">
          {left} left out, {money(m.view.junk.dollars)}
        </button>
      )}
    </div>
  );
}

/** "N snoozed": the way back to what a person set aside. Quiet text under the list, only when something is set aside. */
export function HeldLink({ m }: { m: TodayModel }) {
  const held = m.view.held.length;
  if (held === 0) return null;
  const onlySnoozed = m.view.held.every((h) => h.hold.action === "snooze");
  return (
    <p className="mb-6 text-sm" data-testid="headline-controls-held">
      <button type="button" onClick={() => m.open(heldSpec(m.view.held))} data-testid="held-link" data-count={held}
        className="min-h-9 rounded-lg px-1.5 text-muted-foreground underline underline-offset-4 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
        {held} {onlySnoozed ? "snoozed" : "snoozed or done"}
      </button>
    </p>
  );
}

const cappedNote = (t: TodayData) => (t.ledgerTotal > t.ledger.length ? <p className="mb-3 text-xs text-muted-foreground" data-testid="ledger-capped">Based on the newest {t.ledger.length.toLocaleString("en-US")} of {t.ledgerTotal.toLocaleString("en-US")} leads of the last 14 days.</p> : null);
const noLeads = <EmptyState compact title="No leads in the last 14 days" body="These views are worked out from new leads. They fill in as leads arrive and get replies." />;

export function PeopleTab({ m, t, agency }: { m: TodayModel; t: TodayData; agency: boolean }) {
  const people = useMemo(() => workload(m.view.items, t.ledger, m.now), [m.view.items, t.ledger, m.now]);
  const speeds = useMemo(() => accountSpeeds(t.ledger), [t.ledger]);
  const fs = fastestSlowest(speeds.ranked);
  if (t.ledger.length === 0 && people.length === 0) return noLeads;
  return (
    <div className="space-y-10" data-testid="tab-people">
      {cappedNote(t)}
      {people.length === 0 ? <EmptyState compact title="Nobody has leads waiting" body="No lead is past its reply target, so there is no workload to compare." /> : <WorkloadList people={people} onOpen={(name) => m.open(specPerson(name, m.view.items, m.env))} />}
      {agency && <CompareList fastest={fs.fastest} slowest={fs.slowest} tooFew={speeds.tooFew} onOpen={(id) => m.open(specAccountReplies(id, speeds.ranked.find((a) => a.locationId === id)?.name ?? "Client account", m.env))} />}
    </div>
  );
}

export function SourcesTab({ m, t }: { m: TodayModel; t: TodayData }) {
  const stats = useMemo(() => sourceStats(t.ledger, t.targetMinutes, m.now), [t.ledger, t.targetMinutes, m.now]);
  if (stats.length === 0) return noLeads;
  return <div data-testid="tab-sources">{cappedNote(t)}<SourceBars stats={stats} title={sourceTitle(stats)} onOpen={(name) => m.open(specSource(t.ledger, name, t.targetMinutes, m.now))} /></div>;
}

/** "Preview the daily email": the text of the daily brief as it would be written today, from the same ranking Today shows. Nothing is sent. */
export function BriefPreview({ onClose }: { onClose: () => void }) {
  const brief = useData<{ headline: string; lines: string[]; note: string }>("today/brief");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="brief-overlay">
      <div role="dialog" aria-modal="true" aria-label="Preview of the daily email" className="flex max-h-[80vh] w-[min(40rem,100%)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl" data-testid="brief-panel">
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div><h2 className="text-lg font-semibold">Preview of the daily email</h2><p className="mt-0.5 text-sm text-muted-foreground">Written from the same list as Today. SubSync has sent nothing.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="brief-close" className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X aria-hidden className="size-5" /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4 text-sm leading-6" data-testid="brief-body">
          {brief.error ? <p className="text-destructive">{brief.error.message}</p> : !brief.data ? <p className="text-muted-foreground">Writing the preview...</p> : (
            <>
              <p className="text-base font-semibold" data-testid="brief-subject">Subject: {brief.data.headline}</p>
              <ul className="mt-3 space-y-1.5" data-testid="brief-lines">{brief.data.lines.map((l, n) => <li key={n}>{l}</li>)}</ul>
            </>
          )}
        </div>
      </div>
    </div>,
    portalRoot(),
  );
}

export function CoverageTab({ m, t }: { m: TodayModel; t: TodayData }) {
  const stats = useMemo(() => hourStats(t.ledger, t.targetMinutes, m.now), [t.ledger, t.targetMinutes, m.now]);
  if (t.ledger.length === 0) return noLeads;
  return <div data-testid="tab-coverage">{cappedNote(t)}<HourStrip stats={stats} title={hourTitle(stats, t.targetMinutes)} targetMinutes={t.targetMinutes} onOpen={(h) => m.open(specHour(t.ledger, h, t.targetMinutes, m.now))} /></div>;
}
