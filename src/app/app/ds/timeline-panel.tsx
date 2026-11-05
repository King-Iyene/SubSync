"use client";

import { CalendarClock, CircleDollarSign, Clock, MessageSquare, NotebookPen, Phone, Search, Tag, UserPlus, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import type { TimelineItem, TimelineKind } from "@/lib/people/person";
import { InfoTip } from "./info-tip";

// The contact's timeline: a vertical, independently scrolling list grouped by day, every time shown in the CLIENT ACCOUNT's own time zone (named once in the header). It shows only
// what SubSync really has from the CRM and its own event store; kinds the CRM does not give (forms, workflow steps, email opens, tasks) are listed in the legend as unavailable, never faked.

const ICON: Record<TimelineKind, typeof Phone> = { contact: UserPlus, message: MessageSquare, call: Phone, appointment: CalendarClock, deal: CircleDollarSign, tag: Tag, touch: Zap, note: NotebookPen };
const KIND_WORD: Record<TimelineKind, string> = { contact: "Contact", message: "Message", call: "Call", appointment: "Appointment", deal: "Deal", tag: "Tag", touch: "First reply", note: "Note" };
type Chip = { id: string; label: string; kinds: TimelineKind[] };
const CHIPS: Chip[] = [
  { id: "all", label: "All", kinds: [] }, { id: "messages", label: "Messages", kinds: ["message", "touch"] }, { id: "calls", label: "Calls", kinds: ["call"] },
  { id: "appointments", label: "Appointments", kinds: ["appointment"] }, { id: "deals", label: "Deals", kinds: ["deal"] }, { id: "tags", label: "Tags", kinds: ["tag"] },
  { id: "notes", label: "Notes", kinds: ["note"] }, { id: "other", label: "Other", kinds: ["contact"] },
];
const UNAVAILABLE = ["Forms", "Workflows", "Tasks"];
const PAGE = 30;

const zoneLabel = (tz: string | null) => {
  if (!tz) return "UTC";
  try {
    const abbr = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return `${tz.split("/").pop()!.replace(/_/g, " ")}${abbr ? `, ${abbr}` : ""}`;
  } catch { return "UTC"; }
};
const inZone = (tz: string | null, o: Intl.DateTimeFormatOptions, iso: string) => { try { return new Date(iso).toLocaleString("en-GB", { ...o, ...(tz ? { timeZone: tz } : { timeZone: "UTC" }) }); } catch { return new Date(iso).toLocaleString("en-GB", { ...o, timeZone: "UTC" }); } };

export function TimelinePanel({ items, timeZone, note, className = "" }: { items: readonly TimelineItem[]; timeZone: string | null; note?: string | null; className?: string }) {
  const [chip, setChip] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const kinds = CHIPS.find((c) => c.id === chip)?.kinds ?? [];
  const list = useMemo(() => items.filter((t) => (kinds.length === 0 || kinds.includes(t.kind)) && (!q.trim() || `${t.title} ${t.detail ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, kinds, q]);
  const page = list.slice(0, shown);
  const groups = useMemo(() => {
    const out: Array<{ day: string; rows: TimelineItem[] }> = [];
    for (const t of page) {
      const day = inZone(timeZone, { weekday: "short", day: "numeric", month: "short", year: "numeric" }, t.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(t); else out.push({ day, rows: [t] });
    }
    return out;
  }, [page, timeZone]);
  return (
    <section aria-label="Timeline" className={`flex min-h-0 flex-col rounded-xl border bg-card ${className}`} data-testid="drawer-timeline">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Timeline</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" data-testid="timeline-zone"><Clock aria-hidden className="size-3" />Times in {zoneLabel(timeZone)}</span>
          <InfoTip label="About the timeline" text={`Everything SubSync can read about this contact, newest first. Not available from your CRM: ${UNAVAILABLE.join(", ").toLowerCase()}, email opens and page views. Tag dates are the date SubSync first saw or applied the tag.`} />
        </div>
        <label className="relative block"><span className="sr-only">Search the timeline</span><Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search" className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm" data-testid="timeline-search" /></label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the timeline">
          {CHIPS.map((c) => <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => { setChip(c.id); setShown(PAGE); }} className={`min-h-8 cursor-pointer rounded-full border px-2.5 text-xs font-medium ${chip === c.id ? "border-primary bg-primary/15 text-primary" : "hover:bg-accent"}`} data-testid={`timeline-chip-${c.id}`}>{c.label}</button>)}
          {UNAVAILABLE.map((l) => <span key={l} title="Not available from your CRM" className="inline-flex min-h-8 cursor-not-allowed items-center rounded-full border border-dashed px-2.5 text-xs text-muted-foreground opacity-60" data-testid="timeline-unavailable">{l}</span>)}
        </div>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3" data-testid="timeline-scroll">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches.</p> : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.day}>
                <p className="sticky top-0 z-[1] -mx-1 mb-2 bg-card/95 px-1 py-1 text-xs font-semibold text-muted-foreground" data-testid="timeline-day">{g.day}</p>
                <ol className="space-y-3 border-l pl-4">
                  {g.rows.map((t, i) => {
                    const Icon = ICON[t.kind] ?? MessageSquare;
                    return (
                      <li key={t.at + t.title + i} className="relative text-sm" data-kind={t.kind} data-testid="timeline-event">
                        <Icon aria-hidden className="absolute -left-[1.6rem] top-0.5 size-3.5 rounded-full bg-card text-muted-foreground" />
                        <p className="flex items-baseline gap-2"><span className="tabular-nums text-xs text-muted-foreground" data-testid="timeline-time">{inZone(timeZone, { hour: "2-digit", minute: "2-digit", hour12: false }, t.at)}</span><span className="font-medium"><span className="sr-only">{KIND_WORD[t.kind]}: </span>{t.title}</span></p>
                        {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
            {list.length > shown && <button type="button" onClick={() => setShown((n) => n + PAGE)} className="min-h-9 w-full cursor-pointer rounded-md border text-sm font-medium hover:bg-accent" data-testid="timeline-older">Load older</button>}
          </div>
        )}
        {note && <p className="mt-3 text-xs text-muted-foreground" data-testid="drawer-live-note">{note}</p>}
      </div>
    </section>
  );
}
