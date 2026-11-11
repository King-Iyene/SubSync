"use client";

import { ExternalLink, FileText, Repeat2, Pencil, Trash2, CalendarClock, Video, X, Sparkles, StickyNote } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApptAction, OutcomeChoice } from "@/lib/analytics/appointment-actions";
import { fmt } from "@/lib/analytics/appointment-actions";
import { ErrorState, SkeletonRows } from "../ds";
import { ApiError, useApiClient, useData } from "../session";
import { BTN, ChangeFlow, ModeLine, OUTCOME_CHOICES_UI, outcomeLabel, OwnerDrop, PersonChip, PRIMARY, RebookFlow, RescheduleFlow, UndoButton, type Mode } from "./appointment-actions-ui";

// The appointment panel (slice AB): the right-side panel the integrator mounts when a row is clicked, `<AppointmentPanel locationId id onClose onChanged />`. It shows what happened and
// every action: outcome, move (with the best free slots), change owner (drag a person onto the owner, or tap), edit, book again, delete (typed confirmation), the full change timeline with
// a short Undo, and the person's own recorded call with its summary, next step and a one-tap suggested outcome. Everything it shows comes from one request that the server limits to
// the accounts the person may read.

type Panel = {
  appointment: { id: string; locationId: string; locationName: string | null; calendarId: string | null; calendar: string | null; title: string | null; status: string | null; statusWord: string; startAt: string | null; endAt: string | null; timeZone: string | null };
  contact: { contactId: string; name: string; phone: string | null; email: string | null; dnd: boolean; source: string | null; url: string } | null;
  owner: { id: string | null; name: string }; booker: { id: string | null; name: string; channel: string | null; at: string | null };
  deal: { name: string | null; status: string | null; value: number | null } | null; reminders: { sent: number; lastAt: string | null } | null;
  timeline: Array<{ at: string; source: "subsync" | "crm"; text: string; batchId: string | null; undoable: boolean }>;
  team: Array<{ id: string; name: string }>; calendars: Array<{ id: string; name: string }>;
  meeting: { id: string; title: string | null; startedAt: string | null; summary: string | null; actionItems: string[]; nextStep: string | null; recordingUrl: string | null; outcomeConfirmed: boolean; suggested: string | null } | null;
  meetingConnected: boolean; suggestion: { outcome: "showed" | "noshow"; confidence: "high" | "low"; why: string } | null;
  can: { edit: boolean; reassign: boolean; del: boolean; mark: boolean }; mode: Mode; needsPermission: boolean; undoMinutes: number;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STATUS_TONE: Record<string, string> = { Showed: "bg-emerald-500/15 text-emerald-600", "No-show": "bg-destructive/15 text-destructive", Cancelled: "bg-muted text-muted-foreground", Invalid: "bg-muted text-muted-foreground", Confirmed: "bg-primary/15 text-primary", Booked: "bg-primary/15 text-primary" };

export function AppointmentPanel({ locationId, id, onClose, onChanged }: { locationId: string; id: string; onClose: () => void; onChanged?: () => void }) {
  const { data, error, loading, reload } = useData<Panel>(`appointments/act/panel?locationId=${encodeURIComponent(locationId)}&id=${encodeURIComponent(id)}`);
  const api = useApiClient();
  const [flow, setFlow] = useState<null | { kind: "action"; action: ApptAction; title: string; fromMeeting?: boolean } | { kind: "move" } | { kind: "rebook" } | { kind: "note" }>(null);
  const changed = () => { void reload(); onChanged?.(); };
  const close = () => setFlow(null);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l bg-card/80 shadow-[-12px_0_40px_-30px_var(--primary)] backdrop-blur sm:max-w-md" aria-label="Appointment details" data-testid="appt-panel">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{data?.contact?.name ?? "Appointment"}</h2>
          {data && <p className="truncate text-xs text-muted-foreground">{data.appointment.startAt ? fmt(data.appointment.startAt, data.appointment.timeZone) : "No time"}{data.appointment.calendar ? `, ${data.appointment.calendar}` : ""}{data.appointment.locationName ? ` | ${data.appointment.locationName}` : ""}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="ds-press inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted sm:size-9"><X aria-hidden className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {loading && !data ? <SkeletonRows rows={5} label="Loading the appointment" /> : error ? <ErrorState error={error} onRetry={reload} /> : data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[data.appointment.statusWord] ?? STATUS_TONE.Booked}`} data-testid="appt-panel-status">{data.appointment.statusWord}</span>
              {data.contact?.dnd && <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">Asked not to be contacted</span>}
              {data.contact && <a href={data.contact.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-4 sm:min-h-8">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
            </div>

            {data.suggestion && data.can.mark && !data.meeting?.outcomeConfirmed && (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 shadow-[0_0_24px_-12px_var(--primary)]" data-testid="appt-suggestion">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles aria-hidden className="size-4 text-primary" />Suggested: {outcomeLabel(data.suggestion.outcome)}{data.suggestion.confidence === "low" ? " (not sure)" : ""}</p>
                <p className="mt-1 text-xs text-muted-foreground">{data.suggestion.why} Nothing changes until you confirm.</p>
                <button type="button" className={`${PRIMARY} mt-2`} onClick={() => setFlow({ kind: "action", action: { kind: "status", status: data.suggestion!.outcome }, title: `Mark as ${outcomeLabel(data.suggestion!.outcome).toLowerCase()}`, fromMeeting: true })} data-testid="appt-suggestion-confirm">Confirm {outcomeLabel(data.suggestion.outcome).toLowerCase()}</button>
              </div>
            )}

            {data.can.mark && (
              <section aria-label="Set the outcome">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome</h3>
                <div className="flex flex-wrap gap-2">{OUTCOME_CHOICES_UI.map((o: OutcomeChoice) => <button key={o} type="button" className={BTN} onClick={() => setFlow({ kind: "action", action: { kind: "status", status: o }, title: `Mark as ${outcomeLabel(o).toLowerCase()}` })} data-testid={`appt-set-${o}`}>{outcomeLabel(o)}</button>)}</div>
              </section>
            )}

            <section aria-label="Actions" className="flex flex-wrap gap-2">
              {data.can.edit && <button type="button" className={BTN} onClick={() => setFlow({ kind: "move" })} data-testid="appt-move"><CalendarClock aria-hidden className="size-4" />Move</button>}
              {data.can.edit && data.contact && <button type="button" className={BTN} onClick={() => setFlow({ kind: "rebook" })} data-testid="appt-rebook-btn"><Repeat2 aria-hidden className="size-4" />Book again</button>}
              {data.can.edit && <EditTitle data={data} onGo={(title) => setFlow({ kind: "action", action: { kind: "edit", title }, title: "Change the title" })} />}
              {data.can.del && <button type="button" className={`${BTN} text-destructive`} onClick={() => setFlow({ kind: "action", action: { kind: "delete", typed: "" }, title: "Delete appointment" })} data-testid="appt-delete"><Trash2 aria-hidden className="size-4" />Delete</button>}
            </section>

            <section aria-label="Who">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner and booker</h3>
              {data.can.reassign ? (
                <>
                  <OwnerDrop ownerName={data.owner.name} onDropPerson={(uid) => setFlow({ kind: "action", action: { kind: "reassign", userId: uid }, title: "Change the owner" })} />
                  {data.team.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{data.team.slice(0, 12).map((t) => <PersonChip key={t.id} id={t.id} name={t.name} active={t.id === data.owner.id} onPick={(uid) => uid !== data.owner.id && setFlow({ kind: "action", action: { kind: "reassign", userId: uid }, title: "Change the owner" })} />)}</div> : <p className="mt-1 text-xs text-muted-foreground">No team list yet, so the owner cannot be changed from here.</p>}
                </>
              ) : <p className="text-sm"><span className="text-muted-foreground">Owner </span><b>{data.owner.name}</b></p>}
              <p className="mt-1 text-sm"><span className="text-muted-foreground">Booked by </span><b>{data.booker.id ? data.booker.name : data.booker.channel ?? "not recorded"}</b>{data.booker.at ? <span className="text-xs text-muted-foreground"> on {fmt(data.booker.at, data.appointment.timeZone)}</span> : null}</p>
            </section>

            <section aria-label="Deal and reminders" className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border p-2.5"><p className="text-xs text-muted-foreground">Deal</p>{data.deal ? <p className="font-medium">{data.deal.status ?? "open"}{data.deal.value ? `, ${money(data.deal.value)}` : ""}</p> : <p className="text-muted-foreground">None linked</p>}</div>
              <div className="rounded-lg border p-2.5"><p className="text-xs text-muted-foreground">Reminders</p>{data.reminders ? <p className="font-medium">{data.reminders.sent === 0 ? "None sent" : `${data.reminders.sent} sent before`}</p> : <p className="text-muted-foreground">Not known</p>}</div>
            </section>

            <MeetingCard data={data} onNote={() => setFlow({ kind: "note" })} />

            <section aria-label="Change timeline">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What happened</h3>
              {data.timeline.length === 0 ? <p className="text-sm text-muted-foreground">No changes recorded yet.</p> : (
                <ol className="relative space-y-3 border-l pl-4" data-testid="appt-timeline">
                  {data.timeline.map((t, i) => (
                    <li key={`${t.at}-${i}`} className="relative text-sm">
                      <span aria-hidden className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${t.source === "subsync" ? "bg-primary shadow-[0_0_10px_var(--primary)]" : "bg-muted-foreground/60"}`} />
                      <p>{t.text}</p><p className="text-xs text-muted-foreground">{fmt(t.at, data.appointment.timeZone)}</p>
                      {t.undoable && t.batchId && <div className="mt-1"><UndoButton locationId={locationId} batchId={t.batchId} onDone={changed} minutes={data.undoMinutes} /></div>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <ModeLine mode={data.mode} needsPermission={data.needsPermission} />
          </>
        ) : null}
      </div>

      {data && flow?.kind === "action" && <ChangeFlow locationId={locationId} appointmentId={id} action={flow.action} title={flow.title} {...(flow.fromMeeting ? { fromMeeting: true } : {})} onClose={close} onChanged={changed} />}
      {data && flow?.kind === "move" && <RescheduleFlow locationId={locationId} appointmentId={id} contactName={data.contact?.name ?? "this appointment"} startAt={data.appointment.startAt} endAt={data.appointment.endAt} timeZone={data.appointment.timeZone} onClose={close} onChanged={changed} />}
      {data && flow?.kind === "rebook" && <RebookFlow locationId={locationId} appointmentId={id} timeZone={data.appointment.timeZone} onClose={close} onChanged={changed} />}
      {data && flow?.kind === "note" && <FollowUpNote locationId={locationId} appointmentId={id} onClose={close} api={api} />}
    </aside>
  );
}

