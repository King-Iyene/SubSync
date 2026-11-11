"use client";

import { Copy, Download, Printer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "../../../ds";
import { useApiClient, useData } from "../../../session";
import { adaptList } from "../adapters";
import { ApTable, Pager } from "../parts";
import type { ApRow } from "../types";
import { BarRow, Change, dayLabel, FunnelBars, fmtKpi, Heatmap, money, pct, Spark } from "./exec-bits";
import { apxFixtureOn, FX } from "./exec-fixtures";
import type { Basis, ExecScope } from "./exec-types";
import { DOW, hourLabel } from "@/lib/analytics/appointments-exec-intel";
import "./exec.css";

// Appointments > Leadership. Built for a manager who has to decide: every block answers one question (What should I fix? How did we do? Are we on pace? What is leaking?
// Who is converting? When and where?), opens with a plain sentence, shows the evidence and gives one action. Every number opens exactly the appointments it counted.
// It takes the shared filter object of the module (ExecScope), so account, calendar, person, source, dates and the two date axes recompute everything.

type Q = Record<string, string | number | undefined>;
const qs = (part: string, s: ExecScope, extra: Q = {}) => {
  const p = new URLSearchParams({ part, from: s.from, to: s.to });
  if (s.basis === "booked") p.set("basis", "booked");
  const m: Record<string, string> = { location: s.locationId, calendar: s.calendarId, user: s.userId, setter: s.booker, closer: s.owner, source: s.source, status: s.status, stage: s.stage };
  for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, String(v));
  return `appointments/exec?${p}`;
};
function useExec<T>(part: string, s: ExecScope, extra: Q = {}) {
  const fx = apxFixtureOn();
  const key = qs(part, s, extra);
  const r = useData<T>(fx ? null : key);
  const sample = useMemo(() => (fx ? ((FX as Record<string, unknown>)[part] as T) : null), [fx, part]);
  return fx ? { data: sample, error: null, loading: false, reload: () => {} } : r;
}

type Drill = { title: string; params: Q } | null;
const KPI_ORDER = ["booked", "showed", "show_rate", "noshow_rate", "cancel_rate", "resched_rate", "ltb", "b2m", "won", "won_value", "lost_noshow"];

