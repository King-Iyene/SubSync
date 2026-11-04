"use client";

import { useState, type FormEvent } from "react";
import { NOTE_KIND_LABEL, NOTE_KINDS, NOTE_MAX, type NoteKind } from "@/lib/analytics/client-success";
import { useApiClient, useData } from "../../session";
import { Btn, ErrorBox, inputClass, Loading } from "../../ui";

// The log of conversations and notes with one client (N58): who spoke to the client, what was said or decided, and when. Typed by the team, private, never shown to the client and
// never sent to the CRM. It sits on the client's page; "I spoke to them today" and a logged conversation both move "last spoken".
const today = () => new Date().toISOString().slice(0, 10);
const when = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Note = { id: string; kind: string; body: string; author: string | null; occurredOn: string; createdAt: string };
export function ClientLog({ locationId, name, reload }: { locationId: string; name: string | null; reload: () => void }) {
  const api = useApiClient();
  const { data, error, loading, reload: reloadNotes } = useData<{ notes: Note[] }>(`clients/${locationId}/notes`);
  const [kind, setKind] = useState<NoteKind>("conversation");
  const [on, setOn] = useState(today());
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await reloadNotes(); reload(); setMsg(done); return true; } catch (e) { setMsg((e as Error).message); return false; } finally { setBusy(false); }
  };
  return (
    <div className="mt-1 border-l-2 border-primary pl-4" data-testid="client-log">
      <p className="text-sm font-medium">Conversations and notes with {(name ?? "this client")}</p>
      <p className="mb-3 text-xs text-muted-foreground">A private log for your team: who spoke to the client, what was said or decided, and when. It is never shown to the client and never sent to your CRM.</p>
      <form className="mb-4 grid gap-2 sm:grid-cols-[10rem_10rem_1fr]" onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await run(() => api.post(`clients/${locationId}/notes`, { kind, occurredOn: on, body }), "Added to the log.")) setBody(""); }}>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`k-${locationId}`}>What it is</label><select id={`k-${locationId}`} className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>{NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_LABEL[k]}</option>)}</select></div>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`d-${locationId}`}>When</label><input id={`d-${locationId}`} type="date" className={inputClass} value={on} max={today()} onChange={(e) => setOn(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs text-muted-foreground" htmlFor={`b-${locationId}`}>What was said or decided</label><textarea id={`b-${locationId}`} className={`${inputClass} min-h-16`} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Agreed to move the review to Friday" /></div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          <Btn type="submit" variant="primary" disabled={busy || !body.trim()}>Add to the log</Btn>
          <Btn disabled={busy} onClick={() => run(() => api.put(`clients/${locationId}`, { markContacted: true }), "Logged: you spoke to them today.")}>I spoke to them today</Btn>
          {msg && <span className="text-sm text-muted-foreground" role="status">{msg}</span>}
        </div>
      </form>
      {loading && !data && <Loading />}
      {error && <ErrorBox error={error} onRetry={reloadNotes} />}
      {data && data.notes.length === 0 && <p className="text-sm text-muted-foreground">Nothing logged yet. Add the last conversation you had with this client so the next person knows where things stand.</p>}
      {data && data.notes.length > 0 && (
        <ul className="divide-y text-sm" aria-label="Log entries">
          {data.notes.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{when(n.occurredOn)} · {NOTE_KIND_LABEL[n.kind as NoteKind] ?? n.kind}{n.author ? ` · ${n.author}` : ""}</p>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </div>
              <button type="button" className="min-h-9 text-xs text-muted-foreground underline hover:text-destructive" onClick={() => run(() => api.del(`clients/${locationId}/notes?id=${n.id}`), "Removed from the log.")}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

