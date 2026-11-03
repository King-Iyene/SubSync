"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bucketOf, targetState, type Bucket, type StatusCounts } from "@/lib/analytics/appointment-f3";
import { filterQueryOf, joinQuery, pathWith, windowQuery } from "@/lib/design/appt-ui";
import { changeBetween, shareChange } from "@/lib/design/range";
import type { GoFn } from "../nav";
import { useData } from "../session";
import { CardRange, DataList, Distribution, EmptyState, HowTo, InlineAlert, Page, SkeletonCards, useCardRange, type Column } from "../ds";
import { Badge, Btn, Card, ErrorBox, fmtInt } from "../ui";
import { ApptFilterBar, ApptListPanel, CountTile, Explainer, pct, TargetEditor, useApptFilter, type ApptRow, type FilterOptionsData } from "./appointment-parts";

type Rates = { held: number; noShow: number; cancelled: number; booked: number; unmarked: number; outcomes: number; showRate: number | null; noShowRate: number | null; cancelRate: number | null };
type Data = {
  access: { ok: number; needsPermission: Array<{ locationId: string; name: string | null }>; notYet: number; total: number; namesNeedPermission: number };
  window: { from: string; to: string; defaulted: boolean; problem: string | null };
  compareWindow: { from: string; to: string } | null;
  historyFrom: string | null;
  options: FilterOptionsData;
  target: { showRate: number; isDefault: boolean };
  headline: string[];
  current: Rates; compare: Rates | null;
  statusCounts: StatusCounts;
  statusOrder: Array<{ key: Bucket; label: string; hint: string }>;
  upcoming7: number;
  items: ApptRow[]; itemsTotal: number;
  upcoming: ApptRow[]; upcomingTotal: number;
  unmarked: ApptRow[]; unmarkedTotal: number;
  recover: ApptRow[]; recoverTotal: number;
  unconfirmedTotal: number;
  itemCap: number;
  canSeeAccounts: boolean; canEditTargets: boolean;
};
type Breakdown = {
  window: { from: string; to: string; defaulted: boolean; problem: string | null };
  byCalendar: Array<{ key: string; label: string; booked: number; held: number; noShow: number; outcomes: number; showRate: number | null }>;
  byPerson: Array<{ key: string; label: string; booked: number; held: number; noShow: number; outcomes: number; showRate: number | null }>;
  perAccount: Array<{ locationId: string; name: string | null; booked: number; held: number; noShow: number; outcomes: number; showRate: number | null; upcoming7: number; unmarked: number; access: string }>;
  items: ApptRow[]; itemsTotal: number; itemCap: number;
  canSeeAccounts: boolean;
};

// The numbers of the page start as the last 30 days compared with the 30 before, as they always did; the card's own range changes them (KF-4).
const INITIAL = { preset: "30d", compare: "previous" } as const;
const INITIAL_BREAKDOWN = { preset: "30d", compare: "none" } as const;
const BAR_TONE: Record<Bucket, "series" | "good" | "warn" | "bad"> = { new: "series", confirmed: "series", showed: "good", noshow: "bad", cancelled: "warn", invalid: "series", other: "warn" };

type Sel = { key: string; open: boolean } | null;

