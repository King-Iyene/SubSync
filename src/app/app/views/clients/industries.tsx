"use client";

import { useData } from "../../session";
import { EmptyState, Section, SkeletonRows } from "../../ds";
import { ErrorBox, fmtMoney, Table, Td, Th } from "../../ui";
import { PlaybooksView } from "../playbooks";
import type { GoFn } from "../../nav";
import type { ClientsData } from "./types";

// Industries: how the clients group by the kind of business each one runs (typed on the client's row), and what each kind needs: reply targets, call lists and onboarding steps
// (the industry playbooks, with their one reply-target switch). Moved here from the old Details and billing tab, unchanged: the fee, renewal and industry of a client are now typed
// in the client's own row.
export function IndustriesTab({ go, showPlaybooks = true }: { go: GoFn; showPlaybooks?: boolean }) {
  const { data, error, loading, reload } = useData<ClientsData>("clients");
  if (loading && !data) return <SkeletonRows rows={4} label="Loading industries..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const onlyUnset = data.segments.length === 1 && data.segments[0].industry === "Not set";
  return (
    <div className="space-y-6" data-testid="industries">
      {data.segments.length > 0 && !onlyUnset ? (
        <Section title="Clients by industry" hint="Groups of clients with their average health and open pipeline. Choose a client's industry in its row on the Clients tab.">
          <Table head={<tr><Th>Industry</Th><Th className="text-right">Clients</Th><Th className="text-right">Average health</Th><Th className="text-right">Average win rate</Th><Th className="text-right">Open pipeline</Th></tr>}>
            {data.segments.map((s) => (
              <tr key={s.industry}><Td className="font-medium">{s.industry}</Td><Td className="text-right tabular-nums">{s.accounts}</Td><Td className="text-right tabular-nums">{s.avgScore}</Td><Td className="text-right tabular-nums">{s.avgWinRate === null ? "not enough deals" : `${Math.round(s.avgWinRate * 100)}%`}</Td><Td className="text-right tabular-nums">{fmtMoney(s.openValue)}</Td></tr>
            ))}
          </Table>
        </Section>
      ) : (
        <EmptyState compact title="No industries chosen yet" body="Open a client on the Clients tab and choose its industry. You type this; SubSync does not read it from your CRM." />
      )}
      {showPlaybooks && <PlaybooksView go={(view) => go(view)} embedded />}
    </div>
  );
}
