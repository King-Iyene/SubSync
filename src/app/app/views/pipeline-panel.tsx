"use client";

import { Check, ExternalLink, Gauge, ListTodo, Pencil, StickyNote, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { DealAction, Unclog } from "@/lib/analytics/pipeline-actions";
import { ErrorState, SkeletonRows } from "../ds";
import { useData } from "../session";
import { BTN, ModeLine, PRIMARY, type Mode } from "./appointment-actions-ui";
import { DealChangeFlow, DealUndoButton, UnclogChips } from "./pipeline-actions-ui";

// The deal panel (slice PB): the right-side panel the integrator mounts when a deal row is clicked, `<DealPanel locationId id onClose onChanged />`. It shows what happened to the deal
// and every action: move stage, change owner, change value, mark won or lost (with the reason), rename, add a note or a task for the follow-up, delete (typed confirmation), the
// one-tap fixes for a stale deal, and the full change timeline with a short Undo. Everything it shows comes from one request that the server limits to the accounts the person may read.

type Panel = {
  deal: { id: string; locationId: string; locationName: string | null; name: string; status: string; statusWord: string; value: number | null; pipelineId: string | null; pipeline: string | null; stageId: string | null; stage: string | null; source: string | null; createdAt: string | null; timeZone: string | null; lostReason: { id: string; label: string } | null };
  contact: { contactId: string; name: string; phone: string | null; email: string | null; dnd: boolean; url: string; otherDeals: number } | null;
  owner: { id: string | null; name: string };
  dwell: { days: number | null; medianDays: number | null; stale: boolean };
  appointments: Array<{ id: string; startAt: string | null; status: string | null; calendar: string | null }>;
  timeline: Array<{ at: string; source: "subsync" | "crm"; text: string; batchId: string | null; undoable: boolean }>;
  suggestions: Unclog[];
  team: Array<{ id: string; name: string }>; pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>; lostReasons: Array<{ id: string; label: string }>;
  can: { edit: boolean; reassign: boolean; del: boolean };
  mode: Mode; needsPermission: boolean; needsNotePermission: boolean; undoMinutes: number;
};

type Flow = { action: DealAction; title: string } | null;
const money = (n: number | null) => (n && n > 0 ? `$${Math.round(n).toLocaleString("en-US")}` : "No value");
const when = (iso: string, tz: string | null) => { try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, ...(tz ? { timeZone: tz } : {}) }); } catch { return iso; } };
const TONE: Record<string, string> = { Won: "bg-emerald-500/15 text-emerald-600", Lost: "bg-destructive/15 text-destructive", Abandoned: "bg-muted text-muted-foreground", Open: "bg-primary/15 text-primary" };
const FIELD = "min-h-11 rounded-md border bg-background px-3 text-sm sm:min-h-9";

