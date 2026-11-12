"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { statusWord } from "@/lib/analytics/appointment-f3";
import { dialPlan, dialWarnings } from "@/lib/people/dial";
import { money$, sortLabel, SORT_KEYS, type Compare, type SortKey, type WorkItem, type WorkKind } from "@/lib/analytics/appointment-work";
import { LeadDrawer, PopMenu, RowButton, useDialer, type LeadSeed, type MenuItem } from "../ds";
import { useData } from "../session";
import { ExtLink } from "../ui";
import { when } from "./appointment-parts";

// The pieces of the rebuilt Appointments page (docs/APPOINTMENTS_REVIEW.md). One row shape for every list (KF-8): the person and why they are here on two
// lines, then one small outlined button in its own column and a quiet menu. A row opens one panel: who the person is (tags with the day SubSync first saw
// them, timeline, deals, the call and email buttons) with the appointment on top. SubSync only reads: marking an outcome is done in the CRM.

export type WorkRowData = WorkItem & { url: string | null };
export type Paged<T> = { rows: T[]; page: number; pages: number; total: number; from: number; to: number };
export type ListData = Paged<WorkRowData> & {
  value: number; capped: boolean; windowCap: number; several: boolean; canSeeAccounts: boolean;
  options: { accounts: Array<{ key: string; label: string; count: number }>; people: Array<{ key: string; label: string; count: number }>; calendars: Array<{ key: string; label: string; count: number }> };
};

export const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 sm:min-h-9";
export const PRIMARY = "ds-press inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 sm:w-auto sm:min-w-64";
export const QUIET = "ds-press inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-9";
const FIELD = "min-h-11 rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-9";

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const TRACKS = "@3xl:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem_5.5rem_2rem]";

// ---------- the panel's appointment block ----------

type Detail = { appointment: { status: string; at: number; endAt: number | null; calendar: string | null; assigned: string; noOutcome: boolean; bookedBy: string | null }; history: Array<{ at: number; text: string }> };

function ApptTop({ row }: { row: WorkRowData }) {
  const { data } = useData<Detail>(`appointments/${encodeURIComponent(row.locationId)}/${encodeURIComponent(row.id)}`);
  const needs = data?.appointment.noOutcome ?? row.kind === "record";
  return (
    <section className="mt-4 border-y py-3 text-sm" aria-label="The appointment" data-testid="appt-top">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The appointment</h3>
      <p className="font-medium">{statusWord(row.status)}{needs ? ", no outcome marked" : ""} <span className="font-normal text-muted-foreground">· {when(row.at)}{row.calendar ? ` · ${row.calendar}` : ""}</span></p>
      <p className="text-muted-foreground">Assigned to {row.assigned}. {row.reason}</p>
      {needs && row.url && (
        <p className="mt-2" data-testid="appt-mark-note">
          <ExtLink href={row.url}>Open in your CRM to mark the outcome</ExtLink>
          <span className="block text-xs text-muted-foreground">Mark it showed or no-show there. SubSync only reads your appointments, so it never changes one.</span>
        </p>
      )}
      {data && data.history.length > 0 && (
        <details className="mt-2">
          <summary className="min-h-9 cursor-pointer text-xs font-medium text-muted-foreground">What SubSync saw change ({data.history.length})</summary>
          <ol className="mt-1 space-y-1 border-l pl-3 text-xs">{data.history.map((h, i) => <li key={h.at + "-" + i}>{h.text} <span className="text-muted-foreground">{when(h.at)}</span></li>)}</ol>
        </details>
      )}
    </section>
  );
}

// ---------- a list of rows with its panel ----------

const seedOf = (r: WorkRowData): LeadSeed => ({ contactId: r.contactId as string, locationId: r.locationId, name: r.name, locationName: r.locationName, phone: r.phone, owner: r.assigned, url: r.url ?? undefined, dnd: r.dnd, timeZone: r.timeZone, note: `${statusWord(r.status)} appointment, ${when(r.at)}.` });

