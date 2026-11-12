"use client";

import { Check, ExternalLink, Link2, ListChecks, Loader2, Search, Undo2, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { decodeRange, resolveRange, todayOf } from "@/lib/design/range";
import { pageRangeFromHash } from "@/lib/design/global-filter";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { OpenLeadButton } from "../ds/open-lead-button";
import { remembered } from "../ds/remember";
import { ApiError, useApiClient, useData } from "../session";
import { BTN, ChangeFlow, PRIMARY } from "./appointment-actions-ui";
import { FX_DETAIL, FX_LIST, mnFx } from "./meeting-fixtures";

// The Meetings list of Meeting notes (docs/features/MEETINGS_BRIEF.md slices 1 and 2): the person's OWN recorded calls, searchable and filterable, each with where it is, its appointment
// outcome and whether anybody followed up. A call opens in a side panel (never blank: it shows loading, an error with Try again, or the call). Only the person whose tool recorded a call reads
// it; an administrator reads counts elsewhere, never this. A call goes on a contact only when it is certain, otherwise it says "Waiting for you to pick the contact" and the person picks.
// Outcomes and tasks are never automatic: a suggestion is one tap to confirm, and tasks are made only after a preview and a confirm.

export type CallRow = {
  id: string; title: string | null; startedAt: string | null; at: string; statusKey: string; statusLabel: string; minutes: number | null; attendees: number; items: number; hasSummary: boolean; hasRecording: boolean;
  locationId: string | null; locationName: string | null; contactId: string | null; contactName: string | null; contactUrl?: string | null;
  outcome: { state: string; words: string; suggested: string | null; appointmentId: string | null }; followed: boolean | null;
};
type ListAnswer = { demo?: boolean; rows: CallRow[]; total: number; next: string | null };
type Detail = {
  id: string; title: string | null; startedAt: string | null; minutes: number | null; talkPct: number | null; statusKey: string; statusLabel: string; attendees: string[]; summary: string | null; actionItems: string[];
  recordingUrl: string | null; locationId: string | null; locationName: string | null; contactId: string | null; contactName: string | null; contactUrl: string | null;
  appointment: { id: string; startAt: string | null; status: string | null; calendar: string | null } | null; outcome: { state: string; words: string; suggested: string | null };
  tasks: Array<{ itemNo: number; status: string }>; nextStep: string | null; candidates: Array<{ locationId: string; locationName: string; contactId: string; name: string; email: string; url: string }>; canTasks: boolean; canOutcome: boolean;
};
type TaskPreview = { plans: Array<{ itemNo: number; title: string; dueAt: string }>; skipped: number; room: number; contactName: string; accountName: string; mode: { live: boolean; practice: boolean }; needsPermission: boolean; message: string | null };

const errText = (e: unknown) => (e instanceof ApiError ? String(e.body.message ?? e.body.error ?? "Something went wrong") : "Something went wrong. Try again.");
export const whenOf = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "time unknown");
const dueOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

const subscribe = (cb: () => void) => { window.addEventListener("subsync-range", cb); window.addEventListener("hashchange", cb); return () => { window.removeEventListener("subsync-range", cb); window.removeEventListener("hashchange", cb); }; };
/** The dates chosen on the bar at the top of the page, as two days (null while the page is loading). The calls listed are the ones that started in this window. */
export function useBarDays(): { from: string; to: string } | null {
  // Read the dates in the snapshot, so the day is taken when the bar changes and never during a render. With nothing chosen the bar shows the last 30 days, so that is what is used.
  const key = useSyncExternalStore(subscribe, () => { const spec = pageRangeFromHash(window.location.hash) ?? decodeRange(remembered("range-page")) ?? { preset: "30d" as const, compare: "none" as const }; const r = resolveRange(spec, todayOf(Date.now())); return `${r.current.from}|${r.current.to}`; }, () => "");
  return useMemo(() => { if (!key) return null; const [from, to] = key.split("|"); return { from, to }; }, [key]);
}

