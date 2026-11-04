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

/** One tap to write down how a call went. It is SubSync's own record (it keeps the lists moving and feeds "last call"); nothing is sent to the CRM. */
export function LogCall({ locationId, contactId, onLogged }: { locationId: string; contactId: string; onLogged: (label: string) => void }) {
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const log = async (outcome: string, label: string) => {
    setBusy(true); setMsg(null);
    try { await api.post("people/outcome", { locationId, contactId, outcome }); setMsg(`Logged: ${label}.`); onLogged(label); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <details className="mt-4 border-t pt-3" data-testid="log-call">
      <summary className="min-h-9 cursor-pointer text-sm font-medium">Log how the call went</summary>
      <p className="mt-1 text-xs text-muted-foreground">SubSync keeps this on its own list so the person leaves the call lists for 12 hours. Nothing is sent to your CRM.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {OUTCOMES.map(([k, l]) => <button key={k} type="button" disabled={busy} onClick={() => void log(k, l)} className="ds-press inline-flex min-h-11 items-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50 sm:min-h-9" data-testid={`log-${k}`}>{l}</button>)}
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground" role="status">{msg}</p>}
    </details>
  );
}

/** A note to paste into the CRM by hand. SubSync writes nothing there, and does not keep what is typed. */
export function NoteToSelf({ name, account }: { name: string; account: string | null }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const n = noteToSelf({ name, account, text, now: new Date() });
    if (!n) return;
    try { await navigator.clipboard.writeText(n); setState("copied"); setTimeout(() => setState("idle"), 2500); } catch { setState("failed"); window.prompt("Copy this note", n); }
  };
  return (
    <details className="mt-3 border-t pt-3" data-testid="note-to-self">
      <summary className="min-h-9 cursor-pointer text-sm font-medium">Write a note to paste into your CRM</summary>
      <label htmlFor="note-text" className="sr-only">Note about {name}</label>
      <textarea id="note-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} placeholder="What happened, what was promised..." className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm" />
      <div className="mt-1 flex items-center gap-3">
        <button type="button" disabled={!text.trim()} onClick={() => void copy()} className="ds-press inline-flex min-h-11 items-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50 sm:min-h-9" data-testid="note-copy">Copy the note</button>
        <span className="text-xs text-muted-foreground" role="status">{state === "copied" ? "Copied. Paste it into the contact's notes in your CRM." : "SubSync does not save this or send it anywhere."}</span>
      </div>
    </details>
  );
}
