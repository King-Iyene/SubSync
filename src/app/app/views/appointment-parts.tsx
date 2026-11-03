"use client";

import { CountUp } from "../ds/count-up";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { bucketOf, statusWord, type Bucket } from "@/lib/analytics/appointment-f3";
import { EMPTY_FILTER } from "@/lib/design/filters";
import { channelWord, EXPLAIN, filterFromHash, filterIntoHash, hasApptFilter, NO_APPT_FILTER, type ApptFilterValue, type Explain } from "@/lib/design/appt-ui";
import { neighbours } from "@/lib/design/ui-logic";
import { useData, useApiClient } from "../session";
import { DataList, ErrorState, LeadDrawer, remember, remembered, ScopeFilterBar, SkeletonRows, type Column, type LeadSeed } from "../ds";
import { Badge, Btn, ExtLink, type Tone } from "../ui";

// Pieces shared by the Appointments overview and its Insights tab (stage F3).

export type ApptRow = {
  id: string; locationId: string; locationName: string | null; contactId: string | null; name: string; calendarId?: string | null; calendar: string | null; at: number; status: string;
  assigned: string; assignedKey?: string; bookedBy?: string | null; channel?: string | null; source: string | null; phone?: string | null; noOutcome?: boolean; unconfirmed?: boolean; url?: string | null;
};
export type FilterOptionsData = { calendars: Array<{ key: string; label: string; count: number }>; users: Array<{ key: string; label: string; count: number }>; sources: Array<{ key: string; label: string; count: number }> };

export const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
export const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS_TONE: Record<Bucket, Tone> = { new: "info", confirmed: "info", showed: "good", noshow: "bad", cancelled: "neutral", invalid: "neutral", other: "warn" };
export function StatusBadge({ row }: { row: Pick<ApptRow, "status" | "noOutcome"> }) {
  const b = bucketOf(row.status);
  if (row.noOutcome) return <Badge tone="warn">{statusWord(row.status)}, no outcome recorded</Badge>;
  return <Badge tone={STATUS_TONE[b]}>{statusWord(row.status)}</Badge>;
}

/** The columns of every appointment list. The account is only drawn when the person can see more than one. */
export function apptColumns(showAccount: boolean): Array<Column<ApptRow>> {
  const cols: Array<Column<ApptRow>> = [
    { key: "name", header: "Contact", primary: true, width: "minmax(0,1.6fr)", cell: (r) => r.name },
    { key: "when", header: "When", width: "minmax(0,1.3fr)", cell: (r) => <span className="tabular-nums">{when(r.at)}</span> },
    { key: "calendar", header: "Calendar", width: "minmax(0,1.2fr)", cell: (r) => <span className="text-muted-foreground">{r.calendar ?? "Appointment"}</span> },
    { key: "status", header: "Status", width: "minmax(0,1.6fr)", cell: (r) => <StatusBadge row={r} /> },
    { key: "who", header: "Assigned to", width: "minmax(0,1.2fr)", cell: (r) => <span className="text-muted-foreground">{r.assigned}</span> },
    // The call goes through the CRM's own dialer (KF-3): this opens the contact in the CRM, never the phone's own dialer.
    { key: "call", header: "", width: "8.5rem", align: "right", cell: (r) => (r.url ? <ExtLink href={r.url}>{r.phone ? "Call in your CRM" : "Open contact"}</ExtLink> : null) },
  ];
  if (showAccount) cols.splice(2, 0, { key: "account", header: "Client account", width: "minmax(0,1.2fr)", cell: (r) => <span className="text-muted-foreground">{r.locationName ?? ""}</span> });
  return cols;
}

// ---------- the three filters (calendar, person, lead source) ----------

/** The filters live in the address (`ap.calendar=...`) and in this browser's memory, so a link and the next visit keep them. */
export function useApptFilter(): [ApptFilterValue, (f: ApptFilterValue) => void] {
  const [value, setValue] = useState<ApptFilterValue>(NO_APPT_FILTER);
  useEffect(() => {
    const fromLink = filterFromHash(window.location.hash);
    let init = fromLink;
    if (!hasApptFilter(fromLink) && !window.location.hash.includes("ap.")) {
      try { init = { ...NO_APPT_FILTER, ...(JSON.parse(remembered("appt-filter") ?? "{}") as Partial<ApptFilterValue>) }; } catch { init = NO_APPT_FILTER; }
      init = { calendar: String(init.calendar ?? "").slice(0, 80), user: String(init.user ?? "").slice(0, 80), source: String(init.source ?? "").slice(0, 80) };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasApptFilter(init)) setValue(init);
  }, []);
  const set = useCallback((f: ApptFilterValue) => {
    setValue(f);
    remember("appt-filter", hasApptFilter(f) ? JSON.stringify(f) : null);
    try { window.history.replaceState(null, "", filterIntoHash(window.location.hash, f)); } catch { /* the choice still applies until the page changes */ }
  }, []);
  return [value, set];
}

