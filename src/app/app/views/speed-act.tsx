"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Action } from "@/lib/ghl/workbench";
import { useData } from "../session";
import { ReviewSheet, useRunner, wbButtons } from "../ds/wb/runner";
import type { WbContext } from "../ds/wb/types";
import { INPUT } from "../ds/wb/runner";
import type { LeadRow } from "./speed-rows";

// Act on one lead without leaving Speed to lead: reply by text, email or WhatsApp (templates and merge fields come from the server), add a note, a task or a tag, give the lead to the
// person who replies fastest, or delete it (typed name). Every action goes to the server's one write gateway: it shows a preview first and, while the live switch is off, only records
// what WOULD have been sent. Nothing here decides whether a change is allowed.

const CHANNELS = [["SMS", "Text"], ["Email", "Email"], ["WhatsApp", "WhatsApp"]] as const;
type Channel = (typeof CHANNELS)[number][0];

export function ActSheet({ lead, onClose, onChanged }: { lead: LeadRow; onClose: () => void; onChanged: () => void }) {
  const ctx = useData<WbContext>(`workbench/context?locationId=${encodeURIComponent(lead.locationId)}&contactId=${encodeURIComponent(lead.contactId)}`);
  const run = useRunner(lead.locationId, lead.contactId, onChanged);
  const [channel, setChannel] = useState<Channel>("SMS");
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [tag, setTag] = useState("");
  const [more, setMore] = useState<null | "note" | "tag">(null);
  const [note, setNote] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const c = ctx.data;

  useEffect(() => { box.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const templates = (c?.templates ?? []).filter((t) => t.channel === channel || (channel === "SMS" && t.channel === "WhatsApp"));
  const reply = () => { const a: Action = { kind: "message", channel, text, ...(channel === "Email" ? { subject } : {}) }; void run.preview(a, { quote: text, verb: "Send" }); };
  const suggested = lead.unassigned && lead.suggestion?.userId ? lead.suggestion : null;
  const noContact = channel === "Email" ? !lead.email : !lead.phone;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-stretch sm:justify-end" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={`Reply to ${lead.name}`} data-testid="act-sheet" className="flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-2xl border bg-popover shadow-xl sm:max-h-none sm:w-[28rem] sm:rounded-none sm:border-y-0 sm:border-r-0">
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold" title={lead.name}>{lead.name}</h2>
            <p className="text-sm text-muted-foreground">{lead.locationName}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <div role="group" aria-label="How to reply" className="flex gap-2">
            {CHANNELS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={channel === k} onClick={() => setChannel(k)} data-testid={`act-channel-${k}`}
                className={`ds-press min-h-11 flex-1 rounded-lg border text-sm font-medium sm:min-h-10 ${channel === k ? "border-primary bg-accent" : "bg-card hover:border-primary/40"}`}>{label}</button>
            ))}
          </div>
          {noContact && <p className="text-sm text-muted-foreground" data-testid="act-nodest">{channel === "Email" ? "No email address for this person." : "No phone number for this person."}</p>}
          {templates.length > 0 && (
            <label className="block text-sm"><span className="sr-only">Start from a template</span>
              <select className={INPUT} defaultValue="" data-testid="act-template" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) { setText(t.text); if (t.subject) setSubject(t.subject); } }}>
                <option value="">Start from a template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          )}
          {channel === "Email" && <input className={INPUT} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" data-testid="act-subject" />}
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Write your reply" aria-label="Your reply" data-testid="act-text" className={`${INPUT} py-2`} />
          <button type="button" disabled={run.busy || !text.trim()} onClick={reply} className={wbButtons.PRIMARY} data-testid="act-preview">Preview the reply</button>
        </div>

        <ReviewSheet r={run} name={lead.name} />

        <div className="mt-auto space-y-2 border-t px-5 py-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {suggested && <button type="button" className={wbButtons.BTN} data-testid="act-assign" onClick={() => void run.preview({ kind: "owner", userId: suggested.userId as string }, { verb: "Assign" })}>Give to {suggested.label}</button>}
            <button type="button" className={wbButtons.BTN} onClick={() => setMore(more === "note" ? null : "note")} aria-expanded={more === "note"}>Add a note</button>
            <button type="button" className={wbButtons.BTN} onClick={() => void run.preview({ kind: "task", title: `Call ${lead.name}`, dueDate: new Date(Date.now() + 86_400_000).toISOString() }, { verb: "Create" })}>Task for tomorrow</button>
            <button type="button" className={wbButtons.BTN} onClick={() => setMore(more === "tag" ? null : "tag")} aria-expanded={more === "tag"}>Add a tag</button>
          </div>
          {more === "note" && <div className="flex gap-2"><input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Note" /><button type="button" disabled={!note.trim()} className={wbButtons.BTN} onClick={() => void run.preview({ kind: "note", text: note }, { quote: note, verb: "Add" })}>Preview</button></div>}
          {more === "tag" && <div className="flex gap-2"><input className={INPUT} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag" placeholder="Tag" /><button type="button" disabled={!tag.trim()} className={wbButtons.BTN} onClick={() => void run.preview({ kind: "tag_add", tag }, { verb: "Add" })}>Preview</button></div>}
          {c?.canDelete && <button type="button" className="ds-press min-h-11 rounded-lg px-2 text-sm text-destructive underline underline-offset-4 sm:min-h-9" data-testid="act-delete" onClick={() => void run.preview({ kind: "delete", confirmText: "" }, { verb: "Delete", typeName: lead.name })}>Delete this lead</button>}
        </div>
      </aside>
    </div>
  );
}