export function AppointmentsView({ go }: { go: GoFn }) {
  const range = useCardRange("appointments", INITIAL);
  const [filter, setFilter] = useApptFilter();
  const query = joinQuery(windowQuery(range.resolved), filterQueryOf(filter));
  const { data, error, loading, reload } = useData<Data>(range.resolved ? pathWith("appointments", query) : null);
  const [sel, setSel] = useState<Sel>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sel?.open) panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sel]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Page title="Appointments"><SkeletonCards cards={5} label="Loading appointments..." /></Page>;
  const d = data;
  const waiting = d.access.needsPermission.length;
  const filtered = Boolean(filter.calendar || filter.user || filter.source);
  const hasAny = d.itemsTotal + d.upcomingTotal + d.unmarkedTotal + (d.compare?.booked ?? 0) > 0;
  const sc = d.statusCounts;
  const showAccount = d.access.total > 1 && d.canSeeAccounts;

  // Every list that can open. The number on the tile or bar and the rows come from the same rows on the server.
  const byBucket = (b: Bucket) => d.items.filter((i) => bucketOf(i.status) === b);
  const lists: Record<string, { title: string; count: number; rows: ApptRow[]; empty: string }> = {
    booked: { title: "Booked in these dates", count: sc.scheduled, rows: d.items.filter((i) => bucketOf(i.status) !== "invalid"), empty: "Nothing was booked in these dates." },
    outcomes: { title: "Appointments with a recorded outcome", count: d.current.outcomes, rows: d.items.filter((i) => i.status === "showed" || i.status === "noshow"), empty: "No outcome has been recorded in these dates." },
    noshows: { title: "No-shows in these dates", count: sc.byBucket.noshow, rows: byBucket("noshow"), empty: "Nobody missed an appointment in these dates." },
    upcoming: { title: "Coming up in the next 7 days", count: d.upcomingTotal, rows: d.upcoming, empty: "Nothing is booked for the next 7 days." },
    remind: { title: "Remind today", count: d.unconfirmedTotal, rows: d.upcoming.filter((r) => r.unconfirmed), empty: "Everything in the next two days is confirmed." },
    rebook: { title: "No-shows to rebook", count: d.recoverTotal, rows: d.recover, empty: "No recent no-shows are waiting to be rebooked." },
    record: { title: "Record the outcome", count: d.unmarkedTotal, rows: d.unmarked, empty: "Every past appointment has an outcome." },
    ...Object.fromEntries(d.statusOrder.map((s) => [`bar:${s.key}`, { title: `${s.label} appointments`, count: sc.byBucket[s.key], rows: byBucket(s.key), empty: `No ${s.label.toLowerCase()} appointments in these dates.` }])),
  };
  const choose = (key: string) => setSel((cur) => (cur?.key === key && cur.open ? { key, open: false } : { key, open: true }));
  const open = sel ? lists[sel.key] : undefined;

  const rows = d.statusOrder.filter((s) => s.key !== "other" || sc.byBucket.other > 0).map((s) => ({ label: s.label, value: sc.byBucket[s.key], count: sc.byBucket[s.key], detail: s.hint, tone: BAR_TONE[s.key] }));
  const selectedBar = sel?.key.startsWith("bar:") ? d.statusOrder.filter((s) => s.key !== "other" || sc.byBucket.other > 0).findIndex((s) => `bar:${s.key}` === sel.key) : -1;

  const cmp = d.compare;
  const bookedChange = cmp ? changeBetween(d.current.booked, cmp.booked, "booked") : null;
  const rateChange = cmp ? shareChange({ n: d.current.held, total: d.current.outcomes }, { n: cmp.held, total: cmp.outcomes }) : null;
  const target = targetState(d.current.showRate, d.target.showRate);
  const next = d.unmarkedTotal > 0 ? { text: `Record what happened to ${d.unmarkedTotal} past appointment${d.unmarkedTotal === 1 ? "" : "s"}, so the show rate is true.`, key: "record" }
    : d.recoverTotal > 0 ? { text: `Call ${d.recoverTotal} person${d.recoverTotal === 1 ? "" : "s"} who missed an appointment in the last 14 days and has not rebooked.`, key: "rebook" }
    : d.unconfirmedTotal > 0 ? { text: `Remind ${d.unconfirmedTotal} person${d.unconfirmedTotal === 1 ? "" : "s"} booked in the next two days who has not confirmed.`, key: "remind" } : null;

  return (
    <Page title="Appointments" subtitle="Who is booked, who showed up, and who to chase today. A past appointment with no outcome is flagged, not guessed." actions={<Btn onClick={() => go("calls")}>Open call lists</Btn>}>
      {waiting > 0 && (
        <InlineAlert tone="warning" className="mb-6" title={waiting === d.access.total ? "SubSync needs your approval to read appointments." : `${waiting} account${waiting === 1 ? " still needs" : "s still need"} approval to show appointments.`}>
          <p>To show appointments, the app needs one more read-only permission. Open the app in the marketplace and choose Reinstall (or ask the account owner), then approve. Nothing else changes.</p>
          {d.canSeeAccounts && <p className="mt-1 text-xs">Waiting: {d.access.needsPermission.slice(0, 6).map((a) => a.name ?? "Unnamed").join(", ")}{waiting > 6 ? ` and ${waiting - 6} more` : ""}.</p>}
        </InlineAlert>
      )}
      {d.access.namesNeedPermission > 0 && waiting === 0 && (
        <InlineAlert tone="info" className="mb-4">Staff names need a permission: reconnect to show who each appointment is assigned to. Until then a person without a name is shown as &quot;Team member (name not available)&quot;.</InlineAlert>
      )}

      {!hasAny && !filtered ? (
        <EmptyState title="No appointments yet" body={waiting > 0 ? "They will appear after the app is approved again and the next sync finishes." : "Once calendars have bookings, show rate, no-shows and who to chase appear here. Appointments are read from the last 90 days and the next 60."} action={<Btn onClick={() => go("help")}>Open Getting started</Btn>} />
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : ""} aria-busy={loading}>
          <HowTo id="appointments" title="How to use this page" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
            Press any number to see the appointments behind it, and any row to see its details. Work the three lists under Do these first: record outcomes, rebook no-shows, remind people booked soon.
          </HowTo>
          <ApptFilterBar options={d.options} value={filter} onChange={(f) => { setSel(null); setFilter(f); }} />

          {d.headline.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm" data-testid="appointments-headline">{d.headline.map((h) => <li key={h} className="font-medium">{h}</li>)}</ul>
          )}
          {next && <p className="mb-4 text-xs text-muted-foreground" data-testid="what-to-do">What to do: {next.text} <button type="button" className="font-medium text-primary underline" onClick={() => choose(next.key)}>Show the list</button></p>}

          <Card title="The numbers" className="mb-6">
              <CardRange state={range} label="Appointment numbers" />
              <p className="mt-2 text-xs text-muted-foreground" data-testid="appointments-window">
                Appointments that start {d.window.from === d.window.to ? `on ${d.window.from}` : `from ${d.window.from} to ${d.window.to}`}{d.compareWindow ? `, compared with ${d.compareWindow.from} to ${d.compareWindow.to}` : ""} (UTC days).
                {d.historyFrom ? ` Your history goes back to ${d.historyFrom}.` : ""}
              </p>
              {d.window.problem && <p className="mt-1 border-l-2 border-warning pl-2 text-xs" role="status">{d.window.problem}</p>}
              {d.current.booked === 0 && d.itemsTotal === 0 && (
                <InlineAlert tone="info" className="mt-3" title="No appointments start in these dates.">
                  Pick a longer range, or clear the filters. <button type="button" className="font-medium text-primary underline" onClick={() => range.setSpec({ preset: "90d", compare: range.spec.compare })}>Show the last 90 days</button>
                </InlineAlert>
              )}
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
                <CountTile label="Booked" value={fmtInt(sc.scheduled)} hint={`Booked in these dates: ${sc.scheduled}. Press to see the list`} onOpen={() => choose("booked")} open={sel?.key === "booked"}
                  sub={bookedChange ? bookedChange.text : "No comparison chosen"} />
                <CountTile label="Show rate" value={pct(d.current.showRate)} tone={d.current.showRate !== null && target.state === "below" ? "warn" : undefined} hint={`Recorded outcomes: ${d.current.outcomes}. Press to see the list`} onOpen={() => choose("outcomes")} open={sel?.key === "outcomes"}
                  sub={<>{d.current.showRate === null ? `Needs 5 recorded outcomes, ${d.current.outcomes} so far.` : `${d.current.held} showed, ${d.current.noShow} no-show. ${target.text}`}{rateChange && d.current.showRate !== null ? <><br />{rateChange.text}</> : null}</>} />
                <CountTile label="No-shows" value={fmtInt(sc.byBucket.noshow)} tone={sc.byBucket.noshow > 0 ? "warn" : undefined} hint={`No-shows in these dates: ${sc.byBucket.noshow}. Press to see the list`} onOpen={() => choose("noshows")} open={sel?.key === "noshows"}
                  sub={d.current.noShowRate !== null ? `${pct(d.current.noShowRate)} of recorded outcomes` : "Rate shown once 5 outcomes are recorded"} />
                <CountTile label="Coming up, next 7 days" value={fmtInt(d.upcomingTotal)} hint={`Coming up: ${d.upcomingTotal}. Press to see the list`} onOpen={() => choose("upcoming")} open={sel?.key === "upcoming"}
                  sub="Always the next 7 days, whatever dates are chosen" />
              </div>
              <div className="mt-4"><TargetEditor key={d.target.showRate} value={d.target.showRate} isDefault={d.target.isDefault} canEdit={d.canEditTargets} onSaved={reload} /></div>
              <Explainer id="numbers" />
          </Card>

          <h2 className="mb-3 border-t pt-5 text-base font-semibold">Do these first</h2>
          <div className="mb-6 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
            <CountTile label="Record the outcome" value={fmtInt(d.unmarkedTotal)} tone={d.unmarkedTotal > 0 ? "warn" : undefined} hint={`Record the outcome: ${d.unmarkedTotal}. Press to see the list`} onOpen={() => choose("record")} open={sel?.key === "record"}
              sub="Past appointments still marked booked or confirmed. Mark them showed or no-show in your CRM." />
            <CountTile label="No-shows to rebook" value={fmtInt(d.recoverTotal)} tone={d.recoverTotal > 0 ? "warn" : undefined} hint={`No-shows to rebook: ${d.recoverTotal}. Press to see the list`} onOpen={() => choose("rebook")} open={sel?.key === "rebook"}
              sub="Missed in the last 14 days and not booked again." />
            <CountTile label="Remind today" value={fmtInt(d.unconfirmedTotal)} hint={`Remind today: ${d.unconfirmedTotal}. Press to see the list`} onOpen={() => choose("remind")} open={sel?.key === "remind"}
              sub="Booked, not confirmed, starting within two days. A reminder cuts no-shows." />
          </div>

          <div ref={panel}>
            {sel && open && sel.open && <ApptListPanel key={sel.key} title={open.title} count={open.count} rows={open.rows} showAccount={showAccount} empty={open.empty} onBack={() => setSel((c) => (c ? { ...c, open: false } : c))} />}
            {sel && open && !sel.open && <p className="mt-3 text-xs text-muted-foreground" data-testid="appt-list-closed">{open.title}: {open.count}. <button type="button" onClick={() => setSel({ key: sel.key, open: true })} className="font-medium text-primary underline">Show the list</button></p>}
          </div>

          <Card title="Appointments by status" className="mt-6">
              <p className="mb-3 text-xs text-muted-foreground">Appointments that start in the dates chosen above. Press a bar to see them.</p>
              <Distribution title="Appointments by status" rows={rows} noun="appointments" sample={Math.max(1, sc.total)} min={0} need="appointments" onSelect={(i) => choose(`bar:${d.statusOrder.filter((s) => s.key !== "other" || sc.byBucket.other > 0)[i].key}`)} selected={selectedBar >= 0 ? selectedBar : null} />
              {sc.byBucket.invalid > 0 && <p className="mt-2 text-xs text-muted-foreground">{sc.byBucket.invalid} invalid (spam, test or mistaken) are shown here and counted nowhere else.</p>}
              <Explainer id="status" />
          </Card>

          <BreakdownSection go={go} filterQuery={filterQueryOf(filter)} />
        </div>
      )}
    </Page>
  );
}

