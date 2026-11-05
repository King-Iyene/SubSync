"use client";

import { Check, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmtStat, fmtFull, dayLabel } from "@/lib/analytics/chart-format";
import { filterQuery, ReportFilterBar, useReportApi, useReportFilter } from "./report-filter";
import { ModeToggle, TimeChart, useChartMode } from "../ds/time-chart";
import type { AccessKind } from "@/lib/access";
import { specDay, specPeriod, specRange, specRemoved, specSignUps, specSource } from "@/lib/analytics/growth-records";
import type { Change, GoalStatus, GrowthData, LeagueRow, Period } from "@/lib/analytics/growth";
import { ApiError, useApiClient } from "../session";
import { SourceDonut } from "../ds/growth-chart";
import { EmptyState, Skeleton } from "../ds";
import { fmtInt } from "../ui";
import { WhatIs } from "../ds/what-is";
import { EmailLeads } from "./today-emails";
import { TabIntro } from "./today-flow";
import type { TodayModel } from "./today-model";

// The Growth tab of Today: how many new email leads each client is getting, whether that is rising or falling, and whether the month is on track for its goal. Every number
// opens the people behind it. Read only (the two settings it keeps, a monthly goal and which addresses are left out, live in SubSync, never in the CRM). Rules: docs/METRICS.md.

const PERIODS: Array<{ p: Period; label: string; against: string; info: string }> = [
  { p: "today", label: "Today", against: "yesterday so far", info: "New email leads since midnight, one per person. Compared with yesterday up to the same time." },
  { p: "week", label: "This week", against: "last week so far", info: "New email leads since Monday, one per person. Compared with last week up to the same day and time." },
  { p: "month", label: "This month", against: "last month so far", info: "New email leads since the 1st, one per person. Compared with last month up to the same day." },
  { p: "all", label: "All time", against: "", info: "Every person SubSync holds with a usable email, counted once." },
];

function ChangeLine({ c, against, compact = false, vs = false }: { c: Change; against: string; compact?: boolean; vs?: boolean }) {
  if (c.previous === null) return <span className="t-small t-quiet">Since the first contact</span>;
  if (c.pct === null) {
    // A table row shows the plain difference instead of a percentage the earlier figure is too small to support.
    const diff = c.count - c.previous;
    if (compact) return <span className="t-small t-quiet" title={`${fmtInt(c.count)} now, ${fmtInt(c.previous)} ${against}. ${c.note ?? ""}`}>{diff === 0 ? "Same as last week" : diff > 0 ? `\u25B2 ${diff} more` : `\u25BC ${Math.abs(diff)} fewer`}</span>;
    return <span className="t-small t-quiet" title={c.note ?? undefined}>Too few to compare</span>;
  }
  const tone = c.direction === "up" ? "text-[var(--t-ok)]" : c.direction === "down" ? "text-[var(--t-bad)]" : "text-[var(--t-ink2)]";
  return <span className={`t-small ${tone}`} title={`${fmtInt(c.count)} now, ${fmtInt(c.previous)} ${against}`}>{c.direction === "up" ? "▲ Up" : c.direction === "down" ? "▼ Down" : "No change"}{c.direction === "same" ? "" : ` ${Math.abs(c.pct)}%`}<span className="t-quiet"> {vs ? "vs" : "on"} {against}</span></span>;
}

