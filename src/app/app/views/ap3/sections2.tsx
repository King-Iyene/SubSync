"use client";

import { Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { money, pct } from "@/lib/design/appt-coach";
import { arrivalNote } from "@/lib/design/deep-link";
import { EmptyState, InlineAlert } from "../../ds";
import { CountUp, Q } from "../speed6-base";
import { ApSlot, hasApSlot, useAp } from "./data";
import { LinkBtn } from "./link-btn";
import { ApWorklist } from "./list";
import { CalChip, Chip, Pager, when } from "./parts";
import { Hit, type SectionProps } from "./sections";
import { RateTag, StatusLegend, toneVar } from "./status-ui";
import { SCALES, toneOf, type Scale } from "@/lib/design/status-tone";
import type { ApCalendarRow, ApCalendarsView, ApPersonCalRow, ApConflictRow, ApHealthRow, ApPersonRow, ApProof, ApShareView, ApSourceRow, ApSpeedBand } from "./types";

type Col<T> = { h: string; num?: boolean; cell: (r: T) => ReactNode };
function Grid<T extends { [k: string]: unknown }>({ rows, cols, onRow, testId, tone }: { rows: T[]; cols: Array<Col<T>>; onRow?: (r: T) => void; testId?: string; tone?: (r: T) => "amber" | "red" | undefined }) {
  return (
    <div className="ap-tablewrap" data-testid={testId}><div className="ap-scroll"><table className="ap-t">
      <thead><tr>{cols.map((c) => <th key={c.h} data-num={c.num ? "" : undefined}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} tabIndex={onRow ? 0 : undefined} data-tone={tone?.(r)} onClick={() => onRow?.(r)} onKeyDown={(e) => { if (e.key === "Enter") onRow?.(r); }} data-testid="ap-grid-row">{cols.map((c) => <td key={c.h} data-num={c.num ? "" : undefined}>{c.cell(r)}</td>)}</tr>)}</tbody>
    </table></div></div>
  );
}
const Lead = ({ n, label, tone }: { n: number; label: string; tone?: string }) => <p className="mb-3 text-[1.05rem] font-semibold" data-testid="ap-lead"><span className="ap-strong" data-tone={tone}><CountUp value={n} /></span> {label}</p>;
// A rate in its status colour (green, ochre, red) with a glyph and a word; with no scale (for example the close rate) it is plain text. n/a stays grey.
const Rate = ({ v, scale }: { v: number | null; scale?: Scale }) => (v === null ? <span className="ap-sub" title="Not enough marked appointments yet">n/a</span> : scale ? <RateTag v={v} scale={scale} /> : <span>{pct(v)}</span>);

// ---------- Needs outcome / No-show recovery ----------
const ORDER_WORDS: Record<string, string> = { value: "Biggest deal first.", oldest: "Oldest first.", newest: "Newest first.", name: "By name, A to Z." };
/** One line after a click from Today: which dates it opened with, and, when the rows do not match what Today counted, why and a button to widen the dates. */
function Arrival({ arrival, n, widen, canWiden }: { arrival: SectionProps["arrival"]; n: number | null; widen: () => void; canWiden: boolean }) {
  if (!arrival) return null;
  const note = arrivalNote(arrival, n);
  return (
    <p className="ap-fine mb-2" role="status" data-testid="ap-arrival" data-tone={note?.tone ?? "ok"}>
      Opened from Today: {arrival.what}{arrival.expect !== null ? ` (${arrival.expect.toLocaleString("en-US")})` : ""}. Showing the last {arrival.days} days, the same dates Today counted.{note ? ` ${note.text}` : ""}
      {note && note.tone === "empty" && canWiden && <> <button type="button" className="underline" onClick={widen} data-testid="ap-arrival-widen">Widen dates</button></>}
    </p>
  );
}

