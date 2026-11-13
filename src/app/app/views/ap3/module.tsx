"use client";

import { hotkeyIgnored } from "@/lib/design/ui-logic";
import { SearchSelect } from "./search-select";
import { BookedAxis, DateAxis, MoreFilters, QuickFilters, ResultLine } from "./filters-bar";
import { Bookmark, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GoFn } from "../../nav";
import { ModuleTabs, Page } from "../../ds";
import "../speed6.css";
import "../speed-ui.css";
import "./ap3.css";
import { registerAbSlots } from "./ab-slots";
import { useData } from "../../session";
import { usePageRange } from "../../ds/page-range";
import type { Appt3Options } from "@/lib/analytics/appointments3-types";
import { AGE_OPTIONS, DEFAULT_FILTERS, FILTER_KEYS, filtersFromParams, filtersToParams, fixturesOn, queryOf, scopeOf, useAp, type ApFilters } from "./data";
import { FlowTree, type FlowPick } from "./flow-tree";
import { ApWorklist } from "./list";
import { ExportAll, TrendsPanel } from "./trends-panel";
import { ApPanel, PersonPanel } from "./parts";
import { BookingShare, Calendars, Health, Meetings, NeedsOutcome, Proof, Recovery, Sources } from "./sections2";
import { ExecTab } from "./exec/exec-tab";
import { BfTab, type BfFlags } from "../bf/bf-tab";
import { AppointmentsView } from "../appointments";
import { AppointmentInsights } from "../appointment-insights";
import { execScopeOf } from "./exec/exec-types";
import { takeDeepLink } from "@/lib/design/deep-link";
import { Overview, type DrillReq, type SectionProps } from "./sections";
import type { ApFlowTree, ApHealthRow, ApPersonRow, ApRow } from "./types";

// Appointments as a module with sub-sections (the Speed to lead pattern): Overview | Needs outcome | No-show recovery | Booking share | Flow tree | Cross-account health | Sources and
// speed | Calendars and conflicts | Reminders | Meetings | Proof. One filter bar, one right-side panel, saved views and keys. SubSync never changes an appointment from here;
// edits go through slice AB's checked gateway tools, which mount into the panel slots.

registerAbSlots(); // slice AB: the checked change tools and the Meetings area mount into the slots below

type TabKey = "overview" | "needs" | "recover" | "share" | "flow" | "health" | "sources" | "calendars" | "meetings" | "proof" | "exec" | "classic" | "insights" | "funnel";
const TABS: Array<{ key: TabKey; label: string; tip: string }> = [
  { key: "overview", label: "Overview", tip: "The one sentence, the numbers and where the leak is." }, { key: "needs", label: "Needs outcome", tip: "Past appointments nobody marked." },
  { key: "recover", label: "No-show recovery", tip: "No-shows not booked again." }, { key: "share", label: "Booking share", tip: "Who books and who takes the meeting." },
  { key: "flow", label: "Flow tree", tip: "How appointments flow through your people." }, { key: "health", label: "Account health", tip: "Every client account, worst first." },
  { key: "sources", label: "Sources and speed", tip: "Show rate by source and reply speed." }, { key: "calendars", label: "Calendars and people", tip: "Double bookings, quiet calendars and who takes the meetings." },
  { key: "meetings", label: "Meetings", tip: "Recorded meetings matched to appointments." },
  { key: "proof", label: "Proof", tip: "The weekly receipt per client." },
  { key: "exec", label: "Leadership", tip: "Pace, leaks, who converts and what to fix this week." },
  // Restored from the earlier Appointments (a revamp adds, never removes): the true show rate card with copy, print and call-list shortcuts, and the Insights widgets.
  { key: "classic", label: "Show rate and lists", tip: "The earlier page: true show rate, outcome chart, target, copy a summary and print." },
  { key: "insights", label: "Insights", tip: "Best times to book, repeat no-shows, lead to customer funnel, what an appointment is worth, follow-up gaps and more." },
  { key: "funnel", label: "Booking funnel", tip: "From new lead to booked, showed up and won: where leads stop." },
];
type SavedView = { name: string; filters: ApFilters; tab: TabKey };
const VIEWS_KEY = "ap3.views.v1";
const readViews = (): SavedView[] => { try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; } };
const writeViews = (v: SavedView[]) => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* private mode: the view simply is not kept */ } };

