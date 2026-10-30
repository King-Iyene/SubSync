"use client";

import { useData } from "../session";
import { Badge, Card, Empty, ErrorBox, ExtLink, fmtInt, fmtMoney, Loading, Stat, Table, Td, Th } from "../ui";

type Heat = { weekday: number; hour: number; booked: number; held: number; noShow: number; showRate: number | null };
type Data = {
  health: { score: number; band: string; parts: Array<{ label: string; points: number; max: number; note: string }> };
  funnel: { steps: Array<{ step: string; count: number; kept: number | null }>; biggestLeak: string | null };
  heat: { cells: Heat[]; best: { label: string; showRate: number | null } | null; worst: { label: string; showRate: number | null } | null; ratio: number | null };
  recovery: { noShows: number; rebooked: number; showedAgain: number; rebookRate: number | null; showAgainRate: number | null; avgDaysToRebook: number | null };
  repeatNoShows: Array<{ contactId: string; locationId: string; name: string; locationName: string | null; phone: string | null; count: number; lastAt: number; url: string }>;
  velocity: { booked: number; medianDays: number | null; averageDays: number | null; bySource: Array<{ source: string; count: number; medianDays: number }> };
  bySource: Array<{ source: string; booked: number; held: number; noShow: number; showRate: number | null }>;
  confirmations: { next48: number; confirmed: number; unconfirmed: number; tomorrowAdvice: string | null };
  sameDay: { sameDay: { count: number; showRate: number | null }; later: { count: number; showRate: number | null } };
  fairness: { rows: Array<{ key: string; label: string; count: number; share: number; skew: number }>; skewed: boolean; note: string | null };
  doubleBookings: Array<{ kind: string; at: number; locationName: string | null; who: string }>;
  value: { showed: number; revenue: number; perAppointment: number | null; upcoming: number };
  forecast: { low: number; high: number; expected: number; basedOnWeeks: number } | null;
  followUp: { held: number; withoutFollowUp: number; gapRate: number | null; contacts: Array<{ contactId: string; name: string; locationName: string | null; at: number; url: string }> };
  briefs: Array<{ contactId: string; name: string; locationName: string | null; at: number; brief: string; url: string }>;
  sampleSize: number;
};

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// A colour from red (low show rate) to green (high); grey when there are too few outcomes to say.
function cellStyle(c: Heat | undefined): React.CSSProperties {
  if (!c || c.booked === 0) return { background: "transparent" };
  if (c.showRate === null) return { background: "rgba(120,120,120,0.15)" };
  const hue = Math.round(c.showRate * 120);
  return { background: `hsl(${hue} 65% 45% / 0.55)` };
}