export function NeedsOutcome({ filters, onOpen, activeId, showAccount, clear, widen, filtered, arrival }: SectionProps) {
  const [n, setN] = useState<number | null>(null);
  return (
    <div data-testid="ap-needs">
      <Arrival arrival={arrival} n={n} widen={widen} canWiden />
      {n !== null && <Lead n={n} label={n === 1 ? "past appointment has no outcome" : "past appointments have no outcome"} tone="amber" />}
      <p className="ap-fine mb-3">{ORDER_WORDS[filters.sort || "value"]} Marking them makes your show rate true. SubSync never marks one by itself: it can suggest, you confirm.</p>
      <ApWorklist part="needs-outcome" filters={filters} onOpen={onOpen} activeId={activeId} showAccount={showAccount} selectable onRows={(_, t) => setN(t)} testId="ap-needs-list" onClear={filtered ? clear : undefined}
        empty={filtered ? "No past appointment without an outcome matches these filters." : "No appointment in these dates is missing an outcome."} emptyBody={filtered ? undefined : "Older appointments may still need marking: look back further to check. New ones appear here a few hours after an appointment ends."}
        emptyAction={filtered ? undefined : <button type="button" className="s6-btn" onClick={widen} data-testid="ap-needs-widen">Look back 90 days</button>} />
      {!hasApSlot("BulkActions") && <p className="ap-fine mt-2">Marking Showed, No-show, Cancelled, Invalid or Completed from here arrives with the checked edit tools. Until then, open the appointment in your CRM.</p>}
    </div>
  );
}
export function Recovery({ filters, onOpen, activeId, showAccount, clear, widen, filtered, arrival }: SectionProps) {
  const [n, setN] = useState<number | null>(null);
  return (
    <div data-testid="ap-recover">
      <Arrival arrival={arrival} n={n} widen={widen} canWiden={false} />
      {n !== null && <Lead n={n} label={n === 1 ? "no-show has not been booked again" : "no-shows have not been booked again"} tone="red" />}
      <p className="ap-fine mb-3">{ORDER_WORDS[filters.sort || "value"]} Missed in the last 7 days with no new booking: the dates above do not change this list. Call them today.</p>
      <ApWorklist part="no-show-recovery" filters={filters} onOpen={onOpen} activeId={activeId} showAccount={showAccount} selectable onRows={(_, t) => setN(t)} testId="ap-recover-list" onClear={filtered ? clear : undefined}
        empty={filtered ? "No no-show matches these filters." : "No no-show is waiting for a call."} emptyBody={filtered ? undefined : "Everyone who missed an appointment this week is booked again."} />
    </div>
  );
}