/** What a number opened: the filters that make its list (each one a removable chip), a plain name for each, and the count it promised (null once a chip is removed: the list's own count is then the only one). */
type Drill = { tab: TabKey; title: string; count: number | null; extra: Record<string, string | number | undefined>; labels: Record<string, string> } | null;

const SORT_WORDS: Array<[NonNullable<ApFilters["sort"]>, string]> = [["value", "Biggest deal first"], ["oldest", "Oldest first"], ["newest", "Newest first"], ["name", "Name A to Z"]];
const STATUS_WORDS: Array<[NonNullable<ApFilters["status"]>, string]> = [["new", "New (not confirmed)"], ["confirmed", "Confirmed"], ["booked", "Booked"]];
const OUTCOME_WORDS: Record<string, string> = { booked: "All booked", showed: "Showed", noshow: "No-show", unmarked: "No outcome yet", won: "Won", lost: "Lost", recovered: "Won back", at_risk: "Deal money at risk", cancelled: "Cancelled", open: "Deal open", no_deal: "No deal linked", upcoming: "Coming up", invalid: "Invalid", completed: "Completed" };
const day = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const isDefault = (f: ApFilters) => (Object.keys(DEFAULT_FILTERS) as Array<keyof ApFilters>).every((k) => f[k] === DEFAULT_FILTERS[k]);

