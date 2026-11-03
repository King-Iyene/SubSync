"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { filterQueryOf, joinQuery, pathWith, windowQuery, type WidgetId } from "@/lib/design/appt-ui";
import { useData } from "../session";
import { CardRange, ChartPlaceholder, DataList, EmptyState, LeadDrawer, remember, remembered, SkeletonCards, useCardRange, type Column, type LeadSeed } from "../ds";
import { Badge, Card, ErrorBox, ExtLink, fmtInt, fmtMoney, Stat } from "../ui";
import { ApptFilterBar, ApptListPanel, Explainer, pct, TargetEditor, useApptFilter, when, type ApptRow, type FilterOptionsData } from "./appointment-parts";

type Heat = { weekday: number; hour: number; booked: number; held: number; noShow: number; showRate: number | null };
type Member = { locationId: string; contactId: string; name: string; locationName: string | null; url: string };
type SourceRow = { source: string; booked: number; held: number; noShow: number; showRate: number | null; outcomes: number; isCalendar: boolean; ids?: string[] };
type Item = Omit<ApptRow, "noOutcome"> & { weekday: number | null; hour: number | null };
type Data = {
  window: { from: string; to: string; days: number; defaulted: boolean; problem: string | null };
  target: { showRate: number; isDefault: boolean };
  health: { score: number | null; band: string | null; used: number; of: number; parts: Array<{ label: string; points: number | null; max: number; note: string }> };
  funnel: { steps: Array<{ step: string; count: number; kept: number | null; before: number | null; members: Member[] }>; biggestLeak: string | null; unmarked: number };
  heat: { cells: Heat[]; ready: boolean; outcomes: number; ratedCells: number; needOutcomes: number; best: { label: string; showRate: number | null } | null; worst: { label: string; showRate: number | null } | null; ratio: number | null };
  recovery: { noShows: number; rebooked: number; showedAgain: number; rebookRate: number | null; showAgainRate: number | null; avgDaysToRebook: number | null };
  repeatNoShows: Array<{ contactId: string; locationId: string; name: string; locationName: string | null; phone: string | null; count: number; lastAt: number; url: string }>;
  velocity: { booked: number; medianDays: number | null; averageDays: number | null; bySource: Array<{ source: string; count: number; medianDays: number }> };
  bySource: SourceRow[]; sourceNote: string | null;
  confirmations: { next48: number; confirmed: number; unconfirmed: number; tomorrowAdvice: string | null };
  sameDay: { sameDay: { count: number; showRate: number | null }; later: { count: number; showRate: number | null } };
  fairness: { rows: Array<{ key: string; label: string; count: number; share: number; skew: number }>; skewed: boolean; judged: boolean; note: string | null };
  doubleBookings: Array<{ kind: string; at: number; locationName: string | null; who: string }>;
  value: { showed: number; revenue: number; perAppointment: number | null; upcoming: number };
  forecast: { low: number; high: number; expected: number; basedOnWeeks: number } | null;
  followUp: { held: number; withoutFollowUp: number; gapRate: number | null; contacts: Array<{ contactId: string; locationId: string; name: string; locationName: string | null; at: number; url: string }> };
  briefs: Array<{ contactId: string; name: string; locationName: string | null; at: number; brief: string; url: string }>;
  items: Item[]; itemsTotal: number; itemCap: number;
  options: FilterOptionsData;
  sampleSize: number; canEditTargets: boolean;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const WIDGETS: Array<{ id: WidgetId; label: string }> = [
  { id: "health", label: "Calendar health" }, { id: "funnel", label: "From lead to customer" }, { id: "heat", label: "Best times to book" }, { id: "recovery", label: "No-show recovery" },
  { id: "repeat", label: "Repeat no-shows" }, { id: "source", label: "Show rate by lead source" }, { id: "velocity", label: "How fast leads get booked" }, { id: "confirm", label: "Reminders and confirmations" },
  { id: "fair", label: "Who gets the appointments" }, { id: "value", label: "What an appointment is worth" }, { id: "followup", label: "No follow-up after the appointment" }, { id: "double", label: "Double bookings" }, { id: "briefs", label: "Before your next appointments" },
];
const DEFAULT_HIDDEN: WidgetId[] = ["funnel", "velocity", "fair", "value", "followup"];
const INITIAL = { preset: "90d", compare: "none" } as const;
const GRACE = 3 * 3_600_000;

// A colour from red (low show rate) to green (high); a cell below 5 recorded outcomes has no colour and no number.
function cellStyle(c: Heat | undefined): React.CSSProperties {
  if (!c || c.showRate === null) return { background: "transparent" };
  return { background: `hsl(${Math.round(c.showRate * 120)} 65% 45% / 0.55)` };
}

const leadColumns: Array<Column<Member>> = [
  { key: "name", header: "Lead", primary: true, width: "minmax(0,2fr)", cell: (m) => m.name },
  { key: "account", header: "Client account", width: "minmax(0,1.5fr)", cell: (m) => <span className="text-muted-foreground">{m.locationName ?? ""}</span> },
];

export function AppointmentInsights() {
  const range = useCardRange("appointments-insights", INITIAL);
  const [filter, setFilter] = useApptFilter();
  const query = joinQuery(windowQuery(range.resolved), filterQueryOf(filter));
  const { data, error, loading, reload } = useData<Data>(range.resolved ? pathWith("appointment-insights", query) : null);
  const [hidden, setHidden] = useState<WidgetId[]>([]);
  const [apptList, setApptList] = useState<{ title: string; count: number; rows: ApptRow[] } | null>(null);
  const [leadList, setLeadList] = useState<{ title: string; count: number; rows: Member[] } | null>(null);
  const [leadIndex, setLeadIndex] = useState<number | null>(null);
  const [personIndex, setPersonIndex] = useState<{ rows: Array<{ contactId: string; locationId: string; name: string; locationName: string | null; url: string; note: string }>; i: number | null }>({ rows: [], i: null });
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The browser's own memory is read after the page is up; the same pattern as the card range (stage D0).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const raw = remembered("appt-widgets-hidden"); const v = raw === null ? DEFAULT_HIDDEN : JSON.parse(raw); if (Array.isArray(v)) setHidden(v.filter((x): x is WidgetId => WIDGETS.some((w) => w.id === x))); } catch { /* nothing remembered */ }
  }, []);
  useEffect(() => { if (apptList || leadList) panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [apptList, leadList]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <SkeletonCards cards={4} label="Reading the appointment history..." />;
  const d = data;
  if (d.sampleSize === 0 && !filter.calendar && !filter.user && !filter.source) {
    return <EmptyState title="No appointment history yet" body="Once calendars have bookings, show rates by time and source, recovery, fairness and the rest appear here. SubSync reads the last 90 days and the next 60." />;
  }
  const show = (id: WidgetId) => !hidden.includes(id);
  const toggle = (id: WidgetId) => { const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]; setHidden(next); remember("appt-widgets-hidden", JSON.stringify(next)); };

  // Rows for the lists behind the grid and the source table. The same rows the count was made from; the page opens them, never re-counts them.
  const asRows = (xs: Item[]): ApptRow[] => { const now = Date.now(); return xs.map((i) => ({ ...i, noOutcome: !["showed", "noshow", "cancelled", "invalid"].includes(i.status) && i.at < now - GRACE })); };
  const openAppts = (title: string, count: number, xs: Item[]) => { setLeadList(null); setApptList({ title, count, rows: asRows(xs) }); };
  const openLeads = (title: string, count: number, rows: Member[]) => { setApptList(null); setLeadList({ title, count, rows }); };
  const f = d.heat;
  const w = d.window;

  // Cards that have not got enough data are one list with their progress, not a row of empty cards.
  const pending: Array<{ id: WidgetId; label: string; have: number; need: number; unit: string }> = [];
  if (!f.ready) pending.push({ id: "heat", label: "Best times to book", have: f.outcomes, need: f.needOutcomes, unit: "recorded outcomes" });
  if (d.recovery.rebookRate === null) pending.push({ id: "recovery", label: "No-show recovery", have: d.recovery.noShows, need: 5, unit: "no-shows older than 3 days" });
  if (d.bySource.length === 0) pending.push({ id: "source", label: "Show rate by lead source", have: 0, need: 3, unit: "appointments from one source" });
  if (d.velocity.medianDays === null) pending.push({ id: "velocity", label: "How fast leads get booked", have: d.velocity.booked, need: 1, unit: "booked leads" });
  if (d.value.perAppointment === null) pending.push({ id: "value", label: "What an appointment is worth", have: d.value.showed, need: 10, unit: "held appointments in 6 months" });
  if (d.followUp.gapRate === null) pending.push({ id: "followup", label: "No follow-up after the appointment", have: d.followUp.held, need: 5, unit: "held appointments in the last two weeks" });
  const waiting = pending.filter((p) => show(p.id));
  const ready = (id: WidgetId) => show(id) && !pending.some((p) => p.id === id);

  return (
    <div className={`space-y-6 ${loading ? "opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
      <Card title="Dates and filters">
        <ApptFilterBar options={d.options} value={filter} onChange={(v) => { setApptList(null); setLeadList(null); setFilter(v); }} />
        <CardRange state={range} label="Insights dates" compares={["none"]} maxDays={180} />
        <p className="mt-2 text-xs text-muted-foreground" data-testid="insights-window">
          Best times, lead source and lead to customer look at {w.from === w.to ? w.from : `${w.from} to ${w.to}`} ({w.days} day{w.days === 1 ? "" : "s"}). The other cards say their own period in their text. Calendar, person and lead-source filters apply to every card.
        </p>
        {w.problem && <p className="mt-1 border-l-2 border-warning pl-2 text-xs" role="status">{w.problem}</p>}
        <div className="mt-3"><TargetEditor key={d.target.showRate} value={d.target.showRate} isDefault={d.target.isDefault} canEdit={d.canEditTargets} onSaved={reload} /></div>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">Choose what to show ({WIDGETS.length - hidden.length} of {WIDGETS.length})</summary>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {WIDGETS.map((x) => <li key={x.id}><label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="size-4" checked={!hidden.includes(x.id)} onChange={() => toggle(x.id)} />{x.label}</label></li>)}
          </ul>
          <p className="mt-1 text-muted-foreground">Kept in this browser only.</p>
        </details>
      </Card>

      <div ref={panel}>
        {apptList && <ApptListPanel title={apptList.title} count={apptList.count} rows={apptList.rows} showAccount={new Set(apptList.rows.map((r) => r.locationId)).size > 1} onBack={() => setApptList(null)} />}
        {leadList && (
          <section className="mt-4" aria-label={`List behind ${leadList.title}`} data-testid="lead-list-panel">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{leadList.title}: <span data-testid="lead-list-count">{leadList.count}</span> {leadList.count === 1 ? "lead" : "leads"}</h3>
              <button type="button" onClick={() => setLeadList(null)} className="min-h-9 text-xs font-medium text-primary underline">Close the list</button>
            </div>
            <DataList rows={leadList.rows} columns={leadColumns} rowKey={(m) => m.locationId + m.contactId} total={leadList.count} onOpen={(_, i) => setLeadIndex(i)} caption={leadList.title} empty="Nothing behind this one." />
            {leadList.count > leadList.rows.length && <p className="mt-1 text-xs text-muted-foreground">Showing the first {leadList.rows.length} of {leadList.count}. The number above is the full count.</p>}
            <LeadDrawer leads={leadList.rows.map<LeadSeed>((m) => ({ contactId: m.contactId, locationId: m.locationId, name: m.name, locationName: m.locationName, url: m.url }))} index={leadIndex} onIndex={setLeadIndex} onClose={() => setLeadIndex(null)} />
          </section>
        )}
      </div>

      {(show("health") || show("funnel")) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {show("health") && (
            <Card title="Calendar health" className="lg:col-span-1">
              <p className="text-4xl font-semibold tabular-nums" data-testid="health-score">{d.health.score === null ? "n/a" : d.health.score}{d.health.score !== null && <span className="text-base font-normal text-muted-foreground"> / 100</span>}</p>
              <p className="mb-3 mt-1">
                {d.health.band ? <Badge tone={d.health.band === "healthy" ? "good" : d.health.band === "watch" ? "warn" : "bad"}>{d.health.band}</Badge> : <span className="text-xs text-muted-foreground">Needs at least 3 of the 4 checks. {d.health.used} of {d.health.of} have data.</span>}
              </p>
              <ul className="space-y-1.5 text-sm">{d.health.parts.map((p) => <li key={p.label} className="flex justify-between gap-2"><span>{p.label} <span className="block text-xs text-muted-foreground">{p.note}</span></span><span className="tabular-nums">{p.points === null ? "n/a" : `${p.points}/${p.max}`}</span></li>)}</ul>
              <Explainer id="health" />
            </Card>
          )}
          {show("funnel") && (
            <Card title={`From lead to customer (${w.days} days)`} className={show("health") ? "lg:col-span-2" : "lg:col-span-3"}>
              <ul className="space-y-2">
                {d.funnel.steps.map((s) => {
                  const top = d.funnel.steps[0].count || 1;
                  const row = (
                    <>
                      <span className="flex justify-between"><span>{s.step}</span><span className="tabular-nums">{fmtInt(s.count)}{s.kept !== null ? <span className="text-xs text-muted-foreground"> · {pct(s.kept)} of the step before</span> : null}</span></span>
                      <span className="mt-1 block h-2 rounded-full bg-muted"><span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (s.count / top) * 100)}%` }} /></span>
                    </>
                  );
                  return (
                    <li key={s.step} className="text-sm">
                      {s.count > 0
                        ? <button type="button" className="block w-full text-left hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/30" aria-label={`${s.step}: ${s.count} leads, open the list`} title="Click to see the leads" onClick={() => openLeads(s.step, s.count, s.members)}>{row}</button>
                        : row}
                    </li>
                  );
                })}
              </ul>
              {d.funnel.biggestLeak && <p className="mt-3 text-sm font-medium">Biggest drop: {d.funnel.biggestLeak}</p>}
              {!d.funnel.biggestLeak && <p className="mt-3 text-xs text-muted-foreground">No biggest drop is named until a step has at least 10 leads before it.</p>}
              {d.funnel.unmarked > 0 && <p className="mt-2 text-xs text-muted-foreground">{d.funnel.unmarked} past appointment{d.funnel.unmarked === 1 ? " has" : "s have"} no outcome recorded, so Showed and Became customers may be lower than the truth.</p>}
              <p className="mt-2 text-xs text-muted-foreground">A customer is a lead with at least one won deal.</p>
              <Explainer id="funnel" />
            </Card>
          )}
        </div>
      )}

      {ready("heat") && (
        <Card title={`Best times to book (show rate by day and hour, ${w.days} days)`}>
          {f.best && f.worst && f.best.label !== f.worst.label && (
            <p className="mb-3 text-sm font-medium">
              People show most on {f.best.label} ({pct(f.best.showRate)}) and least on {f.worst.label} ({pct(f.worst.showRate)}){f.ratio && f.ratio >= 1.5 ? `: about ${f.ratio.toFixed(1)} times as likely` : ""}. Consider moving availability toward the better slots.
            </p>
          )}
          <HeatGrid cells={f.cells} onOpen={(c) => openAppts(`${DAYS[c.weekday]} at ${hourLabel(c.hour)}`, c.booked, d.items.filter((i) => i.weekday === c.weekday && i.hour === c.hour && i.status !== "cancelled"))} />
          <p className="mt-2 text-xs text-muted-foreground">Each coloured square is a day and hour with at least 5 recorded outcomes; the number is its show rate. Press one to see its appointments. Times are in each account&apos;s own time zone.</p>
          <Explainer id="heat" />
        </Card>
      )}

      {(ready("recovery") || ready("repeat")) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {ready("recovery") && (
            <Card title="No-show recovery">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Rebooked" value={pct(d.recovery.rebookRate)} sub={`${d.recovery.rebooked} of ${d.recovery.noShows} no-shows`} />
                <Stat label="Showed the second time" value={pct(d.recovery.showAgainRate)} sub={d.recovery.showAgainRate === null ? `Needs 5 rebookings, ${d.recovery.rebooked} so far` : `${d.recovery.showedAgain} of ${d.recovery.rebooked}`} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{d.recovery.avgDaysToRebook !== null ? `People who rebook take about ${d.recovery.avgDaysToRebook} days to do it.` : "Not enough rebookings yet to say how long it takes."}</p>
              <Explainer id="recovery" />
            </Card>
          )}
          {show("repeat") && (
            <Card title={`Repeat no-shows (${d.repeatNoShows.length})`}>
              {d.repeatNoShows.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has missed two or more appointments.</p> : (
                <DataList rows={d.repeatNoShows} rowKey={(r) => r.contactId + r.locationId} caption="Repeat no-shows"
                  columns={[
                    { key: "name", header: "Person", primary: true, width: "minmax(0,2fr)", cell: (r) => r.name },
                    { key: "n", header: "Missed", width: "5rem", align: "right", cell: (r) => <span className="tabular-nums">{r.count}</span> },
                    { key: "acc", header: "Client account", width: "minmax(0,1.5fr)", cell: (r) => <span className="text-muted-foreground">{r.locationName ?? ""}</span> },
                  ] satisfies Array<Column<Data["repeatNoShows"][number]>>}
                  onOpen={(r) => setPersonIndex({ rows: d.repeatNoShows.map((x) => ({ contactId: x.contactId, locationId: x.locationId, name: x.name, locationName: x.locationName, url: x.url, note: `Missed ${x.count} appointments.` })), i: d.repeatNoShows.indexOf(r) })} />
              )}
              <Explainer id="repeat" />
            </Card>
          )}
        </div>
      )}

      {(ready("source") || ready("velocity")) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {ready("source") && (
            <Card title="Show rate by lead source">
              <DataList rows={d.bySource} rowKey={(s) => s.source} caption="Show rate by lead source"
                columns={[
                  { key: "s", header: "Source", primary: true, width: "minmax(0,2fr)", cell: (s) => s.source },
                  { key: "b", header: "Booked", width: "4.5rem", align: "right", cell: (s) => <span className="tabular-nums">{s.booked}</span> },
                  { key: "h", header: "Showed", width: "4.5rem", align: "right", cell: (s) => <span className="tabular-nums">{s.held}</span> },
                  { key: "r", header: "Show rate", width: "5rem", align: "right", cell: (s) => <span className="tabular-nums">{pct(s.showRate)}</span> },
                ] satisfies Array<Column<SourceRow>>}
                onOpen={(s) => { const ids = new Set(s.ids ?? []); openAppts(s.source, s.booked, d.items.filter((i) => ids.has(i.id))); }} />
              {d.sourceNote && <p className="mt-2 text-xs text-muted-foreground">{d.sourceNote}</p>}
              <Explainer id="source" />
            </Card>
          )}
          {ready("velocity") && (
            <Card title="How fast leads get booked">
              <p className="text-sm">Half of booked leads were booked within <strong>{d.velocity.medianDays} days</strong> of arriving (average {d.velocity.averageDays}).</p>
              {d.velocity.bySource.length > 0 && <ul className="mt-2 space-y-1 text-sm">{d.velocity.bySource.map((s) => <li key={s.source} className="flex justify-between"><span>{s.source}</span><span className="tabular-nums text-muted-foreground">{s.medianDays} days · {s.count} leads</span></li>)}</ul>}
              <p className="mt-3 text-sm text-muted-foreground">Booked the same day: {d.sameDay.sameDay.count} ({pct(d.sameDay.sameDay.showRate)} show) · booked earlier: {d.sameDay.later.count} ({pct(d.sameDay.later.showRate)} show).</p>
              <Explainer id="velocity" />
            </Card>
          )}
        </div>
      )}

      {(show("confirm") || show("fair") || ready("value")) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {show("confirm") && (
            <Card title="Reminders and confirmations">
              <p className="text-sm">{d.confirmations.tomorrowAdvice ?? (d.confirmations.next48 === 0 ? "Nothing is booked for the next two days." : `All ${d.confirmations.next48} appointments in the next two days are confirmed.`)}</p>
              <Explainer id="confirm" />
            </Card>
          )}
          {show("fair") && (
            <Card title="Who gets the appointments">
              {d.fairness.rows.length === 0 ? <p className="text-sm text-muted-foreground">No assigned appointments yet.</p> : (
                <ul className="space-y-1 text-sm">{d.fairness.rows.map((r) => <li key={r.key} className="flex justify-between"><span>{r.label}</span><span className="tabular-nums text-muted-foreground">{r.count} · {Math.round(r.share * 100)}%</span></li>)}</ul>
              )}
              {!d.fairness.judged && d.fairness.rows.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Needs 2 people and 10 appointments before it says whether the split is even.</p>}
              {d.fairness.note && <p className="mt-2 text-sm font-medium text-warning">Uneven: {d.fairness.note}</p>}
              <Explainer id="fair" />
            </Card>
          )}
          {ready("value") && (
            <Card title="What an appointment is worth">
              <p className="text-sm">Each appointment that was held has been worth about <strong>{fmtMoney(d.value.perAppointment as number)}</strong> in won deals ({fmtInt(d.value.showed)} held, {fmtMoney(d.value.revenue)} won). {fmtInt(d.value.upcoming)} are coming up. This is an estimate.</p>
              {d.forecast && <p className="mt-3 text-sm text-muted-foreground">Next week, expect about {d.forecast.expected} appointments (likely {d.forecast.low} to {d.forecast.high}), from the last {d.forecast.basedOnWeeks} weeks.</p>}
              <Explainer id="value" />
            </Card>
          )}
        </div>
      )}

      {(ready("followup") || show("double")) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {ready("followup") && (
            <Card title={`No follow-up after the appointment (${d.followUp.withoutFollowUp})`}>
              <p className="mb-2 text-sm text-muted-foreground">{d.followUp.withoutFollowUp} of {d.followUp.held} appointments held in the last two weeks have had no message from your team since ({pct(d.followUp.gapRate)}).</p>
              {d.followUp.contacts.length > 0 && (
                <DataList rows={d.followUp.contacts} rowKey={(c) => c.contactId + c.at} caption="No follow-up" columns={[
                  { key: "n", header: "Person", primary: true, width: "minmax(0,2fr)", cell: (c) => c.name },
                  { key: "w", header: "Appointment", width: "minmax(0,1.5fr)", cell: (c) => <span className="tabular-nums text-muted-foreground">{when(c.at)}</span> },
                ] satisfies Array<Column<Data["followUp"]["contacts"][number]>>}
                  onOpen={(_, i) => setPersonIndex({ rows: d.followUp.contacts.map((x) => ({ contactId: x.contactId, locationId: x.locationId, name: x.name, locationName: x.locationName, url: x.url, note: `Appointment held ${when(x.at)}, no message since.` })), i })} />
              )}
              <Explainer id="followup" />
            </Card>
          )}
          {show("double") && (
            <Card title={`Double bookings (${d.doubleBookings.length})`}>
              {d.doubleBookings.length === 0 ? <p className="text-sm text-muted-foreground">No one is booked twice at the same time in the next two weeks.</p> : (
                <ul className="divide-y text-sm">{d.doubleBookings.map((b, i) => <li key={i} className="py-1.5"><span className="font-medium">{b.who}</span> <span className="text-muted-foreground">· {b.kind === "person" ? "booked on top of another appointment" : "booked twice in one day"} · {when(b.at)}{b.locationName ? ` · ${b.locationName}` : ""}</span></li>)}</ul>
              )}
              <Explainer id="double" />
            </Card>
          )}
        </div>
      )}

      {show("briefs") && (
        <Card title="Before your next appointments">
          {d.briefs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing booked with a known contact in the next 7 days.</p> : (
            <ul className="divide-y">{d.briefs.map((b) => <li key={b.contactId + b.at} className="py-3 text-sm first:pt-0 last:pb-0"><p className="leading-6">{b.brief}</p><p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">{b.locationName && <span>{b.locationName}</span>}<ExtLink href={b.url}>Open contact</ExtLink></p></li>)}</ul>
          )}
          <Explainer id="briefs" />
        </Card>
      )}

      {waiting.length > 0 && (
        <Card title="Not enough data yet" >
          <p className="mb-3 text-sm text-muted-foreground">These cards appear on their own once there is enough data to say something true. Nothing is guessed in the meantime.</p>
          <ul className="space-y-2" data-testid="insights-pending">
            {waiting.map((p) => (
              <li key={p.id} className="text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium">{p.label}</span><span className="tabular-nums text-muted-foreground">{Math.min(p.have, p.need)} of {p.need} {p.unit}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-muted" aria-hidden><div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.min(100, (p.have / p.need) * 100)}%` }} /></div>
                <Explainer id={p.id} />
              </li>
            ))}
          </ul>
          {!f.ready && <div className="mt-4"><ChartPlaceholder title="Best times to book" need={f.needOutcomes} have={f.outcomes} unit="recorded outcomes" /></div>}
        </Card>
      )}
      <LeadDrawer leads={personIndex.rows} index={personIndex.i} onIndex={(i) => setPersonIndex((p) => ({ ...p, i }))} onClose={() => setPersonIndex((p) => ({ ...p, i: null }))} />
    </div>
  );
}

