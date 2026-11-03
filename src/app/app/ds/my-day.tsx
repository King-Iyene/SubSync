"use client";

import { Phone } from "lucide-react";
import { useState } from "react";
import { waitLabel } from "@/lib/design/ui-logic";
import type { GoFn } from "../nav";
import { useData } from "../session";
import { Badge } from "../ui";
import { InlineAlert } from "./alert";
import { LeadDrawer, type LeadSeed } from "./lead-drawer";
import { EmptyState, ErrorState, SkeletonRows } from "./states";
import { Page, Section } from "./template";

// "My day" (D0 item 4, N29): the page a setter or a realtor opens on a phone. Action first: who to answer, who to call, what to mark. One column, large
// tap targets (at least 48 px tall), plain words, no charts and no settings. It reads the same two endpoints Speed to lead and Appointments read, for the
// person's own account only, so its numbers are those pages' numbers.
type Waiting = { locationId: string; locationName: string; contactId: string; name: string; waitingMinutes: number; url: string; unassigned?: boolean; neverAnswered?: boolean };
type Speed = { waiting: Waiting[]; overall: { stillWaiting: number }; neverAnswered?: number; access: { ok: number; total: number } };
type Person = { contactId: string; name: string; phone: string | null; at: number; calendar: string | null; url: string };
type Appts = { unconfirmed: Person[]; unconfirmedTotal: number; recover: Person[]; recoverTotal: number; unmarkedTotal: number };

const tap = "flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 text-left text-base hover:border-primary/40 active:translate-y-px";
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

function CallList({ rows, verb }: { rows: Person[]; verb: string }) {
  return (
    <ul className="space-y-2">
      {rows.slice(0, 5).map((p) => (
        <li key={p.contactId + p.at} className="flex min-h-12 items-center gap-2 rounded-lg border bg-card px-4 py-2">
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{p.name}</p><p className="truncate text-xs text-muted-foreground">{p.calendar ?? "Appointment"} · {when(p.at)}</p></div>
          {/* Calls go through the CRM's own dialer (KF-3): this opens the contact in the CRM, never the phone's own dialer. */}
          {p.phone
            ? <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`${verb} ${p.name} in your CRM`} className="inline-flex min-h-12 min-w-12 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"><Phone aria-hidden className="size-4" />{verb} in your CRM</a>
            : <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center px-2 text-xs text-muted-foreground underline underline-offset-4">Open</a>}
        </li>
      ))}
    </ul>
  );
}

export function MyDayView({ go }: { go: GoFn }) {
  const speed = useData<Speed>("speed");
  const appts = useData<Appts>("appointments");
  const [open, setOpen] = useState<number | null>(null);
  if ((speed.loading && !speed.data) || (appts.loading && !appts.data)) return <Page title="My day" subtitle="What to do next, most urgent first."><SkeletonRows rows={5} label="Working out your day..." /></Page>;
  const error = speed.error ?? appts.error;
  if (error) return <Page title="My day"><ErrorState error={error} onRetry={() => { void speed.reload(); void appts.reload(); }} /></Page>;
  const waiting = speed.data?.waiting ?? [];
  const seeds: LeadSeed[] = waiting.map((w) => ({ contactId: w.contactId, locationId: w.locationId, name: w.name, locationName: w.locationName, unassigned: w.unassigned, url: w.url, note: `${w.neverAnswered ? "Never answered" : "Waiting for a reply"} for ${waitLabel(w.waitingMinutes)}.` }));
  const a = appts.data;
  const nothing = waiting.length === 0 && (a?.unconfirmedTotal ?? 0) === 0 && (a?.recoverTotal ?? 0) === 0 && (a?.unmarkedTotal ?? 0) === 0;
  return (
    <Page title="My day" subtitle="What to do next, most urgent first.">
      {speed.data && speed.data.access.total > 0 && speed.data.access.ok === 0 && <InlineAlert tone="warning" className="mb-5">Replies cannot be timed yet because a permission has not been approved. Ask the person who manages SubSync.</InlineAlert>}
      {nothing && <EmptyState title="Nothing is waiting for you right now" body="New leads, reminders and appointments to follow up appear here as they come in." />}

      {waiting.length > 0 && (
        <Section title={`Reply to these leads (${waiting.length})`} hint="The longest wait is first. Tap a name to see the lead.">
          <ul className="space-y-2" data-testid="myday-leads">
            {waiting.slice(0, 8).map((w, i) => (
              <li key={w.locationId + w.contactId}>
                <button type="button" onClick={() => setOpen(i)} className={tap}>
                  <span className="min-w-0 truncate font-medium">{w.name}</span>
                  <Badge tone="bad">{w.neverAnswered ? "never answered" : `waiting ${waitLabel(w.waitingMinutes)}`}</Badge>
                </button>
              </li>
            ))}
          </ul>
          {waiting.length > 8 && <button type="button" onClick={() => go("speed")} className="mt-2 min-h-12 text-sm font-medium text-primary underline">See all {waiting.length} on Speed to lead</button>}
        </Section>
      )}

      {a && a.unconfirmedTotal > 0 && <Section title={`Remind today (${a.unconfirmedTotal})`} hint="Booked, not yet confirmed, starting within two days."><CallList rows={a.unconfirmed} verb="Call" /></Section>}
      {a && a.recoverTotal > 0 && <Section title={`Call these no-shows (${a.recoverTotal})`} hint="Missed in the last 14 days and not booked again."><CallList rows={a.recover} verb="Call" /></Section>}
      {a && a.unmarkedTotal > 0 && (
        <Section title="Record what happened" hint="Past appointments with no outcome. Marking them keeps the show rate true.">
          <button type="button" onClick={() => go("appointments")} className={tap}><span>{a.unmarkedTotal} {a.unmarkedTotal === 1 ? "appointment needs" : "appointments need"} an outcome</span><span className="text-sm font-medium text-primary">Open</span></button>
        </Section>
      )}
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </Page>
  );
}
