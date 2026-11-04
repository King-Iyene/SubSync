"use client";

import { Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { shareChange } from "@/lib/design/range";
import { fmtDuration, MIN_FOR_MEDIAN, type Progress, type Summary } from "@/lib/analytics/speed-intel";
import { weekBars, weeksIn, type TrendWeekData } from "@/lib/design/trend-bars";
import { MAX_TARGET, MIN_TARGET } from "@/lib/analytics/speed-v2";
import { useApiClient, useData } from "../session";
import { BarChart, CardRange, ChartPlaceholder, DefinitionTip, EmptyState, ErrorState, SkeletonRows, type CardRangeState } from "../ds";
import { CountUp } from "../ds/count-up";
import { PersonName } from "./speed-cards";
import type { PersonView } from "./speed-cards";

// The response-time picture (docs/SPEED_REVIEW.md). Only what answers a question: how fast replies come and how many are in time (one range, one comparison),
// the weeks as clickable bars, and who is slow (clients or people) with the way to fix a client's own reply target. Every number is a real button that opens
// exactly the leads it counts. Percentages need 5 judged leads and a change needs 10 on both sides; below that the screen says "n of 5 so far".

export type HomeSummary = Summary & { judged: number; pct: { text: string; value: number | null }; typical: Progress; typicalLine: string };
export type CompareAccountRow = Summary & { id: string; name: string; judged: number; ranked: boolean; progress: string | null; targetMinutes: number; ownTarget: boolean };
export type ComparePersonRow = PersonView & { userId: string; replies: number; medianSeconds: number | null; ranked: boolean; progress: string | null };
export type OpenList = (spec: { title: string; params: Record<string, string>; noun?: string }) => void;

const link = "ds-press min-h-11 rounded-md px-1.5 text-left font-medium text-primary underline underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9";

/** A big number that opens its list. A real button, so the keyboard and a screen reader get it. */
export function NumberButton({ children, label, onClick, tone }: { children: ReactNode; label: string; onClick: () => void; tone?: "bad" | "warn" | "good" }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-testid="number-button"
      className={`ds-press tnum min-h-11 rounded-md px-1 text-left font-semibold underline decoration-1 underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-9 ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : ""}`}>{children}</button>
  );
}

// ---------- a reply target, typed by the person ----------

export function TargetEditor({ locationId, minutes, own, defaultMinutes, ready, canChange, accountName, onSaved }: {
  locationId: string; minutes: number; own: boolean; defaultMinutes: number; ready: boolean; canChange: boolean; accountName: string; onSaved: () => void;
}) {
  const api = useApiClient();
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(String(minutes));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (next: number | null) => {
    setBusy(true); setError(null);
    try { await api.put("speed/target", { locationId, minutes: next }); setEdit(false); onSaved(); }
    catch (e) { setError((e as Error).message || "Could not save. Try again."); }
    finally { setBusy(false); }
  };
  if (!edit) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="target-line">
        <span>{minutes} min{own ? "" : " (default)"}</span>
        {canChange && ready && <button type="button" onClick={() => { setValue(String(minutes)); setEdit(true); }} aria-label={`Change the reply target for ${accountName}`} className="ds-press inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-primary hover:bg-muted sm:min-h-9" data-testid="target-edit"><Pencil aria-hidden className="size-3.5" />Change</button>}
      </span>
    );
  }
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= MIN_TARGET && n <= MAX_TARGET;
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) void save(n); }} data-testid="target-form">
      <label className="text-sm"><span className="sr-only">Reply target in minutes for {accountName}</span>
        <input type="number" inputMode="numeric" min={MIN_TARGET} max={MAX_TARGET} step={1} value={value} onChange={(e) => setValue(e.target.value)} autoFocus className="min-h-11 w-24 rounded-lg border bg-card px-3 text-sm sm:min-h-9" data-testid="target-input" />
        <span className="ml-1.5">minutes</span></label>
      <button type="submit" disabled={!valid || busy} className="ds-press min-h-11 rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40 disabled:opacity-50 sm:min-h-9" data-testid="target-save">Save</button>
      <button type="button" onClick={() => setEdit(false)} className="min-h-11 px-2 text-sm text-muted-foreground underline sm:min-h-9">Cancel</button>
      {own && <button type="button" onClick={() => void save(null)} disabled={busy} className="min-h-11 px-2 text-sm text-muted-foreground underline sm:min-h-9">Use the default ({defaultMinutes} min)</button>}
      <p className="w-full text-xs text-muted-foreground">You type this number. SubSync does not read it from your CRM. It changes which leads count as late for this client.</p>
      {error && <p className="w-full text-xs text-destructive" role="alert">{error}</p>}
    </form>
  );
}

