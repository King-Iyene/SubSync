"use client";

import { CalendarClock, ExternalLink } from "lucide-react";
import type { Runner } from "./runner";
import type { WbContext } from "./types";

// This contact's appointments from SubSync's own copy (read only): upcoming first, then past. Times are shown in the client account's own time zone.

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

export function AppointmentsTab({ ctx, crmUrl, runner }: { ctx: WbContext; crmUrl?: string; runner?: Runner }) {
  const now = Date.now();
  const rows = ctx.appointments.filter((a) => a.at);
  const upcoming = rows.filter((a) => Date.parse(a.at!) >= now).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const past = rows.filter((a) => Date.parse(a.at!) < now);
  const Group = ({ title, list }: { title: string; list: typeof rows }) => list.length === 0 ? null : (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="tabular-nums">{list.length}</span></h3>
      <ul className="divide-y rounded-xl border bg-card" data-testid={`appt-${title.toLowerCase()}`}>
        {list.map((a) => {
          const w = when(a.at!, ctx.timeZone); const [label, cls] = CHIP[apptKind(a.status)];
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-testid="appt-row">
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">{a.title}</span><span className="block truncate text-xs text-muted-foreground">{a.calendar ?? "Calendar"}</span></span>
              <span className="text-sm tabular-nums text-muted-foreground">{w.day}, {w.time}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`} data-testid="appt-status">{label}</span>
              <details className="w-full text-sm" data-testid="appt-detail">
                <summary className="min-h-8 cursor-pointer text-xs font-medium text-primary">Details and actions</summary>
                <dl className="mt-1 divide-y rounded-lg border bg-background px-3 text-sm">
                  <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">When</dt><dd>{w.day}, {w.time}</dd></div>
                  <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Time zone</dt><dd>{ctx.timeZone ?? "Not recorded"}</dd></div>
                  <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Calendar</dt><dd>{a.calendar ?? "Not recorded"}</dd></div>
                  <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Assigned to</dt><dd>{ctx.users.find((u) => u.id === a.assignedTo)?.name ?? (a.assignedTo ? "A team member" : "Nobody")}</dd></div>
                  <div className="flex gap-3 py-1.5"><dt className="w-28 shrink-0 text-muted-foreground">Title</dt><dd className="break-words">{a.title}</dd></div>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2" data-testid="appt-actions">
                  {runner && (["showed", "noshow", "cancelled"] as const).map((st) => <button key={st} type="button" disabled={runner.busy || apptKind(a.status) === (st === "noshow" ? "noshow" : st)} onClick={() => void runner.preview({ kind: "appointment", appointmentId: a.id, status: st }, { verb: st === "showed" ? "Mark showed" : st === "noshow" ? "Mark no-show" : "Mark cancelled" })} className="min-h-9 cursor-pointer rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50" data-testid={`appt-set-${st}`}>{st === "showed" ? "Showed" : st === "noshow" ? "No-show" : "Cancelled"}</button>)}
                  {crmUrl && <a href={crmUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 cursor-pointer items-center gap-1 px-1 text-sm font-medium text-primary underline underline-offset-4">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <section aria-label="Appointments" className="space-y-5" data-testid="wb-appointments">
      {rows.length === 0 ? <p className="rounded-xl border border-dashed p-5 text-center text-[15px] text-muted-foreground" data-testid="appt-empty"><CalendarClock aria-hidden className="mx-auto mb-2 size-5" />No appointments yet</p> : <><Group title="Upcoming" list={upcoming} /><Group title="Past" list={past} /></>}
      {crmUrl && <a href={crmUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-sm font-medium text-primary underline underline-offset-4" data-testid="appt-open-crm">Open in your CRM<ExternalLink aria-hidden className="size-3.5" /></a>}
    </section>
  );
}
