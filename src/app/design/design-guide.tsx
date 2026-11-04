"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { accentTokens, contrast, parseColour } from "@/lib/design/color";
import { EMPTY_FILTER, type FilterValue } from "@/lib/design/filters";
import { THEME_PREFS } from "@/lib/design/ui-logic";
import {
  BarChart, CardRange, DataList, LineChart, DefinitionTip, Distribution, DrillPanel, EmptyState, ErrorState, FilterDrawer, HowTo, InlineAlert, LeadDrawer, ModuleTabs, MyDayView, Page, ScopeFilterBar,
  Section, Skeleton, SkeletonCards, SkeletonRows, Sparkline, StatusLine, ChartPlaceholder, useCardRange, useDrill, useTheme, type Column,
} from "../app/ds";
import { compareWeeks, totalsOf, weekBars, weeksIn, type TrendMember } from "@/lib/design/trend-bars";
import { ApiProvider } from "../app/session";
import { NAV } from "../app/nav";
import { Badge, Btn, Card, Stat } from "../app/ui";
import { SAMPLE_LEADS, SAMPLE_OPTIONS, SAMPLE_TREND, SAMPLE_WEEKS, sampleApi } from "./sample";
import { TodayBlocks } from "./today-blocks";

const MEMBER_COLUMNS: Array<Column<TrendMember>> = [
  { key: "name", header: "Lead", primary: true, width: "minmax(0,2fr)", cell: (m) => m.name },
  { key: "account", header: "Client account", width: "minmax(0,1.5fr)", cell: (m) => <span className="text-muted-foreground">{m.locationName}</span> },
  { key: "status", header: "What happened", width: "11rem", cell: (m) => <Badge tone={m.status === "within" ? "good" : m.status === "late" ? "warn" : "bad"}>{m.status === "within" ? "answered in time" : m.status === "late" ? "answered late" : "still waiting"}</Badge> },
];
const RANGE_START = { preset: "90d", compare: "previous" } as const;

// The style guide (stage D0). STYLE AWAITING KING'S APPROVAL. Everything on this page is the real component or the real token, not a picture of one:
// the swatches read the colours the browser is using, the ratios are computed from them, and the examples run on made-up data.
const GROUPS: Array<{ title: string; tokens: Array<[string, string]> }> = [
  { title: "Surfaces", tokens: [["background", "foreground"], ["card", "card-foreground"], ["popover", "popover-foreground"], ["muted", "muted-foreground"], ["accent", "accent-foreground"], ["secondary", "secondary-foreground"]] },
  { title: "Brand", tokens: [["primary", "primary-foreground"], ["gold", "gold-foreground"], ["sidebar", "sidebar-foreground"], ["sidebar-accent", "sidebar-accent-foreground"], ["sidebar-primary", "sidebar-primary-foreground"]] },
  { title: "Status (only ever for status, always with an icon or a word)", tokens: [["destructive", "background"], ["warning", "background"], ["success", "background"]] },
];
const CHARTS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];
const SWATCHES = ["#0a658b", "#d4ad58", "#e11d48", "#6366f1", "#02244f", "#facc15"];

function useTokenValues(root: React.RefObject<HTMLDivElement | null>, names: string[], key: string): Record<string, string> {
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    // Reading the browser's own colours after it has painted them; there is nothing to subscribe to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setV(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()])));
  }, [root, names, key]);
  return v;
}

function Ratio({ fg, bg, values, min = 4.5 }: { fg: string; bg: string; values: Record<string, string>; min?: number }) {
  const a = parseColour(values[fg] ?? ""), b = parseColour(values[bg] ?? "");
  if (!a || !b) return <span className="text-xs text-muted-foreground">...</span>;
  const r = contrast(a, b);
  return <span className="text-xs tabular-nums" data-testid="contrast-ratio" data-pass={r >= min}>{r.toFixed(1)}:1 {r >= min ? "passes" : "fails"}</span>;
}