function EditTitle({ data, onGo }: { data: Panel; onGo: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(data.appointment.title ?? "");
  return open ? (
    <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); onGo(t); setOpen(false); }}>
      <input value={t} onChange={(e) => setT(e.target.value)} maxLength={200} aria-label="Appointment title" className="min-h-11 flex-1 rounded-md border bg-background px-3 text-sm sm:min-h-9" />
      <button type="submit" className={PRIMARY}>Preview</button>
    </form>
  ) : <button type="button" className={BTN} onClick={() => setOpen(true)} data-testid="appt-edit"><Pencil aria-hidden className="size-4" />Edit title</button>;
}

function MeetingCard({ data, onNote }: { data: Panel; onNote: () => void }) {
  const m = data.meeting;
  if (!m) return data.meetingConnected ? <section aria-label="Recorded call" className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"><Video aria-hidden className="mr-1 inline size-4" />No recorded call is tied to this appointment. Calls are tied only when SubSync is certain; the rest wait in Meetings, Needs matching.</section> : null;
  return (
    <section aria-label="Recorded call" className="rounded-xl border p-3" data-testid="appt-meeting">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Video aria-hidden className="size-4 text-primary" />{m.title ?? "Recorded call"}</h3>
      {m.summary ? <p className="mt-1 line-clamp-6 text-sm">{m.summary}</p> : <p className="mt-1 text-sm text-muted-foreground">No summary came with this call.</p>}
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next step</p>
      <p className="text-sm">{m.nextStep ?? "No next step was set on this call."}</p>
      {m.actionItems.length > 1 && <ul className="mt-1 list-disc pl-5 text-sm">{m.actionItems.slice(0, 6).map((a, i) => <li key={i}>{a}</li>)}</ul>}
      <div className="mt-2 flex flex-wrap gap-2">
        {m.recordingUrl && <a href={m.recordingUrl} target="_blank" rel="noopener noreferrer" className={BTN}><FileText aria-hidden className="size-4" />Open the recording</a>}
        <button type="button" className={BTN} onClick={onNote} data-testid="appt-followup-note"><StickyNote aria-hidden className="size-4" />Add follow-up note and task</button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Only you can see this call. It belongs to the person who recorded it.</p>
    </section>
  );
}