const TONE: Record<string, string> = { on_contact: "bg-emerald-500", practice: "bg-sky-500", waiting_pick: "bg-amber-500", waiting_ok: "bg-amber-500", needs_permission: "bg-red-500", refused: "bg-red-500", other: "bg-muted-foreground/50" };
const SELECT = "min-h-11 rounded-lg border bg-card px-2 text-sm sm:min-h-10";

export function MeetingsList({ onOpenAppointment }: { onOpenAppointment?: (locationId: string, appointmentId: string) => void }) {
  const api = useApiClient();
  const fx = mnFx();
  const bar = useBarDays();
  const [q, setQ] = useState("");
  const [qNow, setQNow] = useState("");
  const [state, setState] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [follow, setFollow] = useState("all");
  const [rows, setRows] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  // The address being shown. An answer is used when it is for this address, even if a newer request for the same address started meanwhile (the shell may hand over a new client object while a read is on its way); an answer for an address the screen has moved on from is dropped.
  const current = useRef<string>("");
  useEffect(() => { const t = setTimeout(() => setQNow(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const path = useCallback((cursor: string | null) => {
    const p = new URLSearchParams();
    if (qNow) p.set("q", qNow);
    if (state !== "all") p.set("state", state);
    if (outcome !== "all") p.set("outcome", outcome);
    if (follow !== "all") p.set("follow", follow);
    if (bar) { p.set("from", bar.from); p.set("to", bar.to); }
    if (cursor) p.set("cursor", cursor);
    const s = p.toString();
    return `meeting-list${s ? `?${s}` : ""}`;
  }, [qNow, state, outcome, follow, bar]);

  const load = useCallback(async () => {
    const mine = path(null);
    current.current = mine;
    setPhase((x) => (x === "ready" ? x : "loading")); setError(null);
    if (fx) { setRows(FX_LIST.filter((r) => (state === "all" || (state === "needs" ? r.contactId === null : r.contactId !== null)) && (!qNow || `${r.title} ${r.contactName}`.toLowerCase().includes(qNow.toLowerCase())))); setTotal(FX_LIST.length); setNext(null); setPhase("ready"); return; }
    try {
      const a = await api.get<ListAnswer>(path(null));
      if (mine !== current.current) return;
      setRows(a.rows); setTotal(a.total); setNext(a.next); setDemo(a.demo === true); setPhase("ready");
    } catch (e) { if (mine === current.current) { setError(e as ApiError); setPhase("error"); } }
  }, [api, path, fx, state, qNow]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const showMore = async () => {
    if (!next) return;
    setMore(true);
    try { const a = await api.get<ListAnswer>(path(next)); setRows((r) => [...r, ...a.rows.filter((x) => !r.some((y) => y.id === x.id))]); setNext(a.next); setTotal(a.total); }
    catch (e) { setError(e as ApiError); } finally { setMore(false); }
  };
  const filtered = qNow !== "" || state !== "all" || outcome !== "all" || follow !== "all";
  const clear = () => { setQ(""); setQNow(""); setState("all"); setOutcome("all"); setFollow("all"); };

  return (
    <div data-testid="mn-list" className="space-y-4">
      {fx && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm" role="note" data-testid="mn-sample">Sample data. These calls are made up to show the screen. They are not yours.</p>}
      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Find a call">
        <label className="relative min-w-[12rem] flex-1 text-xs text-muted-foreground">Search
          <Search aria-hidden className="pointer-events-none absolute bottom-3 left-3 size-4 sm:bottom-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Call title, contact or email" className="mt-1 min-h-11 w-full rounded-lg border bg-card pl-9 pr-3 text-sm text-foreground sm:min-h-10" data-testid="mn-search" />
        </label>
        <label className="text-xs text-muted-foreground">Contact<select value={state} onChange={(e) => setState(e.target.value)} className={`${SELECT} mt-1 block`} data-testid="mn-state"><option value="all">All calls</option><option value="matched">On a contact</option><option value="needs">Needs matching</option></select></label>
        <label className="text-xs text-muted-foreground">Appointment outcome<select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`${SELECT} mt-1 block`} data-testid="mn-outcome"><option value="all">Any</option><option value="to_confirm">To confirm</option><option value="confirmed">Set</option><option value="none">No appointment</option></select></label>
        <label className="text-xs text-muted-foreground">Follow-up<select value={follow} onChange={(e) => setFollow(e.target.value)} className={`${SELECT} mt-1 block`} data-testid="mn-follow"><option value="all">Any</option><option value="has">Followed up</option><option value="none">No follow-up yet</option></select></label>
        {filtered && <button type="button" className={BTN} onClick={clear} data-testid="mn-clear">Clear</button>}
      </div>

      {phase === "loading" && <SkeletonRows rows={5} label="Loading your calls" />}
      {phase === "error" && error && <ErrorState error={error} onRetry={() => void load()} />}
      {phase === "ready" && (
        <section aria-label="Your recorded calls">
          <h2 className="mb-2 text-sm font-semibold" data-testid="mn-count">{total} {total === 1 ? "call" : "calls"}{filtered ? " match" : ""} <span className="font-normal text-muted-foreground">{bar ? "in the dates chosen above" : ""}</span></h2>
          {rows.length === 0 ? (
            <EmptyState title={filtered ? "No call matches those filters" : demo ? "The demo has no recorded calls" : "No recorded calls in these dates"} body={filtered ? "Clear a filter, or widen the dates at the top." : "When a call you recorded finishes, it shows here, on the contact when it is certain."} action={filtered ? <button type="button" className={BTN} onClick={clear}>Clear filters</button> : undefined} />
          ) : (
            <ul className="divide-y rounded-xl border bg-card" data-testid="mn-rows">
              {rows.map((r) => (
                <li key={r.id} className="grid gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="mn-row">
                  <button type="button" onClick={() => setOpen(r.id)} className="min-h-11 min-w-0 text-left sm:min-h-9" aria-label={`Open the call ${r.title ?? "recorded call"}`}>
                    <span className="flex items-center gap-2 text-sm font-medium"><Video aria-hidden className="size-4 shrink-0 text-primary" /><span className="truncate">{r.title ?? "Recorded call"}</span></span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{whenOf(r.startedAt ?? r.at)}{r.minutes ? ` | ${r.minutes} min` : ""}{r.contactName ? ` | ${r.contactName}` : ""}{r.locationName ? ` | ${r.locationName}` : ""}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-2 rounded-full ${TONE[r.statusKey] ?? TONE.other}`} />{r.statusLabel}</span>
                      {r.outcome.appointmentId && <span className={r.outcome.state === "to_confirm" ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{r.outcome.words}</span>}
                      <span className="text-muted-foreground">{r.items > 0 ? "Next step set" : "No next step"}</span>
                      {r.followed !== null && <span className={r.followed ? "text-muted-foreground" : "font-medium text-amber-600 dark:text-amber-400"}>{r.followed ? "Followed up" : "No follow-up yet"}</span>}
                    </span>
                  </button>
                  <span className="justify-self-start sm:justify-self-end">
                    <OpenLeadButton seed={r.contactId && r.locationId ? { contactId: r.contactId, locationId: r.locationId, name: r.contactName ?? "Contact", locationName: r.locationName } : null} crmUrl={r.contactUrl ?? null} reason={r.contactId ? null : "Pick the contact first"} name={r.contactName ?? undefined} testId="mn-open-lead" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {next && <div className="mt-3 flex items-center justify-between text-sm"><span className="text-muted-foreground" data-testid="mn-showing">Showing {rows.length} of {total}</span><button type="button" className={BTN} disabled={more} onClick={() => void showMore()} data-testid="mn-more">{more ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Show more</button></div>}
          {!next && rows.length > 0 && <p className="mt-2 text-xs text-muted-foreground" data-testid="mn-showing">Showing all {rows.length}.</p>}
        </section>
      )}
      {open && <CallPanel id={open} fx={fx} onClose={() => setOpen(null)} onChanged={() => void load()} onOpenAppointment={onOpenAppointment} />}
    </div>
  );
}

// ---------------- the side panel ----------------

export function SidePanel({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose} data-testid={`${testId}-backdrop`}>
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-[34rem] overflow-y-auto border-l bg-background p-4 shadow-[0_0_40px_-12px_var(--primary)] outline-none sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3"><h2 className="min-w-0 text-base font-semibold leading-snug">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ds-press -mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted sm:size-9"><X aria-hidden className="size-4" /></button></div>
        {children}
      </aside>
    </div>
  );
}

export function CallPanel({ id, fx, onClose, onChanged, onOpenAppointment }: { id: string; fx: boolean; onClose: () => void; onChanged: () => void; onOpenAppointment?: (locationId: string, appointmentId: string) => void }) {
  const d = useData<Detail>(fx ? null : `meeting-list/${id}`);
  const data = fx ? (FX_DETAIL[id] ?? null) : d.data;
  const title = data?.title ?? "Recorded call";
  return (
    <SidePanel title={title} onClose={onClose} testId="mn-panel">
      {!fx && d.loading && !data && <SkeletonRows rows={4} label="Loading the call" />}
      {!fx && d.error && <ErrorState error={d.error} onRetry={d.reload} />}
      {!data && !d.loading && !d.error && <EmptyState compact title="That call is not available" body="It may have been removed, or it is not one of yours." />}
      {data && <CallBody d={data} fx={fx} reload={() => { void d.reload(); onChanged(); }} onOpenAppointment={onOpenAppointment} />}
    </SidePanel>
  );
}

function Fact({ k, children }: { k: string; children: ReactNode }) { return <div className="flex flex-wrap gap-x-3 py-1.5 text-sm"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 flex-1">{children}</dd></div>; }

function CallBody({ d, fx, reload, onOpenAppointment }: { d: Detail; fx: boolean; reload: () => void; onOpenAppointment?: (locationId: string, appointmentId: string) => void }) {
  const api = useApiClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<"showed" | "noshow" | null>(null);
  const match = async (c: Detail["candidates"][number]) => {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ dryRun: boolean }>(`meeting-inbox/${d.id}/link`, { locationId: c.locationId, contactId: c.contactId }); setMsg({ ok: true, text: r.dryRun ? "Matched. This is a practice run, so nothing was written to your CRM yet." : "Matched. The note is on the contact." }); reload(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  const taken = new Set(d.tasks.map((t) => t.itemNo));
  return (
    <div className="space-y-4" data-testid="mn-detail">
      <p className="flex flex-wrap items-center gap-2 text-sm"><span aria-hidden className={`size-2.5 rounded-full ${TONE[d.statusKey] ?? TONE.other}`} /><span className="font-medium">{d.statusLabel}</span><span className="text-muted-foreground">{whenOf(d.startedAt)}</span></p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "" : "border-destructive/40 text-destructive"}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        {d.recordingUrl && <a href={d.recordingUrl} target="_blank" rel="noopener noreferrer" className={BTN} data-testid="mn-recording"><Video aria-hidden className="size-4" />Open the recording</a>}
        {d.contactUrl && <a href={d.contactUrl} target="_blank" rel="noopener noreferrer" className={BTN}><ExternalLink aria-hidden className="size-4" />Open the contact in your CRM</a>}
      </div>
      <dl className="divide-y rounded-xl border px-3">
        <Fact k="Contact">{d.contactName ? <span>{d.contactName}{d.locationName ? <span className="text-muted-foreground"> | {d.locationName}</span> : null}</span> : <span className="text-muted-foreground">Not matched yet</span>}</Fact>
        <Fact k="Length">{d.minutes ? `${d.minutes} minutes` : <span className="text-muted-foreground">Not given by your meeting tool</span>}</Fact>
        {d.talkPct !== null && <Fact k="You spoke">{d.talkPct}% of the words</Fact>}
        <Fact k="Appointment">{d.appointment ? <span>{whenOf(d.appointment.startAt)}{d.appointment.calendar ? ` | ${d.appointment.calendar}` : ""}{d.locationId && onOpenAppointment ? <> <button type="button" className="min-h-9 text-primary underline" onClick={() => onOpenAppointment(d.locationId as string, d.appointment!.id)}>View</button></> : null}</span> : <span className="text-muted-foreground">None tied to this call</span>}</Fact>
        <Fact k="Who was there">{d.attendees.length ? <span className="break-words">{d.attendees.join(", ")}</span> : <span className="text-muted-foreground">No other email on the invite</span>}</Fact>
      </dl>

      {!d.contactId && (
        <section aria-label="Pick the contact" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" data-testid="mn-pick">
          <h3 className="text-sm font-semibold">Waiting for you to pick the contact</h3>
          {d.candidates.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No contact has the email of anyone on this call, so nothing is offered. SubSync never guesses. Add the email to the contact in your CRM, or search for the contact in My Meeting inbox.</p> : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">{d.candidates.length === 1 ? "One contact has the email of someone on this call." : "More than one contact fits, so SubSync cannot tell which. Pick one."} It goes on the contact only when you tap.</p>
              <ul className="mt-2 space-y-2">{d.candidates.map((c) => <li key={c.contactId + c.locationId}><button type="button" className={`${BTN} w-full justify-start`} disabled={busy || fx} onClick={() => void match(c)} data-testid="mn-match"><Link2 aria-hidden className="size-4" />Put it on {c.name} <span className="text-muted-foreground">({c.email}, {c.locationName})</span></button></li>)}</ul>
            </>
          )}
        </section>
      )}

      {d.outcome.state === "to_confirm" && d.appointment && d.locationId && (
        <section aria-label="Appointment outcome" className="rounded-xl border p-3" data-testid="mn-outcome-box">
          <h3 className="text-sm font-semibold">{d.outcome.words}</h3>
          <p className="mt-1 text-xs text-muted-foreground">This is a suggestion from the call. Nothing is marked until you tap.</p>
          {d.canOutcome ? (
            <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={d.outcome.suggested === "showed" ? PRIMARY : BTN} onClick={() => setFlow("showed")} data-testid="mn-mark-showed"><Check aria-hidden className="size-4" />Mark showed</button><button type="button" className={d.outcome.suggested === "noshow" ? PRIMARY : BTN} onClick={() => setFlow("noshow")} data-testid="mn-mark-noshow">Mark no-show</button></div>
          ) : onOpenAppointment ? <button type="button" className={`${BTN} mt-2`} onClick={() => onOpenAppointment(d.locationId as string, d.appointment!.id)}>Open the appointment to mark it</button> : null}
        </section>
      )}
      {flow && d.appointment && d.locationId && <ChangeFlow locationId={d.locationId} appointmentId={d.appointment.id} action={{ kind: "status", status: flow }} title={flow === "showed" ? "Mark this appointment as showed" : "Mark this appointment as a no-show"} contactName={d.contactName ?? undefined} fromMeeting onClose={() => setFlow(null)} onChanged={reload} />}

      <section aria-label="Next step">
        <h3 className="text-sm font-semibold">Next step</h3>
        {d.nextStep ? <p className="mt-1 rounded-lg bg-primary/10 px-3 py-2 text-sm" data-testid="mn-nextstep">{d.nextStep}</p> : <p className="mt-1 text-sm text-muted-foreground" data-testid="mn-nextstep">No next step was set on this call. Decide one and put it on the contact.</p>}
      </section>

      <section aria-label="Summary">
        <h3 className="text-sm font-semibold">Summary</h3>
        {d.summary ? <p className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6" data-testid="mn-summary">{d.summary}</p> : <p className="mt-1 text-sm text-muted-foreground">Your meeting tool sent no summary, or you chose not to keep it.</p>}
      </section>

      <section aria-label="Action items">
        <h3 className="text-sm font-semibold">Action items</h3>
        {d.actionItems.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None on this call.</p> : (
          <TaskMaker d={d} taken={taken} fx={fx} reload={reload} />
        )}
      </section>
      <p className="text-xs text-muted-foreground">Only you can see this call. Your administrator sees counts, never what was said.</p>
    </div>
  );
}

function TaskMaker({ d, taken, fx, reload }: { d: Detail; taken: Set<number>; fx: boolean; reload: () => void }) {
  const api = useApiClient();
  const [chosen, setChosen] = useState<number[]>([]);
  const [pre, setPre] = useState<TaskPreview | null>(null);
  const [res, setRes] = useState<{ message: string; ok: boolean; undoMinutes?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const can = d.canTasks && d.contactId !== null;
  const toggle = (n: number) => setChosen((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));
  const preview = async () => { setBusy(true); setErr(null); setRes(null); try { setPre(await api.post<TaskPreview>(`meeting-list/${d.id}/tasks`, { step: "preview", items: chosen })); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const create = async () => { setBusy(true); setErr(null); try { const r = await api.post<{ message: string; ok: boolean; undoMinutes: number }>(`meeting-list/${d.id}/tasks`, { step: "create", items: chosen }); setRes(r); setPre(null); setChosen([]); reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const undo = async () => { setBusy(true); setErr(null); try { const r = await api.post<{ message: string }>(`meeting-list/${d.id}/tasks`, { step: "undo" }); setRes({ ok: true, message: r.message }); reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (
    <div data-testid="mn-items">
      <ol className="mt-1 space-y-1">
        {d.actionItems.map((a, i) => {
          const n = i + 1, done = taken.has(n);
          return (
            <li key={n} className="flex items-start gap-2 text-sm">
              {can ? <input type="checkbox" className="mt-1 size-4" aria-label={`Make a task for item ${n}`} checked={done || chosen.includes(n)} disabled={done || busy} onChange={() => toggle(n)} data-testid="mn-item-check" /> : <span aria-hidden className="mt-1 w-4 text-center text-muted-foreground">{n}.</span>}
              <span className="min-w-0 flex-1 break-words">{a}{done ? <span className="ml-2 text-xs text-muted-foreground">Task made</span> : null}</span>
            </li>
          );
        })}
      </ol>
      {!d.canTasks ? null : !d.contactId ? <p className="mt-2 text-xs text-muted-foreground">Pick the contact first. A task is made only on a contact that is certain.</p> : (
        <div className="mt-3 space-y-2">
          {!pre && <button type="button" className={BTN} disabled={busy || chosen.length === 0 || fx} onClick={() => void preview()} data-testid="mn-tasks-preview"><ListChecks aria-hidden className="size-4" />Make {chosen.length || ""} {chosen.length === 1 ? "task" : "tasks"} on {d.contactName}</button>}
          {pre && (
            <div className="rounded-xl border p-3" data-testid="mn-tasks-box">
              <p className="text-sm font-medium">{pre.plans.length} {pre.plans.length === 1 ? "task" : "tasks"} on {pre.contactName}, in {pre.accountName}</p>
              <ul className="mt-2 divide-y rounded-md border text-sm">{pre.plans.map((p) => <li key={p.itemNo} className="flex flex-wrap gap-x-3 px-3 py-1.5"><span className="min-w-0 flex-1 break-words">{p.title}</span><span className="text-xs text-muted-foreground">due {dueOf(p.dueAt)}</span></li>)}</ul>
              {pre.message && <p role="alert" className="mt-2 text-sm text-destructive">{pre.message}</p>}
              {!pre.message && !pre.mode.live && <p className="mt-2 text-xs text-muted-foreground">Practice run: changes from SubSync are switched off for this account, so nothing will be sent to your CRM.</p>}
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={busy || pre.needsPermission || pre.plans.length === 0} onClick={() => void create()} data-testid="mn-tasks-confirm">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}{pre.mode.live ? "Confirm and make them" : "Run practice"}</button><button type="button" className={BTN} onClick={() => setPre(null)}>Cancel</button></div>
            </div>
          )}
          {res && <p role="status" className="flex flex-wrap items-center gap-2 text-sm" data-testid="mn-tasks-result"><Check aria-hidden className="size-4 text-emerald-500" />{res.message}{res.undoMinutes ? <button type="button" className={BTN} onClick={() => void undo()} disabled={busy}><Undo2 aria-hidden className="size-4" />Undo (open for {res.undoMinutes} min)</button> : null}</p>}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
      )}
    </div>
  );
}
