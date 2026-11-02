"use client";

import { useState } from "react";
import type { Drift } from "@/lib/analytics/client-success";
import { useData } from "../session";
import { Badge, Card, Empty, ErrorBox, inputClass, Loading, PageHeader, Table, Td, Th } from "../ui";

type Data = {
  accounts: Array<{ locationId: string; name: string }>;
  baseline: { locationId: string; name: string; pipelines: number; calendars: number | null } | null;
  rows: Array<{ locationId: string; name: string; matches: boolean; notes: string[]; share?: number; drift?: Drift[] }>;
  unrelated?: Array<{ locationId: string; name: string; pipelines: number }>;
};

const TONE = { high: "bad", medium: "warn", low: "neutral" } as const;
const WORDS = { high: "needs fixing", medium: "worth fixing", low: "minor" } as const;

// Compare setups (N72): pick the client built the way you want and see how far the others that started from the same template have drifted, as a list
// with how serious each difference is and what to do. Accounts that did not start from the baseline's template are not compared with it, because a list
// of differences between two unrelated clients says nothing. `embedded` is the section inside the Compare tab.
export function SetupCompareView({ embedded = false }: { embedded?: boolean }) {
  const [baseline, setBaseline] = useState("");
  const { data, error, loading, reload } = useData<Data>(`setup-compare${baseline ? `?baseline=${encodeURIComponent(baseline)}` : ""}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const off = data.rows.filter((r) => !r.matches);
  const blurb = "Pick the client account set up the way you want. SubSync lists how far the clients built from the same template have drifted from it: missing pipelines or stages, a different stage order, a different number of calendars.";

  return (
    <div data-testid="setup-compare">
      {embedded ? (
        <div className="mb-4"><h2 className="text-base font-semibold">Compare setups</h2><p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{blurb}</p></div>
      ) : <PageHeader title="Compare setups" subtitle={blurb} />}
      <div className="mb-4 max-w-md">
        <label htmlFor="baseline" className="mb-1 block text-sm font-medium">Baseline account</label>
        <select id="baseline" className={inputClass} value={baseline || data.baseline?.locationId || ""} onChange={(e) => setBaseline(e.target.value)}>
          {data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}
        </select>
        {data.baseline && <p className="mt-1 text-xs text-muted-foreground">{data.baseline.pipelines} pipeline{data.baseline.pipelines === 1 ? "" : "s"}{data.baseline.calendars !== null ? `, ${data.baseline.calendars} calendar${data.baseline.calendars === 1 ? "" : "s"}` : ""}.</p>}
      </div>
      {data.rows.length === 0 ? (
        <Empty title={(data.unrelated ?? []).length > 0 ? "No other client was built from this one" : "Nothing to compare"} body={(data.unrelated ?? []).length > 0 ? "Compare setups is for clients you built from the same template. Pick a different baseline, or build new clients from this one and they appear here." : "You need at least two client accounts with pipelines."} />
      ) : (
        <Card title={off.length === 0 ? "Every client built from this one matches" : `${off.length} of ${data.rows.length} differ from the baseline`}>
          <ul className="divide-y text-sm">
            {[...off, ...data.rows.filter((r) => r.matches)].map((r) => (
              <li key={r.locationId} className="py-3 first:pt-0 last:pb-0" data-testid="setup-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <Badge tone={r.matches ? "good" : "warn"}>{r.matches ? "Matches" : "Differs"}</Badge>
                  {r.share !== undefined && <span className="text-xs text-muted-foreground">has {Math.round(r.share * 100)}% of the baseline&apos;s pipelines</span>}
                </div>
                {r.drift && r.drift.length > 0 ? (
                  <div className="mt-2"><Table head={<tr><Th>What is different</Th><Th>How serious</Th><Th>What to do</Th></tr>}>
                    {r.drift.map((d, i) => <tr key={i}><Td>{d.what}</Td><Td><Badge tone={TONE[d.severity]}>{WORDS[d.severity]}</Badge></Td><Td className="text-muted-foreground">{d.fix}</Td></tr>)}
                  </Table></div>
                ) : r.notes.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Compared by name, ignoring capital letters and spaces. Only what your CRM shares with SubSync is checked: pipelines, their stages and the number of calendars.</p>
        </Card>
      )}
      {(data.unrelated ?? []).length > 0 && data.rows.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="setup-unrelated">Not compared: {data.unrelated!.map((u) => u.name).join(", ")}. {data.unrelated!.length === 1 ? "It was" : "They were"} not built from this baseline (fewer than half of its pipelines).</p>
      )}
    </div>
  );
}
