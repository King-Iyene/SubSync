"use client";

import { useState } from "react";
import { changeBetween, inWindow } from "@/lib/design/range";
import { compareWeeks, totalsOf, weekBars, weeksIn, type TrendMember, type TrendWeekData } from "@/lib/design/trend-bars";
import { daysBetween, pointsIn, shiftDays } from "@/lib/analytics/client-success";
import { waitLabel } from "@/lib/design/ui-logic";
import { useData } from "../../session";
import { BarChart, CardRange, DrillPanel, LineChart, SkeletonCards, useCardRange, useDrill, type Column } from "../../ds";
import { Badge, Card, ErrorBox, ExtLink, type Tone } from "../../ui";
import type { ApptWeek, TrendsData } from "./types";

// The trends of one client, each with its own range and comparison (KF-4) and, where a list stands behind a bar, a click that opens it (KF-6):
//   health, open pipeline and new contacts over time  lines on two labelled axes; a day's health score is not a list of leads, so these open nothing
//   appointments by week                              bars; click a week to see the appointments
//   replies by week                                   bars; click a week to see the leads (the same rows as the Speed to lead page)
const moneyShort = (n: number) => (n >= 1_000_000 ? `$${Math.round(n / 100_000) / 10}m` : n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`);

type SpeedData = { targetMinutes: number; trend?: TrendWeekData[] };
const statusTone: Record<TrendMember["status"], Tone> = { within: "good", late: "warn", waiting: "bad" };
const statusText: Record<TrendMember["status"], string> = { within: "answered in time", late: "answered late", waiting: "still waiting" };
const replyColumns: Array<Column<TrendMember>> = [
  { key: "name", header: "Lead", primary: true, width: "minmax(0,2fr)", cell: (m) => m.name },
  { key: "status", header: "What happened", width: "12rem", cell: (m) => <Badge tone={statusTone[m.status]}>{statusText[m.status]}{m.status === "waiting" ? ` ${waitLabel(m.minutes)}` : m.status === "late" ? ` after ${waitLabel(m.minutes)}` : ""}</Badge> },
  { key: "open", header: "", width: "7rem", align: "right", cell: (m) => <ExtLink href={m.url}>Open contact</ExtLink> },
];
const apptTone = (s: string): Tone => (s === "showed" ? "good" : s === "noshow" ? "bad" : "neutral");
const apptWord = (s: string) => ({ showed: "attended", noshow: "no-show", confirmed: "confirmed", new: "not confirmed yet" }[s] ?? s);
const apptColumns: Array<Column<ApptWeek["members"][number]>> = [
  { key: "name", header: "Contact", primary: true, width: "minmax(0,2fr)", cell: (m) => m.name },
  { key: "when", header: "When", width: "9rem", cell: (m) => <span className="text-muted-foreground">{new Date(m.startAt).toLocaleDateString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span> },
  { key: "status", header: "Outcome", width: "10rem", cell: (m) => <Badge tone={apptTone(m.status)}>{apptWord(m.status)}</Badge> },
  { key: "open", header: "", width: "7rem", align: "right", cell: (m) => <ExtLink href={m.url}>Open contact</ExtLink> },
];

export function ClientTrends({ locationId, name }: { locationId: string; name: string }) {
  const { data, error, loading, reload } = useData<TrendsData>(`client-trends/${locationId}`);
  const speed = useData<SpeedData>(`speed?accounts=${locationId}`);
  const lines = useCardRange("client-lines", { preset: "90d", compare: "none" });
  const appts = useCardRange("client-appts", { preset: "90d", compare: "none" });
  const replies = useCardRange("client-replies", { preset: "90d", compare: "none" });
  const apptDrill = useDrill();
  const replyDrill = useDrill();
  if (loading && !data) return <SkeletonCards cards={2} label={`Loading ${name}'s trends...`} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  // ---- the lines
  const win = lines.resolved;
  const inCur = win ? pointsIn(data.days, win.current.from, win.current.to) : data.days;
  const prev = win?.compare ? shiftDays(pointsIn(data.days, win.compare.from, win.compare.to), daysBetween(win.compare.from, win.current.from)) : [];
  const line = (pick: (d: TrendsData["days"][number]) => number | null, label: string) => [
    { label: win ? "This period" : label, points: inCur.map((d) => ({ day: d.day, value: pick(d) })), tone: 1 as const },
    ...(prev.length ? [{ label: "Previous period", points: prev.map((d) => ({ day: d.day, value: pick(d) })), tone: "muted" as const, dashed: true }] : []),
  ];
  const firstDay = data.days.find((d) => d.healthScore !== null)?.day ?? null;

  // ---- appointment weeks
  const aw = appts.resolved;
  const weeks = aw ? data.weeks.filter((w) => inWindow(w.weekStart, 7, aw.current)) : data.weeks;
  const prevWeeks = aw?.compare ? data.weeks.filter((w) => inWindow(w.weekStart, 7, aw.compare!)) : [];
  const total = weeks.reduce((s, w) => s + w.count, 0);
  const prevTotal = prevWeeks.reduce((s, w) => s + w.count, 0);
  const pickedAppt = apptDrill.selected !== null ? weeks[apptDrill.selected] : undefined;
  const weekLabel = (ms: number) => new Date(ms).toLocaleDateString("en-US", { day: "numeric", month: "short" });

  // ---- reply weeks (the same trend and the same rows as the Speed to lead page, for this one client)
  const rw = replies.resolved;
  const allReply = speed.data?.trend ?? [];
  const replyWeeks = rw ? weeksIn(allReply, rw.current) : allReply;
  const replyCmp = rw ? compareWeeks(allReply, rw.current, rw.compare) : null;
  const pickedReply = replyDrill.selected !== null ? replyWeeks[replyDrill.selected] : undefined;

  return (
    <div className="space-y-4" data-testid="client-trends">
      <Card title={`${name}: health, pipeline and new contacts`}>
        <CardRange state={lines} label="Health, pipeline and contacts" compares={["none", "previous"]} maxDays={Math.max(1, data.days.length)} />
        {data.historyStartsOn && <p className="mt-2 text-xs text-muted-foreground">SubSync has kept a daily record of this client since {new Date(`${data.historyStartsOn}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}. Earlier days are not drawn: nothing is guessed.{firstDay && firstDay > data.historyStartsOn ? ` Health and open pipeline start on ${new Date(`${firstDay}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })}, when deals began to be counted the current way.` : ""}</p>}
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <LineChart title="Health score" series={line((d) => d.healthScore, "Health")} ceiling={100} axisLabel="0 to 100" />
          <LineChart title="Open pipeline" series={line((d) => d.openValue, "Open pipeline")} format={moneyShort} axisLabel="deals with a value and an owner" />
          <LineChart title="New contacts" series={line((d) => d.newContacts30d, "New contacts")} axisLabel="added in the 30 days before each day" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Hover or press the arrow keys to read a day. A day&apos;s score is not a list of leads, so these lines open nothing; the bars below open the people behind them.</p>
      </Card>

      <Card title="Appointments by week">
        <CardRange state={appts} label="Appointments by week" compares={["none", "previous"]} maxDays={98} />
        {aw?.compare && <p className="mt-2 text-sm" data-testid="appts-compare">{changeBetween(total, prevTotal, "appointments").text}.</p>}
        <p className="mb-3 mt-2 text-xs text-muted-foreground">Appointments that started in each week, cancelled ones left out. Click a bar to see them.</p>
        <BarChart title="Appointments by week" axisLabel="appointments" noun="appointments" sample={total} min={1} need="appointments"
          bars={weeks.map((w) => ({ label: weekLabel(w.weekStart), value: w.count, count: w.count, detail: `${w.showed} attended, ${w.noShow} no-show` }))} onSelect={(i) => apptDrill.select(i)} selected={apptDrill.selected} />
        {pickedAppt && (
          <DrillPanel drill={apptDrill} title={`Week of ${weekLabel(pickedAppt.weekStart)}`} count={pickedAppt.count} noun={pickedAppt.count === 1 ? "appointment" : "appointments"} rows={pickedAppt.members} columns={apptColumns} rowKey={(m) => `${m.contactId}-${m.startAt}`}
            toLead={(m) => ({ contactId: m.contactId, locationId, name: m.name, locationName: name, url: m.url, note: `Appointment ${apptWord(m.status)}.` })} />
        )}
      </Card>

      <Card title="Are replies getting faster?">
        {speed.error ? <ErrorBox error={speed.error} onRetry={speed.reload} /> : !speed.data ? <p className="text-sm text-muted-foreground">Loading reply speed...</p> : allReply.some((w) => w.leads > 0) ? (
          <>
            <CardRange state={replies} label="Replies by week" compares={["none", "previous"]} maxDays={56} />
            {replyCmp?.change && <p className="mt-2 text-sm" data-testid="replies-compare">{replyCmp.change.text}.</p>}
            {rw?.compare && replyCmp && !replyCmp.covered && <p className="mt-2 text-xs text-muted-foreground">There is not enough history to compare with {rw.compare.label}: only 8 weeks are kept so far.</p>}
            <p className="mb-3 mt-2 text-xs text-muted-foreground">The share of new leads answered by a person inside your {speed.data.targetMinutes}-minute target, by the week the lead came in. A week with fewer than 5 leads shows no bar. Click a bar to see its leads.</p>
            <BarChart title="Answered within target, by week" axisLabel="% of new leads" unit="%" format={(n) => `${Math.round(n)}`} sample={totalsOf(replyWeeks).total} min={5} need="leads" noun="leads" bars={weekBars(replyWeeks)} onSelect={(i) => replyDrill.select(i)} selected={replyDrill.selected} />
            {pickedReply && (
              <DrillPanel drill={replyDrill} title={`Week of ${weekBars([pickedReply])[0].label}`} count={pickedReply.leads} noun={pickedReply.leads === 1 ? "lead" : "leads"} rows={pickedReply.members} columns={replyColumns} rowKey={(m) => m.locationId + m.contactId}
                toLead={(m) => ({ contactId: m.contactId, locationId: m.locationId, name: m.name, locationName: m.locationName, url: m.url, note: `${statusText[m.status][0].toUpperCase()}${statusText[m.status].slice(1)}.` })} />
            )}
          </>
        ) : <p className="text-sm text-muted-foreground">No new leads to time for this client yet. Replies appear here once a new contact has a conversation.</p>}
      </Card>
    </div>
  );
}

/** A button that shows the trends of a client in place; used by the Health table and the client page. */
export function TrendsToggle({ locationId, name }: { locationId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-9 text-sm font-medium text-primary underline-offset-4 hover:underline">{open ? "Hide trends" : "Show trends"}</button>
      {open && <div className="mt-3"><ClientTrends locationId={locationId} name={name} /></div>}
    </div>
  );
}
