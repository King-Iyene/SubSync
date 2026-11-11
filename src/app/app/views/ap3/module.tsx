"use client";

import { Bookmark, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GoFn } from "../../nav";
import { ModuleTabs, Page } from "../../ds";
import "../speed6.css";
import "../speed-ui.css";
import "./ap3.css";
import { registerAbSlots } from "./ab-slots";
import { DEFAULT_FILTERS, fixturesOn, useAp, type ApFilters } from "./data";
import { FlowTree, type FlowPick } from "./flow-tree";
import { ApPanel, ApRowsList, PersonPanel } from "./parts";
import { BookingShare, Calendars, Health, Meetings, NeedsOutcome, Proof, Recovery, Reminders, Sources } from "./sections2";
import { Overview, type DrillReq, type SectionProps } from "./sections";
import type { ApFlowTree, ApHealthRow, ApPersonRow, ApRow } from "./types";

// Appointments as a module with sub-sections (the Speed to lead pattern): Overview | Needs outcome | No-show recovery | Booking share | Flow tree | Cross-account health | Sources and
// speed | Calendars and conflicts | Reminders | Meetings | Proof. One filter bar, one right-side panel, saved views and keys. SubSync never changes an appointment from here;
// edits go through slice AB's checked gateway tools, which mount into the panel slots.

registerAbSlots(); // slice AB: the checked change tools and the Meetings area mount into the slots below

type TabKey = "overview" | "needs" | "recover" | "share" | "flow" | "health" | "sources" | "calendars" | "reminders" | "meetings" | "proof";
const TABS: Array<{ key: TabKey; label: string; tip: string }> = [
  { key: "overview", label: "Overview", tip: "The one sentence, the numbers and where the leak is." }, { key: "needs", label: "Needs outcome", tip: "Past appointments nobody marked." },
  { key: "recover", label: "No-show recovery", tip: "No-shows not booked again." }, { key: "share", label: "Booking share", tip: "Who books and who takes the meeting." },
  { key: "flow", label: "Flow tree", tip: "How appointments flow through your people." }, { key: "health", label: "Account health", tip: "Every client account, worst first." },
  { key: "sources", label: "Sources and speed", tip: "Show rate by source and reply speed." }, { key: "calendars", label: "Calendars", tip: "Double bookings and calendars that stopped syncing." },
  { key: "reminders", label: "Reminders", tip: "Who may not show, from reminders and confirmation." }, { key: "meetings", label: "Meetings", tip: "Recorded meetings matched to appointments." },
  { key: "proof", label: "Proof", tip: "The weekly receipt per client." },
];
type SavedView = { name: string; filters: ApFilters; tab: TabKey };
const VIEWS_KEY = "ap3.views.v1";
const readViews = (): SavedView[] => { try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; } };
const writeViews = (v: SavedView[]) => { try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* private mode: the view simply is not kept */ } };

type Drill = { tab?: TabKey; title: string; count: number; extra: Record<string, string | number | undefined> } | null;