function FollowUpNote({ locationId, appointmentId, onClose, api }: { locationId: string; appointmentId: string; onClose: () => void; api: ReturnType<typeof useApiClient> }) {
  const [pre, setPre] = useState<{ mode: Mode; needsPermission: boolean; preview: { text: string; hasTask: boolean; task: string | null } } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.post<NonNullable<typeof pre>>("appointments/meetings/followup-note", { locationId, appointmentId, step: "preview" }).then(setPre).catch((e: unknown) => setErr(e instanceof ApiError ? String(e.body.error ?? e.body.message ?? "Could not prepare the note") : "Could not prepare the note")); }, [api, locationId, appointmentId]);
  const go = async () => { setBusy(true); try { const r = await api.post<{ message?: string }>("appointments/meetings/followup-note", { locationId, appointmentId, step: "do" }); setMsg(r.message ?? "Done."); } catch (e) { setErr(e instanceof ApiError ? String(e.body.message ?? e.body.error ?? "Could not add the note") : "Could not add the note"); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Follow-up note" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-card p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Follow-up note</h2>
        {msg ? <p role="status" className="mt-2 text-sm">{msg}</p> : pre ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">An internal note on the contact{pre.preview.hasTask ? ", and a task for the next step due in 2 days" : ""}. SubSync never sends anything to the lead. These are excluded from your reply and activity numbers.</p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 text-sm">{pre.preview.text}</pre>
            {pre.preview.task && <p className="mt-2 text-sm"><b>Task:</b> {pre.preview.task}</p>}
            <ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
            <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void go()} className={PRIMARY}>{pre.mode.live ? "Add the note" : "Run practice"}</button><button type="button" className={BTN} onClick={onClose}>Cancel</button></div>
          </>
        ) : err ? <p role="alert" className="mt-2 text-sm text-destructive">{err}</p> : <p className="mt-2 text-sm text-muted-foreground" role="status">Preparing the note...</p>}
        {err && pre && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        {msg && <button type="button" className={`${PRIMARY} mt-3`} onClick={onClose}>Close</button>}
      </div>
    </div>
  );
}

