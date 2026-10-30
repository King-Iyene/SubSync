"use client";

import { useState } from "react";
import { useData } from "../session";
import { Badge, Card, Empty, ErrorBox, inputClass, Loading, PageHeader } from "../ui";

type Data = {
  accounts: Array<{ locationId: string; name: string }>;
  baseline: { locationId: string; name: string; pipelines: number; calendars: number | null } | null;
  rows: Array<{ locationId: string; name: string; matches: boolean; notes: string[] }>;
};

export function SetupCompareView() {
  const [baseline, setBaseline] = useState("");
  const { data, error, loading, reload } = useData<Data>(`setup-compare${baseline ? `?baseline=${encodeURIComponent(baseline)}` : ""}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const off = data.rows.filter((r) => !r.matches);

  return (
    <div>
      <PageHeader title="Compare setups" subtitle="Pick the client account set up the way you want, and see which others have drifted from it: missing pipelines, missing or extra stages, a different stage order." />
      <div className="mb-4 max-w-md">
        <label htmlFor="baseline" className="mb-1 block text-sm font-medium">Baseline account</label>
        <select id="baseline" className={inputClass} value={baseline || data.baseline?.locationId || ""} onChange={(e) => setBaseline(e.target.value)}>
          {data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}
        </select>
        {data.baseline && <p className="mt-1 text-xs text-muted-foreground">{data.baseline.pipelines} pipeline{data.baseline.pipelines === 1 ? "" : "s"}{data.baseline.calendars !== null ? `, ${data.baseline.calendars} calendar${data.baseline.calendars === 1 ? "" : "s"}` : ""}.</p>}
      </div>
      {data.rows.length === 0 ? (
        <Empty title="Nothing to compare" body="You need at least two client accounts with pipelines." />
      ) : (
        <Card title={off.length === 0 ? "Every account matches" : `${off.length} of ${data.rows.length} differ from the baseline`}>
          <ul className="divide-y text-sm">
            {[...off, ...data.rows.filter((r) => r.matches)].map((r) => (
              <li key={r.locationId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <Badge tone={r.matches ? "good" : "warn"}>{r.matches ? "Matches" : "Differs"}</Badge>
                </div>
                {r.notes.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Compared by name, ignoring capital letters and spaces. Only what the platform shares with SubSync is checked: pipelines, their stages and the number of calendars.</p>
        </Card>
      )}
    </div>
  );
}