/** The rows, their headings, and the one panel they open. Every list on the page uses this, so a row looks and behaves the same everywhere. */
export function RowList({ rows, kind, showAccount, empty, testId = "appt-rows" }: { rows: WorkRowData[]; kind: WorkKind | "all" | "window"; showAccount: boolean; empty: ReactNode; testId?: string }) {
  const { provider } = useDialer();
  const [open, setOpen] = useState<number | null>(null);
  const withContact = useMemo(() => rows.filter((r) => r.contactId), [rows]);
  const seeds = useMemo(() => withContact.map(seedOf), [withContact]);
  const show = (r: WorkRowData) => { const i = withContact.findIndex((x) => x.key === r.key); if (i >= 0) setOpen(i); };
  if (rows.length === 0) return <p className="border-y py-6 text-center text-sm text-muted-foreground" data-testid="appt-empty">{empty}</p>;
  const atStake = kind === "record" ? "People's open deals" : "Open deals";
  return (
    <>
      <ul className="@container divide-y border-y" data-testid={testId}>
        <li aria-hidden className={`hidden gap-x-3 py-1.5 pl-1 pr-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @3xl:grid ${TRACKS}`}><span>Who</span><span>When</span><span className="text-right">{atStake}</span><span /><span /></li>
        {rows.map((r) => {
          const plan = dialPlan(provider, { phone: r.phone, contactUrl: r.url });
          const warnings = dialWarnings({ dnd: r.dnd, phone: r.phone, timeZone: r.timeZone, now: new Date() });
          const callable = r.kind !== "record" && !!r.phone && !!plan.href;
          const label = callable ? "Call" : "Open";
          // A call that needs a word of warning (asked not to be contacted, quiet hours) opens the panel, where the warning is shown before the call. Never straight out.
          const button = callable && warnings.length > 0
            ? <RowButton onClick={() => show(r)} label="Call" sr={`${r.name}: check first, then call`} testId="appt-row-button" />
            : r.url ? <RowButton {...(!callable && withContact.some((x) => x.key === r.key) ? { onClick: () => show(r) } : { href: callable ? (plan.href as string) : r.url })} label={label} sr={`${r.name}, open them here`} testId="appt-row-button" /> : <span />;
          const items: MenuItem[] = [
            ...(r.contactId ? [{ key: "show", label: "Show the person and the appointment", onSelect: () => show(r) }] : []),
            ...(r.url && r.phone ? [{ key: "call", label: warnings.length > 0 ? "Call in your CRM (check first)" : "Call in your CRM", onSelect: () => (warnings.length > 0 ? show(r) : window.open(plan.href ?? r.url ?? "", "_blank", "noopener,noreferrer")) }] : []),
            ...(r.url && r.email ? [{ key: "email", label: "Email in your CRM", hint: "Opens the contact; the message is sent from your CRM", onSelect: () => window.open(r.url as string, "_blank", "noopener,noreferrer") }] : []),
            ...(r.url ? [{ key: "open", label: r.kind === "record" ? "Open in your CRM to mark the outcome" : "Open in your CRM", onSelect: () => window.open(r.url as string, "_blank", "noopener,noreferrer") }] : []),
          ];
          return (
            <li key={r.key} data-testid="appt-row" data-kind={r.kind} data-dnd={r.dnd ? "true" : "false"}
              className={`ds-row grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-x-3 gap-y-0.5 py-2 pl-1 pr-1 ${TRACKS}`}>
              <div className="min-w-0">
                {r.contactId
                  ? <button type="button" onClick={() => show(r)} className="block min-h-6 max-w-full truncate text-left font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" title={r.name} data-testid="appt-row-name">{r.name}</button>
                  : <p className="truncate font-semibold" title={r.name}>{r.name}</p>}
                <p className="line-clamp-2 text-sm text-muted-foreground @3xl:truncate" title={r.reason}>{r.dnd ? <span className="font-medium text-warning">Do not contact · </span> : null}{showAccount && r.locationName ? `${r.locationName} · ` : ""}{r.reason}</p>
                <p className="text-xs text-muted-foreground @3xl:hidden">{when(r.at)}{r.value > 0 ? ` · ${money$(r.value)} in open deals` : ""}</p>
              </div>
              <p className="tnum hidden text-sm @3xl:block">{when(r.at)}</p>
              <p className="tnum hidden text-right text-sm @3xl:block">{r.value > 0 ? money$(r.value) : null}</p>
              <div>{button}</div>
              <div><PopMenu label={`More for ${r.name}`} items={items} testId="appt-row-more" triggerClassName="ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:size-8" /></div>
            </li>
          );
        })}
      </ul>
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} top={(_, i) => (withContact[i] ? <ApptTop row={withContact[i]} /> : null)} />
    </>
  );
}

