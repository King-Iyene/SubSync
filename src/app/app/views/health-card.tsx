"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, timeAgo } from "../ui";

type Health = {
  level: "healthy" | "degraded" | "down" | "idle";
  reasons: string[];
  stale: boolean;
  lastSyncAt: string | null;
  failedJobs24h: number;
  totalJobs24h: number;
  recentErrors: Array<{ type: string; locationId: string | null; error: string; at: string | null }>;
  accounts: Array<{
    locationId: string; name: string | null; lastSyncedAt: string | null; contactsSyncedAt: string | null;
    opportunitiesSyncedAt: string | null; conversationsSyncedAt: string | null; syncError: string | null; contacts: number;
  }>;
};

const tone = { healthy: "good", degraded: "warn", down: "bad", idle: "neutral" } as const;
const label = { healthy: "Healthy", degraded: "Needs a look", down: "Connection problem", idle: "Waiting for first sync" } as const;

// A thin strip shown above every page: how fresh the data is, with a warning once it is stale.
export function FreshnessStrip() {
  const { data } = useData<Health>("health");
  if (!data || data.level === "idle") return null;
  const warn = data.level !== "healthy";
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-xs print:hidden ${warn ? "border-amber-500/40 bg-amber-500/5" : "text-muted-foreground"}`} role="status">
      <span>Last synced {timeAgo(data.lastSyncAt)}</span>
      {data.stale && <Badge tone="warn">Data may be out of date</Badge>}
      {data.level === "down" && <Badge tone="bad">Connection problem</Badge>}
    </div>
  );
}

export function HealthCard() {
  const api = useApiClient();
  const { data, reload } = useData<Health>("health");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return null;

  const resync = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      await api.post(`sync/${id}`);
      await reload();
      setNote("Resync started. Numbers update as it finishes.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Connection health" action={<Badge tone={tone[data.level]}>{label[data.level]}</Badge>}>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-muted-foreground">Last synced</dt><dd>{timeAgo(data.lastSyncAt)}</dd></div>
        <div><dt className="text-muted-foreground">Jobs, 24 hours</dt><dd>{data.totalJobs24h}</dd></div>
        <div><dt className="text-muted-foreground">Failed</dt><dd>{data.failedJobs24h}</dd></div>
      </dl>
      {data.reasons.length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-700 dark:text-amber-300">{data.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {data.recentErrors.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-lg bg-red-500/10 p-2 text-xs text-muted-foreground">
          {data.recentErrors.map((e, i) => <li key={i}>{e.type}: {e.error}</li>)}
        </ul>
      )}
      {note && <p className="mt-3 text-sm text-muted-foreground" role="status">{note}</p>}
      {data.accounts.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="py-1 pr-3 font-medium">Client account</th><th className="pr-3 font-medium">Contacts</th><th className="pr-3 font-medium">Last synced</th><th className="pr-3 font-medium">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y">
              {data.accounts.map((a) => (
                <tr key={a.locationId}>
                  <td className="py-1.5 pr-3">{a.name ?? "Unnamed account"}</td>
                  <td className="pr-3 tabular-nums">{a.contacts.toLocaleString("en-US")}</td>
                  <td className="pr-3">{timeAgo(a.lastSyncedAt)}</td>
                  <td className="pr-3">{a.syncError ? <Badge tone="bad">Error</Badge> : <Badge tone="good">OK</Badge>}</td>
                  <td className="text-right"><Btn variant="ghost" disabled={busy === a.locationId} onClick={() => resync(a.locationId)}>{busy === a.locationId ? "Syncing..." : "Resync"}</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
