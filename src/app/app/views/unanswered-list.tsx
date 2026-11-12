"use client";

import { hotkeyIgnored } from "@/lib/design/ui-logic";
import { Check, ChevronDown, Filter, Keyboard, Link2, Search, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApiClient, useData } from "../session";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { DEFAULT_CHOICES, isNarrowed, listPath, shareLink, useNewKeys, type Choices } from "./unanswered-state";
import { PersonList, useDensity } from "./unanswered-person";
import { DENSITIES } from "@/lib/design/list-density";
import { Slot, hasUnansweredAction, runUnansweredAction, useRoom, type UiRow } from "./unanswered-slots";
import { usePersonActions } from "./unanswered-rows";

// The people behind a number, as one list that is searched, filtered, sorted and paged on the DATABASE (inbox?part=list2): a page of 20, 50 or 100, an exact total, chips whose
// numbers are their own lists. Two tabs: waiting for us, and waiting on them (we wrote last and the person went quiet). Saved views, a link to the list as it is, keys for setters
// (j and k move, o opens, c claims, s snoozes, x ticks, / searches) and a floating bar for several people at once. Each part is behind its own flag and absent when off.

export type Facets = {
  buckets: Record<"all" | "h1" | "h4" | "h24" | "h48", number>; owner: { all: number; none: number; mine: number; mineFree: number };
  channels: Array<{ key: string; label: string; count: number }>; snooze: boolean;
};
type ListData = { total: number; page: number; pages: number; from: number; to: number; rows: UiRow[]; facets: Facets & { lead: { all: number; new: number; existing: number } | null }; tabs: { us: number; them: number } | null };
type View = { id: string; name: string; filters: Partial<Choices> };
export type AccountChoice = { id: string; name: string };
export type OwnerChoice = { key: string; label: string };

const BUCKET_LABELS: Array<{ key: "h1" | "h4" | "h24" | "h48"; label: string }> = [{ key: "h1", label: "Under 4 hours" }, { key: "h4", label: "4 to 24 hours" }, { key: "h24", label: "1 to 2 days" }, { key: "h48", label: "2 days or more" }];
const field = "ur-field";
const chip = (on: boolean) => `ur-chipbtn ${on ? "is-on" : ""}`;
const n = (v: number) => v.toLocaleString("en-US");

