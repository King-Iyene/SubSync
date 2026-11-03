"use client";

import { CountUp } from "../ds/count-up";
import { useState, type ReactNode } from "react";
import { shareChange } from "@/lib/design/range";
import { autoLine, autoVsHumanLines, copyLine, leadStatus, personProgressText, unknownSourceAction } from "@/lib/design/speed-text";
import { fmtDuration, MIN_FOR_MEDIAN, MIN_PER_PERSON, type AutoVsHuman, type Progress, type Summary } from "@/lib/analytics/speed-intel";
import type { Part } from "@/lib/analytics/speed-window";
import { useData } from "../session";
import { CardRange, ChartPlaceholder, DefinitionTip, DrillPanel, ErrorState, InlineAlert, SkeletonRows, useCardRange, useDrill, type CardRangeState, type Column, type LeadSeed } from "../ds";
import { Badge, Btn, Card, ExtLink, fmtInt, Stat, Table, Td, Th } from "../ui";

// The cards of the Speed to lead screen. Each card has its own range and comparison (KF-4), asks the server for exactly that window, and every figure on it
// opens the list of leads behind it (KF-6): the lists come from the same rows as the figures, so the count in a list's heading is the number on the card.

export type PersonView = { label: string; state: "named" | "former" | "needs_permission" | "unavailable"; photoUrl: string | null; initials: string };
export type LeadView = {
  locationId: string; locationName: string; contactId: string; name: string; url: string;
  status: "within" | "late" | "waiting"; neverAnswered: boolean; minutes: number; source: string;
  repliedBy: PersonView | null; owner: PersonView | null; unassigned: boolean; autoSeconds: number | null; personSeconds: number | null; detailed: boolean;
};
export type MembersView = { count: number; shown: number; rows: LeadView[] };

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

// ---- small pieces ----

// A person: their picture when the CRM has one, else their initials, and their name. A name that could not be read says why, in words (never an id).
export function PersonName({ p }: { p: PersonView }) {
  const [broken, setBroken] = useState(false);
  if (p.state === "needs_permission") return <span className="text-warning" data-person-state="needs_permission">{p.label}</span>;
  if (p.state !== "named") return <span className="text-muted-foreground" data-person-state={p.state}>{p.label}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-person-state="named">
      {p.photoUrl && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.photoUrl} alt="" width={20} height={20} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-5 shrink-0 rounded-full object-cover" />
        : <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6rem] font-semibold text-muted-foreground">{p.initials}</span>}
      <span className="truncate">{p.label}</span>
    </span>
  );
}

export function leadColumns(showAccount: boolean): Array<Column<LeadView>> {
  const cols: Array<Column<LeadView>> = [
    { key: "name", header: "Lead", primary: true, width: "minmax(0,1.6fr)", cell: (l) => l.name },
  ];
  if (showAccount) cols.push({ key: "account", header: "Client account", width: "minmax(0,1.2fr)", cell: (l) => <span className="text-muted-foreground">{l.locationName}</span> });
  cols.push(
    { key: "source", header: "Source", width: "minmax(0,1.1fr)", cell: (l) => <span className="text-muted-foreground">{l.source}</span> },
    {
      key: "what", header: "What happened", width: "minmax(0,1.5fr)",
      cell: (l) => { const s = leadStatus(l); const a = autoLine(l); return <><Badge tone={s.tone}>{s.text}</Badge>{a && <span className="mt-0.5 block text-xs text-muted-foreground">{a}</span>}</>; },
    },
    {
      key: "who", header: "Who", width: "minmax(0,1.2fr)",
      cell: (l) => l.status !== "waiting" && l.repliedBy
        ? <span className="inline-flex min-w-0 items-center gap-1.5"><span className="text-xs text-muted-foreground">Replied by</span><PersonName p={l.repliedBy} /></span>
        : l.owner ? <span className="inline-flex min-w-0 items-center gap-1.5"><span className="text-xs text-muted-foreground">Owner</span><PersonName p={l.owner} /></span>
        : <Badge tone="warn">no owner</Badge>,
    },
    { key: "open", header: "", width: "7rem", align: "right", cell: (l) => <ExtLink href={l.url}>Open contact</ExtLink> },
  );
  return cols;
}

