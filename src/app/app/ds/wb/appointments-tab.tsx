"use client";

import { CalendarClock, ExternalLink } from "lucide-react";
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

export function AppointmentsTab({ ctx, crmUrl }: { ctx: WbContext; crmUrl?: string }) {
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
