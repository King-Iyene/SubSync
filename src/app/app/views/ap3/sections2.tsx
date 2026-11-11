"use client";

import { Copy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { money, pct, riskOf } from "@/lib/design/appt-coach";
import { EmptyState, InlineAlert } from "../../ds";
import { CountUp, Q } from "../speed6-base";
import { ApSlot, hasApSlot, useAp } from "./data";
import { ApRowsList, Chip, Pager, when } from "./parts";
import type { SectionProps } from "./sections";
import type { ApConflictRow, ApHealthRow, ApPage, ApPersonRow, ApProof, ApReminderRow, ApSourceRow, ApSpeedBand } from "./types";

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
export function NeedsOutcome({ filters, onOpen, activeId, showAccount }: SectionProps) {
  const [n, setN] = useState<number | null>(null);
  return (
    <div data-testid="ap-needs">
      {n !== null && <Lead n={n} label={n === 1 ? "past appointment has no outcome" : "past appointments have no outcome"} tone="amber" />}
      <p className="ap-fine mb-3">Oldest first. Marking them makes your show rate true. SubSync never marks one by itself: it can suggest, you confirm.</p>
      <ApRowsList part="needs-outcome" filters={filters} onOpen={onOpen} activeId={activeId} showAccount={showAccount} selectable onRows={(_, t) => setN(t)} testId="ap-needs-list" empty="Every past appointment has an outcome. Your show rate is as true as it can be." />
      {!hasApSlot("BulkActions") && <p className="ap-fine mt-2">Marking Showed, No-show, Cancelled, Invalid or Completed from here arrives with the checked edit tools. Until then, open the appointment in your CRM.</p>}
    </div>
  );
}
export function Recovery({ filters, onOpen, activeId, showAccount }: SectionProps) {
  const [n, setN] = useState<number | null>(null);
  return (
    <div data-testid="ap-recover">
      {n !== null && <Lead n={n} label={n === 1 ? "no-show has not been booked again" : "no-shows have not been booked again"} tone="red" />}
      <p className="ap-fine mb-3">Missed in the last 7 days with no new booking. Most valuable first. Call them today.</p>
      <ApRowsList part="no-show-recovery" filters={filters} onOpen={onOpen} activeId={activeId} showAccount={showAccount} selectable onRows={(_, t) => setN(t)} testId="ap-recover-list" empty="No no-show is waiting for a call. Everyone who missed an appointment this week is booked again." />
    </div>
  );
}

// ---------- Booking share (setter vs closer) ----------
export function BookingShare({ filters, onPerson }: SectionProps & { onPerson: (p: ApPersonRow) => void }) {
  const res = useAp<{ rows: ApPersonRow[] }>("booking-share", filters);
  const total = useMemo(() => (res.data ? res.data.rows.reduce((a, r) => a + r.bookings, 0) : 0), [res.data]);
  if (res.error) return <InlineAlert tone="warning" title="Could not load booking share">Try again in a moment. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.rows.length) return <EmptyState title="No bookings in these dates" body="Who booked and who took each appointment appears here once there are bookings." />;
  const un = res.data.rows.find((r) => r.unassigned);
  return (
    <div data-testid="ap-share">
      <p className="ap-fine mb-3">Who booked an appointment (the setter) and who took the meeting (the closer). Show rate counts appointments someone marked. Press a name for the coaching card.</p>
      {un && <InlineAlert tone="warning" className="mb-3" title={`${un.bookings} bookings have no owner`}>Nobody took these meetings, so nobody is held to them. Assign an owner in your CRM, or from the checked edit tools once enabled.</InlineAlert>}
      <Grid rows={res.data.rows} testId="ap-share-table" tone={(r) => (r.unassigned ? "amber" : undefined)} onRow={onPerson}
        cols={[
          { h: "Person", cell: (r) => <><span className="ap-name">{r.name}</span> <Chip tone={r.unassigned ? "amber" : "grey"}>{r.unassigned ? "No owner" : r.role === "setter" ? "Books" : r.role === "closer" ? "Takes" : "Both"}</Chip></> },
          { h: "Booked", num: true, cell: (r) => <>{r.bookings}<span className="ap-bar" aria-hidden><i style={{ width: `${total ? (r.bookings / total) * 100 : 0}%` }} /></span></> },
          { h: "Show", num: true, cell: (r) => <Rate v={r.showRate} /> }, { h: "No-show", num: true, cell: (r) => <Rate v={r.noShowRate} /> }, { h: "Close", num: true, cell: (r) => <Rate v={r.closeRate} /> },
          { h: "Burned", num: true, cell: (r) => r.burned }, { h: "Won", num: true, cell: (r) => money(r.revenueCents) },
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
export function Health({ filters, onAccount }: SectionProps & { onAccount: (r: ApHealthRow) => void }) {
  const res = useAp<{ rows: ApHealthRow[] }>("health", filters);
  if (res.error) return <InlineAlert tone="warning" title="Could not load account health">Try again. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.rows.length) return <EmptyState title="No accounts with bookings" body="Each client account is ranked here, worst first, once it has appointments." />;
  return (
    <div data-testid="ap-health">
      <p className="ap-fine mb-3">Worst account first. Accounts with fewer than 5 marked appointments show n/a instead of a guess. Press an account to open its appointments.</p>
      <Grid rows={res.data.rows} onRow={onAccount} testId="ap-health-table" tone={(r) => (r.noShowRate !== null && r.noShowRate >= 0.3 ? "red" : undefined)}
        cols={[{ h: "Account", cell: (r) => <span className="ap-name">{r.name}</span> }, { h: "Booked", num: true, cell: (r) => r.booked }, { h: "Show", num: true, cell: (r) => <Rate v={r.showRate} /> },
          { h: "No-show", num: true, cell: (r) => <Rate v={r.noShowRate} tone={r.noShowRate !== null && r.noShowRate >= 0.3 ? "bad" : undefined} /> }, { h: "Cancelled", num: true, cell: (r) => <Rate v={r.cancelRate} /> },
          { h: "Rescheduled", num: true, cell: (r) => <Rate v={r.rescheduleRate} /> }, { h: "No outcome", num: true, cell: (r) => (r.unmarked ? <Chip tone="violet">{r.unmarked}</Chip> : 0) }]} />
    </div>
  );
}

// ---------- Sources and speed ----------
export function Sources({ filters }: SectionProps) {
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
        <Grid rows={sources} cols={[{ h: "Source", cell: (r) => <span className="ap-name">{r.source}</span> }, { h: "Booked", num: true, cell: (r) => r.booked }, { h: "Show", num: true, cell: (r) => <><Rate v={r.showRate} />{r.showRate !== null && <span className="ap-bar" aria-hidden><i style={{ width: `${r.showRate * 100}%` }} /></span>}</> }, { h: "Reply", num: true, cell: (r) => (r.medianFirstReplyMinutes === null ? "n/a" : r.medianFirstReplyMinutes < 60 ? `${r.medianFirstReplyMinutes}m` : `${(r.medianFirstReplyMinutes / 60).toFixed(1)}h`) }, { h: "Won", num: true, cell: (r) => r.won }]} />
      </Q>
      <Q q="Does a faster reply mean more shows?" tip="Show rate for appointments grouped by how long the first reply took. Your own data only." testId="ap-speed-card">
        <div className="ap-jr mt-2">{speed.map((s, i) => <div className="ap-jr-row" key={s.label} style={{ gridTemplateColumns: "8.5rem minmax(0,1fr) 3.5rem" }}><span>{s.label}</span><div className="ap-jr-bar"><i style={{ width: `${(s.showRate ?? 0) * 100}%`, ["--i" as string]: i }} /></div><span className="ap-jr-pct"><Rate v={s.showRate} /></span></div>)}</div>
        {gap !== null && gap > 0 && <p className="ap-note mt-3" data-testid="ap-speed-insight">In your data, leads you answered fastest showed up {gap} points more often than the slowest. <i>Based on your own numbers.</i></p>}
      </Q>
    </div>
  );
}

// ---------- Calendars and conflicts ----------
const KIND: Record<ApConflictRow["kind"], { label: string; tone: "red" | "amber" | "violet" }> = { "double-booking": { label: "Double booking", tone: "red" }, "forced-overlap": { label: "Forced overlap", tone: "amber" }, disconnected: { label: "Calendar not syncing", tone: "violet" } };
export function Calendars({ filters }: SectionProps) {
  const res = useAp<{ rows: ApConflictRow[] }>("calendars", filters);
  if (res.error) return <InlineAlert tone="warning" title="Could not load calendars">Try again. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.rows.length) return <EmptyState title="No conflicts found" body="No double bookings, forced overlaps or calendars that stopped syncing in these dates." />;
  return (
    <div data-testid="ap-calendars">
      <Lead n={res.data.rows.length} label={res.data.rows.length === 1 ? "calendar problem to fix" : "calendar problems to fix"} tone="red" />
      <Grid rows={res.data.rows} testId="ap-conflict-table" cols={[{ h: "Problem", cell: (r) => <Chip tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Chip> }, { h: "Account", cell: (r) => r.accountName }, { h: "Calendar", cell: (r) => r.calendarName }, { h: "When", cell: (r) => (r.when ? when(r.when) : "Ongoing") }, { h: "Who", cell: (r) => r.people.join(", ") }, { h: "What happened", cell: (r) => <span className="ap-sub">{r.note}</span> }]} />
    </div>
  );
}

// ---------- Reminders and no-show risk ----------
const RS: Record<ApReminderRow["reminderState"], { label: string; tone: "green" | "cyan" | "red" | "amber" }> = { confirmed: { label: "Confirmed", tone: "green" }, sent: { label: "Reminder sent", tone: "cyan" }, failed: { label: "Reminder failed", tone: "red" }, none: { label: "No reminder", tone: "amber" } };
export function Reminders({ filters, onOpen }: SectionProps) {
  const res = useAp<ApPage<ApReminderRow>>("reminders", filters);
  const [page, setPage] = useState(1), [size, setSize] = useState(20);
  if (res.error) return <InlineAlert tone="warning" title="Could not load reminders">Try again. <button type="button" className="ap-link" onClick={res.reload}>Retry</button></InlineAlert>;
  if (!res.data) return <div className="ap-tablewrap p-6" role="status" aria-busy="true">Loading...</div>;
  if (!res.data.total) return <EmptyState title="Nothing coming up" body="Upcoming appointments and whether each was reminded or confirmed appear here." />;
  const rows = res.data.rows.map((r) => ({ r, risk: riskOf(r) })).sort((a, b) => ({ high: 0, watch: 1, low: 2 }[a.risk.level] - { high: 0, watch: 1, low: 2 }[b.risk.level]) || a.r.hoursToStart - b.r.hoursToStart);
  const high = rows.filter((x) => x.risk.level === "high").length;
  return (
    <div data-testid="ap-reminders">
      <Lead n={high} label={high === 1 ? "upcoming appointment is likely to miss" : "upcoming appointments are likely to miss"} tone="red" />
      <p className="ap-fine mb-3">Likely to miss is an estimate from reminders and confirmation only: no reminder, a failed reminder, or not confirmed close to the start. It does not predict who the person is.</p>
      <div className="ap-tablewrap"><div className="ap-scroll"><table className="ap-t"><thead><tr><th>Contact</th><th>Starts in</th><th>Reminder</th><th>Risk</th><th>Why</th></tr></thead><tbody>
        {rows.slice((page - 1) * size, page * size).map(({ r, risk }) => (
          <tr key={r.id} tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(r); }} data-tone={risk.level === "high" ? "red" : risk.level === "watch" ? "amber" : undefined} data-testid="ap-row">
            <td><span className="ap-name">{r.contactName}</span> <span className="ap-sub">{r.accountName}</span></td><td>{r.hoursToStart < 48 ? `${Math.round(r.hoursToStart)}h` : `${Math.round(r.hoursToStart / 24)}d`}</td>
            <td><Chip tone={RS[r.reminderState].tone}>{RS[r.reminderState].label}</Chip></td><td><Chip tone={risk.level === "high" ? "red" : risk.level === "watch" ? "amber" : "green"}>{risk.level === "high" ? "Likely to miss" : risk.level === "watch" ? "Watch" : "Low"}</Chip></td><td className="ap-sub">{risk.why}</td>
          </tr>))}
      </tbody></table></div><Pager total={rows.length} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} /></div>
    </div>
  );
}