export const leadSeed = (l: LeadView): LeadSeed => ({
  contactId: l.contactId, locationId: l.locationId, name: l.name, locationName: l.locationName, url: l.url,
  unassigned: l.status === "waiting" && l.unassigned, owner: l.owner && l.owner.state === "named" ? l.owner.label : null,
  note: [`${leadStatus(l).text[0].toUpperCase()}${leadStatus(l).text.slice(1)}.`, autoLine(l) ? `${autoLine(l)}.` : null, l.repliedBy && l.status !== "waiting" ? `Replied by ${l.repliedBy.label}.` : null].filter(Boolean).join(" "),
});

export const leadKey = (l: LeadView) => l.locationId + l.contactId;
export const leadCopy = (showAccount: boolean) => (l: LeadView) => copyLine({ ...l }, showAccount);

// A figure that opens its list. A real button (not a card with a click handler), so the keyboard and screen readers get it.
function ClickStat({ label, value, sub, tone, active, onClick, openLabel }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" | "good"; active: boolean; onClick: () => void; openLabel: string }) {
  const rule = tone === "bad" ? "border-destructive" : tone === "warn" ? "border-warning" : tone === "good" ? "border-success" : "border-border";
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={openLabel} data-testid="click-stat"
      className={`ds-press block w-full min-w-0 rounded-r-lg border-l-2 py-1 pl-4 pr-2 text-left hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 ${active ? "bg-accent/60" : ""} ${rule}`}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span className={`tnum mt-1.5 block text-[1.7rem] font-semibold leading-none tracking-tight ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : tone === "good" ? "text-success" : ""}`}><CountUp value={value} /></span>
      {sub && <span className="mt-2 block text-xs leading-5 text-muted-foreground">{sub}</span>}
    </button>
  );
}

// The card asks the server for exactly the window its own control chose. Until the dates are worked out, and while a new window loads, it shows a skeleton.
function useCardData<T extends { window: { from: string; to: string } }>(part: Part, range: CardRangeState) {
  const r = range.resolved;
  const params = r ? new URLSearchParams({ part, from: r.current.from, to: r.current.to, ...(r.compare ? { cmpFrom: r.compare.from, cmpTo: r.compare.to } : {}) }) : null;
  const q = useData<T>(params ? `speed?${params}` : null);
  const fresh = Boolean(q.data && r && q.data.window.from === r.current.from && q.data.window.to === r.current.to);
  return { ...q, ready: fresh ? q.data : null };
}

function CardState<T>({ q, children }: { q: { error: Error | null; reload: () => void; ready: T | null }; children: (d: T) => ReactNode }) {
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.ready) return <SkeletonRows rows={3} label="Loading..." />;
  return <>{children(q.ready)}</>;
}

// The list behind a figure, with the lead panel stepping through it. Shared by every card.
function LeadsPanel({ drill, title, members, showAccount }: { drill: ReturnType<typeof useDrill>; title: string; members: MembersView; showAccount: boolean }) {
  return (
    <DrillPanel drill={drill} title={title} count={members.count} noun={members.count === 1 ? "lead" : "leads"} rows={members.rows} columns={leadColumns(showAccount)} rowKey={leadKey} toLead={leadSeed} empty="No leads behind this one." />
  );
}

// ---- card 1: how fast replies come ----

type SummaryData = {
  window: { from: string; to: string }; targetMinutes: number; leads: number; summary: Summary; typical: Progress;
  lists: { within: MembersView; late: MembersView; waiting: MembersView; onlyAuto: MembersView };
  autoVsHuman: AutoVsHuman;
  compare: { window: { from: string; to: string }; summary: Summary } | null;
};