export function ExecTab({ scope, onOpenRow }: { scope: ExecScope; onOpenRow: (r: ApRow) => void }) {
  const [compare, setCompare] = useState<"prev" | "year">("prev");
  const [basis, setBasis] = useState<Basis>(scope.basis ?? "appt");
  const s = useMemo<ExecScope>(() => ({ ...scope, basis }), [scope, basis]);
  const [drill, setDrill] = useState<Drill>(null);
  const [brief, setBrief] = useState(false);
  const drillRef = useRef<HTMLDivElement>(null);
  const open = (title: string, params: Q) => { setDrill({ title, params }); setTimeout(() => drillRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); };
  // A drill belongs to the filters it was opened under: change them and it closes, so a number and its rows never disagree.
  const scopeKey = JSON.stringify(s);
  const [prevKey, setPrevKey] = useState(scopeKey);
  if (prevKey !== scopeKey) { setPrevKey(scopeKey); setDrill(null); }

  const sum = useExec<SummaryT>("summary", s), dec = useExec<DecT>("decisions", s), pc = useExec<PaceT>("pace", s), bd = useExec<BoardT>("boards", s), sl = useExec<SlotsT>("slots", s);
  const fx = apxFixtureOn();

  return (
    <div className="apx" data-testid="ap-exec">
      {fx && <p className="apx-sample" role="status">Sample data: these numbers are made up to show the layout.</p>}
      <div className="apx-controls">
        <label className="apx-sel"><span className="apx-fine">Count by</span>
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} aria-label="Count by"><option value="appt">Appointment date</option><option value="booked">Booked on</option></select></label>
        <label className="apx-sel"><span className="apx-fine">Compare with</span>
          <select value={compare} onChange={(e) => setCompare(e.target.value as "prev" | "year")} aria-label="Compare with"><option value="prev">Previous period</option><option value="year">Same period last year</option></select></label>
        <span className="apx-grow" />
        <button type="button" className="s6-btn" onClick={() => setBrief((b) => !b)} data-testid="apx-brief-btn">{brief ? "Hide weekly brief" : "Weekly brief"}</button>
      </div>

      {sum.error && <ErrorState error={sum.error} onRetry={sum.reload} />}
      {!sum.error && !sum.data && <SkeletonRows rows={5} label="Loading the leadership view..." />}
      {sum.data && sum.data.kpis.length === 0 && <EmptyState title="No appointments in these dates" body="When calendars have bookings, the leadership view shows how you are doing, where bookings leak and what to fix. Widen the dates or clear a filter to look further back." />}
      {sum.data && sum.data.kpis.length > 0 && (
        <>
          <section className="apx-top" aria-label="This period in one sentence">
            <p className="apx-sentence" data-testid="apx-headline">{sum.data.headline}</p>
            <p className="apx-fine">{dayLabel(sum.data.period.from)} to {dayLabel(sum.data.period.to)}, counted by {basis === "booked" ? "the date it was booked" : "appointment date"}.{sum.data.historyStarts ? ` History starts ${dayLabel(sum.data.historyStarts)}.` : ""}{sum.data.live ? " Calculated live for this view." : ""}</p>
          </section>

          <Decisions res={dec} onOpen={open} />

          <section className="apx-card" aria-labelledby="apx-kpis"><h3 id="apx-kpis" className="apx-q">How did we do?</h3>
            <p className="apx-ans">{sum.data.kpis.find((k) => k.key === "show_rate")?.value != null ? `${pct(sum.data.kpis.find((k) => k.key === "show_rate")?.value)} of the people booked turned up.` : "Not enough finished appointments yet for a show rate."}</p>
            <div className="apx-kpis">
              {KPI_ORDER.map((k) => sum.data!.kpis.find((x) => x.key === k)).filter((x): x is KpiT => !!x).map((k) => {
                const dlt = compare === "year" ? k.deltaYear : k.deltaPrev;
                const body = (
                  <>
                    <span className="apx-kl">{k.label}{k.estimate ? " (estimate)" : ""}</span>
                    <span className="apx-kn">{k.value === null ? <span className="apx-na">{k.note ?? "n/a"}</span> : fmtKpi(k.value, k.display)}</span>
                    {k.estimate ? <details className="apx-formula"><summary>How is this worked out?</summary><span>{k.formula}</span></details> : <Change d={dlt} good={k.good} label={compare === "year" ? "vs last year" : "vs previous"} />}
                    {!k.estimate && <Spark points={k.spark} />}
                    {!k.estimate && k.value !== null && k.note && <span className="apx-fine">{k.note}</span>}
                  </>
                );
                return k.open && k.value !== null && k.value !== 0
                  ? <button key={k.key} type="button" className="apx-kpi" data-testid="apx-kpi" onClick={() => open(k.label, k.open as Q)} title="Open these appointments">{body}</button>
                  : <div key={k.key} className="apx-kpi" data-static="1" data-testid="apx-kpi">{body}</div>;
              })}
            </div>
            {compare === "year" && sum.data.yearNote && <p className="apx-fine">{sum.data.yearNote}</p>}
          </section>

          <div className="apx-two">
            <Pace res={pc} s={s} onOpen={open} />
            <section className="apx-card" aria-labelledby="apx-leak"><h3 id="apx-leak" className="apx-q">What is leaking?</h3>
              <p className="apx-ans" data-testid="apx-leak">{sum.data.funnel.leak?.sentence ?? "No clear leak yet: there are not enough finished appointments."}</p>
              <FunnelBars steps={sum.data.funnel.steps} onOpen={(_k, bucket, label) => open(label, { bucket })} />
              {!sum.data.funnel.confirmTracked && <p className="apx-fine">Confirmation is not recorded for these appointments yet, so that step is left out.</p>}
              {sum.data.funnel.leak?.bucket && <button type="button" className="s6-btn apx-act" onClick={() => open(sum.data!.funnel.leak!.step === "closing" ? "Showed, no deal won" : sum.data!.funnel.leak!.sentence, { bucket: sum.data!.funnel.leak!.bucket as string })}>Open the appointments</button>}
            </section>
          </div>

          <Boards res={bd} onOpen={open} />
          <Slots res={sl} onOpen={open} />
        </>
      )}

      {brief && <Brief s={s} sum={sum.data} dec={dec.data} pace={pc.data} />}
      <div ref={drillRef}>{drill && <Rows s={s} drill={drill} onClose={() => setDrill(null)} onOpenRow={onOpenRow} />}</div>
    </div>
  );
}

