"use client";

import { CalendarClock, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useApptCaps } from "../../views/appointment-actions-ui";
import { AppointmentPanel } from "../../views/appointment-panel";
import { PanelBoundary } from "../states";
import type { Runner } from "./runner";
import type { WbContext } from "./types";

// This contact's appointments from SubSync's own copy: upcoming first, then past. Times are shown in the client account's own time zone. Each one opens to its details and the same checked
// tools as the Appointments screen (move, book again, edit the title, change the owner, mark the outcome, delete with a typed confirmation), every change with a preview and Undo.

type Kind = "booked" | "showed" | "noshow" | "cancelled";
export const apptKind = (status: string | null): Kind => {
  const s = (status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  return s === "showed" || s === "completed" ? "showed" : s === "noshow" ? "noshow" : s === "cancelled" || s === "canceled" || s === "invalid" ? "cancelled" : "booked";
};
const CHIP: Record<Kind, [string, string]> = {
  booked: ["Booked", "bg-primary/15 text-primary"], showed: ["Showed", "bg-success/15 text-success"],
  noshow: ["No-show", "bg-destructive/15 text-destructive"], cancelled: ["Cancelled", "bg-muted text-muted-foreground"],
};

function when(iso: string, tz: string | null | undefined) {
  const o = (opts: Intl.DateTimeFormatOptions) => { try { return new Date(iso).toLocaleString("en-GB", { ...opts, ...(tz ? { timeZone: tz } : {}) }); } catch { return new Date(iso).toLocaleString("en-GB", opts); } };
  return { day: o({ weekday: "short", day: "numeric", month: "short", year: "numeric" }), time: o({ hour: "2-digit", minute: "2-digit" }) };
}

type Appt = WbContext["appointments"][number];
type Shared = { ctx: WbContext; locationId: string; crmUrl?: string; runner?: Runner; onChanged?: () => void };

// One appointment. A top-level component, not one made inside the list's render: a component made inside a render is a new component on every refresh of the panel (it refreshes every few
// seconds), which threw away the open "Details and actions" state a moment after it was opened. The open state is also kept here, so it survives a refresh.
function ApptItem({ a, ctx, locationId, crmUrl, runner, onChanged }: { a: Appt } & Shared) {
  const [open, setOpen] = useState(false);
  const caps = useApptCaps();
  const w = when(a.at!, ctx.timeZone); const [label, cls] = CHIP[apptKind(a.status)];
  const full = !!caps && (caps.edit || caps.reassign || caps.del);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-testid="appt-row">
      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{a.title}</span><span className="block truncate text-xs text-muted-foreground">{a.calendar ?? "Calendar"}</span></span>
      <span className="text-sm tabular-nums text-muted-foreground">{w.day}, {w.time}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`} data-testid="appt-status">{label}</span>
      <details className="w-full text-sm" data-testid="appt-detail" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="min-h-8 cursor-pointer text-xs font-medium text-primary">Details and actions</summary>
        {open && full ? (
          <div className="-mx-1 mt-1 [&>aside]:max-w-none [&>aside]:border-0 [&>aside]:bg-transparent [&>aside]:shadow-none [&>aside>div:first-child]:hidden" data-testid="appt-full-tools">
            <PanelBoundary label="The appointment tools could not be shown.">
              <AppointmentPanel locationId={locationId} id={a.id} onClose={() => setOpen(false)} onChanged={onChanged} />
            </PanelBoundary>
          </div>
        ) : (
          <>
            <dl className="mt-1 divide-y rounded-lg border bg-background px-3 text-sm">
              <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">When</dt><dd>{w.day}, {w.time}</dd></div>
              <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Time zone</dt><dd>{ctx.timeZone ?? "Not recorded"}</dd></div>
              <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Calendar</dt><dd>{a.calendar ?? "Not recorded"}</dd></div>
              <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Assigned to</dt><dd>{ctx.users.find((u) => u.id === a.assignedTo)?.name ?? (a.assignedTo ? "A team member" : "Nobody")}</dd></div>
              <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Title</dt><dd className="break-words">{a.title}</dd></div>
            </dl>
            <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="appt-actions">
              {runner && (["showed", "noshow", "cancelled"] as const).map((st) => <button key={st} type="button" disabled={runner.busy || apptKind(a.status) === (st === "noshow" ? "noshow" : st)} onClick={() => void runner.preview({ kind: "appointment", appointmentId: a.id, status: st }, { verb: st === "showed" ? "Mark showed" : st === "noshow" ? "Mark no-show" : "Mark cancelled" })} className="min-h-9 cursor-pointer rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50" data-testid={`appt-set-${st}`}>{st === "showed" ? "Showed" : st === "noshow" ? "No-show" : "Cancelled"}</button>)}
              {!caps && <span className="text-xs text-muted-foreground" data-testid="appt-tools-note">Move, edit and delete are not switched on for your account yet.</span>}
              {crmUrl && <a href={crmUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 cursor-pointer items-center gap-1 px-1 text-sm font-medium text-primary underline underline-offset-4">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
            </div>
          </>
        )}
      </details>
    </li>
  );
}

function ApptGroup({ title, list, ...rest }: { title: string; list: Appt[] } & Shared) {
  if (list.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="tabular-nums">{list.length}</span></h3>
      <ul className="divide-y rounded-xl border bg-card" data-testid={`appt-${title.toLowerCase()}`}>{list.map((a) => <ApptItem key={a.id} a={a} {...rest} />)}</ul>
    </div>
  );
}

export function AppointmentsTab({ ctx, crmUrl, runner, locationId, onChanged }: { ctx: WbContext; crmUrl?: string; runner?: Runner; locationId: string; onChanged?: () => void }) {
  const [now] = useState(() => Date.now());
  const rows = ctx.appointments.filter((a) => a.at);
  const upcoming = rows.filter((a) => Date.parse(a.at!) >= now).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const past = rows.filter((a) => Date.parse(a.at!) < now);
  const rest = { ctx, locationId, crmUrl, runner, onChanged };
  return (
    <section aria-label="Appointments" className="space-y-5" data-testid="wb-appointments">
      {rows.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-center text-[15px] text-muted-foreground" data-testid="appt-empty"><CalendarClock aria-hidden className="mx-auto mb-2 size-5" />No appointments yet</p> : <><ApptGroup title="Upcoming" list={upcoming} {...rest} /><ApptGroup title="Past" list={past} {...rest} /></>}
      {crmUrl && <a href={crmUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-sm font-medium text-primary underline underline-offset-4" data-testid="appt-open-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
    </section>
  );
}
