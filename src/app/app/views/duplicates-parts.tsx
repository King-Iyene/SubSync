"use client";

import { useEffect, useRef, useState } from "react";
import { crmSteps, diffFields, emailPlan, mergePlan, summaryText, type DiffRow, type Guardrail } from "@/lib/analytics/dedupe-review";
import type { Person } from "@/lib/analytics/dedupe";
import { DialButton, LeadDrawer, RowButton } from "../ds";
import { ExtLink, timeAgo } from "../ui";
import type { FieldPick } from "@/lib/analytics/cleanup-rules";
import { Picks, WorkflowMerge, type Workflow } from "./duplicates-extra";

// The parts of the duplicate review (stage DUP). One group at a time: the records side by side, only what differs, a pre-picked record to keep with the
// reason in words, and a merge sheet that says what will be kept, moved and removed and finishes the job in the CRM's own merge screen. Plain words, no
// pills, no tinted boxes (KF-1); every button is at least 44 px high on a phone.

export type WithUrl = Person & { url: string };
export const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
export const letterOf = (i: number) => LETTERS[i] ?? String(i + 1);

const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 sm:min-h-10";
const PRIMARY = "ds-press inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-64";
const QUIET = "ds-press inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-10";
export const buttons = { BTN, PRIMARY, QUIET };

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });

// ---------- the records ----------

export function RecordCard({ p, i, keep, best, onKeep, locked, locationId }: { p: WithUrl; i: number; keep: boolean; best: boolean; onKeep: () => void; locked: boolean; /** The client account of the group: lets the record open in the shared lead panel. */ locationId?: string }) {
  const email = emailPlan({ email: p.email, contactUrl: p.url });
  const [panel, setPanel] = useState(false);
  return (
    <li className={`min-w-0 border-t-2 pt-3 ${keep ? "border-primary" : "border-border"}`} data-testid="dup-record" data-keep={keep ? "true" : "false"}>
      <label className={`flex min-h-11 items-start gap-3 ${locked ? "" : "cursor-pointer"}`}>
        <input type="radio" name="dup-keep" className="mt-1 size-5 shrink-0" checked={keep} disabled={locked} onChange={onKeep} aria-label={`Keep ${p.name} (record ${letterOf(i)})`} data-testid="dup-keep-radio" />
        <span className="min-w-0">
          <span className="block text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{letterOf(i)}</span> · {keep ? "Keep this one" : "Merge in and remove"}{best ? " · Best match" : ""}
          </span>
          <span className="block break-words text-base font-semibold leading-snug">{p.name}</span>
        </span>
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Added {p.createdAt ? timeAgo(p.createdAt) : "at an unknown time"} · {p.lastActivityAt ? `last activity ${timeAgo(p.lastActivityAt)}` : "no activity seen"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
        <DialButton compact phone={p.phone} contactUrl={p.url} dnd={p.dnd === true} />
        {email.href ? <a href={email.href} target="_blank" rel="noopener noreferrer" title={email.note} className="inline-flex min-h-9 items-center font-medium text-primary underline underline-offset-2" data-testid="dup-email">{email.label}</a> : <span className="text-xs text-muted-foreground">{email.note}</span>}
        {locationId && <button type="button" onClick={() => setPanel(true)} className="inline-flex min-h-9 items-center font-medium text-primary underline underline-offset-2" data-testid="dup-show">Show</button>}
        <ExtLink href={p.url}>Open contact</ExtLink>
      </div>
      {locationId && panel && <LeadDrawer leads={[{ contactId: p.contactId, locationId, name: p.name, phone: p.phone, email: p.email, url: p.url, dnd: p.dnd === true }]} index={0} onIndex={() => undefined} onClose={() => setPanel(false)} showAccount={false} />}
    </li>
  );
}

function TagList({ p }: { p: Person }) {
  if (p.tags.length === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <span>
      {p.tags.map((t, i) => {
        const at = p.tagDates?.[t];
        return <span key={`${t}:${i}`}>{i > 0 ? ", " : ""}{t}{at ? <span className="text-muted-foreground"> (seen {shortDay(at)})</span> : null}</span>;
      })}
    </span>
  );
}

function Row({ row, people, n }: { row: DiffRow; people: Person[]; n: number }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-t border-l-2 border-l-primary py-2 pl-3 sm:grid-cols-[8rem_repeat(var(--n),minmax(0,1fr))]" style={{ "--n": n } as React.CSSProperties} data-testid="dup-diff-row" data-field={row.id}>
      <div className="font-medium sm:font-normal sm:text-muted-foreground">{row.label}</div>
      {row.values.map((v, i) => (
        <div key={i} className="min-w-0 break-words">
          <span className="mr-1 text-xs font-semibold text-muted-foreground sm:sr-only">{letterOf(i)}</span>
          {row.id === "tags" ? <TagList p={people[i]} /> : v.empty ? <span className="text-muted-foreground">none</span> : v.text}
        </div>
      ))}
    </div>
  );
}

