"use client";

import { Check, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, OpenLeadButton, SkeletonRows } from "../../ds";
import { InfoTip } from "../../ds/info-tip";
import { useApiClient, useData } from "../../session";
import { fmtInt } from "../../ui";
import { SearchSelect, type SelectOption } from "../ap3/search-select";
import type { ExecScope } from "../ap3/exec/exec-types";
import { AGE_BANDS, DIM_LABEL, cohortRate, pctText, type Dim, type StepKey, type StepRow } from "@/lib/analytics/bf-core";
import { BookingLadder, type LadderPick } from "./bf-ladder";
import { SAMPLE, bffxOn, type BreakdownRes, type CohortsRes, type ForecastRes, type LeaksRes, type OptionsRes, type RecoverDone, type RecoverPreview, type RowsRes, type SummaryRes } from "./bf-data";
import "./bf.css";

// Appointments > Booking funnel: Lead came in > First reply > Booked > Showed up > Deal opened > Won, for every client account together. One plain sentence, the animated ladder, the leak
// finder, a split by account, source, form, calendar, person, weekday, hour or lead age, weekly cohorts, a 30 day forecast and a side by side compare. Every number opens exactly the leads it counted.
// The dates are the ones in the bar at the top of the app. Dollar lines and the forecast are estimates; each says how it was worked out, and says "not enough data" under a minimum.

type Local = { setter: string; closer: string; owner: string; form: string; hour: string; dow: string; age: string };
const NO_LOCAL: Local = { setter: "", closer: "", owner: "", form: "", hour: "", dow: "", age: "" };
type Extra = Record<string, string>;
type Drill = { title: string; step: StepKey; mode: "reached" | "dropped"; extra: Extra; count: number | null };
export type BfFlags = { cohorts: boolean; forecast: boolean; recover: boolean };
export type BfPick = { value: string; label: string; hint?: string };
type Props = { scope: ExecScope; people: BfPick[]; accounts: BfPick[]; sources: string[]; flags: BfFlags; testId?: string };

const money = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `$${Math.round(v).toLocaleString("en-US")}`);
const dayLabel = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const DIM_PARAM: Record<Dim, string> = { account: "location", source: "source", form: "form", calendar: "calendar", setter: "setter", closer: "closer", owner: "owner", dow: "dow", hour: "hour", age: "age" };
const idParam = (id: string) => (id === "" ? "none" : id);

function query(part: string, s: ExecScope, l: Local, extra: Extra = {}): string {
  const p = new URLSearchParams({ part, from: s.from, to: s.to });
  const m: Record<string, string> = { location: s.locationId, calendar: s.calendarId, source: s.source, ...l };
  for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) if (v !== "") p.set(k, v);
  return `appointments/funnel?${p}`;
}
function useBf<T>(part: string, s: ExecScope, l: Local, extra: Extra = {}, on = true) {
  const fx = bffxOn(), key = on ? query(part, s, l, extra) : null;
  const r = useData<T>(fx ? null : key);
  const sample = useMemo(() => {
    if (!fx || !on) return null;
    const f = SAMPLE as unknown as Record<string, (a?: string) => unknown>;
    return f[part]?.(extra.by ?? extra.step) as T;
  }, [fx, on, part, extra.by, extra.step]);
  return fx ? { data: sample, error: null, loading: false, reload: () => {} } : r;
}
const prevScope = (s: ExecScope): ExecScope => {
  const f = Date.parse(`${s.from}T00:00:00Z`), t = Date.parse(`${s.to}T00:00:00Z`), span = Math.max(1, Math.round((t - f) / 86_400_000) + 1), iso = (n: number) => new Date(n).toISOString().slice(0, 10);
  return { ...s, from: iso(f - span * 86_400_000), to: iso(f - 86_400_000) };
};

