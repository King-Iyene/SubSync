"use client";

import { useState } from "react";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { Badge, Btn, Card, Empty, ErrorBox, ExtLink, fmtInt, Loading, PageHeader, Stat, Table, Td, Th, type Tone } from "../ui";

type Summary = { leads: number; answered: number; withinTarget: number; answeredLate: number; stillWaiting: number; hitRate: number | null; medianSeconds: number | null; p90Seconds: number | null };
type Data = {
  targetMinutes: number; windowDays: number;
  access: { ok: number; needsPermission: Array<{ locationId: string; name: string }>; total: number };
  overall: Summary;
  bySource?: Array<Summary & { cls: "portal" | "form" | "social" | "other"; targetMinutes: number }>;
  unassignedWaiting?: number;
  trend?: Array<{ weekStart: number; leads: number; withinTarget: number; hitRate: number | null }>;
  neverAnswered?: number;
  perAccount: Array<Summary & { locationId: string; name: string; access: string | null }>;
  people: Array<{ userId: string; label: string; replies: number; medianSeconds: number }>;
  waiting: Array<{ locationId: string; locationName: string; contactId: string; name: string; waitingMinutes: number; url: string; unassigned?: boolean; neverAnswered?: boolean }>;
};

const dur = (s: number | null) => {
  if (s === null) return "none";
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${Math.floor(h / 24)} d ${h % 24} h`;
};
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const rateTone = (n: number | null): Tone => (n === null ? "neutral" : n >= 0.8 ? "good" : n >= 0.5 ? "warn" : "bad");

// How fast new leads get a first reply from a person. Replies from workflows and campaigns do not count.
export function SpeedView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Data>("speed");
  const [all, setAll] = useState(false);
  if (loading && !data) return <Loading label="Timing first replies..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const o = data.overall;
  const none = data.access.total > 0 && data.access.ok === 0;

  return (
    <div>
      <PageHeader title="Speed to lead" subtitle={`How long new leads wait for a first reply from a person. Target: ${data.targetMinutes} minutes. Last ${data.windowDays} days.`} />

      {data.access.needsPermission.length > 0 && (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-400/10 px-4 py-3 text-sm" role="note">
          Reading the messages inside conversations needs a permission that {data.access.needsPermission.length === data.access.total ? "none of your accounts has" : `${data.access.needsPermission.length} of ${data.access.total} accounts have not`} approved yet
          ({data.access.needsPermission.slice(0, 3).map((a) => a.name).join(", ")}{data.access.needsPermission.length > 3 ? " and more" : ""}). Until then those accounts are left out, and nothing is guessed.
        </p>
      )}

      {o.leads === 0 ? (
        <Empty title={none ? "Waiting for permission" : "No new leads to time yet"} body={none ? "Approve the new permissions when SubSync asks, then run a sync. First replies appear here after that." : "A lead appears here once a new contact has a conversation. Check back after the next sync."} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Typical first reply" value={o.medianSeconds === null ? "Not enough data" : dur(o.medianSeconds)} sub={o.p90Seconds !== null ? `9 in 10 were answered within ${dur(o.p90Seconds)}` : "Needs at least 5 replies"} />
            <Stat label={`Answered within ${data.targetMinutes} min`} value={pct(o.hitRate)} tone={o.hitRate === null ? undefined : o.hitRate >= 0.8 ? undefined : "warn"} sub={`${fmtInt(o.withinTarget)} of ${fmtInt(o.withinTarget + o.answeredLate + o.stillWaiting)} leads`} />
            <Stat label="Waiting right now" value={fmtInt(Math.max(0, o.stillWaiting - (data.neverAnswered ?? 0)))} tone={o.stillWaiting - (data.neverAnswered ?? 0) > 0 ? "bad" : undefined} sub={(data.neverAnswered ?? 0) > 0 ? `past the target, under 3 days old. Plus ${data.neverAnswered} never answered (older than 3 days)` : "no person has replied, past the target"} />
            <Stat label="Answered late" value={fmtInt(o.answeredLate)} sub="a person replied, after the target" />
          </div>

          {data.waiting.length > 0 && (
            <Card title={`Leads waiting or missed (${o.stillWaiting})`} className="mt-6" action={data.waiting.length > 10 ? <Btn variant="ghost" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${data.waiting.length}`}</Btn> : undefined}>
              <p className="mb-2 text-xs text-muted-foreground">Longest waiting first.</p>
              <ul className="divide-y text-sm">
                {(all ? data.waiting : data.waiting.slice(0, 10)).map((w) => (
                  <li key={w.locationId + w.contactId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span><span className="font-medium">{w.name}</span> <span className="text-muted-foreground">· {w.locationName}</span></span>
                    <span className="flex items-center gap-3"><Badge tone="bad">{w.neverAnswered ? "never answered" : "waiting"} {dur(w.waitingMinutes * 60)}</Badge>{w.unassigned && <Badge tone="warn">no owner</Badge>}<ExtLink href={w.url}>Open contact</ExtLink></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(data.unassignedWaiting ?? 0) > 0 && (
            <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-400/10 px-4 py-3 text-sm" role="note">
              <strong>{data.unassignedWaiting} waiting lead{data.unassignedWaiting === 1 ? " has" : "s have"} no owner.</strong> Nobody is responsible for answering {data.unassignedWaiting === 1 ? "it" : "them"}. Assign them, or fix the routing so new leads always reach a person.
            </p>
          )}

          {data.trend && data.trend.some((w) => w.leads > 0) && (
            <Card title="Are replies getting faster? Last 8 weeks" className="mt-6">
              <p className="mb-3 text-xs text-muted-foreground">The share of new leads answered by a person inside your {data.targetMinutes}-minute target, by the week the lead came in. A week with fewer than 5 leads shows no percentage.</p>
              <ul className="space-y-1.5 text-sm">
                {data.trend.map((w) => (
                  <li key={w.weekStart} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">{new Date(w.weekStart).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((w.hitRate ?? 0) * 100)}%` }} /></span>
                    <span className="w-28 shrink-0 text-right tabular-nums text-xs">{w.hitRate === null ? <span className="text-muted-foreground">{w.leads} lead{w.leads === 1 ? "" : "s"}, too few</span> : `${Math.round(w.hitRate * 100)}% of ${w.leads}`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.bySource && data.bySource.length > 0 && (
            <Card title="By where the lead came from" className="mt-6">
              <p className="mb-2 text-xs text-muted-foreground">Each source is judged against its own target: portal and phone leads 5 minutes, web forms 15, social messages 60. These are common practice targets, not rules.</p>
              <Table head={<tr><Th>Source</Th><Th className="text-right">Target</Th><Th className="text-right">Typical</Th><Th className="text-right">In target</Th><Th className="text-right">Waiting</Th></tr>}>
                {data.bySource.map((s) => (
                  <tr key={s.cls}>
                    <Td className="font-medium">{({ portal: "Portals and phone", form: "Web forms and chat", social: "Social messages", other: "Other sources" } as const)[s.cls]}</Td>
                    <Td className="text-right tabular-nums">{s.targetMinutes} min</Td>
                    <Td className="text-right tabular-nums">{dur(s.medianSeconds)}</Td>
                    <Td className="text-right"><Badge tone={rateTone(s.hitRate)}>{pct(s.hitRate)}</Badge></Td>
                    <Td className="text-right tabular-nums">{s.stillWaiting}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card title="By account, slowest first" className="lg:col-span-2">
              <Table head={<tr><Th>Account</Th><Th className="text-right">Typical</Th><Th className="text-right">In target</Th><Th className="text-right">Waiting</Th></tr>}>
                {data.perAccount.map((a) => (
                  <tr key={a.locationId}>
                    <Td><button type="button" className="font-medium hover:underline" onClick={() => go("account", a.locationId)}>{a.name}</button></Td>
                    <Td className="text-right tabular-nums">{a.access === "needs_permission" ? "needs permission" : dur(a.medianSeconds)}</Td>
                    <Td className="text-right"><Badge tone={rateTone(a.hitRate)}>{pct(a.hitRate)}</Badge></Td>
                    <Td className="text-right tabular-nums">{a.stillWaiting}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Who replies fastest">
              {data.people.length === 0 ? <p className="text-sm text-muted-foreground">Needs at least 3 replies from a person before they are ranked.</p> : (
                <ul className="divide-y text-sm">
                  {data.people.map((p, i) => (
                    <li key={p.userId} className="flex items-center justify-between gap-2 py-2.5"><span><span className="mr-2 text-muted-foreground">{i + 1}.</span>{p.label}</span><span className="tabular-nums text-muted-foreground">{dur(p.medianSeconds)} typical · {p.replies} replies</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">A lead is a new contact with a conversation. The clock starts when the contact is created or the first message arrives, whichever is earlier, and stops at the first message a person sent from the app. Automatic texts do not stop it unless you change that in Settings.</p>
    </div>
  );
}
