"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { coachingNote, money, pct } from "@/lib/design/appt-coach";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { ApSlot, hasApSlot, useAp, type ApFilters, type ApRows } from "./data";
import type { ApPart, ApRow, ApStats } from "./types";

// Shared pieces of the Appointments module: the 40px server-paged table, status chips, the right-side panel and the coaching card.

export const TONE_OF_STATUS: Record<string, "cyan" | "green" | "red" | "grey" | "violet"> = { booked: "cyan", confirmed: "cyan", showed: "green", completed: "green", noshow: "red", cancelled: "grey", invalid: "grey" };
const LABEL_OF_STATUS: Record<string, string> = { booked: "Booked", confirmed: "Confirmed", showed: "Showed", completed: "Completed", noshow: "No-show", cancelled: "Cancelled", invalid: "Invalid" };
export function StatusChip({ row }: { row: Pick<ApRow, "status" | "hoursPast"> }) {
  const unmarked = (row.status === "booked" || row.status === "confirmed") && row.hoursPast !== null && row.hoursPast > 0;
  return <span className="ap-chip" data-tone={unmarked ? "violet" : TONE_OF_STATUS[row.status] ?? "grey"}>{unmarked ? "No outcome" : LABEL_OF_STATUS[row.status] ?? row.status}</span>;
}
export const Chip = ({ tone, children }: { tone: "green" | "amber" | "red" | "grey" | "cyan" | "violet"; children: ReactNode }) => <span className="ap-chip" data-tone={tone}>{children}</span>;