// ---------- calendars, people and client accounts, over their own dates ----------

type GroupRow = Breakdown["byCalendar"][number];
const groupColumns = (): Array<Column<GroupRow>> => [
  { key: "label", header: "Name", primary: true, width: "minmax(0,2fr)", cell: (r) => r.label },
  { key: "booked", header: "Booked", width: "4.5rem", align: "right", cell: (r) => <span className="tabular-nums">{r.booked}</span> },
  { key: "held", header: "Showed", width: "4.5rem", align: "right", cell: (r) => <span className="tabular-nums">{r.held}</span> },
  { key: "missed", header: "No-show", width: "4.5rem", align: "right", cell: (r) => <span className="tabular-nums">{r.noShow}</span> },
  { key: "rate", header: "Show rate", width: "5rem", align: "right", cell: (r) => <span className="tabular-nums">{pct(r.showRate)}</span> },
];
const accountColumns = (go: GoFn): Array<Column<Breakdown["perAccount"][number]>> => [
  { key: "name", header: "Client account", primary: true, width: "minmax(0,2fr)", cell: (a) => a.name ?? "Unnamed account" },
  { key: "booked", header: "Booked", width: "5rem", align: "right", cell: (a) => <span className="tabular-nums">{a.booked}</span> },
  { key: "held", header: "Showed", width: "5rem", align: "right", cell: (a) => <span className="tabular-nums">{a.held}</span> },
  { key: "noshow", header: "No-show", width: "5rem", align: "right", cell: (a) => <span className="tabular-nums">{a.noShow}</span> },
  { key: "rate", header: "Show rate", width: "5.5rem", align: "right", cell: (a) => <span className="tabular-nums">{pct(a.showRate)}</span> },
  { key: "next", header: "Next 7 days", width: "6rem", align: "right", cell: (a) => <span className="tabular-nums">{a.upcoming7}</span> },
  { key: "none", header: "No outcome", width: "6rem", align: "right", cell: (a) => <span className="tabular-nums">{a.unmarked}</span> },
  { key: "open", header: "", width: "7rem", align: "right", cell: (a) => (a.access === "needs_permission" ? <Badge tone="warn">Needs permission: reconnect</Badge> : <button type="button" className="min-h-9 text-xs underline" onClick={() => go("account", a.locationId)}>Open account</button>) },
];