// ---------- what should I fix ----------
function Decisions({ res, onOpen }: { res: { data: DecT | null; error: unknown; loading: boolean; reload: () => void }; onOpen: (t: string, p: Q) => void }) {
  return (
    <section className="apx-card apx-lead" aria-labelledby="apx-dec"><h3 id="apx-dec" className="apx-q">What should I fix this week?</h3>
      {!res.data && !res.error && <SkeletonRows rows={2} label="Working out what to fix..." />}
      {res.error ? <ErrorState error={res.error as never} onRetry={res.reload} /> : null}
      {res.data && res.data.decisions.length === 0 && <p className="apx-ans">Nothing stands out. The numbers do not point to one clear thing to change right now, or there is not enough data to say.</p>}
      {res.data && res.data.decisions.length > 0 && (
        <ol className="apx-decs" data-testid="apx-decisions">
          {res.data.decisions.map((d, i) => (
            <li key={d.key} className="apx-dec"><span className="apx-dn" aria-hidden>{i + 1}</span>
              <div className="apx-dbody"><strong className="apx-dh">{d.headline}</strong><p className="apx-fine apx-ev">{d.evidence}</p></div>
              {d.open && <button type="button" className="s6-btn" onClick={() => onOpen(d.open!.title, d.open!.params)}>{d.button}</button>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- pace ----------
function Pace({ res, s, onOpen }: { res: { data: PaceT | null; error: unknown; loading: boolean; reload: () => void }; s: ExecScope; onOpen: (t: string, p: Q) => void }) {
  const api = useApiClient();
  const [draft, setDraft] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  const d = res.data;
  const save = async (target: number | null | "undo") => {
    setBusy(true); setMsg(null);
    try { await api.put("appointments/exec-target", { location: s.locationId || null, target }); setMsg(target === "undo" ? "Target put back." : target === null ? "Target removed." : "Target saved."); setDraft(""); res.reload(); }
    catch { setMsg("Could not save. Try again."); }
    setBusy(false);
  };
  return (
    <section className="apx-card" aria-labelledby="apx-pace"><h3 id="apx-pace" className="apx-q">Are we on pace?</h3>
      {!d && !res.error && <SkeletonRows rows={2} label="Loading pace..." />}
      {res.error ? <ErrorState error={res.error as never} onRetry={res.reload} /> : null}
      {d && (
        <>
          <p className="apx-ans" data-testid="apx-pace" data-status={d.status}>{d.sentence}</p>
          <dl className="apx-facts">
            <div><dt>This week so far</dt><dd>{d.thisWeek}{d.weekExpected !== null ? <span className="apx-fine"> usual by now: {d.weekExpected}</span> : null}</dd></div>
            <div><dt>This month so far</dt><dd>{d.month}{d.monthExpected !== null ? <span className="apx-fine"> usual by now: {d.monthExpected}</span> : null}</dd></div>
            <div><dt>Your 8-week average</dt><dd>{d.avgPerWeek === null ? <span className="apx-na">Not enough data</span> : `${d.avgPerWeek} a week`}</dd></div>
            <div><dt>Month-end (estimate)</dt><dd>{d.projectedMonth ?? <span className="apx-na">Not enough data</span>}</dd></div>
          </dl>
          <details className="apx-formula"><summary>How is this worked out?</summary><span>{d.formula}</span></details>
          <div className="apx-target">
            {d.canSetTarget ? (
              <>
                <label className="apx-sel"><span className="apx-fine">Monthly target{s.locationId ? " for this account" : " for everything you see"}{d.target ? `: ${d.target}` : ""}</span>
                  <input inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={d.target ? String(d.target) : "Bookings a month"} aria-label="Monthly booking target" /></label>
                <button type="button" className="s6-btn" disabled={busy || !draft} onClick={() => save(Number(draft))}>Save target</button>
                {d.targetUndo && <button type="button" className="ap-link" disabled={busy} onClick={() => save("undo")}>Undo last change</button>}
                {d.target !== null && <button type="button" className="ap-link" disabled={busy} onClick={() => save(null)}>Remove target</button>}
              </>
            ) : <p className="apx-fine">{d.narrowed ? "A target applies to a whole account or to everything you see. Clear the calendar or person filter to set one." : "Choose one account to set a target for it."}</p>}
            {msg && <p className="apx-fine" role="status">{msg}</p>}
            <p className="apx-fine">The target is only kept in SubSync. Nothing is changed in your CRM.</p>
          </div>
          <button type="button" className="s6-btn apx-act" onClick={() => onOpen("Booked this month", { bucket: "booked", basis: "booked", month: 1 })}>Open this month&apos;s bookings</button>
        </>
      )}
    </section>
  );
}

// ---------- who is converting ----------
type Tab = "setters" | "closers" | "calendars" | "sources" | "accounts";
function Boards({ res, onOpen }: { res: { data: BoardT | null; error: unknown; loading: boolean; reload: () => void }; onOpen: (t: string, p: Q) => void }) {
  const d = res.data;
  const tabs: Array<{ k: Tab; label: string; has: boolean }> = [
    { k: "setters", label: "Who books", has: !!d?.setters.length }, { k: "closers", label: "Who takes the meetings", has: !!d?.closers.length }, { k: "calendars", label: "Calendars", has: !!d?.calendars.length },
    { k: "sources", label: "Where leads come from", has: !!d?.sources.length }, { k: "accounts", label: "Client accounts", has: !!d?.accounts.length },
  ];
  const avail = tabs.filter((t) => t.has);
  const [tab, setTab] = useState<Tab>("setters");
  const cur = avail.find((t) => t.k === tab) ? tab : avail[0]?.k;
  const [all, setAll] = useState(false);
  type Row = { id: string | null; name: string; booked: number; show: { value: number | null; of: number; enough: boolean }; close: { value: number | null; enough: boolean }; won: number; wonValue: number; noteExpected?: string; flag?: boolean; params: Q };
  const rows: Row[] = !d || !cur ? [] : cur === "setters" || cur === "closers"
    ? (cur === "setters" ? d.setters : d.closers).map((p) => ({ id: p.id, name: p.name, booked: p.booked, show: p.showRate, close: p.closeRate, won: p.won, wonValue: p.wonValue, flag: p.vsExpectedPoints !== null && p.vsExpectedPoints <= -10,
        noteExpected: p.vsExpectedPoints === null ? undefined : `${p.vsExpectedPoints >= 0 ? "+" : ""}${p.vsExpectedPoints} points vs expected for the same lead sources`, params: { bucket: "booked", [cur === "setters" ? "setter" : "closer"]: p.id ?? "none" } }))
    : (d[cur] as Array<{ id: string; name: string; booked: number; showRate: Row["show"]; closeRate: Row["close"]; won: number; wonValue: number }>).map((r) => ({ id: r.id, name: r.name, booked: r.booked, show: r.showRate, close: r.closeRate, won: r.won, wonValue: r.wonValue,
        params: { bucket: "booked", [cur === "calendars" ? "calendar" : cur === "sources" ? "source" : "location"]: r.id || (cur === "sources" ? "none" : "") } }));
  const shown = all ? rows : rows.slice(0, 6), max = Math.max(1, ...rows.map((r) => r.booked));
  const movers = d && (cur === "setters" ? d.movers.setters : cur === "closers" ? d.movers.closers : null);
  const lead = rows.filter((r) => r.show.enough && r.show.value !== null).sort((a, b) => (b.show.value as number) - (a.show.value as number))[0];
  return (
    <section className="apx-card" aria-labelledby="apx-who"><h3 id="apx-who" className="apx-q">Who is converting?</h3>
      {!d && !res.error && <SkeletonRows rows={3} label="Loading..." />}
      {res.error ? <ErrorState error={res.error as never} onRetry={res.reload} /> : null}
      {d && avail.length === 0 && <p className="apx-ans">No appointments to rank yet.</p>}
      {d && avail.length > 0 && cur && (
        <>
          <div className="apx-seg" role="tablist" aria-label="Rank by">{avail.map((t) => <button key={t.k} type="button" role="tab" aria-selected={cur === t.k} data-on={cur === t.k ? "1" : undefined} onClick={() => { setTab(t.k); setAll(false); }}>{t.label}</button>)}</div>
          <p className="apx-ans">{lead ? `${lead.name} has the best show rate (${pct(lead.show.value)}) among those with enough appointments.` : "Not enough finished appointments yet to say who leads."}</p>
          <div className="apx-bars" data-testid="apx-bars">
            {shown.map((r) => <BarRow key={`${r.id}-${r.name}`} name={r.name} value={r.booked} max={max} flag={r.flag} text={`${r.booked.toLocaleString("en-US")} booked`}
              sub={`${r.show.enough ? `${pct(r.show.value)} showed` : "show rate: not enough data"}${cur === "setters" || cur === "closers" ? "" : ""}${r.close.enough ? `, ${pct(r.close.value)} closed` : ""}${r.won ? `, ${r.won} won (${money(r.wonValue)})` : ""}${r.noteExpected ? `. ${r.noteExpected}` : ""}`}
              onClick={() => onOpen(r.name, r.params)} />)}
          </div>
          {rows.length > 6 && <button type="button" className="ap-link" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
          {movers && (movers.up.length > 0 || movers.down.length > 0) && (
            <p className="apx-fine apx-movers">{movers.up.length > 0 && <>Moving up: {movers.up.map((m) => `${m.name} (+${m.movePoints} points)`).join(", ")}. </>}{movers.down.length > 0 && <>Moving down: {movers.down.map((m) => `${m.name} (${m.movePoints} points)`).join(", ")}.</>}</p>
          )}
          <p className="apx-fine">Fair by design: a rate needs at least 10 finished appointments, and people are compared with what we would expect for the same lead sources.</p>
        </>
      )}
    </section>
  );
}

// ---------- when and where ----------
function Slots({ res, onOpen }: { res: { data: SlotsT | null; error: unknown; loading: boolean; reload: () => void }; onOpen: (t: string, p: Q) => void }) {
  const d = res.data;
  const bands = d?.bands.filter((b) => b.n > 0) ?? [];
  const bmax = Math.max(0.01, ...bands.map((b) => b.rate ?? 0));
  const issues = d ? [...d.capacity.calendars.filter((c) => c.idle).map((c) => ({ k: `i${c.id}`, text: `${c.name} has nothing booked this week or next (its busiest week had ${c.peak}).`, params: { calendar: c.id, bucket: "booked" } as Q, title: c.name })),
    ...d.capacity.calendars.filter((c) => c.over).map((c) => ({ k: `o${c.id}`, text: `${c.name} is booked above its own busiest week (${Math.max(c.thisWeek, c.nextWeek)} against ${c.peak}).`, params: { calendar: c.id, bucket: "booked" } as Q, title: c.name })),
    ...d.capacity.people.filter((c) => c.over).map((c) => ({ k: `p${c.id}`, text: `${c.name} has more meetings coming than any week they have had (${Math.max(c.thisWeek, c.nextWeek)} against ${c.peak}).`, params: { closer: c.id, bucket: "booked" } as Q, title: c.name })),
    ...d.capacity.people.filter((c) => c.idle).map((c) => ({ k: `q${c.id}`, text: `${c.name} has no meetings this week or next (busiest week: ${c.peak}).`, params: { closer: c.id, bucket: "booked" } as Q, title: c.name }))] : [];
  return (
    <section className="apx-card" aria-labelledby="apx-when"><h3 id="apx-when" className="apx-q">When and where do people show up?</h3>
      {!d && !res.error && <SkeletonRows rows={3} label="Loading..." />}
      {res.error ? <ErrorState error={res.error as never} onRetry={res.reload} /> : null}
      {d && (
        <>
          <p className="apx-ans" data-testid="apx-slots">{d.enough && d.best && d.worst ? `Best slot: ${DOW[d.best.dow]} ${hourLabel(d.best.hour)} (${pct(d.best.rate)} show). Weakest: ${DOW[d.worst.dow]} ${hourLabel(d.worst.hour)} (${pct(d.worst.rate)} show).` : "Not enough finished appointments in any one time slot to name a best or worst."}</p>
          <Heatmap cells={d.cells} onOpen={(dow, hour) => onOpen(`${DOW[dow]} ${hourLabel(hour)}`, { bucket: "completed", dow, hour })} />
          <p className="apx-fine">Darker means more people showed up. Blank squares have fewer than 8 finished appointments, so no rate is shown. {d.tzNote}</p>
          <h4 className="apx-sub">Does waiting hurt?</h4>
          {bands.length === 0 ? <p className="apx-fine">Not enough data on how long people waited.</p> : (
            <div className="apx-bars">{bands.map((b) => <BarRow key={b.key} name={b.label} value={b.rate ?? 0} max={bmax} text={b.rate === null ? "n/a" : `${pct(b.rate)} showed`} sub={`${b.n} appointments${b.rate === null ? ", not enough to show a rate" : ""}`} onClick={() => onOpen(`Booked ${b.label.toLowerCase()} ahead`, { bucket: "completed", band: b.key })} />)}</div>
          )}
          <h4 className="apx-sub">Capacity</h4>
          {issues.length === 0 ? <p className="apx-fine">No idle or overloaded calendars or people. {d.capacity.note}</p> : (
            <ul className="apx-issues">{issues.slice(0, 6).map((i) => <li key={i.k}><span>{i.text}</span> <button type="button" className="ap-link" onClick={() => onOpen(i.title, i.params)}>Open the appointments</button></li>)}<li className="apx-fine">{d.capacity.note}</li></ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------- the rows behind any number ----------
function Rows({ s, drill, onClose, onOpenRow }: { s: ExecScope; drill: NonNullable<Drill>; onClose: () => void; onOpenRow: (r: ApRow) => void }) {
  const [page, setPage] = useState(1), [size, setSize] = useState(20), [cursors, setCursors] = useState<Record<number, string>>({});
  const dk = JSON.stringify(drill) + JSON.stringify(s);
  const [prev, setPrev] = useState(dk);
  if (prev !== dk) { setPrev(dk); setPage(1); setCursors({}); }
  const after = page > 1 ? cursors[page] : undefined;
  const fx = apxFixtureOn();
  const r = useData<Parameters<typeof adaptList>[0]>(fx ? null : qs("rows", s, { ...drill.params, ...(after ? { after, page: 0 } : { page: page - 1 }), size }));
  const list = useMemo(() => (r.data ? adaptList(r.data) : fx ? adaptList(FX.rows as never) : null), [r.data, fx]);
  const go = (p: number) => { if (p > page && list?.next) setCursors((c) => ({ ...c, [p]: list.next as string })); setPage(p); };
  return (
    <section className="apx-card apx-drill" aria-label={`Appointments: ${drill.title}`} data-testid="apx-drill">
      <div className="apx-dhead"><h3 className="apx-q">{drill.title}{list ? <span className="apx-fine"> {list.total.toLocaleString("en-US")} appointments</span> : null}</h3><button type="button" className="s6-btn" onClick={onClose}>Close</button></div>
      {r.error && !fx ? <ErrorState error={r.error} onRetry={r.reload} /> : !list ? <SkeletonRows rows={5} label="Loading appointments..." />
        : list.total === 0 ? <EmptyState title="No appointments match" body="Nothing in these filters counted toward that number. Widen the dates or clear a filter." />
        : (<div className="ap-tablewrap"><ApTable rows={list.rows} showAccount onOpen={onOpenRow} /><Pager total={list.total} page={page} size={size} onPage={go} onSize={(n) => { setSize(n); setPage(1); setCursors({}); }} /></div>)}
    </section>
  );
}

// ---------- the weekly brief ----------
function Brief({ s, sum, dec, pace }: { s: ExecScope; sum: SummaryT | null; dec: DecT | null; pace: PaceT | null }) {
  const api = useApiClient();
  const [done, setDone] = useState<string | null>(null);
  if (!sum) return null;
  const k = (key: string) => sum.kpis.find((x) => x.key === key);
  const copy = async () => { try { await navigator.clipboard.writeText(dec?.brief ?? sum.headline); setDone("Copied."); } catch { setDone("Could not copy. Select the text and copy it."); } };
  return (
    <section className="apx-card apx-brief" aria-label="Weekly leadership brief" data-testid="apx-brief">
      <div className="apx-noprint apx-dhead"><h3 className="apx-q">Weekly brief</h3>
        <div className="apx-brief-actions">
          <button type="button" className="s6-btn" onClick={copy}><Copy className="size-4" aria-hidden /> Copy</button>
          <button type="button" className="s6-btn" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</button>
          <button type="button" className="s6-btn" onClick={async () => { try { await api.download(qs("export", s), "appointments-leadership.csv"); } catch { setDone("Download failed. Try again."); } }}><Download className="size-4" aria-hidden /> CSV</button>
        </div>
      </div>
      {done && <p className="apx-fine apx-noprint" role="status">{done}</p>}
      <h2 className="apx-btitle">Appointments: weekly leadership brief</h2>
      <p className="apx-fine">{dayLabel(sum.period.from)} to {dayLabel(sum.period.to)}</p>
      <p className="apx-sentence">{sum.headline}</p>
      <dl className="apx-facts apx-bfacts">
        {["booked", "showed", "show_rate", "noshow_rate", "won", "won_value"].map((key) => { const x = k(key); return x ? <div key={key}><dt>{x.label}</dt><dd>{x.value === null ? "n/a" : fmtKpi(x.value, x.display)}</dd></div> : null; })}
      </dl>
      {k("lost_noshow")?.value ? <p className="apx-fine">Estimated revenue lost to no-shows: about {money(k("lost_noshow")?.value)}. {k("lost_noshow")?.formula}</p> : null}
      {pace && <p><strong>Pace.</strong> {pace.sentence}</p>}
      {dec && dec.decisions.length > 0 && <><h4 className="apx-sub">What to fix this week</h4><ol>{dec.decisions.map((d) => <li key={d.key}><strong>{d.headline}.</strong> {d.evidence}</li>)}</ol></>}
      <p className="apx-fine">Every figure is counted from your own appointments. Estimates are labelled as estimates.</p>
    </section>
  );
}

// ---------- types (type-only imports: nothing server-side reaches the browser) ----------
import type { boards as boardsFn, decisions as decisionsFn, pace as paceFn, slots as slotsFn, summary as summaryFn, KpiOut } from "@/lib/analytics/appointments-exec-queries";
type SummaryT = Awaited<ReturnType<typeof summaryFn>>;
type KpiT = KpiOut;
type DecT = Awaited<ReturnType<typeof decisionsFn>>;
type PaceT = Awaited<ReturnType<typeof paceFn>>;
type BoardT = Awaited<ReturnType<typeof boardsFn>>;
type SlotsT = Awaited<ReturnType<typeof slotsFn>>;
