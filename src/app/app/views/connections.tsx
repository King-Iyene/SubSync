"use client";

import { Hash, Mic, Video, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient, useData } from "../session";
import { Badge, Btn, Card, timeAgo } from "../ui";

type Provider = "slack" | "fathom" | "zoom";
type Conn = {
  id: string; provider: Provider; status: string; label: string | null; onlyLocationId: string | null;
  saved: number; skipped: number; lastEventAt: string | null;
};
// `available` only has the providers this person may see: Zoom is absent while its switch is off.
type Data = { connections: Conn[]; available: Partial<Record<Provider, boolean>> };

const INFO: Record<Provider, { name: string; icon: LucideIcon; what: string; tint: string }> = {
  slack: { name: "Slack", icon: Hash, what: "Alerts and the daily brief arrive in the channel you pick. You choose it on Slack's own page.", tint: "bg-[oklch(0.94_0.04_330)] text-[oklch(0.42_0.14_330)]" },
  fathom: { name: "Fathom", icon: Mic, what: "Each recording's summary and action items are saved in SubSync and matched to a contact by their exact email. A meeting nobody can be matched to is not saved, only counted. Transcripts are not requested.", tint: "bg-[oklch(0.94_0.05_20)] text-[oklch(0.45_0.15_20)]" },
  zoom: { name: "Zoom", icon: Video, what: "When Zoom's AI Companion writes a meeting summary, it is saved in SubSync and matched to a contact by their exact email. The host needs a paid Zoom plan with meeting summaries switched on.", tint: "bg-[oklch(0.94_0.04_250)] text-[oklch(0.42_0.14_250)]" },
};
const ORDER: Provider[] = ["slack", "fathom", "zoom"];
const WAIT_MS = 3 * 60_000;

export function ConnectionsCard({ meetingSettings = false }: { meetingSettings?: boolean }) {
  const api = useApiClient();
  const { data, reload } = useData<Data>("connections");
  const [waiting, setWaiting] = useState<Provider | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const before = useRef<string>("");

  const signature = (d: Data | null) => (d ? d.connections.map((c) => `${c.id}:${c.status}`).join("|") : "");

  // After the window opens, look for the new connection every few seconds, and stop once it shows up.
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(() => { void reload(); if (Date.now() - started > WAIT_MS) setWaiting(null); }, 3000);
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data?.subsync === "connection") { void reload(); setWaiting(null); setMsg(e.data.ok ? { ok: true, text: `${INFO[e.data.provider as Provider]?.name ?? "The app"} is connected.` } : null); }
    };
    window.addEventListener("message", onMessage);
    return () => { clearInterval(timer); window.removeEventListener("message", onMessage); };
  }, [waiting, reload]);

  useEffect(() => {
    if (waiting && data && signature(data) !== before.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaiting(null);
      setMsg({ ok: true, text: `${INFO[waiting].name} is connected.` });
    }
  }, [data, waiting]);

  const connect = useCallback(async (p: Provider) => {
    setMsg(null);
    try {
      const { url } = await api.post<{ url: string }>(`connections/${p}/start`);
      before.current = signature(data ?? null);
      const win = window.open(url, "subsync-connect", "width=560,height=720");
      if (!win) { setMsg({ ok: false, text: "Your browser blocked the pop-up. Allow pop-ups for this page and try again." }); return; }
      setWaiting(p);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [api, data]);

  const remove = async (id: string) => {
    setConfirm(null);
    try { await api.del(`connections/${id}`); await reload(); setMsg({ ok: true, text: "Disconnected. SubSync no longer has access." }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  if (!data) return null;
  const shown = ORDER.filter((p) => p in data.available);
  return (
    <Card title="Connections">
      <p className="mb-4 text-sm text-muted-foreground">Sign in once and SubSync does the rest. You never paste a web address, and you can disconnect at any time.</p>
      <ul className="divide-y rounded-xl border">
        {shown.map((p) => {
          const info = INFO[p];
          const Icon = info.icon;
          const mine = data.connections.filter((c) => c.provider === p);
          const on = data.available[p] === true;
          const broken = mine.some((c) => c.status === "needs_reconnect");
          return (
            <li key={p} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span aria-hidden className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${info.tint}`}><Icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{info.name}</h3>
                    {mine.length > 0 && !broken && <Badge tone="good">Connected</Badge>}
                    {broken && <Badge tone="warn">Needs to be connected again</Badge>}
                    {mine.length === 0 && !on && <Badge tone="neutral">Not switched on yet</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{info.what}</p>
                  {!on && mine.length === 0 && <p className="mt-1 text-xs text-muted-foreground">This needs the {info.name} app to be set up for SubSync first.</p>}
                </div>
                <div className="shrink-0">
                  {(mine.length === 0 || p === "zoom" || broken) && (
                    <Btn variant={mine.length === 0 || broken ? "primary" : "secondary"} disabled={!on || waiting === p} onClick={() => void connect(p)}>
                      {waiting === p ? "Waiting for you..." : broken ? "Connect again" : mine.length ? "Add another person" : `Connect ${info.name}`}
                    </Btn>
                  )}
                </div>
              </div>

              {mine.map((c) => (
                <div key={c.id} className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><span className="font-medium">{c.label ?? info.name}</span>
                      {p !== "slack" && <span className="text-muted-foreground"> · {c.saved} saved{c.skipped ? `, ${c.skipped} not saved (nobody matched)` : ""}{c.lastEventAt ? `, last ${timeAgo(c.lastEventAt)}` : ", none yet"}</span>}</span>
                    {confirm === c.id ? (
                      <span className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Remove access?</span>
                        <Btn variant="primary" onClick={() => void remove(c.id)}>Yes, disconnect</Btn><Btn variant="ghost" onClick={() => setConfirm(null)}>Keep</Btn></span>
                    ) : <Btn variant="ghost" onClick={() => setConfirm(c.id)}>Disconnect</Btn>}
                  </div>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}
      <p className="mt-3 text-xs text-muted-foreground">SubSync saves each meeting summary inside SubSync. When it matches a contact by exact email, it also adds the summary to that contact&apos;s notes in your CRM{meetingSettings ? " (you can switch this off under Meeting notes privacy)" : ""}. It sends nothing to the people in the meeting.</p>
    </Card>
  );
}
