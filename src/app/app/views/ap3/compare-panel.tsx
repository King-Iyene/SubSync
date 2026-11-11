"use client";

import { ArrowLeftRight, Info, Search, Users, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Appt3Compare, Appt3CompareSide, Appt3Options } from "@/lib/analytics/appointments3-types";
import { compareRows, compareSentence } from "@/lib/design/appt-compare";
import { useData } from "../../session";
import { queryOf, type ApFilters } from "./data";
import type { FlowPick } from "./flow-tree";

// Two people side by side, from real fields only (status counts, deals won through the contact, calendar, source, weekday). Every count opens exactly those appointments.
// Built for teams of 50+: people are chosen from a searchable list (busiest first), never from a wall of cards.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export { compareRows, compareSentence };

export type Ranked = { id: string; name: string; n: number };
export type CompareRole = "booker" | "owner";
const TEAM = "team";

function Avatar({ name, team }: { name: string; team?: boolean }) {
  return <span className="apc-av" aria-hidden>{team ? <Users className="size-4" /> : (name.trim()[0] ?? "?").toUpperCase()}</span>;
}

/** A searchable list: type to filter, arrow keys and Enter to choose. Busiest first; the rest of the team comes from the account's team list. */
function PersonPicker({ ranked, exclude, filters, onPick, autoFocus }: { ranked: Ranked[]; exclude: string[]; filters: ApFilters; onPick: (id: string, name: string) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [at, setAt] = useState(0);
  const listId = useId();
  const opts = useData<Appt3Options>(open ? queryOf("options" as never, { ...filters, calendarId: "", userId: "", source: "", q: "" }) : null);
  const all = useMemo(() => {
    const seen = new Set(ranked.map((r) => r.id));
    const extra = (opts.data?.people ?? []).filter((p) => !seen.has(p.userId) && p.name && p.name !== "Unknown user").map((p) => ({ id: p.userId, name: p.name, n: -1 }));
    return [...ranked, ...extra.sort((a, b) => a.name.localeCompare(b.name))].filter((r) => !exclude.includes(r.id));
  }, [ranked, opts.data, exclude]);
  const shown = useMemo(() => { const t = q.trim().toLowerCase(); return (t ? all.filter((r) => r.name.toLowerCase().includes(t)) : all).slice(0, 8); }, [all, q]);
  const total = q.trim() ? all.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())).length : all.length;
  const choose = (r: Ranked) => { onPick(r.id, r.name); setQ(""); setOpen(false); };
  return (
    <div className="apc-pick">
      <div className="apc-input"><Search aria-hidden className="size-4" />
        <input role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label="Find a person to compare" placeholder="Find a person" value={q} autoFocus={autoFocus} data-testid="ap-compare-search"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && open && shown[at]) { e.preventDefault(); choose(shown[at]); }
            else if (e.key === "Escape") setOpen(false);
          }} />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="apc-list" aria-label="People">
          {shown.length === 0 ? <li className="apc-none">{opts.loading ? "Loading..." : "Nobody matches that name."}</li> : shown.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === at} data-on={i === at ? "1" : undefined} onMouseDown={(e) => { e.preventDefault(); choose(r); }} onMouseEnter={() => setAt(i)}>
              <Avatar name={r.name} /><span className="apc-opt-name">{r.name}</span><small>{r.n >= 0 ? `${r.n} booked` : "no bookings listed"}</small>
            </li>
          ))}
          {total > shown.length && <li className="apc-none">{total - shown.length} more. Keep typing to narrow it down.</li>}
        </ul>
      )}
    </div>
  );
}