function Section({ id, title, hint, children, right }: { id: string; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div><h3 id={id} className="t-title">{title}{hint && <> <WhatIs text={hint} /></>}</h3>{hint && <p className="t-small t-quiet mt-0.5">{hint}</p>}</div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A goal number you can type: a pencil opens a small box, Enter saves, Esc cancels, empty removes the goal. */
function GoalInline({ locationId, goal, name, onSaved, disabled }: { locationId: string; goal: number | null; name: string; onSaved: () => void; disabled: boolean }) {
  const api = useApiClient();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const t = text.trim().replace(/,/g, "");
    const n = t === "" ? null : Number(t);
    if (n !== null && (!Number.isInteger(n) || n < 1)) { setErr("Type a whole number, 1 or more."); return; }
    setBusy(true); setErr(null);
    try { await api.post("today/growth/goal", { locationId, goal: n }); setEdit(false); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "That did not save. Please try again."); }
    finally { setBusy(false); }
  };
  if (!edit) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {goal !== null && <span className="t-num" data-testid="goal-value">{fmtInt(goal)}</span>}
        {goal === null && disabled && <span className="t-quiet" data-testid="goal-value">No goal</span>}
        {!disabled && <button type="button" onClick={() => { setText(goal === null ? "" : String(goal)); setErr(null); setEdit(true); }} aria-label={goal === null ? `Set a monthly goal for ${name}` : `Change the monthly goal for ${name}`} title="Set the number of new email leads you want this month" data-testid="goal-edit"
          className={`ds-press inline-flex items-center justify-center rounded-[4px] text-[var(--t-ink2)] hover:bg-[var(--t-wash)] hover:text-[var(--t-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] ${goal === null ? "h-7 px-2 text-sm underline decoration-[var(--t-rule2)] underline-offset-4" : "size-7"}`}>{goal === null ? "Set goal" : <Pencil aria-hidden className="size-3.5" />}</button>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input autoFocus inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Monthly goal for ${name}`} placeholder="Leads" data-testid="goal-input"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") { e.stopPropagation(); setEdit(false); } }}
        className="t-num h-8 w-20 rounded-[4px] border border-[var(--t-rule2)] bg-[var(--t-lift)] px-2 text-sm outline-none focus-visible:border-[var(--t-accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/30" />
      <button type="button" disabled={busy} onClick={() => void save()} aria-label="Save goal" data-testid="goal-save" className="ds-press inline-flex size-8 items-center justify-center rounded-[4px] bg-primary text-primary-foreground disabled:opacity-50"><Check aria-hidden className="size-4" /></button>
      <button type="button" onClick={() => setEdit(false)} aria-label="Cancel" className="ds-press inline-flex size-8 items-center justify-center rounded-[4px] text-[var(--t-ink2)] hover:bg-[var(--t-wash)]"><X aria-hidden className="size-4" /></button>
      {err && <span role="alert" className="t-small basis-full text-[var(--t-bad)]">{err}</span>}
    </span>
  );
}

const STATE_WORD: Record<GoalStatus["state"], string> = { reached: "Goal reached", on_track: "On track", behind: "Behind", not_enough: "Not enough data yet" };
function GoalBar({ s }: { s: GoalStatus }) {
  const tone = s.state === "behind" ? "var(--t-warn)" : s.state === "not_enough" ? "var(--t-ink3)" : "var(--t-ok)";
  return (
    <div>
      <div className="h-1.5 w-full rounded-full bg-[var(--t-sunk)]" role="img" aria-label={`${fmtInt(s.count)} of ${fmtInt(s.goal)}, ${Math.round(s.share * 100)}%`}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round(s.share * 100))}%`, background: tone }} />
      </div>
      <p className="t-small mt-2"><span className="font-medium" style={{ color: tone }} data-testid="goal-state">{STATE_WORD[s.state]}</span><span className="t-quiet">. {s.note}</span></p>
    </div>
  );
}