/** Calendar, person and lead source. Each is drawn only when there is something to choose between (the shared filter bar decides). */
export function ApptFilterBar({ options, value, onChange }: { options: FilterOptionsData | null; value: ApptFilterValue; onChange: (f: ApptFilterValue) => void }) {
  if (!options) return null;
  const choice = (c: FilterOptionsData["calendars"]) => c.map((x) => ({ key: x.key, label: x.label, count: x.count }));
  return (
    <div className="mb-4" data-testid="appt-filter">
      <ScopeFilterBar kind="business" hideScope
        options={{ calendars: choice(options.calendars), users: choice(options.users), sources: choice(options.sources) }}
        value={{ ...EMPTY_FILTER, calendar: value.calendar, user: value.user, source: value.source }}
        onChange={(v) => onChange({ calendar: v.calendar, user: v.user, source: v.source })} />
      {hasApptFilter(value) && <button type="button" className="mt-1 text-xs underline" onClick={() => onChange(NO_APPT_FILTER)}>Clear the calendar, person and source filters</button>}
    </div>
  );
}

// ---------- what this shows, how to read it, what to do ----------

export function Explainer({ id, className = "" }: { id: keyof typeof EXPLAIN; className?: string }) {
  const e: Explain = EXPLAIN[id];
  return (
    <details className={`mt-3 text-xs ${className}`} data-testid={`explain-${id}`}>
      <summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">What this shows, how to read it, what to do</summary>
      <dl className="mt-2 space-y-1.5 border-l pl-3">
        <div><dt className="font-medium">What this shows</dt><dd className="text-muted-foreground">{e.shows}</dd></div>
        <div><dt className="font-medium">How to read it</dt><dd className="text-muted-foreground">{e.read}</dd></div>
        <div><dt className="font-medium">What to do</dt><dd className="text-muted-foreground">{e.todo}</dd></div>
      </dl>
    </details>
  );
}

// A number that opens the list behind it. Same look as a tile; a button because pressing it does something.
export function CountTile({ label, value, sub, tone, onOpen, open, hint }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; onOpen?: () => void; open?: boolean; hint: string }) {
  const rule = tone === "bad" ? "border-destructive" : tone === "warn" ? "border-warning" : tone === "good" ? "border-success" : "border-border";
  const text = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : "";
  const body = (
    <>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span className={`tnum mt-1.5 block text-[1.7rem] font-semibold leading-none tracking-tight ${text}`}><CountUp value={value} /></span>
      {sub && <span className="mt-2 block text-xs leading-5 text-muted-foreground">{sub}</span>}
    </>
  );
  // No box: a figure with a colour rule on its left, like every other key figure (D1). A pressable one gains an underline-free hover wash and a clear open state.
  const base = `ds-press block w-full min-w-0 border-l-2 py-1 pl-4 pr-2 text-left ${rule}`;
  if (!onOpen) return <div className={base}>{body}</div>;
  return <button type="button" onClick={onOpen} aria-pressed={open} aria-label={hint} title={hint} className={`${base} -ml-px rounded-r-lg hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/30 ${open ? "bg-accent/60" : ""}`}>{body}</button>;
}

// ---------- one appointment ----------

type Detail = {
  appointment: { id: string; locationId: string; locationName: string | null; calendar: string | null; title: string | null; at: number; endAt: number | null; status: string; assigned: string; bookedBy: string | null; channel: string | null; createdAt: number | null; noOutcome: boolean };
  contact: { contactId: string; name: string; phone: string | null; source: string | null } | null;
  history: Array<{ at: number; text: string }>;
  url: string | null;
};