export function SummaryCard({ showAccount }: { showAccount: boolean }) {
  const range = useCardRange("speed-summary", { preset: "30d", compare: "none" });
  const q = useCardData<SummaryData>("summary", range);
  const drill = useDrill();
  return (
    <Card title="How fast replies come" className="mt-6">
      <CardRange state={range} label="Reply speed" compares={["none", "previous", "month"]} />
      <div className="mt-4">
        <CardState q={q}>{(d) => {
          const s = d.summary;
          const marks: Array<{ title: string; members: MembersView }> = [
            { title: "Answered in time", members: d.lists.within }, { title: "Answered late", members: d.lists.late },
            { title: "Not answered", members: d.lists.waiting }, { title: "Only an automatic message, no person", members: d.lists.onlyAuto },
          ];
          const picked = drill.selected !== null ? marks[drill.selected] : undefined;
          const change = d.compare ? shareChange({ n: s.withinTarget, total: s.leads }, { n: d.compare.summary.withinTarget, total: d.compare.summary.leads }) : null;
          const lines = autoVsHumanLines(d.autoVsHuman);
          return (
            <>
              {s.leads === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="summary-empty">No new leads were judged in this window. A lead is counted once its reply target has passed or a person has replied. Try a longer range.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat
                      label={<DefinitionTip term="Typical first reply" label="How the typical reply is worked out">The middle of all first reply times: half of the leads were answered faster, half slower. It needs at least {MIN_FOR_MEDIAN} replies.</DefinitionTip>}
                      value={s.medianSeconds === null ? "n/a" : fmtDuration(s.medianSeconds)}
                      sub={s.medianSeconds === null ? d.typical.text : s.p90Seconds !== null ? `9 in 10 were answered within ${fmtDuration(s.p90Seconds)}` : undefined} />
                    <ClickStat label={`Answered within ${d.targetMinutes} min`} value={`${fmtInt(s.withinTarget)} of ${fmtInt(s.leads)}`} tone={s.hitRate === null ? undefined : s.hitRate >= 0.8 ? "good" : "warn"}
                      sub={s.hitRate === null ? `A percentage shows from ${MIN_FOR_MEDIAN} leads (${s.leads} so far)` : `${pct(s.hitRate)} of leads. Open the list.`} active={drill.selected === 0 && drill.open} onClick={() => drill.select(0)} openLabel={`Answered in time: ${s.withinTarget} leads, open the list`} />
                    <ClickStat label="Answered late" value={fmtInt(s.answeredLate)} sub="a person replied, after the target. Open the list." active={drill.selected === 1 && drill.open} onClick={() => drill.select(1)} openLabel={`Answered late: ${s.answeredLate} leads, open the list`} />
                    <ClickStat label="Not answered" value={fmtInt(s.stillWaiting)} tone={s.stillWaiting > 0 ? "bad" : undefined} sub="past the target, no reply from a person. Open the list." active={drill.selected === 2 && drill.open} onClick={() => drill.select(2)} openLabel={`Not answered: ${s.stillWaiting} leads, open the list`} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Based on {fmtInt(s.leads)} {s.leads === 1 ? "lead" : "leads"} that arrived in this window and are past their reply target or were answered.</p>
                  {change && <p className="mt-2 text-sm" data-testid="summary-compare">{change.text}.</p>}
                </>
              )}

              <div className="mt-5 border-t pt-4" data-testid="auto-vs-person">
                <h3 className="text-sm font-semibold">Automatic message or a person?</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">A workflow can text a lead within seconds, which looks like a fast reply in the CRM. Here the automatic first message is shown apart from the first reply by a person. The Settings option &quot;Count automatic messages as a reply&quot; decides which one stops the clock: switched off (the default), only a person does; switched on, an automatic text does too and those leads look answered.</p>
                {lines.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing to show for this window.</p> : (
                  <ul className="mt-2 space-y-1 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
                )}
                {d.autoVsHuman.onlyAutoPastTarget > 0 && (
                  <button type="button" onClick={() => drill.select(3)} className="mt-2 min-h-9 text-xs font-medium text-primary underline" data-testid="only-auto-open">Show the {d.autoVsHuman.onlyAutoPastTarget} {d.autoVsHuman.onlyAutoPastTarget === 1 ? "lead" : "leads"} with only an automatic message</button>
                )}
              </div>
              {picked && <LeadsPanel drill={drill} title={picked.title} members={picked.members} showAccount={showAccount} />}
            </>
          );
        }}</CardState>
      </div>
    </Card>
  );
}

// ---- card 2: where leads come from ----

type SourceRow = Summary & { cls: string; label: string; targetMinutes: number; names: Array<{ label: string; n: number }>; members: MembersView };
type SourceData = { window: { from: string; to: string }; rows: SourceRow[]; unknown: { n: number; total: number; share: number | null; actionable: boolean; members: MembersView } };

