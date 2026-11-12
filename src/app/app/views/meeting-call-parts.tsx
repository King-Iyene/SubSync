"use client";

import { Check, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { transcriptView, type TranscriptAnswer } from "@/lib/connections/transcript";
import { SkeletonRows } from "../ds";
import { ApiError, useApiClient } from "../session";
import { BTN, PRIMARY } from "./appointment-actions-ui";

// Two parts of the call side panel (Meetings): the transcript, read on demand from the person's OWN meeting tool, and the manual "Match to a contact" picker.
const errText = (e: unknown) => (e instanceof ApiError ? String(e.body.message ?? e.body.error ?? "Something went wrong") : "Something went wrong. Try again.");

/** The words of the call, fetched ON DEMAND when the person presses the button. Kept in this component's memory only: closing the panel drops it, and SubSync never stores it. */
export function TranscriptBox({ id, fx }: { id: string; fx: boolean }) {
  const api = useApiClient();
  const [answer, setAnswer] = useState<TranscriptAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const load = async () => {
    setAsked(true); setBusy(true);
    try { setAnswer(await api.get<TranscriptAnswer>(`meeting-list/${id}/transcript`)); }
    catch (e) { setAnswer({ state: "unavailable", reason: "unreachable", message: errText(e) }); }
    finally { setBusy(false); }
  };
  const v = transcriptView(asked && !busy ? answer : null, true);
  return (
    <section aria-label="Transcript" data-testid="mn-transcript">
      <h3 className="text-sm font-semibold">Transcript</h3>
      {!asked && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">Read from your meeting tool when you ask. SubSync does not keep it.</p>
          <button type="button" className={`${BTN} mt-2`} disabled={fx} onClick={() => void load()} data-testid="mn-transcript-show">Show the transcript</button>
        </>
      )}
      {asked && v.kind === "loading" && <SkeletonRows rows={3} label="Reading the transcript from your meeting tool" />}
      {v.kind === "message" && <p className="mt-1 text-sm text-muted-foreground" role="status" data-testid="mn-transcript-note">{v.text}</p>}
      {v.kind === "lines" && (
        <>
          <ol className="mt-2 max-h-96 space-y-2 overflow-y-auto rounded-xl border p-3 text-sm" data-testid="mn-transcript-lines">
            {v.lines.map((l, i) => <li key={i}><span className="font-medium">{l.speaker}</span>{l.at ? <span className="ml-2 text-xs tabular-nums text-muted-foreground">{l.at}</span> : null}<span className="block break-words leading-6">{l.text}</span></li>)}
          </ol>
          {answer?.state === "available" && answer.truncated && <p className="mt-1 text-xs text-muted-foreground">Only the first part is shown. Open the call link for the rest.</p>}
        </>
      )}
    </section>
  );
}

type PickHit = { locationId: string; contactId: string; name: string | null; email: string | null; phone: string | null; accountName: string; url: string };

/** "Match to a contact": search, choose, see exactly what will happen, then confirm. SubSync never picks the contact. Goes through the safe write gateway (a practice run unless writes are live). */
export function ManualMatch({ id, disabled, onDone }: { id: string; disabled: boolean; onDone: (text: string) => void }) {
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickHit[] | null>(null);
  const [picked, setPicked] = useState<PickHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const search = async () => {
    setBusy(true); setErr(null); setPicked(null);
    try { setHits((await api.get<{ results: PickHit[] }>(`meeting-inbox/${id}/contacts?q=${encodeURIComponent(q.trim())}`)).results); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!picked) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ dryRun: boolean }>(`meeting-inbox/${id}/link`, { locationId: picked.locationId, contactId: picked.contactId });
      onDone(r.dryRun ? `Matched to ${picked.name ?? "the contact"}. This is a practice run, so nothing was written to your CRM yet.` : `Matched. The note was added to ${picked.name ?? "the contact"}.`);
      setOpen(false);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" className={`${BTN} mt-3`} disabled={disabled} onClick={() => setOpen(true)} data-testid="mn-manual-open"><Search aria-hidden className="size-4" />Match to a contact</button>;
  return (
    <div className="mt-3 border-t pt-3" data-testid="mn-manual">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 text-xs text-muted-foreground">Name, email or phone
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim().length >= 2) void search(); }} placeholder="At least 2 letters" className="mt-1 min-h-11 w-full rounded-lg border bg-card px-3 text-sm text-foreground sm:min-h-10" data-testid="mn-manual-q" />
        </label>
        <button type="button" className={BTN} disabled={busy || q.trim().length < 2} onClick={() => void search()}>{busy && !picked ? "Searching..." : "Search"}</button>
        <button type="button" className="min-h-11 px-2 text-sm text-primary underline sm:min-h-9" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
      {hits && hits.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No contact found. Try part of the name or the email.</p>}
      {hits && hits.length > 0 && !picked && (
        <ul className="mt-2 divide-y rounded-lg border text-sm" data-testid="mn-manual-hits">
          {hits.map((h) => <li key={h.locationId + h.contactId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span className="min-w-0"><span className="font-medium">{h.name ?? "No name"}</span> <span className="text-muted-foreground">{h.email ?? h.phone ?? "no email"} | {h.accountName}</span></span><button type="button" className={BTN} onClick={() => setPicked(h)}>Choose</button></li>)}
        </ul>
      )}
      {picked && (
        <div className="mt-2 rounded-lg border p-3" data-testid="mn-manual-preview">
          <p className="text-sm font-medium">Put this call on {picked.name ?? "this contact"} in {picked.accountName}?</p>
          <p className="mt-1 text-xs text-muted-foreground">What will happen: the call is tied to this contact and its note is added to them. Nothing changes until you press Confirm. You chose the contact; SubSync did not guess.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void confirm()} data-testid="mn-manual-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}Confirm</button>
            <button type="button" className={BTN} onClick={() => setPicked(null)}>Pick someone else</button>
          </div>
        </div>
      )}
    </div>
  );
}