function DetailBody({ row, onLead }: { row: ApptRow; onLead: () => void }) {
  const { data, error, loading, reload } = useData<Detail>(`appointments/${encodeURIComponent(row.locationId)}/${encodeURIComponent(row.id)}`);
  const a = data?.appointment;
  const url = data?.url ?? row.url ?? null;
  const line = (label: string, v: ReactNode) => <div className="flex gap-3 py-1.5 text-sm"><dt className="w-28 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{v}</dd></div>;
  return (
    <>
      <h2 className="truncate text-lg font-semibold" data-testid="appt-drawer-name">{row.name}</h2>
      <p className="truncate text-sm text-muted-foreground">{row.locationName ?? ""}</p>
      <div className="mt-3"><StatusBadge row={{ status: a?.status ?? row.status, noOutcome: a?.noOutcome ?? row.noOutcome }} /></div>
      {(a?.noOutcome ?? row.noOutcome) && <p className="mt-2 text-sm text-muted-foreground">The time has passed and nobody has marked it showed or no-show. Mark it in your CRM so the show rate is true.</p>}
      {loading && !data && <div className="mt-5"><SkeletonRows rows={4} label="Loading this appointment..." /></div>}
      {error && <div className="mt-5"><ErrorState error={error} onRetry={reload} /></div>}
      <dl className="mt-4 divide-y border-y">
        {line("When", <span className="tabular-nums">{when(a?.at ?? row.at)}{a?.endAt ? ` to ${new Date(a.endAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</span>)}
        {line("Calendar", a?.calendar ?? row.calendar ?? "Not recorded")}
        {line("Assigned to", a?.assigned ?? row.assigned)}
        {line("Booked by", data ? (a?.bookedBy ?? channelWord(a?.channel ?? null)) : row.bookedBy ?? "...")}
        {a?.bookedBy && a.channel ? line("How", channelWord(a.channel)) : null}
        {a?.createdAt ? line("Booked on", new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })) : null}
        {line("Lead source", data ? data.contact?.source ?? "Not recorded" : row.source ?? "...")}
      </dl>
      <section className="mt-5" aria-label="Status history">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status history</h3>
        {data && data.history.length === 0 && <p className="text-sm text-muted-foreground">No change has been recorded yet.</p>}
        {data && data.history.length > 0 && (
          <ol className="space-y-2 border-l pl-4">
            {data.history.map((h, i) => <li key={h.at + "-" + i} className="text-sm"><p>{h.text}</p><p className="text-xs text-muted-foreground">{when(h.at)}</p></li>)}
          </ol>
        )}
        <p className="mt-2 text-xs text-muted-foreground">History starts when SubSync first saw it.</p>
      </section>
      <div className="mt-5 flex flex-wrap gap-2">
        {row.contactId && <Btn variant="primary" onClick={onLead}>See the lead</Btn>}
        {url && data?.contact?.phone && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40">Call in your CRM</a>}
      </div>
      {url && data?.contact?.phone && <p className="mt-1 text-xs text-muted-foreground">Opens in your CRM to call.</p>}
      {url && <p className="mt-5 text-xs"><a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">Open in your CRM</a></p>}
    </>
  );
}

/** The side panel for one appointment, with arrows to the previous and next one in the list it was opened from. "See the lead" opens the lead panel. */
export function ApptDrawer({ rows, index, onIndex, onClose }: { rows: readonly ApptRow[]; index: number | null; onIndex: (i: number | null) => void; onClose: () => void }) {
  const [lead, setLead] = useState<number | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const open = index !== null && index >= 0 && index < rows.length && lead === null;
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  const seeds: LeadSeed[] = rows.filter((r) => r.contactId).map((r) => ({ contactId: r.contactId as string, locationId: r.locationId, name: r.name, locationName: r.locationName, url: r.url ?? undefined, note: `${statusWord(r.status)} appointment, ${when(r.at)}.` }));
  const leadIndex = lead === null ? null : seeds.findIndex((s) => s.contactId === rows[lead]?.contactId && s.locationId === rows[lead]?.locationId);
  return (
    <>
      <LeadDrawer leads={seeds} index={leadIndex !== null && leadIndex >= 0 ? leadIndex : null} onIndex={(i) => { const s = seeds[i]; const at = rows.findIndex((r) => r.contactId === s.contactId && r.locationId === s.locationId); setLead(at); onIndex(at); }} onClose={() => setLead(null)} />
      {open && index !== null && (() => {
        const nb = neighbours(index, rows.length);
        const row = rows[index];
        return (
          <div className="fixed inset-0 z-50 print:hidden" data-testid="appt-drawer-root">
            <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
            <aside role="dialog" aria-modal="true" aria-label={`Appointment: ${row.name}`} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l bg-popover text-popover-foreground shadow-[var(--shadow-lift)]" data-testid="appt-drawer">
              <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Previous appointment" disabled={nb.prev === null} onClick={() => nb.prev !== null && onIndex(nb.prev)} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35"><ChevronLeft aria-hidden className="size-5" /></button>
                  <span className="min-w-14 text-center text-xs text-muted-foreground tabular-nums" data-testid="appt-drawer-position">{index + 1} of {rows.length}</span>
                  <button type="button" aria-label="Next appointment" disabled={nb.next === null} onClick={() => nb.next !== null && onIndex(nb.next)} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-35"><ChevronRight aria-hidden className="size-5" /></button>
                </div>
                <button ref={close} type="button" aria-label="Close" onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted"><X aria-hidden className="size-5" /></button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><DetailBody key={row.locationId + row.id} row={row} onLead={() => setLead(index)} /></div>
            </aside>
          </div>
        );
      })()}
    </>
  );
}

/** The list behind a count or a bar: the rows, the real count in its heading, and a back link. A row opens the appointment panel. */
export function ApptListPanel({ title, count, rows, showAccount, onBack, empty = "Nothing behind this one.", noun = "appointments" }: { title: string; count: number; rows: ApptRow[]; showAccount: boolean; onBack?: () => void; empty?: string; noun?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const left = Math.max(0, count - rows.length);
  return (
    <section className="mt-4" aria-label={`List behind ${title}`} data-testid="appt-list-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}: <span data-testid="appt-list-count">{count}</span> {count === 1 ? noun.replace(/s$/, "") : noun}</h3>
        {onBack && <button type="button" onClick={onBack} className="min-h-9 text-xs font-medium text-primary underline" data-testid="appt-list-back">Close the list</button>}
      </div>
      <DataList rows={rows} columns={apptColumns(showAccount)} rowKey={(r) => r.locationId + r.id} total={count} empty={empty} onOpen={(_, i) => setIndex(i)} caption={title}
        copyText={(r) => `${r.name}, ${r.calendar ?? "appointment"}, ${when(r.at)}, ${statusWord(r.status)}${r.noOutcome ? " (no outcome recorded)" : ""}, ${r.assigned}`} />
      {left > 0 && <p className="mt-1 text-xs text-muted-foreground">Showing the first {rows.length} of {count}.</p>}
      <ApptDrawer rows={rows} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />
    </section>
  );
}

// ---------- the show-rate target ----------

/** The owner's own show-rate target. It is typed by a person; SubSync does not read it from the CRM. */
export function TargetEditor({ value, isDefault, canEdit, onSaved }: { value: number; isDefault: boolean; canEdit: boolean; onSaved: () => void }) {
  const api = useApiClient();
  const [text, setText] = useState(String(value));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  if (!canEdit) return <p className="text-xs text-muted-foreground">Show-rate target: {value}%{isDefault ? " (SubSync's suggestion; the owner can change it)" : ""}.</p>;
  const n = Number(text);
  const save = async (v: number | null) => {
    setState("saving"); setProblem(null);
    try { await api.put("appointments/targets", { showRate: v }); setState("saved"); onSaved(); } catch (e) { setState("error"); setProblem((e as Error).message); }
  };
  return (
    <form className="flex flex-wrap items-center gap-2 text-xs" onSubmit={(e) => { e.preventDefault(); if (Number.isInteger(n) && n >= 30 && n <= 100) void save(n); else { setState("error"); setProblem("Enter a whole number from 30 to 100."); } }}>
      <label className="flex items-center gap-1.5"><span className="font-medium">Show-rate target</span>
        <input className="min-h-9 w-16 rounded-lg border bg-card px-2 text-right tabular-nums" inputMode="numeric" aria-label="Show-rate target in percent" value={text} onChange={(e) => { setText(e.target.value); setState("idle"); }} />%
      </label>
      <Btn type="submit" disabled={state === "saving"}>{state === "saving" ? "Saving..." : "Save target"}</Btn>
      {!isDefault && <button type="button" className="underline" onClick={() => { setText("75"); void save(null); }}>Use the suggested 75%</button>}
      <span className="text-muted-foreground">You set this; SubSync does not read it from your CRM.{state === "saved" ? " Saved." : ""}</span>
      {problem && <span role="alert" className="text-destructive">{problem}</span>}
    </form>
  );
}
