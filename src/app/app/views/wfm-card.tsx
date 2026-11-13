"use client";

import { useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn } from "../ui";

// Settings, Integrations: "Workflow blocks". Which triggers SubSync fires into this account's workflows, and which actions a workflow may call. Off by default for every account.
type Block = { key: string; name: string; kind: "trigger" | "action"; short: string; enabled: boolean; threshold: number | null; unit: string | null; lastFiredAt: string | null; firedTotal: number; subscribed: boolean };
type Status = { canManage: boolean; ready?: boolean; locationId?: string; accounts?: Array<{ id: string; name: string }>; blocks?: Block[]; cost?: string; writes?: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

export function WfmCard() {
  const api = useApiClient();
  const [loc, setLoc] = useState<string | null>(null);
  const { data, error, reload } = useData<Status>(`wfm${loc ? `?locationId=${encodeURIComponent(loc)}` : ""}`);
  const [msg, setMsg] = useState<string | null>(null);
  if (error || !data || !data.canManage) return null;
  const cur = data.locationId ?? "";
  const set = async (key: string, body: Record<string, unknown>) => {
    setMsg(null);
    try { await api.post(`wfm/act/set`, { locationId: cur, key, ...body }); await reload(); } catch (e) { setMsg((e as Error).message); }
  };
  const group = (kind: "trigger" | "action") => (data.blocks ?? []).filter((b) => b.kind === kind);
  const row = (b: Block) => (
    <li key={b.key} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 first:border-t-0" data-testid={`wfm-${b.key}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium">{b.name} {b.enabled ? <Badge>On</Badge> : <Badge>Off</Badge>}</div>
        <div className="text-xs text-muted-foreground">{b.short}</div>
        {b.kind === "trigger" && <div className="text-xs text-muted-foreground">Last sent: {when(b.lastFiredAt)}. Sent so far: {b.firedTotal}.{b.enabled && !b.subscribed ? " Waiting for a workflow in your CRM to use it." : ""}</div>}
        {b.kind === "trigger" && b.unit && (
          <label className="mt-1 flex items-center gap-1 text-xs">After <input className="w-16 rounded border px-1" type="number" min={1} max={365} defaultValue={b.threshold ?? ""} onBlur={(e) => { const n = Number(e.target.value); if (n && n !== b.threshold) void set(b.key, { threshold: n }); }} /> {b.unit}</label>
        )}
      </div>
      <Btn onClick={() => void set(b.key, { enabled: !b.enabled })}>{b.enabled ? "Turn off" : "Turn on"}</Btn>
    </li>
  );
  return (
    <section className="mb-8" data-testid="wfm-card" aria-labelledby="wfm-h">
      <h3 id="wfm-h" className="text-sm font-semibold">Workflow blocks</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">Triggers start one of your workflows when SubSync spots a problem. Actions let a workflow ask SubSync to do one small thing. Everything is off until you turn it on. {data.cost}</p>
      {(data.accounts?.length ?? 0) > 1 && (
        <select className="mt-2 rounded border px-2 py-1 text-sm" value={cur} onChange={(e) => setLoc(e.target.value)} aria-label="Account">
          {data.accounts!.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      {data.ready === false ? <p className="mt-2 text-sm">Saving this needs the latest database update, which has not run yet.</p> : (
        <>
          <h4 className="mt-3 text-xs font-semibold uppercase text-muted-foreground">Triggers SubSync sends</h4>
          <ul>{group("trigger").map(row)}</ul>
          <h4 className="mt-3 text-xs font-semibold uppercase text-muted-foreground">Actions a workflow can call</h4>
          <ul>{group("action").map(row)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">{data.writes}</p>
        </>
      )}
      {msg && <p className="mt-2 text-sm text-red-600" role="alert">{msg}</p>}
    </section>
  );
}
