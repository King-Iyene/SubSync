"use client";

import { useState } from "react";
import type { Freshness, FreshnessState } from "@/lib/sync/freshness";
import type { SyncPanel } from "@/lib/sync/freshness-queries";
import { useApiClient, useData } from "../session";
import { InlineAlert } from "../ds/alert";
import { Badge, Btn, Card, type Tone } from "../ui";

// The ONE place the screen says how fresh the data is: a thin line above every page, fed by `GET freshness`, which is the same function the
// daily brief, Today, the Overview and the Sync status panel use (src/lib/sync/freshness.ts). Nothing else on a page may word it.
const stateTone: Record<FreshnessState, Tone> = { demo: "neutral", first_sync: "info", never: "warn", fresh: "good", delayed: "warn", failing: "bad" };

export function FreshnessStrip() {
  const { data } = useData<{ freshness: Freshness }>("freshness");
  const f = data?.freshness;
  if (!f) return null;
  const warn = f.state === "delayed" || f.state === "failing" || f.state === "never";
  // Quiet text in the page header, not a card (N9). Only a delayed, failing or never-synced state becomes a notice, in the one lightweight alert style.
  const words = (
    <>
      <span data-testid="freshness-text" className={warn ? "font-medium text-foreground" : ""}>{f.text}</span>
      {f.detail && <span> · {f.detail}</span>}
    </>
  );
  return (
    <div className="mb-4 print:hidden" data-testid="freshness" data-state={f.state}>
      {warn ? <InlineAlert tone={f.state === "failing" ? "danger" : "warning"}>{words}</InlineAlert> : <p role="status" className="text-xs text-muted-foreground">{words}</p>}
      {f.syncingNote && <p className="mt-1 text-xs text-muted-foreground" data-testid="syncing-note">{f.syncingNote}</p>}
    </div>
  );
}

// One panel for everything about syncing, in Settings. It replaces the old "Connection health" and "Data sync" cards.
export function SyncStatusPanel() {
  const api = useApiClient();
  const { data, reload } = useData<SyncPanel>("sync-status");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return null;
  const f = data.freshness;

  const run = async (key: string, path: string, done: string) => {
    setBusy(key);
    setNote(null);
    try {
      await api.post(path);
      await reload();
      setNote(done);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Sync status" action={<Badge tone={stateTone[f.state]}>{f.state === "demo" ? "Sample data" : f.state === "fresh" ? "Up to date" : f.state === "first_sync" ? "First sync" : f.state === "never" ? "Not synced yet" : f.state === "delayed" ? "Delayed" : "Needs a look"}</Badge>}>
      <p className="text-sm font-medium" data-testid="sync-panel-text">{f.text}</p>
      {f.detail && <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>}

      {!data.demo && (
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Next refresh</dt><dd data-testid="sync-next">{data.nextRun?.text ?? "Not scheduled"}</dd></div>
          <div>
            <dt className="text-muted-foreground">Checks run in the last 24 hours</dt>
            <dd>{data.checks24h.total.toLocaleString("en-US")}{data.checks24h.failed > 0 ? `, ${data.checks24h.failed} failed and retried` : ", none failed"}</dd>
          </div>
        </dl>
      )}
      {!data.demo && <p className="mt-2 text-xs text-muted-foreground">A check is one small read of one account, for example its conversations. Every refresh runs several per account, so the number is large. A failed check is tried again on the next refresh.</p>}

      {data.problems.length > 0 && (
        <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm" data-testid="sync-problems">
          <p className="font-medium">What went wrong</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {data.problems.map((p, i) => <li key={i}>{p.account ? <strong className="font-medium text-foreground">{p.account}: </strong> : null}{p.reason}</li>)}
          </ul>
        </div>
      )}

      {f.accounts.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="py-1 pr-3 font-medium">Client account</th><th className="pr-3 font-medium">Last refreshed</th><th className="pr-3 font-medium">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y">
              {f.accounts.map((a) => (
                <tr key={a.locationId}>
                  <td className="py-1.5 pr-3">{a.name ?? "Unnamed account"}</td>
                  <td className="pr-3">{a.state === "first" ? "Reading for the first time" : a.updatedAt ? a.text.replace(/^Updated /, "") : data.demo ? "Sample data" : "Not yet"}</td>
                  <td className="pr-3">{a.state === "failing" ? <Badge tone="bad">Failed</Badge> : a.state === "delayed" ? <Badge tone="warn">Delayed</Badge> : a.state === "first" ? <Badge tone="info">First read</Badge> : <Badge tone="good">OK</Badge>}</td>
                  <td className="text-right"><Btn variant="ghost" disabled={busy !== null} onClick={() => run(a.locationId, `sync/${a.locationId}`, "Refresh started for that account. Numbers update as it finishes.")}>{busy === a.locationId ? "Syncing..." : "Refresh"}</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!data.demo && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">What runs, and when</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" data-testid="sync-schedule">{data.schedule.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}

      {note && <p className="mt-3 text-sm text-muted-foreground" role="status">{note}</p>}
      <div className="mt-3"><Btn disabled={busy !== null} onClick={() => run("all", "sync", api.demo ? "Insights refreshed." : "Sync started. It continues in the background.")}>{busy === "all" ? "Syncing..." : api.demo ? "Refresh insights" : "Sync now"}</Btn></div>
    </Card>
  );
}
