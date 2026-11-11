"use client";

import { CalendarClock, Check, Loader2, Repeat2, Trash2, TriangleAlert, Undo2, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApptAction, ApptPlan, OutcomeChoice } from "@/lib/analytics/appointment-actions";
import { isoToZonedLocal, zonedToIso } from "@/lib/analytics/appointment-actions";
import { ApiError, useApiClient } from "../session";

// The action pieces of the Appointments module (slice AB), as components and hooks for the integrator to place:
//   <AppointmentPanel .../>            (appointment-panel.tsx)  the right-side panel: details, timeline, Fathom call, every action below
//   <ChangeFlow .../>                  one change with its preview, the typed confirmation for a delete, the result and a short Undo
//   <RebookFlow .../> <AddFlow .../>   book again in one tap / add an appointment, both with the double-booking check and best-slot choices
//   <BulkBar .../>                     appears when appointments are ticked (one client account at a time): mark, reassign, delete
//   <RowQuickActions .../>             two small buttons (Showed, No-show) for a table row
//   useApptCaps()                      what this person may do, so a screen shows only those buttons
// Nothing here decides whether something is allowed: the server answers with a preview, the reasons a change is refused, and whether it is a practice run (changes from SubSync are
// switched off) or live. A delete can never be sent without the typed confirmation, and no keyboard shortcut can reach it.

export type Blocker = { id: string; text: string };
export type Mode = { masterOn: boolean; optedIn: boolean; live: boolean; demo: boolean };
export type Caps = { edit: boolean; reassign: boolean; create: boolean; del: boolean; bulk: boolean; meetings: boolean; caps: { status: number; reassign: number; delete: number }; undoMinutes: number; me: string | null };
type PreviewAnswer = { ok: boolean; mode: Mode; needsPermission: boolean; plan: ApptPlan & { input?: unknown } };
type DoAnswer = { ok: boolean; done?: boolean; dryRun?: boolean; message?: string; batchId?: string; undoMinutes?: number; needsPermission?: boolean };
export type Slot = { startAt: string; endAt: string; reason: string };

export const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9";
export const PRIMARY = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_0_18px_-6px_var(--primary)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9";
export const DANGER = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-destructive px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9";
const FIELD = "min-h-11 w-full rounded-md border bg-background px-3 text-sm sm:min-h-9";

const msgOf = (e: unknown) => (e instanceof ApiError && typeof e.body.message === "string" ? e.body.message : e instanceof ApiError && typeof e.body.error === "string" ? e.body.error : e instanceof Error ? e.message : "Something went wrong. Try again.");
const blockersOf = (e: unknown): Blocker[] | null => (e instanceof ApiError && Array.isArray(e.body.blockers) ? (e.body.blockers as Blocker[]) : null);

let capsShared: { api: unknown; at: number; p: Promise<Caps | null> } | null = null;
/** What this person may do. One shared request; a failed load simply shows no extra buttons. */
export function useApptCaps(): Caps | null {
  const api = useApiClient();
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => {
    if (!capsShared || capsShared.api !== api || Date.now() - capsShared.at > 60_000) capsShared = { api, at: Date.now(), p: api.get<Caps>("appointments/act/caps").catch(() => null) };
    let live = true;
    void capsShared.p.then((c) => { if (live) setCaps(c); });
    return () => { live = false; };
  }, [api]);
  return caps;
}

// ---------------- shared pieces ----------------