function Slot({ id, side, name, role, ranked, exclude, filters, onPick, onClear }: { id: string | undefined; side: Appt3CompareSide | undefined; name: string | undefined; role: CompareRole; ranked: Ranked[]; exclude: string[]; filters: ApFilters; onPick: (id: string) => void; onClear: () => void }) {
  if (!id) return <div className="apc-card" data-empty="1"><span className="apc-lbl">Choose a person</span><PersonPicker ranked={ranked} exclude={exclude} filters={filters} onPick={(i) => onPick(i)} /></div>;
  const team = id === TEAM, shownName = side?.name ?? name ?? (team ? "Whole team" : "Unknown user");
  const unknown = side ? side.nameKnown === false : false;
  return (
    <div className="apc-card" data-testid="ap-compare-card">
      <Avatar name={shownName} team={team} />
      <div className="apc-who"><b title={shownName}>{shownName}</b>
        <small>{team ? `Everyone who booked${side?.people ? `, ${side.people} people` : ""}` : unknown ? "No name on file for this user" : role === "booker" ? "Booked the appointments" : "Took the meetings"}</small></div>
      <button type="button" className="apc-x" onClick={onClear} aria-label={`Remove ${shownName}`} title="Choose someone else"><X aria-hidden className="size-4" /></button>
    </div>
  );
}

function Detail({ title, keys, sides, get }: { title: string; keys: string[]; sides: Appt3CompareSide[]; get: (s: Appt3CompareSide, k: string) => { booked: number; showed: number; noshow: number } | undefined }) {
  if (!keys.length) return null;
  const text = (e: { booked: number; showed: number; noshow: number } | undefined) => (e ? `${e.booked} booked, ${e.showed} showed, ${e.noshow} no-show` : "none yet");
  return (
    <details className="apc-det"><summary>{title}<small>{keys.length}</small></summary>
      <div className="apc-det-body">{keys.slice(0, 12).map((k) => (
        <div className="apc-det-row" key={k}><span className="apc-det-k">{k}</span>{sides.map((s, i) => <span key={i} className="apc-det-v">{text(get(s, k))}</span>)}</div>
      ))}{keys.length > 12 && <p className="ap-fine">Showing the 12 busiest of {keys.length}.</p>}</div>
    </details>
  );
}