export function SourceCard({ showAccount }: { showAccount: boolean }) {
  const range = useCardRange("speed-source", { preset: "30d", compare: "none" });
  const q = useCardData<SourceData>("source", range);
  const drill = useDrill();
  return (
    <Card title="Where leads come from" className="mt-6">
      <CardRange state={range} label="Where leads come from" compares={["none"]} />
      <p className="mb-3 mt-3 text-xs text-muted-foreground">Each source is judged against its own target: portal and phone leads 5 minutes, Facebook and Instagram lead forms 10, web forms 15, social messages 60. These are common practice targets, not rules. A lead is placed by the Source field on the contact.</p>
      <CardState q={q}>{(d) => {
        const marks = [...d.rows.map((r) => ({ title: r.label, members: r.members })), { title: "Leads with no source recorded", members: d.unknown.members }];
        const picked = drill.selected !== null ? marks[drill.selected] : undefined;
        const action = d.unknown.actionable ? unknownSourceAction(d.unknown) : null;
        return (
          <>
            {action && (
              <InlineAlert tone="warning" title={action.title} className="mb-4" action={<Btn onClick={() => drill.select(d.rows.length)}>Show these leads</Btn>}>
                {action.body}
              </InlineAlert>
            )}
            {d.rows.length === 0 ? <p className="text-sm text-muted-foreground">No leads were judged in this window.</p> : (
              <Table head={<tr><Th>Source</Th><Th className="text-right">Leads</Th><Th className="text-right">Target</Th><Th className="text-right">Typical</Th><Th className="text-right">In target</Th><Th className="text-right">Waiting</Th></tr>}>
                {d.rows.map((s, i) => (
                  <tr key={s.cls}>
                    <Td className="font-medium">{s.label}{s.names.length > 0 && <span className="block text-xs font-normal text-muted-foreground">{s.names.map((x) => `${x.label} ${x.n}`).join(", ")}</span>}</Td>
                    <Td className="text-right tabular-nums"><button type="button" className="min-h-9 font-medium text-primary underline" onClick={() => drill.select(i)} aria-label={`${s.label}: ${s.members.count} leads, open the list`}>{s.members.count}</button></Td>
                    <Td className="text-right tabular-nums">{s.targetMinutes} min</Td>
                    <Td className="text-right tabular-nums">{s.medianSeconds === null ? <>n/a<span className="block text-xs text-muted-foreground">{s.answered} of {MIN_FOR_MEDIAN} replies</span></> : fmtDuration(s.medianSeconds)}</Td>
                    <Td className="text-right tabular-nums">{s.hitRate === null ? <>{s.withinTarget} of {s.leads}</> : <>{pct(s.hitRate)}<span className="block text-xs text-muted-foreground">{s.withinTarget} of {s.leads}</span></>}</Td>
                    <Td className="text-right tabular-nums">{s.stillWaiting}</Td>
                  </tr>
                ))}
              </Table>
            )}
            {!action && d.unknown.n > 0 && <p className="mt-2 text-xs text-muted-foreground">{d.unknown.n} of {d.unknown.total} leads have no source recorded.{" "}<button type="button" className="font-medium text-primary underline" onClick={() => drill.select(d.rows.length)}>Show them</button></p>}
            {picked && <LeadsPanel drill={drill} title={picked.title} members={picked.members} showAccount={showAccount} />}
          </>
        );
      }}</CardState>
    </Card>
  );
}

// ---- card 3: by client account ----

type AccountRow = Summary & { locationId: string; name: string; access: string | null; members: MembersView };
type AccountsData = { window: { from: string; to: string }; rows: AccountRow[] };