function BreakdownSection({ go, filterQuery }: { go: GoFn; filterQuery: string }) {
  const range = useCardRange("appointments-breakdown", INITIAL_BREAKDOWN);
  const { data, error, loading, reload } = useData<Breakdown>(range.resolved ? pathWith("appointments/breakdown", joinQuery(windowQuery(range.resolved), filterQuery)) : null);
  const [pick, setPick] = useState<{ kind: "calendar" | "person" | "account"; key: string; title: string; count: number } | null>(null);
  const rowsFor = useMemo(() => {
    if (!data || !pick) return [];
    return data.items.filter((i) => (pick.kind === "calendar" ? (i.calendarId ?? "none") === pick.key : pick.kind === "person" ? (i.assignedKey ?? "unassigned") === pick.key : i.locationId === pick.key));
  }, [data, pick]);
  return (
    <Card title="By calendar, person and client account" className="mt-6">
        <CardRange state={range} label="Calendars, people and accounts" compares={["none"]} maxDays={90} />
        {range.resolved && <p className="mt-2 text-xs text-muted-foreground" data-testid="breakdown-window">Appointments that start {range.resolved.current.label}. Press a line to see its appointments.</p>}
        {error && <div className="mt-3"><ErrorBox error={error} onRetry={reload} /></div>}
        {!data && !error && <p className="mt-3 text-sm text-muted-foreground">Loading...</p>}
        {data && (
          <div className={loading ? "opacity-60" : ""}>
            {data.window.problem && <p className="mt-2 border-l-2 border-warning pl-2 text-xs" role="status">{data.window.problem}</p>}
            <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-semibold">By calendar</h3>
                <DataList rows={data.byCalendar} rowKey={(r) => r.key} columns={groupColumns()} caption="By calendar" empty="No appointments in these dates." onOpen={(r) => setPick({ kind: "calendar", key: r.key, title: `${r.label}`, count: r.booked })} />
                <Explainer id="calendar" />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">By person it is assigned to</h3>
                <DataList rows={data.byPerson} rowKey={(r) => r.key} columns={groupColumns()} caption="By person" empty="No appointments in these dates." onOpen={(r) => setPick({ kind: "person", key: r.key, title: r.label, count: r.booked })} />
                <Explainer id="person" />
              </div>
            </div>
            {data.canSeeAccounts && data.perAccount.length > 1 && (
              <div className="mt-6">
                <h3 className="mb-1 text-sm font-semibold">By client account</h3>
                <DataList rows={data.perAccount} rowKey={(a) => a.locationId} caption="Appointments by client account" columns={accountColumns(go)} onOpen={(a) => setPick({ kind: "account", key: a.locationId, title: a.name ?? "Unnamed account", count: a.booked })} />
                <Explainer id="account" />
              </div>
            )}
            {pick && <ApptListPanel key={pick.kind + pick.key} title={pick.title} count={pick.count} rows={rowsFor} showAccount={data.canSeeAccounts && data.perAccount.length > 1} empty="Nothing behind this line." onBack={() => setPick(null)} />}
          </div>
        )}
    </Card>
  );
}