function HeatGrid({ cells, onOpen }: { cells: Heat[]; onOpen: (c: Heat) => void }): ReactNode {
  const grid = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  const used = cells.filter((c) => c.booked > 0).map((c) => c.hour);
  const lo = Math.max(0, Math.min(...used, 9)), hi = Math.min(23, Math.max(...used, 17));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className="overflow-x-auto">
      <table className="text-xs" aria-label="Show rate by day and hour" data-testid="heat-grid">
        <thead><tr><th className="w-10" />{hours.map((h) => <th key={h} className="px-1 py-1 font-normal text-muted-foreground">{hourLabel(h)}</th>)}</tr></thead>
        <tbody>
          {DAYS.map((day, wd) => (
            <tr key={day}>
              <td className="pr-2 text-muted-foreground">{day}</td>
              {hours.map((h) => {
                const c = grid.get(`${wd}:${h}`);
                return (
                  <td key={h} className="h-8 w-10 border border-background p-0 text-center tabular-nums" style={cellStyle(c)}>
                    {c && c.showRate !== null ? <button type="button" className="size-full min-h-8 min-w-10 hover:underline" aria-label={`${day} at ${hourLabel(h)}: ${pct(c.showRate)} show rate, ${c.booked} appointments, open the list`} title={`${c.booked} booked, ${c.held} showed, ${c.noShow} no-shows. Click to see them`} onClick={() => onOpen(c)}>{Math.round(c.showRate * 100)}</button> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
