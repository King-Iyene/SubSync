"use client";

import { useState } from "react";
import type { Guardrail } from "@/lib/analytics/dedupe-review";
import type { Person } from "@/lib/analytics/dedupe";
import type { FieldPick } from "@/lib/analytics/cleanup-rules";
import { DialButton, InlineAlert } from "../ds";
import { useApiClient, useData } from "../session";
import { ExtLink, timeAgo } from "../ui";
import { Avatar, BTN, PRIMARY, ScoreMeter } from "./cleanup-parts";

const STRICTNESS: Record<string, string> = { strict: "Careful", balanced: "Normal", loose: "Thorough", custom: "Your own mix" };

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
      <ScoreMeter score={confidence} word={likelihood} label="How sure we are" testId="dup-score" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">Why these match</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-muted-foreground" data-testid="dup-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="dup-rules-note">How careful we are: {STRICTNESS[rules.preset] ?? "Normal"}. {rules.sentence}</p>
        {pairs.length > 1 && (
          <details className="mt-1" data-testid="dup-pairs">
            <summary className="min-h-9 cursor-pointer text-sm text-muted-foreground">How sure for each pair</summary>
            <ul className="mt-1 space-y-1 text-sm">{pairs.map((x) => <li key={x.a + x.b}><span className="font-medium tabular-nums">{x.score}</span> · {nameOf(x.a)} and {nameOf(x.b)}{x.reasons.length ? <span className="text-muted-foreground">: {x.reasons.join("; ").toLowerCase()}</span> : null}</li>)}</ul>
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
                  <button type="button" className={`${PRIMARY} mt-2`} disabled={!sure || busy} onClick={async () => { setBusy(true); try { setMsg(await onRun()); } finally { setBusy(false); } }} data-testid="dup-workflow-run">{busy ? "Sending..." : "Start the merge"}</button>
                  {switchedOff && !msg && <p className="mt-2 text-sm text-muted-foreground">Sending is switched off on the server for now: confirming records a dry run and nothing reaches your CRM.</p>}
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

// ---------- one person, as a card ----------

const when = (iso: string | null) => (iso ? timeAgo(iso) : null);

/** One of the two records as a card: initials, name, and only what differs from the other record (what is identical is said once, under the cards). */
export function PersonCard({ p, i, keep, best, locked, differ, onKeep, onShow }: { p: Person & { url: string }; i: number; keep: boolean; best: boolean; locked: boolean; differ: ReadonlySet<string>; onKeep: () => void; /** Opens the shared lead panel (full details, conversation, actions) for this record. */ onShow?: () => void }) {
  const rows: Array<[string, string | null]> = [];
  if (differ.has("phone")) rows.push(["Phone", p.phone?.trim() || null]);
  if (differ.has("email")) rows.push(["Email", p.email?.trim() || null]);
  if (differ.has("owner")) rows.push(["Belongs to", p.ownerName ?? (p.ownerId ? `Team member ${p.ownerId.slice(-4)}` : null)]);
  if (differ.has("source")) rows.push(["Came from", p.source?.trim() || null]);
  if (differ.has("tags")) rows.push(["Tags", p.tags.length ? p.tags.join(", ") : null]);
  rows.push(["Last activity", when(p.lastActivityAt) ?? "none seen"]);
  if (differ.has("deals") || p.openDeals > 0 || p.wonDeals > 0) rows.push(["Deals", p.openDeals || p.wonDeals ? `${p.openDeals} open, ${p.wonDeals} won` : null]);
  if (differ.has("conversation")) rows.push(["Conversation", p.hasConversation ? "Yes" : null]);
  if (p.dnd) rows.push(["Do Not Disturb", "Yes"]);
  return (
    <li className={`min-w-0 rounded-xl border bg-card p-4 transition-all duration-200 hover:shadow-md focus-within:ring-2 focus-within:ring-ring/50 motion-reduce:transition-none ${keep ? "border-primary ring-1 ring-primary/40" : ""}`} data-testid="dup-record" data-keep={keep ? "true" : "false"}>
      <div className="flex items-center gap-3">
        <Avatar name={p.name} tone={i} />
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold leading-tight">{p.name}</p>
          <p className="text-sm text-muted-foreground">Added {when(p.createdAt) ?? "a while ago"}{best ? " · the best one to keep" : ""}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 border-l-2 border-primary/60 pl-2">
            <dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v ?? <span className="text-muted-foreground">none</span>}</dd>
          </div>
        ))}
      </dl>
      <label className={`mt-3 flex min-h-11 items-center gap-2 text-sm ${locked ? "" : "cursor-pointer"}`}>
        <input type="radio" name="dup-keep" className="size-5 shrink-0" checked={keep} disabled={locked} onChange={onKeep} aria-label={`Keep ${p.name} (record ${String.fromCharCode(65 + i)})`} data-testid="dup-keep-radio" />
        <span>{keep ? "Keep this one" : "Keep this one instead"}</span>
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
        {onShow && <button type="button" onClick={onShow} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 sm:min-h-9" data-testid="dup-show">Show lead</button>}
        <DialButton compact phone={p.phone} contactUrl={p.url} dnd={p.dnd === true} />
        <ExtLink href={p.url}>Open contact</ExtLink>
      </div>
    </li>
  );
}

// ---------- new arrivals that may already exist (real-time prevention) ----------

type Arrival = { id: string; locationName: string | null; newName: string | null; otherName: string | null; score: number; tier: string; reasons: string[]; newUrl: string; otherUrl: string };

/** "Possible duplicate of X": contacts that arrived in the last two weeks and look like one the client already has. Each can be opened or dismissed with one click. */
export function ArrivalsCard({ multi }: { multi: boolean }) {
  const api = useApiClient();
  const { data, reload } = useData<{ rows: Arrival[] }>("duplicates/arrivals");
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || data.rows.length === 0) return null;
  const dismiss = async (id: string) => { setBusy(id); try { await api.post("duplicates/arrivals-dismiss", { id }); await reload(); } finally { setBusy(null); } };
  return (
    <section className="mb-6 rounded-xl border bg-card p-4" data-testid="arrivals" aria-label="New contacts that may already exist">
      <h2 className="text-lg font-semibold">New contacts that may already exist</h2>
      <p className="text-sm text-muted-foreground">Spotted within seconds of arriving. Nothing was changed.</p>
      <ul className="mt-2">
        {data.rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t py-3" data-testid="arrival">
            <div className="min-w-0">
              <p className="break-words text-base font-medium">{r.newName ?? "A new contact"} <span className="font-normal text-muted-foreground">may be</span> {r.otherName ?? "an existing contact"}</p>
              <p className="text-sm text-muted-foreground">{r.tier === "sure" ? "Almost certainly the same person" : "Very likely the same person"}{multi && r.locationName ? ` · ${r.locationName}` : ""} · {r.reasons.slice(0, 2).join(", ").toLowerCase()}</p>
            </div>
            <div className="flex items-center gap-1">
              <ExtLink href={r.otherUrl}>Open the first</ExtLink>
              <button type="button" className={BTN} disabled={busy === r.id} onClick={() => void dismiss(r.id)} data-testid="arrival-dismiss">Not the same<span className="sr-only"> ({r.newName ?? "new contact"})</span></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
