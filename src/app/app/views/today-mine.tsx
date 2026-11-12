"use client";

import { CalendarCheck, CircleCheck, Phone, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { TodayData, TodayMine, TodayPerson } from "@/lib/analytics/today-types";
import { EmptyState, RowButton, type LeadSeed } from "../ds";
import { Btn } from "../ui";

// What a client's staff, a business owner or a setter also needs on Today (what "My day" used to be, now on Today itself): the calls to make and today's and tomorrow's
// appointments. The people who are waiting for a reply are NOT repeated here: they are the Reply now list above. Same compact row grid as every Today list.

const stamp = (p: TodayPerson, zone: string) => {
  try { return new Date(p.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: zone }); } catch { return new Date(p.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }); }
};
const GRID = "@container ds-row grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 py-2.5 pl-4 pr-2";

function CallRow({ name, sub, url, dnd, phone, verb = "Call", seed }: { name: string; sub?: string; url: string; dnd?: boolean; phone: boolean; verb?: string; seed?: LeadSeed | null }) {
  return (
    <li className={GRID} data-testid="call-row" data-dnd={dnd ? "true" : "false"}>
      <div className="min-w-0"><p className="truncate font-semibold">{dnd ? name : `${verb} ${name}`}</p>{sub && <p className="truncate text-sm text-muted-foreground">{sub}</p>}</div>
      {dnd
        ? <button type="button" disabled title="This person asked not to be contacted." className="inline-flex h-11 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-[4px] border px-2 text-sm font-medium text-muted-foreground opacity-70 sm:h-8"><Phone aria-hidden className="size-3.5" />No calls</button>
        : <RowButton href={url} seed={seed} label={phone ? "Call" : "Open"} sr={`${name}, ${phone ? "call in your CRM" : "no phone number"}`} />}
    </li>
  );
}

function CallGroup({ title, total, shown, children, testId }: { title: string; total: number; shown: number; children: React.ReactNode; testId: string }) {
  if (total === 0) return null;
  return (
    <div className="mb-4" data-testid={testId}>
      <h3 className="mb-1.5 font-medium">{title} <span className="t-num t-quiet font-normal">({total})</span></h3>
      <ul className="t-surface divide-y overflow-hidden">{children}</ul>
      {total > shown && <p className="t-small t-quiet mt-1">Showing {shown} of {total}. The rest are in Appointments.</p>}
    </div>
  );
}

export function CallsSection({ mine }: { mine: TodayMine }) {
  const c = mine.calls;
  const total = c.noshows.total + c.confirm.total;
  if (total === 0) return null;
  return (
    <section className="mb-10" aria-labelledby="my-calls-h" data-testid="my-calls">
      <h2 id="my-calls-h" className="t-title">Calls for today</h2>
      <div className="mb-3" />
      <CallGroup title="No-shows to rebook" total={c.noshows.total} shown={c.noshows.rows.length} testId="calls-noshows">
        {c.noshows.rows.map((p, i) => <CallRow key={`${p.contactId}-${i}`} name={p.name} sub={`Missed ${stamp(p, mine.timeZone)}${p.calendar ? `, ${p.calendar}` : ""}`} url={p.url} seed={p.contactId ? { contactId: p.contactId, locationId: p.locationId, name: p.name, url: p.url, phone: p.phone, dnd: p.dnd } : null} dnd={p.dnd} phone={!!p.phone} />)}
      </CallGroup>
      <CallGroup title="Appointments to confirm" total={c.confirm.total} shown={c.confirm.rows.length} testId="calls-confirm">
        {c.confirm.rows.map((p, i) => <CallRow key={`${p.contactId}-${i}`} verb="Confirm with" name={p.name} sub={`${stamp(p, mine.timeZone)}${p.calendar ? `, ${p.calendar}` : ""}`} url={p.url} seed={p.contactId ? { contactId: p.contactId, locationId: p.locationId, name: p.name, url: p.url, phone: p.phone, dnd: p.dnd } : null} dnd={p.dnd} phone={!!p.phone} />)}
      </CallGroup>
    </section>
  );
}

export function AppointmentsSection({ mine, go }: { mine: TodayMine; go: () => void }) {
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);
  const appts = [...mine.appointments.today.map((p) => ({ p, day: "Today" })), ...mine.appointments.tomorrow.map((p) => ({ p, day: "Tomorrow" }))];
  const shown = onlyUnmarked ? appts.filter((a) => a.p.noOutcome) : appts;
  const unmarked = appts.filter((a) => a.p.noOutcome).length;
  // No appointments today or tomorrow: no empty section (new bookings show up here when they exist).
  if (appts.length === 0) return null;
  return (
    <section className="mb-10" aria-labelledby="my-appts-h" data-testid="my-appts">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id="my-appts-h" className="t-title">Appointments today and tomorrow</h2>
          {unmarked > 0 && <p className="t-small t-quiet mt-0.5">{unmarked} of {appts.length} have no outcome yet</p>}
        </div>
        {unmarked > 0 && <Btn variant="ghost" onClick={() => setOnlyUnmarked(!onlyUnmarked)}>{onlyUnmarked ? "Show all" : "Only unmarked"}</Btn>}
      </div>
      {shown.length === 0 ? (
        <EmptyState compact title={appts.length === 0 ? "No appointments today or tomorrow" : "Every appointment is marked"} body={appts.length === 0 ? "New bookings show up here as they come in." : "Every appointment shown has an outcome."} />
      ) : (
        <ul className="t-surface divide-y overflow-hidden" data-testid="my-appts-list">
          {shown.map(({ p, day: d }, i) => (
            <li key={`${p.contactId}-${i}`} className={GRID} data-testid="my-appt" data-no-outcome={p.noOutcome ? "true" : "false"}>
              <div className="flex min-w-0 items-center gap-2.5">
                <CalendarCheck aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{d}, {stamp(p, mine.timeZone).replace(/^\w+, /, "")}{p.calendar ? `, ${p.calendar}` : ""}{p.noOutcome && <span className="inline-flex items-center gap-1 pl-2 font-medium text-warning"><TriangleAlert aria-hidden className="size-3.5" />No outcome marked</span>}</p>
                </div>
              </div>
              <RowButton href={p.url} seed={p.contactId ? { contactId: p.contactId, locationId: p.locationId, name: p.name, url: p.url, phone: p.phone, dnd: p.dnd } : null} label="Open" sr={p.name} />
            </li>
          ))}
        </ul>
      )}
      {unmarked > 0 && <div className="mt-1"><Btn variant="ghost" onClick={go}>Mark outcomes in Appointments</Btn></div>}
    </section>
  );
}

/** The calm all-clear: nothing waiting, nothing to call, nothing to mark. */
export function DoneForToday({ data, streak }: { data: TodayData; streak: number }) {
  return (
    <section className="mb-12 flex items-center gap-4" aria-label="Done for today" data-testid="done-for-today">
      <CircleCheck aria-hidden className="size-8 shrink-0 text-success" />
      <div className="min-w-0">
        <h2 className="t-title">Done for today</h2>
        <p className="t-small t-quiet mt-0.5" data-testid="streak">
          {streak > 0 ? `${streak} ${streak === 1 ? "day" : "days"} in a row with every new lead answered within ${data.targetMinutes} minutes.` : `Everyone has an answer. Aim to reply to each new lead within ${data.targetMinutes} minutes.`}
        </p>
      </div>
    </section>
  );
}
