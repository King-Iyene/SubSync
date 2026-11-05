"use client";

import { Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { timeAgo } from "../../ui";
import { Field, INPUT, wbButtons, type Runner } from "./runner";
import type { WbContext } from "./types";

// The update tab: everything you change about a person, one small block each (note, task, tags, owner, details, appointments, delete). Every block only asks the server for a preview;
// nothing is sent until the review sheet is confirmed.

const H = ({ children }: { children: ReactNode }) => <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
const Block = ({ title, children, testId }: { title: string; children: ReactNode; testId: string }) => <section className="border-t pt-4 first:border-t-0 first:pt-0" data-testid={testId}><H>{title}</H>{children}</section>;
const today = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const APPT_WORDS: Record<string, string> = { new: "Booked", confirmed: "Confirmed", showed: "Showed up", noshow: "No-show", cancelled: "Cancelled", invalid: "Invalid" };

export function UpdateTab({ ctx, runner }: { ctx: WbContext; runner: Runner }) {
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(today());
  const [taskOwner, setTaskOwner] = useState("");
  const [tag, setTag] = useState("");
  const [owner, setOwner] = useState(ctx.ownerId ?? "");
  const [f, setF] = useState(ctx.fields);
  const [nowMs] = useState(() => Date.now());
  const dirty = (Object.keys(f) as Array<keyof typeof f>).filter((k) => f[k].trim() !== ctx.fields[k].trim());

  return (
    <div className="space-y-5" data-testid="wb-update">
      <Block title="Add a note" testId="wb-note">
        <form onSubmit={(e) => { e.preventDefault(); void runner.preview({ kind: "note", text: note }, { quote: note, verb: "Add note" }); }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={5000} aria-label="Note" placeholder="What happened, what was promised..." className="block w-full rounded-lg border bg-background px-3 py-2.5 text-[15px] leading-relaxed" data-testid="wb-note-text" />
          <button type="submit" disabled={!note.trim() || runner.busy} className={`${wbButtons.BTN} mt-2`} data-testid="wb-note-go">Review note</button>
        </form>
      </Block>

      <Block title="Create a task" testId="wb-task">
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void runner.preview({ kind: "task", title, dueDate: `${due}T09:00:00`, ...(taskOwner ? { assignedTo: taskOwner } : {}) }, { quote: `${title}\nDue ${due}`, verb: "Create task" }); }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Call back about the quote" aria-label="Task title" className={INPUT} data-testid="wb-task-title" />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className={INPUT} />
            <select value={taskOwner} onChange={(e) => setTaskOwner(e.target.value)} aria-label="Assign to" className={INPUT}><option value="">Unassigned</option>{ctx.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </div>
          <button type="submit" disabled={!title.trim() || runner.busy} className={wbButtons.BTN} data-testid="wb-task-go">Review task</button>
        </form>
      </Block>

      <Block title="Tags" testId="wb-tags">
        {ctx.tags.length === 0 ? <p className="mb-2 text-[15px] text-muted-foreground">No tags yet.</p> : (
          <ul className="mb-2 flex flex-wrap gap-1.5">{ctx.tags.slice(0, 40).map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 text-sm">{t}
              <button type="button" aria-label={`Remove the tag ${t}`} onClick={() => void runner.preview({ kind: "tag_remove", tag: t }, { verb: "Remove tag" })} className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="wb-tag-remove"><X aria-hidden className="size-3.5" /></button>
            </li>))}
          </ul>
        )}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void runner.preview({ kind: "tag_add", tag }, { verb: "Add tag" }); setTag(""); }}>
          <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={60} placeholder="Add a tag" aria-label="New tag" className={INPUT} data-testid="wb-tag-input" />
          <button type="submit" disabled={!tag.trim() || runner.busy} className={wbButtons.BTN} aria-label="Add the tag" data-testid="wb-tag-add"><Plus aria-hidden className="size-4" />Add</button>
        </form>
      </Block>

      <Block title="Who owns this person" testId="wb-owner">
        <div className="flex gap-2">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={INPUT} data-testid="wb-owner-select"><option value="">{ctx.ownerId ? "Choose..." : "No owner"}</option>{ctx.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <button type="button" disabled={!owner || owner === ctx.ownerId || runner.busy} onClick={() => void runner.preview({ kind: "owner", userId: owner }, { verb: "Change owner" })} className={wbButtons.BTN} data-testid="wb-owner-go">Change</button>
        </div>
        {ctx.ownerName && <p className="mt-1 text-sm text-muted-foreground">Now: {ctx.ownerName}</p>}
      </Block>

      <Block title="Details" testId="wb-fields">
        <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); void runner.preview({ kind: "fields", fields: Object.fromEntries(dirty.map((k) => [k, f[k]])) }, { verb: "Save changes" }); }}>
          <Field label="First name"><input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} className={INPUT} maxLength={80} /></Field>
          <Field label="Last name"><input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} className={INPUT} maxLength={80} /></Field>
          <div className="col-span-2"><Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={INPUT} /></Field></div>
          <div className="col-span-2"><Field label="Phone"><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={INPUT} /></Field></div>
          <div className="col-span-2"><button type="submit" disabled={dirty.length === 0 || runner.busy} className={wbButtons.BTN} data-testid="wb-fields-go">Review changes</button></div>
        </form>
      </Block>

      {ctx.appointments.length > 0 && (
        <Block title="Appointments" testId="wb-appts">
          <ul className="space-y-2">
            {ctx.appointments.slice(0, 4).map((a) => (
              <li key={a.id} className="rounded-xl border p-3">
                <p className="text-[15px] font-medium">{a.title}<span className="font-normal text-muted-foreground"> · {a.at ? new Date(a.at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "no time"} · {APPT_WORDS[a.status ?? "new"] ?? a.status}</span></p>
                {a.at && new Date(a.at).getTime() < nowMs + 3_600_000 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([["showed", "Showed up"], ["noshow", "No-show"], ["cancelled", "Cancelled"]] as const).map(([k, l]) => <button key={k} type="button" disabled={a.status === k || runner.busy} onClick={() => void runner.preview({ kind: "appointment", appointmentId: a.id, status: k }, { verb: `Mark ${l.toLowerCase()}` })} className={wbButtons.BTN} data-testid={`wb-appt-${k}`}>{l}</button>)}
                  </div>
                )}
                {a.at && <p className="mt-1 text-xs text-muted-foreground">{timeAgo(a.at)}</p>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {ctx.canDelete && (
        <Block title="Danger zone" testId="wb-danger">
          <button type="button" onClick={() => void runner.preview({ kind: "delete", confirmText: "" }, { verb: "Delete forever", typeName: ctx.name })} className="min-h-11 rounded-lg border border-destructive/50 px-4 text-[15px] font-medium text-destructive hover:bg-destructive/10" data-testid="wb-delete">Delete this person...</button>
          <p className="mt-1 text-sm text-muted-foreground">Removes them, their conversation and their notes from your CRM. You will be asked to type their name.</p>
        </Block>
      )}
    </div>
  );
}
