"use client";

import { useState } from "react";
import type { GoFn } from "../nav";
import { useApiClient, useData } from "../session";
import type { ChecklistItem } from "../types";
import { Badge, Card, Empty, ErrorBox, ExtLink, Loading, PageHeader } from "../ui";

type Row = { locationId: string; name: string | null; owner: string | null; url: string; completionPct: number; items: ChecklistItem[] };

export function OnboardingView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ accounts: Row[] }>("onboarding");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  if (data.accounts.length === 0) return <Empty title="No accounts yet" body="Accounts appear here once the first sync finishes." />;

  const toggle = async (locationId: string, task: string, done: boolean) => {
    setBusy(true);
    try {
      await api.put(`accounts/${locationId}/tasks`, { task, done });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Onboarding" subtitle="How far along each client account is. Most checks are automatic (pipeline, contacts, calendar, activity, email authentication); the rest are tasks you tick off yourself. Add your own steps in Settings." />
      <div className="space-y-3">
        {data.accounts.map((r) => {
          const missing = r.items.filter((i) => i.status === "todo");
          const expanded = open === r.locationId;
          return (
            <Card key={r.locationId}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => go("account", r.locationId)} className="text-sm font-semibold hover:underline">{r.name ?? "Unnamed account"}</button>
                    {r.owner && <Badge>{r.owner}</Badge>}
                    {r.completionPct === 100 && <Badge tone="good">Fully onboarded</Badge>}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={r.completionPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} onboarding progress`}>
                      <div className={`h-full ${r.completionPct >= 80 ? "bg-emerald-500" : r.completionPct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${r.completionPct}%` }} />
                    </div>
                    <span className="text-sm tabular-nums">{r.completionPct}%</span>
                  </div>
                  {missing.length > 0 && !expanded && (
                    <p className="mt-2 text-xs text-muted-foreground">Still to do: {missing.slice(0, 4).map((m) => m.label).join(" · ")}{missing.length > 4 ? ` · and ${missing.length - 4} more` : ""}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <ExtLink href={r.url}>Open</ExtLink>
                  <button type="button" onClick={() => setOpen(expanded ? null : r.locationId)} aria-expanded={expanded} className="rounded-lg border px-3 py-1 hover:bg-muted">{expanded ? "Hide" : "Checklist"}</button>
                </div>
              </div>
              {expanded && (
                <ul className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2">
                  {r.items.map((i) => (
                    <li key={i.key} className="flex items-start gap-2 text-sm">
                      {i.auto ? (
                        <span aria-hidden className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${i.status === "done" ? "bg-emerald-500 text-white" : i.status === "unknown" ? "bg-muted text-muted-foreground" : "border"}`}>{i.status === "done" ? "✓" : i.status === "unknown" ? "?" : ""}</span>
                      ) : (
                        <input type="checkbox" className="mt-0.5 size-4" checked={i.status === "done"} disabled={busy} aria-label={i.label} onChange={(e) => toggle(r.locationId, i.key, e.target.checked)} />
                      )}
                      <span className={i.status === "done" ? "text-muted-foreground line-through" : ""}>{i.label}{i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