export function AppointmentInsights() {
  const { data, error, loading, reload } = useData<Data>("appointment-insights");
  if (loading && !data) return <Loading label="Reading the appointment history..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.sampleSize === 0) return <Empty title="No appointment history yet" body="Once calendars have bookings, show rates by time and source, recovery, fairness and the rest appear here." />;
  const d = data;
  const grid = new Map(d.heat.cells.map((c) => [`${c.weekday}:${c.hour}`, c]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Calendar health" className="lg:col-span-1">
          <p className="text-4xl font-semibold tabular-nums">{d.health.score}<span className="text-base font-normal text-muted-foreground"> / 100</span></p>
          <p className="mb-3 mt-1"><Badge tone={d.health.band === "healthy" ? "good" : d.health.band === "watch" ? "warn" : "bad"}>{d.health.band}</Badge></p>
          <ul className="space-y-1 text-sm">{d.health.parts.map((p) => <li key={p.label} className="flex justify-between gap-2"><span>{p.label} <span className="text-xs text-muted-foreground">({p.note})</span></span><span className="tabular-nums">{p.points}/{p.max}</span></li>)}</ul>
        </Card>
        <Card title="From lead to customer (90 days)" className="lg:col-span-2">
          <ul className="space-y-2">
            {d.funnel.steps.map((s) => {
              const top = d.funnel.steps[0].count || 1;
              return (
                <li key={s.step} className="text-sm">
                  <div className="flex justify-between"><span>{s.step}</span><span className="tabular-nums">{fmtInt(s.count)}{s.kept !== null ? <span className="text-xs text-muted-foreground"> · {pct(s.kept)} of the step before</span> : null}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (s.count / top) * 100)}%` }} /></div>
                </li>
              );
            })}
          </ul>
          {d.funnel.biggestLeak && <p className="mt-3 text-sm font-medium">Biggest leak: {d.funnel.biggestLeak}</p>}
        </Card>
      </div>

      <Card title="Best times to book (show rate by day and hour, last 90 days)">
        {d.heat.best && d.heat.worst && d.heat.best.label !== d.heat.worst.label && (
          <p className="mb-3 text-sm font-medium">
            People show most on {d.heat.best.label} ({pct(d.heat.best.showRate)}) and least on {d.heat.worst.label} ({pct(d.heat.worst.showRate)}){d.heat.ratio && d.heat.ratio >= 1.5 ? `: about ${d.heat.ratio.toFixed(1)} times as likely` : ""}. Consider moving availability toward the better slots.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="text-xs" aria-label="Show rate by day and hour">
            <thead><tr><th className="w-10" />{HOURS.map((h) => <th key={h} className="px-1 py-1 font-normal text-muted-foreground">{hourLabel(h)}</th>)}</tr></thead>
            <tbody>
              {DAYS.map((day, w) => (
                <tr key={day}>
                  <td className="pr-2 text-muted-foreground">{day}</td>
                  {HOURS.map((h) => {
                    const c = grid.get(`${w}:${h}`);
                    return <td key={h} className="h-7 w-9 border border-background text-center tabular-nums" style={cellStyle(c)} title={c ? `${c.booked} booked, ${c.held} showed, ${c.noShow} no-shows${c.showRate !== null ? `, ${pct(c.showRate)} show` : ""}` : "none"}>{c ? c.booked : ""}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">The number is how many were booked; colour is the show rate (red low, green high, grey when there are fewer than 5 recorded outcomes). Times are in each account&apos;s own time zone.</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="No-show recovery (last 90 days)">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Rebooked" value={pct(d.recovery.rebookRate)} sub={`${d.recovery.rebooked} of ${d.recovery.noShows} no-shows`} />
            <Stat label="Showed the second time" value={pct(d.recovery.showAgainRate)} sub={`${d.recovery.showedAgain} of ${d.recovery.rebooked}`} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{d.recovery.avgDaysToRebook !== null ? `People who rebook take about ${d.recovery.avgDaysToRebook} days to do it.` : "Not enough rebookings yet to say how long it takes."}</p>
        </Card>
        <Card title={`Repeat no-shows (${d.repeatNoShows.length})`}>
          {d.repeatNoShows.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has missed two or more appointments.</p> : (
            <ul className="divide-y text-sm">{d.repeatNoShows.map((r) => <li key={r.contactId + r.locationId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {r.count} no-shows{r.locationName ? ` · ${r.locationName}` : ""}</span></span><span className="flex items-center gap-3 text-xs">{r.phone && <a className="underline" href={`tel:${r.phone}`}>Call {r.phone}</a>}<ExtLink href={r.url}>Open contact</ExtLink></span></li>)}</ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Show rate by lead source">
          {d.bySource.length === 0 ? <p className="text-sm text-muted-foreground">Needs at least 3 appointments from a source, with the source recorded on the contact.</p> : (
            <Table head={<tr><Th>Source</Th><Th className="text-right">Booked</Th><Th className="text-right">Showed</Th><Th className="text-right">Show rate</Th></tr>}>
              {d.bySource.map((s) => <tr key={s.source}><Td className="font-medium">{s.source}</Td><Td className="text-right tabular-nums">{s.booked}</Td><Td className="text-right tabular-nums">{s.held}</Td><Td className="text-right tabular-nums">{pct(s.showRate)}</Td></tr>)}
            </Table>
          )}
        </Card>
        <Card title="How fast leads get booked">
          <p className="text-sm">{d.velocity.medianDays !== null ? <>Half of booked leads were booked within <strong>{d.velocity.medianDays} days</strong> of arriving (average {d.velocity.averageDays}).</> : "Not enough booked leads yet."}</p>
          {d.velocity.bySource.length > 0 && <ul className="mt-2 space-y-1 text-sm">{d.velocity.bySource.map((s) => <li key={s.source} className="flex justify-between"><span>{s.source}</span><span className="tabular-nums text-muted-foreground">{s.medianDays} days · {s.count} leads</span></li>)}</ul>}
          <p className="mt-3 text-sm text-muted-foreground">Booked the same day: {d.sameDay.sameDay.count} ({pct(d.sameDay.sameDay.showRate)} show) · booked earlier: {d.sameDay.later.count} ({pct(d.sameDay.later.showRate)} show).</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Reminders and confirmations">
          <p className="text-sm">{d.confirmations.tomorrowAdvice ?? (d.confirmations.next48 === 0 ? "Nothing is booked for the next two days." : `All ${d.confirmations.next48} appointments in the next two days are confirmed.`)}</p>
        </Card>
        <Card title="Who gets the appointments">
          {d.fairness.rows.length === 0 ? <p className="text-sm text-muted-foreground">No assigned appointments yet.</p> : (
            <ul className="space-y-1 text-sm">{d.fairness.rows.map((r) => <li key={r.key} className="flex justify-between"><span>{r.label}</span><span className="tabular-nums text-muted-foreground">{r.count} · {Math.round(r.share * 100)}%</span></li>)}</ul>
          )}
          {d.fairness.note && <p className="mt-2 text-sm font-medium text-amber-800">Uneven: {d.fairness.note}</p>}
        </Card>
        <Card title="What an appointment is worth">
          <p className="text-sm">{d.value.perAppointment !== null ? <>Each appointment that was held has been worth about <strong>{fmtMoney(d.value.perAppointment)}</strong> in won deals ({fmtInt(d.value.showed)} held, {fmtMoney(d.value.revenue)} won). {fmtInt(d.value.upcoming)} are coming up.</> : "Needs at least 10 held appointments in the last 6 months."}</p>
          {d.forecast && <p className="mt-3 text-sm text-muted-foreground">Next week, expect about {d.forecast.expected} appointments (likely {d.forecast.low} to {d.forecast.high}), from the last {d.forecast.basedOnWeeks} weeks.</p>}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`No follow-up after the appointment (${d.followUp.withoutFollowUp})`}>
          <p className="mb-2 text-sm text-muted-foreground">{d.followUp.gapRate !== null ? `${d.followUp.withoutFollowUp} of ${d.followUp.held} appointments held in the last two weeks have had no message from your team since (${pct(d.followUp.gapRate)}).` : "Needs at least 5 held appointments in the last two weeks."}</p>
          <ul className="divide-y text-sm">{d.followUp.contacts.map((c) => <li key={c.contactId + c.at} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span><span className="font-medium">{c.name}</span> <span className="text-muted-foreground">· {when(c.at)}{c.locationName ? ` · ${c.locationName}` : ""}</span></span><ExtLink href={c.url}>Open contact</ExtLink></li>)}</ul>
        </Card>
        <Card title={`Double bookings (${d.doubleBookings.length})`}>
          {d.doubleBookings.length === 0 ? <p className="text-sm text-muted-foreground">No one is booked twice at the same time in the next two weeks.</p> : (
            <ul className="divide-y text-sm">{d.doubleBookings.map((b, i) => <li key={i} className="py-1.5"><span className="font-medium">{b.who}</span> <span className="text-muted-foreground">· {b.kind === "person" ? "booked on top of another appointment" : "booked twice in one day"} · {when(b.at)}{b.locationName ? ` · ${b.locationName}` : ""}</span></li>)}</ul>
          )}
        </Card>
      </div>

      <Card title="Before your next appointments">
        {d.briefs.length === 0 ? <p className="text-sm text-muted-foreground">Nothing booked with a known contact in the next 7 days.</p> : (
          <ul className="divide-y">{d.briefs.map((b) => <li key={b.contactId + b.at} className="py-3 text-sm first:pt-0 last:pb-0"><p className="leading-6">{b.brief}</p><p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">{b.locationName && <span>{b.locationName}</span>}<ExtLink href={b.url}>Open contact</ExtLink></p></li>)}</ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Written from what SubSync already knows about the contact: source, deals, earlier appointments and last message. Nothing is guessed.</p>
      </Card>
    </div>
  );
}