export function GrowthTab({ m, g: headerG, error: headerError, reload: headerReload, kind, clients }: { m: TodayModel; g: GrowthData | null; loading: boolean; error: string | null; reload: () => void; kind: AccessKind; clients?: Array<{ id: string; name: string }> }) {
  const f = useReportFilter("g", "30d");
  const api = useReportApi(f);
  const [mode, setMode] = useChartMode("growth");
  // Until the tab's own bar is changed it shows the read the page already made (the header's clients, the last 30 days). Changed, it reads its own.
  const own = f.differs;
  const query = filterQuery(f);
  const [mine, setMine] = useState<{ g: GrowthData | null; error: string | null }>({ g: null, error: null });
  const latest = useRef(0);
  const loadOwn = useCallback(async () => {
    if (!own || !f.range) return;
    const n = ++latest.current;
    try { const d = await api.get<GrowthData>(`today/growth${query ? `?${query}` : ""}`); if (n === latest.current) setMine({ g: d, error: null }); }
    catch (e) { if (n === latest.current) setMine((s) => ({ g: s.g, error: e instanceof ApiError && e.status !== 500 ? e.message : "Growth could not be read. Please try again." })); }
  }, [api, own, query, f.range]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadOwn(); }, [loadOwn]);
  const g = own ? mine.g : headerG, error = own ? mine.error : headerError;
  const reload = () => { headerReload(); void loadOwn(); };
  const [day, setDay] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [domains, setDomains] = useState<string | null>(null);
  const canEdit = kind === "agency"; // a business owner and a client's staff read; the company that looks after the clients sets goals and rules
  const bar = <ReportFilterBar f={f} label="Growth" clients={kind === "agency" ? clients : undefined} datesNote="Dates drive the counter, the chart, the sources and the sign ups. The goal is always for this month. Today, This week and This month always mean those calendar stretches." />;
  if (error && !g) return <div data-testid="growth-tab" className="max-w-5xl"><TabIntro name="Growth" />{bar}<EmptyState title="Growth could not be read" body={error} action={<button type="button" onClick={reload} className="ds-press h-9 cursor-pointer rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm">Try again</button>} /></div>;
  if (!g) return <div data-testid="growth-tab" className="max-w-5xl"><TabIntro name="Growth" />{bar}<div className="space-y-4" role="status" aria-busy="true" aria-label="Counting email leads"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /></div></div>;
  if (g.accounts === 0) return <div data-testid="growth-tab" className="max-w-5xl"><TabIntro name="Growth" />{bar}<EmptyState title="No clients to count yet" body="Growth counts new email leads for each client. It appears once SubSync has read a client." /></div>;
  const rangeWord = g.range.label.toLowerCase(), against = `the ${g.range.days} ${g.range.days === 1 ? "day" : "days"} before`;
  const none = g.changes.all.count === 0 && g.gross.signUps === 0;
  const multi = g.scope === "agency";
  const open = (p: Period) => m.open(specPeriod(g, p));
  const removedTotal = Object.values(g.gross.removed).reduce((s, n) => s + n, 0);
  const saveRules = async (excludeRoleAddresses: boolean, internal: string) => {
    setSaving(true); setRulesError(null);
    try { await api.post("today/growth/settings", { excludeRoleAddresses, internalDomains: internal.split(/[\s,;]+/).filter(Boolean) }); setDomains(null); reload(); }
    catch (e) { setRulesError(e instanceof ApiError ? e.message : "That did not save. Please try again."); }
    finally { setSaving(false); }
  };
  const one = !multi ? g.league[0] : null;
  const gs = g.goal.status;

  return (
    <div data-testid="growth-tab" className="max-w-5xl">
      <TabIntro name="Growth" />
      {bar}
      {g.partial && <p className="t-small t-quiet mb-4" data-testid="growth-partial">SubSync counted the newest 150,000 contacts. Older ones are not in these numbers.</p>}
      {none && <p className="t-small t-quiet mb-6" data-testid="growth-none">No email leads yet. SubSync counts people who have a usable email on their contact. Contacts with no email are not counted.</p>}

      <ul className="mb-10 grid grid-cols-2 items-stretch gap-x-6 gap-y-6 md:grid-cols-3 xl:grid-cols-5" data-testid="growth-counters">
        <li className="min-w-0 border-t border-[var(--t-rule)] pt-3">
          <button type="button" onClick={() => m.open(specRange(g))} title={`${fmtFull(g.range.count)} new email leads, ${rangeWord}. See them.`} data-testid="growth-range" data-count={g.range.count} aria-label={`${g.range.label}: ${fmtFull(g.range.count)} new email leads. See them.`}
            className="ds-press flex h-full w-full min-w-0 cursor-pointer flex-col rounded-[4px] text-left hover:bg-[var(--t-wash)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
            <span className="t-label block truncate">{g.range.label}</span>
            <span className="t-figure t-num mt-2 block max-w-full truncate">{fmtStat(g.range.count)}</span>
            <span className="mt-1.5 block"><ChangeLine c={g.range.change} against={against} vs /></span>
          </button>
        </li>
        {PERIODS.map((x) => {
          const c = g.changes[x.p];
          return (
            <li key={x.p} className="min-w-0 border-t border-[var(--t-rule)] pt-3">
              <button type="button" onClick={() => open(x.p)} title={x.info} data-testid={`growth-${x.p}`} data-count={c.count} aria-label={`${x.label}: ${fmtInt(c.count)} new email leads. ${x.info} See them.`}
                className="ds-press flex h-full w-full min-w-0 cursor-pointer flex-col rounded-[4px] text-left hover:bg-[var(--t-wash)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                <span className="t-label block truncate">{x.label}</span>
                <span className="t-figure t-num mt-2 block max-w-full truncate" title={fmtFull(c.count)}>{fmtStat(c.count)}</span>
                <span className="mt-1.5 block"><ChangeLine c={c} against={x.against} /></span>
              </button>
            </li>
          );
        })}
      </ul>

      <Section id="growth-chart-h" title={`New email leads each day, ${rangeWord}`} hint="One mark a day, one person once. The dashed line is the average of the 7 days before. Select a day to see its people."
        right={<span className="flex flex-wrap items-center gap-3"><ModeToggle mode={mode} onChange={setMode} label="New email leads each day" />{g.badge ? (
          <span data-testid="growth-badge" title="The last 7 complete days against the 7 before them" className={`t-small inline-flex items-center rounded-[4px] border px-2 py-1 ${g.badge.direction === "up" ? "border-[var(--t-ok)] text-[var(--t-ok)]" : g.badge.direction === "down" ? "border-[var(--t-bad)] text-[var(--t-bad)]" : "border-[var(--t-rule2)] text-[var(--t-ink2)]"}`}>
            {g.badge.direction === "up" ? "▲ Rising" : g.badge.direction === "down" ? "▼ Falling" : "Steady"}{g.badge.direction === "same" ? "" : ` ${Math.abs(g.badge.pct)}%`}<span className="t-quiet ml-1">last 7 days</span>
          </span>
        ) : <span className="t-small t-quiet" data-testid="growth-badge-none" title="A rate needs 14 complete days and at least 5 leads in the earlier week.">Rate: not enough data yet</span>}</span>}>
        <TimeChart testId="growth-chart" mode={mode} selectedId={day} label={`New email leads a day, ${rangeWord}, with the 7 day average`} noun="Day"
          points={g.series.map((p) => ({ id: p.day, label: p.label, short: dayLabel(p.day, g.range.days), partial: p.partial }))} series={[{ key: "leads", name: "New email leads", colour: "var(--t-c1)", values: g.series.map((p) => p.count) }]}
          avg={g.series.map((p) => p.avg7)} onPick={(i) => { const d = g.series[i].day; setDay(d); m.open(specDay(g, d)); }} />
      </Section>

      <div className="grid grid-cols-1 gap-x-14 lg:grid-cols-2">
        <Section id="growth-gross-h" title="Sign ups, then people" hint={`${g.range.label}. Copies, test records and staff are taken out.`}>
          <ul className="divide-y divide-[var(--t-rule)] border-y border-[var(--t-rule)]" data-testid="growth-gross">
            <GrossRow label="Sign ups with an email" n={g.gross.signUps} onOpen={() => m.open(specSignUps(g))} testId="gross-signups" info="Every contact added with an email in these dates, before anything is taken out." />
            {([["duplicate", "Extra copies of a person", "The same person again: same email once case, dots and +tags are ignored."], ["junk", "Test or junk records", "Names or emails like test, asdf or example.com, and addresses that are not valid."], ["staff", "Your own staff", "Addresses at the domains you listed as your own."], ["role", "Shared mailboxes", "Addresses like info@ or sales@, which are a business, not a person."]] as const)
              .filter(([k]) => k !== "role" || g.rules.excludeRoleAddresses).map(([k, label, info]) => (
                <GrossRow key={k} label={label} n={g.gross.removed[k]} minus onOpen={() => m.open(specRemoved(g, k))} testId={`gross-${k}`} info={info} />
              ))}
            <GrossRow label="Email leads counted" n={g.gross.unique} strong onOpen={() => open("month")} testId="gross-unique" info="Unique people with a usable email: what the numbers above count." />
          </ul>
          {removedTotal > 0 && <p className="t-small t-quiet mt-2">{fmtInt(removedTotal)} of {fmtInt(g.gross.signUps)} sign ups were taken out.</p>}
        </Section>

        <Section id="growth-goal-h" title="This month's goal (always this month)" hint={multi ? "Set one for each client in the table below." : "How many new email leads you want this month."}>
          {multi ? (
            g.goal.accountsWithGoal === 0 ? <p className="t-small t-quiet" data-testid="goal-none">No client has a goal yet. Use the pencil in the table below to set one.</p>
              : <div data-testid="goal-card"><p className="t-small mb-2"><span className="t-num" data-testid="goal-sum">{fmtInt(g.goal.count)}</span> of <span className="t-num">{fmtInt(g.goal.total ?? 0)}</span> across {g.goal.accountsWithGoal} {g.goal.accountsWithGoal === 1 ? "client" : "clients"} with a goal</p>{gs && <GoalBar s={gs} />}</div>
          ) : one ? (
            <div data-testid="goal-card">
              {!g.setup.goalsReady ? <p className="t-small t-quiet" data-testid="goal-needs-update">Goals need the latest database update. Ask the person who manages SubSync to apply it.</p> : (
                <>
                  <p className="mb-2 flex items-center gap-3 text-sm">Goal <GoalInline locationId={one.locationId} goal={one.goal} name={one.name} disabled={!canEdit} onSaved={reload} /></p>
                  {one.status ? <GoalBar s={one.status} /> : <p className="t-small t-quiet">{canEdit ? "Set a goal to see progress and a month-end forecast." : "No goal has been set for this month."}</p>}
                </>
              )}
            </div>
          ) : null}
        </Section>
      </div>

      <Section id="growth-source-h" title="Where email leads come from" hint={`${g.range.label} against ${against}. Select a source to see its people.`}>
        {g.mix.total === 0 ? <p className="t-small t-quiet" data-testid="source-none">No email leads in these dates.</p> : (
          <div className="grid grid-cols-1 gap-x-14 gap-y-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <SourceDonut rows={g.mix.rows} total={g.mix.total} selected={source} label={`Where email leads came from, ${rangeWord}`} rangeWord={rangeWord} onPick={(s) => { setSource(s); m.open(specSource(g, s)); }} />
            <p className="t-small self-start border-t border-[var(--t-rule)] pt-3 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" data-testid="source-line">{g.mix.line}</p>
          </div>
        )}
      </Section>

      {multi && (
        <Section id="growth-league-h" title="Clients by growth" hint="Fastest growing first, this week so far against last week to the same point. Select a number to see its people.">
          <div className="t-surface overflow-x-auto" data-testid="growth-league">
            <ul className="min-w-[44rem] divide-y divide-[var(--t-rule)]">
              <li aria-hidden className={`t-label grid ${LEAGUE_TRACKS} gap-x-3 py-2 pl-4 pr-3`}><span>Client</span><span className="text-right">This week</span><span>Against last week</span><span className="text-right">This month</span><span>Monthly goal</span></li>
              {g.league.map((r) => <LeagueItem key={r.locationId} r={r} m={m} g={g} canEdit={canEdit} reload={reload} goalsReady={g.setup.goalsReady} />)}
            </ul>
          </div>
        </Section>
      )}

      <EmailLeads filterClient={f.client && f.client !== "all" ? f.client : null} from={own && f.range && !f.range.problem ? f.range.from : null} to={own && f.range && !f.range.problem ? f.range.to : null} />

      <Section id="growth-rules-h" title="How leads are counted">
        <p className="t-small t-quiet max-w-2xl">One person is one lead, found by their email (capital letters, spaces, a +tag and the dots in a Gmail name do not make a new person). A person counts once for each client. Contacts with no email, extra copies, test records, your own staff{g.rules.excludeRoleAddresses ? " and shared mailboxes such as info@" : ""} are left out.</p>
        {canEdit && (
          <div className="mt-4 grid max-w-2xl gap-3" data-testid="growth-rules">
            <label className="flex min-h-9 items-center gap-2.5 text-sm">
              <input type="checkbox" className="size-4" checked={g.rules.excludeRoleAddresses} disabled={saving || !g.setup.settingsReady} onChange={(e) => void saveRules(e.target.checked, g.rules.internalDomains.join(" "))} data-testid="rules-role" />
              Leave out shared mailboxes such as info@ and sales@
            </label>
            <label className="grid gap-1 text-sm">
              <span>Your own staff email domains <span className="t-quiet">(separate with spaces)</span></span>
              <span className="flex flex-wrap items-center gap-2">
                <input value={domains ?? g.rules.internalDomains.join(" ")} onChange={(e) => setDomains(e.target.value)} disabled={saving || !g.setup.settingsReady} placeholder="youragency.com" aria-label="Your own staff email domains" data-testid="rules-domains"
                  className="h-9 w-72 max-w-full rounded-[4px] border border-[var(--t-rule2)] bg-[var(--t-lift)] px-2.5 text-sm outline-none focus-visible:border-[var(--t-accent)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/30" />
                <button type="button" disabled={saving || domains === null || !g.setup.settingsReady} onClick={() => void saveRules(g.rules.excludeRoleAddresses, domains ?? "")} data-testid="rules-save"
                  className="ds-press h-9 rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm font-medium hover:border-primary hover:text-primary disabled:opacity-50">Save</button>
              </span>
            </label>
            {!g.setup.settingsReady && <p className="t-small t-quiet">These two settings need the latest database update.</p>}
            {rulesError && <p role="alert" className="t-small text-[var(--t-bad)]">{rulesError}</p>}
          </div>
        )}
      </Section>
    </div>
  );
}