export function BfTab({ scope, people, accounts, sources, flags, testId = "bf-tab" }: Props) {
  const [local, setLocal] = useState<Local>(NO_LOCAL);
  const [by, setBy] = useState<Dim>("account");
  const [drill, setDrill] = useState<Drill | null>(null);
  const [cmp, setCmp] = useState<"none" | "prev" | "account" | "person" | "source">("none");
  const [cmpVal, setCmpVal] = useState("");
  const fx = bffxOn();
  const drillRef = useRef<HTMLDivElement>(null);
  const scopeKey = JSON.stringify([scope, local]);
  const [prevKey, setPrevKey] = useState(scopeKey);
  if (prevKey !== scopeKey) { setPrevKey(scopeKey); setDrill(null); } // a list belongs to the filters it was opened under, so a number and its rows never disagree

  const sum = useBf<SummaryRes>("summary", scope, local);
  const leaks = useBf<LeaksRes>("leaks", scope, local);
  const opts = useBf<OptionsRes>("options", scope, NO_LOCAL);
  const open = useCallback((d: Drill) => { setDrill(d); setTimeout(() => drillRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60); }, []);
  const pick = (p: LadderPick) => open({ title: p.title, step: p.step, mode: p.mode, extra: {}, count: p.count });
  const set = (p: Partial<Local>) => setLocal((c) => ({ ...c, ...p }));
  const canPeople = sum.data?.canSeePeople ?? true, canAccounts = sum.data?.canSeeAccounts ?? true;
  const dims = (Object.keys(DIM_LABEL) as Dim[]).filter((d) => (canPeople || !["setter", "closer", "owner"].includes(d)) && (canAccounts || d !== "account"));
  const formOptions: SelectOption[] = (opts.data?.forms ?? []).map((f) => ({ value: f.id, label: f.name }));
  const chips: Array<[string, string, () => void]> = [];
  const nameOf = (list: BfPick[], v: string) => list.find((x) => x.value === v)?.label ?? "Selected";
  if (local.setter) chips.push(["Booked by", local.setter === "none" ? "nobody" : nameOf(people, local.setter), () => set({ setter: "" })]);
  if (local.closer) chips.push(["Takes the meeting", local.closer === "none" ? "nobody" : nameOf(people, local.closer), () => set({ closer: "" })]);
  if (local.owner) chips.push(["Lead owner", nameOf(people, local.owner), () => set({ owner: "" })]);
  if (local.form) chips.push(["Form", nameOf(formOptions, local.form), () => set({ form: "" })]);
  if (local.dow) chips.push(["Day", ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(local.dow)] ?? "", () => set({ dow: "" })]);
  if (local.hour) chips.push(["Hour", `${local.hour}:00`, () => set({ hour: "" })]);
  if (local.age) chips.push(["Lead age", AGE_BANDS.find((b) => b.key === local.age)?.label ?? "", () => set({ age: "" })]);

  return (
    <div className="bf" data-testid={testId}>
      {fx && <p className="bf-sample" role="status" data-testid="bf-sample">Sample data: these numbers are made up to show the layout.</p>}
      <div className="bf-controls" role="search" aria-label="Narrow the booking funnel">
        {canPeople && people.length > 0 && <>
          <SearchSelect label="Booked by" value={local.setter} anyLabel="Anyone booked" extra={[{ value: "none", label: "Not booked yet" }]} options={people} onChange={(v) => set({ setter: v })} testId="bf-setter" />
          <SearchSelect label="Takes the meeting" value={local.closer} anyLabel="Any closer" options={people} onChange={(v) => set({ closer: v })} testId="bf-closer" />
        </>}
        {formOptions.length > 0 && <SearchSelect label="Form" value={local.form} anyLabel="All forms" extra={[{ value: "none", label: "No form" }]} options={formOptions} onChange={(v) => set({ form: v })} testId="bf-form" />}
        <label className="bf-sel"><span className="sr-only">Compare with</span>
          <select className="ap-field" value={cmp} onChange={(e) => { setCmp(e.target.value as typeof cmp); setCmpVal(""); }} aria-label="Compare with" data-testid="bf-compare">
            <option value="none">No comparison</option><option value="prev">Compare: the period before</option>{canAccounts && accounts.length > 1 && <option value="account">Compare: another account</option>}{canPeople && people.length > 0 && <option value="person">Compare: another person</option>}{sources.length > 0 && <option value="source">Compare: another source</option>}
          </select></label>
        {cmp === "account" && <SearchSelect label="Compare with account" value={cmpVal} anyLabel="Choose an account" options={accounts} onChange={setCmpVal} testId="bf-cmp-account" />}
        {cmp === "person" && <SearchSelect label="Compare with person" value={cmpVal} anyLabel="Choose a person" options={people} onChange={setCmpVal} testId="bf-cmp-person" />}
        {cmp === "source" && <SearchSelect label="Compare with source" value={cmpVal} anyLabel="Choose a source" options={sources.map((x) => ({ value: x, label: x }))} onChange={setCmpVal} testId="bf-cmp-source" />}
      </div>
      {chips.length > 0 && <div className="bf-chips" aria-label="Chosen filters" data-testid="bf-chips">{chips.map(([k, v, rm]) => <span key={k} className="bf-chip">{k}: {v}<button type="button" aria-label={`Remove the ${k.toLowerCase()} filter`} onClick={rm}><X aria-hidden className="size-3" /></button></span>)}</div>}

      {sum.error && <ErrorState error={sum.error} onRetry={sum.reload} />}
      {!sum.error && !sum.data && <SkeletonRows rows={5} label="Loading the booking funnel..." />}
      {sum.data && sum.data.steps[0].count === 0 && <EmptyState title="No new leads in these dates" body="When leads come in, this shows where each one stops on the way to a booking, a show and a win. Widen the dates or clear a filter to look further back." />}
      {sum.data && sum.data.steps[0].count > 0 && <>
        <section className="bf-top" aria-label="This period in one sentence">
          <p className="bf-sentence" data-testid="bf-headline">{sum.data.headline}</p>
          {sum.data.leak && <p className="bf-money" data-testid="bf-dollars">{sum.data.leak.dollars !== null ? <>About <b>{money(sum.data.leak.dollars)}</b> of won deals slipped away at this step <span className="bf-est">estimate</span> <InfoTip text={sum.data.leak.formula} label="How this estimate is worked out" /></> : <>Dollar value: not enough data yet. It needs at least 5 won deals. <InfoTip text="The dollar line uses your own won deals. With fewer than 5 it would be a guess, so it is left out." label="Why there is no dollar value" /></>}</p>}
          <p className="bf-fine">Leads that came in {dayLabel(sum.data.period.from)} to {dayLabel(sum.data.period.to)}, from the date bar at the top.{sum.data.historyStarts ? ` History starts ${dayLabel(sum.data.historyStarts)}.` : ""}{sum.data.live ? " Calculated live for this view." : ""}{sum.data.problem ? ` ${sum.data.problem}` : ""}</p>
        </section>
        <section className="bf-card" aria-label="The booking funnel">
          <BookingLadder steps={sum.data.steps} biggest={sum.data.leak?.key ?? null} onPick={pick} />
          <ul className="bf-times" aria-label="How long each step takes">
            {sum.data.times.map((t) => <li key={t.key}><span className="bf-fine">{t.label}</span><b>{t.text}</b></li>)}
          </ul>
          {sum.data.timesNote && <p className="bf-fine">{sum.data.timesNote} <InfoTip text="A median is the middle value: half of the leads were faster, half slower. It is read from the latest 20,000 leads of the filters." label="What a median is" /></p>}
        </section>
        {cmp !== "none" && (cmp === "prev" || cmpVal) && <Compare a={sum.data} scope={scope} local={local} cmp={cmp} value={cmpVal} labelA={cmp === "prev" ? "This period" : "Now showing"} people={people} accounts={accounts} />}
        <LeakFinder res={leaks} onOpen={(title, step, extra) => open({ title, step, mode: "dropped", extra, count: null })} />
        <Split scope={scope} local={local} by={by} setBy={setBy} dims={dims} onOpen={open} onSet={(d, id) => set(d === "dow" ? { dow: id } : d === "hour" ? { hour: id } : d === "age" ? { age: id } : d === "setter" ? { setter: idParam(id) } : d === "closer" ? { closer: idParam(id) } : d === "owner" ? { owner: idParam(id) } : d === "form" ? { form: idParam(id) } : {})} />
        {flags.cohorts && <Cohorts scope={scope} local={local} />}
        {flags.forecast && <Forecast scope={scope} local={local} />}
        {drill && <div ref={drillRef}><DrillList key={JSON.stringify(drill)} drill={drill} scope={scope} local={local} flags={flags} onClose={() => setDrill(null)} /></div>}
      </>}
    </div>
  );
}