// ---------- how fast replies come ----------

export type PictureData = {
  targetMinutes: number; targetsReady: boolean; canChangeTarget: boolean;
  accounts: Array<{ locationId: string; name: string; targetMinutes: number; ownTarget: boolean }>;
  window: { from: string; to: string; days: number; words: string };
  summary: HomeSummary;
  compare: { window: { from: string; to: string }; summary: Summary & { judged: number } } | null;
  trend: Array<TrendWeekData & { index: number }>;
  autoVsHuman: { onlyAutoPastTarget: number; read: number };
};

export function FastSection({ d, range, open, showAccount, reload }: { d: PictureData; range: CardRangeState; open: OpenList; showAccount: boolean; reload: () => void }) {
  const s = d.summary;
  const win = { from: d.window.from, to: d.window.to };
  const change = d.compare ? shareChange({ n: s.withinTarget, total: s.judged }, { n: d.compare.summary.withinTarget, total: d.compare.summary.judged }) : null;
  const inRange = range.resolved ? new Set(weeksIn(d.trend, range.resolved.current).map((w) => w.weekStart)) : new Set<number>();
  const weeks = d.trend.filter((w) => inRange.has(w.weekStart));
  const single = !showAccount ? d.accounts[0] : null;
  const list = (title: string, status: string) => () => open({ title, params: { status, ...win } });
  return (
    <section className="mb-10" aria-labelledby="fast-h" data-testid="speed-fast">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id="fast-h" className="text-lg font-semibold tracking-tight">How fast replies come</h2>
        <CardRange state={range} label="How fast replies come" compares={["none", "previous", "month"]} />
      </div>
      {s.judged === 0 ? (
        <EmptyState compact title="No new leads were judged in this range." body="A lead counts once a person has replied or its reply target has passed. Try a longer range." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
            <div className="min-w-0 border-l-2 border-border py-0.5 pl-4" data-testid="speed-typical">
              <p className="text-xs font-medium text-muted-foreground"><DefinitionTip term="Typical first reply" label="How the typical reply is worked out">The middle of the first reply times: half the leads were answered faster, half slower. It shows from {MIN_FOR_MEDIAN} replies.</DefinitionTip></p>
              <p className="tnum mt-1.5 text-[1.7rem] font-semibold leading-none tracking-tight"><CountUp value={s.medianSeconds === null ? "n/a" : fmtDuration(s.medianSeconds)} /></p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{s.medianSeconds === null ? s.typical.text : `${s.p90Seconds !== null ? `9 in 10 were answered within ${fmtDuration(s.p90Seconds)}. ` : ""}From ${s.answered.toLocaleString("en-US")} replies.`}</p>
            </div>
            <div className="min-w-0 border-l-2 border-border py-0.5 pl-4" data-testid="speed-intime">
              <p className="text-xs font-medium text-muted-foreground">Answered within {d.targetMinutes} minutes</p>
              <p className="tnum mt-1.5 text-[1.7rem] font-semibold leading-none tracking-tight">{s.pct.value === null ? `${s.withinTarget} of ${s.judged}` : s.pct.text}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{s.pct.value === null ? `A percentage shows from ${MIN_FOR_MEDIAN} leads (${s.judged} so far).` : `${s.withinTarget.toLocaleString("en-US")} of ${s.judged.toLocaleString("en-US")} leads. In time means a person replied inside the target.`}</p>
            </div>
          </div>
          <p className="mt-4 text-sm" data-testid="speed-breakdown">
            {s.judged.toLocaleString("en-US")} {s.judged === 1 ? "lead" : "leads"}:{" "}
            <NumberButton label={`${s.withinTarget.toLocaleString("en-US")} in time, open the list`} onClick={list("Answered in time", "within")} tone="good">{s.withinTarget.toLocaleString("en-US")} in time</NumberButton>,{" "}
            <NumberButton label={`${s.answeredLate.toLocaleString("en-US")} late, open the list`} onClick={list("Answered late", "late")} tone="warn">{s.answeredLate.toLocaleString("en-US")} late</NumberButton>,{" "}
            <NumberButton label={`${s.stillWaiting.toLocaleString("en-US")} not answered, open the list`} onClick={list("Not answered", "waiting")} tone={s.stillWaiting > 0 ? "bad" : undefined}>{s.stillWaiting.toLocaleString("en-US")} not answered</NumberButton>.
          </p>
          {change && <p className="mt-1 text-sm text-muted-foreground" data-testid="speed-compare">{change.text}, {range.resolved?.compare?.label ? `compared with ${range.resolved.compare.label}` : "against the other period"}.</p>}
          {d.autoVsHuman.onlyAutoPastTarget > 0 && (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="speed-auto">
              {d.autoVsHuman.onlyAutoPastTarget.toLocaleString("en-US")} of these only got an automatic message and no person replied.{" "}
              <button type="button" className={link} onClick={() => open({ title: "Only an automatic message", params: { status: "onlyAuto", ...win } })}>Show them</button>
            </p>
          )}
        </>
      )}
      {single && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="speed-target">
          Reply target for {single.name}: <TargetEditor locationId={single.locationId} minutes={single.targetMinutes} own={single.ownTarget} defaultMinutes={d.targetMinutes} ready={d.targetsReady} canChange={d.canChangeTarget} accountName={single.name} onSaved={reload} />
        </p>
      )}
      {weeks.length >= 2 && (
        <div className="mt-6" data-testid="speed-weeks">
          {weeks.some((w) => w.hitRate !== null) && weeks.every((w) => w.hitRate === null || w.hitRate === 0)
            ? <p className="text-sm text-muted-foreground" data-testid="speed-weeks-zero">No week in this range had a lead answered in time, so there is nothing to chart. The numbers above show every lead.</p>
            : weeks.every((w) => w.hitRate === null)
            ? <ChartPlaceholder title="Answered in time, by week" need={5} have={weeks.reduce((m, w) => Math.max(m, w.leads), 0)} unit="leads in one week">{" "}A week needs 5 judged leads before it shows a bar.</ChartPlaceholder>
            : <BarChart title="Answered in time, by week" axisLabel="% of leads" unit="%" format={(n) => `${Math.round(n)}`} sample={weeks.reduce((x, w) => x + w.leads, 0)} min={5} need="leads" noun="leads" bars={weekBars(weeks)}
                onSelect={(i) => open({ title: `Week of ${weekBars([weeks[i]])[0].label}`, params: { status: "all", week: String(weeks[i].index) } })} />}
          <p className="mt-1 text-xs text-muted-foreground">Each bar is the share of that week&apos;s leads answered in time. A week with fewer than 5 leads has no bar. Press a bar to see its leads.</p>
        </div>
      )}
    </section>
  );
}