const FLAG_TEXT: Record<ApRow["flags"][number], string> = { "double-booked": "Double-booked", "no-deal": "No deal linked" };
export const when = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`; };

/** Compact table of appointments (40px rows). Row click or Enter opens the right-side panel; the arrow keys move between rows. */
export function ApTable({ rows, showAccount, onOpen, activeId, testId, selectable, selected, onSelect, onChanged }: { rows: ApRow[]; showAccount: boolean; onOpen: (r: ApRow) => void; activeId?: string | null; testId?: string; selectable?: boolean; selected?: Set<string>; onSelect?: (id: string, on: boolean) => void; onChanged?: () => void }) {
  const body = useRef<HTMLTableSectionElement>(null);
  const [hot, setHot] = useState<string | null>(null); // the row under the pointer or focus: quick actions mount for it only, so a long list stays light
  const move = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === "ArrowDown" || e.key === "j" ? i + 1 : e.key === "ArrowUp" || e.key === "k" ? i - 1 : null;
    if (to !== null) { e.preventDefault(); (body.current?.children[to] as HTMLElement | undefined)?.focus(); }
    else if (e.key === "Enter") { e.preventDefault(); onOpen(rows[i]); }
  };
  return (
    <div className="ap-scroll" data-testid={testId}>
      <table className="ap-t">
        <thead><tr>{selectable && <th style={{ width: 36 }}><span className="sr-only">Select</span></th>}<th>Contact</th><th>Phone</th>{showAccount && <th>Account</th>}<th>When</th><th>Calendar</th><th>Status</th><th>Booked by</th><th>Owner</th><th data-num>Deal</th><th>Notes</th>{selectable && hasApSlot("RowActions") && <th><span className="sr-only">Mark</span></th>}</tr></thead>
        <tbody ref={body}>
          {rows.map((r, i) => (
            <tr key={r.id} tabIndex={0} data-active={activeId === r.id ? "1" : undefined} data-tone={r.flags.includes("double-booked") ? "red" : r.ownerId === null ? "amber" : undefined} onClick={() => onOpen(r)} onKeyDown={(e) => move(e, i)} onMouseEnter={() => setHot(r.id)} onFocus={() => setHot(r.id)} aria-label={`${r.contactName}, ${when(r.startAt)}`} data-testid="ap-row">
              {selectable && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="size-4" aria-label={`Select ${r.contactName}`} checked={selected?.has(r.id) ?? false} onChange={(e) => onSelect?.(r.id, e.target.checked)} /></td>}
              <td><span className="ap-name">{r.contactName}</span>{r.url && <a className="ap-link ml-2 text-xs" href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Open ${r.contactName} in your CRM`} data-testid="ap-row-crm">Open in your CRM</a>}</td>
              <td className="ap-sub">{r.phone ?? "-"}</td>{showAccount && <td className="ap-sub">{r.accountName}</td>}
              <td>{when(r.startAt)}{r.hoursPast !== null && r.hoursPast > 0 && <span className="ap-sub"> ({r.hoursPast < 48 ? `${Math.round(r.hoursPast)}h` : `${Math.round(r.hoursPast / 24)}d`} ago)</span>}</td>
              <td className="ap-sub">{r.calendarName}</td>
              <td><StatusChip row={r} /></td>
              <td>{r.bookerName ?? <span className="ap-sub">Unknown</span>}</td>
              <td>{r.ownerName ?? <Chip tone="amber">Nobody</Chip>}</td>
              <td data-num>{r.dealValueCents ? money(r.dealValueCents) : <span className="ap-sub">{r.dealStatus === "none" ? "No deal" : "n/a"}</span>}</td>
              <td>{r.flags.length ? <span className="inline-flex items-center gap-1 text-[var(--s6-amber)]"><AlertTriangle aria-hidden className="size-3.5" />{FLAG_TEXT[r.flags[0]]}{r.flags.length > 1 ? ` +${r.flags.length - 1}` : ""}</span> : <span className="ap-sub">-</span>}</td>
              {selectable && hasApSlot("RowActions") && <td onClick={(e) => e.stopPropagation()}>{(hot === r.id || activeId === r.id) && <ApSlot name="RowActions" row={r} onChanged={onChanged} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Downloads the rows on the page as CSV (a spreadsheet cannot run a formula from a cell: leading = + - @ are neutralised). */
export function csvDownload(rows: ApRow[]) {
  const cell = (v: unknown) => { let t = String(v ?? ""); if (/^[=+-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const head = ["Name", "Phone", "Account", "Calendar", "Date", "Status", "Booked by", "Owner", "Deal value"];
  const lines = [head, ...rows.map((r) => [r.contactName, r.phone, r.accountName, r.calendarName, r.startAt, r.status, r.bookerName, r.ownerName, r.dealValueCents === null ? "" : r.dealValueCents / 100])];
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.map((l) => l.map(cell).join(",")).join("\n")], { type: "text/csv" })); a.download = "appointments.csv"; a.click(); URL.revokeObjectURL(a.href);
}

export function Pager({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size)), from = total === 0 ? 0 : (page - 1) * size + 1, to = Math.min(total, page * size);
  return (
    <div className="ap-pager">
      <span data-testid="ap-count">{from.toLocaleString("en-US")} to {to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
      <span className="inline-flex items-center gap-2">
        <label className="sr-only" htmlFor="ap-size">Rows per page</label>
        <select id="ap-size" className="ap-field" style={{ minHeight: 36 }} value={size} onChange={(e) => onSize(Number(e.target.value))}>{[20, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft aria-hidden className="mx-auto size-4" /></button>
        <span className="tnum">{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight aria-hidden className="mx-auto size-4" /></button>
      </span>
    </div>
  );
}

/** A server-paged list of appointments for one part. The count in the header is the number of rows behind it. */
export function ApRowsList({ part, filters, extra, onOpen, activeId, showAccount, empty, testId, selectable, onRows }: { part: ApPart; filters: ApFilters; extra?: Record<string, string | number | undefined>; onOpen: (r: ApRow) => void; activeId?: string | null; showAccount: boolean; empty: string; testId: string; selectable?: boolean; onRows?: (rows: ApRow[], total: number) => void }) {
  const [page, setPage] = useState(1), [size, setSize] = useState(20);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const key = JSON.stringify(extra ?? {}) + filters.days + filters.locationId + filters.source + filters.q + filters.userId;
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setPage(1); setSel(new Set()); }
  const { data, error, loading, reload } = useAp<ApRows>(part, filters, { ...extra, page, pageSize: size });
  useEffect(() => { if (data) onRows?.(data.rows, data.total); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={6} label="Loading appointments..." />;
  if (data.total === 0) return <EmptyState title={empty} body="Change the dates or filters above to look further back." />;
  const chosen = data.rows.filter((r) => sel.has(r.id));
  return (
    <div data-testid={testId} aria-busy={loading}>
      {selectable && sel.size > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="ap-bulkbar"><b>{sel.size} selected</b><ApSlot name="BulkActions" rows={chosen} onChanged={reload} filters={filters} /><button type="button" className="ap-link" onClick={() => setSel(new Set())}>Clear</button></div>}
      <div className="mb-2 text-right"><button type="button" className="ap-link" onClick={() => csvDownload(data.rows)} data-testid="ap-csv" title="Download the rows on this page as a spreadsheet file">Download CSV</button></div>
      <div className="ap-tablewrap" style={{ opacity: loading ? 0.7 : 1 }}>
        <ApTable rows={data.rows} showAccount={showAccount} onOpen={onOpen} activeId={activeId} selectable={selectable} selected={sel} onChanged={reload} onSelect={(id, on) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; })} />
        <Pager total={data.total} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }} />
      </div>
    </div>
  );
}

/** The right-side panel shell. Slice AB mounts the details (timeline, deal, reminders, edit, delete) in the "Details" slot; until then it shows the facts the table already has. */
export function ApPanel({ row, onClose, onChanged, filters }: { row: ApRow; onClose: () => void; onChanged: () => void; filters: ApFilters }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <div className="ap-scrim" onClick={onClose} aria-hidden />
      <aside className="ap-panel" role="dialog" aria-modal="true" aria-label={`Appointment with ${row.contactName}`} ref={ref} tabIndex={-1} data-testid="ap-panel">
        <div className="ap-panel-h">
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold leading-tight">{row.contactName}</h2><p className="ap-fine">{row.accountName} · {row.calendarName}</p></div>
          <button type="button" className="ap-iconbtn" onClick={onClose} aria-label="Close panel" data-testid="ap-panel-close"><X aria-hidden className="size-4" /></button>
        </div>
        <div className="ap-panel-b">
          <dl className="ap-dl">
            <dt>When</dt><dd>{when(row.startAt)}</dd>
            <dt>Status</dt><dd><StatusChip row={row} /></dd>
            <dt>Booked by</dt><dd>{row.bookerName ?? "Unknown"}</dd>
            <dt>Owner</dt><dd>{row.ownerName ?? "Nobody assigned"}</dd>
            <dt>Source</dt><dd>{row.source ?? "Unknown"}</dd>
            <dt>Deal</dt><dd>{row.dealStatus === "none" ? "No deal linked" : `${row.dealStatus === "won" ? "Won" : row.dealStatus === "lost" ? "Lost" : "Open"}${row.dealValueCents ? `, ${money(row.dealValueCents)}` : ""}`}</dd>
            {row.flags.length > 0 && <><dt>Watch</dt><dd>{row.flags.map((f) => FLAG_TEXT[f]).join(", ")}</dd></>}
          </dl>
          {row.url && <a className="s6-btn" data-kind="primary" href={row.url} target="_blank" rel="noopener noreferrer" data-testid="ap-open-crm">Open in your CRM</a>}
          <ApSlot name="Details" row={row} onChanged={onChanged} filters={filters} />
          <p className="ap-fine">Changes to appointments are made in your CRM or, once enabled, through SubSync&apos;s checked edit tools (preview first, typed confirmation to delete).</p>
        </div>
      </aside>
    </>
  );
}

/** A person card with the plain-words coaching note and the numbers behind it. */
export function PersonPanel({ person, overall, onClose, onOpenRows }: { person: ApStats & { id: string; name: string }; overall: { showRate: number | null; noShowRate: number | null; closeRate: number | null }; onClose: () => void; onOpenRows: () => void }) {
  const note = coachingNote(person, overall);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <div className="ap-scrim" onClick={onClose} aria-hidden />
      <aside className="ap-panel" role="dialog" aria-modal="true" aria-label={`${person.name}, coaching card`} data-testid="ap-person-panel">
        <div className="ap-panel-h"><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">{person.name}</h2><p className="ap-fine">Coaching card</p></div><button type="button" className="ap-iconbtn" onClick={onClose} aria-label="Close panel"><X aria-hidden className="size-4" /></button></div>
        <div className="ap-panel-b">
          <p className="ap-note" data-tone={note.tone === "red" ? "red" : note.tone === "amber" ? "amber" : undefined} data-testid="ap-coach">{note.text}</p>
          <dl className="ap-dl">
            <dt>Booked</dt><dd>{person.bookings}</dd><dt>Show rate</dt><dd>{pct(person.showRate)} <span className="ap-sub">(everyone {pct(overall.showRate)})</span></dd>
            <dt>No-show rate</dt><dd>{pct(person.noShowRate)} <span className="ap-sub">(everyone {pct(overall.noShowRate)})</span></dd><dt>Close rate</dt><dd>{pct(person.closeRate)} <span className="ap-sub">(everyone {pct(overall.closeRate)})</span></dd>
            <dt>Revenue won</dt><dd>{money(person.revenueCents)}</dd><dt>Lead to booked</dt><dd>{person.avgLeadToBookedHours === null ? "n/a" : `${person.avgLeadToBookedHours.toFixed(1)} hours`}</dd>
          </dl>
          <button type="button" className="s6-btn" data-kind="primary" onClick={onOpenRows}>Open their {person.bookings} appointments</button>
          <p className="ap-fine">Compared only with your own team&apos;s averages for these dates.</p>
        </div>
      </aside>
    </>
  );
}
