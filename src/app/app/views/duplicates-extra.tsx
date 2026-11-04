"use client";

import { useState } from "react";
import type { Guardrail } from "@/lib/analytics/dedupe-review";
import type { Person } from "@/lib/analytics/dedupe";
import type { FieldPick } from "@/lib/analytics/cleanup-rules";
import { InlineAlert } from "../ds";
import { BTN, PRIMARY, ScoreMeter } from "./cleanup-parts";

// The Clean-up additions to the duplicate review (stage CLEANUP): the match score with its reasons, what each field becomes under the account's "which value wins" rules, and
// starting a merge from SubSync through the customer's own merge workflow. Plain words, no pills, no tinted boxes (KF-1).

export type Pair = { a: string; b: string; score: number; reasons: string[] };
export type Workflow = {
  set: boolean; optedIn: boolean; canAsk: boolean; survivorId: string; survivorDiffers: boolean; matchBy: string;
  blockers: Array<{ id: string; text: string }>; warnings: Guardrail[];
};

/** The match score in numbers and words: how sure SubSync is, why, the rules that were used and, for a small group, the score of each pair. */
export function MatchWhy({ confidence, likelihood, reasons, pairs, people, rules }: { confidence: number; likelihood: string; reasons: string[]; pairs: Pair[]; people: Person[]; rules: { preset: string; sentence: string } }) {
  const nameOf = (id: string) => people.find((p) => p.contactId === id)?.name ?? "a contact";
  return (
    <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]" data-testid="dup-match">
      <ScoreMeter score={confidence} word={likelihood} label="Match score" testId="dup-score" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">Why these match</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-muted-foreground" data-testid="dup-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="dup-rules-note">Matching rules: {rules.preset === "custom" ? "your own mix" : rules.preset}. {rules.sentence}</p>
        {pairs.length > 1 && (
          <details className="mt-1" data-testid="dup-pairs">
            <summary className="min-h-9 cursor-pointer text-xs text-muted-foreground">Score for each pair</summary>
            <ul className="mt-1 space-y-1 text-xs">{pairs.map((x) => <li key={x.a + x.b}><span className="font-medium tabular-nums">{x.score}</span> · {nameOf(x.a)} and {nameOf(x.b)}{x.reasons.length ? <span className="text-muted-foreground">: {x.reasons.join("; ").toLowerCase()}</span> : null}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}

/** What each field becomes after the merge under the account's rules, only where the records disagree. */
export function Picks({ picks, people }: { picks: FieldPick[]; people: Person[] }) {
  const rows = picks.filter((p) => p.conflict);
  if (rows.length === 0) return null;
  const nameOf = (id: string) => people.find((p) => p.contactId === id)?.name ?? "a record";
  return (
    <div className="mt-3 text-sm" data-testid="dup-picks">
      <p className="font-medium">What each field becomes</p>
      <ul className="mt-1 space-y-1 text-muted-foreground">{rows.map((r) => <li key={r.field}><span className="text-foreground">{r.label}:</span> {r.value} <span>({r.reason}{r.from ? `, from ${nameOf(r.from)}` : ""})</span></li>)}</ul>
    </div>
  );
}

/** Starting the merge from SubSync, through the customer's own merge workflow. Shown only to an administrator; every limit is stated in words. */
export function WorkflowMerge({ workflow, people, switchedOff, onRun }: { workflow: Workflow; people: Array<Person & { url: string }>; switchedOff: boolean; onRun: () => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const [checked, setChecked] = useState(workflow.warnings.length === 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!workflow.canAsk) return null;
  const survivor = people.find((p) => p.contactId === workflow.survivorId);
  const enrol = people.find((p) => p.contactId !== workflow.survivorId);
  const blocked = workflow.blockers.length > 0;
  return (
    <div className="mt-5 border-t pt-4" data-testid="dup-workflow">
      {!open ? (
        <button type="button" className={BTN} onClick={() => setOpen(true)} data-testid="dup-workflow-open">Merge from SubSync</button>
      ) : (
        <div className="text-sm">
          <p className="font-medium">Merge from SubSync</p>
          {blocked ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground" data-testid="dup-workflow-blockers">{workflow.blockers.map((b) => <li key={b.id}>{b.text}</li>)}</ul>
          ) : !workflow.optedIn ? (
            <p className="mt-1 text-muted-foreground" data-testid="dup-workflow-optin">Changing contacts is not switched on for this client. An administrator can allow it in Settings, Clean-up rules. Nothing was changed.</p>
          ) : (
            <>
              <p className="mt-1 text-muted-foreground" data-testid="dup-workflow-plan">SubSync adds <strong className="text-foreground">{enrol?.name}</strong> to this client&apos;s merge workflow. Your CRM then merges it into <strong className="text-foreground">{survivor?.name}</strong>: the older record always survives, matched by {workflow.matchBy}. A merge cannot be undone.</p>
              {workflow.survivorDiffers && <p className="mt-1 text-warning" data-testid="dup-workflow-differs">This is not the record SubSync picked to keep. To keep the other one, use Open both in your CRM above.</p>}
              {workflow.warnings.length > 0 && (
                <div className="mt-2 border-l-2 border-warning py-1 pl-3">
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{workflow.warnings.map((w) => <li key={w.id}>{w.text}</li>)}</ul>
                  {!checked && <button type="button" className={`${BTN} mt-2`} onClick={() => setChecked(true)}>I have checked this. Continue.</button>}
                </div>
              )}
              {checked && (
                <>
                  <label className="mt-3 flex min-h-11 items-start gap-2"><input type="checkbox" className="mt-1 size-5" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="dup-workflow-sure" /><span>I have looked at both records and want them merged. I understand it cannot be undone.</span></label>
                  <button type="button" className={`${PRIMARY} mt-2`} disabled={!sure || busy} onClick={async () => { setBusy(true); try { setMsg(await onRun()); } finally { setBusy(false); } }} data-testid="dup-workflow-run">{busy ? "Sending..." : "Merge now"}</button>
                  {switchedOff && !msg && <p className="mt-2 text-xs text-muted-foreground">Sending is switched off on the server for now: confirming records a dry run and nothing reaches your CRM.</p>}
                </>
              )}
            </>
          )}
          {msg && <div className="mt-3" role="status" data-testid="dup-workflow-msg"><InlineAlert tone="info">{msg}</InlineAlert></div>}
        </div>
      )}
    </div>
  );
}