// ---------- who is slow ----------

type CompareHome = { total: number; rows: CompareAccountRow[] };
type PeopleHome = { total: number; rows: ComparePersonRow[] };
type Paged<T> = { by: string; total: number; page: number; pages: number; from: number; to: number; rows: T[] };

function AccountRows({ rows, d, open, win, reload }: { rows: CompareAccountRow[]; d: PictureData; open: OpenList; win: { from: string; to: string }; reload: () => void }) {
  return (
    <ul className="@container divide-y border-y" data-testid="slow-accounts">
      {rows.map((a) => (
        <li key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 @xl:grid-cols-[minmax(0,1.3fr)_6rem_6.5rem_5rem_minmax(0,1.2fr)]" data-testid="slow-account-row" data-account={a.id}>
          <p className="min-w-0 truncate font-semibold" title={a.name}>{a.name}</p>
          <p className="tnum text-right text-sm @xl:text-left">{a.medianSeconds === null ? <span className="text-muted-foreground">n/a</span> : fmtDuration(a.medianSeconds)}<span className="text-xs text-muted-foreground @xl:hidden"> typical</span></p>
          <div className="col-span-2 flex flex-wrap items-center gap-x-4 text-sm @xl:contents">
            <p className="tnum">{a.ranked && a.hitRate !== null ? `${Math.round(a.hitRate * 100)}% in time` : <span className="text-muted-foreground">{a.progress}</span>}</p>
            <p className="tnum"><NumberButton label={`${a.name}: ${a.judged} leads, open the list`} onClick={() => open({ title: a.name, params: { status: "all", account: a.id, ...win } })}>{a.judged} {a.judged === 1 ? "lead" : "leads"}</NumberButton></p>
            <p className="min-w-0 text-muted-foreground" data-testid="slow-target">Target <TargetEditor locationId={a.id} minutes={a.targetMinutes} own={a.ownTarget} defaultMinutes={d.targetMinutes} ready={d.targetsReady} canChange={d.canChangeTarget} accountName={a.name} onSaved={reload} /></p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PeopleRows({ rows, open, win }: { rows: ComparePersonRow[]; open: OpenList; win: { from: string; to: string } }) {
  return (
    <ul className="divide-y border-y" data-testid="slow-people">
      {rows.map((p) => (
        <li key={p.userId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2" data-testid="slow-person-row">
          <span className="min-w-0 font-semibold"><PersonName p={p} /></span>
          <span className="tnum text-sm text-muted-foreground">
            {p.ranked && p.medianSeconds !== null ? <>{fmtDuration(p.medianSeconds)} typical · </> : <>{p.progress} · </>}
            <NumberButton label={`${p.replies} ${p.replies === 1 ? "reply" : "replies"}, ${p.label}, open the list`} onClick={() => open({ title: `Leads ${p.label} replied to first`, params: { status: "answered", person: p.userId, ...win } })}>{p.replies} {p.replies === 1 ? "reply" : "replies"}</NumberButton>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The full comparison, searched and paged on the server. */
function ComparePanel({ by, d, win, open, onBack, reload }: { by: "account" | "person"; d: PictureData; win: { from: string; to: string }; open: OpenList; onBack: () => void; reload: () => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const sp = new URLSearchParams({ part: "compare", by, ...win, page: String(page), size: "25" });
  if (q) sp.set("q", q);
  const { data, error, reload: again } = useData<Paged<CompareAccountRow & ComparePersonRow>>(`speed?${sp}`);
  return (
    <div className="mt-3" data-testid="slow-all">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={by === "account" ? "Search client accounts" : "Search people"} aria-label="Search this list" className="min-h-11 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm sm:min-h-9 sm:max-w-sm" data-testid="slow-search" />
        <button type="button" onClick={onBack} className={link}>Back to the short list</button>
      </div>
      {error ? <ErrorState error={error} onRetry={again} /> : !data ? <SkeletonRows rows={4} label="Loading..." /> : data.rows.length === 0 ? <EmptyState compact title="Nothing matches." /> : (
        <>
          {by === "account" ? <AccountRows rows={data.rows} d={d} open={open} win={win} reload={() => { reload(); again(); }} /> : <PeopleRows rows={data.rows} open={open} win={win} />}
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.from} to {data.to} of {data.total}</span>
            {data.pages > 1 && <span className="flex items-center gap-2"><button type="button" disabled={data.page === 0} onClick={() => setPage(data.page - 1)} className={`${link} disabled:opacity-40`}>Previous</button><button type="button" disabled={data.page >= data.pages - 1} onClick={() => setPage(data.page + 1)} className={`${link} disabled:opacity-40`}>Next</button></span>}
          </div>
        </>
      )}
    </div>
  );
}

export function SlowSection({ d, accounts, people, seePeople, multi, open, reload }: {
  d: PictureData; accounts: CompareHome; people: PeopleHome; seePeople: boolean; multi: boolean; open: OpenList; reload: () => void;
}) {
  const tabs = [...(multi ? [{ key: "account" as const, label: "Client accounts", n: accounts.total }] : []), ...(seePeople ? [{ key: "person" as const, label: "People", n: people.total }] : [])];
  const [tab, setTab] = useState<"account" | "person">(multi ? "account" : "person");
  const [all, setAll] = useState(false);
  const win = { from: d.window.from, to: d.window.to };
  if (tabs.length === 0) return null;
  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;
  const rows = active === "account" ? accounts : people;
  return (
    <section className="mb-10" aria-labelledby="slow-h" data-testid="speed-slow">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="slow-h" className="text-lg font-semibold tracking-tight">Who is slow</h2>
        {tabs.length > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Compare">
            {tabs.map((t) => <button key={t.key} type="button" aria-pressed={active === t.key} onClick={() => { setTab(t.key); setAll(false); }} className={`ds-press min-h-11 rounded-md px-2.5 text-sm font-medium sm:min-h-9 ${active === t.key ? "bg-accent text-foreground underline underline-offset-4" : "text-muted-foreground hover:bg-muted"}`}>{t.label} {t.n}</button>)}
          </div>
        )}
      </div>
      <p className="mb-2 text-sm text-muted-foreground">{active === "account" ? `Slowest first, over the same range. A client needs ${MIN_FOR_MEDIAN} judged leads to be ranked; the others show how many they have so far.` : "Slowest typical first reply first. A person needs 3 replies to be ranked; the others show how many they have so far."}</p>
      {rows.total === 0 ? <EmptyState compact title={active === "account" ? "No client has enough leads in this range yet." : "Nobody has replied in this range yet."} /> : all ? (
        <ComparePanel by={active} d={d} win={win} open={open} onBack={() => setAll(false)} reload={reload} />
      ) : (
        <>
          {active === "account" ? <AccountRows rows={accounts.rows} d={d} open={open} win={win} reload={reload} /> : <PeopleRows rows={people.rows} open={open} win={win} />}
          {rows.total > rows.rows.length && <p className="mt-1 text-right"><button type="button" onClick={() => setAll(true)} className={link} data-testid="slow-see-all">See all {rows.total.toLocaleString("en-US")}</button></p>}
        </>
      )}
    </section>
  );
}