export function AppointmentsModule({ go, flowTree = true, leadership = false, funnel = null }: { go: GoFn; flowTree?: boolean; leadership?: boolean; funnel?: BfFlags | null }) {
  const tabs = useMemo(() => TABS.filter((t) => (flowTree || t.key !== "flow") && (leadership || t.key !== "exec") && (funnel !== null || t.key !== "funnel")), [flowTree, leadership, funnel]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<ApFilters>(DEFAULT_FILTERS);
  const [q, setQ] = useState("");
  const [row, setRow] = useState<ApRow | null>(null);
  const [person, setPerson] = useState<ApPersonRow | null>(null);
  const [drill, setDrill] = useState<Drill>(null);
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [version, setVersion] = useState(0);
  const [arrival, setArrival] = useState<{ tab: string; expect: number | null; what: string; days: number } | null>(null);
  const arrived = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const health = useAp<{ rows: ApHealthRow[] }>("health", { ...filters, locationId: "" });
  // The filters live in the address, so a view can be shared and survives a reload.
  // The date bar at the top of the app is the date for every number here: this screen starts from it and re-reads it whenever it changes. The screen's own "Appointment date"
  // choice (for example "Next 7 days", which the bar cannot express) is a labelled override that lasts until the bar changes again (see the note under the filters).
  const bar = usePageRange();
  const urlOwns = useRef(false);
  // A click from a Today number opens the exact section and dates that reproduce its count (see deep-link.ts); it wins over an old address.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (arrived.current) return;
    const dl = takeDeepLink("appointments");
    if (!dl) return;
    arrived.current = true; urlOwns.current = true;
    setFilters({ ...DEFAULT_FILTERS, days: dl.days ?? 30, locationId: dl.location ?? "" }); setQ("");
    if (tabs.some((t) => t.key === dl.tab)) setTab(dl.tab as TabKey);
    setArrival({ tab: dl.tab, expect: dl.expect ?? null, what: dl.what ?? "Today", days: dl.days ?? 30 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */
  // The filters live in the address, so a view can be shared and survives a reload.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setViews(readViews()); if (arrived.current) return; const f = filtersFromParams(new URLSearchParams(window.location.search)); if (!isDefault(f)) { urlOwns.current = true; setFilters(f); setQ(f.q); } }, []);
  useEffect(() => {
    if (!bar.ready) return;
    if (urlOwns.current) { urlOwns.current = false; return; }
    const p = bar.spec.preset, days = p === "7d" ? 7 : p === "30d" ? 30 : p === "90d" ? 90 : 0, compare = bar.spec.compare !== "none";
    setFilters((f) => {
      const next = days ? { ...f, days: days as ApFilters["days"], from: "", to: "", compare } : { ...f, from: bar.from, to: bar.to, compare };
      return next.days === f.days && next.from === f.from && next.to === f.to && next.compare === f.compare ? f : next;
    });
  }, [bar.key, bar.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = scopeOf(filters);
  const barDays = bar.spec.preset === "7d" ? 7 : bar.spec.preset === "30d" ? 30 : bar.spec.preset === "90d" ? 90 : 0;
  // A preset (7, 30 or 90 days) that matches the bar is not an override, even when the two count the first day a few hours apart.
  const overridden = bar.ready && (filters.from && filters.to ? filters.from !== bar.from || filters.to !== bar.to : filters.days !== barDays);
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      for (const k of FILTER_KEYS) u.searchParams.delete(k);
      for (const [k, v] of Object.entries(filtersToParams(filters))) u.searchParams.set(k, v);
      if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u.href);
    } catch { /* an address that cannot be changed simply is not updated */ }
  }, [filters]);
  // Pickers are read from the data (never listed in code), narrowed by the chosen account, so a new calendar, person or source appears on its own.
  const optKey = queryOf("options" as never, { ...filters, calendarId: "", userId: "", source: "", q: "" });
  const opts = useData<Appt3Options>(fixturesOn() ? null : optKey);
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q })), 300); return () => clearTimeout(t); }, [q]);

  const index = tabs.findIndex((t) => t.key === tab);
  const isList = tab === "needs" || tab === "recover";
  const embedded = tab === "classic" || tab === "insights"; // the restored earlier pages bring their own dates and filters
  const filtered = !isDefault(filters) || q !== "";
  // A number that opens a section starts that section's list without its own narrowing filters (owner, booker, status, age), so the number and the rows agree.
  const goTab = useCallback((k: string, f?: string) => {
    setFilters((cur) => (cur.booker || cur.owner || cur.status || cur.age ? { ...cur, booker: "", owner: "", status: "", age: 0 } : cur));
    setDrill(null); setFocus(f); setTab(k as TabKey);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);
  const clear = useCallback(() => { setFilters(DEFAULT_FILTERS); setQ(""); }, []);
  const widen = useCallback(() => setFilters((f) => ({ ...f, days: 90, from: "", to: "" })), []);
  const openRow = useCallback((r: ApRow) => setRow(r), []);
  const showAccount = !filters.locationId && (health.data?.rows?.length ?? 2) > 1;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (hotkeyIgnored(e) || document.querySelector("[data-testid=lead-drawer-root]")) return;
      if (e.key === "/") { e.preventDefault(); search.current?.focus(); }
      else if (/^[1-9]$/.test(e.key) && tabs[Number(e.key) - 1]) { setFocus(undefined); setTab(tabs[Number(e.key) - 1].key); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [tabs]);

  const openDrill = (d: DrillReq) => { setDrill({ tab, title: d.title, count: d.count, extra: d.extra, labels: d.labels ?? {} }); setTimeout(() => document.getElementById("ap-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); };
  const sp: SectionProps = { filters, onOpen: openRow, activeId: row?.id ?? null, showAccount, go: goTab, onDrill: openDrill, openView: (id) => go(id as never), clear, widen, filtered, focus, arrival: arrival && arrival.tab === tab && arrival.days === filters.days && !filters.from ? arrival : null };
  const accounts = Array.isArray(health.data?.rows) ? health.data.rows : [];
  const saveView = (name: string) => { const next = [{ name: name.trim().slice(0, 40), filters, tab }, ...views.filter((v) => v.name !== name.trim())].slice(0, 20); setViews(next); writeViews(next); setNaming(false); };
  const applyView = (i: number) => { const v = views[i]; if (!v) return; const f = { ...DEFAULT_FILTERS, ...v.filters }; setFilters(f); setQ(f.q); if (tabs.some((t) => t.key === v.tab)) { setFocus(undefined); setTab(v.tab); } };
  const onPick = (p: FlowPick) => openDrill({ title: p.title, count: p.count, extra: { booker: p.params.booker, owner: p.params.owner, outcome: p.params.outcome, expect: p.count } });

  const panel = row ? <ApPanel row={row} onClose={() => setRow(null)} onChanged={() => setVersion((v) => v + 1)} filters={filters} /> : null;
  const content = (() => {
    switch (tab) {
      case "overview": return <Overview {...sp} />;
      case "needs": return <NeedsOutcome {...sp} />;
      case "recover": return <Recovery {...sp} />;
      case "share": return <><BookingShare {...sp} onPerson={setPerson} /><TrendsPanel filters={filters} by="person" onOpen={(title, count, extra) => openDrill({ title, count, extra })} /><p className="mt-2 text-right"><ExportAll filters={filters} /></p></>;
      case "flow": return <><FlowTree filters={filters} onOpen={onPick} go={(t) => go(t as never)} /></>;
      case "health": return <><Health {...sp} onAccount={(r) => openDrill({ title: `${r.name}, all appointments`, count: r.booked, extra: { location: r.locationId, outcome: "booked", expect: r.booked }, labels: { location: r.name } })} /></>;
      case "sources": return <Sources {...sp} />;
      case "calendars": return <><Calendars {...sp} /><TrendsPanel filters={filters} by="calendar" onOpen={(title, count, extra) => openDrill({ title, count, extra })} /></>;
      case "meetings": return <Meetings {...sp} />;
      case "proof": return <Proof {...sp} />;
      case "classic": return <div className="[&_[data-testid=page-subtitle]]:hidden [&_h1]:sr-only"><AppointmentsView go={go} /></div>;
      case "insights": return <div className="[&_[data-testid=page-subtitle]]:hidden [&_h1]:sr-only"><AppointmentInsights /></div>;
      case "exec": return <ExecTab scope={execScopeOf(filters)} onOpenRow={openRow} />;
      case "funnel": return funnel ? <BfTab scope={execScopeOf(filters)} people={(opts.data?.people ?? []).map((p) => ({ value: p.userId, label: p.name }))} accounts={accounts.map((a) => ({ value: a.locationId, label: a.name }))} sources={opts.data?.sources ?? []} flags={funnel} /> : null;
    }
  })();
  const people = opts.data?.people ?? [];
  // Every calendar and person is searchable (accounts can have 50+ users and many calendars); a calendar with no bookings is listed too.
  const showAcct = !filters.locationId && accounts.length > 1;
  const groupOptions = (opts.data?.groups ?? []).map((g) => ({ value: g.groupId, label: g.name, hint: showAcct ? accounts.find((x) => x.locationId === g.locationId)?.name : undefined }));
  const calOptions = (opts.data?.calendars ?? []).filter((c) => (!filters.groupId || c.groupId === filters.groupId) && (!filters.active || (filters.active === "active") === (c.active !== false)))
    .map((c) => ({ value: c.calendarId, label: c.name ?? "Calendar", hint: [c.active === false ? "inactive" : "", showAcct ? accounts.find((x) => x.locationId === c.locationId)?.name ?? "" : ""].filter(Boolean).join(", ") || undefined }));
  const peopleOptions = people.map((p) => ({ value: p.userId, label: p.name, hint: p.inTeamList ? undefined : "not in the team list" }));
  const set = (p: Partial<ApFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="s6 ap ap3 ds-enter" ref={top} data-testid="ap-module" key={version}>
      <Page title="Appointments" subtitle="Who booked, who showed, and who is burning your leads." actions={null}>
        <div className="ap-head" role="search" aria-label="Filter appointments" hidden={embedded}>
          <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search by name</span><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name (press /)" data-testid="ap-search" /></label>
          <DateAxis filters={filters} set={set} />
          {accounts.length > 1 && <SearchSelect label="Account" value={filters.locationId} anyLabel="All accounts" options={accounts.map((a) => ({ value: a.locationId, label: a.name }))} onChange={(v) => set({ locationId: v, calendarId: "", groupId: "", userId: "", booker: "", owner: "" })} testId="ap-account" />}
          {(opts.data?.groups?.length ?? 0) > 0 && <SearchSelect label="Calendar group" value={filters.groupId} anyLabel="All groups" options={groupOptions} onChange={(v) => set({ groupId: v, calendarId: "" })} testId="ap-group" />}
          {calOptions.length > 1 && <SearchSelect label="Calendar" value={filters.calendarId} anyLabel="All calendars" options={calOptions} onChange={(v) => set({ calendarId: v })} testId="ap-calendar" />}
          {(opts.data?.calendars ?? []).some((c) => c.active === false) && <select className="ap-field" aria-label="Active calendars" value={filters.active} onChange={(e) => set({ active: e.target.value as ApFilters["active"], calendarId: "" })} data-testid="ap-active"><option value="">Active and inactive</option><option value="active">Active only</option><option value="inactive">Inactive only</option></select>}
          {isList ? <>
            <SearchSelect label="Owner" value={filters.owner} anyLabel="Any owner" extra={[{ value: "none", label: "No owner" }]} options={peopleOptions} onChange={(v) => set({ owner: v })} testId="ap-owner" />
            <SearchSelect label="Booked by" value={filters.booker} anyLabel="Any booker" extra={[{ value: "none", label: "Booker not recorded" }]} options={peopleOptions} onChange={(v) => set({ booker: v })} testId="ap-booker" />
          </> : (people.length > 0 && <SearchSelect label="Person" value={filters.userId} anyLabel="Everyone" options={peopleOptions} onChange={(v) => set({ userId: v })} testId="ap-person" />)}
          <BookedAxis filters={filters} set={set} />
          {(opts.data?.sources?.length ?? 0) > 0 && <select className="ap-field" aria-label="Source" value={filters.source} onChange={(e) => set({ source: e.target.value })} data-testid="ap-source"><option value="">All sources</option>{opts.data!.sources.map((s) => <option key={s} value={s}>{s}</option>)}</select>}
          {isList && <>
            <select className="ap-field" aria-label="How long ago" value={filters.age} onChange={(e) => set({ age: Number(e.target.value) as ApFilters["age"] })} data-testid="ap-age"><option value={0}>Any age</option>{AGE_OPTIONS.map((n) => <option key={n} value={n}>{tab === "needs" ? `Over ${n} ${n === 1 ? "day" : "days"} overdue` : `Over ${n} ${n === 1 ? "day" : "days"} ago`}</option>)}</select>
            {tab === "needs" && <select className="ap-field" aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value as ApFilters["status"] })} data-testid="ap-status"><option value="">Any status</option>{STATUS_WORDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
            <select className="ap-field" aria-label="Sort" value={filters.sort || "value"} onChange={(e) => set({ sort: e.target.value as ApFilters["sort"] })} data-testid="ap-sort">{SORT_WORDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </>}
          <MoreFilters filters={filters} set={set} opts={opts.data ?? null} />
          <label className="ap-check"><input type="checkbox" checked={filters.compare} onChange={(e) => set({ compare: e.target.checked })} data-testid="ap-compare-period" />Compare with the period before</label>
          <select className="ap-field" aria-label="Saved views" value="" onChange={(e) => applyView(Number(e.target.value))} data-testid="ap-views"><option value="" disabled>Saved views{views.length ? ` (${views.length})` : ""}</option>{views.map((v, i) => <option key={v.name} value={i}>{v.name}</option>)}</select>
          {naming ? <NameView onSave={saveView} onCancel={() => setNaming(false)} /> : <button type="button" className="s6-btn" onClick={() => setNaming(true)} data-testid="ap-save-view"><Bookmark aria-hidden className="size-4" />Save view</button>}
          {filtered && <button type="button" className="s6-btn" onClick={clear} data-testid="ap-clear"><X aria-hidden className="size-4" />Clear filters</button>}
        </div>
        {!embedded && <><QuickFilters filters={filters} set={set} people={people} />
        <ResultLine filters={filters} /></>}
        {overridden && <p className="ap-fine mb-2" role="status" data-testid="ap-own-dates">Appointment date on this screen: {own.from} to {own.to}. That is your choice here, not the dates in the bar above ({bar.label}). <button type="button" className="min-h-9 underline" onClick={() => setFilters((f) => { const d = bar.spec.preset === "7d" ? 7 : bar.spec.preset === "30d" ? 30 : bar.spec.preset === "90d" ? 90 : 0; return { ...f, days: (d || 30) as ApFilters["days"], from: d ? "" : bar.from, to: d ? "" : bar.to }; })}>Use the dates above</button></p>}
        <FilterChips filters={filters} opts={opts.data ?? null} accounts={accounts} onChange={(f) => { setFilters(f); setQ(f.q); }} listTab={isList ? tab : null} />
        {fixturesOn() && <p className="ap-fine mb-2" role="status">Showing sample appointments (apfx).</p>}
        <ModuleTabs pill wrap label="Appointments sections" tabs={tabs.map((t) => ({ label: t.label, tip: t.tip, node: null }))} value={index < 0 ? 0 : index} onChange={(i) => { setFocus(undefined); setTab(tabs[i].key); }} />
        <div data-testid={`ap-tab-${tab}`}>{content}{drill && drill.tab === tab && <DrillList key={JSON.stringify(drill.extra)} drill={drill} sp={sp} onClose={() => setDrill(null)} onChange={(extra) => setDrill({ ...drill, extra, count: null })} />}</div>
        <p className="ap-fine mt-6">Keys: / search, 1 to 9 switch section, up and down move in a list, Enter opens, Esc closes. Nothing is ever deleted from a key.</p>
        {panel}
        {person && <PersonHost person={person} filters={filters} onClose={() => setPerson(null)} onOpenRows={() => { setPerson(null); openDrill({ title: `${person.name}, appointments`, count: person.bookings, extra: { booker: person.id, expect: person.bookings }, labels: { booker: person.name } }); }} />}
      </Page>
    </div>
  );
}

const Chipx = ({ k, v, label, onRemove }: { k: string; v: string; label: string; onRemove: () => void }) => (
  <span className="ap-chip" data-tone="cyan">{k}: {v}<button type="button" className="ap-chip-x" aria-label={label} onClick={onRemove}><X aria-hidden className="size-3" /></button></span>
);

/** The chosen filters as removable chips, so it is always clear what the numbers are for. */
function FilterChips({ filters, opts, accounts, onChange, listTab }: { filters: ApFilters; opts: Appt3Options | null; accounts: ApHealthRow[]; onChange: (f: ApFilters) => void; listTab: TabKey | null }) {
  const chips: Array<[string, string, Partial<ApFilters>]> = [];
  const who = (id: string) => (id === "none" ? "not recorded" : opts?.people.find((p) => p.userId === id)?.name ?? "Selected person");
  if (filters.locationId) chips.push(["Account", accounts.find((a) => a.locationId === filters.locationId)?.name ?? "Selected account", { locationId: "", calendarId: "", userId: "", booker: "", owner: "" }]);
  if (filters.calendarId) chips.push(["Calendar", opts?.calendars.find((c) => c.calendarId === filters.calendarId)?.name ?? "Selected calendar", { calendarId: "" }]);
  if (filters.userId) chips.push(["Person", who(filters.userId), { userId: "" }]);
  if (filters.groupId) chips.push(["Group", opts?.groups?.find((g) => g.groupId === filters.groupId)?.name ?? "Selected group", { groupId: "", calendarId: "" }]);
  if (filters.active) chips.push(["Calendars", filters.active === "active" ? "active only" : "inactive only", { active: "", calendarId: "" }]);
  if (filters.bookedFrom && filters.bookedTo) chips.push(["Booked", filters.bookedFrom === filters.bookedTo ? "today" : `${day(filters.bookedFrom)} to ${day(filters.bookedTo)}`, { bookedFrom: "", bookedTo: "" }]);
  if (filters.source) chips.push(["Source", filters.source, { source: "" }]);
  if (filters.outcome) chips.push(["Outcome", { showed: "showed", noshow: "no-show", noshow_open: "no-show, not booked again", cancelled: "cancelled", unmarked: "no outcome yet" }[filters.outcome], { outcome: "" }]);
  if (filters.status && !listTab) chips.push(["Booking status", filters.status === "new" ? "not confirmed" : filters.status, { status: "" }]);
  if (filters.deal) chips.push(["Deal", filters.deal === "has" ? "has a deal" : "no deal", { deal: "" }]);
  if (filters.stage) chips.push(["Deal stage", filters.stage, { stage: "" }]);
  if (filters.leadAge) chips.push(["Lead", filters.leadAge === "old" ? "older than 30 days" : `new in the last ${filters.leadAge} days`, { leadAge: "" }]);
  if (filters.contact) chips.push(["Contact", filters.contact === "new" ? "first appointment" : "has been before", { contact: "" }]);
  if (filters.attention) chips.push(["Needs attention", "on", { attention: false }]);
  if (filters.compare) chips.push(["Compare", "with the period before", { compare: false }]);
  if (filters.q) chips.push(["Search", filters.q, { q: "" }]);
  if (filters.from && filters.to) chips.push(["Dates", `${day(filters.from)} to ${day(filters.to)}`, { from: "", to: "" }]);
  else if (filters.days !== 30) chips.push(["Dates", `Last ${filters.days} days`, { days: 30 }]);
  if (listTab) {
    if (filters.owner) chips.push(["Owner", filters.owner === "none" ? "nobody" : who(filters.owner), { owner: "" }]);
    if (filters.booker) chips.push(["Booker", who(filters.booker), { booker: "" }]);
    if (filters.age) chips.push(["Age", `over ${filters.age} ${filters.age === 1 ? "day" : "days"} ${listTab === "needs" ? "overdue" : "ago"}`, { age: 0 }]);
    if (filters.status && listTab === "needs") chips.push(["Status", STATUS_WORDS.find(([v]) => v === filters.status)?.[1] ?? filters.status, { status: "" }]);
  }
  if (!chips.length) return null;
  return <div className="mb-2 flex flex-wrap items-center gap-2" aria-label="Chosen filters" data-testid="ap-chips">{chips.map(([k, v, clear]) => <Chipx key={k} k={k} v={v} label={`Remove the ${k.toLowerCase()} filter`} onRemove={() => onChange({ ...filters, ...clear })} />)}</div>;
}

/** The list a number opened: exactly the rows it counted, the filters that made it as removable chips, and the person in your CRM one press away on every row. */
function DrillList({ drill, sp, onClose, onChange }: { drill: NonNullable<Drill>; sp: SectionProps; onClose: () => void; onChange: (extra: NonNullable<Drill>["extra"]) => void }) {
  const [real, setReal] = useState<number | null>(null);
  const e = drill.extra;
  const chips: Array<{ key: string; k: string; v: string; drop: string[] }> = [];
  const val = (key: string, fallback: string) => drill.labels[key] ?? (e[key] === "none" ? "not recorded" : fallback);
  if (e.location) chips.push({ key: "location", k: "Account", v: val("location", "this account"), drop: ["location"] });
  if (e.calendar) chips.push({ key: "calendar", k: "Calendar", v: val("calendar", "this calendar"), drop: ["calendar"] });
  if (e.booker !== undefined && e.booker !== "") chips.push({ key: "booker", k: "Booker", v: val("booker", "selected person"), drop: ["booker"] });
  if (e.owner !== undefined && e.owner !== "") chips.push({ key: "owner", k: "Owner", v: val("owner", "selected person"), drop: ["owner"] });
  if (e.source) chips.push({ key: "source", k: "Source", v: String(e.source), drop: ["source"] });
  if (e.from && e.to) chips.push({ key: "dates", k: "Dates", v: `${day(String(e.from))} to ${day(String(e.to))}`, drop: ["from", "to"] });
  if (e.outcome) chips.push({ key: "outcome", k: "Showing", v: OUTCOME_WORDS[String(e.outcome)] ?? String(e.outcome), drop: ["outcome"] });
  const drop = (keys: string[]) => { const n = { ...e }; for (const k of keys) delete n[k]; delete n.expect; onChange(n); };
  const shown = real ?? drill.count;
  return (
    <div id="ap-drill" className="mt-5" data-testid="ap-drill">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold" data-testid="ap-drill-title">{drill.title}</h3><span className="ap-chip" data-tone="cyan" data-testid="ap-drill-count">{shown === null ? "..." : shown.toLocaleString("en-US")}</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close list</button></div>
      {chips.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2" aria-label="What this list shows" data-testid="ap-drill-chips">{chips.map((c) => <Chipx key={c.key} k={c.k} v={c.v} label={`Remove the ${c.k.toLowerCase()} filter from this list`} onRemove={() => drop(c.drop)} />)}</div>}
      <ApWorklist part="list" filters={sp.filters} extra={e} onOpen={sp.onOpen} activeId={sp.activeId} showAccount={sp.showAccount} testId="ap-drill-list" onRows={(_, t) => setReal(t)} empty="Nothing behind this one in these dates." onClear={sp.filtered ? sp.clear : undefined} />
    </div>
  );
}
function PersonHost({ person, filters, onClose, onOpenRows }: { person: ApPersonRow; filters: ApFilters; onClose: () => void; onOpenRows: () => void }) {
  const t = useAp<ApFlowTree>("flow-tree", filters);
  return <PersonPanel person={person} overall={t.data?.overall ?? { showRate: null, noShowRate: null, closeRate: null }} onClose={onClose} onOpenRows={onOpenRows} />;
}
function NameView({ onSave, onCancel }: { onSave: (n: string) => void; onCancel: () => void }) {
  const [n, setN] = useState("");
  return (
    <form className="inline-flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (n.trim()) onSave(n); }}>
      <input className="ap-field" autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="Name this view" maxLength={40} aria-label="Name this view" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} />
      <button type="submit" className="s6-btn" data-kind="primary" disabled={!n.trim()}>Save</button>
    </form>
  );
}