// ------------------------------------------------------------------ compare: two cards side by side
function Compare({ a, scope, local, cmp, value, people, accounts, labelA }: { a: SummaryRes; scope: ExecScope; local: Local; cmp: string; value: string; people: BfPick[]; accounts: BfPick[]; labelA: string }) {
  const bScope = cmp === "prev" ? prevScope(scope) : cmp === "account" ? { ...scope, locationId: value } : cmp === "source" ? { ...scope, source: value } : scope;
  const bLocal = cmp === "person" ? { ...local, setter: value } : local;
  const b = useBf<SummaryRes>("summary", bScope, bLocal);
  const nameB = cmp === "prev" ? "The period before" : cmp === "account" ? accounts.find((x) => x.value === value)?.label ?? "Other account" : cmp === "person" ? people.find((x) => x.value === value)?.label ?? "Other person" : value;
  const overall = (s: StepRow[]) => (s[0].count >= 30 ? Math.round((s[5].count / s[0].count) * 1000) / 10 : null);
  const card = (name: string, d: SummaryRes | null, id: string) => (
    <div className="bf-cmp-card" data-testid={id}>
      <h4>{name}</h4>
      {!d ? <p className="bf-fine">Loading...</p> : d.steps[0].count === 0 ? <p className="bf-fine">No leads in these dates.</p> : <>
        <p className="bf-cmp-big">{pctText(overall(d.steps), 1)} <span className="bf-fine">of leads won</span></p>
        <ol className="bf-cmp-steps">{d.steps.map((s) => <li key={s.key}><span>{s.label}</span><b>{fmtInt(s.count)}</b><span className="bf-fine">{s.passPct === null ? "" : `${s.passPct}%`}</span></li>)}</ol>
        <p className="bf-fine">{d.leak ? `Biggest leak: before ${d.leak.label} (${d.leak.dropPct}%)` : "No clear leak."}</p>
      </>}
    </div>
  );
  const oa = overall(a.steps), ob = b.data ? overall(b.data.steps) : null;
  return (
    <section className="bf-card" aria-label="Compare" data-testid="bf-cmp">
      <h3 className="bf-h">Side by side{oa !== null && ob !== null && <span className="bf-fine"> {oa === ob ? "Same share won." : `${Math.abs(Math.round((oa - ob) * 10) / 10)} points ${oa > ob ? "higher" : "lower"} than the other side.`}</span>}</h3>
      <div className="bf-cmp">{card(labelA, a, "bf-cmp-a")}{card(nameB, b.data, "bf-cmp-b")}</div>
    </section>
  );
}