export function AppointmentsModule({ go, flowTree = true }: { go: GoFn; flowTree?: boolean }) {
  const tabs = useMemo(() => TABS.filter((t) => flowTree || t.key !== "flow"), [flowTree]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<ApFilters>(DEFAULT_FILTERS);
  const [q, setQ] = useState("");
  const [row, setRow] = useState<ApRow | null>(null);
  const [person, setPerson] = useState<ApPersonRow | null>(null);
  const [drill, setDrill] = useState<Drill>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [version, setVersion] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const health = useAp<{ rows: ApHealthRow[] }>("health", { ...filters, locationId: "" });
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setViews(readViews()); }, []);
  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.q === q ? f : { ...f, q })), 300); return () => clearTimeout(t); }, [q]);

  const index = tabs.findIndex((t) => t.key === tab);
  const goTab = useCallback((k: string) => { setTab(k as TabKey); top.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, []);
  const openRow = useCallback((r: ApRow) => setRow(r), []);
  const showAccount = !filters.locationId && (health.data?.rows?.length ?? 2) > 1;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); search.current?.focus(); }
      else if (/^[1-9]$/.test(e.key) && tabs[Number(e.key) - 1]) setTab(tabs[Number(e.key) - 1].key);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [tabs]);

  const sp: SectionProps = { filters, onOpen: openRow, activeId: row?.id ?? null, showAccount, go: goTab, onDrill: (d: DrillReq) => openDrill(d) };
  const accounts = Array.isArray(health.data?.rows) ? health.data.rows : [];
  const saveView = (name: string) => { const next = [{ name: name.trim().slice(0, 40), filters, tab }, ...views.filter((v) => v.name !== name.trim())].slice(0, 20); setViews(next); writeViews(next); setNaming(false); };
  const applyView = (i: number) => { const v = views[i]; if (!v) return; setFilters(v.filters); setQ(v.filters.q); if (tabs.some((t) => t.key === v.tab)) setTab(v.tab); };
  const openDrill = (d: Omit<NonNullable<Drill>, "tab">) => { setDrill({ ...d, tab }); setTimeout(() => document.getElementById("ap-drill")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); };
  const onPick = (p: FlowPick) => openDrill({ title: p.title, count: p.count, extra: { booker: p.params.booker, owner: p.params.owner, outcome: p.params.outcome, expect: p.count } });

  const panel = row ? <ApPanel row={row} onClose={() => setRow(null)} onChanged={() => setVersion((v) => v + 1)} filters={filters} /> : null;
  const content = (() => {
    switch (tab) {
      case "overview": return <Overview {...sp} />;
      case "needs": return <NeedsOutcome {...sp} />;
      case "recover": return <Recovery {...sp} />;
      case "share": return <BookingShare {...sp} onPerson={setPerson} />;
      case "flow": return <><FlowTree filters={filters} onOpen={onPick} go={(t) => go(t as never)} /></>;
      case "health": return <><Health {...sp} onAccount={(r) => openDrill({ title: `${r.name}, all appointments`, count: r.booked, extra: { location: r.locationId, outcome: "booked", expect: r.booked } })} /></>;
      case "sources": return <Sources {...sp} />;
      case "calendars": return <Calendars {...sp} />;
      case "reminders": return <Reminders {...sp} />;
      case "meetings": return <Meetings {...sp} />;
      case "proof": return <Proof {...sp} />;
    }
  })();

  return (
    <div className="s6 ap ds-enter" ref={top} data-testid="ap-module" key={version}>
      <Page title="Appointments" subtitle="Who booked, who showed, and who is burning your leads." actions={null}>
        <div className="ap-head" role="search" aria-label="Filter appointments">
          <label className="ap-search"><Search aria-hidden className="size-4" /><span className="sr-only">Search by name</span><input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name (press /)" data-testid="ap-search" /></label>
          <select className="ap-field" aria-label="Dates" value={filters.days} onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) as ApFilters["days"] })} data-testid="ap-days"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
          {accounts.length > 1 && <select className="ap-field" aria-label="Account" value={filters.locationId} onChange={(e) => setFilters({ ...filters, locationId: e.target.value })} data-testid="ap-account"><option value="">All accounts</option>{accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
          <select className="ap-field" aria-label="Saved views" value="" onChange={(e) => applyView(Number(e.target.value))} data-testid="ap-views"><option value="" disabled>Saved views{views.length ? ` (${views.length})` : ""}</option>{views.map((v, i) => <option key={v.name} value={i}>{v.name}</option>)}</select>
          {naming ? <NameView onSave={saveView} onCancel={() => setNaming(false)} /> : <button type="button" className="s6-btn" onClick={() => setNaming(true)} data-testid="ap-save-view"><Bookmark aria-hidden className="size-4" />Save view</button>}
          {(filters.locationId || filters.q) && <button type="button" className="s6-btn" onClick={() => { setFilters(DEFAULT_FILTERS); setQ(""); }}><X aria-hidden className="size-4" />Clear</button>}
        </div>
        {fixturesOn() && <p className="ap-fine mb-2" role="status">Showing sample appointments (apfx).</p>}
        <ModuleTabs pill label="Appointments sections" tabs={tabs.map((t) => ({ label: t.label, tip: t.tip, node: null }))} value={index < 0 ? 0 : index} onChange={(i) => setTab(tabs[i].key)} />
        <div data-testid={`ap-tab-${tab}`}>{content}{drill && drill.tab === tab && <DrillList drill={drill} sp={sp} onClose={() => setDrill(null)} />}</div>
        <p className="ap-fine mt-6">Keys: / search, 1 to 9 switch section, up and down move in a list, Enter opens, Esc closes. Nothing is ever deleted from a key.</p>
        {panel}
        {person && <PersonHost person={person} filters={filters} onClose={() => setPerson(null)} onOpenRows={() => { setPerson(null); openDrill({ title: `${person.name}, appointments`, count: person.bookings, extra: { booker: person.id, expect: person.bookings } }); }} />}
      </Page>
    </div>
  );
}

function DrillList({ drill, sp, onClose }: { drill: NonNullable<Drill>; sp: SectionProps; onClose: () => void }) {
  const [real, setReal] = useState<number | null>(null);
  return (
    <div id="ap-drill" className="mt-5" data-testid="ap-drill">
      <div className="mb-2 flex flex-wrap items-center gap-3"><h3 className="text-base font-semibold" data-testid="ap-drill-title">{drill.title}</h3><span className="ap-chip" data-tone="cyan" data-testid="ap-drill-count">{(real ?? drill.count).toLocaleString("en-US")}</span><button type="button" className="ap-link ml-auto" onClick={onClose}>Close list</button></div>
      <ApRowsList part="list" filters={sp.filters} extra={drill.extra} onOpen={sp.onOpen} activeId={sp.activeId} showAccount={sp.showAccount} testId="ap-drill-list" onRows={(_, t) => setReal(t)} empty="Nothing behind this one in these dates." />
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
