"use client";

import { CalendarClock, CircleDollarSign, MessageSquare, Phone, Tag, UserPlus, Zap } from "lucide-react";
import { useState } from "react";
import { groupByDay, noteToSelf, type TimelineItem, type TimelineKind } from "@/lib/people/person";
import { useApiClient } from "../session";

// The pieces of the lead panel that have a life of their own: the timeline, "log this call" and "a note for your CRM". The panel (lead-drawer.tsx) assembles them.

const ICON: Record<TimelineKind, typeof Phone> = { contact: UserPlus, message: MessageSquare, call: Phone, appointment: CalendarClock, deal: CircleDollarSign, tag: Tag, touch: Zap, note: MessageSquare };
const KIND_WORD: Record<TimelineKind, string> = { contact: "Contact", message: "Message", call: "Call", appointment: "Appointment", deal: "Deal", tag: "Tag", touch: "First reply", note: "Note" };

const SHOWN = 8;

/** What happened, newest first, grouped by day. The first few; the rest behind one button. Every row says what kind of thing it is in words (not by its icon alone). */
export function Timeline({ items, nowMs, note }: { items: readonly TimelineItem[]; nowMs: number; note?: string | null }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  const groups = groupByDay(shown, nowMs);
  return (
    <section className="mt-6" aria-label="Timeline" data-testid="drawer-timeline">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.heading}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{g.heading}</p>
              <ol className="space-y-2.5 border-l pl-4">
                {g.items.map((t, i) => {
                  const Icon = ICON[t.kind] ?? MessageSquare;
                  return (
                    <li key={t.at + t.title + i} className="relative text-sm" data-kind={t.kind}>
                      <Icon aria-hidden className="absolute -left-[1.55rem] top-0.5 size-3.5 bg-popover text-muted-foreground" />
                      <p className="font-medium"><span className="sr-only">{KIND_WORD[t.kind]}: </span>{t.title}</p>
                      {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
      {items.length > SHOWN && <button type="button" onClick={() => setAll(!all)} className="mt-2 min-h-9 text-sm font-medium text-primary underline underline-offset-4" data-testid="timeline-more">{all ? "Show fewer" : `Show all ${items.length}`}</button>}
      {note && <p className="mt-2 text-xs text-muted-foreground" data-testid="drawer-live-note">{note}</p>}
    </section>
  );
}

const OUTCOMES: Array<[string, string]> = [["answered", "Answered"], ["voicemail", "Voicemail"], ["no_answer", "No answer"], ["wrong_number", "Wrong number"], ["booked", "Booked"], ["not_interested", "Not interested"], ["follow_up", "Follow up in 3 days"]];

type Reply = { ok: boolean; status: string; message: string; id?: string; canUndo?: boolean };
const BTN = "ds-press inline-flex min-h-11 cursor-pointer items-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9";

/** One tap to write down how a call went. It is saved on the contact in your CRM (a note, a tag, and for "follow up" a task) and on SubSync's own list, so the person leaves the call lists for 12 hours. */
export function LogCall({ locationId, contactId, onLogged }: { locationId: string; contactId: string; onLogged: (label: string) => void }) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [last, setLast] = useState<{ id: string; label: string } | null>(null);
  const log = async (outcome: string, label: string) => {
    if (busy) return;
    setBusy(true); setMsg({ text: "Saving...", ok: true });
    try {
      const r = await api.post<Reply>("people/outcome", { locationId, contactId, outcome });
      setMsg({ text: `${label}: ${r.message}`, ok: r.ok });
      if (r.ok) { onLogged(label); setLast(r.id ? { id: r.id, label } : null); }
    } catch (e) { setMsg({ text: (e as Error).message, ok: false }); }
    finally { setBusy(false); }
  };
  const undo = async () => {
    if (!last || busy) return;
    setBusy(true);
    try { const r = await api.post<Reply>("people/write-undo", { id: last.id }); setMsg({ text: r.message, ok: r.ok }); if (r.ok) setLast(null); }
    catch (e) { setMsg({ text: (e as Error).message, ok: false }); }
    finally { setBusy(false); }
  };
  return (
    <details className="mt-4 border-t pt-3" data-testid="log-call">
      <summary className="min-h-9 cursor-pointer text-sm font-medium">Log how the call went</summary>
      <p className="mt-1 text-xs text-muted-foreground">Saved as a note on this contact in your CRM (and a tag; a task for "Follow up in 3 days"). The person also leaves the call lists for 12 hours. Nothing is ever sent to them.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {OUTCOMES.map(([k, l]) => <button key={k} type="button" disabled={busy} onClick={() => void log(k, l)} className={BTN} data-testid={`log-${k}`}>{l}</button>)}
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? "text-muted-foreground" : "font-medium text-destructive"}`} role="status" data-testid="log-status">
          {msg.text}
          {last && <button type="button" disabled={busy} onClick={() => void undo()} className="ml-2 min-h-9 cursor-pointer font-medium underline" data-testid="log-undo">Undo</button>}
        </p>
      )}
    </details>
  );
}

/** A note typed here is saved to the contact in the CRM. "Copy note" stays as a fallback. */
export function NoteToSelf({ locationId, contactId, name, account }: { locationId: string; contactId: string; name: string; account: string | null }) {
  const api = useApiClient();
  const [text, setText] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "failed" | "copied"; text?: string; id?: string }>({ kind: "idle" });
  const save = async () => {
    if (!text.trim() || state.kind === "saving") return;
    setState({ kind: "saving" });
    try {
      const r = await api.post<Reply>("people/note", { locationId, contactId, text });
      if (r.status === "saved") { setText(""); setState({ kind: "saved", text: r.message, id: r.id }); }
      else setState({ kind: r.ok ? "saved" : "failed", text: r.message });
    } catch (e) { setState({ kind: "failed", text: (e as Error).message }); }
  };
  const undo = async () => {
    if (!state.id) return;
    try { const r = await api.post<Reply>("people/write-undo", { id: state.id }); setState({ kind: r.ok ? "idle" : "failed", text: r.message }); } catch (e) { setState({ kind: "failed", text: (e as Error).message }); }
  };
  const copy = async () => {
    const n = noteToSelf({ name, account, text, now: new Date() });
    if (!n) return;
    try { await navigator.clipboard.writeText(n); setState({ kind: "copied", text: "Copied." }); setTimeout(() => setState({ kind: "idle" }), 2500); } catch { window.prompt("Copy this note", n); }
  };
  return (
    <details className="mt-3 border-t pt-3" data-testid="note-to-self">
      <summary className="min-h-9 cursor-pointer text-sm font-medium">Add a note to this contact</summary>
      <label htmlFor="note-text" className="sr-only">Note about {name}</label>
      <textarea id="note-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} placeholder="What happened, what was promised..." className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" data-testid="note-text" />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!text.trim() || state.kind === "saving"} onClick={() => void save()} className={`${BTN} bg-primary text-primary-foreground hover:bg-primary/90`} data-testid="note-save">{state.kind === "saving" ? "Saving..." : "Save to your CRM"}</button>
        <button type="button" disabled={!text.trim()} onClick={() => void copy()} className={BTN} data-testid="note-copy">Copy note</button>
      </div>
      <p className={`mt-1 text-xs ${state.kind === "failed" ? "font-medium text-destructive" : "text-muted-foreground"}`} role="status" data-testid="note-status">
        {state.text ?? "Saved on this contact in your CRM, marked as added in SubSync."}
        {state.kind === "saved" && state.id && <button type="button" onClick={() => void undo()} className="ml-2 min-h-9 cursor-pointer font-medium underline" data-testid="note-undo">Undo</button>}
      </p>
    </details>
  );
}
