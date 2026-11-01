"use client";

import { useData } from "../session";
import { Badge, Card, ExtLink, fmtInt, fmtMoney, Table, Td, Th } from "../ui";
import { plural } from "@/lib/text";

type Data = {
  aging: { buckets: Array<{ label: string; count: number }>; critical: number; older?: number; total: number };
  gaps: {
    days: number; total: number; value: number; stages: Array<{ stage: string; count: number; value: number }>;
    deals: Array<{ opportunityId: string; locationName: string | null; contactName: string | null; name: string | null; stageName: string; value: number; daysSinceContact: number | null; url: string }>;
  };
  afterHours: { leads: number; afterHoursPct: number | null; weekendPct: number | null; wonValue: number; wonCount: number; suggestion: string | null };
};

// Extra communication views under the inbox: how long people wait, deals going quiet, after-hours leads.
export function CommsSections() {
  const { data } = useData<Data>("comms-intel");
  if (!data) return null;
  const max = Math.max(1, ...data.aging.buckets.map((b) => b.count));
  const a = data.afterHours;
  return (
    <div className="mt-6 space-y-4">
      <Card title="How long customers have been waiting">
        <p className="mb-3 text-xs text-muted-foreground">The same customers as the lists above: the customer wrote last, the reply target has passed, and it was in the last 30 days.</p>
        {data.aging.total === 0 ? <p className="text-sm text-muted-foreground">No customer is waiting for a reply.</p> : (
          <>
            <ul className="space-y-2 text-sm">
              {data.aging.buckets.map((b) => (
                <li key={b.label}>
                  <div className="flex justify-between"><span>{b.label}</span><span className="tabular-nums text-muted-foreground">{fmtInt(b.count)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary/70" style={{ width: `${Math.round((b.count / max) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
            {data.aging.critical > 0 && <p className="mt-3 text-sm"><Badge tone="bad">Critical</Badge> {plural(data.aging.critical, "customer has", "customers have")} waited more than 24 hours and up to a week, so {data.aging.critical === 1 ? "it is" : "they are"} still worth answering.</p>}
            {(data.aging.older ?? 0) > 0 && <p className="mt-2 text-xs text-muted-foreground">{plural(data.aging.older ?? 0, "customer has", "customers have")} waited more than a week. They are not marked critical: after a week most are no longer waiting for you.</p>}
          </>
        )}
      </Card>

      <Card title={`Open deals with no contact for ${data.gaps.days}+ days (${fmtInt(data.gaps.total)}, ${fmtMoney(data.gaps.value)})`}>
        <p className="mb-2 text-xs text-muted-foreground">Only deals with a value and an owner that are in play, the same deals as the Pipeline. The total is counted over all of them; the list shows the biggest {data.gaps.deals.length}.</p>
        {data.gaps.total === 0 ? <p className="text-sm text-muted-foreground">Every open deal has been in touch recently.</p> : (
          <>
            <ul className="mb-3 space-y-1 text-sm">
              {data.gaps.stages.map((s) => <li key={s.stage} className="flex justify-between"><span>{s.stage}</span><span className="tabular-nums text-muted-foreground">{s.count} deals, {fmtMoney(s.value)}</span></li>)}
            </ul>
            <Table head={<tr><Th>Deal</Th><Th>Account</Th><Th>Stage</Th><Th className="text-right">Value</Th><Th className="text-right">Days quiet</Th><Th>{""}</Th></tr>}>
              {data.gaps.deals.map((d) => (
                <tr key={d.opportunityId} className="hover:bg-muted/40">
                  <Td className="font-medium">{d.name ?? d.contactName ?? "Untitled deal"}</Td><Td>{d.locationName ?? "Unnamed account"}</Td><Td className="text-muted-foreground">{d.stageName}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(d.value)}</Td><Td className="text-right tabular-nums">{d.daysSinceContact ?? "never"}</Td><Td><ExtLink href={d.url}>Open</ExtLink></Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>

      <Card title="Leads that arrive after hours">
        {a.leads === 0 ? <p className="text-sm text-muted-foreground">No new contacts in the last 90 days.</p> : (
          <>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Outside 9 to 5</dt><dd className="text-lg font-semibold tabular-nums">{a.afterHoursPct}%</dd></div>
              <div><dt className="text-muted-foreground">On weekends</dt><dd className="text-lg font-semibold tabular-nums">{a.weekendPct}%</dd></div>
              <div><dt className="text-muted-foreground">Won from them</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(a.wonValue)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Based on {fmtInt(a.leads)} new contacts in 90 days, in each account&apos;s own time zone.</p>
            {a.suggestion && <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-sm">{a.suggestion}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