function GrossRow({ label, n, minus, strong, onOpen, testId, info }: { label: string; n: number; minus?: boolean; strong?: boolean; onOpen: () => void; testId: string; info: string }) {
  return (
    <li>
      <button type="button" onClick={onOpen} disabled={n === 0} title={info} data-testid={testId} data-count={n} aria-label={`${label}: ${fmtInt(n)}. ${info}${n > 0 ? " See them." : ""}`}
        className={`ds-press grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1 text-left hover:bg-[var(--t-wash)] disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] ${strong ? "font-medium" : ""}`}>
        <span className={minus ? "pl-3 text-[var(--t-ink2)]" : ""}>{minus ? "− " : ""}{label}</span>
        <span className="t-num">{fmtInt(n)}</span>
      </button>
    </li>
  );
}

const LEAGUE_TRACKS = "grid-cols-[minmax(0,1fr)_5.5rem_11rem_5.5rem_11rem]";
function LeagueItem({ r, m, g, canEdit, reload, goalsReady }: { r: LeagueRow; m: TodayModel; g: GrowthData; canEdit: boolean; reload: () => void; goalsReady: boolean }) {
  return (
    <li data-testid="league-row" data-location={r.locationId} className={`ds-row grid ${LEAGUE_TRACKS} items-center gap-x-3 py-2 pl-4 pr-3`}>
      <span className="min-w-0 truncate font-semibold" title={r.name}>{r.name}{r.signal && <span className="t-small ml-2 font-normal" style={{ color: r.signal.direction === "drop" ? "var(--t-bad)" : "var(--t-ok)" }}>{r.signal.direction === "drop" ? "Dropping" : "Spiking"}</span>}</span>
      <button type="button" onClick={() => m.open(specPeriod(g, "week", r.locationId))} data-testid="league-week" data-count={r.week.count} disabled={r.week.count === 0} aria-label={`${r.name}: ${r.week.count} new email leads this week. See them.`} title="New email leads since Monday"
        className="t-num ds-press w-full rounded-[4px] px-1 text-right hover:bg-[var(--t-wash)] disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{fmtInt(r.week.count)}</button>
      <span className="min-w-0 truncate"><ChangeLine c={r.week} against="last week" compact /></span>
      <button type="button" onClick={() => m.open(specPeriod(g, "month", r.locationId))} data-testid="league-month" data-count={r.month} disabled={r.month === 0} aria-label={`${r.name}: ${r.month} new email leads this month. See them.`} title="New email leads since the 1st"
        className="t-num ds-press w-full rounded-[4px] px-1 text-right hover:bg-[var(--t-wash)] disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-[var(--ring)]">{fmtInt(r.month)}</button>
      <span className="min-w-0 text-sm">
        {goalsReady ? <GoalInline locationId={r.locationId} goal={r.goal} name={r.name} disabled={!canEdit} onSaved={reload} /> : <span className="t-quiet">Needs update</span>}
        {r.status && <span className="t-small t-quiet block truncate" title={r.status.note}>{STATE_WORD[r.status.state]}</span>}
      </span>
    </li>
  );
}
