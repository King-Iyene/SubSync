"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { deletePhrase, mergePhrase, previewLine } from "@/lib/dq/dq-core";
import { LABEL_PRIMARY, LABEL_SECONDARY, MAKE_PRIMARY, NOTHING_DELETED, confirmReady, copyImpacts } from "@/lib/dq/dupe-impact";
import { ErrorState, SkeletonRows } from "../../ds";
import { InfoTip } from "../../ds/info-tip";
import { useApiClient } from "../../session";
import { fmtInt } from "../../ui";
import { FIELD, QUIET } from "../cleanup-parts";
import { sampleOn, type GroupRow } from "./dq-data";
import { ConsequencePanel, CopyCards, DiffTable, PickNote, useGroupDetail } from "./dq-merge-view";

// MERGE and DELETE for one duplicate group, in the CRM's own words. Cards per copy plus a side-by-side of only what differs; the primary contact is never guessed (master-rank.ts);
// a consequence panel and a tick come before the typed words; every disabled button says why in visible text.

const Q_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary";
const P_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const D_BTN = "ds-press inline-flex min-h-10 items-center justify-center rounded-lg border border-destructive/40 bg-card px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-destructive";
const Why = ({ children }: { children: React.ReactNode }) => <p className="mt-1 text-xs text-muted-foreground" data-testid="dq-disabled-why">{children}</p>;

