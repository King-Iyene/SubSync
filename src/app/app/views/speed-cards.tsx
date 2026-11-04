"use client";

import { useState, type ReactNode } from "react";
import { autoLine, copyLine, leadStatus, unknownSourceAction } from "@/lib/design/speed-text";
import { fmtDuration, MIN_FOR_MEDIAN, type Summary } from "@/lib/analytics/speed-intel";
import type { Part } from "@/lib/analytics/speed-window";
import { useData } from "../session";
import { CardRange, DrillPanel, ErrorState, InlineAlert, SkeletonRows, useCardRange, useDrill, type CardRangeState, type Column, type LeadSeed } from "../ds";
import { Badge, Btn, Card, ExtLink, Table, Td, Th } from "../ui";

// The pieces the Speed to lead screen shares (a person's name and picture, the lead columns) and the "Where leads come from" card, which lives under "More detail".
// The card has its own range and comparison (KF-4), asks the server for exactly that window, and every figure on it opens the list of leads behind it (KF-6).

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