export function DesignGuide() {
  const { pref, theme, setPref } = useTheme();
  const api = useMemo(() => sampleApi(), []);
  const root = useRef<HTMLDivElement>(null);
  const [accent, setAccent] = useState<string>("");
  const [filter, setFilter] = useState<FilterValue>(EMPTY_FILTER);
  const [clientFilter, setClientFilter] = useState<FilterValue>(EMPTY_FILTER);
  const [drawer, setDrawer] = useState<number | null>(null);
  const [tab, setTab] = useState(0);
  const drill = useDrill();
  const range = useCardRange("design-trend", RANGE_START);

  const a = accent ? accentTokens(accent, theme) : null;
  const style = a ? ({ "--primary": a.text, "--primary-foreground": accentTokens(a.text, theme)!.onFill, "--ring": a.text } as React.CSSProperties) : undefined;
  const names = useMemo(() => [...new Set([...GROUPS.flatMap((g) => g.tokens.flat()), ...CHARTS, "gold"])], []);
  const values = useTokenValues(root, names, `${theme}|${accent}`);
  const seeds = SAMPLE_LEADS.map((l) => ({ contactId: l.contactId, locationId: l.locationId, name: l.name, locationName: l.locationName, unassigned: l.unassigned, url: l.url }));

  return (
    <ApiProvider value={api}>
      <div ref={root} className={`${theme === "dark" ? "dark " : ""}min-h-screen bg-background text-foreground`} data-theme={theme} style={style}>
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
          <header className="mb-8 border-b pb-6">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="warn">Style awaiting King&apos;s approval</Badge><Badge tone="neutral">Sample data only</Badge></div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">SubSync style guide</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Recommended direction: calm and exact. Navy surfaces, one teal for what you can press, gold kept for the single thing we recommend, status colours only for status. Everything below is the real token or the real component, running on made-up data. Say &ldquo;approved&rdquo; or what to change.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div role="group" aria-label="Theme" className="inline-flex rounded-xl bg-muted p-1">
                {THEME_PREFS.map((p) => <button key={p} type="button" aria-pressed={pref === p} onClick={() => setPref(p)} className={`min-h-9 rounded-lg px-3 text-sm ${pref === p ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>{p === "system" ? "Match my device" : p === "dark" ? "Dark" : "Light"}</button>)}
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Try a company colour">
                <span className="text-xs text-muted-foreground">A company&apos;s own colour sits on top:</span>
                {SWATCHES.map((s) => <button key={s} type="button" aria-label={`Use ${s}`} aria-pressed={accent === s} onClick={() => setAccent(accent === s ? "" : s)} className={`size-8 rounded-full border-2 ${accent === s ? "border-foreground" : "border-transparent"}`} style={{ background: s }} />)}
                {a && <span className="text-xs text-muted-foreground">{a.adjusted || a.fillAdjusted ? "Nudged so text stays readable." : "Used exactly."}</span>}
              </div>
            </div>
          </header>

          <Section title="Colour" hint="Light and dark, both measured. Text needs 4.5 to 1, marks and rings 3 to 1; the unit test src/lib/__tests__/design-tokens.test.ts checks every pair in both themes.">
            <div className="space-y-5">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {g.tokens.map(([bg, fg]) => (
                      <li key={bg} className="overflow-hidden rounded-xl border">
                        <div className="flex h-16 items-center px-3 text-sm font-medium" style={{ background: `var(--${bg})`, color: `var(--${fg})` }}>Aa text on {bg}</div>
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><code>--{bg}</code><code className="text-muted-foreground">{values[bg]}</code><Ratio fg={fg} bg={bg} values={values} /></div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chart colours, always used in this order (checked for colour-blind separation)</h3>
                <ul className="flex flex-wrap gap-3">
                  {CHARTS.map((c, i) => <li key={c} className="flex items-center gap-2 text-xs"><span className="size-7 rounded-md" style={{ background: `var(--${c})` }} /><span>{i + 1}</span><code className="text-muted-foreground">{values[c]}</code><Ratio fg={c} bg="card" values={{ ...values, card: values.card ?? "#ffffff" }} min={3} /></li>)}
                </ul>
              </div>
            </div>
          </Section>

          <Section title="Type, space, shape and motion">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[1.65rem] font-semibold leading-tight tracking-tight">Page title, 26 px</p>
                <p className="text-base font-semibold">Block heading, 16 px</p>
                <p className="text-sm">Body, 14 px, 24 px line. The size most of the app is read at.</p>
                <p className="text-xs text-muted-foreground">Small and quiet, 12 px. Never for the only copy of anything important.</p>
                <p className="tnum text-2xl font-semibold">1,234.5 <span className="text-sm font-normal text-muted-foreground">numbers line up</span></p>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Spacing</dt><dd>4, 8, 12, 16, 24, 32 px</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Corners</dt><dd>8 px controls, 12 px lists, 16 px cards</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Raised surfaces</dt><dd>one soft shadow, never on a notice</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Motion</dt><dd>120 and 200 ms, off for reduced motion</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tap targets</dt><dd>36 px, 48 px on My day</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cards</dt><dd>one level, never a card in a card</dd></div>
              </dl>
            </div>
          </Section>

          <Section title="Menu" hint="The pilot menu. Everything else the app shows is under More or inside a module as a tab.">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(["", "Daily work", "Clients and people", "More", "Settings and help"] as const).map((g) => (
                <li key={g || "top"} className="rounded-xl border p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g || "Home"}</p>
                  <ul className="space-y-0.5 text-sm">{NAV.filter((n) => n.group === g && !n.parent).map((n) => <li key={n.id}>{n.label}</li>)}</ul>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Status words" hint="A status is plain text in the status colour with a thin rule on its left. No dot, no pill, no tint: the words carry the meaning.">
            <ul className="flex flex-wrap gap-x-6 gap-y-2" data-testid="badge-examples">
              <li><Badge tone="bad">never answered</Badge></li><li><Badge tone="bad">waiting 139 h</Badge></li><li><Badge tone="warn">no owner</Badge></li>
              <li><Badge tone="good">Healthy</Badge></li><li><Badge tone="info">Estimate</Badge></li><li><Badge>Counted</Badge></li>
            </ul>
          </Section>

          <Section title="Notices and errors" hint="One plain row with a thin rule in the status colour. No icon, no box. An error says what went wrong in words and gives its ID.">
            <div className="space-y-2">
              <InlineAlert tone="info">This list shows the first 50 of 3,000.</InlineAlert>
              <InlineAlert tone="success">The link is switched off.</InlineAlert>
              <InlineAlert tone="warning" title="3 accounts need approval">Approve the new permission, then run a sync.</InlineAlert>
              <InlineAlert tone="danger">The refresh failed for 1 account.</InlineAlert>
            </div>
            <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status line (the real one, one place above every page)</h3>
            <StatusLine />
          </Section>

          <Section title="Filters" hint="One bar, different for each person. A control with nothing to choose is absent; what is hidden is said in words.">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">A company with many client accounts</h3>
            <div className="rounded-xl border p-3"><ScopeFilterBar kind="agency" options={SAMPLE_OPTIONS} value={filter} onChange={setFilter} /></div>
            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">A client&apos;s staff (one account, so no account picker)</h3>
            <div className="rounded-xl border p-3"><ScopeFilterBar kind="client" options={SAMPLE_OPTIONS} value={clientFilter} onChange={setClientFilter} /></div>
            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">As the app draws it, closed, above a page</h3>
            <FilterDrawer kind="agency" value={filter} onChange={setFilter} />
          </Section>

          <Section title="List" hint="Ten rows and View all. View all keeps the header and the filters in place and pages by 25. A name opens the lead.">
            <DataList title="Leads waiting" rows={SAMPLE_LEADS} rowKey={(l) => l.contactId} onOpen={(_, i) => setDrawer(i)}
              columns={[
                { key: "name", header: "Lead", primary: true, width: "minmax(0,2fr)", cell: (l) => l.name },
                { key: "acct", header: "Client account", width: "minmax(0,1.5fr)", cell: (l) => <span className="text-muted-foreground">{l.locationName}</span> },
                { key: "wait", header: "Waiting", width: "9rem", cell: (l) => <Badge tone="bad">{l.neverAnswered ? "never answered" : `waiting ${Math.round(l.waitingMinutes / 60)} h`}</Badge> },
              ]} />
            <p className="mt-2 text-xs text-muted-foreground">Press a name to open the lead panel (previous and next arrows step through this list).</p>
            <LeadDrawer leads={seeds} index={drawer} onIndex={setDrawer} onClose={() => setDrawer(null)} />
          </Section>

          <Section title="Charts" hint="One approach: plain HTML, labelled scale from zero, a tooltip on every mark, a table for screen readers, one placeholder under the minimum sample.">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card title="Bars with a scale"><BarChart title="Answered within target, by week" axisLabel="% of new leads" unit="%" sample={80} min={5} need="leads" bars={SAMPLE_WEEKS.map((w) => ({ ...w, tone: w.value === null ? "series" : w.value >= 80 ? "good" : w.value >= 60 ? "warn" : "bad" }))} /></Card>
              <Card title="Ranked rows"><Distribution title="How long customers have waited" unit="" rows={[{ label: "Under 4 hours", value: 14 }, { label: "4 to 24 hours", value: 9, tone: "warn" }, { label: "1 to 7 days", value: 6, tone: "bad" }, { label: "Older than a week", value: 13, tone: "bad" }]} /></Card>
              <Card title="Trend"><Sparkline label="Open pipeline" values={[12, 14, 13, 17, 19, 18, 24, 26, 25, 31]} /></Card>
              <Card title="Trend on two axes (a line over days)"><LineChart title="Health score" ceiling={100} axisLabel="0 to 100" series={[{ label: "This quarter", tone: 1, points: [58, 60, 59, 63, 66, 70, 69, 74, 78, 81, 84].map((value, i) => ({ day: `2026-10-${String(i * 2 + 1).padStart(2, "0")}`, value })) }, { label: "Previous quarter, same dates", tone: "muted", dashed: true, points: [55, 54, 57, 56, 58, 60, 59, 61, 62, 63, 64].map((value, i) => ({ day: `2026-10-${String(i * 2 + 1).padStart(2, "0")}`, value })) }]} /></Card>
              <Card title="Under the minimum"><ChartPlaceholder title="Replies by week" need={5} have={2} unit="replies">{" "}Nothing is drawn from two points.</ChartPlaceholder></Card>
            </div>
          </Section>

          <Section title="A range on one card" hint="Each card that shows a number over time has its own range and comparison. The window is stated in words, carried in the address (r.design-trend=...), remembered next time, and a comparison on a tiny base gets no percentage.">
            <Card title="Replies answered in time">
              <CardRange state={range} label="Replies by week" compares={["none", "previous", "month", "year"]} maxDays={56} />
              {(() => {
                const win = range.resolved;
                const weeks = win ? weeksIn(SAMPLE_TREND, win.current) : SAMPLE_TREND;
                const cmp = win ? compareWeeks(SAMPLE_TREND, win.current, win.compare) : null;
                return (
                  <div className="mt-3">
                    {cmp?.change && <p className="mb-2 text-sm" data-testid="design-compare">{cmp.change.text}.</p>}
                    {win?.compare && cmp && !cmp.covered && <p className="mb-2 text-xs text-muted-foreground">There is not enough history to compare with {win.compare.label}.</p>}
                    <p className="text-xs text-muted-foreground" data-testid="design-total">{totalsOf(weeks).total} leads in this window.</p>
                  </div>
                );
              })()}
            </Card>
          </Section>

          <Section title="Click a chart to see what is behind it" hint="A bar that has leads behind it opens exactly those leads, with the same count in the chart and the list. A name opens the lead panel, whose arrows step through this list. Back to the chart keeps the bar marked.">
            {(() => {
              const weeks = range.resolved ? weeksIn(SAMPLE_TREND, range.resolved.current) : SAMPLE_TREND;
              const picked = drill.selected !== null ? weeks[drill.selected] : undefined;
              return (
                <Card title="Answered within target, by week">
                  <BarChart title="Answered within target, by week" axisLabel="% of new leads" unit="%" sample={totalsOf(weeks).total} min={5} need="leads" noun="leads" bars={weekBars(weeks)} onSelect={(i) => drill.select(i)} selected={drill.selected} />
                  {picked && <DrillPanel drill={drill} title={`Week of ${weekBars([picked])[0].label}`} count={picked.leads} noun="leads" rows={picked.members} columns={MEMBER_COLUMNS} rowKey={(m) => m.contactId}
                    toLead={(m) => ({ contactId: m.contactId, locationId: m.locationId, name: m.name, locationName: m.locationName, url: m.url })} />}
                </Card>
              );
            })()}
            <div className="mt-4"><HowTo id="design-example" title="A how-to note">Two lines at most, shown until the person hides them. Hiding is remembered in this browser.</HowTo></div>
          </Section>

          <Section title="Tabs, tips and states">
            <ModuleTabs value={tab} onChange={setTab} label="Example tabs" tabs={[
              { label: "Overview", node: <p className="text-sm text-muted-foreground">A short view. About six blocks, then stop.</p> },
              { label: "Lists", node: <p className="text-sm text-muted-foreground">Arrow keys move between tabs.</p> },
              { label: "Settings", node: <p className="text-sm text-muted-foreground">On a phone the row scrolls sideways by itself, never the page.</p> },
            ]} />
            <p className="mt-4 text-sm"><DefinitionTip term={<strong>Typical first reply</strong>}>The middle of all first reply times: half of the leads were answered faster, half slower.</DefinitionTip></p>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <EmptyState compact title="Nothing is waiting" body="New leads appear here as they come in." />
              <ErrorState error={new Error("Request failed (504)")} onRetry={() => undefined} />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <SkeletonRows rows={3} label="Loading list" />
              <div><SkeletonCards cards={2} label="Loading tiles" /><Skeleton className="mt-3 h-4 w-1/2" /></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Waiting right now" value="12" tone="bad" sub="past the target" /><Stat label="Answered in target" value="68%" sub="of 41 leads" /><Stat label="Typical reply" value="22 min" /><Stat label="Show rate" value="n/a" sub="needs 5 outcomes" /></div>
            <div className="mt-4 flex flex-wrap gap-2"><Btn variant="primary">Main action</Btn><Btn>Second action</Btn><Btn variant="ghost">Quiet action</Btn></div>
          </Section>

          <TodayBlocks />

          <Section title="Page template" hint="Title, one short sentence, actions, tabs, then the blocks.">
            <div className="rounded-2xl border p-4"><Page title="Page title" subtitle="One short sentence that says what the page is for." actions={<Btn variant="primary">Do the main thing</Btn>}><p className="text-sm text-muted-foreground">Blocks go here.</p></Page></div>
          </Section>

          <Section title="My day (phone first)" hint="What a setter or realtor opens: who to answer, who to call, what to mark. Large tap targets, one column.">
            <div className="mx-auto max-w-sm rounded-2xl border p-4"><MyDayView go={() => undefined} /></div>
          </Section>
        </main>
      </div>
    </ApiProvider>
  );
}
