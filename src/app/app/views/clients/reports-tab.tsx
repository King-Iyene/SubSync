"use client";

import { useState } from "react";
import { MUTE_WORDS, type MuteKind, type Receipt, type SetupItem } from "@/lib/analytics/clients-actions";
import { useApiClient, useData } from "../../session";
import { EmptyState, SkeletonRows } from "../../ds";
import { Btn, ErrorBox, inputClass } from "../../ui";

// Clients > Reports (slice CB): the last 7 days per client as a plain receipt to copy, print or download; quiet one kind of attention for a client and put it back; set one client's
// reply target; and the setup health with the exact "Needs permission: reconnect" words. Everything is a count from the synced data. Nothing here writes to the CRM or messages anyone.
type ReceiptOut = Receipt & { text: string };
type ReportData = { receipts: ReceiptOut[]; capped: boolean };
type SetupData = { clients: Array<{ locationId: string; name: string; items: SetupItem[] }>; needsReconnect: number };
type MuteData = { ready: boolean; mutes: Array<{ id: string; locationId: string; kind: MuteKind; until: number }>; days: number[] };

export function ReportsTab() {
  const api = useApiClient();
  const rep = useData<ReportData>("clients/act/receipt");
  const setup = useData<SetupData>("clients/act/setup");
  const mutes = useData<MuteData>("clients/act/mutes");
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ message?: string }>) => {
    setErr(null);
    try { const r = await fn(); setMsg(r.message ?? "Done."); mutes.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
  };
  const copy = async (r: ReceiptOut) => { try { await navigator.clipboard.writeText(r.text); setMsg(`Copied the weekly report for ${r.name}.`); } catch { setErr("Copy is blocked in this browser. Use Print instead."); } };
  const mutedOf = (id: string) => mutes.data?.mutes.filter((m) => m.locationId === id) ?? [];

  if (rep.loading && !rep.data) return <SkeletonRows rows={4} label="Loading weekly reports..." />;
  if (rep.error && /not switched on/i.test(String(rep.error))) return <EmptyState title="Reports are not switched on yet" body="Weekly client reports will appear here once they are switched on for your account." />;
  if (rep.error) return <ErrorBox error={rep.error} onRetry={rep.reload} />;
  if (!rep.data || rep.data.receipts.length === 0) return <EmptyState title="No client reports yet" body="A weekly report appears for each client once its first read finishes." />;

  return (
    <div className="space-y-6" data-testid="clients-reports">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="max-w-2xl text-sm text-muted-foreground">The last 7 days for each client, from the data SubSync has read. Copy it for the client, print it, or download all of them.</p>
        <Btn onClick={() => api.download("clients/act/csv", "subsync-weekly-report.csv")}>Download CSV</Btn>
      </div>
      <div aria-live="polite" className="min-h-5 text-sm print:hidden">{err ? <span role="alert" className="text-destructive">{err}</span> : msg}</div>
      {setup.data && setup.data.needsReconnect > 0 && (
        <p className="rounded-md border px-3 py-2 text-sm print:hidden" data-testid="reconnect-note">Needs permission: reconnect for {setup.data.needsReconnect} {setup.data.needsReconnect === 1 ? "client" : "clients"}. Their numbers are incomplete until you do.</p>
      )}
      <ul className="divide-y rounded-md border">
        {rep.data.receipts.map((r) => {
          const muted = mutedOf(r.locationId);
          const issues = setup.data?.clients.find((c) => c.locationId === r.locationId)?.items.filter((i) => !i.ok) ?? [];
          return (
            <li key={r.locationId} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-medium">{r.name}</p><p className="text-sm text-muted-foreground">{r.headline}</p></div>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <Btn onClick={() => copy(r)}>Copy for client</Btn>
                  <Btn onClick={() => { setOpen(open === r.locationId ? null : r.locationId); setMinutes(""); }}>{open === r.locationId ? "Close" : "Settings"}</Btn>
                </div>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {r.lines.map((l) => <div key={l.id} className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">{l.label}</dt><dd className="font-medium">{l.value}</dd>{l.note && <dd className="w-full text-xs text-muted-foreground">{l.note}</dd>}</div>)}
              </dl>
              {issues.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">{issues.map((i) => <li key={i.id}>{i.text}</li>)}</ul>}
              {muted.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground print:hidden">Quieted: {muted.map((m) => `${MUTE_WORDS[m.kind]} until ${new Date(m.until).toISOString().slice(0, 10)}`).join("; ")}{" "}
                  {muted.map((m) => <button key={m.id} type="button" className="underline" onClick={() => run(() => api.post("clients/act/unmute", { id: m.id }))}>Undo ({MUTE_WORDS[m.kind]})</button>)}</p>
              )}
              {open === r.locationId && (
                <div className="mt-3 grid gap-4 rounded-md border p-3 text-sm sm:grid-cols-2 print:hidden">
                  <div>
                    <p className="mb-1 font-medium">Quiet for a while</p>
                    <p className="mb-2 text-xs text-muted-foreground">Hides one kind of attention for this client. Nothing is changed in your CRM.</p>
                    {(Object.keys(MUTE_WORDS) as MuteKind[]).map((k) => (
                      <div key={k} className="mb-1 flex items-center justify-between gap-2"><span>{MUTE_WORDS[k]}</span>
                        <span className="flex gap-1">{(mutes.data?.days ?? [7, 30]).map((d) => <Btn key={d} onClick={() => run(() => api.post("clients/act/mute", { location: r.locationId, kind: k, days: d }))} title={`Quiet for ${d} days`}>{d}d</Btn>)}</span></div>
                    ))}
                  </div>
                  <div>
                    <label htmlFor={`t-${r.locationId}`} className="mb-1 block font-medium">Reply target (minutes)</label>
                    <p className="mb-2 text-xs text-muted-foreground">How fast a new lead should get a reply for this client. Leave empty to use your default.</p>
                    <div className="flex flex-wrap gap-2">
                      <input id={`t-${r.locationId}`} className={`${inputClass} w-28`} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                      <Btn variant="primary" onClick={() => run(() => api.post("clients/act/target", { location: r.locationId, minutes: minutes === "" ? null : Number(minutes) }))}>Save</Btn>
                      <Btn onClick={() => run(() => api.post("clients/act/target-undo", { location: r.locationId }))}>Undo last change</Btn>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rep.data.capped && <p className="text-xs text-muted-foreground">Showing the first 200 clients.</p>}
      <div className="print:hidden"><Btn onClick={() => window.print()}>Print all</Btn></div>
    </div>
  );
}
