"use client";

import { useState } from "react";
import { useData } from "../session";
import { pickPath } from "@/lib/design/pipeline-pick-link";
import { usePick } from "./pl3/pick-context";
import { DataList, EmptyState, ErrorState, LeadDrawer, OpenLeadButton, SkeletonRows, type Column, type LeadSeed } from "../ds";
import { fmtInt, fmtMoney } from "../ui";

type Deal = { opportunityId: string; locationId: string; locationName: string | null; contactId: string | null; contactName: string | null; name: string | null; stageName: string; pipelineName: string; value: number; daysSinceContact: number | null; url: string };
type Data = { days: number; total: number; value: number; stages: Array<{ stage: string; count: number; value: number }>; deals: Deal[] };

const DAYS = [7, 14, 30] as const;
const dealName = (d: Deal) => d.name ?? d.contactName ?? "Untitled deal";

const columns: Array<Column<Deal>> = [
  { key: "deal", header: "Deal", primary: true, width: "minmax(0,2fr)", cell: dealName },
  { key: "account", header: "Client account", width: "minmax(0,1.5fr)", cell: (d) => <span className="text-muted-foreground">{d.locationName ?? "Unnamed account"}</span> },
  { key: "stage", header: "Stage", width: "minmax(0,1.5fr)", cell: (d) => <span className="text-muted-foreground">{d.pipelineName}: {d.stageName}</span> },
  { key: "value", header: "Value", width: "7rem", align: "right", cell: (d) => <span className="tabular-nums">{fmtMoney(d.value)}</span> },
  { key: "quiet", header: "Days quiet", width: "6rem", align: "right", cell: (d) => <span className="tabular-nums">{d.daysSinceContact ?? "never"}</span> },
  { key: "open", header: "", width: "10rem", align: "right", cell: (d) => <OpenLeadButton seed={d.contactId ? { contactId: d.contactId, locationId: d.locationId, name: d.contactName ?? dealName(d), locationName: d.locationName, url: d.url, tab: "deals", dealId: d.opportunityId, note: `${dealName(d)}, ${fmtMoney(d.value)}, ${d.pipelineName}: ${d.stageName}. No contact for ${d.daysSinceContact ?? "many"} days.` } : null} crmUrl={d.url} reason="No person is linked to this deal." name={d.contactName ?? dealName(d)} testId="quiet-open" /> },
];

// Open deals that have a value and an owner and are in play (the same deals as the rest of Pipeline: docs/METRICS.md) whose contact has not been written to
// or called for a number of days. It used to sit on the Unanswered messages page; it is about deals, so it lives with them (N14).
export function QuietDeals() {
  const [days, setDays] = useState<number>(7);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading, reload } = useData<Data>(pickPath(`deal-gaps?days=${days}`, usePick()));
  const withContact = (data?.deals ?? []).filter((d) => d.contactId);
  const seeds: LeadSeed[] = withContact.map((d) => ({ contactId: d.contactId as string, locationId: d.locationId, name: d.contactName ?? dealName(d), locationName: d.locationName, url: d.url, note: `${dealName(d)}, ${fmtMoney(d.value)}, ${d.pipelineName}: ${d.stageName}. No contact for ${d.daysSinceContact ?? "many"} days.` }));
  return (
    <div data-testid="quiet-deals">
      <h2 className="text-base font-semibold">Open deals with no recent contact</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted-foreground">Deals with a value and an owner, in play, where nobody has been in touch with the contact for the number of days you pick. The total is counted over all of them; the list shows the biggest first.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Days without contact">
        <span className="text-sm text-muted-foreground">No contact in at least</span>
        {DAYS.map((d) => (
          <button key={d} type="button" onClick={() => { setDays(d); setOpen(null); }} aria-pressed={days === d} data-testid={`quiet-${d}`}
            className={`min-h-9 rounded-lg border px-3 text-sm ${days === d ? "border-foreground bg-foreground font-medium text-background" : "bg-card text-muted-foreground hover:text-foreground"}`}>{d} days</button>
        ))}
      </div>
      {loading && !data ? <SkeletonRows rows={4} label="Counting quiet deals..." /> : error ? <ErrorState error={error} onRetry={reload} /> : !data ? null : data.total === 0 ? (
        <EmptyState title="Every open deal has been in touch recently" body={`No counted deal has gone ${days} days or more without contact.`} compact />
      ) : (
        <>
          <p className="mb-3 text-sm font-medium" data-testid="quiet-total">{fmtInt(data.total)} {data.total === 1 ? "deal" : "deals"}, {fmtMoney(data.value)}, with no contact for {days} days or more.</p>
          {data.stages.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm" aria-label="By stage">
              {data.stages.map((s) => <li key={s.stage} className="flex justify-between gap-3"><span className="min-w-0 truncate">{s.stage}</span><span className="shrink-0 tabular-nums text-muted-foreground">{s.count} {s.count === 1 ? "deal" : "deals"}, {fmtMoney(s.value)}</span></li>)}
            </ul>
          )}
          <DataList rows={data.deals} columns={columns} rowKey={(d) => d.opportunityId} total={data.total} caption="Open deals with no recent contact"
            onOpen={(d) => { const at = withContact.findIndex((x) => x.opportunityId === d.opportunityId); if (at >= 0) setOpen(at); else window.open(d.url, "_blank", "noopener,noreferrer"); }}
            copyText={(d) => `${dealName(d)}, ${d.locationName ?? "Unnamed account"}, ${fmtMoney(d.value)}, ${d.daysSinceContact ?? "never"} days quiet`} />
          <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
        </>
      )}
    </div>
  );
}