/** Only the fields that differ, with a thin rule. What is identical is one collapsed line. */
export function Compare({ people, watchingSince }: { people: Person[]; watchingSince: string | null }) {
  const d = diffFields(people);
  const n = people.length;
  const anyDate = people.some((p) => p.tagDates && Object.keys(p.tagDates).length > 0);
  return (
    <div className="mt-5 text-sm" data-testid="dup-diff">
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">What is different</h3>
      {d.differ.length === 0 ? <p className="border-t py-2 text-muted-foreground">Nothing differs. These records hold the same details.</p> : d.differ.map((r) => <Row key={r.id} row={r} people={people} n={n} />)}
      {d.same.length > 0 && (
        <details className="border-t py-2" data-testid="dup-same">
          <summary className="min-h-9 cursor-pointer text-muted-foreground">The same in every record: {d.same.map((r) => r.label).join(", ")}</summary>
          <div className="mt-1">{d.same.map((r) => <div key={r.id} className="grid gap-x-4 py-1 sm:grid-cols-[8rem_minmax(0,1fr)]"><span className="text-muted-foreground">{r.label}</span><span className="break-words">{r.id === "tags" ? <TagList p={people[0]} /> : r.values[0].text}</span></div>)}</div>
        </details>
      )}
      {(anyDate || d.differ.some((r) => r.id === "tags")) && (
        <p className="border-t pt-2 text-xs text-muted-foreground" data-testid="dup-tag-note">
          {anyDate ? "Dates show the day SubSync first saw a tag" : "Tag dates are not known for these"}{watchingSince ? ` (it has been watching tags since ${shortDay(watchingSince)}).` : " (your CRM does not say when a tag was added)."}
        </p>
      )}
    </div>
  );
}

// ---------- the merge sheet ----------