export function DealPanel({ locationId, id, onClose, onChanged }: { locationId: string; id: string; onClose: () => void; onChanged?: () => void }) {
  const { data, error, loading, reload } = useData<Panel>(`pipeline3/act/panel?locationId=${encodeURIComponent(locationId)}&id=${encodeURIComponent(id)}`);
  const [flow, setFlow] = useState<Flow>(null);
  const changed = () => { void reload(); onChanged?.(); };
  const open = data?.deal.status === "open";
  const pct = data?.dwell.days !== null && data?.dwell.medianDays ? Math.min(200, Math.round(((data?.dwell.days ?? 0) / data.dwell.medianDays) * 100)) : null;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l bg-card/80 shadow-[-12px_0_40px_-30px_var(--primary)] backdrop-blur sm:max-w-md" aria-label="Deal details" data-testid="deal-panel">
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{data?.deal.name ?? "Deal"}</h2>
          {data && <p className="truncate text-xs text-muted-foreground">{money(data.deal.value)}{data.deal.pipeline ? `, ${data.deal.pipeline}` : ""}{data.deal.locationName ? `, ${data.deal.locationName}` : ""}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="ds-press inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted sm:size-9"><X aria-hidden className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {loading && !data ? <SkeletonRows rows={5} label="Loading the deal" /> : error ? <ErrorState error={error} onRetry={reload} /> : data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[data.deal.statusWord] ?? TONE.Open}`} data-testid="deal-panel-status">{data.deal.statusWord}</span>
              {data.deal.lostReason && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{data.deal.lostReason.label}</span>}
              {data.contact?.dnd && <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">Asked not to be contacted</span>}
              {data.contact && <a href={data.contact.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-4 sm:min-h-9">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
            </div>

            <section aria-label="Where it is" className="rounded-xl border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage</p>
              <p className="text-sm font-medium" data-testid="deal-panel-stage">{data.deal.stage ?? "No stage"}</p>
              {data.dwell.days !== null && (
                <div className="mt-2" data-testid="deal-panel-dwell">
                  <p className="flex items-center gap-1.5 text-sm"><Gauge aria-hidden className={`size-4 ${data.dwell.stale ? "text-amber-500" : "text-muted-foreground"}`} />{data.dwell.days} days in this stage{data.dwell.medianDays !== null ? `, usual here ${data.dwell.medianDays} days` : ""}</p>
                  {pct !== null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct} percent of the usual time in this stage`}><div className={`h-full ${data.dwell.stale ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>}
                  {data.dwell.medianDays === null && <p className="mt-1 text-xs text-muted-foreground">Not enough deals in this stage yet to say what is usual.</p>}
                </div>
              )}
            </section>

            {data.can.edit && open && <UnclogChips items={data.suggestions} onPick={(u) => setFlow({ action: u.action, title: u.label })} />}

            {data.can.edit && (
              <section aria-label="Actions" className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {open && <button type="button" className={PRIMARY} onClick={() => setFlow({ action: { kind: "status", status: "won" }, title: "Mark deal won" })} data-testid="deal-won"><Check aria-hidden className="size-4" />Won</button>}
                  {open && <button type="button" className={BTN} onClick={() => setFlow({ action: { kind: "status", status: "lost" }, title: "Mark deal lost" })} data-testid="deal-lost">Lost</button>}
                  {!open && <button type="button" className={BTN} onClick={() => setFlow({ action: { kind: "status", status: "open" }, title: "Reopen deal" })} data-testid="deal-reopen">Reopen</button>}
                  {data.contact && <button type="button" className={BTN} onClick={() => setFlow({ action: { kind: "task", title: `Follow up: ${data.deal.name}`.slice(0, 200), dueDate: new Date(Date.now() + 86_400_000).toISOString() }, title: "Create a follow-up task" })} data-testid="deal-task"><ListTodo aria-hidden className="size-4" />Task</button>}
                  {data.contact && <NoteButton onGo={(text) => setFlow({ action: { kind: "note", text }, title: "Add a note" })} />}
                  {data.can.del && <button type="button" className={`${BTN} text-destructive`} onClick={() => setFlow({ action: { kind: "delete", typed: "" }, title: "Delete deal" })} data-testid="deal-delete"><Trash2 aria-hidden className="size-4" />Delete</button>}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-xs text-muted-foreground">Move to stage
                    <select className={`${FIELD} mt-1 w-full text-foreground`} value="" onChange={(e) => { const [p, s] = e.target.value.split("|"); if (p && s) setFlow({ action: { kind: "stage", pipelineId: p, stageId: s }, title: "Move the deal" }); }} data-testid="deal-stage-pick">
                      <option value="">Choose a stage</option>
                      {data.pipelines.map((pl) => <optgroup key={pl.id} label={pl.name}>{pl.stages.map((s) => <option key={s.id} value={`${pl.id}|${s.id}`} disabled={s.id === data.deal.stageId}>{s.name}</option>)}</optgroup>)}
                    </select>
                  </label>
                  <ValueEdit value={data.deal.value} onGo={(v) => setFlow({ action: { kind: "value", value: v }, title: "Change the value" })} />
                </div>
              </section>
            )}

            <section aria-label="Who">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner and source</h3>
              {data.can.reassign ? (
                <label className="block text-sm"><span className="text-muted-foreground">Owner </span><b>{data.owner.name}</b>
                  <select className={`${FIELD} mt-1 block w-full`} value="" onChange={(e) => { if (e.target.value) setFlow({ action: { kind: "owner", userId: e.target.value }, title: "Change the owner" }); }} data-testid="deal-owner-pick">
                    <option value="">Change owner</option>
                    {data.team.filter((t) => t.id !== data.owner.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              ) : <p className="text-sm"><span className="text-muted-foreground">Owner </span><b>{data.owner.name}</b></p>}
              <p className="mt-1 text-sm"><span className="text-muted-foreground">Source </span><b>{data.deal.source ?? "not recorded"}</b>{data.deal.createdAt ? <span className="text-xs text-muted-foreground">, created {when(data.deal.createdAt, data.deal.timeZone)}</span> : null}</p>
              {data.contact && <p className="mt-1 text-sm"><span className="text-muted-foreground">Contact </span><b>{data.contact.name}</b>{data.contact.otherDeals > 0 ? <span className="text-xs text-muted-foreground">, {data.contact.otherDeals} other deal{data.contact.otherDeals === 1 ? "" : "s"}</span> : null}</p>}
            </section>

            <section aria-label="Appointments" className="text-sm">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Appointments with this person</h3>
              {data.appointments.length === 0 ? <p className="text-muted-foreground">None booked.</p> : <ul className="divide-y rounded-md border">{data.appointments.map((a) => <li key={a.id} className="flex justify-between gap-2 px-3 py-1.5"><span>{a.startAt ? when(a.startAt, data.deal.timeZone) : "No time"}{a.calendar ? `, ${a.calendar}` : ""}</span><span className="text-xs text-muted-foreground">{a.status ?? "booked"}</span></li>)}</ul>}
            </section>

            <section aria-label="Change timeline">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What happened</h3>
              {data.timeline.length === 0 ? <p className="text-sm text-muted-foreground">No changes recorded yet.</p> : (
                <ol className="relative space-y-3 border-l pl-4" data-testid="deal-timeline">
                  {data.timeline.map((t, i) => (
                    <li key={`${t.at}-${i}`} className="relative text-sm">
                      <span aria-hidden className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${t.source === "subsync" ? "bg-primary shadow-[0_0_10px_var(--primary)]" : "bg-muted-foreground/60"}`} />
                      <p>{t.text}</p><p className="text-xs text-muted-foreground">{when(t.at, data.deal.timeZone)}</p>
                      {t.undoable && t.batchId && <div className="mt-1"><DealUndoButton locationId={locationId} batchId={t.batchId} onDone={changed} minutes={data.undoMinutes} /></div>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <ModeLine mode={data.mode} needsPermission={data.needsPermission} />
          </>
        ) : null}
      </div>
      {data && flow && <DealChangeFlow locationId={locationId} opportunityId={id} action={flow.action} title={flow.title} lostReasons={data.lostReasons} onClose={() => setFlow(null)} onChanged={changed} />}
    </aside>
  );
}

