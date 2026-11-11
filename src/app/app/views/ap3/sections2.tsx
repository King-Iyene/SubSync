"use client";

import { Copy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { money, pct } from "@/lib/design/appt-coach";
import { EmptyState, InlineAlert } from "../../ds";
import { CountUp, Q } from "../speed6-base";
import { ApSlot, hasApSlot, useAp } from "./data";
import { LinkBtn } from "./link-btn";
import { ApWorklist } from "./list";
import { Chip, when } from "./parts";
import { Hit, type SectionProps } from "./sections";
import type { ApCalendarRow, ApCalendarsView, ApPersonCalRow, ApConflictRow, ApHealthRow, ApPersonRow, ApProof, ApSourceRow, ApSpeedBand } from "./types";

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
const Rate = ({ v, tone }: { v: number | null; tone?: "good" | "bad" }) => (v === null ? <span className="ap-sub" title="Not enough marked appointments yet">n/a</span> : <span style={{ color: tone === "bad" ? "var(--s6-red)" : tone === "good" ? "var(--s6-green)" : undefined }}>{pct(v)}</span>);

// ---------- Needs outcome / No-show recovery ----------
const ORDER_WORDS: Record<string, string> = { value: "Biggest deal first.", oldest: "Oldest first.", newest: "Newest first.", name: "By name, A to Z." };
export function NeedsOutcome({ filters, onOpen, activeId, showAccount, clear, filtered }: SectionProps) {
  const [n, setN] = useState<number | null>(null);
  return (
    <div data-testid="ap-needs">
      {n !== null && <Lead n={n} label={n === 1 ? "past appointment has no outcome" : "past appointments have no outcome"} tone="amber" />}
      <p className="ap-fine mb-3">{ORDER_WORDS[filters.sort || "value"]} Marking them makes your show rate true. SubSync never marks one by itself: it can suggest, you confirm.</p>
      <ApWorklist part="needs-outcome" filters={filters} onOpen={onOpen} activeId={activeId} showAccount={showAccount} selectable onRows={(_, t) => setN(t)} testId="ap-needs-list" onClear={filtered ? clear : undefined}
        empty={filtered ? "No past appointment without an outcome matches these filters." : "Every past appointment has an outcome. Your show rate is as true as it can be."} emptyBody={filtered ? undefined : "Nothing to mark right now. New ones appear here a few hours after an appointment ends."} />
      {!hasApSlot("BulkActions") && <p className="ap-fine mt-2">Marking Showed, No-show, Cancelled, Invalid or Completed from here arrives with the checked edit tools. Until then, open the appointment in your CRM.</p>}
    </div>
  );
}
export function Recovery({ filters, onOpen, activeId, showAccount, clear, filtered }: SectionProps) {
  const [n, setN] = useState<number | null>(null);
  return (
    <div data-testid="ap-recover">
      {n !== null && <Lead n={n} label={n === 1 ? "no-show has not been booked again" : "no-shows have not been booked again"} tone="red" />}
      <p className="ap-fine mb-3">{ORDER_WORDS[filters.sort || "value"]} Missed in the last 7 days with no new booking: the dates above do not change this list. Call them today.</p>
      <ApWorklist part="no-show-recovery" filters={filters} onOpen={onOpen} activeId={activeId} showAccount={showAccount} selectable onRows={(_, t) => setN(t)} testId="ap-recover-list" onClear={filtered ? clear : undefined}
        empty={filtered ? "No no-show matches these filters." : "No no-show is waiting for a call."} emptyBody={filtered ? undefined : "Everyone who missed an appointment this week is booked again."} />
    </div>
  );
}

// ---------- Booking share (setter vs closer) ----------
export function BookingShare({ filters, onPerson, onDrill }: SectionProps & { onPerson: (p: ApPersonRow) => void }) {
  const res = useAp<{ rows: ApPersonRow[] }>("booking-share", filters);
  const total = useMemo(() => (res.data ? res.data.rows.reduce((a, r) => a + r.bookings, 0) : 0), [res.data]);
  if (res.error) return <InlineAlert tone="warning" title="Could not load booking share">Try again in a moment. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.rows.length) return <EmptyState title="No bookings in these dates" body="Who booked and who took each appointment appears here once there are bookings." />;
  const un = res.data.rows.find((r) => r.unassigned);
  return (
    <div data-testid="ap-share">
      <p className="ap-fine mb-3">Who booked an appointment (the setter) and who took the meeting (the closer). Press a name for the coaching card, or a number to see those appointments.</p>
      {un && (un.bookings > 0 || (un.noOwner ?? 0) > 0) && <InlineAlert tone="warning" className="mb-3" title="Some bookings are missing a person">
        {un.bookings > 0 && <span className="block">{un.bookings.toLocaleString("en-US")} {un.bookings === 1 ? "booking has" : "bookings have"} no booker recorded, so nobody is credited for them. <LinkBtn onClick={() => onDrill({ title: "Bookings with no booker recorded", count: un.bookings, extra: { booker: "none", outcome: "booked", expect: un.bookings }, labels: { booker: "not recorded" } })} testId="ap-share-nobooker">Open them</LinkBtn></span>}
        {(un.noOwner ?? 0) > 0 && <span className="block">{un.noOwner!.toLocaleString("en-US")} {un.noOwner === 1 ? "booking has" : "bookings have"} no owner, so nobody is held to the meeting. Give them an owner in your CRM. <LinkBtn onClick={() => onDrill({ title: "Bookings with no owner", count: un.noOwner!, extra: { owner: "none", outcome: "booked", expect: un.noOwner }, labels: { owner: "nobody" } })} testId="ap-share-noowner">Open them</LinkBtn></span>}
      </InlineAlert>}
      <Grid rows={res.data.rows} testId="ap-share-table" tone={(r) => (r.unassigned ? "amber" : undefined)} onRow={onPerson}
        cols={[
          { h: "Person", cell: (r) => <><span className="ap-name">{r.name}</span> <Chip tone={r.unassigned ? "amber" : "grey"}>{r.unassigned ? "Not recorded" : r.role === "setter" ? "Books" : r.role === "closer" ? "Takes" : "Both"}</Chip></> },
          { h: "Booked", num: true, cell: (r) => <>{r.bookings ? <Hit n={r.bookings} label={`Open the ${r.bookings} appointments of ${r.name}`} onClick={() => onDrill({ title: `${r.name}, appointments`, count: r.bookings, extra: { [r.role === "closer" ? "owner" : "booker"]: r.id, outcome: "booked", expect: r.bookings } })} /> : 0}<span className="ap-bar" aria-hidden><i style={{ width: `${total ? (r.bookings / total) * 100 : 0}%` }} /></span></> },
          { h: "Show", num: true, cell: (r) => <Rate v={r.showRate} /> }, { h: "No-show", num: true, cell: (r) => <Rate v={r.noShowRate} /> }, { h: "Close", num: true, cell: (r) => <Rate v={r.closeRate} /> },
          { h: "Won", num: true, cell: (r) => money(r.revenueCents) },
          { h: "Lead to booked", num: true, cell: (r) => (r.avgLeadToBookedHours === null ? "n/a" : `${r.avgLeadToBookedHours.toFixed(1)}h`) },
          { h: "Show trend", cell: (r) => <Spark values={r.trend} /> },
        ]} />
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
      <p className="ap-fine mb-3">Worst account first. Accounts with fewer than 5 marked appointments show n/a instead of a guess. Press an account to open its appointments.</p>
      <Grid rows={res.data.rows} onRow={onAccount} testId="ap-health-table" tone={(r) => (r.noShowRate !== null && r.noShowRate >= 0.3 ? "red" : undefined)}
        cols={[{ h: "Account", cell: (r) => <span className="ap-name">{r.name}</span> }, { h: "Booked", num: true, cell: (r) => (r.booked ? <Hit n={r.booked} label={`Open the ${r.booked} appointments of ${r.name}`} onClick={() => onDrill({ title: `${r.name}, all appointments`, count: r.booked, extra: { location: r.locationId, outcome: "booked", expect: r.booked } })} /> : 0) }, { h: "Show", num: true, cell: (r) => <Rate v={r.showRate} /> },
          { h: "No-show", num: true, cell: (r) => <Rate v={r.noShowRate} tone={r.noShowRate !== null && r.noShowRate >= 0.3 ? "bad" : undefined} /> }, { h: "Cancelled", num: true, cell: (r) => <Rate v={r.cancelRate} /> },
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
    <div className="ap-grid ap-grid2" data-testid="ap-sources">
      <Q q="Which sources actually show up?" tip="Show rate = showed divided by showed plus no-show, for appointments someone marked. n/a under 5 marked." testId="ap-src-card">
        <Grid rows={sources} cols={[{ h: "Source", cell: (r) => <span className="ap-name">{r.source}</span> }, { h: "Booked", num: true, cell: (r) => (r.booked ? <Hit n={r.booked} label={`Open the ${r.booked} appointments from ${r.source}`} onClick={() => onDrill({ title: `From ${r.source}`, count: r.booked, extra: { source: r.source, outcome: "booked", expect: r.booked } })} /> : 0) }, { h: "Show", num: true, cell: (r) => <><Rate v={r.showRate} />{r.showRate !== null && <span className="ap-bar" aria-hidden><i style={{ width: `${r.showRate * 100}%` }} /></span>}</> }, { h: "Won", num: true, cell: (r) => (r.won ? <Hit n={r.won} label={`Open the ${r.won} won appointments from ${r.source}`} onClick={() => onDrill({ title: `Won, from ${r.source}`, count: r.won, extra: { source: r.source, outcome: "won", expect: r.won } })} /> : 0) }]} />
      </Q>
      <Q q="Does a faster reply mean more shows?" tip="Show rate for appointments grouped by how long the first reply took. Your own data only." testId="ap-speed-card">
        <div className="ap-jr mt-2">{speed.map((s, i) => <div className="ap-jr-row" key={s.label} style={{ gridTemplateColumns: "8.5rem minmax(0,1fr) 3.5rem" }}><span>{s.label}</span><div className="ap-jr-bar"><i style={{ width: `${(s.showRate ?? 0) * 100}%`, ["--i" as string]: i }} /></div><span className="ap-jr-pct"><Rate v={s.showRate} /></span></div>)}</div>
        {gap !== null && gap > 0 && <p className="ap-note mt-3" data-testid="ap-speed-insight">In your data, leads you answered fastest showed up {gap} points more often than the slowest. <i>Based on your own numbers.</i></p>}
      </Q>
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
  const idleCal = (c: ApCalendarRow) => c.bookings === 0 || (c.daysSince !== null && c.daysSince >= 30);
  const calRows = show === "idle_calendar" ? calendars.filter(idleCal) : calendars;
  const pplRows = show === "idle_person" ? people.filter((p) => p.idleEverywhere) : show === "not_in_list" ? people.filter((p) => !p.inTeamList) : people;
  const flag = (days: number | null, n: number) => (days === null ? <Chip tone="amber">Never booked</Chip> : n === 0 ? <Chip tone="amber">No bookings in {days} days</Chip> : days >= 30 ? <Chip tone="amber">Quiet for {days} days</Chip> : null);
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
      {show !== "all" && <p className="ap-fine mb-2">Showing one problem. <button type="button" className="ap-link" onClick={() => setShow("all")}>Show everything</button></p>}
      {(show === "all" || show === "conflicts") && (rows.length > 0 ? <>
        <Lead n={res.data.conflictTotal ?? rows.length} label={(res.data.conflictTotal ?? rows.length) === 1 ? "double booking to fix" : "double bookings to fix"} tone="red" />
        {(res.data.conflictTotal ?? rows.length) > rows.length && <p className="ap-fine mb-2">Showing the first {rows.length}. Fix these and the rest appear.</p>}
        <Grid rows={rows} testId="ap-conflict-table" cols={[{ h: "Problem", cell: (r) => <Chip tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Chip> }, { h: "Account", cell: (r) => r.accountName }, { h: "Calendar", cell: (r) => r.calendarName }, { h: "When", cell: (r) => (r.when ? when(r.when) : "Ongoing") }, { h: "Who", cell: (r) => r.people.join(", ") || "-" }, { h: "Note", cell: (r) => <span className="ap-sub">{r.note}</span> }]} />
      </> : show === "conflicts" && <EmptyState title="No double bookings, overlaps or stalled calendars" body="Nothing to fix in these dates." />)}
      {(show === "all" || show === "idle_calendar") && (
        <Q q="All calendars" tip="Every calendar we have seen bookings on, busiest first, including ones with zero bookings in these dates. Press a calendar to open its appointments." testId="ap-cal-all">
          {calRows.length ? <Grid rows={calRows} testId="ap-cal-table" tone={(r) => (idleCal(r) ? "amber" : undefined)} onRow={calDrill}
            cols={[{ h: "Calendar", cell: (r) => <span className="ap-name">{r.calendarName}</span> }, { h: "Account", cell: (r) => r.accountName }, { h: "Bookings", num: true, cell: (r) => (r.bookings ? <Hit n={r.bookings} label={`Open the ${r.bookings} bookings on ${r.calendarName}`} onClick={() => calDrill(r)} /> : 0) },
              { h: "Last booking", cell: (r) => (r.lastBookingAt ? when(r.lastBookingAt) : "-") }, { h: "Flag", cell: (r) => flag(r.daysSince, r.bookings) }]} /> : <p className="ap-fine">No calendars seen yet.</p>}
        </Q>
      )}
      {(show === "all" || show === "idle_person" || show === "not_in_list") && (
        <Q q="Who takes the meetings" tip="Everyone in the accounts&apos; team lists, plus anyone seen taking a meeting. A person is only called idle in accounts they belong to. Press a count to open those appointments; press a name to see each account." testId="ap-people-all">
          {pplRows.length ? <Grid rows={pplRows} testId="ap-people-table" tone={(r) => (r.idleEverywhere || !r.inTeamList ? "amber" : undefined)} onRow={(r) => setOpenPerson(openPerson === r.userId ? null : r.userId)}
            cols={[{ h: "Person", cell: (r) => <><span className="ap-name">{r.name}</span>{!r.inTeamList && <> <Chip tone="amber">Not in the team list (left or no access)</Chip></>}{openPerson === r.userId && <span className="ap-sub block">{r.accounts.map((a) => `${a.accountName ?? "Account"}: ${a.bookings}${a.member ? "" : " (not a member)"}`).join(" · ")}</span>}</> },
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