export function MergeSheet({ accountName, people, keepId, why, switchedOff, onClose, onMerged, copy, picks, workflow, onWorkflowMerge }: {
  accountName: string | null; people: WithUrl[]; keepId: string; why: string; switchedOff: boolean;
  onClose: () => void; onMerged: () => Promise<void>; copy: (text: string) => Promise<void>;
  picks?: FieldPick[]; workflow?: Workflow; onWorkflowMerge?: (typed: string) => Promise<string>;
}) {
  const plan = mergePlan(people, keepId);
  const keep = people.find((p) => p.contactId === keepId)!;
  const others = people.filter((p) => p.contactId !== keepId);
  const warnings: Guardrail[] = plan.warnings;
  const [ack, setAck] = useState(warnings.length === 0);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus(); }, []);
  const steps = crmSteps(keep.name);
  const summary = summaryText({ accountName, plan, people, why, crmSteps: steps });
  const openAll = () => {
    for (const p of [keep, ...others]) window.open(p.url, "_blank", "noopener,noreferrer");
    setOpened(true);
  };
  return (
    <section aria-labelledby="dup-sheet-h" className="mt-5 border-t-2 border-primary pt-4" data-testid="dup-sheet">
      <h3 id="dup-sheet-h" ref={head} tabIndex={-1} className="text-lg font-semibold outline-none">Combine these {people.length} people into {keep.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">Nothing changes until you finish in your CRM. Here is exactly what the merge does.</p>

      {warnings.length > 0 && (
        <div className="mt-4 border-l-2 border-warning py-1 pl-3 text-sm" role="alert" data-testid="dup-warnings">
          <p className="font-medium">Check these first</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{warnings.map((w) => <li key={w.id} data-warning={w.id}>{w.text}</li>)}</ul>
          {!ack && <button type="button" className={`${BTN} mt-3`} onClick={() => setAck(true)} data-testid="dup-ack">I have checked this. Continue.</button>}
        </div>
      )}

      {ack && (
        <>
          <ul className="mt-4 space-y-1.5 text-sm" data-testid="dup-plan">{plan.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {plan.picks.length > 0 && (
            <div className="mt-3 text-sm"><p className="font-medium">In the merge screen, choose</p><ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{plan.picks.map((l) => <li key={l}>{l}</li>)}</ul></div>
          )}
          {picks && <Picks picks={picks} people={people} />}
          {people.length > 10 && <p className="mt-3 text-sm text-muted-foreground">Your CRM merges up to 10 contacts at a time, so do the first 10, then come back for the rest.</p>}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button type="button" className={PRIMARY} onClick={openAll} data-testid="dup-open-both">Open both in your CRM</button>
            <button type="button" className={BTN} onClick={() => void copy(summary)} data-testid="dup-copy">Copy the summary</button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The first tab is the one to keep. If only one tab opened, use these links: {[keep, ...others].map((p, i) => <span key={p.contactId}>{i > 0 ? " · " : ""}<ExtLink href={p.url}>{p.name}{p.contactId === keepId ? " (keep)" : ""}</ExtLink></span>)}</p>

          {workflow && onWorkflowMerge && <WorkflowMerge workflow={workflow} people={people} switchedOff={switchedOff} onRun={onWorkflowMerge} />}

          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground" data-testid="dup-steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>

          <div className="mt-5 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:items-center">
            <button type="button" className={opened ? PRIMARY : BTN} disabled={busy} onClick={async () => { setBusy(true); try { await onMerged(); } finally { setBusy(false); } }} data-testid="dup-done-in-crm">I merged them in my CRM</button>
            <button type="button" className={QUIET} onClick={onClose} data-testid="dup-sheet-back">Not yet, go back</button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- lists ----------

export type Row = {
  key: string; locationId: string; locationName: string | null; size: number; names: string[]; moreNames: number; reason: { key: string; label: string };
  likelihood: { key: string; label: string }; openDeals: number; warn: boolean; obvious: boolean; decision: { kind: string; at: string | null } | null; until: string | null;
};

export function GroupRow({ row, multi, onOpen }: { row: Row; multi: boolean; onOpen: () => void }) {
  const names = row.names.join(" / ") + (row.moreNames > 0 ? ` and ${row.moreNames} more` : "");
  const note = row.decision ? (row.decision.kind === "not_duplicate" ? "Marked not a duplicate" : row.decision.kind === "merged_in_platform" ? "Merged in your CRM" : "Decided") : row.until ? `Set aside until ${shortDay(row.until)}` : row.warn ? "Check before merging" : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-2.5" data-testid="dup-list-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{names}</p>
        <p className="line-clamp-2 break-words text-xs text-muted-foreground">{row.reason.label}{multi && row.locationName ? ` · ${row.locationName}` : ""} · {row.size} contacts{row.openDeals > 0 ? ` · ${row.openDeals} open deal${row.openDeals === 1 ? "" : "s"}` : ""}{note ? <span className={row.warn && !row.decision && !row.until ? " text-warning" : ""}> · {note}</span> : null}</p>
      </div>
      <RowButton onClick={onOpen} label={row.decision || row.until ? "Open" : "Review"} sr={`${names}, ${row.reason.label}`} testId="dup-row-open" />
    </li>
  );
}