// ---------- Proof ----------
export function Proof({ filters }: SectionProps) {
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
            {([["Booked", p.booked, "cyan"], ["Showed", p.showed, "green"], ["Won back", p.recovered, "green"], ["Still unmarked", p.stillUnmarked, p.stillUnmarked ? "violet" : "green"]] as const).map(([l, n, t]) => <div className="ap-kpi" data-tone={t} key={l} style={{ cursor: "default", minHeight: 64 }}><span className="ap-kpi-n"><CountUp value={n} /></span><span className="ap-kpi-l">{l}</span></div>)}
          </div>
          <p className="ap-fine">{p.trueShowRate === null ? "True show rate: not enough marked appointments." : `True show rate ${pct(p.trueShowRate)}.`} Caught {p.caught}, fixed {p.fixed}.</p>
        </Q>
      ))}
      <p className="ap-fine" style={{ gridColumn: "1 / -1" }}>A shareable verified page for clients arrives later; for now, copy the receipt into your own report.</p>
    </div>
  );
}

// ---------- Meetings (slice AB mounts this) ----------
export function Meetings({ filters }: SectionProps) {
  if (!hasApSlot("Meetings")) return <EmptyState title="Meetings are not connected yet" body="Connect a meeting recorder to see, for each appointment, whether the meeting happened, a summary, and follow-ups nobody did. Each person connects their own." />;
  return <ApSlot name="Meetings" filters={filters} />;
}