function NoteButton({ onGo }: { onGo: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState("");
  return open ? (
    <form className="flex w-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (t.trim()) { onGo(t.trim()); setOpen(false); setT(""); } }}>
      <textarea value={t} onChange={(e) => setT(e.target.value)} maxLength={5000} rows={3} aria-label="Note" placeholder="An internal note on the contact" className="rounded-md border bg-background p-2 text-sm" />
      <div className="flex gap-2"><button type="submit" className={PRIMARY}>Preview</button><button type="button" className={BTN} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  ) : <button type="button" className={BTN} onClick={() => setOpen(true)} data-testid="deal-note"><StickyNote aria-hidden className="size-4" />Note</button>;
}

function ValueEdit({ value, onGo }: { value: number | null; onGo: (v: number) => void }) {
  const [v, setV] = useState(value ? String(value) : "");
  const num = v.trim() === "" ? NaN : Number(v);
  return (
    <form className="text-xs text-muted-foreground" onSubmit={(e) => { e.preventDefault(); if (Number.isFinite(num)) onGo(num); }}>
      <label>Value
        <div className="mt-1 flex gap-2">
          <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" aria-label="Deal value" className={`${FIELD} w-full text-foreground`} data-testid="deal-value-input" />
          <button type="submit" className={BTN} disabled={!Number.isFinite(num) || num === (value ?? 0)} aria-label="Preview the new value"><Pencil aria-hidden className="size-4" /></button>
        </div>
      </label>
    </form>
  );
}