export function Notes({ blockers, warnings }: { blockers?: Blocker[]; warnings?: Blocker[] }) {
  return (
    <>
      {blockers?.map((b) => <p key={b.id} role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-sm text-destructive"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{b.text}</p>)}
      {warnings?.map((w) => <p key={w.id} className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-sm"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-500" />{w.text}</p>)}
    </>
  );
}

export function ModeLine({ mode, needsPermission }: { mode: Mode; needsPermission: boolean }) {
  if (needsPermission && mode.live) return <p className="mt-2 text-xs text-destructive">Needs permission: reconnect SubSync so it may change appointments.</p>;
  if (mode.demo) return <p className="mt-2 text-xs text-muted-foreground">Demo: nothing is sent anywhere.</p>;
  if (!mode.live) return <p className="mt-2 text-xs text-muted-foreground">Practice run: changes from SubSync are switched off for this account, so nothing will be sent to your CRM.</p>;
  return null;
}

function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-card p-4 shadow-[0_0_40px_-12px_var(--primary)] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2><button type="button" onClick={onClose} aria-label="Close" className="ds-press -mr-2 -mt-2 inline-flex size-11 items-center justify-center rounded-md hover:bg-muted sm:size-9"><X aria-hidden className="size-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

// ---------------- undo ----------------

export function UndoButton({ locationId, batchId, onDone, minutes }: { locationId: string; batchId: string; onDone: () => void; minutes: number }) {
  const api = useApiClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  const go = async () => {
    setState("busy");
    try { const r = await api.post<{ message?: string }>("appointments/act/undo", { locationId, batchId }); setState("done"); onDone(); void r; }
    catch (e) { setState(msgOf(e)); }
  };
  if (state === "done") return <span className="text-sm text-muted-foreground">Put back.</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void go()} disabled={state === "busy"} className={BTN} data-testid="appt-undo"><Undo2 aria-hidden className="size-4" />Undo (open for {minutes} min)</button>
      {state !== "idle" && state !== "busy" && <span role="alert" className="text-sm text-destructive">{state}</span>}
    </span>
  );
}

// ---------------- one change: preview, confirm, result ----------------

export type FlowProps = {
  locationId: string; appointmentId: string; action: ApptAction; title: string; contactName?: string; fromMeeting?: boolean;
  onClose: () => void; onChanged: () => void; setAction?: (a: ApptAction) => void; extra?: ReactNode;
};