export function MergeTable({ g, onGone }: { g: GroupRow; onGone: (key: string, msg: string) => void }) {
  const api = useApiClient();
  const ids = g.people.map((p) => p.contactId);
  const sample = sampleOn();
  const d = useGroupDetail(g);
  const [keep, setKeep] = useState<string | null>(null), [fields, setFields] = useState(false), [step, setStep] = useState<"idle" | "type" | "manual">("idle"), [typed, setTyped] = useState(""), [ticked, setTicked] = useState(false), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const det = d.data;
  if (d.loading && !det) return <div className="px-3 pb-4"><SkeletonRows rows={3} label="Loading the copies..." /></div>;
  if (d.error) return <div className="px-3 pb-4"><ErrorState error={d.error} onRetry={d.reload} /></div>;
  if (!det) return null;
  const primaryId = keep ?? d.pick?.suggestedId ?? null; // never "the first one": null until the ranking is sure or the person chooses
  const wf = det.workflow;
  const canWorkflow = wf.set && wf.optedIn && wf.canAsk && wf.blockers.length === 0 && det.people.length === 2 && !det.different;
  const me = det.people.find((p) => p.contactId === primaryId) ?? null;
  const others = det.people.filter((p) => p.contactId !== primaryId);
  const line = me ? previewLine({ keep: { tags: me.tags }, others: others.map((o) => ({ tags: o.tags, openDeals: o.openDeals, wonDeals: o.wonDeals, appointments: o.appointments, hasConversation: o.hasConversation })) }) : "Choose the primary contact to see what a merge will move.";
  const phrase = mergePhrase(me?.name ?? "");
  const typedOk = !!me && typed.trim().toLowerCase() === phrase.toLowerCase();
  const impacts = copyImpacts(d.people, primaryId);
  const decide = async (decision: "keep" | "merged_in_platform" | "not_duplicate", m: string) => {
    setBusy(true); setMsg(null);
    try { if (!sample) await api.post("dq/decide", { locationId: g.locationId, contactIds: ids, decision, keepContactId: decision === "not_duplicate" ? null : primaryId }); onGone(g.key, m); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!primaryId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<{ ok?: boolean; message?: string; blocked?: boolean }>("duplicates/merge-workflow", { locationId: g.locationId, contactIds: ids, keepContactId: primaryId, typed, confirm: true });
      if (r.ok) onGone(g.key, r.message ?? "Sent to your merge workflow.");
      else setMsg(r.message ?? "This one cannot be merged from here.");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(`Primary contact: ${me?.name} (${me?.email ?? "no email"}, ${me?.phone ?? "no phone"}). Secondary contacts to merge in: ${others.map((o) => o.name).join(", ")}.`); setMsg("Copied."); } catch { setMsg("Could not copy."); } };

  return (
    <div className="space-y-3 border-t bg-muted/20 px-3 py-4" data-testid="dq-merge-table">
      {det.different && <p className="text-sm text-destructive" role="alert">These look like different people (a different email and a different phone). Check before you merge.</p>}
      <PickNote pick={d.pick} people={d.people} />
      <CopyCards people={d.people} primaryId={primaryId} pick={d.pick} onPick={setKeep} name={`keep-${g.key}`} />
      <DiffTable people={d.people} primaryId={primaryId} />
      <p className="text-sm" data-testid="dq-preview-line">{line} <InfoTip text="A merge cannot be undone. Conversations, notes and tasks are combined into the primary contact; appointments and payments keep the primary contact's values." label="What a merge does" /></p>
      {det.guard.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{det.guard.map((t) => <li key={t}>{t}</li>)}</ul>}
      <ConsequencePanel people={d.people} primaryId={primaryId} ticked={ticked} onTick={setTicked} />
      <ul className="space-y-1 text-xs" data-testid="dq-impacts">{impacts.filter((i) => i.role === "merge").map((i) => {
        const p = d.people.find((x) => x.contactId === i.contactId)!;
        return <li key={i.contactId}><b>{p.name}</b> ({LABEL_SECONDARY}){i.lost.length ? `. Replaced by the primary's value: ${i.lost.join("; ")}.` : ". No values are replaced."}</li>;
      })}</ul>

      {fields && (
        <div className="rounded-lg border bg-card p-3" data-testid="dq-fields">
          <p className="mb-2 text-xs text-muted-foreground">Best value for each field. Pick these in your CRM&apos;s merge screen if the merge is finished there.</p>
          <ul className="space-y-1.5 text-sm">{det.picks.map((p) => <li key={p.field} className="flex flex-wrap gap-x-2"><b className="w-20">{p.label}</b><span>{p.value}</span><span className="text-xs text-muted-foreground">{p.reason}</span></li>)}</ul>
          {det.picks.length === 0 && <p className="text-sm text-muted-foreground">Nothing to choose: the records agree.</p>}
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={P_BTN} disabled={busy || !primaryId || (canWorkflow && det.different)} onClick={() => setStep(canWorkflow ? "type" : "manual")} data-testid="dq-merge-go">Merge into the primary contact</button>
          <button type="button" className={Q_BTN} disabled={busy} onClick={() => void decide("keep", "Both kept. They will not come back.")} data-testid="dq-keepboth">Keep both</button>
          <button type="button" className={QUIET} onClick={() => setFields((f) => !f)} data-testid="dq-choose-fields">{fields ? "Hide fields" : "Choose fields"}</button>
        </div>
        {!primaryId && <Why>Choose the primary contact first: pick &quot;{MAKE_PRIMARY}&quot; on one card.</Why>}
      </div>

      {step === "type" && (
        <div className="rounded-lg border bg-card p-3" data-testid="dq-merge-type">
          <label htmlFor={`dq-t-${g.key}`} className="mb-1 block text-xs text-muted-foreground">Type <b>{phrase}</b> to confirm. This cannot be undone.</label>
          <div className="flex flex-wrap gap-2"><input id={`dq-t-${g.key}`} className={`${FIELD} w-64`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <button type="button" className={P_BTN} disabled={!confirmReady({ typedOk, ticked, primaryId, busy })} onClick={() => void send()} data-testid="dq-merge-confirm">{busy ? "Sending..." : "Merge"}</button></div>
          {!confirmReady({ typedOk, ticked, primaryId, busy: false }) && <Why>{!primaryId ? "Choose the primary contact first." : !ticked ? "Tick the box above to say you checked payments, bookings and automations." : "Type the words above exactly to turn this on."}</Why>}
          {!wf.switchOn && <p className="mt-2 text-xs text-muted-foreground">Not switched on yet: SubSync records what it would do and changes nothing.</p>}
        </div>
      )}
      {step === "manual" && (
        <div className="rounded-lg border bg-card p-3 text-sm" data-testid="dq-merge-manual">
          <p className="font-medium">Not available from the platform yet.</p>
          <p className="text-muted-foreground">{wf.blockers[0] ?? `The CRM has no merge command SubSync can use. Finish it in your CRM's own merge screen: open the copies, choose Merge, and make ${me?.name ?? "the primary contact"} the primary contact (${LABEL_PRIMARY}).`}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {det.people.map((p) => <a key={p.contactId} href={p.url} target="_blank" rel="noopener noreferrer" className={Q_BTN}><ExternalLink aria-hidden className="mr-1.5 size-3.5" />Open {p.name.split(" ")[0]}</a>)}
            <button type="button" className={Q_BTN} onClick={() => void copy()}>Copy summary</button>
            <button type="button" className={Q_BTN} disabled={busy || !ticked} onClick={() => void decide("merged_in_platform", "Marked as merged in your CRM.")} data-testid="dq-merged-done">I merged them</button>
          </div>
          {!ticked && <Why>Tick the box above first: it says you checked payments, bookings and automations.</Why>}
        </div>
      )}
      {msg && <p className="text-sm text-muted-foreground" role="status">{msg}</p>}
    </div>
  );
}

export function DeleteExtras({ g, onGone }: { g: GroupRow; onGone: (key: string, msg: string) => void }) {
  const api = useApiClient();
  const ids = g.people.map((p) => p.contactId);
  const d = useGroupDetail(g);
  const [keep, setKeep] = useState<string | null>(null);
  const keepId = keep ?? d.pick?.suggestedId ?? null; // never "the first one"
  const sample = sampleOn();
  type Pv = { requested: number; protectedSkipped: number; names: string[]; phrase: string; mode: "dry_run" | "live"; warning: string; notes: string[] };
  const [pvLive, setPv] = useState<Pv | null>(null);
  const [typed, setTyped] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const body = (step: "preview" | "do") => ({ step, locationId: g.locationId, contactIds: ids, keepContactId: keepId, ...(step === "do" ? { typed } : {}) });
  const impacts = copyImpacts(d.people, keepId);
  const del = impacts.filter((i) => i.canDelete), nameOf = (id: string) => d.people.find((p) => p.contactId === id)?.name ?? "";
  // Sample data: the plan is worked out here from the same rules; live data asks the server, which re-reads protection at that moment.
  const pvSample: Pv | null = sample && keepId ? { requested: del.length, protectedSkipped: impacts.filter((i) => i.role === "merge" && !i.canDelete).length, names: del.map((i) => nameOf(i.contactId)), phrase: deletePhrase(del.length, del[0] ? nameOf(del[0].contactId) : undefined), mode: "dry_run", warning: "This cannot be undone.", notes: [] } : null;
  const pv = sample ? pvSample : pvLive;
  useEffect(() => {
    if (!keepId || sample) return;
    void api.post<Pv>("dq/delete", body("preview")).then(setPv).catch((e: Error) => setMsg(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepId, d.data]);
  const go = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ message: string; mode: string; done: number }>("dq/delete", body("do")); if (r.mode === "live" && r.done > 0) onGone(g.key, r.message); else setMsg(r.message); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (d.loading && !d.data) return <div className="px-3 pb-4"><SkeletonRows rows={2} label="Checking who can be deleted..." /></div>;
  const nobody = !!pv && pv.requested === 0;
  const ok = !!pv && typed.trim().toLowerCase() === pv.phrase.toLowerCase();
  return (
    <div className="space-y-3 border-t bg-muted/20 px-3 py-4" data-testid="dq-delete-panel">
      <PickNote pick={d.pick} people={d.people} />
      <fieldset><legend className="mb-1 text-sm font-medium">Which copy stays? The others are deleted if they can be.</legend>
        <div className="flex flex-wrap gap-3">{d.people.map((p) => <label key={p.contactId} className="flex items-center gap-2 text-sm"><input type="radio" className="size-4" name={`del-${g.key}`} checked={keepId === p.contactId} onChange={() => { setKeep(p.contactId); setPv(null); setTyped(""); }} />{p.name}{p.email ? <span className="text-xs text-muted-foreground">{p.email}</span> : null}</label>)}</div>
        {!keepId && <Why>Choose which copy stays first. SubSync does not guess.</Why>}
      </fieldset>
      {keepId && (
        <ul className="space-y-2 text-sm" data-testid="dq-delete-plan">
          {impacts.map((i) => {
            const p = d.people.find((x) => x.contactId === i.contactId)!;
            return (
              <li key={i.contactId} className="rounded-lg border bg-card p-3" data-testid="dq-delete-copy" data-fate={i.role === "keep" ? "kept" : i.canDelete ? "deleted" : "protected"}>
                <p><b>{p.name}</b> <span className="text-xs text-muted-foreground">{i.role === "keep" ? `${LABEL_PRIMARY}: stays` : i.canDelete ? "Will be deleted" : "Cannot be deleted"}</span></p>
                {i.role === "merge" && !i.canDelete && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{i.cannotDelete.map((r) => <li key={r}>{r}</li>)}</ul>}
                {i.role === "merge" && i.canDelete && <p className="mt-1 text-xs text-muted-foreground">Their values are lost, not moved: {i.lost.length ? i.lost.join("; ") : "nothing the primary does not already have"}. Tags, notes and tasks on this copy are lost too. Merge instead to move them.</p>}
              </li>
            );
          })}
        </ul>
      )}
      {keepId && !pv && !msg && <SkeletonRows rows={1} label="Checking who can be deleted..." />}
      {pv && (
        <div className="space-y-2 text-sm">
          {nobody ? <p className="font-medium" data-testid="dq-nothing-deleted">{NOTHING_DELETED}</p> : <p><b>{fmtInt(pv.requested)}</b> {pv.requested === 1 ? "contact" : "contacts"} will be deleted{pv.names.length ? `: ${pv.names.join(", ")}` : ""}. {pv.warning}</p>}
          {pv.protectedSkipped > 0 && !nobody && <p className="text-muted-foreground">{pv.protectedSkipped} left out because they are protected.</p>}
          {pv.notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
          {pv.mode === "dry_run" && <p className="text-xs text-muted-foreground">Not switched on yet: SubSync shows the plan and deletes nothing.</p>}
          {pv.requested > 0 && (
            <div><div className="flex flex-wrap items-end gap-2"><div><label htmlFor={`dq-d-${g.key}`} className="mb-1 block text-xs text-muted-foreground">Type <b>{pv.phrase}</b> to confirm</label><input id={`dq-d-${g.key}`} className={`${FIELD} w-64`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></div>
              <button type="button" className={D_BTN} disabled={busy || !ok} onClick={() => void go()} data-testid="dq-delete-confirm">{busy ? "Deleting..." : "Delete"}</button></div>
              {!ok && <Why>Type the words above exactly to turn Delete on.</Why>}</div>
          )}
        </div>
      )}
      {msg && <p className="text-sm text-muted-foreground" role="status">{msg}</p>}
    </div>
  );
}