// ------------------------------------------------------------------ leak finder
function LeakFinder({ res, onOpen }: { res: { data: LeaksRes | null; error: Error | null }; onOpen: (title: string, step: StepKey, extra: Extra) => void }) {
  const d = res.data;
  if (!d) return null;
  const block = (title: string, rows: LeaksRes["accounts"], key: string) => rows.length === 0 ? null : (
    <div className="bf-leakbox" data-testid={`bf-leaks-${key}`}>
      <h4>{title}</h4>
      <ol>
        {rows.slice(0, 6).map((r) => (
          <li key={r.id}>
            <span className="bf-leak-name">{r.name}</span>
            {r.leak ? <button type="button" className="bf-link" onClick={() => onOpen(`${r.name}: ${r.leak!.label.toLowerCase()}, leads lost`, r.leak!.key, key === "accounts" ? { location: r.id } : { [key === "setters" ? "setter" : "closer"]: r.id })} aria-label={`Open the ${r.leak.lost} leads ${r.name} lost before ${r.leak.label}`}>
              loses {r.leak.dropPct}% before {r.leak.label.toLowerCase()} ({fmtInt(r.leak.lost)}){r.leak.dollars !== null ? `, about ${money(r.leak.dollars)}` : ""}</button> : <span className="bf-fine">not enough leads to say</span>}
          </li>
        ))}
      </ol>
    </div>
  );
  const any = d.accounts.length + d.setters.length + d.closers.length > 0;
  if (!any) return null;
  return (
    <section className="bf-card" aria-label="Leak finder" data-testid="bf-leaks">
      <h3 className="bf-h">Leak finder <InfoTip text="For each account and person: the one step that loses the most, worth the most first. Dollar values are estimates from their own won deals; with fewer than 5 won deals only the number of leads is shown." label="How the leak finder ranks" /></h3>
      <div className="bf-leaks">{block("Client accounts", d.accounts, "accounts")}{block("Who booked", d.setters, "setters")}{block("Who takes the meeting", d.closers, "closers")}</div>
    </section>
  );
}