export function ComparePanel({ filters, ids, role, ranked, onIds, onRole, onClear, onOpen }: {
  filters: ApFilters; ids: string[]; role: CompareRole; ranked: { booker: Ranked[]; owner: Ranked[] }; onIds: (ids: string[]) => void; onRole: (r: CompareRole) => void; onClear: () => void; onOpen: (p: FlowPick) => void;
}) {
  const ready = ids.length === 2;
  const q = ready ? `${queryOf("compare" as never, filters)}&ids=${ids.join(",")}&by=${role}` : null;
  const res = useData<Appt3Compare>(q);
  const sides = useMemo(() => (ready ? res.data?.sides ?? [] : []), [ready, res.data]);
  const list = ranked[role];
  const nameOf = (id: string | undefined) => (id === TEAM ? "Whole team" : id ? list.find((r) => r.id === id)?.name : undefined);
  const rows = useMemo(() => compareRows(sides), [sides]);
  const sentence = useMemo(() => compareSentence(sides), [sides]);
  const param = (s: Appt3CompareSide) => (s.kind === "team" ? {} : s.kind === "unrecorded" ? (role === "booker" ? { booker: "none" } : { owner: "none" }) : role === "booker" ? { booker: s.userId } : { owner: s.userId });
  const set = (i: number, id: string | undefined) => { const n = [ids[0], ids[1]]; n[i] = id as string; onIds(n.filter(Boolean)); };
  const picked = (i: number) => ids[i];
  const pickedIds = ids.filter(Boolean);
  const swap = () => onIds([ids[1], ids[0]]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ready) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [ready]);
  return (
    <div className="s6-card apc mt-4" data-testid="ap-compare" role="region" aria-label="Side by side" ref={ref}>
      <div className="apc-head">
        <h3 className="s6-q">Compare two people</h3>
        <div className="apc-seg" role="group" aria-label="Compare by">
          <button type="button" aria-pressed={role === "booker"} onClick={() => onRole("booker")}>Who booked</button>
          <button type="button" aria-pressed={role === "owner"} onClick={() => onRole("owner")}>Who took the meeting</button>
        </div>
        <button type="button" className="s6-btn" onClick={onClear} data-testid="ap-compare-clear"><X aria-hidden className="size-4" />Close</button>
      </div>

      <div className="apc-cards">
        <Slot id={picked(0)} side={sides[0]} name={nameOf(picked(0))} role={role} ranked={list} exclude={pickedIds} filters={filters} onPick={(id) => set(0, id)} onClear={() => onIds(ids.filter((_, k) => k !== 0))} />
        <button type="button" className="apc-swap" onClick={swap} disabled={!ready} aria-label="Swap the two people" title="Swap the two people"><ArrowLeftRight aria-hidden className="size-4" /></button>
        <Slot id={picked(1)} side={sides[1]} name={nameOf(picked(1))} role={role} ranked={list} exclude={pickedIds} filters={filters} onPick={(id) => set(1, id)} onClear={() => onIds(ids.filter((_, k) => k !== 1))} />
      </div>
      {ids.length === 1 && ids[0] !== TEAM && <p className="ap-fine mt-2">Pick one more person, or <button type="button" className="ap-link" onClick={() => onIds([ids[0], TEAM])} data-testid="ap-compare-team">compare with the whole team</button>.</p>}

      {!ready ? (ids.length === 0 ? <p className="ap-fine mt-3">Press Compare on a person in the tree, or search for anyone above.</p> : null)
        : res.error ? <p className="ap-fine mt-3">Could not load the comparison. Try again.</p>
        : !res.data ? <p className="ap-fine mt-3" role="status">Loading...</p>
        : sides.length < 2 ? <p className="ap-fine mt-3">Nothing to compare for these people in these dates.</p> : (
          <>
            <p className="apc-sentence" data-testid="ap-compare-sentence">{sentence}</p>
            <div className="apc-rows" role="table" aria-label="Side by side figures">
              <div role="row" className="apc-r apc-r-head"><span role="columnheader" className="sr-only">Measure</span>{sides.map((s, i) => <span role="columnheader" key={i} className="apc-colname" title={s.name}>{s.name}</span>)}</div>
              {rows.map((r) => (
                <div role="row" className="apc-r" key={r.label}>
                  <span role="rowheader" className="apc-rl" title={r.hint}>{r.label}</span>
                  {r.cells.map((c, i) => (
                    <span role="cell" key={i} className="apc-cell" data-win={c.win ? "1" : undefined} data-none={c.n === 0 ? "1" : undefined}>
                      {c.n > 0 ? <button type="button" className="ap-link tnum" onClick={() => onOpen({ title: `${sides[i].name}: ${r.label.toLowerCase()}`, count: c.n, params: { ...param(sides[i]), outcome: c.outcome } })} aria-label={`Open ${c.n} ${r.label.toLowerCase()} for ${sides[i].name}`}>{c.text}</button> : <span className="apc-nil">{c.text}</span>}
                      {c.sub && <small>{c.sub}</small>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <Detail title="By calendar" keys={[...new Set(sides.flatMap((s) => s.byCalendar.map((c) => c.name)))]} sides={sides} get={(s, k) => s.byCalendar.find((c) => c.name === k)} />
            <Detail title="By source" keys={[...new Set(sides.flatMap((s) => s.bySource.map((c) => c.source)))]} sides={sides} get={(s, k) => s.bySource.find((c) => c.source === k)} />
            <Detail title="By weekday" keys={DAYS.filter((_, d) => sides.some((s) => s.byWeekday.some((w) => w.weekday === d)))} sides={sides} get={(s, k) => s.byWeekday.find((w) => DAYS[w.weekday] === k)} />
            <p className="ap-fine mt-2 flex items-center gap-1">Highlighted means ahead, once there are at least 5 bookings to go on.
              <span className="apc-info" tabIndex={0} role="img" aria-label="How these are worked out" title="Showed up: showed out of everything marked, plus past appointments nobody marked. No-show: the same, for no-shows. Closed / won: deals won, matched through the contact."><Info aria-hidden className="size-3.5" /></span></p>
          </>
        )}
    </div>
  );
}