// ---------- the full list: search, sort, filter, pages (asked from the server, so 100 accounts and 10,000 rows cost the same as 6) ----------

export type Fixed = Record<string, string>;
const query = (o: Record<string, string | number | null | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export function FullList({ kind, fixed, title, onClose, empty, size = 25, testId = "appt-full" }: { kind: WorkKind | "all" | "window"; fixed?: Fixed; title?: ReactNode; onClose?: () => void; empty: ReactNode; size?: number; testId?: string }) {
  const [q, setQ] = useState("");
  const [qNow, setQNow] = useState("");
  const [sort, setSort] = useState<SortKey>("important");
  const [location, setLocation] = useState("");
  const [user, setUser] = useState("");
  const [page, setPage] = useState(0);
  const head = useRef<HTMLParagraphElement>(null);
  // The button that opened this list is gone, so focus moves to its title (a person on a keyboard or a screen reader is not left behind).
  useEffect(() => { head.current?.focus({ preventScroll: false }); }, []);
  useEffect(() => { const t = setTimeout(() => { setQNow(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const path = `appointments/list?${query({ kind, ...fixed, q: qNow, sort, location, user, page, size })}`;
  const { data, error, loading, reload } = useData<ListData>(path);
  const sortKind = kind === "window" ? "bucket" : kind;
  const filtered = Boolean(qNow || location || user);
  return (
    <section aria-label={typeof title === "string" ? title : "The full list"} data-testid={testId} className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p ref={head} tabIndex={-1} className="text-sm font-semibold outline-none" data-testid="appt-full-title">{title}{data ? <>: <span data-testid="appt-full-count">{data.total.toLocaleString("en-US")}</span></> : null}</p>
        {onClose && <button type="button" className={QUIET} onClick={onClose} data-testid="appt-full-close">Show fewer</button>}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input type="search" className={`${FIELD} w-full sm:w-60`} placeholder="Search a name, phone or account" aria-label="Search this list" value={q} onChange={(e) => setQ(e.target.value)} data-testid="appt-search" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Sort
          <select className={FIELD} value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(0); }} aria-label="Sort this list">
            {SORT_KEYS.map((k) => <option key={k} value={k}>{sortLabel(k, sortKind)}</option>)}
          </select>
        </label>
        {data && data.options.accounts.length > 1 && !fixed?.location && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Client
            <select className={`${FIELD} max-w-48`} value={location} onChange={(e) => { setLocation(e.target.value); setPage(0); }} aria-label="Only one client account">
              <option value="">All clients</option>
              {data.options.accounts.map((a) => <option key={a.key} value={a.key}>{a.label} ({a.count})</option>)}
            </select>
          </label>
        )}
        {data && data.options.people.length > 1 && !fixed?.user && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Person
            <select className={`${FIELD} max-w-44`} value={user} onChange={(e) => { setUser(e.target.value); setPage(0); }} aria-label="Only one team member">
              <option value="">Everyone</option>
              {data.options.people.map((a) => <option key={a.key} value={a.key}>{a.label} ({a.count})</option>)}
            </select>
          </label>
        )}
        {filtered && <button type="button" className={QUIET} onClick={() => { setQ(""); setQNow(""); setLocation(""); setUser(""); setPage(0); }}>Clear</button>}
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-destructive">Could not load this list. <button type="button" className="underline" onClick={reload}>Try again</button></p>}
      {!data && !error && <p className="py-6 text-center text-sm text-muted-foreground">Loading...</p>}
      {data && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          <RowList rows={data.rows} kind={kind} showAccount={data.several && data.canSeeAccounts} empty={filtered ? "Nothing matches. Clear the search or the filters." : empty} />
          {data.capped && <p className="mt-1 text-xs text-muted-foreground">This is a very large list, so SubSync loaded the newest {data.windowCap.toLocaleString("en-US")}. The number above counts those.</p>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-xs text-muted-foreground" data-testid="appt-full-range">{data.total === 0 ? "" : `Showing ${data.from.toLocaleString("en-US")} to ${data.to.toLocaleString("en-US")} of ${data.total.toLocaleString("en-US")}`}{data.value > 0 ? ` · ${money$(data.value)} of open deals` : ""}</span>
            <span className="flex gap-2">
              <button type="button" className={BTN} disabled={data.page === 0} onClick={() => setPage(data.page - 1)} data-testid="appt-prev">Previous</button>
              <button type="button" className={BTN} disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} data-testid="appt-next">Next</button>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- one of the three work lists ----------

export function WorkSection({ kind, title, hint, empty, total, value, rows, showAccount }: {
  kind: WorkKind; title: string; hint: string; empty: string; total: number; value: number; rows: WorkRowData[]; showAccount: boolean;
}) {
  const [all, setAll] = useState(false);
  return (
    <section className="mb-8" aria-labelledby={`appt-${kind}-h`} id={`appt-sec-${kind}`} data-testid={`appt-sec-${kind}`} data-total={total}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={`appt-${kind}-h`} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground" data-testid={`appt-${kind}-summary`}>
            <span className="font-medium text-foreground" data-testid={`appt-${kind}-count`}>{total.toLocaleString("en-US")}</span> {total === 1 ? "appointment" : "appointments"}{value > 0 ? `, people with ${money$(value)} of open deals` : ""}. {hint}
          </p>
        </div>
        {total > rows.length && !all && <button type="button" className="ds-press min-h-11 rounded-md px-2.5 text-sm font-medium text-primary underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9" onClick={() => setAll(true)} data-testid={`appt-${kind}-all`}>See all {total.toLocaleString("en-US")}</button>}
      </div>
      {all
        ? <FullList kind={kind} empty={empty} onClose={() => { setAll(false); setTimeout(() => document.getElementById(`appt-${kind}-h`)?.focus(), 30); }} title={title} testId={`appt-${kind}-full`} />
        : <RowList rows={rows} kind={kind} showAccount={showAccount} empty={empty} testId={`appt-${kind}-rows`} />}
    </section>
  );
}

// ---------- who and where: the comparison people can act on ----------

type By = "person" | "calendar" | "account";
const BY_LABEL: Record<By, string> = { person: "People", calendar: "Calendars", account: "Client accounts" };

export function CompareRows({ rows, by, onOpen }: { rows: Compare[]; by: By; onOpen: (r: Compare) => void }) {
  if (rows.length === 0) return <p className="border-y py-6 text-center text-sm text-muted-foreground" data-testid="appt-compare-empty">Nobody has anything to do. Nothing needs a nudge.</p>;
  return (
    <ul className="@container divide-y border-y" data-testid="appt-compare-rows">
      <li aria-hidden className="hidden grid-cols-[minmax(0,1fr)_6rem_8rem] gap-x-3 py-1.5 pl-1 pr-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground @3xl:grid"><span>{by === "person" ? "Person" : by === "calendar" ? "Calendar" : "Client account"}</span><span className="text-right">To do</span><span className="text-right">Show rate</span></li>
      {rows.map((r) => (
        <li key={r.key} data-testid="appt-compare-row" className="ds-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 pl-1 pr-1 @3xl:grid-cols-[minmax(0,1fr)_6rem_8rem]">
          <div className="min-w-0">
            <p className="truncate font-semibold" title={r.label}>{r.label}</p>
            <p className="line-clamp-2 text-sm text-muted-foreground">{[r.recover ? plural(r.recover, "no-show", "no-shows") : null, r.record ? `${r.record} to mark` : null, r.upcoming ? `${r.upcoming} coming up` : null].filter(Boolean).join(" · ") || "Nothing to do"}</p>
            <p className="text-xs text-muted-foreground @3xl:hidden">{r.rate === null ? `Show rate needs 5 marked (${r.outcomes} so far)` : `Show rate ${Math.round(r.rate * 100)}% of ${r.outcomes} marked`}</p>
          </div>
          <div className="text-right">
            {r.todo > 0
              ? <button type="button" onClick={() => onOpen(r)} className="tnum ds-press min-h-11 min-w-11 rounded-md px-2 text-base font-semibold text-primary underline underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] @3xl:min-h-8" data-testid="appt-compare-open" data-count={r.todo} aria-label={`${r.todo} to do for ${r.label}. Show them.`}>{r.todo}</button>
              : <span className="tnum text-base text-muted-foreground">0</span>}
          </div>
          <p className="tnum hidden text-right text-sm @3xl:block">{r.rate === null ? <span className="text-muted-foreground" title={`${r.outcomes} of 5 marked so far`}>n/a</span> : `${Math.round(r.rate * 100)}% of ${r.outcomes}`}</p>
        </li>
      ))}
    </ul>
  );
}

export function ComparePanel({ windowQuery, initial, canAccounts, several, onOpen }: {
  windowQuery: string; initial: Record<By, { total: number; rows: Compare[] }>; canAccounts: boolean; several: boolean; onOpen: (by: By, r: Compare) => void;
}) {
  const tabs: By[] = ["person", "calendar", ...(canAccounts && several ? (["account"] as By[]) : [])];
  const [by, setBy] = useState<By>("person");
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const [qNow, setQNow] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQNow(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const paged = useData<Paged<Compare> & { by: By }>(all ? `appointments/compare?${windowQuery}&${query({ by, q: qNow, page, size: 10 })}` : null);
  const first = initial[by];
  // Inline, only the lines with something to do (the rows are already sorted most-to-do first); the full list has everyone.
  const busy = first.rows.filter((r) => r.todo > 0);
  const shownRows = all ? paged.data?.rows ?? [] : busy;
  const total = all ? paged.data?.total ?? first.total : first.total;
  return (
    <section className="mb-8" aria-labelledby="appt-compare-h" data-testid="appt-compare">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="appt-compare-h" className="text-lg font-semibold tracking-tight">Who needs a nudge</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Most to do first. Press a number to see exactly those appointments.</p>
        </div>
        <div role="tablist" aria-label="Compare by" className="flex gap-1" onKeyDown={(e: KeyboardEvent) => {
          const i = tabs.indexOf(by);
          const n = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
          if (!n) return;
          e.preventDefault(); setBy(n); setAll(false); setQ(""); setQNow(""); setPage(0);
          setTimeout(() => document.getElementById(`appt-tab-${n}`)?.focus(), 0);
        }}>
          {tabs.map((t) => <button key={t} id={`appt-tab-${t}`} type="button" role="tab" tabIndex={by === t ? 0 : -1} aria-controls="appt-compare-panel" aria-selected={by === t} onClick={() => { setBy(t); setAll(false); setQ(""); setQNow(""); setPage(0); }} data-testid={`appt-by-${t}`} className={`ds-press min-h-11 rounded-md px-3 text-sm sm:min-h-9 ${by === t ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/60"}`}>{BY_LABEL[t]}</button>)}
        </div>
      </div>
      <div id="appt-compare-panel" role="tabpanel" aria-labelledby={`appt-tab-${by}`}>
      {all && <input type="search" className={`${FIELD} mb-2 w-full sm:w-64`} placeholder={`Find in ${BY_LABEL[by].toLowerCase()}`} aria-label="Find in this table" value={q} onChange={(e) => setQ(e.target.value)} data-testid="appt-compare-search" />}
      <CompareRows rows={shownRows} by={by} onOpen={(r) => onOpen(by, r)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        {!all
          ? (total > busy.length ? <button type="button" className={BTN} onClick={() => setAll(true)} data-testid="appt-compare-all">{busy.length === 0 ? "See everyone" : "See all"} {total.toLocaleString("en-US")}</button> : <span />)
          : <>
              <span className="text-xs text-muted-foreground">{paged.data ? `Showing ${paged.data.from} to ${paged.data.to} of ${paged.data.total.toLocaleString("en-US")}` : "Loading..."}</span>
              <span className="flex gap-2">
                <button type="button" className={BTN} disabled={!paged.data || paged.data.page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                <button type="button" className={BTN} disabled={!paged.data || paged.data.page >= paged.data.pages - 1} onClick={() => setPage(page + 1)}>Next</button>
                <button type="button" className={QUIET} onClick={() => { setAll(false); setQ(""); setQNow(""); setPage(0); }}>Show fewer</button>
              </span>
            </>}
      </div>
    </section>
  );
}