// ------------------------------------------------------------------ split by
function Split({ scope, local, by, setBy, dims, onOpen, onSet }: { scope: ExecScope; local: Local; by: Dim; setBy: (d: Dim) => void; dims: Dim[]; onOpen: (d: Drill) => void; onSet: (d: Dim, id: string) => void }) {
  const r = useBf<BreakdownRes>("breakdown", scope, local, { by });
  const [filter, setFilter] = useState("");
  const rows = (r.data?.rows ?? []).filter((x) => !filter || x.name.toLowerCase().includes(filter.toLowerCase()));
  const many = (r.data?.rows.length ?? 0) > 12;
  return (
    <section className="bf-card" aria-label="Split the funnel" data-testid="bf-split">
      <div className="bf-split-head">
        <h3 className="bf-h">Split by</h3>
        <select className="ap-field" value={by} onChange={(e) => { setBy(e.target.value as Dim); setFilter(""); }} aria-label="Split the funnel by" data-testid="bf-by">{dims.map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}</select>
        {many && <input className="ap-field" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find one" aria-label="Find a row" />}
      </div>
      {r.error && <ErrorState error={r.error} onRetry={r.reload} />}
      {!r.error && !r.data && <SkeletonRows rows={4} label="Loading..." />}
      {r.data && rows.length === 0 && <p className="bf-fine">Nothing to split in these dates.</p>}
      {r.data && rows.length > 0 && (
        <ul className="bf-rows" data-testid="bf-split-rows">
          {rows.slice(0, 60).map((x) => {
            const win = x.steps[0].count >= 30 ? Math.round((x.steps[5].count / x.steps[0].count) * 1000) / 10 : null;
            const extra: Extra = { [DIM_PARAM[by]]: by === "account" ? x.id : idParam(x.id) };
            return (
              <li key={x.id || "none"} className="bf-row">
                <div className="bf-row-h"><b className="bf-row-n">{x.name}</b><span className="bf-fine">{win === null ? "not enough leads" : `${win}% won`}</span>
                  {(by === "dow" || by === "hour" || by === "age" || by === "setter" || by === "closer" || by === "owner" || by === "form") && <button type="button" className="bf-link" onClick={() => onSet(by, x.id)}>Only this</button>}</div>
                <div className="bf-chips2">
                  {x.steps.map((s, i) => (
                    <button key={s.key} type="button" className="bf-count" data-dim={x.leak?.key === s.key ? "1" : undefined} disabled={s.count === 0} aria-label={`Open the ${s.count} leads that reached ${s.label} for ${x.name}`}
                      onClick={() => onOpen({ title: `${x.name}: ${s.label}`, step: s.key, mode: "reached", extra, count: s.count })}>
                      <span className="bf-fine">{s.label}</span><b>{fmtInt(s.count)}</b>{i > 0 && s.passPct !== null && <span className="bf-fine">{s.passPct}%</span>}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {r.data && (r.data.rows.length > 60) && <p className="bf-fine">Showing the 60 biggest. Use the find box to reach the rest.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ cohorts
function Cohorts({ scope, local }: { scope: ExecScope; local: Local }) {
  const r = useBf<CohortsRes>("cohorts", scope, local);
  const [m, setM] = useState<"booked" | "showed" | "won">("booked");
  const rows = r.data?.rows ?? [];
  return (
    <section className="bf-card" aria-label="Weekly cohorts" data-testid="bf-cohorts">
      <div className="bf-split-head"><h3 className="bf-h">Leads by week <InfoTip text="Leads that came in during a week, and what share booked, showed up or were won within 7, 14 and 30 days. A week shows nothing yet until its leads are old enough. Read from our own record." label="How to read the weekly view" /></h3>
        <select className="ap-field" value={m} onChange={(e) => setM(e.target.value as typeof m)} aria-label="Measure" data-testid="bf-cohort-m"><option value="booked">Booked</option><option value="showed">Showed up</option><option value="won">Won</option></select></div>
      <p className="bf-fine">{r.data?.historyStarts ? `History starts ${dayLabel(r.data.historyStarts)}. Earlier leads are not in this record.` : "History starts when this account was first counted."}</p>
      {r.error && <ErrorState error={r.error} onRetry={r.reload} />}
      {!r.error && !r.data && <SkeletonRows rows={3} label="Loading..." />}
      {r.data && rows.length < 2 && <p className="bf-fine">Not enough weeks yet. This fills in as your history grows.</p>}
      {r.data && rows.length >= 2 && (
        <table className="bf-table"><thead><tr><th scope="col">Week of</th><th scope="col">Leads</th><th scope="col">Within 7 days</th><th scope="col">14 days</th><th scope="col">30 days</th></tr></thead>
          <tbody>{rows.map((c) => {
            const cell = (days: 7 | 14 | 30) => { const v = cohortRate(c[`${m}${days}` as keyof typeof c] as number, c[`mature${days}` as keyof typeof c] as number); return <td key={days} data-testid={`bf-coh-${days}`} style={v === null ? undefined : { background: `color-mix(in srgb, var(--s6-cyan, #0e7490) ${Math.min(60, Math.round(v))}%, transparent)` }}>{v === null ? <span className="bf-fine">not yet</span> : `${v}%`}</td>; };
            return <tr key={c.week}><th scope="row">{dayLabel(c.week)}</th><td>{fmtInt(c.leads)}</td>{cell(7)}{cell(14)}{cell(30)}</tr>;
          })}</tbody></table>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ forecast
function Forecast({ scope, local }: { scope: ExecScope; local: Local }) {
  const r = useBf<ForecastRes>("forecast", scope, local);
  const d = r.data;
  return (
    <section className="bf-card" aria-label="Next 30 days" data-testid="bf-forecast">
      <h3 className="bf-h">Next 30 days <span className="bf-est">estimate</span> {d && <InfoTip text={d.formula} label="How the forecast is worked out" />}</h3>
      {r.error && <ErrorState error={r.error} onRetry={r.reload} />}
      {!r.error && !d && <SkeletonRows rows={2} label="Loading..." />}
      {d && !d.enough && <p className="bf-fine" data-testid="bf-forecast-empty">{d.why ?? "Not enough data."}</p>}
      {d && d.enough && <>
        <ul className="bf-fc">
          <li><span className="bf-fine">Bookings</span><b>{fmtInt(d.bookings ?? 0)}</b></li><li><span className="bf-fine">Showing up</span><b>{fmtInt(d.shows ?? 0)}</b></li>
          <li><span className="bf-fine">Won</span><b>{fmtInt(d.won ?? 0)}</b></li><li><span className="bf-fine">Revenue</span><b>{d.revenue === null ? "n/a" : money(d.revenue)}</b></li>
        </ul>
        <p className="bf-fine">Based on {d.basedOn}. {d.why ?? ""} Compared only with your own history, never with outside numbers.</p>
      </>}
    </section>
  );
}

// ------------------------------------------------------------------ the people behind a number
function DrillList({ drill, scope, local, flags, onClose }: { drill: Drill; scope: ExecScope; local: Local; flags: BfFlags; onClose: () => void }) {
  const api = useApiClient();
  type S = { key: string; rows: RowsRes["rows"]; next: string | null; total: RowsRes["total"]; label: string; err: Error | null };
  const [s, setS] = useState<S | null>(null), [nonce, setNonce] = useState(0), [more, setMore] = useState(false);
  const fx = bffxOn();
  const base = useMemo(() => {
    const sc = { ...scope, locationId: drill.extra.location ?? scope.locationId }, l: Local = { ...local };
    const ex: Extra = { step: drill.step, mode: drill.mode };
    for (const [k, v] of Object.entries(drill.extra)) { if (k === "location") continue; if (k in l) (l as Record<string, string>)[k] = v; else if (k === "source") sc.source = v === "none" ? "none" : v; else if (k === "calendar") sc.calendarId = v; else ex[k] = v; }
    return query("rows", sc, l, ex);
  }, [scope, local, drill]);
  const key = `${base}|${nonce}`;
  useEffect(() => {
    let off = false;
    const run = fx ? Promise.resolve(SAMPLE.rows(drill.step)) : api.get<RowsRes>(base);
    run.then((r) => { if (!off) setS({ key, rows: r.rows, next: r.next, total: r.total, label: r.label, err: null }); }).catch((e: Error) => { if (!off) setS({ key, rows: [], next: null, total: null, label: "", err: e }); });
    return () => { off = true; };
  }, [api, base, key, fx, drill.step]);
  const cur = s && s.key === key ? s : null;
  const more_ = async () => { if (!cur?.next) return; setMore(true); try { const r = await api.get<RowsRes>(`${base}&after=${encodeURIComponent(cur.next)}`); setS((p) => (p ? { ...p, rows: [...p.rows, ...r.rows], next: r.next } : p)); } catch (e) { setS((p) => (p ? { ...p, err: e as Error } : p)); } finally { setMore(false); } };
  const real = cur?.total ? `${fmtInt(cur.total.n)}${cur.total.capped ? "+" : ""}` : cur ? String(cur.rows.length) : "...";
  const account = drill.extra.location ?? scope.locationId;
  return (
    <section className="bf-card" id="bf-drill" aria-label="Leads behind the number" data-testid="bf-drill">
      <div className="bf-drill-h"><h3 className="bf-h" data-testid="bf-drill-title">{drill.title}</h3><span className="bf-chip" data-testid="bf-drill-count">{real}</span><button type="button" className="bf-link" onClick={onClose}>Close list</button></div>
      {cur?.err && <ErrorState error={cur.err} onRetry={() => setNonce((n) => n + 1)} />}
      {!cur && <SkeletonRows rows={5} label="Loading the leads..." />}
      {cur && !cur.err && cur.rows.length === 0 && <p className="bf-fine">Nobody here in these dates.</p>}
      {cur && cur.rows.length > 0 && <ul className="bf-leads" data-testid="bf-drill-rows">{cur.rows.map((r) => (
        <li key={`${r.locationId}:${r.contactId}`}>
          <div className="bf-lead-t"><b>{r.name}</b><span className="bf-fine">{[r.source ?? "No source", r.createdAt ? dayLabel(r.createdAt.slice(0, 10)) : "", r.locationName].filter(Boolean).join(" · ")}</span></div>
          <OpenLeadButton seed={{ contactId: r.contactId, locationId: r.locationId, name: r.name, locationName: r.locationName, phone: r.phone, email: r.email, owner: r.owner, unassigned: !r.owner, url: r.url ?? undefined, dnd: r.dnd }} crmUrl={r.url} name={r.name} />
        </li>))}</ul>}
      {cur?.next && <button type="button" className="s6-btn" disabled={more} onClick={() => void more_()} data-testid="bf-drill-more">{more ? "Loading..." : "Show more"}</button>}
      {drill.mode === "dropped" && flags.recover && !fx && <Recover drill={drill} account={account} base={base} />}
    </section>
  );
}

// ------------------------------------------------------------------ recover: tag the leads that dropped out (preview, typed words, dry run unless live)
function Recover({ drill, account, base }: { drill: Drill; account: string; base: string }) {
  const api = useApiClient();
  const [pv, setPv] = useState<RecoverPreview | null>(null), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const q = base.replace(/^appointments\/funnel\?/, "");
  const call = async (stage: "preview" | "do") => {
    setBusy(true); setErr(null);
    try {
      const body = { query: q, account, step: drill.step, stage, typed };
      if (stage === "preview") { setPv(await api.post<RecoverPreview>("appointments/funnel-recover", body)); setMsg(null); } else { const r = await api.post<RecoverDone>("appointments/funnel-recover", body); setMsg(r.message); setPv(null); setTyped(""); }
    } catch (e) { setErr((e as Error).message || "That did not work."); } finally { setBusy(false); }
  };
  if (!account) return <p className="bf-fine bf-recover" data-testid="bf-recover-hint">To tag these leads for follow-up, pick one client account in the bar above.</p>;
  return (
    <div className="bf-recover" data-testid="bf-recover">
      {!pv && !msg && <button type="button" className="s6-btn" data-kind="primary" disabled={busy} onClick={() => void call("preview")} data-testid="bf-recover-btn"><Check aria-hidden className="size-4" />Tag these leads to recover</button>}
      {pv && (
        <div className="bf-recover-box" data-testid="bf-recover-preview">
          <p><b>{fmtInt(pv.requested)}</b> {pv.requested === 1 ? "lead" : "leads"} would be tagged{pv.capped ? ` (the first ${pv.cap})` : ""}. {pv.protectedSkipped > 0 ? `${fmtInt(pv.protectedSkipped)} left out: asked not to be contacted, or have an open deal or a coming appointment. ` : ""}</p>
          {pv.sample.length > 0 && <p className="bf-fine">For example: {pv.sample.join(", ")}.</p>}
          <p className="bf-fine">{pv.warning}</p><p className="bf-fine"><b>{pv.modeWords}</b></p>
          {pv.requested > 0 && <label className="bf-typed">Type <code>{pv.phrase}</code> to confirm<input className="ap-field" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the words to confirm" data-testid="bf-recover-typed" /></label>}
          <div className="bf-recover-act"><button type="button" className="s6-btn" data-kind="primary" disabled={busy || pv.requested === 0 || typed.trim() === ""} onClick={() => void call("do")} data-testid="bf-recover-do">Tag them</button><button type="button" className="s6-btn" onClick={() => { setPv(null); setTyped(""); }}>Cancel</button></div>
        </div>
      )}
      {msg && <p role="status" data-testid="bf-recover-msg">{msg}</p>}
      {err && <p role="alert" className="bf-err">{err}</p>}
    </div>
  );
}