/** The preview-then-confirm sheet for one change. A delete shows who, when and which calendar, says it cannot be undone, and keeps its button off until the words are typed. */
export function ChangeFlow(p: FlowProps) {
  const api = useApiClient();
  const [pre, setPre] = useState<PreviewAnswer | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [res, setRes] = useState<DoAnswer | null>(null);
  const isDelete = p.action.kind === "delete";
  const action = useMemo<ApptAction>(() => (p.action.kind === "delete" ? { kind: "delete", typed } : p.action), [p.action, typed]);

  const preview = useCallback(async () => {
    try { setPre(await api.post<PreviewAnswer>("appointments/act/apply", { locationId: p.locationId, appointmentId: p.appointmentId, action, step: "preview" })); setErr(null); }
    catch (e) { setErr(msgOf(e)); }
  }, [api, p.locationId, p.appointmentId, action]);
  useEffect(() => { const t = setTimeout(() => void preview(), isDelete ? 250 : 0); return () => clearTimeout(t); }, [preview, isDelete]);

  const confirm = async () => {
    setBusy(true); setErr(null); setBlockers(null);
    try { setRes(await api.post<DoAnswer>("appointments/act/apply", { locationId: p.locationId, appointmentId: p.appointmentId, action, step: "do", ...(p.fromMeeting ? { fromMeeting: true } : {}) })); p.onChanged(); }
    catch (e) { setBlockers(blockersOf(e)); setErr(blockersOf(e) ? null : msgOf(e)); }
    finally { setBusy(false); }
  };

  const plan = pre?.plan;
  const needed = plan?.confirm?.words ?? [];
  const typedOk = !isDelete || needed.some((w) => w.toLowerCase() === typed.trim().toLowerCase().replace(/\s+/g, " "));
  const blocked = (plan?.blockers ?? []).filter((b) => !(isDelete && b.id === "confirm" && typedOk));
  return (
    <Sheet title={p.title} onClose={p.onClose} testId={isDelete ? "appt-delete-dialog" : "appt-change-flow"}>
      {res ? (
        <div role="status" data-testid="appt-flow-result">
          <p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4 text-emerald-500" />{res.message ?? "Done."}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {res.done && res.batchId && !isDelete && <UndoButton locationId={p.locationId} batchId={res.batchId} onDone={p.onChanged} minutes={res.undoMinutes ?? 30} />}
            <button type="button" onClick={p.onClose} className={PRIMARY}>Close</button>
          </div>
        </div>
      ) : (
        <>
          {p.extra}
          {plan ? (
            <div data-testid="appt-preview">
              <p className="text-sm font-medium">{plan.summary}</p>
              {isDelete && <p className="mt-1 text-sm text-destructive">This cannot be undone.</p>}
              {plan.changes.length > 0 && !isDelete && <ul className="mt-2 divide-y rounded-md border text-sm">{plan.changes.map((c) => <li key={c.label} className="flex flex-wrap gap-x-3 px-3 py-1.5"><span className="w-20 shrink-0 text-muted-foreground">{c.label}</span><span className="line-through opacity-60">{c.from}</span><span aria-hidden>to</span><span className="font-medium">{c.to}</span></li>)}</ul>}
              {plan.conflicts.length > 0 && <p className="mt-2 text-sm">Overlaps {plan.conflicts.length} other appointment{plan.conflicts.length === 1 ? "" : "s"} for the same person.</p>}
              <Notes blockers={blocked} warnings={plan.warnings} />
              <Notes blockers={blockers ?? undefined} />
              {isDelete && (
                <label className="mt-3 block text-sm">Type <b>{needed[0] ?? "DELETE"}</b>{needed[1] ? <> or <b>{needed[1]}</b></> : null} to confirm
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD} mt-1`} data-testid="appt-delete-typed" aria-label="Type the confirmation" />
                </label>
              )}
              <ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void confirm()} disabled={busy || blocked.length > 0 || !typedOk || (pre.mode.live && pre.needsPermission)} className={isDelete ? DANGER : PRIMARY} data-testid="appt-confirm">
                  {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : isDelete ? <Trash2 aria-hidden className="size-4" /> : <Check aria-hidden className="size-4" />}{isDelete ? "Delete appointment" : pre.mode.live ? "Confirm" : "Run practice"}
                </button>
                <button type="button" onClick={p.onClose} className={BTN}>Cancel</button>
              </div>
            </div>
          ) : err ? <p role="alert" className="text-sm text-destructive">{err}</p> : <p className="text-sm text-muted-foreground" role="status"><Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />Checking what would change...</p>}
          {err && plan && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        </>
      )}
    </Sheet>
  );
}

// ---------------- reschedule / edit with best-slot suggestions ----------------

export function RescheduleFlow(p: { locationId: string; appointmentId: string; contactName: string; startAt: string | null; endAt: string | null; timeZone: string | null; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const dur = p.startAt && p.endAt ? Math.max(5, Math.round((Date.parse(p.endAt) - Date.parse(p.startAt)) / 60_000)) : 30;
  const [slots, setSlots] = useState<{ slots: Slot[]; basedOnHistory: boolean } | null>(null);
  const [startLocal, setStartLocal] = useState(p.startAt ? isoToZonedLocal(p.startAt, p.timeZone) : "");
  const [overlap, setOverlap] = useState(false);
  const [chosen, setChosen] = useState<{ startAt: string; endAt: string } | null>(null);
  const [go, setGo] = useState(false);
  useEffect(() => { let live = true; void api.get<{ slots: Slot[]; basedOnHistory: boolean }>(`appointments/act/slots?locationId=${encodeURIComponent(p.locationId)}&id=${encodeURIComponent(p.appointmentId)}`).then((s) => { if (live) setSlots(s); }).catch(() => { if (live) setSlots({ slots: [], basedOnHistory: false }); }); return () => { live = false; }; }, [api, p.locationId, p.appointmentId]);
  const typedIso = zonedToIso(startLocal, p.timeZone);
  const pick = chosen ?? (typedIso ? { startAt: typedIso, endAt: new Date(Date.parse(typedIso) + dur * 60_000).toISOString() } : null);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, ...(p.timeZone ? { timeZone: p.timeZone } : {}) });
  if (go && pick) return <ChangeFlow locationId={p.locationId} appointmentId={p.appointmentId} title={`Move ${p.contactName}`} action={{ kind: "reschedule", startAt: pick.startAt, endAt: pick.endAt, allowOverlap: overlap }} onClose={p.onClose} onChanged={p.onChanged} />;
  return (
    <Sheet title={`Move ${p.contactName}`} onClose={p.onClose} testId="appt-reschedule">
      <p className="text-sm font-medium">Best free times</p>
      <p className="text-xs text-muted-foreground">{slots?.basedOnHistory ? "Ranked by how often this account's past appointments showed up at that hour." : "The next free times for this person, with no double booking."}</p>
      <div className="mt-2 flex flex-wrap gap-2" data-testid="appt-slots">
        {slots === null ? <span className="text-sm text-muted-foreground">Looking for free time...</span> : slots.slots.length === 0 ? <span className="text-sm text-muted-foreground">No free time found in the next two weeks. Pick a time below.</span> : slots.slots.map((s) => (
          <button key={s.startAt} type="button" onClick={() => { setChosen({ startAt: s.startAt, endAt: s.endAt }); setGo(true); }} title={s.reason} className={`${BTN} flex-col !items-start !gap-0 py-1`} data-testid="appt-slot"><span>{when(s.startAt)}</span><span className="text-[11px] font-normal text-muted-foreground">{s.reason}</span></button>
        ))}
      </div>
      <p className="mt-4 text-sm font-medium">Or choose a time</p>
      <label className="mt-1 block text-sm">New start{p.timeZone ? ` (${p.timeZone})` : ""}<input type="datetime-local" value={startLocal} onChange={(e) => { setStartLocal(e.target.value); setChosen(null); }} className={`${FIELD} mt-1`} data-testid="appt-new-start" /></label>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm sm:min-h-8"><input type="checkbox" checked={overlap} onChange={(e) => setOverlap(e.target.checked)} className="size-4" />Book anyway, even if it overlaps another appointment</label>
      <div className="mt-3 flex gap-2"><button type="button" disabled={!pick} onClick={() => setGo(true)} className={PRIMARY} data-testid="appt-reschedule-next"><CalendarClock aria-hidden className="size-4" />Check and preview</button><button type="button" onClick={p.onClose} className={BTN}>Cancel</button></div>
    </Sheet>
  );
}

// ---------------- book again (one tap) and add ----------------

type CreatePreview = { ok: boolean; mode: Mode; needsPermission: boolean; plan: { summary: string; blockers: Blocker[]; warnings: Blocker[]; conflicts: unknown[]; input: { startAt: string; endAt: string } } };

/** One tap: books the same person again at the best free slot. The person sees the slot first and confirms. */
export function RebookFlow(p: { locationId: string; appointmentId: string; timeZone: string | null; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [pre, setPre] = useState<CreatePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DoAnswer | null>(null);
  useEffect(() => { void api.post<CreatePreview>("appointments/act/rebook", { locationId: p.locationId, appointmentId: p.appointmentId, step: "preview" }).then(setPre).catch((e) => setErr(msgOf(e))); }, [api, p.locationId, p.appointmentId]);
  const confirm = async () => {
    setBusy(true);
    try { setRes(await api.post<DoAnswer>("appointments/act/rebook", { locationId: p.locationId, appointmentId: p.appointmentId, step: "do", startAt: pre?.plan.input.startAt, endAt: pre?.plan.input.endAt })); p.onChanged(); }
    catch (e) { setErr(blockersOf(e)?.map((b) => b.text).join(" ") ?? msgOf(e)); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title="Book again" onClose={p.onClose} testId="appt-rebook">
      {res ? <div role="status"><p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4 text-emerald-500" />{res.message ?? "Done."}</p><button type="button" onClick={p.onClose} className={`${PRIMARY} mt-3`}>Close</button></div>
        : pre ? <>
          <p className="text-sm font-medium">{pre.plan.summary}</p>
          <p className="mt-1 text-xs text-muted-foreground">The best free time for the same person and calendar. Nothing is sent to the lead by SubSync.</p>
          <Notes blockers={pre.plan.blockers} warnings={pre.plan.warnings} /><ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
          <div className="mt-3 flex gap-2"><button type="button" disabled={busy || pre.plan.blockers.length > 0} onClick={() => void confirm()} className={PRIMARY} data-testid="appt-rebook-confirm"><Repeat2 aria-hidden className="size-4" />{pre.mode.live ? "Book again" : "Run practice"}</button><button type="button" onClick={p.onClose} className={BTN}>Cancel</button></div>
        </> : err ? <p role="alert" className="text-sm text-destructive">{err}</p> : <p className="text-sm text-muted-foreground" role="status">Finding the best free time...</p>}
    </Sheet>
  );
}

/** Add an appointment for a contact (the integrator passes the contact, calendars and team). */
export function AddFlow(p: { locationId: string; contactId: string; contactName: string; calendars: Array<{ id: string; name: string }>; team: Array<{ id: string; name: string }>; timeZone: string | null; me: string | null; admin: boolean; onClose: () => void; onChanged: () => void }) {
  const api = useApiClient();
  const [calendarId, setCalendarId] = useState(p.calendars[0]?.id ?? "");
  const [assignedTo, setAssignedTo] = useState(p.admin ? "" : p.me ?? "");
  const [start, setStart] = useState("");
  const [mins, setMins] = useState(30);
  const [overlap, setOverlap] = useState(false);
  const [pre, setPre] = useState<CreatePreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<DoAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const startIso = zonedToIso(start, p.timeZone);
  const body = (step: string) => ({ locationId: p.locationId, contactId: p.contactId, calendarId, assignedTo: assignedTo || null, startAt: startIso, endAt: startIso ? new Date(Date.parse(startIso) + mins * 60_000).toISOString() : null, allowOverlap: overlap, step });
  const check = async () => { setErr(null); try { setPre(await api.post<CreatePreview>("appointments/act/create", body("preview"))); } catch (e) { setErr(msgOf(e)); } };
  const confirm = async () => { setBusy(true); try { setRes(await api.post<DoAnswer>("appointments/act/create", body("do"))); p.onChanged(); } catch (e) { setErr(blockersOf(e)?.map((b) => b.text).join(" ") ?? msgOf(e)); } finally { setBusy(false); } };
  return (
    <Sheet title={`Add an appointment for ${p.contactName}`} onClose={p.onClose} testId="appt-add">
      {res ? <div role="status"><p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4 text-emerald-500" />{res.message ?? "Done."}</p><button type="button" onClick={p.onClose} className={`${PRIMARY} mt-3`}>Close</button></div> : (
        <div className="grid gap-2 text-sm">
          <label>Calendar<select value={calendarId} onChange={(e) => { setCalendarId(e.target.value); setPre(null); }} className={`${FIELD} mt-1`}>{p.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {p.admin && <label>Owner<select value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setPre(null); }} className={`${FIELD} mt-1`}><option value="">Nobody yet</option>{p.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
          <label>Start{p.timeZone ? ` (${p.timeZone})` : ""}<input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setPre(null); }} className={`${FIELD} mt-1`} /></label>
          <label>Length<select value={mins} onChange={(e) => { setMins(Number(e.target.value)); setPre(null); }} className={`${FIELD} mt-1`}>{[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 sm:min-h-8"><input type="checkbox" checked={overlap} onChange={(e) => { setOverlap(e.target.checked); setPre(null); }} className="size-4" />Book anyway, even if it overlaps another appointment</label>
          {pre && <div data-testid="appt-add-preview"><p className="font-medium">{pre.plan.summary}</p><Notes blockers={pre.plan.blockers} warnings={pre.plan.warnings} /><ModeLine mode={pre.mode} needsPermission={pre.needsPermission} /></div>}
          {err && <p role="alert" className="text-destructive">{err}</p>}
          <div className="flex gap-2">
            {!pre || pre.plan.blockers.length > 0 ? <button type="button" disabled={!startIso || !calendarId} onClick={() => void check()} className={PRIMARY}>Check for double bookings</button> : <button type="button" disabled={busy} onClick={() => void confirm()} className={PRIMARY} data-testid="appt-add-confirm">{pre.mode.live ? "Book it" : "Run practice"}</button>}
            <button type="button" onClick={p.onClose} className={BTN}>Cancel</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---------------- drag and drop owner ----------------

export const DRAG_TYPE = "application/x-subsync-person";

/** A team member chip that can be dragged onto an owner drop zone. A tap or Enter does the same through onPick, so it works on a phone and with a keyboard. */
export function PersonChip({ id, name, onPick, active }: { id: string; name: string; onPick: (id: string) => void; active?: boolean }) {
  return (
    <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onPick(id)} title="Drag onto the owner, or tap to give the appointment to this person"
      className={`ds-press inline-flex min-h-11 cursor-grab items-center gap-1.5 rounded-full border px-3 text-sm active:cursor-grabbing sm:min-h-8 ${active ? "border-primary bg-primary/10 font-semibold" : "bg-card hover:bg-muted"}`} data-testid="appt-person-chip"><UserRound aria-hidden className="size-3.5" />{name}</button>
  );
}
export function OwnerDrop({ ownerName, onDropPerson, children }: { ownerName: string; onDropPerson: (id: string) => void; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData(DRAG_TYPE); if (id) onDropPerson(id); }}
      className={`rounded-lg border-2 border-dashed px-3 py-2 text-sm transition-shadow ${over ? "border-primary bg-primary/10 shadow-[0_0_22px_-6px_var(--primary)]" : "border-border"}`} data-testid="appt-owner-drop" aria-label={`Owner: ${ownerName}. Drop a person here to change the owner.`}>
      <span className="text-muted-foreground">Owner </span><b>{ownerName}</b>{children}
    </div>
  );
}

// ---------------- table row helpers and the bulk bar ----------------

const OUTCOME_LABEL: Record<OutcomeChoice, string> = { showed: "Showed", noshow: "No-show", cancelled: "Cancelled", invalid: "Invalid", completed: "Completed" };
export const OUTCOME_CHOICES_UI = Object.keys(OUTCOME_LABEL) as OutcomeChoice[];
export const outcomeLabel = (o: OutcomeChoice) => OUTCOME_LABEL[o];

/** Two small buttons for a table row: Showed and No-show, each with the preview. */
export function RowQuickActions({ locationId, appointmentId, contactName, onChanged }: { locationId: string; appointmentId: string; contactName: string; onChanged: () => void }) {
  const [open, setOpen] = useState<OutcomeChoice | null>(null);
  return (
    <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
      {(["showed", "noshow"] as const).map((o) => <button key={o} type="button" onClick={() => setOpen(o)} className={`${BTN} !min-h-9 !px-2 text-xs`} data-testid={`appt-quick-${o}`}>{OUTCOME_LABEL[o]}</button>)}
      {open && <ChangeFlow locationId={locationId} appointmentId={appointmentId} title={`Mark ${contactName} as ${OUTCOME_LABEL[open].toLowerCase()}`} action={{ kind: "status", status: open }} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </span>
  );
}

type BulkPreview = { ok: boolean; mode: Mode; needsPermission: boolean; plan: { allowed: Array<{ appointmentId: string; name: string; startAt: string | null; calendar: string | null }>; skipped: Array<{ appointmentId: string; name: string; reason: string }>; overCap: number; phrase: string | null; reversible: boolean; cap: number } };

/** Appears when appointments are ticked (all from ONE client account). Mark, reassign or delete several; delete lists every appointment and needs the exact count typed. */
export function BulkBar({ locationId, ids, team, caps, onChanged, onClear }: { locationId: string; ids: string[]; team: Array<{ id: string; name: string }>; caps: Caps; onChanged: () => void; onClear: () => void }) {
  const api = useApiClient();
  const [kind, setKind] = useState<"status" | "reassign" | "delete" | null>(null);
  const [status, setStatus] = useState<OutcomeChoice>("showed");
  const [userId, setUserId] = useState("");
  const [pre, setPre] = useState<BulkPreview | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ message?: string; batchId?: string; undoable?: boolean; undoMinutes?: number } | null>(null);
  const body = (step: string) => ({ locationId, ids, kind, status, userId: userId || undefined, step, ...(step === "do" ? { typed } : {}) });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!kind || (kind === "reassign" && !userId)) { setPre(null); return; }
    setErr(null);
    void api.post<BulkPreview>("appointments/act/bulk", body("preview")).then(setPre).catch((e) => setErr(blockersOf(e)?.map((b) => b.text).join(" ") ?? msgOf(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, kind, status, userId, ids.join(",")]);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<NonNullable<typeof res>>("appointments/act/bulk", body("do")); setRes(r); onChanged(); }
    catch (e) { setErr(blockersOf(e)?.map((b) => b.text).join(" ") ?? msgOf(e)); }
    finally { setBusy(false); }
  };
  const n = pre?.plan.allowed.length ?? 0;
  const phraseOk = kind !== "delete" || typed.trim().toLowerCase().replace(/\s+/g, " ") === pre?.plan.phrase;
  return (
    <>
      <div className="sticky bottom-2 z-30 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-[0_0_30px_-10px_var(--primary)] backdrop-blur" role="toolbar" aria-label="Actions for the ticked appointments" data-testid="appt-bulk-bar">
        <b className="tabular-nums">{ids.length} ticked</b>
        <button type="button" className={BTN} onClick={() => setKind("status")} data-testid="appt-bulk-mark">Mark outcome</button>
        {caps.reassign && <button type="button" className={BTN} onClick={() => setKind("reassign")} data-testid="appt-bulk-reassign">Change owner</button>}
        {caps.del && <button type="button" className={`${BTN} text-destructive`} onClick={() => { setTyped(""); setKind("delete"); }} data-testid="appt-bulk-delete"><Trash2 aria-hidden className="size-4" />Delete</button>}
        <button type="button" className={`${BTN} ml-auto`} onClick={onClear}>Clear</button>
      </div>
      {kind && (
        <Sheet title={kind === "delete" ? `Delete ${n || ids.length} appointments` : kind === "status" ? "Mark outcome" : "Change owner"} onClose={() => { setKind(null); setRes(null); setPre(null); }} testId="appt-bulk-sheet">
          {res ? (
            <div role="status"><p className="flex items-center gap-2 text-sm"><Check aria-hidden className="size-4 text-emerald-500" />{res.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">{res.undoable && res.batchId && <UndoButton locationId={locationId} batchId={res.batchId} onDone={onChanged} minutes={res.undoMinutes ?? 30} />}<button type="button" className={PRIMARY} onClick={() => { setKind(null); setRes(null); onClear(); }}>Close</button></div></div>
          ) : (
            <>
              {kind === "status" && <label className="block text-sm">Outcome<select value={status} onChange={(e) => setStatus(e.target.value as OutcomeChoice)} className={`${FIELD} mt-1`}>{OUTCOME_CHOICES_UI.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}</select></label>}
              {kind === "reassign" && <label className="block text-sm">New owner<select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${FIELD} mt-1`}><option value="">Choose a team member</option>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
              {pre && (
                <div className="mt-3" data-testid="appt-bulk-preview">
                  <p className="text-sm font-medium">{n} appointment{n === 1 ? "" : "s"} will change{kind === "delete" ? ". This cannot be undone." : "."}</p>
                  <ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-md border text-sm">{pre.plan.allowed.map((a) => <li key={a.appointmentId} className="flex justify-between gap-2 px-3 py-1.5"><span className="truncate">{a.name}</span><span className="shrink-0 text-xs text-muted-foreground">{a.startAt ? new Date(a.startAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}{a.calendar ? `, ${a.calendar}` : ""}</span></li>)}</ul>
                  {pre.plan.skipped.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Left out: {pre.plan.skipped.map((s) => `${s.name} (${s.reason})`).slice(0, 5).join(", ")}{pre.plan.skipped.length > 5 ? ` and ${pre.plan.skipped.length - 5} more` : ""}.</p>}
                  {pre.plan.overCap > 0 && <p className="mt-2 text-xs text-amber-600">{pre.plan.overCap} more are over the limit of {pre.plan.cap} at a time and were left out.</p>}
                  {kind === "delete" && pre.plan.phrase && <label className="mt-3 block text-sm">Type <b>{pre.plan.phrase}</b> to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${FIELD} mt-1`} data-testid="appt-bulk-typed" aria-label="Type the confirmation" /></label>}
                  <ModeLine mode={pre.mode} needsPermission={pre.needsPermission} />
                  <div className="mt-3 flex gap-2"><button type="button" disabled={busy || n === 0 || !phraseOk || (pre.mode.live && pre.needsPermission)} onClick={() => void run()} className={kind === "delete" ? DANGER : PRIMARY} data-testid="appt-bulk-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}{kind === "delete" ? `Delete ${n}` : pre.mode.live ? "Confirm" : "Run practice"}</button><button type="button" className={BTN} onClick={() => { setKind(null); setPre(null); }}>Cancel</button></div>
                </div>
              )}
              {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