export function AccountsCard({ go }: { go: (view: "account", locationId: string) => void }) {
  const range = useCardRange("speed-accounts", { preset: "30d", compare: "none" });
  const q = useCardData<AccountsData>("accounts", range);
  const drill = useDrill();
  return (
    <Card title="By client account, slowest first" className="mt-6">
      <CardRange state={range} label="By client account" compares={["none"]} />
      <div className="mt-3">
        <CardState q={q}>{(d) => {
          const picked = drill.selected !== null ? d.rows[drill.selected] : undefined;
          return (
            <>
              {d.rows.length === 0 ? <p className="text-sm text-muted-foreground">No leads were judged in this window.</p> : (
                <Table head={<tr><Th>Client account</Th><Th className="text-right">Leads</Th><Th className="text-right">Typical</Th><Th className="text-right">In target</Th><Th className="text-right">Waiting</Th></tr>}>
                  {d.rows.map((a, i) => (
                    <tr key={a.locationId}>
                      <Td><button type="button" className="font-medium hover:underline" onClick={() => go("account", a.locationId)}>{a.name}</button></Td>
                      <Td className="text-right tabular-nums">{a.access === "needs_permission" ? <span className="text-warning">Needs permission: reconnect</span> : <button type="button" className="min-h-9 font-medium text-primary underline" onClick={() => drill.select(i)} aria-label={`${a.name}: ${a.members.count} leads, open the list`}>{a.members.count}</button>}</Td>
                      <Td className="text-right tabular-nums">{a.access === "needs_permission" ? "n/a" : a.medianSeconds === null ? <>n/a<span className="block text-xs text-muted-foreground">{a.answered} of {MIN_FOR_MEDIAN} replies</span></> : fmtDuration(a.medianSeconds)}</Td>
                      <Td className="text-right tabular-nums">{a.hitRate === null ? <>{a.withinTarget} of {a.leads}</> : <>{pct(a.hitRate)}<span className="block text-xs text-muted-foreground">{a.withinTarget} of {a.leads}</span></>}</Td>
                      <Td className="text-right tabular-nums">{a.stillWaiting}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              {picked && <LeadsPanel drill={drill} title={picked.name} members={picked.members} showAccount={false} />}
            </>
          );
        }}</CardState>
      </div>
    </Card>
  );
}

// ---- card 4: who replies ----

type PersonRow = PersonView & { userId: string; replies: number; medianSeconds: number | null; ranked: boolean; progress: Progress; members: MembersView };
type PeopleData = { window: { from: string; to: string }; rows: PersonRow[] };

export function PeopleCard({ showAccount }: { showAccount: boolean }) {
  const range = useCardRange("speed-people", { preset: "30d", compare: "none" });
  const q = useCardData<PeopleData>("people", range);
  const drill = useDrill();
  return (
    <Card title="Who replies fastest" className="mt-6">
      <CardRange state={range} label="Who replies fastest" compares={["none"]} />
      <div className="mt-3">
        <CardState q={q}>{(d) => {
          const picked = drill.selected !== null ? d.rows[drill.selected] : undefined;
          const blocked = d.rows.some((p) => p.state === "needs_permission");
          const best = d.rows.reduce((m, p) => Math.max(m, p.replies), 0);
          return (
            <>
              {blocked && (
                <InlineAlert tone="warning" className="mb-3" title="Team names need permission: reconnect.">
                  SubSync reads your team&apos;s names and pictures from your CRM. Reconnect SubSync and approve the team permission when asked, and names appear here. Until then replies are still counted, just not named.
                </InlineAlert>
              )}
              {d.rows.length === 0 ? (
                <ChartPlaceholder title="Who replies fastest" need={MIN_PER_PERSON} have={best} unit="replies from one person">{" "}Until then nobody is ranked, so one lucky reply never looks like a ranking.</ChartPlaceholder>
              ) : (
                <ul className="divide-y text-sm" data-testid="people-list">
                  {d.rows.map((p, i) => (
                    <li key={p.userId} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2"><span className="w-5 shrink-0 text-muted-foreground">{p.ranked ? `${d.rows.filter((x) => x.ranked).indexOf(p) + 1}.` : ""}</span><PersonName p={p} /></span>
                      <button type="button" className="min-h-9 shrink-0 text-right tabular-nums text-muted-foreground hover:text-foreground" onClick={() => drill.select(i)} aria-label={`${p.label}: ${p.replies} replies, open the list`}>
                        {p.ranked && p.medianSeconds !== null ? `${fmtDuration(p.medianSeconds)} typical · ${p.replies} replies` : personProgressText(p.replies, MIN_PER_PERSON)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {picked && <LeadsPanel drill={drill} title={`Leads ${picked.label} replied to first`} members={picked.members} showAccount={showAccount} />}
            </>
          );
        }}</CardState>
      </div>
    </Card>
  );
}