export function UnansweredList({ choices, set, page, setPage, reset, multi, accounts, owners, slaHours, headingRef, onTabs, onRows, segments = false }: {
  choices: Choices; set: (patch: Partial<Choices>) => void; page: number; setPage: (p: number) => void; reset: () => void;
  multi: boolean; accounts: AccountChoice[]; owners: OwnerChoice[]; slaHours: number; headingRef: React.RefObject<HTMLHeadingElement | null>;
  onTabs: (t: { us: number; them: number } | null) => void; onRows: (rows: UiRow[]) => void;
  /** The Everyone | New leads | Existing customers switch (inside Speed to lead). Off: the list is exactly as before. */
  segments?: boolean;
}) {
  const room = useRoom();
  const { flags, seePeople } = room;
  const { data, error, loading, reload } = useData<ListData>(listPath(choices, page, segments));
  const [density, setDensity] = useDensity();
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const actions = usePersonActions(rows, flags.inbox_breach_alert === true);
  const fresh = useNewKeys(rows.map((r) => r.key));
  const [text, setText] = useState(choices.q);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const keysOn = flags.inbox_keys === true;
  const filtersOn = flags.inbox_filters === true;
  const bulkOn = flags.inbox_bulk === true;

  useEffect(() => { if (data?.tabs !== undefined) onTabs(data.tabs); }, [data?.tabs, onTabs]);
  useEffect(() => { onRows(rows); }, [rows, onRows]);
  // the typed search commits after a pause; a view or a link that sets the search fills the box
  const [seenQ, setSeenQ] = useState(choices.q);
  if (seenQ !== choices.q) { setSeenQ(choices.q); setText(choices.q); }
  useEffect(() => {
    if (text.trim() === choices.q) return;
    const t = setTimeout(() => set({ q: text.trim() }), 300);
    return () => clearTimeout(t);
  }, [text, choices.q, set]);
  // a live list: read again every minute while the page is in front and no panel is open
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible" && !document.querySelector("[role=dialog]")) reload(); }, 60_000);
    return () => clearInterval(id);
  }, [reload]);
  // a new page or new choices start with no cursor and nobody ticked
  const resetKey = `${data?.page ?? 0}|${JSON.stringify(choices)}`;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) { setSeenKey(resetKey); setCursor(null); setSelected((p) => (p ? new Set() : p)); }

  const said = (t: string) => { setNote(t); setTimeout(() => setNote((p) => (p === t ? null : p)), 3500); };
  const moveTo = (i: number) => { setCursor(i); document.querySelector(`[data-testid=wait-list-rows] > li:nth-child(${i + 1})`)?.scrollIntoView({ block: "nearest" }); };

  const toggle = (key: string) => setSelected((s) => { const next = new Set(s ?? []); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  // ---- keys for setters ----
  useEffect(() => {
    if (!keysOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (hotkeyIgnored(e)) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return; // the panel and menus keep their own keys
      const k = e.key.toLowerCase();
      const last = rows.length - 1;
      const row = cursor !== null ? rows[cursor] : undefined;
      if (k === "j" && last >= 0) { e.preventDefault(); moveTo(Math.min(last, (cursor ?? -1) + 1)); }
      else if (k === "k" && last >= 0) { e.preventDefault(); moveTo(Math.max(0, (cursor ?? 1) - 1)); }
      else if ((k === "o" || k === "enter") && row?.contactId) { e.preventDefault(); actions.show(row); }
      else if (k === "/") { e.preventDefault(); search.current?.focus(); }
      else if (k === "x" && bulkOn && row) { e.preventDefault(); toggle(row.key); }
      else if ((k === "c" || k === "s") && row) {
        e.preventDefault();
        const name = k === "c" ? "claim" : "snooze";
        if (!runUnansweredAction(name, row)) { said(`${k === "c" ? "Claiming" : "Snoozing"} is not available yet.`); return; }
        said(`${k === "c" ? "Claim" : "Set aside"}: check the details for ${row.name} and confirm.`); // the action opens its own preview first; nothing changes until it is confirmed
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const picked = rows.filter((r) => selected?.has(r.key));
  const copyLink = async () => { try { await navigator.clipboard.writeText(shareLink(choices)); setCopied(true); setTimeout(() => setCopied(false), 2200); } catch { window.prompt("Copy this link", shareLink(choices)); } };
  const narrowed = isNarrowed(choices);
  const f = data?.facets;
  const f2 = data?.facets;
  const tabName = choices.tab === "us" ? "waiting for a reply" : "gone quiet";

  return (
    <div data-testid="wait-list" aria-busy={loading}>
      <div className="ur-bar" role="group" aria-label="Search and filter this list">
        <label className="ur-search">
          <Search aria-hidden className="size-4" />
          <input ref={search} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search name, phone, email or client" aria-label="Search this list" className="ur-search-in" data-testid="wait-list-search" />
        </label>
        {filtersOn && f2 && (
          <div className="ur-quick" role="group" aria-label="Quick choices" data-testid="quick-chips">
            <button type="button" className={chip(choices.owner === null)} aria-pressed={choices.owner === null} onClick={() => set({ owner: null })} data-testid="chip-everyone">Everyone <b className="tnum">{n(f2.owner.all)}</b></button>
            <button type="button" className={chip(choices.owner === "none")} aria-pressed={choices.owner === "none"} disabled={f2.owner.none === 0 && choices.owner !== "none"} onClick={() => set({ owner: "none" })} data-testid="chip-none" data-tip="Nobody is assigned to these people in your CRM">No owner <b className="tnum">{n(f2.owner.none)}</b></button>
            {room.me && <button type="button" className={chip(choices.owner === "me")} aria-pressed={choices.owner === "me"} disabled={f2.owner.mine === 0 && choices.owner !== "me"} onClick={() => set({ owner: "me" })} data-testid="chip-mine">Mine <b className="tnum">{n(f2.owner.mine)}</b></button>}
          </div>
        )}
        {filtersOn && <button type="button" className="s6-btn ur-filterbtn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} data-testid="filters-toggle"><Filter aria-hidden className="size-4" />More filters{narrowed ? <span className="ur-dot" aria-label="Filters on" /> : null}</button>}
        {flags.inbox_views === true && <ViewsMenu choices={choices} apply={(c) => set({ ...DEFAULT_CHOICES, ...c })} />}
        <div className="ur-density" role="group" aria-label="Row density" data-testid="density">
          {DENSITIES.map((d) => <button key={d} type="button" aria-pressed={density === d} onClick={() => setDensity(d)} data-testid={`density-${d}`} data-tip={d === "compact" ? "One line per person: more people on the screen." : "Two lines per person."}>{d === "compact" ? "Compact" : "Comfortable"}</button>)}
        </div>
        <select value={choices.sort} onChange={(e) => set({ sort: e.target.value as Choices["sort"] })} aria-label="Sort this list" className={field} data-testid="wait-list-sort">
          <option value="wait">{choices.tab === "them" ? "Newest first" : "Longest wait first"}</option>
          <option value="newest">{choices.tab === "them" ? "Longest quiet first" : "Newest first"}</option>
          <option value="name">Name</option>
          {multi && <option value="account">Client account</option>}
          <option value="value">Biggest deal first</option>
        </select>
        {filtersOn && <button type="button" className="s6-btn ur-iconbtn" onClick={() => void copyLink()} data-tip="Copy a link to this exact list" aria-label="Copy a link to this list" data-testid="share-link">{copied ? <Check aria-hidden className="size-4" /> : <Link2 aria-hidden className="size-4" />}</button>}
        {keysOn && <span className="ur-keys s6-label" data-tip="Keys: j and k move, o opens, c claims, s snoozes, x ticks, / searches" tabIndex={0} role="img" aria-label="Keyboard shortcuts: j and k move, o opens, c claims, s snoozes, x ticks, slash searches"><Keyboard aria-hidden className="size-4" /></span>}
      </div>

      {segments && choices.tab === "us" && data?.facets.lead && (
        <div className="ur-seg" role="group" aria-label="Which people" data-testid="segments">
          {([["all", "Everyone", data.facets.lead.all, "Everyone waiting for a reply."], ["new", "New leads", data.facets.lead.new, "New leads who wrote and are waiting. Speed to lead times their first reply."], ["existing", "Existing customers", data.facets.lead.existing, "People who are not new leads."]] as const).map(([key, label, count, tip]) => (
            <button key={key} type="button" aria-pressed={choices.lead === key} onClick={() => set({ lead: key })} data-tip={tip} data-testid={`seg-${key}`}>{label} <b data-testid={`seg-${key}-n`}>{n(count)}</b></button>
          ))}
        </div>
      )}
      {filtersOn && f && (
        <div className="ur-filters" data-open={filtersOpen ? "1" : undefined} data-testid="filters">
          <div className="ur-chiprow" role="group" aria-label="How long they have waited">
            <button type="button" className={chip(choices.bucket === null)} aria-pressed={choices.bucket === null} onClick={() => set({ bucket: null })}>Any wait {n(f.buckets.all)}</button>
            {BUCKET_LABELS.filter((b) => b.key !== "h1" || choices.tab === "them" || slaHours < 4).map((b) => (
              <button key={b.key} type="button" className={chip(choices.bucket === b.key)} aria-pressed={choices.bucket === b.key} disabled={f.buckets[b.key] === 0 && choices.bucket !== b.key} onClick={() => set({ bucket: b.key })} data-testid={`chip-${b.key}`}>{b.label} {n(f.buckets[b.key])}</button>
            ))}
          </div>
          <div className="ur-chiprow" role="group" aria-label="More about who has them">
            {room.me && <button type="button" className={chip(choices.owner === "mine_free")} aria-pressed={choices.owner === "mine_free"} disabled={f.owner.mineFree === 0 && choices.owner !== "mine_free"} onClick={() => set({ owner: "mine_free" })} data-testid="chip-mine-free" data-tip="People assigned to you, plus people nobody owns yet">Mine and unowned {n(f.owner.mineFree)}</button>}
          </div>
          <div className="ur-selects">
            {multi && <label className="ur-sel"><span className="s6-label">Client</span>
              <select value={choices.account ?? ""} onChange={(e) => set({ account: e.target.value || null })} className={field} data-testid="filter-account">
                <option value="">All clients</option>
                {choices.account && !accounts.some((a) => a.id === choices.account) && <option value={choices.account}>This client</option>}
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>}
            {f.channels.length > 1 || choices.channel ? <label className="ur-sel"><span className="s6-label">Channel</span>
              <select value={choices.channel ?? ""} onChange={(e) => set({ channel: e.target.value || null })} className={field} data-testid="wait-list-channel">
                <option value="">All channels</option>
                {f.channels.map((c) => <option key={c.key} value={c.key}>{c.label} ({n(c.count)})</option>)}
              </select></label> : null}
            {seePeople && owners.length > 0 && <label className="ur-sel"><span className="s6-label">Owner</span>
              <select value={!choices.owner || ["none", "me", "mine_free"].includes(choices.owner) ? "" : choices.owner} onChange={(e) => set({ owner: e.target.value || null })} className={field} data-testid="filter-owner">
                <option value="">Any owner</option>
                {owners.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select></label>}
            <label className="ur-sel"><span className="s6-label">Deal worth</span>
              <select value={choices.minValue} onChange={(e) => set({ minValue: Number(e.target.value) })} className={field} data-testid="filter-value">
                <option value={0}>Any</option><option value={500}>$500 or more</option><option value={1000}>$1,000 or more</option><option value={5000}>$5,000 or more</option><option value={10000}>$10,000 or more</option>
              </select></label>
            {choices.tab === "them" && <label className="ur-sel"><span className="s6-label">Quiet for</span>
              <select value={choices.quiet} onChange={(e) => set({ quiet: Number(e.target.value) as Choices["quiet"] })} className={field} data-testid="filter-quiet">
                <option value={4}>4 hours or more</option><option value={24}>1 day or more</option><option value={72}>3 days or more</option>
              </select></label>}
            {f.snooze && <label className="ur-sel"><span className="s6-label">Show</span>
              <select value={choices.state} onChange={(e) => set({ state: e.target.value as Choices["state"] })} className={field} data-testid="filter-state">
                <option value="active">Active</option><option value="snoozed">Snoozed</option><option value="hidden">Hidden</option>
              </select></label>}
            {narrowed && <button type="button" className="s6-btn" onClick={() => { reset(); setText(""); }} data-testid="filters-clear"><X aria-hidden className="size-4" />Clear</button>}
          </div>
        </div>
      )}

      <h3 ref={headingRef} tabIndex={-1} className="ur-count" data-testid="wait-list-title" aria-live="polite">
        {data ? <><span data-testid="wait-list-count" className="tnum">{n(data.total)}</span> {data.total === 1 ? "person" : "people"} {tabName}{narrowed ? <span className="s6-label"> (filtered)</span> : null}</> : "Loading..."}
        {bulkOn && rows.length > 0 && <button type="button" className="s6-btn ur-select" onClick={() => setSelected(selected ? null : new Set())} aria-pressed={selected !== null} data-testid="bulk-toggle">{selected ? "Done selecting" : "Select"}</button>}
      </h3>
      {note && <p role="status" className="ur-note" data-testid="list-note">{note}</p>}

      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <SkeletonRows rows={5} label="Loading the people..." />
        : rows.length === 0 ? (
          <EmptyState compact title={narrowed ? "Nobody matches." : choices.tab === "us" ? "Everyone who wrote has a reply." : "Nobody has gone quiet on you."}
            body={narrowed ? "Clear the search or a choice above to see the rest." : choices.tab === "us" ? "New people appear here the moment they have waited past your reply target." : "People appear here when you wrote last and they have not answered."}
            action={narrowed ? <button type="button" className="s6-btn" onClick={() => { reset(); setText(""); }}>Clear filters</button> : undefined} />
        ) : (
          <div className={loading ? "opacity-70" : ""}>
            <PersonList rows={rows} showAccount={multi} actions={actions} tab={choices.tab} cursor={cursor} fresh={fresh} selected={selected} onToggle={toggle} onCursor={setCursor} onChanged={reload} density={density} />
            <div className="ur-foot">
              <span data-testid="wait-list-range" aria-live="polite" className="s6-label">{n(data.from)} to {n(data.to)} of {n(data.total)}</span>
              <label className="ur-sel ur-size"><span className="s6-label">Per page</span>
                <select value={choices.size} onChange={(e) => set({ size: Number(e.target.value) as Choices["size"] })} className={field} data-testid="wait-list-size" aria-label="People per page">
                  <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
                </select></label>
              {data.pages > 1 && (
                <span className="ur-pager">
                  <button type="button" className="s6-btn" disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>Previous</button>
                  <span className="tnum s6-label">Page {n(data.page + 1)} of {n(data.pages)}</span>
                  <button type="button" className="s6-btn" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} data-testid="wait-list-next">Next</button>
                </span>
              )}
            </div>
          </div>
        )}

      <Slot name="ListFooter" flags={flags} account={choices.account} onChanged={reload} />
      {selected && picked.length > 0 && (
        <div className="ur-bulk" role="region" aria-label="Selected people" data-testid="bulk-bar">
          <span className="tnum"><strong>{n(picked.length)}</strong> selected</span>
          <Slot name="BulkActions" rows={picked} flags={flags} clear={() => setSelected(new Set())} onChanged={reload} />
          {!hasUnansweredAction("claim") && !hasUnansweredAction("snooze") && <span className="s6-label hidden sm:inline">More actions appear here when they are switched on.</span>}
          <button type="button" className="s6-btn" onClick={() => { void navigator.clipboard?.writeText(picked.map((r) => `${r.name}${multi ? `, ${r.locationName}` : ""}${r.phone ? `, ${r.phone}` : ""}`).join("\n")).then(() => said("Names copied")); }}>Copy names</button>
          <button type="button" className="s6-btn" onClick={() => setSelected(new Set())} aria-label="Clear the selection"><Trash2 aria-hidden className="size-4" />Clear</button>
        </div>
      )}
      {actions.drawer}
    </div>
  );
}

// ---------- saved views: a person's own named choices ----------
function ViewsMenu({ choices, apply }: { choices: Choices; apply: (c: Partial<Choices>) => void }) {
  const api = useApiClient();
  const { data, reload } = useData<{ views: View[]; max: number }>("inbox?part=views");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const save = async () => {
    setErr(null);
    try { await api.post("inbox/views3", { name, filters: { ...choices } }); setName(""); reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save this view."); }
  };
  const remove = async (id: string) => { try { await api.del(`inbox/views3/${id}`); reload(); } catch { /* shown by the list staying */ } };
  return (
    <div className="ur-views" ref={box}>
      <button type="button" className="s6-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="views-toggle"><Star aria-hidden className="size-4" />Views<ChevronDown aria-hidden className="size-3.5" /></button>
      {open && (
        <div className="ur-pop" role="group" aria-label="Saved views" data-testid="views-pop">
          {data && data.views.length === 0 && <p className="s6-label">Save the list as it is now, for next time.</p>}
          <ul>
            {(data?.views ?? []).map((v) => (
              <li key={v.id}>
                <button type="button" className="ur-view" onClick={() => { apply(v.filters); setOpen(false); }} data-testid="view-apply">{v.name}</button>
                <button type="button" className="ur-x" onClick={() => void remove(v.id)} aria-label={`Remove the view ${v.name}`}><X aria-hidden className="size-4" /></button>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }} className="ur-saveform">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name this view" aria-label="Name this view" className={field} data-testid="view-name" />
            <button type="submit" className="s6-btn" data-kind="primary" disabled={!name.trim()} data-testid="view-save">Save</button>
          </form>
          {err && <p role="alert" className="ur-err">{err}</p>}
        </div>
      )}
    </div>
  );
}
