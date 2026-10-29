"use client";

import { useState } from "react";
import type { GoFn } from "../nav";
import { useApiClient, useData } from "../session";
import type { AlertItem, Severity } from "../types";
import { Badge, Btn, Empty, ErrorBox, Loading, PageHeader, severityTone, timeAgo } from "../ui";

export function AlertsView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const { data, error, loading, reload } = useData<{ alerts: AlertItem[] }>("alerts");
  const [filter, setFilter] = useState<"all" | Severity>("all");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const list = data.alerts.filter((a) => filter === "all" || a.severity === filter);
  const dismiss = async (id: string) => {
    await api.post(`alerts/${id}/dismiss`);
    await reload();
  };

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Problems worth acting on, raised automatically after each sync. An alert clears itself when the problem is fixed. Connect Slack in Settings to get new ones pushed to a channel."
        actions={<Btn onClick={() => api.download("export/alerts", "subsync-alerts.csv")}>Export CSV</Btn>}
      />
      <div className="mb-4 flex gap-2">
        {(["all", "critical", "warning", "info"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-sm capitalize ${filter === f ? "bg-foreground text-background" : "hover:bg-muted"}`}>
            {f} <span className="opacity-60">{f === "all" ? data.alerts.length : data.alerts.filter((a) => a.severity === f).length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title="No alerts" body="Everything is running smoothly." />
      ) : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
              <div className="flex min-w-0 items-start gap-3">
                <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                <div>
                  <p className="text-sm">{a.title}</p>
                  <p className="text-xs text-muted-foreground">Raised {timeAgo(a.createdAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {a.locationId && <Btn variant="ghost" onClick={() => go("account", a.locationId ?? undefined)}>View account</Btn>}
                <Btn onClick={() => dismiss(a.id)}>Dismiss</Btn>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">Dismissing hides an alert until the next sync; if the problem is still there it comes back.</p>
    </div>
  );
}