// ---------- Booking share (setter vs closer) ----------
const SHARE_SORTS: Array<[string, string]> = [["booked", "Most booked"], ["owned", "Most meetings taken"], ["show", "Best show rate"], ["revenue", "Most won"], ["name", "Name, A to Z"]];
const calChip = (name: string | null, group?: string | null) => <CalChip name={name} group={group} />;
export function BookingShare({ filters, onPerson, onDrill }: SectionProps & { onPerson: (p: ApPersonRow) => void }) {
  const [page, setPage] = useState(1), [size, setSize] = useState(20), [sort, setSort] = useState("booked"), [role, setRole] = useState(""), [has, setHas] = useState(""), [more, setMore] = useState(false);
  const key = JSON.stringify(filters) + sort + role + has;
  const [prev, setPrev] = useState(key), [now] = useState(() => Date.now());
  if (prev !== key) { setPrev(key); setPage(1); }
  const res = useAp<ApShareView>("booking-share", filters, { page, pageSize: size, sort, team_role: role || undefined, has: has || undefined });
  if (res.error) return <InlineAlert tone="warning" title="Could not load booking share">Try again in a moment. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  const d = res.data, rows = d.rows;
  const un = rows.find((r) => r.unassigned);
  const period = filters.from && filters.to ? "these dates" : `the last ${filters.days} days`;
  const wantFrom = filters.from || new Date(now - filters.days * 86_400_000).toISOString().slice(0, 10);
  const total = rows.reduce((a2, r) => a2 + (r.role === "closer" ? (r.owned ?? 0) : r.bookings), 0);
  const calOf = (r: ApPersonRow, cid: string | null, field: "booker" | "owner", n: number, nm: string | null) => onDrill({ title: `${r.name}, ${nm ?? "calendar"}`, count: n, extra: { [field]: r.id, ...(cid ? { calendar: cid } : {}), outcome: "booked", expect: n }, labels: { [field]: r.name } });
  return (
    <div data-testid="ap-share">
      <p className="ap-headline" data-testid="ap-share-headline">{d.rosterTotal > 0 ? `${d.rosterTotal} team member${d.rosterTotal === 1 ? "" : "s"}: ${d.counts?.withBookings ?? 0} booked or took a meeting in ${period}, ${d.counts?.none ?? 0} had none. Press a count to see those appointments.` : "Who booked an appointment (the setter) and who took the meeting (the closer). Press a count to see those appointments."}</p>
      {d.historyStarts && wantFrom < d.historyStarts && <p className="ap-fine mb-2" data-testid="ap-share-history">History starts {new Date(d.historyStarts + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Appointments before that day are not in SubSync yet, so older dates show less.</p>}
      <div className="ap-sharebar" role="group" aria-label="Narrow this list">
        <select className="ap-field" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="ap-share-sort">{SHARE_SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {d.roles.length > 1 && <select className="ap-field" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} data-testid="ap-share-role"><option value="">Any role</option>{d.roles.map((r) => <option key={r.key} value={r.key}>{r.label} ({r.n})</option>)}</select>}
        <select className="ap-field" aria-label="Bookings" value={has} onChange={(e) => setHas(e.target.value)} data-testid="ap-share-has"><option value="">With or without bookings</option><option value="yes">Has bookings in {period}</option><option value="no">No bookings in {period}</option></select>
      </div>
      {un && (un.bookings > 0 || (un.noOwner ?? 0) > 0) && <InlineAlert tone="warning" className="mb-3" title="Some bookings are missing a person">
        {un.bookings > 0 && <span className="block">{un.bookings.toLocaleString("en-US")} {un.bookings === 1 ? "booking was" : "bookings were"} made by the lead through a booking page (or no booker was recorded), so no team member is credited. <LinkBtn onClick={() => onDrill({ title: "Bookings with no booker recorded", count: un.bookings, extra: { booker: "none", outcome: "booked", expect: un.bookings }, labels: { booker: "not recorded" } })} testId="ap-share-nobooker">Open them</LinkBtn></span>}
        {(un.noOwner ?? 0) > 0 && <span className="block">{un.noOwner!.toLocaleString("en-US")} {un.noOwner === 1 ? "booking has" : "bookings have"} no owner, so nobody is held to the meeting. Give them an owner in your CRM. <LinkBtn onClick={() => onDrill({ title: "Bookings with no owner", count: un.noOwner!, extra: { owner: "none", outcome: "booked", expect: un.noOwner }, labels: { owner: "nobody" } })} testId="ap-share-noowner">Open them</LinkBtn></span>}
      </InlineAlert>}
      {rows.length > 0 && <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><StatusLegend scale={SCALES.show} note="No-show colours use 15% or less as good and over 30% as bad." /><button type="button" className="ap-link text-xs" aria-expanded={more} onClick={() => setMore(!more)} data-testid="ap-share-more">{more ? "Fewer columns" : "More columns (close rate, calendars, trend)"}</button></div>}
      {!rows.length ? <EmptyState title="Nobody matches" body="Nobody in the chosen accounts, calendars and roles matches. Clear a filter to see more people." /> : (
      <Grid rows={rows} testId="ap-share-table" tone={(r) => (r.unassigned ? "amber" : undefined)} onRow={onPerson}
        cols={([
          { h: "Person", cell: (r) => <>
              <span className="ap-name">{r.name}</span> {r.unassigned ? <Chip tone="amber">Not recorded</Chip> : <span className="ap-sub">{r.roleLabel ?? (r.role === "setter" ? "Books" : r.role === "closer" ? "Takes" : "Both")}</span>}
              {r.inTeam === false && <> <Chip tone="grey">Not in the team list</Chip></>}{r.teamActive === false && <> <Chip tone="grey">Inactive</Chip></>}
              {r.unassigned ? <span className="ap-sub block">Booked by the lead through a booking page, or no booker was recorded.</span> : (r.calendars?.length ?? 0) > 0 && <span className="ap-calrow">{r.calendars!.slice(0, 3).map((c) => <span key={c.calendarId}>{calChip(c.name, c.groupName)}</span>)}{r.calendars!.length > 3 && <span className="ap-sub">+{r.calendars!.length - 3} more</span>}</span>}
            </> },
          { h: "Booked", num: true, cell: (r) => (r.role === "closer" ? (r.owned ?? 0) : r.bookings) > 0 ? <><Hit n={r.role === "closer" ? (r.owned ?? 0) : r.bookings} label={`Open the ${r.role === "closer" ? r.owned : r.bookings} appointments of ${r.name}` } onClick={() => onDrill({ title: `${r.name}, appointments`, count: r.role === "closer" ? (r.owned ?? 0) : r.bookings, extra: { [r.role === "closer" ? "owner" : "booker"]: r.id, outcome: "booked", expect: r.role === "closer" ? (r.owned ?? 0) : r.bookings }, labels: { [r.role === "closer" ? "owner" : "booker"]: r.name } })} /><span className="ap-bar" aria-hidden><i style={{ width: `${total ? ((r.role === "closer" ? (r.owned ?? 0) : r.bookings) / total) * 100 : 0}%` }} /></span></>
              : r.state === "never" ? <span className="ap-sub" title="No bookings in anything SubSync holds for this person.">No bookings yet</span> : <span className="ap-sub" title="Has bookings on other dates.">0 in {period}</span> },
          { h: "Show", num: true, cell: (r) => <Rate v={r.showRate} scale={SCALES.show} /> }, { h: "No-show", num: true, cell: (r) => <Rate v={r.noShowRate} scale={SCALES.noShow} /> }, { h: "Close", num: true, cell: (r) => <Rate v={r.closeRate} /> },
          { h: "Won", num: true, cell: (r) => money(r.revenueCents) },
          { h: "By calendar", cell: (r) => ((r.byCalendar?.length ?? 0) === 0 ? <span className="ap-sub">{r.state === "booked" || r.unassigned ? "-" : "none"}</span> : (
              <details className="ap-bycal" onClick={(e) => e.stopPropagation()}><summary>{r.byCalendar!.length} calendar{r.byCalendar!.length === 1 ? "" : "s"}</summary>
                <div>{r.byCalendar!.map((c) => <div key={c.calendarId ?? "none"} className="ap-bycal-row">{calChip(c.name, c.groupName)}
                  {c.booked > 0 && <Hit n={c.booked} label={`Open ${c.booked} booked by ${r.name} on ${c.name ?? "this calendar"}` } onClick={() => calOf(r, c.calendarId, "booker", c.booked, c.name)} />}{c.booked > 0 && <span className="ap-sub"> booked</span>}
                  {c.owned > 0 && <> <Hit n={c.owned} label={`Open ${c.owned} meetings taken by ${r.name} on ${c.name ?? "this calendar"}` } onClick={() => calOf(r, c.calendarId, "owner", c.owned, c.name)} /><span className="ap-sub"> taken</span></>}</div>)}</div>
              </details>)) },
          { h: "Show trend", cell: (r) => <Spark values={r.trend} /> },
        ] as Array<Col<ApPersonRow>>).filter((c) => more || !["Close", "By calendar", "Show trend"].includes(c.h))} />)}
      <Pager total={d.total} page={page} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
    </div>
  );
}
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="ap-sub">-</span>;
  const w = 72, h = 20, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  return <svg width={w} height={h} role="img" aria-label={`Show rate trend, ${Math.round(values[0] * 100)}% to ${Math.round(values[values.length - 1] * 100)}%`}><polyline points={pts} fill="none" stroke="var(--s6-cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// ---------- Cross-account health ----------
export function Health({ filters, onAccount, onDrill }: SectionProps & { onAccount: (r: ApHealthRow) => void }) {
  const res = useAp<{ rows: ApHealthRow[] }>("health", filters);
  if (res.error) return <InlineAlert tone="warning" title="Could not load account health">Try again. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.rows.length) return <EmptyState title="No accounts with bookings" body="Each client account is ranked here, worst first, once it has appointments." />;
  return (
    <div data-testid="ap-health">
      <p className="ap-fine mb-2">Worst account first. Accounts with fewer than 5 marked appointments show n/a instead of a guess. Press an account to open its appointments.</p>
      <div className="mb-3"><StatusLegend scale={SCALES.show} note="No-show: 15% or less is good, over 30% is bad. Cancelled: 10% or less is good, over 20% is bad." /></div>
      <Grid rows={res.data.rows} onRow={onAccount} testId="ap-health-table" tone={(r) => (r.noShowRate !== null && r.noShowRate >= 0.3 ? "red" : undefined)}
        cols={[{ h: "Account", cell: (r) => <span className="ap-name">{r.name}</span> }, { h: "Booked", num: true, cell: (r) => (r.booked ? <Hit n={r.booked} label={`Open the ${r.booked} appointments of ${r.name}`} onClick={() => onDrill({ title: `${r.name}, all appointments`, count: r.booked, extra: { location: r.locationId, outcome: "booked", expect: r.booked } })} /> : 0) }, { h: "Show", num: true, cell: (r) => <Rate v={r.showRate} /> },
          { h: "No-show", num: true, cell: (r) => <Rate v={r.noShowRate} scale={SCALES.noShow} /> }, { h: "Cancelled", num: true, cell: (r) => <Rate v={r.cancelRate} scale={SCALES.cancel} /> },
          { h: "No outcome", num: true, cell: (r) => (r.unmarked ? <Hit n={r.unmarked} tone="violet" label={`Open the ${r.unmarked} appointments of ${r.name} with no outcome`} onClick={() => onDrill({ title: `${r.name}, no outcome`, count: r.unmarked, extra: { location: r.locationId, outcome: "unmarked", expect: r.unmarked } })} /> : 0) }]} />
    </div>
  );
}

// ---------- Sources and speed ----------
export function Sources({ filters, onDrill }: SectionProps) {
  const res = useAp<{ sources: ApSourceRow[]; speed: ApSpeedBand[] }>("sources", filters);
  if (res.error) return <InlineAlert tone="warning" title="Could not load sources">Try again. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  const { sources, speed } = res.data;
  if (!sources.length && !speed.length) return <EmptyState title="No sources yet" body="Show rate by where the lead came from, and by how fast you replied, appears once appointments have a source." />;
  const fast = speed.find((s) => s.showRate !== null), slow = [...speed].reverse().find((s) => s.showRate !== null);
  const gap = fast && slow && fast !== slow && fast.showRate !== null && slow.showRate !== null ? Math.round((fast.showRate - slow.showRate) * 100) : null;
  return (
    <div data-testid="ap-sources-wrap"><div className="mb-3"><StatusLegend scale={SCALES.show} /></div>
    <div className="ap-grid ap-grid2" data-testid="ap-sources">
      <Q q="Which sources actually show up?" tip="Show rate = showed divided by showed plus no-show, for appointments someone marked. n/a under 5 marked." testId="ap-src-card">
        <Grid rows={sources} cols={[{ h: "Source", cell: (r) => <span className="ap-name">{r.source}</span> }, { h: "Booked", num: true, cell: (r) => (r.booked ? <Hit n={r.booked} label={`Open the ${r.booked} appointments from ${r.source}`} onClick={() => onDrill({ title: `From ${r.source}`, count: r.booked, extra: { source: r.source, outcome: "booked", expect: r.booked } })} /> : 0) }, { h: "Show", num: true, cell: (r) => <><Rate v={r.showRate} scale={SCALES.show} />{r.showRate !== null && <span className="ap-bar" aria-hidden><i style={{ width: `${r.showRate * 100}%`, background: toneVar(toneOf(r.showRate, SCALES.show)) }} /></span>}</> }, { h: "Won", num: true, cell: (r) => (r.won ? <Hit n={r.won} label={`Open the ${r.won} won appointments from ${r.source}`} onClick={() => onDrill({ title: `Won, from ${r.source}`, count: r.won, extra: { source: r.source, outcome: "won", expect: r.won } })} /> : 0) }]} />
      </Q>
      <Q q="Does a faster reply mean more shows?" tip="Show rate for appointments grouped by how long the first reply took. Your own data only." testId="ap-speed-card">
        <div className="ap-jr mt-2">{speed.map((s, i) => <div className="ap-jr-row" key={s.label} style={{ gridTemplateColumns: "8.5rem minmax(0,1fr) 3.5rem" }}><span>{s.label}</span><div className="ap-jr-bar"><i style={{ width: `${(s.showRate ?? 0) * 100}%`, ["--i" as string]: i, background: toneVar(toneOf(s.showRate, SCALES.show)) }} /></div><span className="ap-jr-pct"><Rate v={s.showRate} scale={SCALES.show} /></span></div>)}</div>
        {gap !== null && gap > 0 && <p className="ap-note mt-3" data-testid="ap-speed-insight">In your data, leads you answered fastest showed up {gap} points more often than the slowest. <i>Based on your own numbers.</i></p>}
      </Q>
    </div>
    </div>
  );
}

// ---------- Calendars and conflicts ----------
const KIND: Record<ApConflictRow["kind"], { label: string; tone: "red" | "amber" | "violet" }> = { "double-booking": { label: "Double booking", tone: "red" } };
export function Calendars({ filters, onDrill, focus }: SectionProps) {
  const res = useAp<ApCalendarsView>("calendars", filters);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "conflicts" | "idle_calendar" | "idle_person" | "not_in_list">(focus === "conflicts" || focus === "idle_person" || focus === "idle_calendar" || focus === "not_in_list" ? focus : "all");
  if (res.error) return <InlineAlert tone="warning" title="Could not load calendars">Your calendar numbers did not load. Nothing was changed. <button type="button" className="ap-link" onClick={res.reload}>Try again</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading calendars...</div>;
  const rows = res.data.rows ?? [], problems = res.data.problems ?? [], calendars = res.data.calendars ?? [], people = res.data.people ?? [];
  if (!rows.length && !calendars.length && !people.length) return <EmptyState title="No calendars seen yet" body="Calendars and team members appear here once appointments have synced. Check that your CRM calendars are connected." />;
  const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const idleCal = (c: ApCalendarRow) => c.active !== false && (c.bookings === 0 || (c.daysSince !== null && c.daysSince >= 30));
  const calRows = show === "idle_calendar" ? calendars.filter(idleCal) : calendars;
  const pplRows = show === "idle_person" ? people.filter((p) => p.idleEverywhere) : show === "not_in_list" ? people.filter((p) => !p.inTeamList) : people;
  const flag = (days: number | null, n: number, active?: boolean) => (active === false ? <Chip tone="grey">Switched off</Chip> : days === null ? <Chip tone="amber">Never booked</Chip> : n === 0 ? <Chip tone="amber">No bookings in {days} days</Chip> : days >= 30 ? <Chip tone="amber">Quiet for {days} days</Chip> : null);
  const target = (k: string): typeof show | null => (k === "idle_calendar" ? "idle_calendar" : k === "idle_person" ? "idle_person" : k === "not_in_list" ? "not_in_list" : k === "double_booking" ? "conflicts" : null);
  const calDrill = (r: ApCalendarRow) => onDrill({ title: `${r.calendarName || "Calendar"}, appointments`, count: r.bookings, extra: { location: r.locationId, calendar: r.calendarId, outcome: "booked", expect: r.bookings } });
  const pplDrill = (r: ApPersonCalRow) => onDrill({ title: `${r.name}, appointments`, count: r.bookings, extra: { owner: r.userId, outcome: "booked", expect: r.bookings } });
  return (
    <div data-testid="ap-calendars">
      <div className="ap-kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }} data-testid="ap-problems">
        {problems.map((p) => (
          <button key={p.key} type="button" className="ap-kpi" data-tone={!p.available ? undefined : p.count === 0 ? "green" : p.tone} title={`Why it matters: ${p.why}`} aria-label={`${p.label}: ${p.available ? p.count : "not available"}. ${p.why}`}
            onClick={() => { const t = target(p.key); if (t) setShow(t); }} data-testid={`ap-problem-${p.key}`}>
            <span className="ap-kpi-n">{p.available ? p.count : "n/a"}</span><span className="ap-kpi-l">{p.label}{!p.available ? " (not available from the platform yet)" : ""}</span>
          </button>))}
      </div>
      <p className="ap-headline" data-testid="ap-cal-headline">{calendars.length} calendar{calendars.length === 1 ? "" : "s"}{calendars.filter(idleCal).length > 0 ? `, ${calendars.filter(idleCal).length} with no bookings in the last 30 days: check they are still used or switch them off.` : ", all taking bookings."}</p>
      {(res.data.calendarsSkipped ?? 0) > 0 && <InlineAlert tone="warning" className="mb-3" title="Not fully read">{res.data.calendarsSkipped} calendar{res.data.calendarsSkipped === 1 ? " was" : "s were"} not read because the account has so many. The list above is complete up to that point.</InlineAlert>}
      {res.data.historyStarts && <p className="ap-fine mb-2" data-testid="ap-history-starts">History starts {day(res.data.historyStarts)}. Appointments before that date are not in SubSync.</p>}
      {show !== "all" && <p className="ap-fine mb-2">Showing one problem. <button type="button" className="ap-link" onClick={() => setShow("all")}>Show everything</button></p>}
      {(show === "all" || show === "conflicts") && (rows.length > 0 ? <>
        <Lead n={res.data.conflictTotal ?? rows.length} label={(res.data.conflictTotal ?? rows.length) === 1 ? "double booking to fix" : "double bookings to fix"} tone="red" />
        {(res.data.conflictTotal ?? rows.length) > rows.length && <p className="ap-fine mb-2">Showing the first {rows.length}. Fix these and the rest appear.</p>}
        <Grid rows={rows} testId="ap-conflict-table" cols={[{ h: "Problem", cell: (r) => <Chip tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Chip> }, { h: "Account", cell: (r) => r.accountName }, { h: "Calendar", cell: (r) => r.calendarName }, { h: "When", cell: (r) => (r.when ? when(r.when) : "Ongoing") }, { h: "Who", cell: (r) => r.people.join(", ") || "-" }, { h: "Note", cell: (r) => <span className="ap-sub">{r.note}</span> }]} />
      </> : show === "conflicts" && <EmptyState title="No double bookings, overlaps or stalled calendars" body="Nothing to fix in these dates." />)}
      {(show === "all" || show === "idle_calendar") && (
        <Q q="All calendars" tip="Every calendar in the account, busiest first, including ones with zero bookings in these dates. Press a calendar to open its appointments." testId="ap-cal-all">
          {calRows.length ? <Grid rows={calRows} testId="ap-cal-table" tone={(r) => (idleCal(r) ? "amber" : undefined)} onRow={calDrill}
            cols={[{ h: "Calendar", cell: (r) => <span className="ap-name">{r.calendarName}</span> }, { h: "Group", cell: (r) => <span className="ap-sub">{r.groupName ?? "-"}</span> }, { h: "Account", cell: (r) => r.accountName }, { h: "Bookings", num: true, cell: (r) => (r.bookings ? <Hit n={r.bookings} label={`Open the ${r.bookings} bookings on ${r.calendarName}`} onClick={() => calDrill(r)} /> : 0) },
              { h: "Last booking", cell: (r) => (r.lastBookingAt ? when(r.lastBookingAt) : "-") }, { h: "Flag", cell: (r) => flag(r.daysSince, r.bookings, r.active) }]} /> : <p className="ap-fine">No calendars seen yet.</p>}
        </Q>
      )}
      {(show === "all" || show === "idle_person" || show === "not_in_list") && (
        <Q q="Who takes the meetings" tip="Everyone in the accounts&apos; team lists, plus anyone seen taking a meeting. A person is only called idle in accounts they belong to. Press a count to open those appointments; press a name to see each account." testId="ap-people-all">
          {pplRows.length ? <Grid rows={pplRows} testId="ap-people-table" tone={(r) => (r.idleEverywhere || !r.inTeamList ? "amber" : undefined)} onRow={(r) => setOpenPerson(openPerson === r.userId ? null : r.userId)}
            cols={[{ h: "Person", cell: (r) => <><span className="ap-name">{r.name}</span>{r.roleLabel && <> <span className="ap-sub">{r.roleLabel}</span></>}{!r.inTeamList && <> <Chip tone="amber">Not in the team list (left or no access)</Chip></>}{(r.calendars?.length ?? 0) > 0 && <span className="ap-calrow">{r.calendars!.slice(0, 3).map((c) => <span key={c}><CalChip name={c} /></span>)}{r.calendars!.length > 3 && <span className="ap-sub">+{r.calendars!.length - 3} more</span>}</span>}{openPerson === r.userId && <span className="ap-sub block">{r.accounts.map((a) => `${a.accountName ?? "Account"}: ${a.bookings}${a.member ? "" : " (not a member)"}`).join(" · ")}</span>}</> },
              { h: "Bookings", num: true, cell: (r) => (r.bookings ? <Hit n={r.bookings} label={`Open the ${r.bookings} appointments of ${r.name}`} onClick={() => pplDrill(r)} /> : 0) },
              { h: "Share", num: true, cell: (r) => <>{r.sharePct}%<span className="ap-bar" aria-hidden><i style={{ width: `${r.sharePct}%` }} /></span></> }, { h: "Last booking", cell: (r) => (r.lastBookingAt ? when(r.lastBookingAt) : "-") },
              { h: "Flag", cell: (r) => (!r.inTeamList ? null : r.idleEverywhere ? <Chip tone="amber">No bookings in {r.accounts.length > 1 ? "any of their accounts" : "these dates"}</Chip> : r.idleIn.length ? <Chip tone="amber">Idle in {r.idleIn.join(", ")}</Chip> : null) }]} /> : <p className="ap-fine">Nobody to list for this problem. Team members appear here from each account&apos;s team list.</p>}
        </Q>
      )}
    </div>
  );
}

// ---------- Proof ----------
export function Proof({ filters, onDrill }: SectionProps) {
  const res = useAp<{ rows: ApProof[] }>("proof", filters);
  const [copied, setCopied] = useState<string | null>(null);
  if (res.error) return <InlineAlert tone="warning" title="Could not load the weekly proof">Try again. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.rows.length) return <EmptyState title="No weekly receipt yet" body="Once a week of appointments has passed, each client gets a receipt: booked, showed, won back, still unmarked." />;
  const text = (p: ApProof) => `${p.accountName}, week of ${p.weekOf}: ${p.booked} booked, ${p.showed} showed${p.trueShowRate !== null ? ` (true show rate ${pct(p.trueShowRate)})` : ""}, ${p.recovered} no-shows won back, ${p.stillUnmarked} still need an outcome. SubSync caught ${p.caught} problems and ${p.fixed} were fixed.`;
  const copy = async (p: ApProof) => { try { await navigator.clipboard.writeText(text(p)); setCopied(p.accountName); setTimeout(() => setCopied(null), 2200); } catch { window.prompt("Copy this receipt", text(p)); } };
  return (
    <div className="ap-grid ap-grid2" data-testid="ap-proof">
      {res.data.rows.map((p) => (
        <Q key={p.accountName} q={p.accountName} sub={`Week of ${p.weekOf}`} testId="ap-receipt" action={<button type="button" className="s6-btn" onClick={() => void copy(p)}><Copy aria-hidden className="size-4" />{copied === p.accountName ? "Copied" : "Copy for the client"}</button>}>
          <div className="ap-kpis" style={{ marginTop: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {([["Booked", p.booked, "cyan"], ["Showed", p.showed, "green"], ["Won back", p.recovered, "green"], ["Still unmarked", p.stillUnmarked, p.stillUnmarked ? "violet" : "green"]] as const).map(([l, n, t]) => <button type="button" className="ap-kpi" data-tone={t} key={l} style={{ minHeight: 64 }} disabled={n === 0} title={n === 0 ? "Nothing to open" : `Open the ${n} appointments`} data-testid={`ap-proof-${l.toLowerCase().replace(/ /g, "-")}`}
              onClick={() => onDrill({ title: `${p.accountName}, week of ${p.weekOf}: ${l.toLowerCase()}`, count: n, extra: { from: p.weekOf, to: p.weekEnd, location: p.locationId ?? undefined, outcome: ({ Booked: "booked", Showed: "showed", "Won back": "recovered", "Still unmarked": "unmarked" } as Record<string, string>)[l], expect: n } })}><span className="ap-kpi-n"><CountUp value={n} /></span><span className="ap-kpi-l">{l}</span></button>)}
          </div>
          <p className="ap-fine">{p.trueShowRate === null ? "True show rate: not enough marked appointments." : `True show rate ${pct(p.trueShowRate)}.`} Caught {p.caught}, fixed {p.fixed}.</p>
        </Q>
      ))}
      <p className="ap-fine" style={{ gridColumn: "1 / -1" }}>A shareable verified page for clients arrives later; for now, copy the receipt into your own report.</p>
    </div>
  );
}

// ---------- Meetings (slice AB mounts this) ----------
export function Meetings({ filters, openView }: SectionProps) {
  if (!hasApSlot("Meetings")) return <EmptyState title="Meetings are not connected yet" body="Connect a meeting recorder to see, for each appointment, whether the meeting happened, a summary, and follow-ups nobody did. Each person connects their own." action={<LinkBtn onClick={() => openView("connections")} testId="ap-meetings-connect">Connect a meeting tool</LinkBtn>} />;
  return <ApSlot name="Meetings" filters={filters} />;
}

